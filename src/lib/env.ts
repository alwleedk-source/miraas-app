/**
 * Environment validation — fail-fast عند startup
 *
 * يتأكّد أن كل الأسرار الحرجة موجودة وقوية **قبل** بدء التطبيق.
 * يتسامح مع المسافات + علامات التنصيص (Coolify يحفظ بعض القيم بـ quotes).
 */

/** ينظّف القيم من المسافات الطرفية + الـ quotes المحيطة فقط — لا نلمس المسافات الداخلية (كلمات مرور DB قد تحوي مسافات) */
function sanitize(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  return raw
    .trim()
    .replace(/^["']|["']$/g, ""); // strip surrounding quotes
}

type EnvCheck = {
  name: string;
  value: string | undefined;
  requiredInProd: boolean;
  minLength?: number;
  validator?: (v: string) => string | null;
};

const CHECKS: EnvCheck[] = [
  {
    name: "DATABASE_URL",
    value: sanitize(process.env.DATABASE_URL),
    requiredInProd: true,
    minLength: 20,
    validator: (v) => {
      if (!v.startsWith("postgres://") && !v.startsWith("postgresql://")) {
        return "must start with postgres:// or postgresql://";
      }
      // sslmode=require لا يُفرض هنا — نشر Coolify الموثّق يستخدم شبكة docker
      // داخلية بدون SSL. يُحقَّق كتحذير في validateEnv بدل منع الإقلاع.
      return null;
    },
  },
  {
    name: "ENCRYPTION_KEY",
    value: sanitize(process.env.ENCRYPTION_KEY),
    requiredInProd: true,
    minLength: 16,
    // أي سلسلة ≥16 مقبولة (غير الـ 64-hex تُشتق عبر SHA-256 في encryption.ts) —
    // التفضيل لـ 64 hex يُسجَّل كتحذير أدناه، لا كخطأ مانع.
  },
  {
    name: "CRON_SECRET",
    value: sanitize(process.env.CRON_SECRET),
    requiredInProd: true,
    minLength: 32,
  },
  {
    name: "BETTER_AUTH_SECRET",
    value: sanitize(process.env.BETTER_AUTH_SECRET),
    requiredInProd: true,
    minLength: 16,
  },
  {
    name: "BETTER_AUTH_URL",
    value: sanitize(process.env.BETTER_AUTH_URL),
    requiredInProd: true,
    validator: (v) =>
      !v.startsWith("http://") && !v.startsWith("https://")
        ? "must start with http:// or https://"
        : null,
  },
];

export function validateEnv(): { ok: boolean; errors: string[]; warnings: string[] } {
  const isProd = process.env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const check of CHECKS) {
    if (!check.value) {
      const msg = `${check.name}: missing`;
      if (isProd && check.requiredInProd) errors.push(msg);
      else warnings.push(msg);
      continue;
    }
    if (check.minLength && check.value.length < check.minLength) {
      const msg = `${check.name}: too short (min ${check.minLength}, got ${check.value.length})`;
      if (isProd && check.requiredInProd) errors.push(msg);
      else warnings.push(msg);
      continue;
    }
    if (check.validator) {
      const err = check.validator(check.value);
      if (err) {
        const msg = `${check.name}: ${err}`;
        if (isProd && check.requiredInProd) errors.push(msg);
        else warnings.push(msg);
      }
    }
  }

  // SSL بين التطبيق و DB: تحذير فقط — نشر Coolify الموثّق يستخدم شبكة docker
  // داخلية بدون SSL. فعّل sslmode=require لو DB على خادم/شبكة خارجية.
  const dbUrl = sanitize(process.env.DATABASE_URL);
  if (isProd && dbUrl && !dbUrl.includes("sslmode=")) {
    warnings.push(
      "DATABASE_URL: بدون sslmode= — مقبول داخل شبكة docker الداخلية، لكن فعّل SSL لو قاعدة البيانات خارجية",
    );
  }

  // ENCRYPTION_KEY: يُفضَّل 64 hex — غير ذلك يعمل عبر اشتقاق SHA-256 (تحذير فقط)
  const encKey = sanitize(process.env.ENCRYPTION_KEY);
  if (encKey && !/^[0-9a-fA-F]{64}$/.test(encKey)) {
    warnings.push(
      "ENCRYPTION_KEY: ليس 64 hex — سيُشتق عبر SHA-256 (يعمل، لكن يُفضَّل مفتاح hex عشوائي 64 حرفاً)",
    );
  }

  // RESEND_API_KEY بدون EMAIL_FROM: البريد يفشل صامتاً عند أول محاولة إرسال
  if (sanitize(process.env.RESEND_API_KEY) && !sanitize(process.env.EMAIL_FROM)) {
    const msg =
      "EMAIL_FROM: مطلوب لأن RESEND_API_KEY مضبوط — بدونه يُرسَل البريد من عنوان placeholder";
    if (isProd) errors.push(msg);
    else warnings.push(msg);
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function assertEnv(): void {
  const { ok, errors, warnings } = validateEnv();
  for (const w of warnings) console.warn(`⚠️ ENV: ${w}`);
  if (!ok) {
    throw new Error(
      `ENV validation failed in production:\n  - ${errors.join("\n  - ")}`,
    );
  }
}
