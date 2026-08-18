/**
 * WhatsApp Template Message Sender
 * يُرسل رسائل Template معتمدة من Meta عبر Cloud API مباشرة
 * 
 * ⚠️ مهم: لإرسال رسائل لعملاء جدد (لم يراسلوك من قبل) يجب:
 * 1. إنشاء Template في Meta Business Manager
 * 2. انتظار اعتماده من Meta (عادةً دقائق)
 * 3. إدخال اسمه في إعدادات مِراس
 */

import { db } from "@/db";
import { whatsappConfigs, userWhatsappCredentials, leads, activityLog } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { decrypt } from "@/lib/encryption";
import { validateAndNormalizePhone } from "@/lib/utils";

// =============================================
// Types
// =============================================

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface WhatsAppConfig {
  provider: string | null;
  apiKeyEncrypted: string | null;
  phoneNumber: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  templateParams: string[] | null;
  isActive: boolean;
  tenantId: string;
}

/**
 * بيانات اعتماد جاهزة للإرسال — بعد decrypt
 * يُرجَع من resolveCredentialsForLead بعد تطبيق سلسلة fallback
 */
export interface ResolvedCredentials {
  /** "user" أو "tenant" — للـ logging والـ activity audit */
  source: "user" | "tenant";
  /** userId للذي ستُرسل من رقمه (null لو tenant default) */
  userId: string | null;
  accessToken: string;
  phoneNumberId: string;
  templateLanguage: string;
  /** قائمة templateParams (يبقى من tenant config — موحّد للجميع) */
  templateParams: string[];
  /**
   * أسماء قوالب خاصة بهذا المنسق (null لو يرث من tenant).
   * مفيد عندما WABA الشخصي للمنسق منفصل عن WABA الشركة — كل WABA لها قوالب
   * منفصلة في Meta، فالأسماء قد تختلف.
   */
  userWelcomeTemplate: string | null;
  userReminderTemplate: string | null;
}

// =============================================
// تنسيق الرقم لـ WhatsApp (international format)
// =============================================

/**
 * يُحوّل رقم إلى الصيغة التي يتوقعها WhatsApp Cloud API (بدون +)
 * يستخدم libphonenumber-js عبر validateAndNormalizePhone — يدعم كل دول العالم
 * @throws إذا الرقم غير صالح
 */
function formatPhoneForWhatsApp(phone: string): string {
  const result = validateAndNormalizePhone(phone);
  if (result.valid && result.phone) {
    // WhatsApp يريد "966551234567" لا "+966551234567"
    return result.phone.replace("+", "");
  }
  // fallback للأرقام غير المعروفة — نظّف بلا تخمين دولة
  return phone.replace(/\D/g, "");
}

// =============================================
// بناء Parameters من بيانات العميل
// =============================================

/**
 * نتيجة resolve مع سبب الفشل (للـ logging/UI الواضح)
 */
export type CredentialResolution =
  | { ok: true; creds: ResolvedCredentials }
  | { ok: false; reason: "coordinator_no_creds" | "no_credentials_at_all" | "decrypt_failed" };

/**
 * سلسلة الاختيار (مُحدَّثة بعد قرار "لا fallback عند وجود منسق"):
 *
 *   لو preferredUserId مُمرَّر:
 *     - له creds نشطة → استخدمها ✓
 *     - لا creds → ❌ STOP (لا fallback لـ tenant — نمنع inbox مختلط)
 *
 *   لو preferredUserId = null (lead بلا منسق):
 *     - tenant default نشط → استخدمه ✓
 *     - لا → ❌ STOP
 *
 * السبب: لو fallback لـ tenant مع وجود منسق، العميل يردّ على رقم العيادة
 * والمنسق المسؤول لا يرى الردّ → الـ lead يضيع. الأنظف: لا إرسال بدون
 * رقم منسق، يُفرَض على المنسق ربط رقمه.
 */
