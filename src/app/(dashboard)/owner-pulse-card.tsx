import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus, Trophy, AlertTriangle, Megaphone, Zap } from "lucide-react";
import type { OwnerPulse } from "@/app/actions/owner-pulse";

function trendIcon(current: number, previous: number) {
  if (current > previous) {
    const delta = previous === 0 ? null : Math.round(((current - previous) / previous) * 100);
    return {
      Icon: TrendingUp,
      cls: "text-success-600 bg-success-50",
      label: delta !== null ? `+${delta}%` : "جديد",
    };
  }
  if (current < previous) {
    const delta = previous === 0 ? null : Math.round(((previous - current) / previous) * 100);
    return {
      Icon: TrendingDown,
      cls: "text-danger-600 bg-danger-50",
      label: delta !== null ? `-${delta}%` : "أقل",
    };
  }
  return {
    Icon: Minus,
    cls: "text-surface-500 bg-surface-100",
    label: "ثابت",
  };
}

export default function OwnerPulseCard({ pulse }: { pulse: OwnerPulse }) {
  // إذا كل البيانات صفر، لا تعرض شيئاً (tenant جديد بدون نشاط)
  const hasAnyData =
    pulse.newLeads.today > 0 ||
    pulse.newLeads.yesterday > 0 ||
    pulse.bookings.thisWeek > 0 ||
    pulse.bookings.lastWeek > 0;
  if (!hasAnyData) return null;

  const leadsTrend = trendIcon(pulse.newLeads.today, pulse.newLeads.yesterday);
  const bookingsTrend = trendIcon(pulse.bookings.thisWeek, pulse.bookings.lastWeek);
  const conversionTrend = trendIcon(pulse.conversion.thisWeek, pulse.conversion.lastWeek);

  return (
    <Card className="border-primary-200 bg-gradient-to-br from-primary-50/30 via-white to-blue-50/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 shadow-md">
            <Zap className="h-4 w-4 text-white" />
          </div>
          نبض الأسبوع
          <span className="text-xs text-surface-400 font-normal">— مقارنة بآخر فترة</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* الأرقام المقارنة — 3 أعمدة */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* عملاء جدد اليوم */}
          <div className="p-3 rounded-xl bg-white border border-surface-200 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] text-surface-500 font-medium">عملاء جدد اليوم</p>
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${leadsTrend.cls}`}
              >
                <leadsTrend.Icon className="h-3 w-3" />
                {leadsTrend.label}
              </span>
            </div>
            <p className="text-2xl font-bold text-surface-900 tabular-nums">
              {pulse.newLeads.today}
            </p>
            <p className="text-[11px] text-surface-400">أمس: {pulse.newLeads.yesterday}</p>
          </div>

          {/* حجوزات الأسبوع */}
          <div className="p-3 rounded-xl bg-white border border-surface-200 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] text-surface-500 font-medium">حجوزات الأسبوع</p>
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${bookingsTrend.cls}`}
              >
                <bookingsTrend.Icon className="h-3 w-3" />
                {bookingsTrend.label}
              </span>
            </div>
            <p className="text-2xl font-bold text-surface-900 tabular-nums">
              {pulse.bookings.thisWeek}
            </p>
            <p className="text-[11px] text-surface-400">الأسبوع السابق: {pulse.bookings.lastWeek}</p>
          </div>

          {/* معدل التحويل (حضر) */}
          <div className="p-3 rounded-xl bg-white border border-surface-200 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] text-surface-500 font-medium">معدل الحضور</p>
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${conversionTrend.cls}`}
              >
                <conversionTrend.Icon className="h-3 w-3" />
                {conversionTrend.label}
              </span>
            </div>
            <p className="text-2xl font-bold text-surface-900 tabular-nums">
              {pulse.conversion.thisWeek}%
            </p>
            <p className="text-[11px] text-surface-400">
              السابق: {pulse.conversion.lastWeek}% ({pulse.conversion.thisWeekTotal} حضوراً)
            </p>
          </div>
        </div>

        {/* الـ insights — 3 جمل قصيرة */}
        <div className="space-y-1.5 pt-1">
          {pulse.topPerformer && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-success-50/50 border border-success-100 text-sm">
              <Trophy className="h-4 w-4 text-warning-500 shrink-0" />
              <span className="text-surface-700">
                <span className="font-semibold text-surface-900">{pulse.topPerformer.userName}</span>
                {" "}نجم الأسبوع — حقق{" "}
                <span className="font-semibold tabular-nums">{pulse.topPerformer.attendedCount}</span>
                {" "}حضور 🎉
              </span>
            </div>
          )}

          {pulse.needsAttention && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-warning-50/50 border border-warning-100 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning-600 shrink-0" />
              <span className="text-surface-700">
                <span className="font-semibold text-surface-900">{pulse.needsAttention.userName}</span>
                {" "}عندها{" "}
                <span className="font-semibold text-warning-700 tabular-nums">
                  {pulse.needsAttention.overdueCount}
                </span>
                {" "}متابعة متأخرة — ربما تحتاج مساعدة
              </span>
            </div>
          )}

          {pulse.topSource && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary-50/50 border border-primary-100 text-sm">
              <Megaphone className="h-4 w-4 text-primary-600 shrink-0" />
              <span className="text-surface-700">
                أفضل مصدر هذا الأسبوع:{" "}
                <span className="font-semibold text-surface-900">{pulse.topSource.sourceName}</span>
                {" "}—{" "}
                <span className="font-semibold tabular-nums">{pulse.topSource.conversions}</span>
                {" "}عميل حضر
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
