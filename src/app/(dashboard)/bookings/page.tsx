import { requireAuth } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { getBookings, getBookingsSummary } from "@/app/actions/bookings";
import BookingBoard from "./booking-board";
import { CalendarDays, Clock, AlertTriangle, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default async function BookingsPage() {
  const session = await requireAuth();
  const tenantId = (session.user as Record<string, unknown>).tenantId as string;
  if (!tenantId) redirect("/register");

  let bookings: Awaited<ReturnType<typeof getBookings>> = [];
  let summary: Awaited<ReturnType<typeof getBookingsSummary>> = {
    today: [], tomorrow: [], overdue: [],
    stats: { total: 0, pending: 0, completed: 0, noShow: 0, cancelled: 0 },
  };

  try {
    [bookings, summary] = await Promise.all([
      getBookings(),
      getBookingsSummary(),
    ]);
  } catch {
    // الأعمدة لم تُنشأ بعد — نعرض صفحة فارغة
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-surface-900">إدارة الحجوزات</h1>
        <p className="text-surface-500 mt-1">تتبع مواعيد العملاء وحالاتهم</p>
      </div>

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

      {/* لوحة المواعيد: اليوم + الغد + المتأخرة */}
      {(summary.today.length > 0 || summary.tomorrow.length > 0 || summary.overdue.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* مواعيد اليوم */}
          <Card className={summary.today.length > 0 ? "border-warning-200 bg-warning-50/30" : ""}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">📅</span>
                <h3 className="font-semibold text-surface-800">مواعيد اليوم ({summary.today.length})</h3>
              </div>
              {summary.today.length === 0 ? (
                <p className="text-sm text-surface-400">لا توجد مواعيد اليوم</p>
              ) : (
                <div className="space-y-2">
                  {summary.today.map((b) => (
                    <div key={b.id} className="flex items-center justify-between p-2 rounded-lg bg-white shadow-sm">
                      <div>
                        <p className="text-sm font-medium">{b.name}</p>
                        <p className="text-xs text-surface-500">
                          {b.bookingDate ? new Date(b.bookingDate).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : ""} — {b.bookingService}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {b.phone && (
                          <>
                            <a href={`tel:${b.phone}`} className="p-1.5 rounded-lg hover:bg-surface-100 text-surface-500" title="اتصل">📞</a>
                            <a href={`https://wa.me/${b.phone.replace("+", "")}`} target="_blank" rel="noopener" className="p-1.5 rounded-lg hover:bg-success-50 text-success-600" title="واتساب">💬</a>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* مواعيد الغد */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">📆</span>
                <h3 className="font-semibold text-surface-800">مواعيد الغد ({summary.tomorrow.length})</h3>
              </div>
              {summary.tomorrow.length === 0 ? (
                <p className="text-sm text-surface-400">لا توجد مواعيد الغد</p>
              ) : (
                <div className="space-y-2">
                  {summary.tomorrow.map((b) => (
                    <div key={b.id} className="flex items-center justify-between p-2 rounded-lg bg-surface-50">
                      <div>
                        <p className="text-sm font-medium">{b.name}</p>
                        <p className="text-xs text-surface-500">
                          {b.bookingDate ? new Date(b.bookingDate).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : ""} — {b.bookingService}
                        </p>
                      </div>
                      {b.phone && (
                        <a href={`https://wa.me/${b.phone.replace("+", "")}`} target="_blank" rel="noopener" className="p-1.5 rounded-lg hover:bg-success-50 text-success-600">💬</a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* المتأخرة */}
          <Card className={summary.overdue.length > 0 ? "border-danger-200 bg-danger-50/30" : ""}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">⚠️</span>
                <h3 className="font-semibold text-surface-800">متأخرة ({summary.overdue.length})</h3>
              </div>
              {summary.overdue.length === 0 ? (
                <p className="text-sm text-surface-400">لا توجد مواعيد متأخرة 🎉</p>
              ) : (
                <div className="space-y-2">
                  {summary.overdue.map((b) => (
                    <div key={b.id} className="flex items-center justify-between p-2 rounded-lg bg-white shadow-sm border border-danger-100">
                      <div>
                        <p className="text-sm font-medium">{b.name}</p>
                        <p className="text-xs text-danger-500">
                          {b.bookingDate ? new Date(b.bookingDate).toLocaleDateString("ar-SA") : ""} — {b.bookingService}
                        </p>
                      </div>
                      {b.phone && (
                        <a href={`tel:${b.phone}`} className="p-1.5 rounded-lg hover:bg-danger-50 text-danger-500" title="اتصل الآن!">📞</a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Kanban الحجوزات */}
      <BookingBoard bookings={bookings} />
    </div>
  );
}
