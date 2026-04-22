"use client";

import { useState, useTransition } from "react";
import {
  CalendarDays,
  Phone,
  User,
  MessageCircle,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendQuickMessage } from "@/app/actions/provider";

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
  });
}

function formatDate(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("ar-SA-u-ca-gregory", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function ProviderDashboardClient({ dashboard }: { dashboard: Dashboard }) {
  const [isPending, startTransition] = useTransition();
  const [customMessage, setCustomMessage] = useState("");
  const [messageSent, setMessageSent] = useState(false);
  const [showTomorrow, setShowTomorrow] = useState(false);

  const handleQuickMessage = (msg: string, type: string) => {
    startTransition(async () => {
      try {
        await sendQuickMessage(msg, type);
        setMessageSent(true);
        setTimeout(() => setMessageSent(false), 3000);
      } catch {}
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

        {activeBookings.length === 0 ? (
          <div className="p-8 text-center">
            <CalendarDays className="h-10 w-10 mx-auto mb-3 text-surface-200" />
            <p className="text-sm text-surface-400">لا توجد مواعيد {activeLabel}</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-50">
            {activeBookings.map((booking) => {
              const status = STATUS_LABELS[booking.bookingStatus || "PENDING"];
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
                        <p className="text-xs text-surface-400 mt-1 italic">
                          📝 {booking.bookingNotes}
                        </p>
                      )}
                    </div>
                    <span
                      className={`text-[10px] px-2.5 py-1 rounded-full font-medium ${status.color}`}
                    >
                      {status.label}
                    </span>
                  </div>
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
