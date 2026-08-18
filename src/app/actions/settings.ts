"use server";

import { db } from "@/db";
import { tenants, webhookEndpoints, whatsappConfigs, activityLog, webhookCoordinators, users, userWhatsappCredentials } from "@/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { assertUserInTenant } from "@/lib/tenant-guards";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { encrypt } from "@/lib/encryption";
import { hashSecret, secretPrefix } from "@/lib/secret-hash";
import { setWebhookCoordinatorsSchema, webhookLabelSchema } from "@/lib/schemas";
import { rateLimit } from "@/lib/rate-limit";

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
  // (صفحة /settings نفسها محميّة لـ OWNER/ADMIN عبر settings/layout.tsx)
  const { tenantId } = await requireTenant();

  // نختار فقط الأعمدة التي تعرضها واجهة الإعدادات — كان findFirst يُرجع صف
  // tenants الكامل لأي دور مصادَق، بما فيه أسرار النسخ الاحتياطي.
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: {
      id: true,
      name: true,
      plan: true,
      status: true,
      settings: true,
    },
  });
  if (!tenant) return tenant;

  // 🔒 backupSheetSecret/backupSheetUrl لا تغادر السيرفر أبداً —
  // getBackupStatus يكشف hasSecret فقط عمداً، ونطابق ذلك هنا.
  const safeSettings = { ...((tenant.settings ?? {}) as Record<string, unknown>) };
  delete safeSettings.backupSheetSecret;
  delete safeSettings.backupSheetUrl;

  return { ...tenant, settings: safeSettings };
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
      return { success: false as const, error: "اسم الشركة غير صالح" };
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
  return { success: true as const };
}

// =============================================
// إنشاء مفتاح ويب هوك
// =============================================

export async function createWebhookKey(label?: string) {
  const { tenantId, userId } = await requireOwnerOrAdmin();

  // تحقّق صارم من اسم الحملة (1-60 حرف) — يطابق حدّ DB + يمنع أسماء فارغة
  let validatedLabel = "Google Sheets";
  if (label) {
    const p = webhookLabelSchema.safeParse(label);
    if (!p.success) {
      return { success: false as const, error: "اسم الحملة غير صالح (1-60 حرف)" };
    }
    validatedLabel = p.data;
  }

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
      label: validatedLabel,
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
  return { success: true as const, id: webhook.id, secretKey, label: webhook.label };
}

// =============================================
// جلب مفاتيح الويب هوك
// =============================================

export async function getWebhookKeys() {
  const { tenantId } = await requireOwnerOrAdmin();

  // نستثني secretHash عمداً — لا حاجة له في العميل ولا يجب أن يغادر الخادم
  return db
    .select({
      id: webhookEndpoints.id,
      tenantId: webhookEndpoints.tenantId,
      secretKey: webhookEndpoints.secretKey,
      secretPrefix: webhookEndpoints.secretPrefix,
      label: webhookEndpoints.label,
      isActive: webhookEndpoints.isActive,
      sendWelcome: webhookEndpoints.sendWelcome,
      welcomeTemplateName: webhookEndpoints.welcomeTemplateName,
      lastAssignedToUserId: webhookEndpoints.lastAssignedToUserId,
      lastReceivedAt: webhookEndpoints.lastReceivedAt,
      createdAt: webhookEndpoints.createdAt,
    })
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

  if (!webhook) return { success: false as const, error: "الويب هوك غير موجود" };

  await db
    .update(webhookEndpoints)
    .set({ isActive: !webhook.isActive })
    .where(
      and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.tenantId, tenantId))
    );

  revalidatePath("/settings/webhooks");
  return { success: true as const };
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

  if (!webhook) return { success: false as const, error: "الويب هوك غير موجود" };

  await db
    .update(webhookEndpoints)
    .set({ sendWelcome: !webhook.sendWelcome })
    .where(
      and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.tenantId, tenantId))
    );

  revalidatePath("/settings/webhooks");
  return { success: true as const };
}

// =============================================
// تحديث قالب الترحيب الخاص بـ webhook (override)
// =============================================

/**
 * يحفظ قالب ترحيب مخصّص لهذا الـ webhook فقط.
 * تمرير string فارغ أو null = حذف الـ override (استخدم قالب tenant الافتراضي).
 *
 * مفيد لمن يدير حملات/تخصصات مختلفة بنفس الحساب — كل حملة لها رسالتها.
 */
