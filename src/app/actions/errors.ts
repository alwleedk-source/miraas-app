"use server";

import { db } from "@/db";
import { errorLog, users } from "@/db/schema";
import { eq, and, desc, sql, lt } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { assertRole, ROLE } from "@/lib/tenant-guards";

/**
 * جلب أخطاء الشركة — مع تجميع حسب fingerprint ليظهر كل خطأ مرة واحدة مع count.
 */
export async function getErrors(options?: { limit?: number; unresolvedOnly?: boolean }) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  const limit = Math.min(options?.limit ?? 50, 200);

  // تجميع: كل fingerprint فريد مع count + آخر حدوث
  // نجلب آخر 500 للتجميع ثم نعرض top N
  const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // آخر 30 يوم

  const grouped = await db
    .select({
      fingerprint: errorLog.fingerprint,
      message: errorLog.message,
      errorName: errorLog.errorName,
      level: errorLog.level,
      count: sql<number>`COUNT(*)::int`.as("count"),
      lastSeen: sql<Date>`MAX(${errorLog.createdAt})`.as("last_seen"),
      firstSeen: sql<Date>`MIN(${errorLog.createdAt})`.as("first_seen"),
    })
    .from(errorLog)
    .where(
      and(
        // أخطاء tenant_id NULL (webhook/cron) نظامية وقد تحوي سياق tenants أخرى —
        // لا تُعرض لأي tenant. لا يوجد SUPER_ADMIN فعلي، فأُسقِط فرع isNull كلياً.
        eq(errorLog.tenantId, tenantId),
        sql`${errorLog.createdAt} >= ${recentCutoff}`,
      ),
    )
    .groupBy(errorLog.fingerprint, errorLog.message, errorLog.errorName, errorLog.level)
    .orderBy(desc(sql`MAX(${errorLog.createdAt})`))
    .limit(limit);

  return grouped;
}

/**
 * تفاصيل كل الحوادث لـ fingerprint معيّن.
 */
export async function getErrorDetails(fingerprint: string) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  return await db
    .select({
      id: errorLog.id,
      message: errorLog.message,
      errorName: errorLog.errorName,
      errorStack: errorLog.errorStack,
      context: errorLog.context,
      level: errorLog.level,
      url: errorLog.url,
      userId: errorLog.userId,
      userName: users.name,
      createdAt: errorLog.createdAt,
    })
    .from(errorLog)
    .leftJoin(users, eq(errorLog.userId, users.id))
    .where(
      and(
        eq(errorLog.fingerprint, fingerprint),
        eq(errorLog.tenantId, tenantId),
      ),
    )
    .orderBy(desc(errorLog.createdAt))
    .limit(50);
}

/**
 * تنظيف الأخطاء القديمة — يُستدعى من cron أو يدوياً.
 * يُبقي آخر 30 يوماً.
 */
export async function pruneOldErrors() {
  const { role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db.delete(errorLog).where(lt(errorLog.createdAt, cutoff));
  return { deleted: "older than 30d" };
}

/**
 * عدد أخطاء اليوم — للـ badge على Sidebar.
 */
export async function getTodayErrorCount() {
  const { tenantId, role } = await requireTenant();
  if (!["OWNER", "ADMIN", "SUPER_ADMIN"].includes(role)) return 0;
  // بداية اليوم بتوقيت الرياض (السيرفر UTC — setHours المحلي ينزاح 3 ساعات)
  const riyadhStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const [ry, rm, rd] = riyadhStr.split("-").map(Number);
  const dayStart = new Date(Date.UTC(ry, rm - 1, rd, -3, 0, 0));

  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(errorLog)
    .where(
      and(
        eq(errorLog.tenantId, tenantId),
        eq(errorLog.level, "error"),
        sql`${errorLog.createdAt} >= ${dayStart}`,
      ),
    );
  return row?.count ?? 0;
}
