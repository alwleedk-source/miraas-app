/**
 * كاشف ذكي لأعمدة الاسم والرقم في ملفات Excel/CSV
 *
 * استراتيجية متعددة الطبقات (تتوقف عند أول نجاح):
 *   1. تطابق العناوين (Headers) — كلمات مفتاحية عربية + إنجليزية
 *   2. تحليل المحتوى — إحصاء كثافة الأرقام/الحروف في كل عمود
 *   3. fallback — العمود 0 للاسم، العمود 1 للرقم
 *
 * يُرجع confidence score (0-100) ليعرف المستخدم مدى ثقة الكشف.
 */

import { validateAndNormalizePhone } from "./utils";

export type ColumnDetection = {
  /** فهرس عمود الاسم (-1 إذا لم يُكتَشف) */
  nameCol: number;
  /** فهرس عمود الرقم (-1 إذا لم يُكتَشف) */
  phoneCol: number;
  /** درجة الثقة 0-100 */
  confidence: number;
  /** وصف الطريقة التي نجحت ("headers" أو "content" أو "fallback") */
  method: "headers" | "content" | "fallback";
};

// كلمات مفتاحية للعناوين — موزَّعة في 3 مجموعات حسب القوة
const NAME_KEYWORDS_STRONG = [
  "الاسم", "اسم العميل", "الاسم الكامل",
  "full name", "fullname", "customer name", "client name",
];
const NAME_KEYWORDS_WEAK = [
  "اسم", "name", "customer", "client", "lead",
];

const PHONE_KEYWORDS_STRONG = [
  "رقم الجوال", "رقم الهاتف", "الجوال", "الهاتف",
  "mobile number", "phone number", "whatsapp number",
];
const PHONE_KEYWORDS_WEAK = [
  "رقم", "هاتف", "جوال", "موبايل",
  "phone", "mobile", "tel", "whatsapp", "wa",
];

/** يبحث عن أول عمود يطابق كلمة مفتاحية — strong tier ثم weak */
function matchHeader(
  headers: string[],
  strongKeywords: string[],
  weakKeywords: string[],
): { col: number; tier: "strong" | "weak" | "none" } {
  const lower = headers.map((h) => String(h).toLowerCase().trim());
  // strong match أولاً (يطابق كاملاً أو يبدأ بـ)
  for (let i = 0; i < lower.length; i++) {
    for (const kw of strongKeywords) {
      if (lower[i] === kw || lower[i].startsWith(kw)) {
        return { col: i, tier: "strong" };
      }
    }
  }
  // weak match (يحتوي على الكلمة)
  for (let i = 0; i < lower.length; i++) {
    for (const kw of weakKeywords) {
      if (lower[i].includes(kw)) {
        return { col: i, tier: "weak" };
      }
    }
  }
  return { col: -1, tier: "none" };
}

/** يحلّل عموداً ويُرجع نسبة الصفوف التي تبدو كأرقام هواتف صالحة (0-1) */
function phoneScoreForColumn(rows: unknown[][], colIndex: number, sampleSize = 20): number {
  const sample = rows.slice(0, sampleSize);
  if (sample.length === 0) return 0;
  let validCount = 0;
  let nonEmpty = 0;
  for (const row of sample) {
    const cell = String(row[colIndex] ?? "").trim();
    if (!cell) continue;
    nonEmpty++;
    const r = validateAndNormalizePhone(cell);
    if (r.valid) validCount++;
  }
  if (nonEmpty === 0) return 0;
  return validCount / nonEmpty;
}