export async function resolveCredentialsForLead(
  tenantId: string,
  preferredUserId: string | null,
): Promise<CredentialResolution> {
  // المسار 1: lead مُسنَد لمنسق → نستخدم رقمه أو نتوقّف (لا fallback)
  if (preferredUserId) {
    const [userCreds] = await db
      .select()
      .from(userWhatsappCredentials)
      .where(
        and(
          eq(userWhatsappCredentials.userId, preferredUserId),
          eq(userWhatsappCredentials.tenantId, tenantId),
          eq(userWhatsappCredentials.isActive, true),
        ),
      )
      .limit(1);

    if (!userCreds || !userCreds.apiKeyEncrypted || !userCreds.phoneNumberId) {
      // ❌ منسق بلا credentials → نتوقّف (لا نرسل من رقم العيادة لتجنّب inbox مختلط)
      return { ok: false, reason: "coordinator_no_creds" };
    }

    try {
      const accessToken = decrypt(
        userCreds.apiKeyEncrypted,
        `whatsapp:user:${preferredUserId}`,
      );
      // templateParams من tenant config (متّسق على مستوى الـ tenant)
      const tenantConfig = await db.query.whatsappConfigs.findFirst({
        where: eq(whatsappConfigs.tenantId, tenantId),
      });
      return {
        ok: true,
        creds: {
          source: "user",
          userId: preferredUserId,
          accessToken,
          phoneNumberId: userCreds.phoneNumberId,
          templateLanguage: userCreds.templateLanguage || "ar",
          templateParams: (tenantConfig?.templateParams as string[]) || ["customer_name"],
          userWelcomeTemplate: userCreds.welcomeTemplateName?.trim() || null,
          userReminderTemplate: userCreds.reminderTemplateName?.trim() || null,
        },
      };
    } catch {
      return { ok: false, reason: "decrypt_failed" };
    }
  }

  // المسار 2: lead بلا منسق → tenant default (السلوك الأصلي للحالات اليدوية)
  const tenantConfig = await db.query.whatsappConfigs.findFirst({
    where: eq(whatsappConfigs.tenantId, tenantId),
  }) as WhatsAppConfig | undefined;

  if (
    tenantConfig &&
    tenantConfig.isActive &&
    tenantConfig.apiKeyEncrypted &&
    tenantConfig.phoneNumber
  ) {
    try {
      const accessToken = decrypt(
        tenantConfig.apiKeyEncrypted,
        `whatsapp:${tenantId}`,
      );
      return {
        ok: true,
        creds: {
          source: "tenant",
          userId: null,
          accessToken,
          phoneNumberId: tenantConfig.phoneNumber,
          templateLanguage: tenantConfig.templateLanguage || "ar",
          templateParams: (tenantConfig.templateParams as string[]) || ["customer_name"],
          userWelcomeTemplate: null,
          userReminderTemplate: null,
        },
      };
    } catch {
      return { ok: false, reason: "decrypt_failed" };
    }
  }

  return { ok: false, reason: "no_credentials_at_all" };
}

/**
 * يبني parameters بصيغة Meta الجديدة (named) — تطابق snake_case في القالب.
 * يدعم تسميات قديمة (name, phone, company) وجديدة (customer_name, ...) معاً.
 */
function buildTemplateParams(
  paramFields: string[],
  leadData: { name?: string; phone?: string; company?: string }
): Array<{ type: "text"; parameter_name: string; text: string }> {
  // map للأسماء (يدعم القديمة والجديدة) → القيمة من leadData
  const fieldMap: Record<string, string> = {
    name: leadData.name || "",
    customer_name: leadData.name || "",
    phone: leadData.phone || "",
    customer_phone: leadData.phone || "",
    company: leadData.company || "",
    company_name: leadData.company || "",
  };

  return paramFields.map((field) => ({
    type: "text" as const,
    parameter_name: field, // ← Meta named-parameters API الجديد
    text: fieldMap[field] || "",
  }));
}

// =============================================
// إرسال Template عبر Meta Cloud API
// =============================================

async function sendTemplateViaMeta(
  accessToken: string,
  phoneNumberId: string,
  toPhone: string,
  templateName: string,
  templateLanguage: string,
  params: Array<{ type: "text"; parameter_name?: string; text: string }>
): Promise<SendResult> {
  try {
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: toPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: templateLanguage },
        ...(params.length > 0 && {
          components: [
            {
              type: "body",
              parameters: params,
            },
          ],
        }),
      },
    };

    // مهلة 10ث — يمنع تعليق الطلب (الترحيب يُرسَل من webhook، والاختبار من UI) لو تأخّر Meta
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    ).finally(() => clearTimeout(timeout));

    const data = await response.json();

    if (response.ok) {
      return {
        success: true,
        messageId: data.messages?.[0]?.id,
      };
    }

    return {
      success: false,
      error: data.error?.message || "فشل في إرسال الرسالة",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "خطأ في الاتصال",
    };
  }
}