export async function updateWebhookWelcomeTemplate(
  webhookId: string,
  templateName: string | null,
) {
  const { tenantId } = await requireOwnerOrAdmin();

  const cleaned = templateName?.trim() || null;
  if (cleaned && (cleaned.length > 255 || cleaned.length < 1)) {
    return { success: false as const, error: "اسم القالب يجب أن يكون بين 1 و 255 حرف" };
  }

  const [webhook] = await db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.tenantId, tenantId)),
    );
  if (!webhook) return { success: false as const, error: "الويب هوك غير موجود" };

  await db
    .update(webhookEndpoints)
    .set({ welcomeTemplateName: cleaned })
    .where(
      and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.tenantId, tenantId)),
    );

  revalidatePath("/settings/webhooks");
  return { success: true as const, templateName: cleaned };
}

// =============================================
// تخصيص منسقين لحملة (webhook → coordinators)
// =============================================

/**
 * يقرأ المنسقين المخوّلين برؤية leads هذه الحملة.
 * فارغ = الحملة مرئية لكل المنسقين (السلوك الافتراضي).
 */
export async function getWebhookCoordinators(webhookId: string) {
  const { tenantId } = await requireOwnerOrAdmin();

  // تحقّق ملكية webhook
  const [wh] = await db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.tenantId, tenantId)))
    .limit(1);
  if (!wh) return { success: false as const, error: "الويب هوك غير موجود" };

  return db
    .select({ userId: webhookCoordinators.userId })
    .from(webhookCoordinators)
    .where(eq(webhookCoordinators.webhookId, webhookId));
}

/**
 * يحدّد المنسقين لحملة. array فارغ = إزالة كل التخصيصات (تصبح مرئية للجميع).
 *
 * نمط replace-all (DELETE + INSERT) — الأبسط والـ idempotent.
 * الأعداد صغيرة (typically 1-10) فلا قلق على أداء.
 */
