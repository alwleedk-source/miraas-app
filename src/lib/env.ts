/**
 * Environment validation — fail-fast عند startup
 *
 * يتأكّد أن كل الأسرار الحرجة موجودة وقوية **قبل** بدء التطبيق.
 * يتسامح مع المسافات + علامات التنصيص (Coolify يحفظ بعض القيم بـ quotes).
 */

/** ينظّف القيم من المسافات/الـ quotes/الـ newlines */
function sanitize(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  return raw
    .trim()
    .replace(/^["']|["']$/g, "") // strip surrounding quotes
    .replace(/\s+/g, ""); // strip internal whitespace
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
      // SSL ضروري في production — يحمي البيانات أثناء النقل
      // (Coolify-managed Postgres قد يكون localhost دون SSL لكن في cluster setup ضروري)
      if (process.env.NODE_ENV === "production" && !v.includes("sslmode=")) {
        return "production يجب أن يحوي ?sslmode=require — يحمي البيانات أثناء النقل";
      }
      return null;
    },
  },
  {
    name: "ENCRYPTION_KEY",
    value: sanitize(process.env.ENCRYPTION_KEY),
    requiredInProd: true,
    validator: (v) => {
      if (!/^[0-9a-fA-F]+$/.test(v)) {
        return `contains invalid characters (must be hex). Got ${v.length} chars: "${v.slice(0, 8)}..."`;
      }
      if (v.length !== 64) {
        return `must be exactly 64 hex chars. Got ${v.length} chars.`;
      }
      return null;
    },
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
