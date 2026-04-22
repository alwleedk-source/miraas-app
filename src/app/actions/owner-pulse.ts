"use server";

import { db } from "@/db";
import { leads, followUps, users, leadSources } from "@/db/schema";
import { sql, eq, and, gte, lte, isNotNull, isNull, count } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { assertRole, ROLE } from "@/lib/tenant-guards";

export type OwnerPulse = {
  newLeads: { today: number; yesterday: number };
  bookings: { thisWeek: number; lastWeek: number };
  conversion: { thisWeek: number; lastWeek: number; thisWeekTotal: number; lastWeekTotal: number };
  topPerformer: { userName: string; attendedCount: number } | null;
  needsAttention: { userName: string; overdueCount: number } | null;
  topSource: { sourceName: string; conversions: number } | null;
};

function startOfDayRiyadh(daysFromToday: number): Date {
  const now = new Date();
  const riyadhStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const [y, m, d] = riyadhStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + daysFromToday, -3, 0, 0));
}

/**
 * نبض المالك — حقائق مقارنة قابلة للعمل
 *
 * يُعرض على dashboard لـ OWNER/ADMIN فقط. الهدف: 5 حقائق scannable
 * في 3 ثوانٍ تخبر المالك عمّا يحتاج اهتمامه اليوم.
 */
export async function getOwnerPulse(): Promise<OwnerPulse> {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  const todayStart = startOfDayRiyadh(0);
  const yesterdayStart = startOfDayRiyadh(-1);
  const weekStart = startOfDayRiyadh(-6);
  const lastWeekStart = startOfDayRiyadh(-13);
  const lastWeekEnd = startOfDayRiyadh(-6);
  const now = new Date();

  // 1+2: عملاء جدد اليوم + أمس
  const [todayLeads, yesterdayLeads] = await Promise.all([
    db
      .select({ c: count() })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.isDeleted, false),
          gte(leads.createdAt, todayStart),
        ),
      )
      .then((r) => r[0]?.c ?? 0),
    db
      .select({ c: count() })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.isDeleted, false),
          gte(leads.createdAt, yesterdayStart),
          lte(leads.createdAt, todayStart),
        ),
      )
      .then((r) => r[0]?.c ?? 0),
  ]);

  // 3+4: حجوزات هذا الأسبوع + الأسبوع السابق
  // نعتمد على bookingDate (موعد الحجز نفسه)، لا createdAt
  const [thisWeekBookings, lastWeekBookings] = await Promise.all([
    db
      .select({ c: count() })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.isDeleted, false),
          isNotNull(leads.bookingDate),
          gte(leads.bookingDate, weekStart),
        ),
      )
      .then((r) => r[0]?.c ?? 0),
    db
      .select({ c: count() })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.isDeleted, false),
          isNotNull(leads.bookingDate),
          gte(leads.bookingDate, lastWeekStart),
          lte(leads.bookingDate, lastWeekEnd),
        ),
      )
      .then((r) => r[0]?.c ?? 0),
  ]);

  // 5+6: تحويل (حضر/COMPLETED) لكل أسبوع
  const [thisWeekConverted, lastWeekConverted] = await Promise.all([
    db
      .select({ c: count() })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.isDeleted, false),
          isNotNull(leads.bookingDate),
          gte(leads.bookingDate, weekStart),
          eq(leads.bookingStatus, "COMPLETED"),
        ),
      )
      .then((r) => r[0]?.c ?? 0),
    db
      .select({ c: count() })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.isDeleted, false),
          isNotNull(leads.bookingDate),
          gte(leads.bookingDate, lastWeekStart),
          lte(leads.bookingDate, lastWeekEnd),
          eq(leads.bookingStatus, "COMPLETED"),
        ),
      )
      .then((r) => r[0]?.c ?? 0),
  ]);

  // 7: أفضل منسق (أكثر حضور هذا الأسبوع)
  const topPerformerRows = await db
    .select({
      userId: users.id,
      userName: users.name,
      c: count(leads.id),
    })
    .from(leads)
    .innerJoin(users, eq(leads.assignedTo, users.id))
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        eq(leads.bookingStatus, "COMPLETED"),
        gte(leads.bookingDate, weekStart),
      ),
    )
    .groupBy(users.id, users.name)
    .orderBy(sql`count(${leads.id}) desc`)
    .limit(1);

  // 8: منسق يحتاج اهتمام (أكثر متابعات متأخرة)
  const needsAttentionRows = await db
    .select({
      userId: users.id,
      userName: users.name,
      c: count(followUps.id),
    })
    .from(followUps)
    .innerJoin(users, eq(followUps.userId, users.id))
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        isNull(followUps.completedAt),
        isNotNull(followUps.scheduledAt),
        lte(followUps.scheduledAt, now),
      ),
    )
    .groupBy(users.id, users.name)
    .orderBy(sql`count(${followUps.id}) desc`)
    .limit(1);

  // 9: أفضل مصدر (أكثر حجوزات COMPLETED هذا الأسبوع)
  const topSourceRows = await db
    .select({
      sourceName: leadSources.name,
      c: count(leads.id),
    })
    .from(leads)
    .innerJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        eq(leads.bookingStatus, "COMPLETED"),
        gte(leads.bookingDate, weekStart),
      ),
    )
    .groupBy(leadSources.name)
    .orderBy(sql`count(${leads.id}) desc`)
    .limit(1);

  return {
    newLeads: { today: Number(todayLeads), yesterday: Number(yesterdayLeads) },
    bookings: { thisWeek: Number(thisWeekBookings), lastWeek: Number(lastWeekBookings) },
    conversion: {
      thisWeek:
        thisWeekBookings > 0
          ? Math.round((Number(thisWeekConverted) / Number(thisWeekBookings)) * 100)
          : 0,
      lastWeek:
        lastWeekBookings > 0
          ? Math.round((Number(lastWeekConverted) / Number(lastWeekBookings)) * 100)
          : 0,
      thisWeekTotal: Number(thisWeekConverted),
      lastWeekTotal: Number(lastWeekConverted),
    },
    topPerformer:
      topPerformerRows.length > 0 && Number(topPerformerRows[0].c) > 0
        ? {
            userName: topPerformerRows[0].userName,
            attendedCount: Number(topPerformerRows[0].c),
          }
        : null,
    needsAttention:
      needsAttentionRows.length > 0 && Number(needsAttentionRows[0].c) >= 3
        ? {
            userName: needsAttentionRows[0].userName,
            overdueCount: Number(needsAttentionRows[0].c),
          }
        : null,
    topSource:
      topSourceRows.length > 0 && Number(topSourceRows[0].c) > 0
        ? {
            sourceName: topSourceRows[0].sourceName,
            conversions: Number(topSourceRows[0].c),
          }
        : null,
  };
}