export async function setWebhookCoordinators(input: { webhookId: string; userIds: string[] }) {
  const { tenantId, userId: actorId } = await requireOwnerOrAdmin();
  const parsedResult = setWebhookCoordinatorsSchema.safeParse(input);
  if (!parsedResult.success) {
    return { success: false as const, error: "بيانات غير صالحة — تحقق من المدخلات" };
  }
  const parsed = parsedResult.data;

  // 1. تحقّق ملكية webhook
  const [wh] = await db
    .select({ id: webhookEndpoints.id, label: webhookEndpoints.label })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, parsed.webhookId), eq(webhookEndpoints.tenantId, tenantId)))
    .limit(1);
  if (!wh) return { success: false as const, error: "الويب هوك غير موجود" };

  // 2. تحقّق أن كل userIds في نفس tenant + نشطون
  if (parsed.userIds.length > 0) {
    const validUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, parsed.userIds),
          eq(users.tenantId, tenantId),
          eq(users.isActive, true),
        ),
      );
    if (validUsers.length !== parsed.userIds.length) {
      return { success: false as const, error: "بعض المنسقين غير موجودين أو معطّلون" };
    }
  }

  // 3. replace-all في transaction
  await db.transaction(async (tx) => {
    await tx
      .delete(webhookCoordinators)
      .where(eq(webhookCoordinators.webhookId, parsed.webhookId));

    if (parsed.userIds.length > 0) {
      await tx.insert(webhookCoordinators).values(
        parsed.userIds.map((uid) => ({
          webhookId: parsed.webhookId,
          userId: uid,
        })),
      );
    }

    await tx.insert(activityLog).values({
      tenantId,
      userId: actorId,
      action: "SETTINGS_UPDATED",
      entityType: "webhook_endpoint",
      entityId: parsed.webhookId,
      details: {
        change: "coordinators_set",
        webhookLabel: wh.label,
        coordinatorCount: parsed.userIds.length,
        coordinatorIds: parsed.userIds,
      },
    });
  });

  revalidatePath("/settings/webhooks");
  return { success: true as const, count: parsed.userIds.length };
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

  // تطبيع الحقول النصّية: "" → null حتى لا يحجب قالباً صالحاً عبر سلاسل ??
  // (سابقاً كان يُخزَّن اسم قالب فارغ، فيُعامَل لاحقاً كأنه "محدَّد" ويفشل الإرسال).
  const cleanStr = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);
  const phoneNumber = cleanStr(input.phoneNumber);
  const templateName = cleanStr(input.templateName);
  const reminderTemplateName = cleanStr(input.reminderTemplateName);

  // Check if config exists
  const existing = await db.query.whatsappConfigs.findFirst({
    where: eq(whatsappConfigs.tenantId, tenantId),
  });

  if (existing) {
    await db
      .update(whatsappConfigs)
      .set({
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(input.provider !== undefined && { provider: input.provider }),
        ...(templateName !== undefined && { templateName }),
        ...(input.templateLanguage !== undefined && { templateLanguage: input.templateLanguage }),
        ...(input.templateParams !== undefined && { templateParams: input.templateParams }),
        ...(reminderTemplateName !== undefined && { reminderTemplateName }),
        ...(input.reminderEvening !== undefined && { reminderEvening: input.reminderEvening }),
        ...(input.reminderMorning !== undefined && { reminderMorning: input.reminderMorning }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(whatsappConfigs.tenantId, tenantId));
  } else {
    await db.insert(whatsappConfigs).values({
      tenantId,
      phoneNumber: phoneNumber ?? null,
      provider: input.provider || "meta",
      templateName: templateName ?? null,
      templateLanguage: input.templateLanguage || "ar",
      templateParams: input.templateParams || ["customer_name"],
      reminderTemplateName: reminderTemplateName ?? null,
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
    return { success: false as const, error: "أدخل رقم هاتف للاختبار" };
  }

  const { testWhatsappConnection } = await import("@/lib/whatsapp");
  const result = await testWhatsappConnection(tenantId, testPhone.trim());

  return result;
}

// =============================================
// Per-User WhatsApp Credentials
// كل منسق يربط رقمه الخاص في Meta — يستخدمه للترحيب والتذكيرات
// =============================================

/**
 * يقرأ credentials المنسق المسجَّل دخوله (أو منسق محدّد لو OWNER/ADMIN يتفقّد).
 * لا يُرجع apiKey نفسه — فقط hasApiKey: boolean (السر لا يُكشَف للـ UI).
 */
export async function getMyWhatsappCredentials(targetUserId?: string) {
  const ctx = await requireTenant();
  // OWNER/ADMIN يستطيع تفقّد منسق آخر؛ غيرهم يقرأ نفسه فقط
  const userId = targetUserId && ["OWNER", "ADMIN"].includes(ctx.role) ? targetUserId : ctx.userId;

  const [creds] = await db
    .select({
      id: userWhatsappCredentials.id,
      userId: userWhatsappCredentials.userId,
      phoneNumberId: userWhatsappCredentials.phoneNumberId,
      templateLanguage: userWhatsappCredentials.templateLanguage,
      welcomeTemplateName: userWhatsappCredentials.welcomeTemplateName,
      reminderTemplateName: userWhatsappCredentials.reminderTemplateName,
      isActive: userWhatsappCredentials.isActive,
      lastTestedAt: userWhatsappCredentials.lastTestedAt,
      lastTestSuccess: userWhatsappCredentials.lastTestSuccess,
      apiKeyEncrypted: userWhatsappCredentials.apiKeyEncrypted, // نقرأ للحساب فقط
    })
    .from(userWhatsappCredentials)
    .where(
      and(
        eq(userWhatsappCredentials.userId, userId),
        eq(userWhatsappCredentials.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);

  if (!creds) return null;

  // ❌ لا نُرجع السر للـ UI — فقط hasApiKey للعرض
  return {
    id: creds.id,
    userId: creds.userId,
    phoneNumberId: creds.phoneNumberId,
    templateLanguage: creds.templateLanguage,
    welcomeTemplateName: creds.welcomeTemplateName,
    reminderTemplateName: creds.reminderTemplateName,
    isActive: creds.isActive,
    lastTestedAt: creds.lastTestedAt,
    lastTestSuccess: creds.lastTestSuccess,
    hasApiKey: !!creds.apiKeyEncrypted,
  };
}

/**
 * يحفظ phoneNumberId + isActive + language لـ user creds.
 * apiKey منفصل (saveMyWhatsappApiKey) لتجنّب إعادة الإرسال.
 */
export async function saveMyWhatsappCredentials(input: {
  phoneNumberId?: string;
  templateLanguage?: string;
  welcomeTemplateName?: string | null;
  reminderTemplateName?: string | null;
  isActive?: boolean;
  targetUserId?: string;
}) {
  const ctx = await requireTenant();
  const userId =
    input.targetUserId && ["OWNER", "ADMIN"].includes(ctx.role)
      ? input.targetUserId
      : ctx.userId;

  // 🔒 منع الكتابة عبر الشركات: لو نستهدف مستخدماً آخر، تأكّد أنه ضمن نفس الشركة.
  // (userId فريد عالمياً في user_whatsapp_credentials، فبدون هذا الفحص يمكن لمالك
  // شركة A الكتابة فوق بيانات مستخدم في شركة B بتمرير معرّفه.)
  if (userId !== ctx.userId) {
    await assertUserInTenant(userId, ctx.tenantId);
  }

  // تحقّق صلاحية isActive — لا تُفعّل بدون apiKey + phoneNumberId
  if (input.isActive) {
    const [existing] = await db
      .select({ apiKeyEncrypted: userWhatsappCredentials.apiKeyEncrypted, phoneNumberId: userWhatsappCredentials.phoneNumberId })
      .from(userWhatsappCredentials)
      .where(
        and(
          eq(userWhatsappCredentials.userId, userId),
          eq(userWhatsappCredentials.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    const hasKey = !!existing?.apiKeyEncrypted;
    const hasPhone = !!(input.phoneNumberId?.trim() || existing?.phoneNumberId);
    if (!hasKey || !hasPhone) {
      return { success: false as const, error: "لا يمكن التفعيل بدون Access Token + Phone Number ID" };
    }
  }

  // تحقّق طول أسماء القوالب مقدّماً — نُرجع خطأً عربياً بدل الرمي (يُخفى في الإنتاج)
  for (const v of [input.welcomeTemplateName, input.reminderTemplateName]) {
    if (v && v.trim().length > 255) {
      return { success: false as const, error: "اسم القالب طويل جداً (أقصى 255 حرف)" };
    }
  }

  // helper: trim + null لو فارغ
  const cleanTemplate = (v: string | null | undefined): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    return v.trim() || null;
  };

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (input.phoneNumberId !== undefined) update.phoneNumberId = input.phoneNumberId.trim() || null;
  if (input.templateLanguage !== undefined) update.templateLanguage = input.templateLanguage;
  const welcomeTpl = cleanTemplate(input.welcomeTemplateName);
  if (welcomeTpl !== undefined) update.welcomeTemplateName = welcomeTpl;
  const reminderTpl = cleanTemplate(input.reminderTemplateName);
  if (reminderTpl !== undefined) update.reminderTemplateName = reminderTpl;
  if (input.isActive !== undefined) update.isActive = input.isActive;

  const [existing] = await db
    .select({ id: userWhatsappCredentials.id })
    .from(userWhatsappCredentials)
    .where(
      and(
        eq(userWhatsappCredentials.userId, userId),
        eq(userWhatsappCredentials.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(userWhatsappCredentials)
      .set(update)
      .where(eq(userWhatsappCredentials.id, existing.id));
  } else {
    await db.insert(userWhatsappCredentials).values({
      userId,
      tenantId: ctx.tenantId,
      phoneNumberId: input.phoneNumberId?.trim() || null,
      templateLanguage: input.templateLanguage || "ar",
      welcomeTemplateName: welcomeTpl ?? null,
      reminderTemplateName: reminderTpl ?? null,
      isActive: input.isActive ?? false,
    });
  }

  revalidatePath("/settings/whatsapp");
  return { success: true as const };
}

/**
 * يحفظ apiKey مشفَّراً بـ AAD منفصل (whatsapp:user:{userId})
 * — منفصل عن saveMyWhatsappCredentials لتجنّب إعادة الإرسال في كل تعديل.
 */
export async function saveMyWhatsappApiKey(apiKey: string, targetUserId?: string) {
  const ctx = await requireTenant();
  const userId =
    targetUserId && ["OWNER", "ADMIN"].includes(ctx.role) ? targetUserId : ctx.userId;

  // 🔒 منع الكتابة عبر الشركات (انظر saveMyWhatsappCredentials).
  if (userId !== ctx.userId) {
    await assertUserInTenant(userId, ctx.tenantId);
  }

  const trimmed = apiKey.trim();
  if (trimmed.length < 50) {
    return { success: false as const, error: "Access Token غير صالح — يجب أن يكون 50+ حرف" };
  }

  // AAD منفصل لكل user — يربط السر بـ userId (يمنع swap بين users)
  const encryptedKey = encrypt(trimmed, `whatsapp:user:${userId}`);

  const [existing] = await db
    .select({ id: userWhatsappCredentials.id })
    .from(userWhatsappCredentials)
    .where(
      and(
        eq(userWhatsappCredentials.userId, userId),
        eq(userWhatsappCredentials.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(userWhatsappCredentials)
      .set({ apiKeyEncrypted: encryptedKey, updatedAt: new Date() })
      .where(eq(userWhatsappCredentials.id, existing.id));
  } else {
    await db.insert(userWhatsappCredentials).values({
      userId,
      tenantId: ctx.tenantId,
      apiKeyEncrypted: encryptedKey,
    });
  }

  revalidatePath("/settings/whatsapp");
  return { success: true as const };
}

/**
 * اختبر credentials المنسق بإرسال قالب لرقم تجريبي.
 * يستخدم نفس testWhatsappConnection مع testUserId.
 */
export async function testMyWhatsappCredentialsAction(input: {
  testPhone: string;
  targetUserId?: string;
}) {
  const ctx = await requireTenant();
  const userId =
    input.targetUserId && ["OWNER", "ADMIN"].includes(ctx.role)
      ? input.targetUserId
      : ctx.userId;

  if (!input.testPhone || input.testPhone.trim().length < 4) {
    return { success: false as const, error: "أدخل رقم هاتف للاختبار" };
  }

  // 🔒 rate limit — الاختبار يُرسل رسالة WhatsApp حقيقية مدفوعة لأي رقم يُدخَله
  // المستخدم. 5 محاولات/ساعة لكل مستخدم تمنع الإساءة (spam عبر creds المنشأة/المنسق).
  const rl = await rateLimit(`wa-test:${ctx.userId}`, 5, 60 * 60 * 1000);
  if (!rl.allowed) {
    return { success: false as const, error: "تجاوزت حد الاختبارات (5 في الساعة) — حاول بعد قليل" };
  }

  const { testWhatsappConnection } = await import("@/lib/whatsapp");
  return testWhatsappConnection(ctx.tenantId, input.testPhone.trim(), userId);
}

/**
 * احذف credentials المنسق (يعود لـ tenant default).
 */
export async function deleteMyWhatsappCredentials(targetUserId?: string) {
  const ctx = await requireTenant();
  const userId =
    targetUserId && ["OWNER", "ADMIN"].includes(ctx.role) ? targetUserId : ctx.userId;

  await db
    .delete(userWhatsappCredentials)
    .where(
      and(
        eq(userWhatsappCredentials.userId, userId),
        eq(userWhatsappCredentials.tenantId, ctx.tenantId),
      ),
    );

  revalidatePath("/settings/whatsapp");
  return { success: true as const };
}

/**
 * قائمة المنسقين في الـ tenant مع حالة WhatsApp لكل واحد — لـ OWNER/ADMIN.
 * تُستخدم في صفحة /team أو /settings/whatsapp لرؤية حالة الفريق ككل.
 */
export async function getTeamWhatsappStatus() {
  const { tenantId } = await requireOwnerOrAdmin();

  // join users (COORDINATORs) مع userWhatsappCredentials
  const rows = await db
    .select({
      userId: users.id,
      userName: users.name,
      userRole: users.role,
      isActive: users.isActive,
      hasCredentials: sql<boolean>`${userWhatsappCredentials.id} IS NOT NULL`,
      whatsappActive: userWhatsappCredentials.isActive,
      phoneNumberId: userWhatsappCredentials.phoneNumberId,
      lastTestedAt: userWhatsappCredentials.lastTestedAt,
      lastTestSuccess: userWhatsappCredentials.lastTestSuccess,
    })
    .from(users)
    .leftJoin(userWhatsappCredentials, eq(userWhatsappCredentials.userId, users.id))
    .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));

  return rows;
}
