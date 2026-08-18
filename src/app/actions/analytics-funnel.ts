"use server";

import { db } from "@/db";
import { leads, followUps } from "@/db/schema";
import { sql, eq, and, gte, lte, isNotNull, count } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { assertRole, ROLE } from "@/lib/tenant-guards";

export type FunnelPeriod = "today" | "7d" | "30d" | "90d" | "all";

function periodToDateRange(period: FunnelPeriod): { from?: Date; to?: Date } {
  const now = new Date();
  const to = now;
  switch (period) {
    case "today": {
      // بداية اليوم بتوقيت الرياض (UTC+3) — setHours المحلي كان يعطي منتصف ليل
      // UTC (=3ص الرياض) فينزاح يوم "اليوم" 3 ساعات.
      const riyadhStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
      const [y, m, d] = riyadhStr.split("-").map(Number);
      const from = new Date(Date.UTC(y, m - 1, d, -3, 0, 0));
      return { from, to };
    }
    case "7d":
      return { from: new Date(now.getTime() - 7 * 86400_000), to };
    case "30d":
      return { from: new Date(now.getTime() - 30 * 86400_000), to };
    case "90d":
      return { from: new Date(now.getTime() - 90 * 86400_000), to };
    case "all":
      return {};
  }
}

// ====================================================
// FUNNEL — المراحل الست للتحويل
// ====================================================

export type FunnelData = {
  period: FunnelPeriod;
  stages: Array<{
    key: string;
    label: string;
    icon: string;
    count: number;
    pct: number; // % من المرحلة السابقة
    pctTotal: number; // % من الـ total
  }>;
  conversionRate: number; // overall %
  total: number;
  insights: string[];
};

