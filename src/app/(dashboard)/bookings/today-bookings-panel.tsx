"use client";

import { useState, useTransition } from "react";
import { markBookingReminded, updateBookingStatus, updateBookingDate } from "@/app/actions/bookings";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, X, Calendar } from "lucide-react";

type BookingSummaryItem = {
  id: string;
  name: string;
  phone: string | null;
  bookingDate: Date | null;
  bookingService: string | null;
  bookingNotes: string | null;
  sourceName: string | null;
};

type RescheduleData = {
  leadId: string;
  leadName: string;
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
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

  // نافذة إعادة الجدولة
  const [rescheduleModal, setRescheduleModal] = useState<RescheduleData | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");

  const handleRemind = (leadId: string) => {
    setLoadingId(leadId);
    setRemindedIds((prev) => new Set([...prev, leadId]));
    startTransition(async () => {
      try {
        await markBookingReminded(leadId);
      } catch {
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

  // إجراءات المواعيد المتأخرة
  const handleOverdueAction = (leadId: string, status: string) => {
    setLoadingId(leadId);
    setResolvedIds((prev) => new Set([...prev, leadId]));
    startTransition(async () => {
      try {
        await updateBookingStatus({ leadId, status });
      } catch {
        setResolvedIds((prev) => {
          const next = new Set(prev);
          next.delete(leadId);
          return next;
        });
      } finally {
        setLoadingId(null);
      }
    });
  };

  const handleRescheduleConfirm = () => {
    if (!rescheduleModal || !rescheduleDate) return;
    setLoadingId(rescheduleModal.leadId);
    setResolvedIds((prev) => new Set([...prev, rescheduleModal.leadId]));
    startTransition(async () => {
      try {
        await updateBookingDate({
          leadId: rescheduleModal.leadId,
          bookingDate: rescheduleDate,
        });
        // أعد لـ PENDING بالموعد الجديد
        await updateBookingStatus({ leadId: rescheduleModal.leadId, status: "PENDING" });
        setRescheduleModal(null);
        setRescheduleDate("");
      } catch {
        setResolvedIds((prev) => {
          const next = new Set(prev);
          if (rescheduleModal) next.delete(rescheduleModal.leadId);
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
    const isResolved = resolvedIds.has(b.id);

    // بطاقة تم حلها — أخفيها بتأثير
    if (variant === "overdue" && isResolved) {
      return (
        <div key={b.id} className="p-2.5 rounded-lg bg-success-50 border border-success-200 text-center transition-all">
          <p className="text-xs text-success-700 font-medium">✓ تم معالجة {b.name}</p>
        </div>
      );
    }

    const cardClass =
      variant === "overdue"
        ? "p-2.5 rounded-lg bg-white shadow-sm border border-danger-100 space-y-1.5"
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
              ? new Date(b.bookingDate).toLocaleDateString("ar-SA-u-ca-gregory")
              : new Date(b.bookingDate).toLocaleTimeString("ar-SA-u-ca-gregory", {
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

        {/* ===== أزرار الإجراءات السريعة — المواعيد المتأخرة فقط ===== */}
        {variant === "overdue" && (
          <div className="flex items-center gap-1.5 pt-1.5 border-t border-danger-50">
            <button
              onClick={() => handleOverdueAction(b.id, "COMPLETED")}
              disabled={isPending}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-success-50 text-success-700 hover:bg-success-100 transition-all"
              title="حضر العميل"
            >
              ✅ حضر
            </button>
            <button
              onClick={() => handleOverdueAction(b.id, "NO_RESPONSE")}
              disabled={isPending}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-danger-50 text-danger-700 hover:bg-danger-100 transition-all"
              title="لم يحضر ولم يرد"
            >
              📵 لم يحضر
            </button>
            <button
              onClick={() => setRescheduleModal({ leadId: b.id, leadName: b.name })}
              disabled={isPending}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all"
              title="إعادة جدولة الموعد"
            >
              🔄 إعادة جدولة
            </button>
            <button
              onClick={() => handleOverdueAction(b.id, "CANCELLED")}
              disabled={isPending}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-surface-100 text-surface-600 hover:bg-surface-200 transition-all"
              title="إلغاء الموعد"
            >
              🚫 إلغاء
            </button>
            {isLoading && <Loader2 className="h-3 w-3 animate-spin text-surface-400" />}
          </div>
        )}
      </div>
    );
  };

  // عدد المُذكَّرين اليوم
  const todayRemindedCount = today.filter((b) => remindedIds.has(b.id)).length;
  const activeOverdue = overdue.filter((b) => !resolvedIds.has(b.id));

  return (
    <>
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
            activeOverdue.length > 0 ? "border-danger-200 bg-danger-50/30" : ""
          }
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚠️</span>
                <h3 className="font-semibold text-surface-800">
                  متأخرة ({activeOverdue.length})
                </h3>
              </div>
              {overdue.length > 0 && resolvedIds.size > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-success-100 text-success-700">
                  ✓ {resolvedIds.size} تمت معالجتها
                </span>
              )}
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

      {/* نافذة إعادة الجدولة */}
      {rescheduleModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setRescheduleModal(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 mx-4 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-surface-900">
                🔄 إعادة جدولة {rescheduleModal.leadName}
              </h3>
              <button
                onClick={() => setRescheduleModal(null)}
                className="p-1 rounded-lg hover:bg-surface-100"
              >
                <X className="h-4 w-4 text-surface-400" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-sm">الموعد الجديد *</Label>
                <Input
                  type="datetime-local"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  dir="ltr"
                  required
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleRescheduleConfirm}
                  disabled={!rescheduleDate || isPending}
                  className="flex-1 gap-1.5"
                  size="sm"
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Calendar className="h-3.5 w-3.5" />
                  )}
                  تأكيد الموعد الجديد
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRescheduleModal(null)}
                >
                  إلغاء
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
