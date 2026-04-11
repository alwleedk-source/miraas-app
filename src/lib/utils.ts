import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);
}

export function generateSecretKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 48; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function formatDate(date: Date | string): string {
  const d = new Date(date);
  return new Intl.DateTimeFormat("ar-SA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "الآن";
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  if (diffDays < 7) return `منذ ${diffDays} يوم`;
  return formatDate(date);
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();
}

export const PIPELINE_STAGE_DEFAULTS = [
  { name: "جديد", color: "#3B82F6", position: 0, isDefault: true, isBooking: false },
  { name: "تم التواصل", color: "#EAB308", position: 1, isDefault: false, isBooking: false },
  { name: "مهتم", color: "#F97316", position: 2, isDefault: false, isBooking: false },
  { name: "عرض مُرسل", color: "#8B5CF6", position: 3, isDefault: false, isBooking: false },
  { name: "مُحوّل", color: "#22C55E", position: 4, isDefault: false, isBooking: false },
  { name: "حجز", color: "#6D28D9", position: 5, isDefault: false, isBooking: true },
  { name: "مغلق", color: "#6B7280", position: 6, isDefault: false, isBooking: false },
] as const;

export const BOOKING_STATUS_LABELS: Record<string, string> = {
  PENDING: "بانتظار الموعد",
  COMPLETED: "حضر — تم الإجراء",
  ATTENDED_NOT_SUITABLE: "حضر — لم يناسبه",
  CANCELLED: "ألغى الموعد",
  NO_RESPONSE: "لم يرد",
  POSTPONED: "أجّل",
};

export const BOOKING_STATUS_COLORS: Record<string, string> = {
  PENDING: "#EAB308",
  COMPLETED: "#22C55E",
  ATTENDED_NOT_SUITABLE: "#F97316",
  CANCELLED: "#6B7280",
  NO_RESPONSE: "#EF4444",
  POSTPONED: "#3B82F6",
};

export const BOOKING_STATUS_ICONS: Record<string, string> = {
  PENDING: "⏳",
  COMPLETED: "✅",
  ATTENDED_NOT_SUITABLE: "😕",
  CANCELLED: "🚫",
  NO_RESPONSE: "📵",
  POSTPONED: "🔄",
};

export const BOOKING_STATUSES = [
  "PENDING",
  "COMPLETED",
  "ATTENDED_NOT_SUITABLE",
  "CANCELLED",
  "NO_RESPONSE",
  "POSTPONED",
] as const;


export const FOLLOW_UP_TYPE_LABELS: Record<string, string> = {
  CALL: "مكالمة",
  MESSAGE: "رسالة",
  MEETING: "اجتماع",
  EMAIL: "بريد إلكتروني",
  WHATSAPP: "واتساب",
  NOTE: "ملاحظة",
};

export const FOLLOW_UP_TYPE_ICONS: Record<string, string> = {
  CALL: "📞",
  MESSAGE: "💬",
  MEETING: "🤝",
  EMAIL: "📧",
  WHATSAPP: "📱",
  NOTE: "📝",
};

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: "منخفضة",
  MEDIUM: "متوسطة",
  HIGH: "عالية",
  URGENT: "عاجلة",
};

export const PRIORITY_COLORS: Record<string, string> = {
  LOW: "#6B7280",
  MEDIUM: "#3B82F6",
  HIGH: "#F97316",
  URGENT: "#EF4444",
};

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "مدير المنصة",
  OWNER: "مالك الشركة",
  ADMIN: "مدير",
  COORDINATOR: "منسق",
};

/**
 * نتيجة التحقق من رقم الهاتف
 */
export type PhoneValidationResult = {
  /** هل الرقم صالح؟ */
  valid: boolean;
  /** الرقم بصيغة E.164 (مثال: +966551234567) — null إذا غير صالح */
  phone: string | null;
  /** رمز الدولة (مثال: SA) — null إذا غير صالح */
  country: string | null;
  /** سبب الرفض — null إذا صالح */
  error: string | null;
};

/**
 * تحقق من رقم الهاتف ونسّقه لصيغة E.164 الدولية
 * يدعم جميع دول العالم — الدولة الافتراضية السعودية
 *
 * أمثلة:
 *   validateAndNormalizePhone("0551234567")       → { valid: true, phone: "+966551234567", country: "SA" }
 *   validateAndNormalizePhone("+971501234567")     → { valid: true, phone: "+971501234567", country: "AE" }
 *   validateAndNormalizePhone("1234")              → { valid: false, error: "رقم غير مكتمل" }
 *   validateAndNormalizePhone("00966551234567")    → { valid: true, phone: "+966551234567", country: "SA" }
 */