export async function getFunnelData(period: FunnelPeriod = "30d"): Promise<FunnelData> {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  const { from, to } = periodToDateRange(period);

  const dateFilter = from
    ? and(gte(leads.createdAt, from), lte(leads.createdAt, to ?? new Date()))
    : undefined;

  const baseConditions = [
    eq(leads.tenantId, tenantId),
    eq(leads.isDeleted, false),
    sql`${leads.archivedAt} IS NULL`,
  ];
  if (dateFilter) baseConditions.push(dateFilter);

  // 1. Total leads
  const [totalLeadsRow] = await db
    .select({ c: count() })
    .from(leads)
    .where(and(...baseConditions));
  const total = totalLeadsRow?.c ?? 0;

  // 2. Contacted (تواصل فعلي حدث: follow-up مكتمل — completedAt IS NOT NULL.
  //    المتابعات المجدولة مستقبلاً والمعلّقة لا تُحسب، فهي نيّة تواصل لا تواصل)
  const [contactedRow] = await db
    .select({ c: count() })
    .from(leads)
    .where(
      and(
        ...baseConditions,
        sql`EXISTS (
          SELECT 1 FROM ${followUps}
          WHERE ${followUps.leadId} = ${leads.id}
            AND ${followUps.completedAt} IS NOT NULL
        )`,
      ),
    );
  const contacted = contactedRow?.c ?? 0;

  // 3. Responded (تواصل مكتمل بغير NOTE — note = رصد صامت لا يعني ردّاً من العميل.
  //    type-based لا notes-based: notes قد تكون NULL فتُقصى ظلماً بفحص LIKE)
  const [respondedRow] = await db
    .select({ c: count() })
    .from(leads)
    .where(
      and(
        ...baseConditions,
        sql`EXISTS (
          SELECT 1 FROM ${followUps}
          WHERE ${followUps.leadId} = ${leads.id}
            AND ${followUps.completedAt} IS NOT NULL
            AND ${followUps.type} != 'NOTE'
        )`,
      ),
    );
  const responded = respondedRow?.c ?? 0;

  // 4. Booked (has bookingStatus)
  const [bookedRow] = await db
    .select({ c: count() })
    .from(leads)
    .where(and(...baseConditions, isNotNull(leads.bookingStatus)));
  const booked = bookedRow?.c ?? 0;

  // 5. Showed up (bookingStatus = COMPLETED or ATTENDED_NOT_SUITABLE)
  const [showedUpRow] = await db
    .select({ c: count() })
    .from(leads)
    .where(
      and(
        ...baseConditions,
        sql`${leads.bookingStatus} IN ('COMPLETED', 'ATTENDED_NOT_SUITABLE')`,
      ),
    );
  const showedUp = showedUpRow?.c ?? 0;

  // 6. Converted (bookingStatus = COMPLETED)
  const [convertedRow] = await db
    .select({ c: count() })
    .from(leads)
    .where(and(...baseConditions, eq(leads.bookingStatus, "COMPLETED")));
  const converted = convertedRow?.c ?? 0;

  const stagesRaw = [
    { key: "leads", label: "عملاء جدد", icon: "📥", count: total },
    { key: "contacted", label: "تم التواصل", icon: "📞", count: contacted },
    { key: "responded", label: "ردّوا", icon: "💬", count: responded },
    { key: "booked", label: "وافقوا على حجز", icon: "📅", count: booked },
    { key: "showedUp", label: "حضروا", icon: "✅", count: showedUp },
    { key: "converted", label: "أتمّوا الصفقة", icon: "💰", count: converted },
  ];

  const stages = stagesRaw.map((s, i) => {
    const prev = i === 0 ? s.count : stagesRaw[i - 1].count;
    return {
      ...s,
      pct: prev > 0 ? Math.round((s.count / prev) * 100) : 0,
      pctTotal: total > 0 ? Math.round((s.count / total) * 100) : 0,
    };
  });

  const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

  // Insights — أكبر نقطة تسرّب
  const insights: string[] = [];
  let biggestDrop = { from: "", to: "", lostPct: 0, lostCount: 0 };
  for (let i = 1; i < stagesRaw.length; i++) {
    const prev = stagesRaw[i - 1];
    const curr = stagesRaw[i];
    if (prev.count === 0) continue;
    const lostPct = Math.round(((prev.count - curr.count) / prev.count) * 100);
    if (lostPct > biggestDrop.lostPct) {
      biggestDrop = {
        from: prev.label,
        to: curr.label,
        lostPct,
        lostCount: prev.count - curr.count,
      };
    }
  }
  if (biggestDrop.lostPct > 30) {
    insights.push(
      `🔴 أكبر تسرّب: ${biggestDrop.lostPct}% من "${biggestDrop.from}" إلى "${biggestDrop.to}" (${biggestDrop.lostCount.toLocaleString("ar-SA")} عميل ضائع)`,
    );
  }
  if (total > 0 && conversionRate < 10) {
    insights.push(`⚠️ معدّل تحويل منخفض (${conversionRate}%) — راجع جودة الـ leads أو طريقة الإقناع`);
  }
  if (total > 0 && conversionRate >= 25) {
    insights.push(`🎉 معدّل تحويل ممتاز (${conversionRate}%) — استمر بنفس الاستراتيجية`);
  }

  return {
    period,
    stages,
    conversionRate,
    total,
    insights,
  };
}

// ====================================================
// LEADERBOARD — أداء المنسقات
// ====================================================

export type CoordinatorPerformance = {
  userId: string;
  userName: string;
  totalLeads: number;
  contacted: number;
  booked: number;
  converted: number;
  conversionPct: number;
};

export async function getCoordinatorLeaderboard(
  period: FunnelPeriod = "30d",
): Promise<CoordinatorPerformance[]> {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  const { from, to } = periodToDateRange(period);
  const dateConditions = from
    ? sql`AND l.created_at >= ${from} AND l.created_at <= ${to ?? new Date()}`
    : sql``;

  // single query with subqueries — avoids N+1
  const result = await db.execute<{
    user_id: string;
    user_name: string;
    total_leads: number;
    contacted: number;
    booked: number;
    converted: number;
  }>(sql`
    SELECT
      u.id AS user_id,
      u.name AS user_name,
      COUNT(l.id)::int AS total_leads,
      COUNT(l.id) FILTER (WHERE EXISTS (
        SELECT 1 FROM follow_ups fu WHERE fu.lead_id = l.id
      ))::int AS contacted,
      COUNT(l.id) FILTER (WHERE l.booking_status IS NOT NULL)::int AS booked,
      COUNT(l.id) FILTER (WHERE l.booking_status = 'COMPLETED')::int AS converted
    FROM users u
    LEFT JOIN leads l ON l.assigned_to = u.id
      AND l.tenant_id = ${tenantId}
      AND l.is_deleted = false
      AND l.archived_at IS NULL
      ${dateConditions}
    WHERE u.tenant_id = ${tenantId}
      AND u.role = 'COORDINATOR'
      AND u.is_active = true
    GROUP BY u.id, u.name
    HAVING COUNT(l.id) > 0
    ORDER BY converted DESC, booked DESC
    LIMIT 20
  `);

  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{
    user_id: string;
    user_name: string;
    total_leads: number;
    contacted: number;
    booked: number;
    converted: number;
  }>;

  return rows.map((r) => ({
    userId: r.user_id,
    userName: r.user_name,
    totalLeads: Number(r.total_leads),
    contacted: Number(r.contacted),
    booked: Number(r.booked),
    converted: Number(r.converted),
    conversionPct:
      Number(r.total_leads) > 0
        ? Math.round((Number(r.converted) / Number(r.total_leads)) * 100)
        : 0,
  }));
}

