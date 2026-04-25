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
import { eq, and } from "drizzle-orm";
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
 * سلسلة fallback لاختيار credentials المناسبة لـ lead:
 *   1. لو preferredUserId مُمرَّر + له creds نشطة → استخدمها
 *   2. لو tenant default نشط → استخدمه
 *   3. null → لا credentials متاحة (نُسجّل خطأ ولا نرسل)
 *
 * يُرجَع credentials بعد decrypt جاهزة للإرسال + معلومات للـ audit log.
 *
 * @param tenantId — للـ scoping
 * @param preferredUserId — منسق محدّد نريد استخدام رقمه (assignedTo أو welcomeSentByUserId)
 */
export async function resolveCredentialsForLead(
  tenantId: string,
  preferredUserId: string | null,
): Promise<ResolvedCredentials | null> {
  // 1. محاولة credentials المنسق المفضّل
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

    if (userCreds && userCreds.apiKeyEncrypted && userCreds.phoneNumberId) {
      try {
        const accessToken = decrypt(
          userCreds.apiKeyEncrypted,
          `whatsapp:user:${preferredUserId}`,
        );
        // templateParams يبقى من tenant config (متّسق على مستوى الـ tenant)
        const tenantConfig = await db.query.whatsappConfigs.findFirst({
          where: eq(whatsappConfigs.tenantId, tenantId),
        });
        return {
          source: "user",
          userId: preferredUserId,
          accessToken,
          phoneNumberId: userCreds.phoneNumberId,
          templateLanguage: userCreds.templateLanguage || "ar",
          templateParams: (tenantConfig?.templateParams as string[]) || ["customer_name"],
        };
      } catch {
        // فشل decrypt → fallback للـ tenant
      }
    }
  }

  // 2. fallback لـ tenant default
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
        source: "tenant",
        userId: null,
        accessToken,
        phoneNumberId: tenantConfig.phoneNumber,
        templateLanguage: tenantConfig.templateLanguage || "ar",
        templateParams: (tenantConfig.templateParams as string[]) || ["customer_name"],
      };
    } catch {
      return null;
    }
  }

  return null;
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

    const response = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

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
  // 1. تطبيق سلسلة fallback (user creds → tenant default)
  const creds = await resolveCredentialsForLead(tenantId, preferredUserId ?? null);
  if (!creds) {
    return { success: false, error: "لا توجد credentials نشطة — أكمل إعدادات الواتساب" };
  }

  // 2. اسم القالب — webhook override أولاً، ثم tenant default
  // (templateName يبقى على tenant config — نقرأه إذا لم يُمرَّر override)
  let effectiveTemplateName = templateNameOverride?.trim();
  if (!effectiveTemplateName) {
    const tenantConfig = await db.query.whatsappConfigs.findFirst({
      where: eq(whatsappConfigs.tenantId, tenantId),
    });
    effectiveTemplateName = tenantConfig?.templateName ?? "";
  }
  if (!effectiveTemplateName) {
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
  if (result.success && leadId) {
    await db
      .update(leads)
      .set({
        welcomeSentAt: new Date(),
        // نخزّن أيّ منسق أُرسل من رقمه — التذكيرات اللاحقة ستستخدم نفس الرقم
        welcomeSentByUserId: creds.userId,
      })
      .where(eq(leads.id, leadId));
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
  // تطبيق نفس fallback chain — لو testUserId مُمرَّر، نختبر credentials المنسق
  const creds = await resolveCredentialsForLead(tenantId, testUserId ?? null);
  if (!creds) {
    return { success: false, error: "أكمل إعدادات الربط أولاً (Access Token + Phone Number ID)" };
  }

  // اسم القالب يبقى من tenant config
  const tenantConfig = await db.query.whatsappConfigs.findFirst({
    where: eq(whatsappConfigs.tenantId, tenantId),
  });
  if (!tenantConfig?.templateName) {
    return { success: false, error: "أدخل اسم القالب المعتمد أولاً" };
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
    tenantConfig.templateName,
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
