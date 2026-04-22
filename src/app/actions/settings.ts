"use server";

import { db } from "@/db";
import { tenants, webhookEndpoints, whatsappConfigs, activityLog } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { encrypt } from "@/lib/encryption";
import { hashSecret, secretPrefix } from "@/lib/secret-hash";

async function requireOwnerOrAdmin() {
  const ctx = await requireTenant();
  if (!["OWNER", "ADMIN"].includes(ctx.role)) {
    throw new Error("ليس لديك صلاحية لهذا الإجراء");
  }
  return ctx;
}

// =============================================
// جلب إعدادات الشركة
// =============================================

export async function getTenantSettings() {
  // قراءة اسم الشركة مسموحة لكل المستخدمين المصادَقين (تظهر في الـ UI)
  const { tenantId } = await requireTenant();

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });

  return tenant;
}

// =============================================
// تحديث إعدادات الشركة
// =============================================

export async function updateTenantSettings(input: {
  name?: string;
  settings?: Record<string, string>;
}) {
  const { tenantId, userId } = await requireOwnerOrAdmin();

  // input validation
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed || trimmed.length > 255) {
      throw new Error("اسم الشركة غير صالح");
    }
  }

  // اقرأ settings الحالية ودمج (لا تستبدل) لمنع فقدان حقول أخرى
  let mergedSettings: Record<string, unknown> | undefined;
  if (input.settings) {
    const [current] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    mergedSettings = {
      ...((current?.settings as Record<string, unknown>) ?? {}),
      ...input.settings,
    };
  }

  await db
    .update(tenants)
    .set({
      ...(input.name && { name: input.name.trim() }),
      ...(mergedSettings && { settings: mergedSettings }),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "SETTINGS_UPDATED",
    entityType: "tenant",
    entityId: tenantId,
    details: { changedFields: Object.keys(input) },
  });

  revalidatePath("/settings");
}

// =============================================
// إنشاء مفتاح ويب هوك
// =============================================

export async function createWebhookKey(label?: string) {
  const { tenantId, userId } = await requireOwnerOrAdmin();

  // نولّد السر plaintext (يُعاد للمستخدم مرة واحدة فقط)
  const secretKey = randomBytes(32).toString("hex");
  const secretHash = await hashSecret(secretKey);
  const prefix = secretPrefix(secretKey);

  const [webhook] = await db
    .insert(webhookEndpoints)
    .values({
      tenantId,
      // لا نحفظ plaintext — فقط hash + prefix
      secretHash,
      secretPrefix: prefix,
      label: label || "Google Sheets",
      isActive: true,
    })
    .returning();

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "SETTINGS_UPDATED",
    entityType: "webhook",
    entityId: webhook.id,
    details: { action: "created", label: webhook.label },
  });

  revalidatePath("/settings/webhooks");
  return { id: webhook.id, secretKey, label: webhook.label };
}

// =============================================
// جلب مفاتيح الويب هوك
// =============================================

export async function getWebhookKeys() {
  const { tenantId } = await requireOwnerOrAdmin();

  return db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.tenantId, tenantId));
}

// =============================================
// تفعيل/تعطيل ويب هوك
// =============================================

export async function toggleWebhook(webhookId: string) {
  const { tenantId } = await requireOwnerOrAdmin();

  const [webhook] = await db
    .select({ isActive: webhookEndpoints.isActive })
    .from(webhookEndpoints)
    .where(
      and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.tenantId, tenantId))
    );

  if (!webhook) throw new Error("الويب هوك غير موجود");

  await db
    .update(webhookEndpoints)
    .set({ isActive: !webhook.isActive })
    .where(
      and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.tenantId, tenantId))
    );

  revalidatePath("/settings/webhooks");
}

// =============================================
// تفعيل/تعطيل رسالة الترحيب
// =============================================

export async function toggleWebhookWelcome(webhookId: string) {
  const { tenantId } = await requireOwnerOrAdmin();

  const [webhook] = await db
    .select({ sendWelcome: webhookEndpoints.sendWelcome })
    .from(webhookEndpoints)
    .where(
      and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.tenantId, tenantId))
    );

  if (!webhook) throw new Error("الويب هوك غير موجود");

  await db
    .update(webhookEndpoints)
    .set({ sendWelcome: !webhook.sendWelcome })
    .where(
      and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.tenantId, tenantId))
    );

  revalidatePath("/settings/webhooks");
}

