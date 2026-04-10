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
import { requireAuth } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { activityLog, users, followUps, leads } from "@/db/schema";
import { eq, and, desc, lte, gte, isNull, isNotNull, sql, count } from "drizzle-orm";
import TodayTasks from "./today-tasks";
import ActivityLog from "./activity-log";

export default async function DashboardPage() {
  const session = await requireAuth();
  const user = session.user as Record<string, unknown>;
  const tenantId = user.tenantId as string;
  const userId = session.user.id;
  const userRole = user.role as string;

  if (!tenantId) {
    redirect("/register");
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
      })
      .from(followUps)
      .innerJoin(leads, eq(followUps.leadId, leads.id))
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

  // إحصائيات الحجوزات
  let todayBookings = 0;
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const [result] = await db
      .select({ count: count() })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.isDeleted, false),
          isNotNull(leads.bookingStatus),
          gte(leads.bookingDate, startOfDay),
          lte(leads.bookingDate, endOfDay)
        )
      );
    todayBookings = result?.count || 0;
  } catch {
    // ignore
  }

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
