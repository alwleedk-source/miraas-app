/**
 * Environment validation — fail-fast عند startup
 *
 * يتأكّد أن كل الأسرار الحرجة موجودة وقوية **قبل** بدء التطبيق.
 * في production: يرمي exception يمنع النشر.
 * في development: يطبع warnings.
 */

type EnvCheck = {
  name: string;
  value: string | undefined;
  requiredInProd: boolean;
  minLength?: number;
  validator?: (v: string) => string | null; // return error message or null
};

const CHECKS: EnvCheck[] = [
  {
    name: "DATABASE_URL",
    value: process.env.DATABASE_URL,
    requiredInProd: true,
    minLength: 20,
    validator: (v) =>
      !v.startsWith("postgres://") && !v.startsWith("postgresql://")
        ? "must start with postgres:// or postgresql://"
        : null,
  },
  {
    name: "ENCRYPTION_KEY",
    value: process.env.ENCRYPTION_KEY,
    requiredInProd: true,
    validator: (v) =>
      !/^[0-9a-fA-F]{64}$/.test(v) ? "must be 64 hex chars (32 bytes)" : null,
  },
  {
    name: "CRON_SECRET",
    value: process.env.CRON_SECRET,
    requiredInProd: true,
    minLength: 32,
  },
  {
    name: "BETTER_AUTH_SECRET",
    value: process.env.BETTER_AUTH_SECRET,
    requiredInProd: true,
    minLength: 16,
  },
  {
    name: "BETTER_AUTH_URL",
    value: process.env.BETTER_AUTH_URL,
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
      const msg = `${check.name}: too short (min ${check.minLength})`;
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

/** يُستدعى عند أول import — يرمي إذا production بلا أسرار */
export function assertEnv(): void {
  const { ok, errors, warnings } = validateEnv();
  for (const w of warnings) console.warn(`⚠️ ENV: ${w}`);
  if (!ok) {
    throw new Error(
      `ENV validation failed in production:\n  - ${errors.join("\n  - ")}`,
    );
  }
}
