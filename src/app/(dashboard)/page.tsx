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
import { redirect } from "next/navigation";
import { db } from "@/db";
import { activityLog, users, followUps, leads, leadSources } from "@/db/schema";
import { eq, and, desc, lte, gte, isNull, isNotNull, sql, count } from "drizzle-orm";
import TodayTasks from "./today-tasks";
import ActivityLog from "./activity-log";

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
      })
      .from(leads)
      .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
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
      color: "bg-primary-50 text-primary-600",
    },
    {
      title: "عملاء جدد اليوم",
      value: stats.todayLeads.toLocaleString("ar-SA"),
      icon: UserPlus,
      color: "bg-success-50 text-success-600",
    },
    {
      title: "متابعات اليوم",
      value: stats.todayFollowUps.toLocaleString("ar-SA"),
      icon: PhoneCall,
      color: "bg-warning-50 text-warning-600",
    },
    {
      title: "مهام مجدولة",
      value: scheduledTasks.length.toString(),
      icon: CalendarClock,
      color: scheduledTasks.length > 0 ? "bg-danger-50 text-danger-600" : "bg-surface-50 text-surface-500",
    },
    {
      title: "حجوزات اليوم",
      value: todayBookings.toString(),
      icon: CalendarDays,
      color: todayBookings > 0 ? "bg-purple-50 text-purple-600" : "bg-surface-50 text-surface-500",
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

      {/* بطاقات الإحصائيات */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.title} className="hover:shadow-elevated transition-shadow">
            <CardContent className="p-4 lg:p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs lg:text-sm text-surface-500 truncate">{stat.title}</p>
                  <p className="text-xl lg:text-2xl font-bold text-surface-900 mt-1">{stat.value}</p>
                </div>
                <div className={`p-2 lg:p-2.5 rounded-xl ${stat.color} shrink-0`}>
                  <stat.icon className="h-4 w-4 lg:h-5 lg:w-5" />
                </div>
              </div>
              {/* تفصيل نوع المتابعات */}
              {stat.title === "متابعات اليوم" && todayFollowUpsByType.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-surface-100">
                  {todayFollowUpsByType.map((t) => (
                    <span key={t.type} className="text-[10px] bg-surface-100 text-surface-600 rounded-full px-1.5 py-0.5">
                      {followUpTypeLabels[t.type] || t.type} {t.count}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* مهام اليوم */}
      {scheduledTasks.length > 0 && (
        <TodayTasks tasks={scheduledTasks} />
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
                          href={`https://wa.me/${b.phone.replace("+", "")}`}
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
