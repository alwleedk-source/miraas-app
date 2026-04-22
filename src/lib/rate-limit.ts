/**
 * Rate limiter — Postgres-backed (صفر dependencies، يعمل عبر Coolify replicas)
 *
 * استخدام:
 *   const { allowed, remaining } = await rateLimit(`webhook:${webhookId}`, 60, 60_000);
 *   if (!allowed) return 429;
 *
 * آلية العمل:
 *   - UPSERT على صف لكل key
 *   - إذا resetAt انتهى، نعيد count إلى 1
 *   - إذا count تجاوز limit، نرفض
 *   - cleanup تلقائي: كل استدعاء يحذف rows منتهية (lazy GC)
 */

import { db } from "@/db";
import { sql } from "drizzle-orm";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

/**
 * @param key — identifier (مثل "webhook:<uuid>" أو "auth:<ip>")
 * @param limit — عدد الطلبات المسموحة في النافذة
 * @param windowMs — طول النافذة بالميلي ثانية
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const truncKey = key.slice(0, 200);
  const now = new Date();
  const newResetAt = new Date(now.getTime() + windowMs);

  try {
    // UPSERT: إذا موجود وصالح، زد count. إذا منتهي، reset.
    const result = await db.execute(sql`
      INSERT INTO rate_limits ("key", count, reset_at)
      VALUES (${truncKey}, 1, ${newResetAt})
      ON CONFLICT ("key") DO UPDATE
      SET
        count = CASE
          WHEN rate_limits.reset_at < ${now} THEN 1
          ELSE rate_limits.count + 1
        END,
        reset_at = CASE
          WHEN rate_limits.reset_at < ${now} THEN ${newResetAt}
          ELSE rate_limits.reset_at
        END
      RETURNING count, reset_at
    `);

    // drizzle db.execute يُعيد RowList — نتعامل معه بمرونة عبر unknown
    const raw = result as unknown;
    const rows = (Array.isArray(raw)
      ? raw
      : (raw as { rows?: unknown[] })?.rows ?? []) as Array<{ count: number | string; reset_at: string | Date }>;
    const row = rows[0];
    if (!row) return { allowed: true, remaining: limit - 1, resetAt: newResetAt };

    const currentCount = Number(row.count);
    const resetAt = row.reset_at instanceof Date ? row.reset_at : new Date(String(row.reset_at));
    const allowed = currentCount <= limit;

    return {
      allowed,
      remaining: Math.max(0, limit - currentCount),
      resetAt,
    };
  } catch {
    // Fail-open — إذا DB متعطلة لا نعطّل الـ webhook
    return { allowed: true, remaining: 0, resetAt: newResetAt };
  }
}

/** تنظيف rows منتهية (يُستدعى من cron أو يدوياً) */
export async function cleanupRateLimits(): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM rate_limits WHERE reset_at < NOW() - INTERVAL '1 hour'`);
  } catch {
    // ignore
  }
}
