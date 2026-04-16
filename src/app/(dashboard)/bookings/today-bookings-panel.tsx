"use client";

import { useState, useTransition } from "react";
import { markBookingReminded } from "@/app/actions/bookings";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Loader2 } from "lucide-react";

type BookingSummaryItem = {
  id: string;
  name: string;
  phone: string | null;
  bookingDate: Date | null;
  bookingService: string | null;
  bookingNotes: string | null;
  sourceName: string | null;
};

export default function TodayBookingsPanel({
  today,
  tomorrow,
  overdue,
  remindedLeadIds: initialRemindedIds,
}: {
  today: BookingSummaryItem[];
  tomorrow: BookingSummaryItem[];
  overdue: BookingSummaryItem[];
  remindedLeadIds: string[];
}) {
  const [remindedIds, setRemindedIds] = useState<Set<string>>(
    new Set(initialRemindedIds)
  );
  const [isPending, startTransition] = useTransition();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleRemind = (leadId: string) => {
    setLoadingId(leadId);
    // Optimistic update
    setRemindedIds((prev) => new Set([...prev, leadId]));
    startTransition(async () => {
      try {
        await markBookingReminded(leadId);
      } catch {
        // Rollback optimistic update
        setRemindedIds((prev) => {
          const next = new Set(prev);
          next.delete(leadId);
          return next;
        });
      } finally {
        setLoadingId(null);
      }
    });
  };

  if (today.length === 0 && tomorrow.length === 0 && overdue.length === 0) {
    return null;
  }

  const renderBookingCard = (
    b: BookingSummaryItem,
    variant: "today" | "tomorrow" | "overdue"
  ) => {
    const isReminded = remindedIds.has(b.id);
    const isLoading = loadingId === b.id;

    const cardClass =
      variant === "overdue"
        ? "p-2.5 rounded-lg bg-white shadow-sm border border-danger-100 space-y-1"
        : variant === "today"
          ? `p-2.5 rounded-lg shadow-sm space-y-1 transition-all ${isReminded ? "bg-success-50 border border-success-200" : "bg-white"}`
          : "p-2.5 rounded-lg bg-surface-50 space-y-1";

    return (
      <div key={b.id} className={cardClass}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{b.name}</p>
          <div className="flex items-center gap-1">
            {/* زر التذكير — فقط لمواعيد اليوم والغد */}
            {(variant === "today" || variant === "tomorrow") && (
              <button
                onClick={() => handleRemind(b.id)}
                disabled={isReminded || isPending}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                  isReminded
                    ? "bg-success-100 text-success-700 cursor-default"
                    : "bg-primary-50 text-primary-600 hover:bg-primary-100"
                }`}
                title={isReminded ? "تم إرسال التذكير" : "سجّل أنك أرسلت التذكير"}
              >
                {isLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3 w-3" />
                )}
                {isReminded ? "تم التذكير ✓" : "تم التذكير"}
              </button>
            )}
            {b.phone && (
              <>
                <a
                  href={`tel:${b.phone}`}
                  className="p-1.5 rounded-lg hover:bg-surface-100 text-surface-500"
                  title="اتصل"
                >
                  📞
                </a>
                <a
                  href={`https://wa.me/${b.phone.replace("+", "")}`}
                  target="_blank"
                  rel="noopener"
                  className="p-1.5 rounded-lg hover:bg-success-50 text-success-600"
                  title="واتساب"
                >
                  💬
                </a>
              </>
            )}
          </div>
        </div>
        <p
          className={`text-xs ${variant === "overdue" ? "text-danger-500" : "text-surface-500"}`}
        >
          {b.bookingDate
            ? variant === "overdue"
              ? new Date(b.bookingDate).toLocaleDateString("ar-SA")
              : new Date(b.bookingDate).toLocaleTimeString("ar-SA", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Riyadh",
                })
            : ""}{" "}
          — {b.bookingService}
        </p>
        {b.sourceName && (
          <p className="text-[10px] text-primary-600 bg-primary-50 rounded px-1.5 py-0.5 inline-block">
            📢 {b.sourceName}
          </p>
        )}
        {b.bookingNotes && (
          <p className="text-[11px] text-surface-500 bg-surface-50 rounded p-1.5 mt-1">
            💬 {b.bookingNotes}
          </p>
        )}
        {variant === "tomorrow" && b.phone && (
          <p className="text-[10px] text-surface-300 mt-0.5" dir="ltr">
            {b.phone}
          </p>
        )}
      </div>
    );
  };

  // عدد المُذكَّرين اليوم
  const todayRemindedCount = today.filter((b) => remindedIds.has(b.id)).length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* مواعيد اليوم */}
      <Card
        className={
          today.length > 0 ? "border-warning-200 bg-warning-50/30" : ""
        }
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">📅</span>
              <h3 className="font-semibold text-surface-800">
                مواعيد اليوم ({today.length})
              </h3>
            </div>
            {today.length > 0 && (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  todayRemindedCount === today.length
                    ? "bg-success-100 text-success-700"
                    : "bg-warning-100 text-warning-700"
                }`}
              >
                {todayRemindedCount === today.length
                  ? "✓ تم تذكير الكل"
                  : `${todayRemindedCount}/${today.length} تم تذكيرهم`}
              </span>
            )}
          </div>
          {today.length === 0 ? (
            <p className="text-sm text-surface-400">لا توجد مواعيد اليوم</p>
          ) : (
            <div className="space-y-2">
              {today.map((b) => renderBookingCard(b, "today"))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* مواعيد الغد */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">📆</span>
            <h3 className="font-semibold text-surface-800">
              مواعيد الغد ({tomorrow.length})
            </h3>
          </div>
          {tomorrow.length === 0 ? (
            <p className="text-sm text-surface-400">لا توجد مواعيد الغد</p>
          ) : (
            <div className="space-y-2">
              {tomorrow.map((b) => renderBookingCard(b, "tomorrow"))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* المتأخرة */}
      <Card
        className={
          overdue.length > 0 ? "border-danger-200 bg-danger-50/30" : ""
        }
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">⚠️</span>
            <h3 className="font-semibold text-surface-800">
              متأخرة ({overdue.length})
            </h3>
          </div>
          {overdue.length === 0 ? (
            <p className="text-sm text-surface-400">
              لا توجد مواعيد متأخرة 🎉
            </p>
          ) : (
            <div className="space-y-2">
              {overdue.map((b) => renderBookingCard(b, "overdue"))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