// =============================================
// الدالة الرئيسية: إرسال رسالة ترحيب (Template)
// =============================================

export async function sendWelcomeMessage(
  tenantId: string,
  leadPhone: string,
  leadName: string,
  leadId?: string,
  /**
   * اسم قالب يتجاوز الافتراضي — يأتي من webhookEndpoints.welcomeTemplateName
   * يسمح بقالب مخصّص لكل حملة/مصدر
   */
  templateNameOverride?: string | null,
  /**
   * المنسق المسؤول — رقمه سيُستخدَم بدل tenant default إذا له credentials نشطة
   * fallback chain: preferredUserId → tenant default
   */
  preferredUserId?: string | null,
): Promise<SendResult> {
  // 0. 🔒 idempotency — احجز الـ lead ذرّياً قبل الإرسال لمنع ترحيب مزدوج.
  //    الـ webhook يطلق الإرسال fire-and-forget، وتكرار تسليم Google Sheets أو
  //    سباق طلبين قد يُرسل رسالتين. UPDATE ... WHERE welcomeSentAt IS NULL ذرّي:
  //    أوّل من ينجح يحجز، والباقي يحصل على 0 صفوف فيتوقّف. عند أي فشل لاحق
  //    نُعيد welcomeSentAt إلى null ليُعاد الإرسال في محاولة قادمة.
  if (leadId) {
    const claimed = await db
      .update(leads)
      .set({ welcomeSentAt: new Date() })
      .where(and(eq(leads.id, leadId), isNull(leads.welcomeSentAt)))
      .returning({ id: leads.id });
    if (claimed.length === 0) {
      return { success: false, error: "تم إرسال الترحيب مسبقاً" };
    }
  }

  // 1. تطبيق سلسلة الاختيار (مع منسق: لا fallback)
  const resolution = await resolveCredentialsForLead(tenantId, preferredUserId ?? null);
  if (!resolution.ok) {
    // سجّل سبب الفشل صراحةً للـ UI
    const errorMsg =
      resolution.reason === "coordinator_no_creds"
        ? "المنسق المسؤول لم يربط رقم WhatsApp الخاص به — لن يُرسل ترحيب لتجنّب inbox مختلط"
        : resolution.reason === "decrypt_failed"
        ? "فشل في فك تشفير مفتاح API"
        : "لا توجد credentials نشطة — أكمل إعدادات الواتساب";

    if (leadId) {
      // أفرِج عن الحجز — فشل الحلّ ليس إرسالاً، نسمح بإعادة المحاولة لاحقاً
      await db.update(leads).set({ welcomeSentAt: null }).where(eq(leads.id, leadId));
      await db.insert(activityLog).values({
        tenantId,
        action: "WHATSAPP_FAILED",
        entityType: "lead",
        entityId: leadId,
        details: {
          to: leadPhone,
          leadName,
          reason: resolution.reason,
          preferredUserId: preferredUserId ?? undefined,
          error: errorMsg,
        },
      });
    }
    return { success: false, error: errorMsg };
  }
  const creds = resolution.creds;

  // 2. اسم القالب — أولوية:
  //    أ) webhook override (per-campaign override)
  //    ب) user welcomeTemplateName (لو منسق له WABA منفصل بقالب باسم آخر)
  //    ج) tenant default (whatsappConfigs.templateName)
  let effectiveTemplateName = templateNameOverride?.trim();
  if (!effectiveTemplateName) {
    effectiveTemplateName = creds.userWelcomeTemplate ?? undefined;
  }
  if (!effectiveTemplateName) {
    const tenantConfig = await db.query.whatsappConfigs.findFirst({
      where: eq(whatsappConfigs.tenantId, tenantId),
    });
    effectiveTemplateName = tenantConfig?.templateName ?? "";
  }
  if (!effectiveTemplateName) {
    if (leadId) {
      await db.update(leads).set({ welcomeSentAt: null }).where(eq(leads.id, leadId));
    }
    return { success: false, error: "اسم القالب غير محدد — أنشئ Template في Meta وأدخل اسمه" };
  }

  // 3. تنسيق الرقم
  const toPhone = formatPhoneForWhatsApp(leadPhone);

  // 4. بناء Parameters
  const params = buildTemplateParams(creds.templateParams, {
    name: leadName,
    phone: leadPhone,
  });

  // 5. إرسال
  const result = await sendTemplateViaMeta(
    creds.accessToken,
    creds.phoneNumberId,
    toPhone,
    effectiveTemplateName,
    creds.templateLanguage,
    params,
  );

  // 6. تحديث حالة العميل + اتّساق التذكيرات اللاحقة
  //    welcomeSentAt مضبوط مسبقاً من حجز الخطوة 0. هنا فقط:
  //    - نجاح → نخزّن من أُرسل من رقمه (التذكيرات تستخدم نفس الرقم)
  //    - فشل  → نُفرِج عن الحجز ليُعاد الإرسال في محاولة قادمة
  if (leadId) {
    if (result.success) {
      await db
        .update(leads)
        .set({ welcomeSentByUserId: creds.userId })
        .where(eq(leads.id, leadId));
    } else {
      await db.update(leads).set({ welcomeSentAt: null }).where(eq(leads.id, leadId));
    }
  }

  await db.insert(activityLog).values({
    tenantId,
    action: result.success ? "WHATSAPP_SENT" : "WHATSAPP_FAILED",
    entityType: "lead",
    entityId: leadId || undefined,
    details: {
      to: toPhone,
      leadName,
      templateName: effectiveTemplateName,
      templateOverride: templateNameOverride || undefined,
      credSource: creds.source, // "user" أو "tenant" — للتدقيق
      sentByUserId: creds.userId || undefined,
      phoneNumberId: creds.phoneNumberId,
      messageId: result.messageId,
      error: result.error,
    },
  });

  return result;
}

