import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/db";
import { errorLog, users, sessions } from "@/db/schema";
import { sql, isNull, lt, and } from "drizzle-orm";
import { cleanupRateLimits } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// تنظيف القيمة من المسافات/quotes (Coolify قد يحفظها بـ wrappers) + حدّ أدنى للطول.
// lazy: نتحقّق عند أول طلب لا عند تحميل الموديول (يكسر next build).
function getCronSecret(): string | null {
  const raw = process.env.CRON_SECRET
    ?.trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
  if (!raw || raw.length < 32) return null;
  return raw;
}

/**
 * GET /api/cron/cleanup
 * يُشغَّل يومياً من cron-job.org
 *
 * ينظّف:
 *   - error_log أقدم من 30 يوم
 *   - rate_limits منتهية
 *   - users بـ tenantId=NULL أقدم من 72 ساعة (abandoned signups)
 *   - sessions منتهية أقدم من أسبوع
 */
export async function GET(request: NextRequest) {
  // auth: header > query
  const provided =
    request.headers.get("x-cron-key") ??
    request.nextUrl.searchParams.get("secret") ??
    "";
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(cronSecret);
  const valid = a.length === b.length && timingSafeEqual(a, b);
  if (!valid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const results: Record<string, number | string> = {};

  // 1. error_log أقدم من 30 يوم
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const r = await db.delete(errorLog).where(lt(errorLog.createdAt, cutoff));
    results.errorLog = (r as unknown as { rowCount?: number })?.rowCount ?? "ok";
  } catch (e) {
    results.errorLog = e instanceof Error ? e.message : "failed";
  }

  // 2. rate_limits منتهية
  try {
    await cleanupRateLimits();
    results.rateLimits = "ok";
  } catch {
    results.rateLimits = "failed";
  }

  // 3. abandoned signups — users بلا tenantId أقدم من 72 ساعة.
  //    ⚠️ لا تخفضها عن عمر رابط التحقق: better-auth الافتراضي TTL = ساعة واحدة،
  //    وبنافذة ساعة كان يُحذف حساب من لم يُفعّل بريده بعد رغم أن رابطه ما زال
  //    صالحاً — 72 ساعة تعطي هامشاً مريحاً (تأخر بريد، إعادة إرسال، عطلة).
  try {
    const orphanCutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const r = await db
      .delete(users)
      .where(and(isNull(users.tenantId), lt(users.createdAt, orphanCutoff)));
    results.orphanUsers = (r as unknown as { rowCount?: number })?.rowCount ?? "ok";
  } catch (e) {
    results.orphanUsers = e instanceof Error ? e.message : "failed";
  }

  // 4. sessions منتهية أقدم من أسبوع
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const r = await db.delete(sessions).where(lt(sessions.expiresAt, weekAgo));
    results.expiredSessions = (r as unknown as { rowCount?: number })?.rowCount ?? "ok";
  } catch (e) {
    results.expiredSessions = e instanceof Error ? e.message : "failed";
  }

  // 5. VACUUM اختياري — يترك لـ Postgres autovacuum
  try {
    await db.execute(sql`ANALYZE`);
    results.analyze = "ok";
  } catch {
    results.analyze = "skipped";
  }

  logger.info("cleanup cron done", results);

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    results,
  });
}
