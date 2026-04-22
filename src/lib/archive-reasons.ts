/**
 * أسباب أرشفة العميل — مرتّبة بالأكثر شيوعاً
 *
 * مهم: نخزن المفتاح في DB (PRICE)، ونعرض label العربية في الـ UI.
 * هذا يسمح بإحصائيات مجمّعة + ترجمة مستقبلية.
 */

export const ARCHIVE_REASONS = {
  PRICE: {
    label: "رفض السعر",
    icon: "💰",
    canRevive: true,
    description: "العميل اعتبر السعر مرتفعاً — قابل للعودة لو نزلنا/قسّطنا",
  },
  NO_RESPONSE: {
    label: "بلا رد بعد محاولات متعددة",
    icon: "📵",
    canRevive: true,
    description: "اتصلنا 3+ مرات بلا رد — قابل للعودة بعد فترة",
  },
  COMPETITOR: {
    label: "اختار منافساً آخر",
    icon: "🤝",
    canRevive: true,
    description: "ذهب لعيادة أخرى — قابل للعودة لو خاب أمله هناك",
  },
  BAD_TIMING: {
    label: "ليس الوقت المناسب",
    icon: "⏰",
    canRevive: true,
    description: "مهتم لكن مشغول/مسافر — حدّد موعد إعادة تذكير",
  },
  NOT_INTERESTED: {
    label: "غير مهتم بالخدمة",
    icon: "❌",
    canRevive: false,
    description: "لا يحتاج هذه الخدمة فعلاً — احتمال عودة منخفض",
  },
  WRONG_NUMBER: {
    label: "رقم خاطئ",
    icon: "📞",
    canRevive: false,
    description: "الرقم لشخص آخر / وهمي — لا متابعة ممكنة",
  },
  DO_NOT_CONTACT: {
    label: "طلب عدم التواصل",
    icon: "🚫",
    canRevive: false,
    description: "العميل طلب صراحة عدم التواصل — احترم القرار",
  },
  OTHER: {
    label: "سبب آخر",
    icon: "📝",
    canRevive: true,
    description: "اكتب السبب في الملاحظة",
  },
} as const;

export type ArchiveReasonKey = keyof typeof ARCHIVE_REASONS;

export const ARCHIVE_REASON_KEYS = Object.keys(ARCHIVE_REASONS) as ArchiveReasonKey[];

export function isValidArchiveReason(key: string): key is ArchiveReasonKey {
  return key in ARCHIVE_REASONS;
}

export function getArchiveReasonLabel(key: string | null): string {
  if (!key || !isValidArchiveReason(key)) return "غير محدد";
  return ARCHIVE_REASONS[key].label;
}

export function getArchiveReasonIcon(key: string | null): string {
  if (!key || !isValidArchiveReason(key)) return "📦";
  return ARCHIVE_REASONS[key].icon;
}