// ====================================================
// CAMPAIGN ROI — أداء كل حملة
// ====================================================

export type CampaignROI = {
  sourceId: string | null;
  sourceName: string;
  platform: string | null;
  totalLeads: number;
  contacted: number;
  booked: number;
  converted: number;
  conversionPct: number;
};

export async function getCampaignROI(
  period: FunnelPeriod = "30d",
): Promise<CampaignROI[]> {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  const { from, to } = periodToDateRange(period);
  const dateConditions = from
    ? sql`AND l.created_at >= ${from} AND l.created_at <= ${to ?? new Date()}`
    : sql``;

  const result = await db.execute<{
    source_id: string | null;
    source_name: string | null;
    platform: string | null;
    total_leads: number;
    contacted: number;
    booked: number;
    converted: number;
  }>(sql`
    SELECT
      ls.id AS source_id,
      COALESCE(ls.name, 'بدون مصدر') AS source_name,
      ls.platform,
      COUNT(l.id)::int AS total_leads,
      COUNT(l.id) FILTER (WHERE EXISTS (
        SELECT 1 FROM follow_ups fu WHERE fu.lead_id = l.id
      ))::int AS contacted,
      COUNT(l.id) FILTER (WHERE l.booking_status IS NOT NULL)::int AS booked,
      COUNT(l.id) FILTER (WHERE l.booking_status = 'COMPLETED')::int AS converted
    FROM leads l
    LEFT JOIN lead_sources ls ON ls.id = l.source_id
    WHERE l.tenant_id = ${tenantId}
      AND l.is_deleted = false
      AND l.archived_at IS NULL
      ${dateConditions}
    GROUP BY ls.id, ls.name, ls.platform
    HAVING COUNT(l.id) > 0
    ORDER BY converted DESC, total_leads DESC
    LIMIT 20
  `);

  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{
    source_id: string | null;
    source_name: string;
    platform: string | null;
    total_leads: number;
    contacted: number;
    booked: number;
    converted: number;
  }>;

  return rows.map((r) => ({
    sourceId: r.source_id,
    sourceName: r.source_name,
    platform: r.platform,
    totalLeads: Number(r.total_leads),
    contacted: Number(r.contacted),
    booked: Number(r.booked),
    converted: Number(r.converted),
    conversionPct:
      Number(r.total_leads) > 0
        ? Math.round((Number(r.converted) / Number(r.total_leads)) * 100)
        : 0,
  }));
}

// ====================================================
// PERIOD COMPARISON — مقارنة فترتين
// ====================================================

