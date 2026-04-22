/**
 * Handoff helper — يحوّل بيانات booking إلى نص جاهز للرسبشن
 *
 * يُستخدم في:
 *   - زر "نسخ للرسبشن" (clipboard)
 *   - زر "أرسل عبر واتساب للرسبشن" (wa.me link)
 */

import { toWhatsappUrl } from "./utils";

export type BookingHandoff = {
  leadName: string;
  phone: string | null;
  service: string | null;
  bookingDate: Date | string | null;
  notes: string | null;
  coordinatorName?: string | null;
  campaignName?: string | null;
  departmentName?: string | null;
};

/**
 * يبني نص multiline منظّم بصريّاً للنسخ أو الإرسال.
 *
 * مثال:
 *   📋 طلب حجز — مِراس
 *   ─────────────────
 *   👤 أحمد محمد
 *   📱 0551234567
 *   🏷️ تنظيف أسنان
 *   📅 الأحد، 27 ربيع الآخر، 3:00 عصراً
 *   👩 المنسقة: أحلام
 *   📢 الحملة: Instagram عيادة الجلد
 *   ─────────────────
 *   💬 ملاحظات:
 *   العميل يفضّل بعد العصر
 */
export function formatBookingForReceptionist(b: BookingHandoff): string {
  const lines: string[] = [];

  lines.push("📋 طلب حجز — مِراس");
  lines.push("─────────────────");

  lines.push(`👤 ${b.leadName}`);

  if (b.phone) {
    lines.push(`📱 ${b.phone}`);
  }

  if (b.departmentName) {
    lines.push(`🏥 القسم: ${b.departmentName}`);
  }

  if (b.service) {
    lines.push(`🏷️ ${b.service}`);
  }

  if (b.bookingDate) {
    const d = new Date(b.bookingDate);
    if (!isNaN(d.getTime())) {
      const formatted = d.toLocaleString("ar-SA", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Riyadh",
      });
      lines.push(`📅 ${formatted}`);
    }
  }

  if (b.coordinatorName) {
    lines.push(`👩 المنسقة: ${b.coordinatorName}`);
  }

  if (b.campaignName) {
    lines.push(`📢 الحملة: ${b.campaignName}`);
  }

  if (b.notes && b.notes.trim()) {
    lines.push("─────────────────");
    lines.push("💬 ملاحظات:");
    lines.push(b.notes.trim());
  }

  return lines.join("\n");
}

/**
 * يبني نص جدول اليوم كاملاً للرسبشن — مرتّبة بالوقت.
 *
 * مثال:
 *   ☀️ جدول اليوم — مِراس
 *   ─────────────────
 *   🕐 9:00 ص — أحمد محمد
 *      📱 0551234567
 *      🏷️ تنظيف أسنان
 *
 *   🕐 11:30 ص — فاطمة علي
 *      📱 0507654321
 *      🏷️ كشف عام
 *      💬 يفضّل بعد العصر
 *   ─────────────────
 *   📊 الإجمالي: 2 موعد
 */
export function formatDayScheduleForReceptionist(
  bookings: BookingHandoff[],
  options?: { dayLabel?: string }
): string {
  if (bookings.length === 0) return "📅 لا توجد مواعيد";

  const dayLabel = options?.dayLabel ?? "اليوم";
  const lines: string[] = [];

  lines.push(`☀️ جدول ${dayLabel} — مِراس`);
  lines.push("─────────────────");

  // ترتيب حسب الوقت
  const sorted = [...bookings].sort((a, b) => {
    const ta = a.bookingDate ? new Date(a.bookingDate).getTime() : 0;
    const tb = b.bookingDate ? new Date(b.bookingDate).getTime() : 0;
    return ta - tb;
  });

  for (const b of sorted) {
    const time = b.bookingDate
      ? new Date(b.bookingDate).toLocaleTimeString("ar-SA", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Riyadh",
        })
      : "--:--";

    lines.push(`🕐 ${time} — ${b.leadName}`);
    if (b.phone) lines.push(`   📱 ${b.phone}`);
    if (b.departmentName) lines.push(`   🏥 ${b.departmentName}`);
    if (b.service) lines.push(`   🏷️ ${b.service}`);
    if (b.notes && b.notes.trim()) lines.push(`   💬 ${b.notes.trim()}`);
    lines.push(""); // فاصل بين المواعيد
  }

  // إزالة آخر سطر فارغ
  while (lines[lines.length - 1] === "") lines.pop();

  lines.push("─────────────────");
  lines.push(`📊 الإجمالي: ${bookings.length} موعد`);

  return lines.join("\n");
}

/**
 * يبني wa.me URL مع النص prefilled لإرساله للرسبشن.
 * @param receptionistPhone — رقم الرسبشن المحفوظ في tenant settings
 * @param text — النص المُولَّد من formatBookingForReceptionist
 */
export function buildReceptionistWhatsAppUrl(
  receptionistPhone: string,
  text: string,
): string | null {
  const baseUrl = toWhatsappUrl(receptionistPhone);
  if (!baseUrl) return null;
  // wa.me يدعم ?text= للمحادثة الجديدة
  return `${baseUrl}?text=${encodeURIComponent(text)}`;
}

/**
 * نسخ نص إلى clipboard مع fallback للمتصفحات القديمة.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  // fallback: textarea + execCommand (deprecated لكن يعمل في contexts بدون https)
  if (typeof document !== "undefined") {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}
