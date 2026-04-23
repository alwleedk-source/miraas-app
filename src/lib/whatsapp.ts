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
import { whatsappConfigs, leads, activityLog } from "@/db/schema";
import { eq } from "drizzle-orm";
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
  leadId?: string
): Promise<SendResult> {
  // 1. جلب إعدادات الواتساب
  const config = await db.query.whatsappConfigs.findFirst({
    where: eq(whatsappConfigs.tenantId, tenantId),
  }) as WhatsAppConfig | undefined;

  if (!config || !config.isActive) {
    return { success: false, error: "واتساب غير مفعّل" };
  }

  if (!config.apiKeyEncrypted || !config.phoneNumber) {
    return { success: false, error: "إعدادات واتساب غير مكتملة — أدخل Access Token و Phone Number ID" };
  }

  if (!config.templateName) {
    return { success: false, error: "اسم القالب غير محدد — أنشئ Template في Meta وأدخل اسمه" };
  }

  // 2. فك تشفير Access Token
  let accessToken: string;
  try {
    accessToken = decrypt(config.apiKeyEncrypted, `whatsapp:${config.tenantId}`);
  } catch {
    return { success: false, error: "فشل في فك تشفير مفتاح API" };
  }

  // 3. تنسيق الرقم
  const toPhone = formatPhoneForWhatsApp(leadPhone);

  // 4. بناء Parameters
  const paramFields = config.templateParams || ["name"];
  const params = buildTemplateParams(paramFields, {
    name: leadName,
    phone: leadPhone,
  });

  // 5. إرسال عبر Meta Cloud API
  const templateLang = config.templateLanguage || "ar";
  const result = await sendTemplateViaMeta(
    accessToken, config.phoneNumber, toPhone,
    config.templateName, templateLang, params
  );

  // 6. تحديث حالة العميل + تسجيل النشاط
  if (result.success && leadId) {
    await db
      .update(leads)
      .set({ welcomeSentAt: new Date() })
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
      templateName: config.templateName,
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
 */
export async function testWhatsappConnection(
  tenantId: string,
  testPhone: string,
): Promise<SendResult> {
  const config = await db.query.whatsappConfigs.findFirst({
    where: eq(whatsappConfigs.tenantId, tenantId),
  }) as WhatsAppConfig | undefined;

  if (!config || !config.apiKeyEncrypted || !config.phoneNumber) {
    return { success: false, error: "أكمل إعدادات الربط أولاً (Access Token + Phone Number ID)" };
  }

  if (!config.templateName) {
    return { success: false, error: "أدخل اسم القالب المعتمد أولاً" };
  }

  // تحقق من رقم الاختبار — يجب أن يكون رقم هاتف صالح
  const phoneCheck = validateAndNormalizePhone(testPhone);
  if (!phoneCheck.valid || !phoneCheck.phone) {
    return {
      success: false,
      error: `رقم الاختبار غير صالح: ${phoneCheck.error || "تأكد من الصيغة"}`,
    };
  }

  let accessToken: string;
  try {
    accessToken = decrypt(config.apiKeyEncrypted, `whatsapp:${config.tenantId}`);
  } catch {
    return { success: false, error: "فشل في فك تشفير مفتاح API" };
  }

  const toPhone = phoneCheck.phone.replace("+", "");
  const templateLang = config.templateLanguage || "ar";
  const paramFields = config.templateParams || ["name"];
  const params = buildTemplateParams(paramFields, { name: "اختبار" });

  const result = await sendTemplateViaMeta(
    accessToken, config.phoneNumber, toPhone,
    config.templateName, templateLang, params
  );

  return result;
}
