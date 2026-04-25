import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  UserPlus,
  PhoneCall,
  Inbox,
  CalendarClock,
  CalendarDays,
} from "lucide-react";
import { getDashboardStats } from "@/app/actions/leads";
import { requireTenant } from "@/lib/auth-server";
import { toWhatsappUrl } from "@/lib/utils";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { activityLog, users, followUps, leads, leadSources, departments } from "@/db/schema";
import { eq, and, desc, lte, gte, isNull, isNotNull, sql, count } from "drizzle-orm";
import TodayTasks from "./today-tasks";
import UpcomingFollowUps from "./upcoming-followups";
import ActivityLog from "./activity-log";
import AgingLeadsBanner from "./aging-leads-banner";
import ReactivationBanner from "./reactivation-banner";
import { StuckLeadsOwnerBanner, MyWhatsappBanner } from "./whatsapp-warnings-banners";
import OwnerPulseCard from "./owner-pulse-card";
import { getOwnerPulse, type OwnerPulse } from "@/app/actions/owner-pulse";
import OnboardingChecklist from "./onboarding-checklist";
import { getOnboardingStatus, type OnboardingStatus } from "@/app/actions/onboarding";

export default async function DashboardPage() {
  const { tenantId, role: userRole, session, userId } = await requireTenant();

  if (!tenantId) {
    redirect("/register");
  }

  // مقدم الخدمة يُوجَّه لبوابته الخاصة
  if (userRole === "PROVIDER") {
    redirect("/provider");
  }

  // جلب الإحصائيات
  let stats;
  try {
    stats = await getDashboardStats();
  } catch {
    stats = { totalLeads: 0, todayLeads: 0, todayFollowUps: 0, stageBreakdown: [] };
  }

  // نبض المالك — للمالك/المدير فقط
  let ownerPulse: OwnerPulse | null = null;
  let onboarding: OnboardingStatus | null = null;
  if (userRole === "OWNER" || userRole === "ADMIN") {
    try {
      [ownerPulse, onboarding] = await Promise.all([
        getOwnerPulse().catch(() => null),
        getOnboardingStatus().catch(() => null),
      ]);
    } catch {
      // ignore
    }
  }

  // جلب المتابعات المجدولة لليوم أو المتأخرة
  let scheduledTasks: {
    id: string;
    type: string;
    notes: string | null;
    scheduledAt: Date;
    leadId: string;
    leadName: string;
    leadPhone: string | null;
    leadSource: string | null;
  }[] = [];
  try {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const conditions = [
      eq(followUps.tenantId, tenantId),
      lte(followUps.scheduledAt, endOfToday),
      isNull(followUps.completedAt),
      sql`${followUps.scheduledAt} IS NOT NULL`,
    ];

    // المنسق يرى مهامه فقط
    if (userRole === "COORDINATOR") {
      conditions.push(eq(followUps.userId, userId));
    }

    const raw = await db
      .select({
        id: followUps.id,
        type: followUps.type,
        notes: followUps.notes,
        scheduledAt: followUps.scheduledAt,
        leadId: leads.id,
        leadName: leads.name,
        leadPhone: leads.phone,
        leadSource: leadSources.name,
      })
      .from(followUps)
      .innerJoin(leads, eq(followUps.leadId, leads.id))
      .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
      .where(and(...conditions, eq(leads.isDeleted, false)))
      .orderBy(followUps.scheduledAt)
      .limit(20);

    scheduledTasks = raw.filter((r) => r.scheduledAt !== null) as typeof scheduledTasks;
  } catch {
    // ignore
  }

  // جلب المتابعات القادمة (الأسبوع القادم)
  let upcomingTasks: {
    id: string;
    type: string;
    notes: string | null;
    scheduledAt: Date;
    leadName: string;
    leadPhone: string | null;
  }[] = [];
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 8);
    nextWeek.setHours(0, 0, 0, 0);

    const upConditions = [
      eq(followUps.tenantId, tenantId),
      gte(followUps.scheduledAt, tomorrow),
      lte(followUps.scheduledAt, nextWeek),
      isNull(followUps.completedAt),
      isNotNull(followUps.scheduledAt),
    ];
    if (userRole === "COORDINATOR") {
      upConditions.push(eq(followUps.userId, userId));
    }

    const rawUpcoming = await db
      .select({
        id: followUps.id,
        type: followUps.type,
        notes: followUps.notes,
        scheduledAt: followUps.scheduledAt,
        leadName: leads.name,
        leadPhone: leads.phone,
      })
      .from(followUps)
      .innerJoin(leads, eq(followUps.leadId, leads.id))
      .where(and(...upConditions, eq(leads.isDeleted, false)))
      .orderBy(followUps.scheduledAt)
      .limit(30);

    upcomingTasks = rawUpcoming.filter((r) => r.scheduledAt !== null) as typeof upcomingTasks;
  } catch {
    // ignore
  }

  // جلب آخر النشاطات
  let recentActivities: {
    id: string;
    action: string;
    entityType: string | null;
    details: Record<string, unknown> | null;
    createdAt: Date;
    userName: string | null;
  }[] = [];
  try {
    const rawActivities = await db
      .select({
        id: activityLog.id,
        action: activityLog.action,
        entityType: activityLog.entityType,
        details: activityLog.details,
        createdAt: activityLog.createdAt,
        userName: users.name,
      })
      .from(activityLog)
      .leftJoin(users, eq(activityLog.userId, users.id))
      .where(eq(activityLog.tenantId, tenantId))
      .orderBy(desc(activityLog.createdAt))
      .limit(15);
    recentActivities = rawActivities;
  } catch {
    // ignore
  }

  // تفصيل نوع المتابعات المجدولة لليوم
  const followUpTypeLabels: Record<string, string> = {
    CALL: "مكالمة",
    WHATSAPP: "واتساب",
    EMAIL: "بريد",
    MESSAGE: "رسالة",
    MEETING: "اجتماع",
    NOTE: "ملاحظة",
  };

  let todayFollowUpsByType: { type: string; count: number }[] = [];
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const typeConditions = [
      eq(followUps.tenantId, tenantId),
      sql`${followUps.scheduledAt} >= ${startOfDay}`,
      sql`${followUps.scheduledAt} <= ${endOfDay}`,
    ];
    if (userRole === "COORDINATOR") {
      typeConditions.push(eq(followUps.userId, userId));
    }

    todayFollowUpsByType = await db
      .select({
        type: followUps.type,
        count: count(),
      })
      .from(followUps)
      .innerJoin(leads, eq(followUps.leadId, leads.id))
      .where(and(...typeConditions, eq(leads.isDeleted, false)))
      .groupBy(followUps.type);
  } catch {
    // ignore
  }

  // حجوزات اليوم — بيانات كاملة
  let todayBookingsList: {
    id: string;
    name: string;
    phone: string | null;
    bookingDate: Date | null;
    bookingService: string | null;
    bookingNotes: string | null;
    bookingStatus: string | null;
    sourceName: string | null;
    departmentName: string | null;
    departmentColor: string | null;
  }[] = [];
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    todayBookingsList = await db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        bookingDate: leads.bookingDate,
        bookingService: leads.bookingService,
        bookingNotes: leads.bookingNotes,
        bookingStatus: leads.bookingStatus,
        sourceName: leadSources.name,
        departmentName: departments.name,
        departmentColor: departments.color,
      })
      .from(leads)
      .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
      .leftJoin(departments, eq(leads.bookingDepartmentId, departments.id))
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.isDeleted, false),
          isNotNull(leads.bookingStatus),
          gte(leads.bookingDate, startOfDay),
          lte(leads.bookingDate, endOfDay)
        )
      )
      .orderBy(leads.bookingDate);
  } catch {
    // ignore
  }
  const todayBookings = todayBookingsList.length;

  const statCards = [
    {
      title: "إجمالي العملاء",
      value: stats.totalLeads.toLocaleString("ar-SA"),
      icon: Users,
      gradient: "from-blue-500/10 to-blue-600/5",
      iconBg: "bg-blue-100 text-blue-600",
      hint: "كل العملاء النشطين",
    },
    {
      title: "عملاء جدد اليوم",
      value: stats.todayLeads.toLocaleString("ar-SA"),
      icon: UserPlus,
      gradient: "from-emerald-500/10 to-emerald-600/5",
      iconBg: "bg-emerald-100 text-emerald-600",
      hint: stats.todayLeads > 0 ? `+${stats.todayLeads} منذ منتصف الليل` : "لا جديد بعد",
    },
    {
      title: "متابعات اليوم",
      value: stats.todayFollowUps.toLocaleString("ar-SA"),
      icon: PhoneCall,
      gradient: "from-amber-500/10 to-amber-600/5",
      iconBg: "bg-amber-100 text-amber-600",
      hint: "مهام مجدولة لليوم",
    },
    {
      title: "مهام مجدولة",
      value: scheduledTasks.length.toString(),
      icon: CalendarClock,
      gradient: scheduledTasks.length > 0
        ? "from-rose-500/10 to-rose-600/5"
        : "from-surface-100 to-surface-50",
      iconBg: scheduledTasks.length > 0
        ? "bg-rose-100 text-rose-600"
        : "bg-surface-100 text-surface-400",
      hint: scheduledTasks.length > 0 ? "تحتاج اهتمام" : "كل شيء تحت السيطرة",
    },
    {
      title: "حجوزات اليوم",
      value: todayBookings.toString(),
      icon: CalendarDays,
      gradient: todayBookings > 0
        ? "from-violet-500/10 to-violet-600/5"
        : "from-surface-100 to-surface-50",
      iconBg: todayBookings > 0
        ? "bg-violet-100 text-violet-600"
        : "bg-surface-100 text-surface-400",
      hint: todayBookings > 0 ? "احجوزات نشطة" : "لا حجوزات",
    },
  ];

  const totalPipeline = stats.stageBreakdown.reduce(
    (s: number, p: { count: number }) => s + p.count,
    0
  );


  return (
    <div className="space-y-8 animate-fade-in">
      {/* الترحيب */}
      <div>
        <h1 className="text-2xl font-bold text-surface-900">
          مرحباً {session.user.name} 👋
        </h1>
        <p className="text-surface-500 mt-1">
          إليك ملخص نشاط شركتك اليوم
        </p>
      </div>

      {/* تنبيهات ذكية — يظهر فقط ما يحتاج اهتمام */}
      <ReactivationBanner />
      <AgingLeadsBanner />

      {/* تنبيه المنسق: لم تربط رقم WhatsApp + عندك حملات → عملاؤك ينتظرون */}
      <MyWhatsappBanner />

      {/* تنبيه المالك: عملاء متراكمون لأن منسقين لم يربطوا أرقامهم */}
      <StuckLeadsOwnerBanner />

      {/* قائمة الإعداد الأولي — للـ tenants الجدد، تختفي عند الاكتمال */}
      {onboarding && <OnboardingChecklist status={onboarding} />}

      {/* نبض الأسبوع — للمالك/المدير فقط، يخفي نفسه إذا لا بيانات */}
      {ownerPulse && <OwnerPulseCard pulse={ownerPulse} />}

      {/* بطاقات الإحصائيات — تصميم gradient أنيق */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {statCards.map((stat) => (
          <Card
            key={stat.title}
            className={`relative overflow-hidden hover:shadow-elevated transition-all duration-300 hover:-translate-y-0.5 bg-gradient-to-br ${stat.gradient} border-surface-200/50`}
          >
            <CardContent className="p-4 lg:p-5">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div
                  className={`p-2 lg:p-2.5 rounded-xl ${stat.iconBg} shrink-0 shadow-sm`}
                >
                  <stat.icon className="h-4 w-4 lg:h-5 lg:w-5" />
                </div>
              </div>
              <p className="text-[11px] lg:text-xs text-surface-500 font-medium">
                {stat.title}
              </p>
              <p className="text-2xl lg:text-3xl font-bold text-surface-900 mt-0.5 tabular-nums leading-tight">
                {stat.value}
              </p>
              <p className="text-[10px] text-surface-400 mt-1 truncate">{stat.hint}</p>

              {/* تفصيل نوع المتابعات */}
              {stat.title === "متابعات اليوم" && todayFollowUpsByType.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-surface-100">
                  {todayFollowUpsByType.map((t) => (
                    <span
                      key={t.type}
                      className="text-[10px] bg-white/60 text-surface-600 rounded-full px-1.5 py-0.5 backdrop-blur-sm"
                    >
                      {followUpTypeLabels[t.type] || t.type} {t.count}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* رابط سريع للقمع — يبرز قيمة Meras للمالك */}
      {(userRole === "OWNER" || userRole === "ADMIN") && stats.totalLeads > 5 && (
        <a
          href="/analytics/funnel"
          className="group flex items-center justify-between gap-3 p-3 rounded-xl bg-gradient-to-l from-primary-50 to-blue-50 border border-primary-100 hover:from-primary-100 hover:to-blue-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-2xl">📊</span>
            <div>
              <p className="text-sm font-semibold text-surface-900">
                شاهد قمع التحويل الكامل
              </p>
              <p className="text-xs text-surface-500">
                من &quot;استفسار&quot; إلى &quot;صفقة&quot; — وأين تخسر العملاء
              </p>
            </div>
          </div>
          <span className="text-primary-600 group-hover:translate-x-1 transition-transform">←</span>
        </a>
      )}

      {/* مهام اليوم */}
      {scheduledTasks.length > 0 && (
        <TodayTasks tasks={scheduledTasks} />
      )}

      {/* المتابعات القادمة */}
      {upcomingTasks.length > 0 && (
        <UpcomingFollowUps tasks={upcomingTasks} />
      )}

      {/* حجوزات اليوم */}
      {todayBookingsList.length > 0 && (
        <Card className="border-purple-200 bg-purple-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-purple-600" />
                حجوزات اليوم
                <span className="bg-purple-600 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                  {todayBookingsList.length}
                </span>
              </CardTitle>
              <a
                href="/bookings"
                className="text-xs text-purple-600 hover:text-purple-800 hover:underline"
              >
                عرض الكل ←
              </a>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {todayBookingsList.map((b) => {
              const statusLabels: Record<string, string> = {
                PENDING: "⏳ بانتظار",
                COMPLETED: "✅ حضر",
                ATTENDED_NOT_SUITABLE: "😕 لم يناسبه",
                CANCELLED: "🚫 ألغى",
                NO_RESPONSE: "📵 لم يرد",
                POSTPONED: "🔄 مؤجّل",
              };
              const statusColors: Record<string, string> = {
                PENDING: "bg-yellow-50 text-yellow-700 border-yellow-200",
                COMPLETED: "bg-green-50 text-green-700 border-green-200",
                CANCELLED: "bg-gray-50 text-gray-500 border-gray-200",
                NO_RESPONSE: "bg-red-50 text-red-600 border-red-200",
                POSTPONED: "bg-blue-50 text-blue-600 border-blue-200",
                ATTENDED_NOT_SUITABLE: "bg-orange-50 text-orange-600 border-orange-200",
              };
              return (
                <div key={b.id} className="flex items-start gap-3 p-3 rounded-lg bg-white border border-surface-200 transition-all">
                  {/* الوقت */}
                  <div className="w-14 text-center shrink-0">
                    <p className="text-lg font-bold text-surface-900 tabular-nums">
                      {b.bookingDate
                        ? new Date(b.bookingDate).toLocaleTimeString("ar-SA", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Asia/Riyadh",
                          })
                        : "--:--"}
                    </p>
                  </div>

                  {/* المحتوى */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <a
                        href={`/leads?search=${encodeURIComponent(b.name)}`}
                        className="text-sm font-semibold text-surface-900 hover:text-primary-600 hover:underline"
                      >
                        {b.name}
                      </a>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${statusColors[b.bookingStatus || "PENDING"]}`}>
                        {statusLabels[b.bookingStatus || "PENDING"]}
                      </span>
                      {b.sourceName && (
                        <span className="text-[10px] text-primary-600 bg-primary-50 rounded px-1.5 py-0.5">
                          📢 {b.sourceName}
                        </span>
                      )}
                      {b.departmentName && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border"
                          style={{
                            borderColor: `${b.departmentColor}40`,
                            backgroundColor: `${b.departmentColor}14`,
                            color: b.departmentColor ?? undefined,
                          }}
                        >
                          <span
                            className="inline-block w-1 h-1 rounded-full"
                            style={{ backgroundColor: b.departmentColor ?? undefined }}
                          />
                          {b.departmentName}
                        </span>
                      )}
                    </div>
                    {b.bookingService && (
                      <p className="text-xs text-surface-500">🏷️ {b.bookingService}</p>
                    )}
                    {b.bookingNotes && (
                      <p className="text-xs text-surface-400 mt-0.5 truncate">💬 {b.bookingNotes}</p>
                    )}
                    {/* أزرار التواصل */}
                    {b.phone && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <a
                          href={`tel:${b.phone}`}
                          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 bg-primary-50 hover:bg-primary-100 px-2 py-1 rounded-lg transition-colors"
                        >
                          📞 اتصال
                        </a>
                        <a
                          href={toWhatsappUrl(b.phone) ?? "#"}
                          target="_blank"
                          rel="noopener"
                          className="flex items-center gap-1 text-xs text-success-600 hover:text-success-800 bg-success-50 hover:bg-success-100 px-2 py-1 rounded-lg transition-colors"
                        >
                          💬 واتساب
                        </a>
                        <span className="text-[10px] text-surface-300 mr-auto" dir="ltr">{b.phone}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* صف ثاني — الأنابيب + النشاطات */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ملخص الأنابيب */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">خط الأنابيب</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.stageBreakdown.length > 0 ? (
              <>
                {stats.stageBreakdown.map((stage: { stageName: string | null; stageColor: string | null; count: number }) => (
                  <div key={stage.stageName} className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: stage.stageColor || "#6B7280" }}
                    />
                    <span className="text-sm text-surface-700 flex-1 truncate">
                      {stage.stageName || "بدون مرحلة"}
                    </span>
                    <span className="text-sm font-semibold text-surface-900 tabular-nums">
                      {stage.count}
                    </span>
                    <div className="w-20 h-2 bg-surface-100 rounded-full overflow-hidden shrink-0">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${totalPipeline > 0 ? (stage.count / totalPipeline) * 100 : 0}%`,
                          backgroundColor: stage.stageColor || "#6B7280",
                        }}
                      />
                    </div>
                  </div>
                ))}
                <div className="pt-3 border-t border-surface-100 flex items-center justify-between">
                  <span className="text-sm text-surface-500">الإجمالي</span>
                  <span className="text-lg font-bold text-surface-900 tabular-nums">
                    {totalPipeline}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-surface-400 text-sm">
                <Inbox className="h-8 w-8 mx-auto mb-2 text-surface-300" />
                لا توجد بيانات بعد
              </div>
            )}
          </CardContent>
        </Card>

        {/* آخر النشاطات */}
        <ActivityLog activities={recentActivities} />
      </div>
    </div>
  );
}
