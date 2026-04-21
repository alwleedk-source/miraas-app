import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { getBookings, getBookingsSummary } from "@/app/actions/bookings";
import BookingBoard from "./booking-board";
import BookingsHeader from "./bookings-header";
import TodayBookingsPanel from "./today-bookings-panel";
import InternalMessagesBar from "./internal-messages-bar";
import { CalendarDays, Clock, AlertTriangle, TrendingUp, BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/db";
import { services, departments, users } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";

export default async function BookingsPage() {
  const { tenantId, role } = await requireTenant();
  if (!tenantId) redirect("/register");
  if (role === "PROVIDER") redirect("/provider");

  let bookings: Awaited<ReturnType<typeof getBookings>> = [];
  let summary: Awaited<ReturnType<typeof getBookingsSummary>> = {
    today: [], tomorrow: [], overdue: [],
    stats: { total: 0, pending: 0, completed: 0, noShow: 0, cancelled: 0 },
    campaignStats: [],
    remindedLeadIds: [],
  };

  try {
    [bookings, summary] = await Promise.all([
      getBookings(),
      getBookingsSummary(),
    ]);
  } catch {
    // الأعمدة لم تُنشأ بعد — نعرض صفحة فارغة
  }

  // جلب الخدمات النشطة مع القسم والمدة الافتراضية
  let servicesData: { id: string; name: string; departmentId: string | null; defaultDurationMin: number | null }[] = [];
  try {
    servicesData = await db
      .select({
        id: services.id,
        name: services.name,
        departmentId: services.departmentId,
        defaultDurationMin: services.defaultDurationMin,
      })
      .from(services)
      .where(and(eq(services.tenantId, tenantId), eq(services.isActive, true)))
      .orderBy(asc(services.name));
  } catch {}

  // جلب الأقسام النشطة
  let departmentsData: { id: string; name: string; color: string; defaultGapMinutes: number }[] = [];
  try {
    departmentsData = await db
      .select({
        id: departments.id,
        name: departments.name,
        color: departments.color,
        defaultGapMinutes: departments.defaultGapMinutes,
      })
      .from(departments)
      .where(and(eq(departments.tenantId, tenantId), eq(departments.isActive, true)))
      .orderBy(asc(departments.position));
  } catch {}

  // جلب الرسائل الداخلية غير المقروءة من مقدمي الخدمة
  let internalMessages: { id: string; content: string; senderRole: string; senderId: string; messageType: string; createdAt: Date; isRead: boolean }[] = [];
  try {
    const { getUnreadMessagesForCoordinator } = await import("@/app/actions/provider");
    internalMessages = await getUnreadMessagesForCoordinator();
  } catch {}

  // جلب مقدمي الخدمة (PROVIDER)
  let providersData: { id: string; name: string }[] = [];
  try {
    providersData = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "PROVIDER"), eq(users.isActive, true)))
      .orderBy(asc(users.name));
  } catch {}

  return (
    <div className="space-y-6 animate-fade-in">
      {/* العنوان + زر موعد سريع */}
      <BookingsHeader services={servicesData} departments={departmentsData} />

      {/* رسائل مقدمي الخدمة */}
      {internalMessages.length > 0 && (
        <InternalMessagesBar messages={internalMessages} />
      )}

      {/* إحصائيات سريعة */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
              <CalendarDays className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{summary.stats.total}</p>
              <p className="text-xs text-surface-500">إجمالي الحجوزات</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warning-50 flex items-center justify-center">
              <Clock className="h-5 w-5 text-warning-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{summary.stats.pending}</p>
              <p className="text-xs text-surface-500">بانتظار</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success-50 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-success-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{summary.stats.completed}</p>
              <p className="text-xs text-surface-500">حضروا ✅</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-danger-50 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-danger-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{summary.overdue.length}</p>
              <p className="text-xs text-surface-500">متأخرة ⚠️</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* إحصائيات الحملات */}
      {summary.campaignStats.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-primary-500" />
              <h3 className="font-semibold text-sm text-surface-800">الحجوزات حسب الحملة</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.campaignStats.map((cs) => (
                <div
                  key={cs.sourceName}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-50 border border-primary-100"
                >
                  <span className="text-xs font-medium text-primary-700">{cs.sourceName}</span>
                  <span className="text-xs font-bold text-primary-900 bg-primary-200 rounded-full w-6 h-6 flex items-center justify-center">
                    {cs.count}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* لوحة المواعيد التفاعلية: اليوم + الغد + المتأخرة مع أزرار التذكير */}
      <TodayBookingsPanel
        today={summary.today}
        tomorrow={summary.tomorrow}
        overdue={summary.overdue}
        remindedLeadIds={summary.remindedLeadIds}
      />

      {/* Kanban الحجوزات أو Empty State */}
      {bookings.length > 0 ? (
        <BookingBoard bookings={bookings} services={servicesData} departments={departmentsData} providers={providersData} />
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <CalendarDays className="h-12 w-12 mx-auto mb-4 text-surface-300" />
            <h3 className="text-lg font-semibold text-surface-700 mb-2">
              لا توجد حجوزات بعد
            </h3>
            <p className="text-surface-500 text-sm mb-4">
              اضغط على &quot;موعد سريع&quot; لإنشاء أول حجز، أو اذهب لصفحة العملاء
            </p>
            <a
              href="/leads"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
            >
              ← اذهب للعملاء
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
