import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

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
  { name: "جديد", color: "#3B82F6", position: 0, isDefault: true },
  { name: "تم التواصل", color: "#EAB308", position: 1, isDefault: false },
  { name: "مهتم", color: "#F97316", position: 2, isDefault: false },
  { name: "عرض مُرسل", color: "#8B5CF6", position: 3, isDefault: false },
  { name: "مُحوّل", color: "#22C55E", position: 4, isDefault: false },
  { name: "مغلق", color: "#6B7280", position: 5, isDefault: false },
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
 * تنسيق موحد لأرقام الهاتف — يُستخدم في كل مكان
 * - يزيل كل الرموز (مسافات، شرطات، أقواس)
 * - يحول 00966 → 966
 * - يحول +966 → 966
 * - يحول 05xxxxxxxx → 9665xxxxxxxx
 */
export function normalizePhone(raw: string): string {
  // إزالة كل غير الأرقام
  let cleaned = raw.replace(/\D/g, "");

  // إزالة 00 البادئة (صيغة دولية قديمة)
  if (cleaned.startsWith("00")) {
    cleaned = cleaned.slice(2);
  }

  // تحويل الصفر المحلي → 966 (السعودية كافتراضي)
  if (cleaned.startsWith("0") && cleaned.length >= 10) {
    cleaned = "966" + cleaned.slice(1);
  }

  return cleaned;
}
