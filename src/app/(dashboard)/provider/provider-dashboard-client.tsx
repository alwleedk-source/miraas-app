"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Phone,
  User,
  MessageCircle,
  Send,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Pencil,
  Loader2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  sendQuickMessage,
  updateProviderBookingStatus,
  addProviderSessionNote,
} from "@/app/actions/provider";

type Booking = {
  id: string;
  name: string;
  phone: string | null;
  bookingStatus: string | null;
  bookingDate: Date | null;
  bookingEndTime?: Date | null;
  bookingService: string | null;
  bookingDurationMin: number | null;
  bookingNotes?: string | null;
};

type Dashboard = {
  providerName: string;
  todayBookings: Booking[];
  tomorrowBookings: Booking[];
  todayCount: number;
  tomorrowCount: number;
  pendingToday: number;
  unreadMessages: { id: string; content: string; senderRole: string; createdAt: Date }[];
};

const QUICK_MESSAGES = [
  { label: "🕐 سأتأخر 10 دقائق", value: "سأتأخر 10 دقائق", type: "QUICK_STATUS" },
  { label: "🕐 سأتأخر 15 دقيقة", value: "سأتأخر 15 دقيقة", type: "QUICK_STATUS" },
  { label: "⏸️ استراحة 15 دقيقة", value: "أحتاج استراحة 15 دقيقة", type: "QUICK_STATUS" },
  { label: "📢 أرسلوا التالي", value: "أرسلوا المريض التالي", type: "QUICK_STATUS" },
];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING: { label: "بانتظار", color: "bg-warning-100 text-warning-700" },
  COMPLETED: { label: "حضر ✅", color: "bg-success-100 text-success-700" },
  ATTENDED_NOT_SUITABLE: { label: "حضر - لم يناسبه", color: "bg-orange-100 text-orange-700" },
  CANCELLED: { label: "ملغي", color: "bg-danger-100 text-danger-700" },
  NO_RESPONSE: { label: "لم يحضر", color: "bg-surface-100 text-surface-600" },
  POSTPONED: { label: "مؤجل", color: "bg-blue-100 text-blue-700" },
};

function formatTime(date: Date | null): string {
  if (!date) return "--:--";
  return new Date(date).toLocaleTimeString("ar-SA-u-ca-gregory", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Riyadh",
  });
}

function formatDate(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("ar-SA-u-ca-gregory", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Riyadh",
  });
}

