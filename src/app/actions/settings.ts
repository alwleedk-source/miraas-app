"use server";

import { db } from "@/db";
import { tenants, webhookEndpoints, whatsappConfigs, activityLog } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { encrypt } from "@/lib/encryption";

// =============================================
// Helper
// =============================================

async function getOwnerTenant() {
  const session = await requireAuth();
  const user = session.user as Record<string, unknown>;
  const tenantId = user.tenantId as string;
  if (!tenantId) throw new Error("المستخدم غير مرتبط بشركة");
  return { tenantId, userId: session.user.id };
}

// =============================================
// جلب إعدادات الشركة
// =============================================

export async function getTenantSettings() {
  const { tenantId } = await getOwnerTenant();

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
  const { tenantId, userId } = await getOwnerTenant();

  await db
    .update(tenants)
    .set({
      ...(input.name && { name: input.name }),
      ...(input.settings && { settings: input.settings }),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "SETTINGS_UPDATED",
    entityType: "tenant",
    entityId: tenantId,
    details: input,
  });

  revalidatePath("/settings");
}

// =============================================
// إنشاء مفتاح ويب هوك
// =============================================

export async function createWebhookKey(label?: string) {
  const { tenantId, userId } = await getOwnerTenant();

  const secretKey = randomBytes(32).toString("hex");

  const [webhook] = await db
    .insert(webhookEndpoints)
    .values({
      tenantId,
      secretKey,
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
  const { tenantId } = await getOwnerTenant();

  return db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.tenantId, tenantId));
}

// =============================================
// تفعيل/تعطيل ويب هوك
// =============================================

export async function toggleWebhook(webhookId: string) {
  const { tenantId } = await getOwnerTenant();

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
  const { tenantId } = await getOwnerTenant();

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
  const { tenantId } = await getOwnerTenant();

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
  const { tenantId } = await getOwnerTenant();

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
  isActive?: boolean;
}) {
  const { tenantId, userId } = await getOwnerTenant();

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
  const { tenantId } = await getOwnerTenant();

  // تشفير المفتاح قبل الحفظ
  const encryptedKey = encrypt(apiKey);

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

export async function testWhatsappConnectionAction() {
  const { tenantId } = await getOwnerTenant();

  const { testWhatsappConnection } = await import("@/lib/whatsapp");
  const result = await testWhatsappConnection(tenantId);

  return result;
}
