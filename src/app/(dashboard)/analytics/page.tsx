import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  BarChart3,
  Users,
  TrendingUp,
  Phone,
  Inbox,
  Calendar,
  Percent,
  CalendarDays,
  AlertTriangle,
  Trophy,
  Zap,
  ArrowDown,
  Star,
  Megaphone,
} from "lucide-react";
import { getInitials } from "@/lib/utils";
import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { leads, followUps, leadSources, pipelineStages, users } from "@/db/schema";
import { eq, and, count, sql, desc, asc, inArray } from "drizzle-orm";
import AnalyticsDateFilter from "./date-filter";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const range = params.range || "";
  const { tenantId, role } = await requireTenant();
  if (!tenantId) redirect("/register");
  if (role === "PROVIDER") redirect("/provider");
  // تحليلات — OWNER/ADMIN فقط (بيانات أعمال حساسة)
  if (!["OWNER", "ADMIN", "SUPER_ADMIN"].includes(role)) redirect("/");

  // حساب فلتر التاريخ
  let dateFilter: ReturnType<typeof sql> | null = null;
  let rangeLabel = "كل الأوقات";
  if (range === "today") {
    dateFilter = sql`${leads.createdAt} >= CURRENT_DATE`;
    rangeLabel = "اليوم";
  } else if (range === "7") {
    dateFilter = sql`${leads.createdAt} >= NOW() - INTERVAL '7 days'`;
    rangeLabel = "آخر 7 أيام";
  } else if (range === "30") {
    dateFilter = sql`${leads.createdAt} >= NOW() - INTERVAL '30 days'`;
    rangeLabel = "آخر 30 يوم";
  } else if (range === "90") {
    dateFilter = sql`${leads.createdAt} >= NOW() - INTERVAL '90 days'`;
    rangeLabel = "آخر 3 أشهر";
  }

  const baseConditions = [eq(leads.tenantId, tenantId), eq(leads.isDeleted, false)];
  if (dateFilter) baseConditions.push(dateFilter);

  // =============================================
  // الإحصائيات العامة
  // =============================================

  const [totalLeadsResult] = await db
    .select({ count: count() })
    .from(leads)
    .where(and(...baseConditions));

  const [thisMonthLeads] = await db
    .select({ count: count() })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        sql`EXTRACT(MONTH FROM ${leads.createdAt}) = EXTRACT(MONTH FROM CURRENT_DATE)`,
        sql`EXTRACT(YEAR FROM ${leads.createdAt}) = EXTRACT(YEAR FROM CURRENT_DATE)`
      )
    );

  // فلتر المتابعات
  let followUpDateFilter: ReturnType<typeof sql> | null = null;
  if (range === "today") {
    followUpDateFilter = sql`${followUps.createdAt} >= CURRENT_DATE`;
  } else if (range === "7") {
    followUpDateFilter = sql`${followUps.createdAt} >= NOW() - INTERVAL '7 days'`;
  } else if (range === "30") {
    followUpDateFilter = sql`${followUps.createdAt} >= NOW() - INTERVAL '30 days'`;
  } else if (range === "90") {
    followUpDateFilter = sql`${followUps.createdAt} >= NOW() - INTERVAL '90 days'`;
  }

  const followUpConditions = [eq(followUps.tenantId, tenantId)];
  if (followUpDateFilter) followUpConditions.push(followUpDateFilter);

  const [totalFollowUps] = await db
    .select({ count: count() })
    .from(followUps)
    .where(and(...followUpConditions));

  const [thisWeekLeads] = await db
    .select({ count: count() })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        sql`${leads.createdAt} >= NOW() - INTERVAL '7 days'`
      )
    );

  // =============================================
  // نسبة التحويل العامة + المراحل المُحوّلة
  // =============================================

  const convertedStages = await db
    .select({ id: pipelineStages.id, name: pipelineStages.name })
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.tenantId, tenantId),
        sql`LOWER(${pipelineStages.name}) IN ('محوّل', 'مُحوّل', 'converted', 'مغلق ربح', 'won')`
      )
    );

  const convertedIds = convertedStages.map((s) => s.id);
  let conversionRate = 0;
  let convertedCount = 0;

  if (convertedIds.length > 0 && totalLeadsResult.count > 0) {
    const [converted] = await db
      .select({ count: count() })
      .from(leads)
      .where(and(...baseConditions, inArray(leads.stageId, convertedIds)));
    convertedCount = converted.count;
    conversionRate = Math.round((converted.count / totalLeadsResult.count) * 100);
  }

  // =============================================
  // مخطط زمني
  // =============================================

  const chartDays = range === "30" ? 30 : range === "90" ? 90 : 7;
  const dailyLeads = await db
    .select({
      day: sql<string>`TO_CHAR(${leads.createdAt}, 'YYYY-MM-DD')`,
      dayLabel: sql<string>`TO_CHAR(${leads.createdAt}, 'Dy')`,
      count: count(),
    })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        sql`${leads.createdAt} >= NOW() - INTERVAL '${sql.raw(String(chartDays))} days'`
      )
    )
    .groupBy(sql`TO_CHAR(${leads.createdAt}, 'YYYY-MM-DD')`, sql`TO_CHAR(${leads.createdAt}, 'Dy')`)
    .orderBy(asc(sql`TO_CHAR(${leads.createdAt}, 'YYYY-MM-DD')`));

  // =============================================
  // قمع التحويل (Funnel)
  // =============================================

  const stageBreakdown = await db
    .select({
      stageId: pipelineStages.id,
      stageName: pipelineStages.name,
      stageColor: pipelineStages.color,
      count: count(),
    })
    .from(leads)
    .innerJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
    .where(and(...baseConditions))
    .groupBy(pipelineStages.id, pipelineStages.name, pipelineStages.color, pipelineStages.position)
    .orderBy(asc(pipelineStages.position));

  const totalInStages = stageBreakdown.reduce((s, st) => s + st.count, 0);
  const funnelMax = stageBreakdown.length > 0 ? Math.max(...stageBreakdown.map(s => s.count)) : 1;

  // =============================================
  // مصادر العملاء + نسبة تحويل كل حملة
  // =============================================

  const sources = await db
    .select({
      sourceId: leadSources.id,
      name: leadSources.name,
      platform: leadSources.platform,
      count: count(),
    })
    .from(leads)
    .innerJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(and(...baseConditions))
    .groupBy(leadSources.id, leadSources.name, leadSources.platform)
    .orderBy(desc(count()));

  const totalFromSources = sources.reduce((s, src) => s + src.count, 0);

  // نسبة تحويل كل حملة
  let sourceConversions: Map<string, number> = new Map();
  if (convertedIds.length > 0 && sources.length > 0) {
    const sourceConversionData = await db
      .select({
        sourceId: leads.sourceId,
        count: count(),
      })
      .from(leads)
      .where(
        and(
          ...baseConditions,
          inArray(leads.stageId, convertedIds),
          sql`${leads.sourceId} IS NOT NULL`
        )
      )
      .groupBy(leads.sourceId);

    sourceConversions = new Map(
      sourceConversionData.map((sc) => [sc.sourceId as string, sc.count])
    );
  }

  // =============================================
  // أداء المنسقين المتقدم
  // =============================================

  // عدد العملاء لكل منسق
  const coordinatorPerformance = await db
    .select({
      userId: users.id,
      userName: users.name,
      leadsCount: count(),
    })
    .from(leads)
    .innerJoin(users, eq(leads.assignedTo, users.id))
    .where(and(...baseConditions))
    .groupBy(users.id, users.name)
    .orderBy(desc(count()));

  // متابعات كل منسق
  const coordinatorFollowUps = await db
    .select({
      userId: users.id,
      followUpsCount: count(),
    })
    .from(followUps)
    .innerJoin(users, eq(followUps.userId, users.id))
    .where(and(...followUpConditions))
    .groupBy(users.id);

  const followUpsMap = new Map(coordinatorFollowUps.map((cf) => [cf.userId, cf.followUpsCount]));

  // تحويلات كل منسق
  let coordinatorConversions: Map<string, number> = new Map();
  if (convertedIds.length > 0) {
    const convData = await db
      .select({
        assignedTo: leads.assignedTo,
        count: count(),
      })
      .from(leads)
      .where(
        and(
          ...baseConditions,
          inArray(leads.stageId, convertedIds),
          sql`${leads.assignedTo} IS NOT NULL`
        )
      )
      .groupBy(leads.assignedTo);

    coordinatorConversions = new Map(
      convData.map((c) => [c.assignedTo as string, c.count])
    );
  }

  // متوسط زمن الاستجابة (ساعات بين تعيين العميل وأول متابعة)
  const responseTimeData = await db
    .select({
      assignedTo: leads.assignedTo,
      avgHours: sql<number>`
        COALESCE(AVG(
          EXTRACT(EPOCH FROM (
            (SELECT MIN(f.created_at) FROM follow_ups f WHERE f.lead_id = ${leads.id}) - ${leads.createdAt}
          )) / 3600
        ), -1)
      `,
    })
    .from(leads)
    .where(
      and(
        ...baseConditions,
        sql`${leads.assignedTo} IS NOT NULL`,
        sql`EXISTS (SELECT 1 FROM follow_ups f WHERE f.lead_id = ${leads.id})`
      )
    )
    .groupBy(leads.assignedTo);

  const responseTimeMap = new Map(
    responseTimeData.map((r) => [r.assignedTo as string, Math.round(Math.max(0, r.avgHours))])
  );

  // عملاء بدون متابعة لكل منسق
  const neglectedData = await db
    .select({
      assignedTo: leads.assignedTo,
      count: count(),
    })
    .from(leads)
    .where(
      and(
        ...baseConditions,
        sql`${leads.assignedTo} IS NOT NULL`,
        sql`NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.lead_id = ${leads.id})`
      )
    )
    .groupBy(leads.assignedTo);

  const neglectedMap = new Map(
    neglectedData.map((n) => [n.assignedTo as string, n.count])
  );

  // =============================================
  // العملاء المُهملين الإجمالي
  // =============================================

  const [totalNeglected] = await db
    .select({ count: count() })
    .from(leads)
    .where(
      and(
        ...baseConditions,
        sql`${leads.assignedTo} IS NOT NULL`,
        sql`NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.lead_id = ${leads.id})`
      )
    );

  // =============================================
  // توزيع الأولويات
  // =============================================

  const priorityBreakdown = await db
    .select({
      priority: leads.priority,
      count: count(),
    })
    .from(leads)
    .where(and(...baseConditions))
    .groupBy(leads.priority);

  const priorityLabels: Record<string, string> = { LOW: "منخفضة", MEDIUM: "متوسطة", HIGH: "عالية", URGENT: "عاجلة" };
  const priorityColors: Record<string, string> = { LOW: "#6B7280", MEDIUM: "#3B82F6", HIGH: "#F97316", URGENT: "#EF4444" };
  const totalPriority = priorityBreakdown.reduce((s, p) => s + p.count, 0);

  // ألوان الحملات
  const sourceColors = ["#1877F2", "#E4405F", "#4285F4", "#1DA1F2", "#6B7280", "#F97316", "#8B5CF6"];

  // =============================================
  // تحليلات الحجوزات والخدمات
  // =============================================

  const bookingBreakdown = await db
    .select({
      status: leads.bookingStatus,
      count: count(),
    })
    .from(leads)
    .where(and(...baseConditions, sql`${leads.bookingStatus} IS NOT NULL`))
    .groupBy(leads.bookingStatus);

  const totalBookings = bookingBreakdown.reduce((s, b) => s + b.count, 0);

  // حجوزات المنسقين (الحضور مقابل عدم الحضور)
  const coordinatorBookingsData = await db
    .select({
      assignedTo: leads.assignedTo,
      status: leads.bookingStatus,
      count: count(),
    })
    .from(leads)
    .where(and(...baseConditions, sql`${leads.bookingStatus} IS NOT NULL`))
    .groupBy(leads.assignedTo, leads.bookingStatus);

  const coordinatorBookingsMap = new Map<string, { total: number; attended: number; noShow: number }>();
  coordinatorBookingsData.forEach((row) => {
    if (!row.assignedTo) return;
    const current = coordinatorBookingsMap.get(row.assignedTo) || { total: 0, attended: 0, noShow: 0 };
    current.total += row.count;
    if (row.status === "COMPLETED") current.attended += row.count;
    if (["NO_RESPONSE", "CANCELLED", "ATTENDED_NOT_SUITABLE"].includes(row.status as string)) current.noShow += row.count;
    coordinatorBookingsMap.set(row.assignedTo, current);
  });

  // تحليل الخدمات الأكثر طلباً
  const servicesData = await db
    .select({ service: leads.bookingService })
    .from(leads)
    .where(and(...baseConditions, sql`${leads.bookingService} IS NOT NULL`));

  const servicesCountMap = new Map<string, number>();
  servicesData.forEach((row) => {
    if (!row.service) return;
    const srvs = row.service.split("،").map((s) => s.trim()).filter(Boolean);
    srvs.forEach((s) => {
      servicesCountMap.set(s, (servicesCountMap.get(s) || 0) + 1);
    });
  });
  const topServices = Array.from(servicesCountMap.entries())
    .map(([name, val]) => ({ name, count: val }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const hasData = totalLeadsResult.count > 0;

  // =============================================
  // حساب تقييم المنسقين (Performance Score)
  // =============================================

  function calcScore(coord: { userId: string; leadsCount: number }) {
    const fu = followUpsMap.get(coord.userId) || 0;
    const conv = coordinatorConversions.get(coord.userId) || 0;
    const neglected = neglectedMap.get(coord.userId) || 0;
    const responseHrs = responseTimeMap.get(coord.userId);

    // Score = conversion rate (40%) + follow-up ratio (30%) + response time (20%) + neglect penalty (10%)
    const convScore = coord.leadsCount > 0 ? (conv / coord.leadsCount) * 40 : 0;
    const fuScore = coord.leadsCount > 0 ? Math.min((fu / coord.leadsCount), 2) * 15 : 0; // cap at 2x
    const responseScore = responseHrs !== undefined && responseHrs >= 0
      ? Math.max(0, 20 - (responseHrs * 0.5)) // lose 0.5 per hour, max 20
      : 0;
    const neglectPenalty = coord.leadsCount > 0 ? (neglected / coord.leadsCount) * 10 : 0;

    return Math.round(Math.min(100, Math.max(0, convScore + fuScore + responseScore - neglectPenalty)));
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">التحليلات</h1>
          <p className="text-surface-500 mt-1">
            تقارير وإحصائيات مفصلة عن أداء الفريق
            {range && <span className="text-primary-600 font-medium"> — {rangeLabel}</span>}
          </p>
        </div>
        <AnalyticsDateFilter />
      </div>

      {/* بطاقات سريعة */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {[
          { title: "إجمالي العملاء", value: totalLeadsResult.count.toString(), icon: Users, color: "bg-primary-50 text-primary-600" },
          { title: "هذا الشهر", value: thisMonthLeads.count.toString(), icon: Calendar, color: "bg-success-50 text-success-600" },
          { title: "هذا الأسبوع", value: thisWeekLeads.count.toString(), icon: TrendingUp, color: "bg-warning-50 text-warning-600" },
          { title: "المتابعات", value: totalFollowUps.count.toString(), icon: Phone, color: "bg-primary-50 text-primary-600" },
          { title: "نسبة التحويل", value: `${conversionRate}%`, icon: Percent, color: conversionRate > 0 ? "bg-success-50 text-success-600" : "bg-surface-50 text-surface-500" },
          { title: "بدون متابعة", value: totalNeglected.count.toString(), icon: AlertTriangle, color: totalNeglected.count > 0 ? "bg-danger-50 text-danger-600" : "bg-surface-50 text-surface-500" },
        ].map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] lg:text-xs text-surface-500">{stat.title}</p>
                  <p className="text-xl lg:text-2xl font-bold text-surface-900 mt-1">{stat.value}</p>
                </div>
                <div className={`p-2 rounded-xl ${stat.color}`}>
                  <stat.icon className="h-4 w-4" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {hasData ? (
        <>
          {/* مخطط زمني */}
          {dailyLeads.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-primary-500" />
                  عملاء جدد — {rangeLabel === "كل الأوقات" ? "آخر 7 أيام" : rangeLabel}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-2 h-32">
                  {(() => {
                    const maxCount = Math.max(...dailyLeads.map((d) => d.count), 1);
                    return dailyLeads.map((d) => {
                      const height = Math.max((d.count / maxCount) * 100, 4);
                      const dayNames: Record<string, string> = { Mon: "اثنين", Tue: "ثلاثاء", Wed: "أربعاء", Thu: "خميس", Fri: "جمعة", Sat: "سبت", Sun: "أحد" };
                      return (
                        <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-xs font-semibold text-surface-900">{d.count}</span>
                          <div
                            className="w-full rounded-t-md bg-gradient-to-t from-primary-500 to-primary-400 transition-all duration-700 min-h-[4px]"
                            style={{ height: `${height}%` }}
                          />
                          <span className="text-[10px] text-surface-400 mt-1">
                            {dayNames[d.dayLabel] || d.dayLabel}
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </CardContent>
            </Card>
          )}

          {/* =============================================
              قمع التحويل (Conversion Funnel)
              ============================================= */}
          {stageBreakdown.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowDown className="h-5 w-5 text-primary-500" />
                  قمع التحويل
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {stageBreakdown.map((stage, idx) => {
                    const widthPct = funnelMax > 0 ? Math.max((stage.count / funnelMax) * 100, 8) : 8;
                    const pct = totalInStages > 0 ? Math.round((stage.count / totalInStages) * 100) : 0;
                    // Drop-off rate from previous stage
                    const prevCount = idx > 0 ? stageBreakdown[idx - 1].count : null;
                    const dropOff = prevCount && prevCount > 0
                      ? Math.round(((prevCount - stage.count) / prevCount) * 100)
                      : null;

                    return (
                      <div key={stage.stageId}>
                        <div className="flex items-center gap-3">
                          <div className="w-20 text-left shrink-0">
                            <span className="text-xs font-medium text-surface-700">{stage.stageName}</span>
                          </div>
                          <div className="flex-1 relative">
                            <div
                              className="h-9 rounded-lg flex items-center justify-end px-3 transition-all duration-700"
                              style={{
                                width: `${widthPct}%`,
                                backgroundColor: stage.stageColor,
                                opacity: 0.85,
                                margin: "0 auto 0 0",
                              }}
                            >
                              <span className="text-xs font-bold text-white drop-shadow-sm">
                                {stage.count}
                              </span>
                            </div>
                          </div>
                          <div className="w-14 text-left shrink-0">
                            <span className="text-xs text-surface-500">{pct}%</span>
                          </div>
                        </div>
                        {dropOff !== null && dropOff > 0 && (
                          <div className="flex items-center gap-3 py-0.5">
                            <div className="w-20" />
                            <span className="text-[10px] text-surface-400">
                              ↓ انخفاض {dropOff}%
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* =============================================
              🏆 لوحة تنافس المنسقين (Leaderboard)
              ============================================= */}
          {coordinatorPerformance.length > 0 && (() => {
            // Pre-compute all coordinator data sorted by score
            const rankedCoordinators = coordinatorPerformance.map((coord) => {
              const fu = followUpsMap.get(coord.userId) || 0;
              const conv = coordinatorConversions.get(coord.userId) || 0;
              const convRate = coord.leadsCount > 0 ? Math.round((conv / coord.leadsCount) * 100) : 0;
              const responseHrs = responseTimeMap.get(coord.userId);
              const neglected = neglectedMap.get(coord.userId) || 0;
              const score = calcScore(coord);
              return { ...coord, fu, conv, convRate, responseHrs, neglected, score };
            }).sort((a, b) => b.score - a.score);

            const maxScore = Math.max(...rankedCoordinators.map(c => c.score), 1);
            const maxLeads = Math.max(...rankedCoordinators.map(c => c.leadsCount), 1);
            const maxFollowUps = Math.max(...rankedCoordinators.map(c => c.fu), 1);
            const maxConvRate = Math.max(...rankedCoordinators.map(c => c.convRate), 1);

            // Achievement badges
            const bestConversion = rankedCoordinators.reduce((best, c) => c.convRate > best.convRate ? c : best, rankedCoordinators[0]);
            const fastestResponse = rankedCoordinators.reduce((best, c) => {
              if (c.responseHrs === undefined || c.responseHrs < 0) return best;
              if (best.responseHrs === undefined || best.responseHrs < 0) return c;
              return c.responseHrs < best.responseHrs ? c : best;
            }, rankedCoordinators[0]);
            const mostFollowUps = rankedCoordinators.reduce((best, c) => c.fu > best.fu ? c : best, rankedCoordinators[0]);
            const leastNeglected = rankedCoordinators.reduce((best, c) => c.neglected < best.neglected ? c : best, rankedCoordinators[0]);

            const medalEmoji = (rank: number) => rank === 0 ? "🥇" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : null;
            const rankGradient = (rank: number) =>
              rank === 0 ? "from-yellow-50 via-amber-50 to-orange-50 border-amber-200" :
              rank === 1 ? "from-slate-50 via-gray-50 to-zinc-50 border-gray-200" :
              rank === 2 ? "from-orange-50 via-amber-50 to-yellow-50 border-orange-200" :
              "bg-surface-50 border-surface-100";

            return (
              <>
                {/* === لوحة الترتيب الرئيسية === */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-warning-500" />
                      لوحة تنافس المنسقين
                      <Badge variant="default" className="text-[10px] mr-auto">
                        {rankedCoordinators.length} منسق
                      </Badge>
                    </CardTitle>
                    <p className="text-xs text-surface-400 mt-1">ترتيب تلقائي حسب نقاط الأداء</p>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {rankedCoordinators.map((coord, rank) => {
                        const medal = medalEmoji(rank);
                        const scoreColor = coord.score >= 70 ? "text-success-600 bg-success-50 border-success-200" :
                          coord.score >= 40 ? "text-warning-600 bg-warning-50 border-warning-200" :
                            "text-danger-600 bg-danger-50 border-danger-200";
                        const scorePct = maxScore > 0 ? (coord.score / maxScore) * 100 : 0;
                        const scoreBarColor = coord.score >= 70 ? "bg-success-500" :
                          coord.score >= 40 ? "bg-warning-500" : "bg-danger-500";

                        // Achievements for this coordinator
                        const achievements: string[] = [];
                        if (coord.userId === bestConversion.userId && bestConversion.convRate > 0) achievements.push("🎯 أعلى تحويل");
                        if (coord.userId === fastestResponse.userId && fastestResponse.responseHrs !== undefined && fastestResponse.responseHrs >= 0) achievements.push("⚡ أسرع استجابة");
                        if (coord.userId === mostFollowUps.userId && mostFollowUps.fu > 0) achievements.push("📞 أكثر متابعات");
                        if (coord.userId === leastNeglected.userId) achievements.push("✅ أقل إهمال");

                        return (
                          <div
                            key={coord.userId}
                            className={`p-4 rounded-xl border-2 transition-all ${rank < 3 ? `bg-gradient-to-l ${rankGradient(rank)}` : "bg-surface-50 border-surface-100"}`}
                          >
                            {/* الصف الأول: الترتيب + الاسم + النقاط */}
                            <div className="flex items-center gap-3 mb-3">
                              {/* رقم الترتيب / ميدالية */}
                              <div className="shrink-0 w-10 h-10 flex items-center justify-center">
                                {medal ? (
                                  <span className="text-2xl">{medal}</span>
                                ) : (
                                  <span className="text-lg font-bold text-surface-400">#{rank + 1}</span>
                                )}
                              </div>

                              {/* الأفاتار */}
                              <Avatar className="h-11 w-11 shrink-0">
                                <AvatarFallback className={`text-sm font-bold ${
                                  rank === 0 ? "bg-amber-100 text-amber-700" :
                                  rank === 1 ? "bg-gray-100 text-gray-700" :
                                  rank === 2 ? "bg-orange-100 text-orange-700" :
                                  "bg-primary-50 text-primary-700"
                                }`}>
                                  {getInitials(coord.userName)}
                                </AvatarFallback>
                              </Avatar>

                              {/* الاسم + الأوسمة */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-bold text-surface-900 truncate">
                                    {coord.userName}
                                  </span>
                                  {rank === 0 && (
                                    <Badge variant="default" className="text-[10px]">المتصدر 👑</Badge>
                                  )}
                                </div>
                                {achievements.length > 0 && (
                                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                    {achievements.map((a) => (
                                      <span key={a} className="text-[10px] px-1.5 py-0.5 bg-white/70 rounded-md border border-surface-200 text-surface-600">
                                        {a}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* نقاط الأداء */}
                              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border ${scoreColor} shrink-0`}>
                                <Zap className="h-4 w-4" />
                                <span className="text-lg font-black">{coord.score}</span>
                                <span className="text-[10px] opacity-60">نقطة</span>
                              </div>
                            </div>

                            {/* شريط النقاط المقارن */}
                            <div className="mb-3">
                              <div className="w-full h-2 bg-surface-200/60 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-1000 ${scoreBarColor}`}
                                  style={{ width: `${scorePct}%` }}
                                />
                              </div>
                            </div>

                            {/* الإحصائيات المفصلة */}
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                              {/* عملاء */}
                              <div className="p-2 bg-white/80 rounded-lg border border-surface-100 text-center">
                                <p className="text-lg font-bold text-surface-900">{coord.leadsCount}</p>
                                <p className="text-[10px] text-surface-400 mb-1">عملاء</p>
                                <div className="w-full h-1 bg-surface-100 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full bg-primary-400 transition-all duration-700" style={{ width: `${(coord.leadsCount / maxLeads) * 100}%` }} />
                                </div>
                              </div>
                              {/* متابعات */}
                              <div className="p-2 bg-white/80 rounded-lg border border-surface-100 text-center">
                                <p className="text-lg font-bold text-surface-900">{coord.fu}</p>
                                <p className="text-[10px] text-surface-400 mb-1">متابعات</p>
                                <div className="w-full h-1 bg-surface-100 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full bg-blue-400 transition-all duration-700" style={{ width: `${(coord.fu / maxFollowUps) * 100}%` }} />
                                </div>
                              </div>
                              {/* تحويل */}
                              <div className="p-2 bg-white/80 rounded-lg border border-surface-100 text-center">
                                <p className={`text-lg font-bold ${coord.convRate > 0 ? "text-success-600" : "text-surface-400"}`}>
                                  {coord.convRate}%
                                </p>
                                <p className="text-[10px] text-surface-400 mb-1">تحويل</p>
                                <div className="w-full h-1 bg-surface-100 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full bg-emerald-400 transition-all duration-700" style={{ width: `${maxConvRate > 0 ? (coord.convRate / maxConvRate) * 100 : 0}%` }} />
                                </div>
                              </div>
                              {/* زمن استجابة */}
                              <div className="p-2 bg-white/80 rounded-lg border border-surface-100 text-center">
                                <p className={`text-lg font-bold ${
                                  coord.responseHrs !== undefined && coord.responseHrs >= 0
                                    ? coord.responseHrs <= 4 ? "text-success-600" : coord.responseHrs <= 24 ? "text-warning-600" : "text-danger-600"
                                    : "text-surface-400"
                                }`}>
                                  {coord.responseHrs !== undefined && coord.responseHrs >= 0 ? `${coord.responseHrs}h` : "—"}
                                </p>
                                <p className="text-[10px] text-surface-400 mb-1">زمن استجابة</p>
                                <div className="w-full h-1 bg-surface-100 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full transition-all duration-700 ${
                                    coord.responseHrs !== undefined && coord.responseHrs >= 0
                                      ? coord.responseHrs <= 4 ? "bg-emerald-400" : coord.responseHrs <= 24 ? "bg-amber-400" : "bg-red-400"
                                      : "bg-surface-200"
                                  }`} style={{ width: `${
                                    coord.responseHrs !== undefined && coord.responseHrs >= 0
                                      ? Math.max(10, 100 - (coord.responseHrs * 2))
                                      : 0
                                  }%` }} />
                                </div>
                              </div>
                              {/* مُهملين */}
                              <div className="p-2 bg-white/80 rounded-lg border border-surface-100 text-center">
                                <p className={`text-lg font-bold ${coord.neglected > 0 ? "text-danger-600" : "text-success-600"}`}>
                                  {coord.neglected}
                                </p>
                                <p className="text-[10px] text-surface-400 mb-1">مُهملين</p>
                                <div className="w-full h-1 bg-surface-100 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full transition-all duration-700 ${coord.neglected === 0 ? "bg-emerald-400" : "bg-red-400"}`}
                                    style={{ width: `${coord.neglected === 0 ? 100 : Math.min(100, (coord.neglected / coord.leadsCount) * 100)}%` }} />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* === مقارنة المنسقين (Head-to-Head) === */}
                {rankedCoordinators.length >= 2 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-primary-500" />
                        مقارنة مباشرة — من يتصدر؟
                      </CardTitle>
                      <p className="text-xs text-surface-400 mt-1">مقارنة أداء المنسقين في كل معيار</p>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-5">
                        {/* مقارنة نسبة التحويل */}
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Percent className="h-4 w-4 text-success-500" />
                            <span className="text-xs font-semibold text-surface-700">نسبة التحويل</span>
                          </div>
                          <div className="space-y-1.5">
                            {rankedCoordinators
                              .sort((a, b) => b.convRate - a.convRate)
                              .map((coord, i) => (
                              <div key={coord.userId} className="flex items-center gap-2">
                                <span className="text-xs text-surface-500 w-20 truncate text-left">{coord.userName.split(" ")[0]}</span>
                                <div className="flex-1 h-5 bg-surface-100 rounded-full overflow-hidden relative">
                                  <div
                                    className={`h-full rounded-full transition-all duration-1000 ${i === 0 ? "bg-gradient-to-l from-emerald-400 to-emerald-500" : "bg-emerald-200"}`}
                                    style={{ width: `${maxConvRate > 0 ? Math.max((coord.convRate / maxConvRate) * 100, 2) : 2}%` }}
                                  />
                                  <span className={`absolute inset-y-0 flex items-center text-[11px] font-bold ${i === 0 ? "text-white px-3 start-0" : "text-emerald-700 px-2 end-0"}`}>
                                    {coord.convRate}%
                                  </span>
                                </div>
                                {i === 0 && <span className="text-xs">🏆</span>}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* مقارنة عدد المتابعات */}
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Phone className="h-4 w-4 text-blue-500" />
                            <span className="text-xs font-semibold text-surface-700">عدد المتابعات</span>
                          </div>
                          <div className="space-y-1.5">
                            {[...rankedCoordinators]
                              .sort((a, b) => b.fu - a.fu)
                              .map((coord, i) => (
                              <div key={coord.userId} className="flex items-center gap-2">
                                <span className="text-xs text-surface-500 w-20 truncate text-left">{coord.userName.split(" ")[0]}</span>
                                <div className="flex-1 h-5 bg-surface-100 rounded-full overflow-hidden relative">
                                  <div
                                    className={`h-full rounded-full transition-all duration-1000 ${i === 0 ? "bg-gradient-to-l from-blue-400 to-blue-500" : "bg-blue-200"}`}
                                    style={{ width: `${maxFollowUps > 0 ? Math.max((coord.fu / maxFollowUps) * 100, 2) : 2}%` }}
                                  />
                                  <span className={`absolute inset-y-0 flex items-center text-[11px] font-bold ${i === 0 ? "text-white px-3 start-0" : "text-blue-700 px-2 end-0"}`}>
                                    {coord.fu}
                                  </span>
                                </div>
                                {i === 0 && <span className="text-xs">🏆</span>}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* مقارنة زمن الاستجابة (الأقل أفضل) */}
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Zap className="h-4 w-4 text-amber-500" />
                            <span className="text-xs font-semibold text-surface-700">سرعة الاستجابة</span>
                            <span className="text-[10px] text-surface-400">(الأقل أفضل)</span>
                          </div>
                          <div className="space-y-1.5">
                            {[...rankedCoordinators]
                              .filter(c => c.responseHrs !== undefined && c.responseHrs >= 0)
                              .sort((a, b) => (a.responseHrs ?? 999) - (b.responseHrs ?? 999))
                              .map((coord, i) => {
                                const maxResp = Math.max(...rankedCoordinators.filter(c => c.responseHrs !== undefined && c.responseHrs >= 0).map(c => c.responseHrs ?? 0), 1);
                                const barW = maxResp > 0 ? Math.max(((coord.responseHrs ?? 0) / maxResp) * 100, 5) : 5;
                                return (
                                  <div key={coord.userId} className="flex items-center gap-2">
                                    <span className="text-xs text-surface-500 w-20 truncate text-left">{coord.userName.split(" ")[0]}</span>
                                    <div className="flex-1 h-5 bg-surface-100 rounded-full overflow-hidden relative">
                                      <div
                                        className={`h-full rounded-full transition-all duration-1000 ${i === 0 ? "bg-gradient-to-l from-amber-300 to-amber-400" : "bg-amber-200"}`}
                                        style={{ width: `${barW}%` }}
                                      />
                                      <span className={`absolute inset-y-0 flex items-center text-[11px] font-bold ${i === 0 ? "text-amber-900 px-3 start-0" : "text-amber-700 px-2 end-0"}`}>
                                        {coord.responseHrs}h
                                      </span>
                                    </div>
                                    {i === 0 && <span className="text-xs">⚡</span>}
                                  </div>
                                );
                              })}
                          </div>
                        </div>

                        {/* مقارنة نقاط الأداء الإجمالية */}
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Trophy className="h-4 w-4 text-yellow-500" />
                            <span className="text-xs font-semibold text-surface-700">النقاط الإجمالية</span>
                          </div>
                          <div className="space-y-1.5">
                            {rankedCoordinators.map((coord, i) => {
                              const barColor = coord.score >= 70 ? (i === 0 ? "bg-gradient-to-l from-emerald-400 to-teal-500" : "bg-emerald-200") :
                                coord.score >= 40 ? (i === 0 ? "bg-gradient-to-l from-amber-400 to-yellow-500" : "bg-amber-200") :
                                  "bg-red-200";
                              return (
                                <div key={coord.userId} className="flex items-center gap-2">
                                  <span className="text-xs text-surface-500 w-20 truncate text-left">{coord.userName.split(" ")[0]}</span>
                                  <div className="flex-1 h-5 bg-surface-100 rounded-full overflow-hidden relative">
                                    <div
                                      className={`h-full rounded-full transition-all duration-1000 ${barColor}`}
                                      style={{ width: `${Math.max((coord.score / maxScore) * 100, 3)}%` }}
                                    />
                                    <span className={`absolute inset-y-0 flex items-center text-[11px] font-bold ${i === 0 ? "text-white px-3 start-0" : "text-surface-700 px-2 end-0"}`}>
                                      {coord.score}
                                    </span>
                                  </div>
                                  {i === 0 && <span className="text-xs">👑</span>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* === أوسمة الإنجاز === */}
                {rankedCoordinators.length >= 2 && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      {
                        title: "أعلى تحويل",
                        emoji: "🎯",
                        name: bestConversion.userName,
                        value: `${bestConversion.convRate}%`,
                        color: "from-emerald-500 to-teal-600",
                        desc: "نسبة التحويل",
                      },
                      {
                        title: "أسرع استجابة",
                        emoji: "⚡",
                        name: fastestResponse.userName,
                        value: fastestResponse.responseHrs !== undefined && fastestResponse.responseHrs >= 0 ? `${fastestResponse.responseHrs}h` : "—",
                        color: "from-amber-500 to-orange-600",
                        desc: "متوسط الاستجابة",
                      },
                      {
                        title: "أكثر متابعات",
                        emoji: "📞",
                        name: mostFollowUps.userName,
                        value: mostFollowUps.fu.toString(),
                        color: "from-blue-500 to-indigo-600",
                        desc: "عدد المتابعات",
                      },
                      {
                        title: "أقل إهمال",
                        emoji: "✅",
                        name: leastNeglected.userName,
                        value: leastNeglected.neglected.toString(),
                        color: "from-violet-500 to-purple-600",
                        desc: "عملاء مُهملين",
                      },
                    ].map((award) => (
                      <Card key={award.title} className="overflow-hidden">
                        <div className={`bg-gradient-to-br ${award.color} p-3`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg">{award.emoji}</span>
                            <span className="text-xs font-bold text-white/90">{award.title}</span>
                          </div>
                        </div>
                        <CardContent className="p-3 text-center">
                          <Avatar className="h-9 w-9 mx-auto mb-1.5">
                            <AvatarFallback className="text-xs bg-primary-50 text-primary-700 font-bold">
                              {getInitials(award.name)}
                            </AvatarFallback>
                          </Avatar>
                          <p className="text-sm font-bold text-surface-900 truncate">{award.name}</p>
                          <p className="text-xl font-black text-surface-900 mt-1">{award.value}</p>
                          <p className="text-[10px] text-surface-400">{award.desc}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            );
          })()}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* =============================================
                أفضل الحملات (بنسبة التحويل)
                ============================================= */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Megaphone className="h-5 w-5 text-primary-500" />
                  الحملات — العدد ونسبة التحويل
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sources.length > 0 ? (
                  <div className="space-y-3">
                    {sources.map((source, i) => {
                      const pct = totalFromSources > 0 ? Math.round((source.count / totalFromSources) * 100) : 0;
                      const color = sourceColors[i % sourceColors.length];
                      const convCount = sourceConversions.get(source.sourceId) || 0;
                      const srcConvRate = source.count > 0 ? Math.round((convCount / source.count) * 100) : 0;

                      return (
                        <div key={source.name} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                              <span className="text-sm font-medium text-surface-700 truncate" title={source.name}>
                                {source.name.length > 25 ? source.name.slice(0, 25) + "…" : source.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-sm font-semibold text-surface-900">
                                {source.count}
                              </span>
                              <Badge variant="secondary" className="text-[10px]">{pct}%</Badge>
                              {convertedIds.length > 0 && (
                                <Badge
                                  variant={srcConvRate > 0 ? "success" : "outline"}
                                  className="text-[10px]"
                                >
                                  تحويل {srcConvRate}%
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="w-full h-2 bg-surface-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${pct}%`, backgroundColor: color }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-6 text-surface-400 text-sm">
                    لا توجد حملات بعد — سيتم إنشاؤها تلقائياً عند استقبال عملاء
                  </div>
                )}
              </CardContent>
            </Card>

            {/* توزيع المراحل */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary-500" />
                  توزيع العملاء حسب المرحلة
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stageBreakdown.length > 0 ? (
                  <div className="space-y-3">
                    {stageBreakdown.map((stage) => {
                      const pct = totalInStages > 0 ? Math.round((stage.count / totalInStages) * 100) : 0;
                      return (
                        <div key={stage.stageName} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.stageColor }} />
                              <span className="text-sm font-medium text-surface-700">{stage.stageName}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-surface-900">{stage.count}</span>
                              <Badge variant="secondary" className="text-xs">{pct}%</Badge>
                            </div>
                          </div>
                          <div className="w-full h-2 bg-surface-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${pct}%`, backgroundColor: stage.stageColor }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-6 text-surface-400 text-sm">لا توجد بيانات كافية</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* توزيع الأولويات */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-warning-500" />
                توزيع الأولويات
              </CardTitle>
            </CardHeader>
            <CardContent>
              {priorityBreakdown.length > 0 ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {(["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map((prio) => {
                    const data = priorityBreakdown.find(p => p.priority === prio);
                    const cnt = data?.count || 0;
                    const pct = totalPriority > 0 ? Math.round((cnt / totalPriority) * 100) : 0;
                    const color = priorityColors[prio];
                    return (
                      <div key={prio} className="p-3 bg-surface-50 rounded-lg border border-surface-100 text-center">
                        <div className="w-3 h-3 rounded-full mx-auto mb-2" style={{ backgroundColor: color }} />
                        <p className="text-2xl font-bold text-surface-900">{cnt}</p>
                        <p className="text-xs text-surface-500">{priorityLabels[prio]}</p>
                        <p className="text-[10px] text-surface-400 mt-1">{pct}%</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-6 text-surface-400 text-sm">لا توجد بيانات كافية</div>
              )}
            </CardContent>
          </Card>

          {/* =============================================
              تحليلات الحجوزات والخدمات
              ============================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* إجمالي الحجوزات */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-purple-500" />
                  نسبة حضور الحجوزات
                </CardTitle>
                <p className="text-xs text-surface-400 mt-1">
                  إجمالي الحجوزات: {totalBookings}
                </p>
              </CardHeader>
              <CardContent>
                {totalBookings > 0 ? (
                  <div className="space-y-3">
                    {bookingBreakdown.map((b) => {
                      const pct = Math.round((b.count / totalBookings) * 100);
                      const statusLabels: Record<string, string> = {
                        PENDING: "⏳ بانتظار",
                        COMPLETED: "✅ حضر واستفاد",
                        ATTENDED_NOT_SUITABLE: "😕 حضر ولم يناسبه",
                        CANCELLED: "🚫 ألغى",
                        NO_RESPONSE: "📵 لم يرد",
                        POSTPONED: "🔄 مؤجّل",
                      };
                      const statusColors: Record<string, string> = {
                        PENDING: "#EAB308", // yellow-500
                        COMPLETED: "#22C55E", // green-500
                        CANCELLED: "#9CA3AF", // gray-400
                        NO_RESPONSE: "#EF4444", // red-500
                        POSTPONED: "#3B82F6", // blue-500
                        ATTENDED_NOT_SUITABLE: "#F97316", // orange-500
                      };
                      const s = b.status || "PENDING";
                      return (
                        <div key={s} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-surface-700">{statusLabels[s]}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-surface-900">{b.count}</span>
                              <Badge variant="secondary" className="text-xs">{pct}%</Badge>
                            </div>
                          </div>
                          <div className="w-full h-2 bg-surface-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${pct}%`, backgroundColor: statusColors[s] }}
                            />
                          </div>
                        </div>
                      );
                    }).sort((a, b) => {
                      // ترتيب وهمي: الأكبر أولاً
                      return 0;
                    })}
                  </div>
                ) : (
                  <div className="text-center py-6 text-surface-400 text-sm">لا توجد حجوزات في هذه الفترة</div>
                )}
              </CardContent>
            </Card>

            {/* الخدمات الأكثر طلباً */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Star className="h-5 w-5 text-amber-500" />
                  الخدمات الأكثر طلباً
                </CardTitle>
                <p className="text-xs text-surface-400 mt-1">حسب المواعيد التي تم إنشاؤها</p>
              </CardHeader>
              <CardContent>
                {topServices.length > 0 ? (
                  <div className="space-y-3">
                    {topServices.map((srv, idx) => {
                      const maxCount = topServices[0].count;
                      const pct = Math.round((srv.count / maxCount) * 100);
                      return (
                        <div key={srv.name} className="flex items-center gap-3">
                          <span className="text-xs font-bold text-surface-400 w-4">{idx + 1}</span>
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-surface-800">{srv.name}</span>
                              <span className="text-sm font-bold text-surface-900">{srv.count}</span>
                            </div>
                            <div className="w-full h-1.5 bg-surface-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-amber-400 transition-all duration-700"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-6 text-surface-400 text-sm">لا توجد خدمات مسجلة في الحجوزات</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* أداء المنسقين في الحجوزات */}
          {coordinatorBookingsMap.size > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-500" />
                  أداء المنسقين في جودة الحجوزات
                </CardTitle>
                <p className="text-xs text-surface-400 mt-1">
                  نسبة الحضور مقابل عدم الحضور لكل منسق
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {Array.from(coordinatorBookingsMap.entries()).map(([userId, data]) => {
                    const coord = coordinatorPerformance.find(c => c.userId === userId);
                    if (!coord) return null;
                    const attendedPct = data.total > 0 ? Math.round((data.attended / data.total) * 100) : 0;
                    const noShowPct = data.total > 0 ? Math.round((data.noShow / data.total) * 100) : 0;
                    return (
                      <div key={userId} className="p-4 bg-surface-50 rounded-xl border border-surface-200">
                        <div className="flex items-center gap-3 mb-4">
                          <Avatar className="h-10 w-10 shrink-0">
                            <AvatarFallback className="bg-primary-100 text-primary-700 font-bold">
                              {getInitials(coord.userName)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-bold text-surface-900">{coord.userName}</p>
                            <p className="text-xs text-surface-500">{data.total} حجز إجمالي</p>
                          </div>
                        </div>

                        <div className="space-y-3">
                          {/* الحضور */}
                          <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-success-700 font-medium">✅ حضر ({data.attended})</span>
                              <span className="text-surface-600 font-bold">{attendedPct}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-surface-200 rounded-full overflow-hidden">
                              <div className="h-full bg-success-500 rounded-full" style={{ width: `${attendedPct}%` }} />
                            </div>
                          </div>
                          {/* عدم حضور / إلغاء */}
                          <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-danger-700 font-medium">📵 لم يحضر/ألغى ({data.noShow})</span>
                              <span className="text-surface-600 font-bold">{noShowPct}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-surface-200 rounded-full overflow-hidden">
                              <div className="h-full bg-danger-500 rounded-full" style={{ width: `${noShowPct}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

        </>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <Inbox className="h-12 w-12 mx-auto mb-4 text-surface-300" />
            <h3 className="text-lg font-semibold text-surface-700 mb-2">
              لا توجد بيانات تحليلية بعد
            </h3>
            <p className="text-surface-500 text-sm">
              أضف عملاء أو اربط Google Sheets لبدء رؤية التحليلات
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