// =============================================
// حذف ويب هوك
// =============================================

export async function deleteWebhook(webhookId: string) {
  const { tenantId } = await requireOwnerOrAdmin();

  await db
    .delete(webhookEndpoints)
    .where(
      and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.tenantId, tenantId))
    );

  revalidatePath("/settings/webhooks");
}

// =============================================
// إعدادات واتساب
// =============================================

export async function getWhatsappConfig() {
  const { tenantId } = await requireOwnerOrAdmin();

  return db.query.whatsappConfigs.findFirst({
    where: eq(whatsappConfigs.tenantId, tenantId),
  });
}

export async function saveWhatsappConfig(input: {
  phoneNumber?: string;
  provider?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
  reminderTemplateName?: string;
  reminderEvening?: boolean;
  reminderMorning?: boolean;
  isActive?: boolean;
}) {
  const { tenantId, userId } = await requireOwnerOrAdmin();

  // Check if config exists
  const existing = await db.query.whatsappConfigs.findFirst({
    where: eq(whatsappConfigs.tenantId, tenantId),
  });

  if (existing) {
    await db
      .update(whatsappConfigs)
      .set({
        ...(input.phoneNumber !== undefined && { phoneNumber: input.phoneNumber }),
        ...(input.provider !== undefined && { provider: input.provider }),
        ...(input.templateName !== undefined && { templateName: input.templateName }),
        ...(input.templateLanguage !== undefined && { templateLanguage: input.templateLanguage }),
        ...(input.templateParams !== undefined && { templateParams: input.templateParams }),
        ...(input.reminderTemplateName !== undefined && { reminderTemplateName: input.reminderTemplateName }),
        ...(input.reminderEvening !== undefined && { reminderEvening: input.reminderEvening }),
        ...(input.reminderMorning !== undefined && { reminderMorning: input.reminderMorning }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(whatsappConfigs.tenantId, tenantId));
  } else {
    await db.insert(whatsappConfigs).values({
      tenantId,
      phoneNumber: input.phoneNumber,
      provider: input.provider || "meta",
      templateName: input.templateName,
      templateLanguage: input.templateLanguage || "ar",
      templateParams: input.templateParams || ["name"],
      reminderTemplateName: input.reminderTemplateName,
      reminderEvening: input.reminderEvening ?? true,
      reminderMorning: input.reminderMorning ?? true,
      isActive: input.isActive || false,
    });
  }

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "SETTINGS_UPDATED",
    entityType: "whatsapp_config",
    entityId: tenantId,
    details: { ...input },
  });

  revalidatePath("/settings/whatsapp");
}

// =============================================
// حفظ مفتاح API (مشفر)
// =============================================

export async function saveWhatsappApiKey(apiKey: string) {
  const { tenantId } = await requireOwnerOrAdmin();

  // تشفير المفتاح قبل الحفظ — AAD يربط السر بالـ tenant (يمنع swap attack)
  const encryptedKey = encrypt(apiKey, `whatsapp:${tenantId}`);

  const existing = await db.query.whatsappConfigs.findFirst({
    where: eq(whatsappConfigs.tenantId, tenantId),
  });

  if (existing) {
    await db
      .update(whatsappConfigs)
      .set({ apiKeyEncrypted: encryptedKey, updatedAt: new Date() })
      .where(eq(whatsappConfigs.tenantId, tenantId));
  } else {
    await db.insert(whatsappConfigs).values({
      tenantId,
      apiKeyEncrypted: encryptedKey,
    });
  }

  revalidatePath("/settings/whatsapp");
}

// =============================================
// اختبار ربط واتساب (حقيقي)
// =============================================

export async function testWhatsappConnectionAction(testPhone: string) {
  const { tenantId } = await requireOwnerOrAdmin();

  if (!testPhone || testPhone.trim().length < 4) {
    return { success: false, error: "أدخل رقم هاتف للاختبار" };
  }

  const { testWhatsappConnection } = await import("@/lib/whatsapp");
  const result = await testWhatsappConnection(tenantId, testPhone.trim());

  return result;
}