export default function ProviderDashboardClient({ dashboard }: { dashboard: Dashboard }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [customMessage, setCustomMessage] = useState("");
  const [messageSent, setMessageSent] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [showTomorrow, setShowTomorrow] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const handleStatusUpdate = (
    leadId: string,
    leadName: string,
    status: "COMPLETED" | "ATTENDED_NOT_SUITABLE" | "NO_RESPONSE",
  ) => {
    setActionLoadingId(leadId);
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await updateProviderBookingStatus(leadId, status);
        if (!res.success) {
          setActionError(res.error);
          setTimeout(() => setActionError(null), 5000);
          return;
        }
        const labelMap: Record<typeof status, string> = {
          COMPLETED: `حضر ${leadName} ✓`,
          ATTENDED_NOT_SUITABLE: `حضر ${leadName} (لم يناسبه)`,
          NO_RESPONSE: `${leadName} لم يحضر`,
        };
        setActionSuccess(labelMap[status]);
        setTimeout(() => setActionSuccess(null), 3000);
        router.refresh();
      } catch {
        setActionError("فشل التحديث — حاول مجدداً");
        setTimeout(() => setActionError(null), 5000);
      } finally {
        setActionLoadingId(null);
      }
    });
  };

  const handleAddNote = (leadId: string) => {
    if (!noteText.trim()) return;
    setActionLoadingId(leadId);
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await addProviderSessionNote(leadId, noteText.trim());
        if (!res.success) {
          setActionError(res.error);
          setTimeout(() => setActionError(null), 5000);
          return;
        }
        setNoteFor(null);
        setNoteText("");
        setActionSuccess("📝 تمت إضافة الملاحظة");
        setTimeout(() => setActionSuccess(null), 3000);
        router.refresh();
      } catch {
        setActionError("فشل حفظ الملاحظة — حاول مجدداً");
        setTimeout(() => setActionError(null), 5000);
      } finally {
        setActionLoadingId(null);
      }
    });
  };

  const handleQuickMessage = (msg: string, type: string) => {
    setMessageError(null);
    startTransition(async () => {
      try {
        const res = await sendQuickMessage(msg, type);
        if (!res.success) {
          setMessageError(res.error);
          setTimeout(() => setMessageError(null), 5000);
          return;
        }
        setMessageSent(true);
        setTimeout(() => setMessageSent(false), 3000);
      } catch {
        setMessageError("تعذّر إرسال الرسالة — حاول مجدداً");
        setTimeout(() => setMessageError(null), 5000);
      }
    });
  };

  const handleCustomMessage = () => {
    if (!customMessage.trim()) return;
    handleQuickMessage(customMessage.trim(), "CUSTOM");
    setCustomMessage("");
  };

  const activeBookings = showTomorrow ? dashboard.tomorrowBookings : dashboard.todayBookings;
  const activeLabel = showTomorrow ? "الغد" : "اليوم";

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* الترحيب */}
      <div className="text-center py-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center mb-3 shadow-lg">
          <User className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-xl font-bold text-surface-900">
          مرحباً {dashboard.providerName}
        </h1>
        <p className="text-sm text-surface-500 mt-1">
          {formatDate(new Date())}
        </p>
      </div>

      {/* إحصائيات سريعة */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl p-4 text-center shadow-sm border border-surface-100">
          <p className="text-2xl font-bold text-primary-600">{dashboard.todayCount}</p>
          <p className="text-xs text-surface-500 mt-1">مواعيد اليوم</p>
        </div>
        <div className="bg-white rounded-xl p-4 text-center shadow-sm border border-surface-100">
          <p className="text-2xl font-bold text-warning-600">{dashboard.pendingToday}</p>
          <p className="text-xs text-surface-500 mt-1">بانتظار</p>
        </div>
        <div className="bg-white rounded-xl p-4 text-center shadow-sm border border-surface-100">
          <p className="text-2xl font-bold text-surface-600">{dashboard.tomorrowCount}</p>
          <p className="text-xs text-surface-500 mt-1">مواعيد الغد</p>
        </div>
      </div>

      {/* التبديل بين اليوم والغد */}
      <div className="flex items-center justify-between bg-white rounded-xl p-3 shadow-sm border border-surface-100">
        <button
          onClick={() => setShowTomorrow(false)}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
            !showTomorrow
              ? "bg-primary-600 text-white shadow-sm"
              : "text-surface-600 hover:bg-surface-50"
          }`}
        >
          <CalendarDays className="h-4 w-4 inline-block me-1" />
          اليوم ({dashboard.todayCount})
        </button>
        <button
          onClick={() => setShowTomorrow(true)}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
            showTomorrow
              ? "bg-primary-600 text-white shadow-sm"
              : "text-surface-600 hover:bg-surface-50"
          }`}
        >
          <CalendarDays className="h-4 w-4 inline-block me-1" />
          الغد ({dashboard.tomorrowCount})
        </button>
      </div>

      {/* قائمة المواعيد */}
      <div className="bg-white rounded-xl shadow-sm border border-surface-100 overflow-hidden">
        <div className="p-4 border-b border-surface-100">
          <h2 className="text-base font-bold text-surface-900 flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary-500" />
            مواعيد {activeLabel}
          </h2>
        </div>

        {/* رسائل النجاح/الخطأ — تطفو فوق القائمة */}
        {(actionSuccess || actionError) && (
          <div className="px-4 pt-3">
            {actionSuccess && (
              <div className="p-2 rounded-lg bg-success-50 text-success-700 text-xs text-center font-medium animate-fade-in">
                {actionSuccess}
              </div>
            )}
            {actionError && (
              <div className="p-2 rounded-lg bg-danger-50 text-danger-700 text-xs text-center font-medium animate-fade-in">
                ❌ {actionError}
              </div>
            )}
          </div>
        )}

        {activeBookings.length === 0 ? (
          <div className="p-8 text-center">
            <CalendarDays className="h-10 w-10 mx-auto mb-3 text-surface-200" />
            <p className="text-sm text-surface-400">لا توجد مواعيد {activeLabel}</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-50">
            {activeBookings.map((booking) => {
              const status = STATUS_LABELS[booking.bookingStatus || "PENDING"];
              const isPending_ = booking.bookingStatus === "PENDING" || !booking.bookingStatus;
              const isLoading = actionLoadingId === booking.id;
              const isAddingNote = noteFor === booking.id;
              return (
                <div
                  key={booking.id}
                  className="p-4 hover:bg-surface-50/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-primary-600">
                          {formatTime(booking.bookingDate)}
                        </span>
                        <span className="text-[10px] text-surface-400">
                          ({booking.bookingDurationMin || 30} دقيقة)
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-surface-900">
                        {booking.name}
                      </p>
                      {booking.phone && (
                        <a
                          href={`tel:${booking.phone}`}
                          className="text-xs text-surface-500 flex items-center gap-1 mt-0.5 hover:text-primary-600"
                          dir="ltr"
                        >
                          <Phone className="h-3 w-3" />
                          {booking.phone}
                        </a>
                      )}
                      {booking.bookingService && (
                        <p className="text-xs text-surface-500 mt-1">
                          🏷️ {booking.bookingService}
                        </p>
                      )}
                      {booking.bookingNotes && (
                        <p className="text-xs text-surface-400 mt-1 italic whitespace-pre-line">
                          {booking.bookingNotes}
                        </p>
                      )}
                    </div>
                    <span
                      className={`text-[10px] px-2.5 py-1 rounded-full font-medium ${status.color}`}
                    >
                      {status.label}
                    </span>
                  </div>

                  {/* أزرار التحديث — للمواعيد المعلّقة فقط (اليوم) */}
                  {isPending_ && !showTomorrow && !isAddingNote && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-surface-100">
                      <button
                        onClick={() => handleStatusUpdate(booking.id, booking.name, "COMPLETED")}
                        disabled={isLoading || isPending}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-success-50 text-success-700 hover:bg-success-100 disabled:opacity-50 transition-all"
                      >
                        {isLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        حضر
                      </button>
                      <button
                        onClick={() => handleStatusUpdate(booking.id, booking.name, "ATTENDED_NOT_SUITABLE")}
                        disabled={isLoading || isPending}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50 transition-all"
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                        لم يناسبه
                      </button>
                      <button
                        onClick={() => handleStatusUpdate(booking.id, booking.name, "NO_RESPONSE")}
                        disabled={isLoading || isPending}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-danger-50 text-danger-700 hover:bg-danger-100 disabled:opacity-50 transition-all"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        لم يحضر
                      </button>
                      <button
                        onClick={() => { setNoteFor(booking.id); setNoteText(""); }}
                        disabled={isLoading || isPending}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-50 text-surface-600 hover:bg-surface-100 disabled:opacity-50 transition-all ms-auto"
                        title="إضافة ملاحظة جلسة"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        ملاحظة
                      </button>
                    </div>
                  )}

                  {/* زر "ملاحظة" — حتى لو الموعد ليس PENDING */}
                  {!isPending_ && !isAddingNote && !showTomorrow && (
                    <button
                      onClick={() => { setNoteFor(booking.id); setNoteText(""); }}
                      disabled={isLoading || isPending}
                      className="mt-2 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-surface-50 text-surface-500 hover:bg-surface-100 transition-all"
                    >
                      <Pencil className="h-3 w-3" />
                      أضف ملاحظة جلسة
                    </button>
                  )}

                  {/* حقل إدخال الملاحظة */}
                  {isAddingNote && (
                    <div className="mt-3 pt-3 border-t border-surface-100 space-y-2">
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="ملاحظة الجلسة (مثل: أنصح بمتابعة بعد أسبوع، يحتاج فحص مخبري...)"
                        className="w-full p-2 rounded-lg border border-surface-200 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                        rows={3}
                        maxLength={1000}
                        autoFocus
                      />
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleAddNote(booking.id)}
                          disabled={!noteText.trim() || isLoading || isPending}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-all"
                        >
                          {isLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          حفظ
                        </button>
                        <button
                          onClick={() => { setNoteFor(null); setNoteText(""); }}
                          disabled={isLoading || isPending}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-100 text-surface-600 hover:bg-surface-200 disabled:opacity-50 transition-all"
                        >
                          إلغاء
                        </button>
                        <span className="ms-auto text-[10px] text-surface-400 tabular-nums">
                          {noteText.length}/1000
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* الرسائل السريعة */}
      <div className="bg-white rounded-xl shadow-sm border border-surface-100 overflow-hidden">
        <div className="p-4 border-b border-surface-100">
          <h2 className="text-base font-bold text-surface-900 flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary-500" />
            رسالة سريعة للاستقبال
          </h2>
        </div>

        <div className="p-4 space-y-3">
          {messageSent && (
            <div className="p-2.5 rounded-lg bg-success-50 text-success-700 text-sm text-center font-medium animate-fade-in">
              ✅ تم إرسال الرسالة للاستقبال
            </div>
          )}
          {messageError && (
            <div className="p-2.5 rounded-lg bg-danger-50 text-danger-700 text-sm text-center font-medium animate-fade-in">
              ❌ {messageError}
            </div>
          )}

          {/* أزرار الرسائل الجاهزة */}
          <div className="grid grid-cols-2 gap-2">
            {QUICK_MESSAGES.map((msg) => (
              <button
                key={msg.value}
                onClick={() => handleQuickMessage(msg.value, msg.type)}
                disabled={isPending}
                className="p-3 rounded-xl text-sm font-medium bg-surface-50 hover:bg-primary-50 hover:text-primary-700 border border-surface-200 hover:border-primary-200 transition-all text-start"
              >
                {msg.label}
              </button>
            ))}
          </div>

          {/* رسالة مخصصة */}
          <div className="flex gap-2 mt-2">
            <input
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="اكتب رسالة مخصصة..."
              className="flex-1 h-10 px-3 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              onKeyDown={(e) => e.key === "Enter" && handleCustomMessage()}
              disabled={isPending}
            />
            <Button
              onClick={handleCustomMessage}
              disabled={!customMessage.trim() || isPending}
              size="sm"
              className="h-10 px-4"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