export function validateAndNormalizePhone(
  raw: string,
  defaultCountry: CountryCode = "SA"
): PhoneValidationResult {
  if (!raw || !raw.trim()) {
    return { valid: false, phone: null, country: null, error: "لا يوجد رقم" };
  }

  // تنظيف أولي — إزالة المسافات والشرطات والأقواس
  let cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, "");

  // 🔤 تحويل الأرقام العربية/الفارسية إلى إنجليزية
  cleaned = cleaned
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString())
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d).toString());

  // تحويل 00 البادئة إلى + (صيغة دولية قديمة)
  if (cleaned.startsWith("00") && cleaned.length > 6) {
    cleaned = "+" + cleaned.slice(2);
  }

  // إذا يبدأ بمفتاح دولي بدون + (مثل 966551234567)
  // نضيف + فقط إذا كان يبدو كمفتاح دولي معروف
  if (!cleaned.startsWith("+") && /^\d+$/.test(cleaned)) {
    // أرقام بدون صفر أول وطول دولي (11+ أرقام) → نجرب مع +
    if (cleaned.length >= 11 && !cleaned.startsWith("0")) {
      const withPlus = parsePhoneNumberFromString("+" + cleaned);
      if (withPlus && withPlus.isValid()) {
        return {
          valid: true,
          phone: withPlus.format("E.164"),
          country: withPlus.country || null,
          error: null,
        };
      }
    }
  }

  // إضافة + إذا غير موجودة ويبدأ بمفتاح دولي
  if (!cleaned.startsWith("+")) {
    // نجرب تحليلها مع الدولة الافتراضية
    const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
    if (parsed && parsed.isValid()) {
      return {
        valid: true,
        phone: parsed.format("E.164"),
        country: parsed.country || null,
        error: null,
      };
    }
  } else {
    // يبدأ بـ + — تحليل دولي مباشر
    const parsed = parsePhoneNumberFromString(cleaned);
    if (parsed && parsed.isValid()) {
      return {
        valid: true,
        phone: parsed.format("E.164"),
        country: parsed.country || null,
        error: null,
      };
    }
  }

  // 🔄 محاولة ذكية: أرقام سعودية بدون الصفر الأول
  // مثال: 501234569 (9 أرقام) → 0501234569 → +966501234569
  // مثال: 5678765456 (10 أرقام تبدأ بـ56) → 05678765456 خطأ، نجرب كـ 0567876545
  const digitsOnly = cleaned.replace(/\D/g, "");

  // 9 أرقام تبدأ بـ 5 → إضافة 0
  if (digitsOnly.length === 9 && digitsOnly.startsWith("5")) {
    const withZero = parsePhoneNumberFromString("0" + digitsOnly, defaultCountry);
    if (withZero && withZero.isValid()) {
      return {
        valid: true,
        phone: withZero.format("E.164"),
        country: withZero.country || null,
        error: null,
      };
    }
  }

  // 10 أرقام تبدأ بـ 05 → رقم سعودي بالصفر
  if (digitsOnly.length === 10 && digitsOnly.startsWith("05")) {
    const parsed = parsePhoneNumberFromString(digitsOnly, defaultCountry);
    if (parsed && parsed.isValid()) {
      return {
        valid: true,
        phone: parsed.format("E.164"),
        country: parsed.country || null,
        error: null,
      };
    }
  }

  // 10 أرقام تبدأ بـ 5 (بدون 0) → نجرب كسعودي مع +966
  if (digitsOnly.length === 10 && digitsOnly.startsWith("5")) {
    const withCode = parsePhoneNumberFromString("+966" + digitsOnly.slice(0, 9));
    if (withCode && withCode.isValid()) {
      return {
        valid: true,
        phone: withCode.format("E.164"),
        country: withCode.country || null,
        error: null,
      };
    }
  }

  // 🔄 محاولة أخيرة: نجرب مع مفاتيح الدول الشائعة
  // (للأرقام مثل 774444400 التي قد تكون يمنية +967)
  if (digitsOnly.length >= 7 && digitsOnly.length <= 12) {
    const commonCodes = ["966", "971", "974", "973", "968", "965", "967", "962", "964"];
    for (const code of commonCodes) {
      const attempt = parsePhoneNumberFromString("+" + code + digitsOnly);
      if (attempt && attempt.isValid()) {
        return {
          valid: true,
          phone: attempt.format("E.164"),
          country: attempt.country || null,
          error: null,
        };
      }
    }
  }

  // فشل كل المحاولات — نحدد سبب الرفض
  if (digitsOnly.length < 4) {
    return { valid: false, phone: null, country: null, error: "رقم غير مكتمل" };
  }
  if (digitsOnly.length > 15) {
    return { valid: false, phone: null, country: null, error: "رقم طويل جداً" };
  }
  if (/^(\d)\1+$/.test(digitsOnly)) {
    return { valid: false, phone: null, country: null, error: "رقم مكرر/وهمي" };
  }

  return { valid: false, phone: null, country: null, error: "رقم غير صالح" };
}

/**
 * تنسيق موحد لأرقام الهاتف — للتوافق مع الكود الحالي
 * يُرجع الرقم بصيغة E.164 إذا صالح، أو الرقم المنظّف إذا فشل التحقق
 */
export function normalizePhone(raw: string): string {
  const result = validateAndNormalizePhone(raw);
  if (result.valid && result.phone) {
    return result.phone;
  }
  // fallback: إزالة كل غير الأرقام
  return raw.replace(/\D/g, "");
}