export async function getFunnelComparison(
  current: FunnelPeriod = "30d",
): Promise<{
  current: FunnelData;
  previous: FunnelData | null;
  changes: { converted: number; total: number; conversionRate: number };
}> {
  const currentData = await getFunnelData(current);

  // فترة سابقة بنفس الطول للمقارنة (only for periods != all)
  if (current === "all") {
    return {
      current: currentData,
      previous: null,
      changes: { converted: 0, total: 0, conversionRate: 0 },
    };
  }

  // عمل query مخصص للفترة السابقة
  const { from } = periodToDateRange(current);
  if (!from) {
    return {
      current: currentData,
      previous: null,
      changes: { converted: 0, total: 0, conversionRate: 0 },
    };
  }
  const periodLengthMs = Date.now() - from.getTime();
  const previousFrom = new Date(from.getTime() - periodLengthMs);
  const previousTo = from;

  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  // simplified — just total and converted
  const baseConditions = [
    eq(leads.tenantId, tenantId),
    eq(leads.isDeleted, false),
    sql`${leads.archivedAt} IS NULL`,
    gte(leads.createdAt, previousFrom),
    lte(leads.createdAt, previousTo),
  ];

  const [totalRow, convertedRow] = await Promise.all([
    db.select({ c: count() }).from(leads).where(and(...baseConditions)),
    db
      .select({ c: count() })
      .from(leads)
      .where(and(...baseConditions, eq(leads.bookingStatus, "COMPLETED"))),
  ]);

  const prevTotal = totalRow[0]?.c ?? 0;
  const prevConverted = convertedRow[0]?.c ?? 0;
  const prevConversionRate = prevTotal > 0 ? Math.round((prevConverted / prevTotal) * 100) : 0;

  return {
    current: currentData,
    previous: {
      period: current,
      total: prevTotal,
      stages: [],
      conversionRate: prevConversionRate,
      insights: [],
    },
    changes: {
      total: prevTotal > 0 ? Math.round(((currentData.total - prevTotal) / prevTotal) * 100) : 0,
      // العدد المُحوَّل الحالي = مرحلة "converted" في الـ funnel (كان رقماً ثابتاً 6 خاطئاً)
      converted:
        prevConverted > 0
          ? Math.round(
              (((currentData.stages.find((s) => s.key === "converted")?.count ?? 0) -
                prevConverted) /
                prevConverted) *
                100,
            )
          : 0,
      conversionRate: currentData.conversionRate - prevConversionRate,
    },
  };
}

// إصلاح bug في السطر السابق
export async function getFunnelChanges(period: FunnelPeriod = "30d"): Promise<{
  totalChange: number;
  convertedChange: number;
  conversionRateChange: number;
}> {
  if (period === "all") return { totalChange: 0, convertedChange: 0, conversionRateChange: 0 };

  const { from } = periodToDateRange(period);
  if (!from) return { totalChange: 0, convertedChange: 0, conversionRateChange: 0 };

  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  const periodLengthMs = Date.now() - from.getTime();
  const previousFrom = new Date(from.getTime() - periodLengthMs);
  const previousTo = from;

  const baseConditions = [
    eq(leads.tenantId, tenantId),
    eq(leads.isDeleted, false),
    sql`${leads.archivedAt} IS NULL`,
  ];

  const [
    [currentTotal],
    [currentConverted],
    [prevTotal],
    [prevConverted],
  ] = await Promise.all([
    db
      .select({ c: count() })
      .from(leads)
      .where(and(...baseConditions, gte(leads.createdAt, from))),
    db
      .select({ c: count() })
      .from(leads)
      .where(
        and(...baseConditions, gte(leads.createdAt, from), eq(leads.bookingStatus, "COMPLETED")),
      ),
    db
      .select({ c: count() })
      .from(leads)
      .where(
        and(
          ...baseConditions,
          gte(leads.createdAt, previousFrom),
          lte(leads.createdAt, previousTo),
        ),
      ),
    db
      .select({ c: count() })
      .from(leads)
      .where(
        and(
          ...baseConditions,
          gte(leads.createdAt, previousFrom),
          lte(leads.createdAt, previousTo),
          eq(leads.bookingStatus, "COMPLETED"),
        ),
      ),
  ]);

  const ct = currentTotal?.c ?? 0;
  const cc = currentConverted?.c ?? 0;
  const pt = prevTotal?.c ?? 0;
  const pc = prevConverted?.c ?? 0;

  return {
    totalChange: pt > 0 ? Math.round(((ct - pt) / pt) * 100) : 0,
    convertedChange: pc > 0 ? Math.round(((cc - pc) / pc) * 100) : 0,
    conversionRateChange:
      pt > 0 && ct > 0
        ? Math.round((cc / ct) * 100) - Math.round((pc / pt) * 100)
        : 0,
  };
}