// =============================================
// اختبار الربط (يرسل Template اختباري لرقم محدد)
// =============================================

/**
 * يرسل Template اختباري لرقم يحدّده المالك.
 *
 * ⚠️ مهم: لا يمكن الإرسال إلى Phone Number ID — هو معرّف، ليس رقم هاتف.
 * المالك يدخل رقمه الشخصي (أو رقم تجريبي) لاستقبال الـ test.
 *
 * @param testUserId — لو مُمرَّر، يختبر credentials هذا المنسق بدل tenant default
 */
export async function testWhatsappConnection(
  tenantId: string,
  testPhone: string,
  testUserId?: string,
): Promise<SendResult> {
  // تطبيق نفس منطق resolution — لو testUserId مُمرَّر، نختبر credentials المنسق
  const resolution = await resolveCredentialsForLead(tenantId, testUserId ?? null);
  if (!resolution.ok) {
    const errorMsg =
      resolution.reason === "coordinator_no_creds"
        ? "هذا المنسق لم يربط رقم WhatsApp بعد"
        : resolution.reason === "decrypt_failed"
        ? "فشل في فك تشفير مفتاح API"
        : "أكمل إعدادات الربط أولاً (Access Token + Phone Number ID)";
    return { success: false, error: errorMsg };
  }
  const creds = resolution.creds;

  // اختيار اسم القالب:
  //   - لو نختبر منسقاً وله welcomeTemplateName → نستخدمه (يعكس الواقع الفعلي للإرسال)
  //   - وإلا tenant default
  const tenantConfig = await db.query.whatsappConfigs.findFirst({
    where: eq(whatsappConfigs.tenantId, tenantId),
  });
  const effectiveTemplateName = creds.userWelcomeTemplate ?? tenantConfig?.templateName ?? "";
  if (!effectiveTemplateName) {
    return {
      success: false,
      error:
        creds.source === "user"
          ? "أدخل اسم قالب الترحيب في إعداداتك (أو اسم القالب على مستوى المنشأة)"
          : "أدخل اسم القالب المعتمد أولاً",
    };
  }

  const phoneCheck = validateAndNormalizePhone(testPhone);
  if (!phoneCheck.valid || !phoneCheck.phone) {
    return {
      success: false,
      error: `رقم الاختبار غير صالح: ${phoneCheck.error || "تأكد من الصيغة"}`,
    };
  }

  const toPhone = phoneCheck.phone.replace("+", "");
  const params = buildTemplateParams(creds.templateParams, { name: "اختبار" });

  const result = await sendTemplateViaMeta(
    creds.accessToken,
    creds.phoneNumberId,
    toPhone,
    effectiveTemplateName,
    creds.templateLanguage,
    params,
  );

  // تحديث last_tested_at للـ user credentials لو الاختبار من رقم منسق
  if (testUserId && creds.source === "user") {
    await db
      .update(userWhatsappCredentials)
      .set({
        lastTestedAt: new Date(),
        lastTestSuccess: result.success,
      })
      .where(eq(userWhatsappCredentials.userId, testUserId));
  }

  return result;
}
