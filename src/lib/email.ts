/**
 * Email via Resend — مجاني حتى 3000 إيميل/شهر
 *
 * التفعيل:
 *   1. أنشئ حساب على resend.com (مجاناً)
 *   2. أضف RESEND_API_KEY + EMAIL_FROM إلى env
 *   3. إذا الـ env غير مُعرّف، الدالة تطبع warning فقط (dev-friendly)
 */

import { Resend } from "resend";
import { logger } from "@/lib/logger";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM || "noreply@example.com";
const resend = apiKey ? new Resend(apiKey) : null;

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) {
    logger.warn("sendEmail called but RESEND_API_KEY not set", { to: args.to, subject: args.subject });
    return { ok: false, error: "email not configured" };
  }
  try {
    const { error } = await resend.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    if (error) {
      logger.error("resend send failed", error, { to: args.to });
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    logger.error("resend exception", e, { to: args.to });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function sendVerificationEmail(to: string, link: string) {
  return sendEmail({
    to,
    subject: "تأكيد بريدك الإلكتروني — مِراس",
    html: `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<body style="font-family: -apple-system, sans-serif; padding: 24px; background: #f5f5f5;">
  <div style="max-width: 480px; margin: 0 auto; background: white; padding: 32px; border-radius: 16px;">
    <h1 style="color: #1e293b;">مرحباً بك في مِراس 👋</h1>
    <p style="color: #475569; line-height: 1.8;">
      لإكمال تسجيلك، اضغط على الرابط التالي لتأكيد بريدك الإلكتروني:
    </p>
    <a href="${link}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; margin: 16px 0;">
      تأكيد البريد
    </a>
    <p style="color: #94a3b8; font-size: 12px;">
      إذا لم تُسجّل في مِراس، يمكنك تجاهل هذا البريد.
    </p>
  </div>
</body>
</html>`,
    text: `مرحباً بك في مِراس. لتأكيد بريدك، افتح: ${link}`,
  });
}

export async function sendPasswordResetEmail(to: string, link: string) {
  return sendEmail({
    to,
    subject: "إعادة تعيين كلمة المرور — مِراس",
    html: `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<body style="font-family: -apple-system, sans-serif; padding: 24px; background: #f5f5f5;">
  <div style="max-width: 480px; margin: 0 auto; background: white; padding: 32px; border-radius: 16px;">
    <h1 style="color: #1e293b;">إعادة تعيين كلمة المرور</h1>
    <p style="color: #475569; line-height: 1.8;">
      طلبت إعادة تعيين كلمة المرور. اضغط الرابط التالي (صالح لمدة ساعة):
    </p>
    <a href="${link}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; margin: 16px 0;">
      تعيين كلمة مرور جديدة
    </a>
    <p style="color: #94a3b8; font-size: 12px;">
      إذا لم تطلب هذا، تجاهل البريد وكلمة المرور الحالية تبقى آمنة.
    </p>
  </div>
</body>
</html>`,
    text: `رابط إعادة التعيين: ${link}`,
  });
}

export const isEmailConfigured = !!apiKey;