/** يحلّل عموداً ويُرجع نسبة الصفوف التي تبدو كأسماء (حروف، 2-100 chars) */
function nameScoreForColumn(rows: unknown[][], colIndex: number, sampleSize = 20): number {
  const sample = rows.slice(0, sampleSize);
  if (sample.length === 0) return 0;
  let nameLike = 0;
  let nonEmpty = 0;
  for (const row of sample) {
    const cell = String(row[colIndex] ?? "").trim();
    if (!cell) continue;
    nonEmpty++;
    // اسم: 2-100 حرف، يحتوي على حروف (عربي أو لاتيني)، ليس فقط أرقام
    const hasLetters = /[a-zA-Z؀-ۿ]/.test(cell);
    const reasonableLength = cell.length >= 2 && cell.length <= 100;
    const notMostlyDigits = (cell.match(/\d/g)?.length ?? 0) / cell.length < 0.5;
    if (hasLetters && reasonableLength && notMostlyDigits) {
      nameLike++;
    }
  }
  if (nonEmpty === 0) return 0;
  return nameLike / nonEmpty;
}

/**
 * الكاشف الرئيسي — يُحاول 3 طبقات
 */
export function detectColumns(
  headers: string[],
  rows: unknown[][],
): ColumnDetection {
  // ==========
  // الطبقة 1: تطابق العناوين
  // ==========
  const nameHeaderMatch = matchHeader(headers, NAME_KEYWORDS_STRONG, NAME_KEYWORDS_WEAK);
  const phoneHeaderMatch = matchHeader(headers, PHONE_KEYWORDS_STRONG, PHONE_KEYWORDS_WEAK);

  if (nameHeaderMatch.col >= 0 && phoneHeaderMatch.col >= 0 && nameHeaderMatch.col !== phoneHeaderMatch.col) {
    const confidence =
      nameHeaderMatch.tier === "strong" && phoneHeaderMatch.tier === "strong"
        ? 95
        : nameHeaderMatch.tier === "strong" || phoneHeaderMatch.tier === "strong"
        ? 85
        : 75;
    return {
      nameCol: nameHeaderMatch.col,
      phoneCol: phoneHeaderMatch.col,
      confidence,
      method: "headers",
    };
  }

  // ==========
  // الطبقة 2: تحليل المحتوى
  // ==========
  // احسب درجة كل عمود
  const colCount = headers.length;
  const phoneScores = Array.from({ length: colCount }, (_, i) => phoneScoreForColumn(rows, i));
  const nameScores = Array.from({ length: colCount }, (_, i) => nameScoreForColumn(rows, i));

  // أعلى درجة هاتف (≥0.6 = ثقة كافية)
  let bestPhoneCol = -1;
  let bestPhoneScore = 0.6;
  for (let i = 0; i < colCount; i++) {
    if (phoneScores[i] > bestPhoneScore) {
      bestPhoneScore = phoneScores[i];
      bestPhoneCol = i;
    }
  }
  // أعلى درجة اسم (لا يكون نفس عمود الرقم)
  let bestNameCol = -1;
  let bestNameScore = 0.6;
  for (let i = 0; i < colCount; i++) {
    if (i === bestPhoneCol) continue;
    if (nameScores[i] > bestNameScore) {
      bestNameScore = nameScores[i];
      bestNameCol = i;
    }
  }

  if (bestNameCol >= 0 && bestPhoneCol >= 0) {
    // ثقة المحتوى مبنية على متوسط الـ scores (60-95)
    const avgScore = (bestPhoneScore + bestNameScore) / 2;
    const confidence = Math.min(95, Math.round(avgScore * 100));
    // إذا تطابق header weak مع content match قويه نرفع الثقة
    const headerBoost =
      (nameHeaderMatch.col === bestNameCol || phoneHeaderMatch.col === bestPhoneCol) ? 5 : 0;
    return {
      nameCol: bestNameCol,
      phoneCol: bestPhoneCol,
      confidence: Math.min(95, confidence + headerBoost),
      method: "content",
    };
  }

  // ==========
  // الطبقة 3: fallback (نُفضّل header weak match لو موجود)
  // ==========
  const fallbackName = nameHeaderMatch.col >= 0 ? nameHeaderMatch.col : 0;
  const fallbackPhone = phoneHeaderMatch.col >= 0 ? phoneHeaderMatch.col : (fallbackName === 1 ? 2 : 1);
  return {
    nameCol: fallbackName,
    phoneCol: fallbackPhone,
    confidence: 30,
    method: "fallback",
  };
}
