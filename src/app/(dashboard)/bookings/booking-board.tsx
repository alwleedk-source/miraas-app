"use client";

import { useState, useTransition } from "react";
import { updateBookingStatus } from "@/app/actions/bookings";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_COLORS,
  BOOKING_STATUS_ICONS,
} from "@/lib/utils";
import { Phone, MessageCircle, Calendar, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Booking = {
  id: string;
  name: string;
  phone: string | null;
  bookingStatus: string | null;
  bookingDate: Date | null;
  bookingService: string | null;
  bookingNotes: string | null;
};

type PostponeData = {
  leadId: string;
  leadName: string;
};

export default function BookingBoard({ bookings }: { bookings: Booking[] }) {
  const [isPending, startTransition] = useTransition();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [postponeModal, setPostponeModal] = useState<PostponeData | null>(null);
  const [postponeDate, setPostponeDate] = useState("");
  const [postponeReason, setPostponeReason] = useState("");

  const handleDrop = (status: string, leadId: string) => {
    if (status === "POSTPONED") {
      const lead = bookings.find((b) => b.id === leadId);
      setPostponeModal({ leadId, leadName: lead?.name || "" });
      return;
    }

    startTransition(async () => {
      await updateBookingStatus({ leadId, status });
    });
  };

  const handlePostponeConfirm = () => {
    if (!postponeModal || !postponeDate) return;
    startTransition(async () => {
      await updateBookingStatus({
        leadId: postponeModal.leadId,
        status: "POSTPONED",
        postponeDate,
        postponeReason,
      });
      setPostponeModal(null);
      setPostponeDate("");
      setPostponeReason("");
    });
  };

  const grouped = BOOKING_STATUSES.reduce(
    (acc, status) => {
      acc[status] = bookings.filter((b) => b.bookingStatus === status);
      return acc;
    },
    {} as Record<string, Booking[]>
  );

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {BOOKING_STATUSES.map((status) => (
          <div
            key={status}
            className="min-w-[260px] w-[260px] flex-shrink-0"
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add("ring-2", "ring-primary-300");
            }}
            onDragLeave={(e) => {
              e.currentTarget.classList.remove("ring-2", "ring-primary-300");
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("ring-2", "ring-primary-300");
              if (draggedId) handleDrop(status, draggedId);
              setDraggedId(null);
            }}
          >
            {/* رأس العمود */}
            <div className="flex items-center gap-2 mb-3 px-1">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: BOOKING_STATUS_COLORS[status] }}
              />
              <span className="text-sm font-semibold text-surface-700">
                {BOOKING_STATUS_ICONS[status]} {BOOKING_STATUS_LABELS[status]}
              </span>
              <span className="text-xs text-surface-400 bg-surface-100 rounded-full px-2 py-0.5">
                {grouped[status]?.length || 0}
              </span>
            </div>

            {/* بطاقات */}
            <div className="space-y-2 min-h-[200px] rounded-xl bg-surface-50 p-2">
              {grouped[status]?.map((booking) => (
                <div
                  key={booking.id}
                  draggable
                  onDragStart={() => setDraggedId(booking.id)}
                  onDragEnd={() => setDraggedId(null)}
                  className={`p-3 rounded-xl bg-white shadow-sm border border-surface-100 cursor-grab active:cursor-grabbing hover:shadow-md transition-all duration-200 ${
                    draggedId === booking.id ? "opacity-50 scale-95" : ""
                  }`}
                >
                  <p className="font-medium text-sm text-surface-900 mb-1">{booking.name}</p>

                  {booking.bookingService && (
                    <p className="text-xs text-surface-500 mb-1">🏷️ {booking.bookingService}</p>
                  )}

                  {booking.bookingDate && (
                    <p className="text-xs text-surface-500 mb-2">
                      📅{" "}
                      {new Date(booking.bookingDate).toLocaleDateString("ar-SA", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      —{" "}
                      {new Date(booking.bookingDate).toLocaleTimeString("ar-SA", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  )}

                  {booking.bookingNotes && status === "POSTPONED" && (
                    <p className="text-xs text-blue-600 bg-blue-50 rounded-lg p-1.5 mb-2">
                      {booking.bookingNotes}
                    </p>
                  )}

                  {/* أزرار التواصل */}
                  {booking.phone && (
                    <div className="flex items-center gap-1 pt-1 border-t border-surface-50">
                      <a
                        href={`tel:${booking.phone}`}
                        className="flex items-center gap-1 text-xs text-surface-500 hover:text-primary-600 p-1 rounded-lg hover:bg-primary-50 transition-colors"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        اتصل
                      </a>
                      <a
                        href={`https://wa.me/${booking.phone.replace("+", "")}`}
                        target="_blank"
                        rel="noopener"
                        className="flex items-center gap-1 text-xs text-surface-500 hover:text-success-600 p-1 rounded-lg hover:bg-success-50 transition-colors"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        واتساب
                      </a>
                      <span className="text-[10px] text-surface-300 mr-auto" dir="ltr">
                        {booking.phone}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              {grouped[status]?.length === 0 && (
                <div className="flex items-center justify-center h-24 text-surface-300 text-sm">
                  اسحب هنا
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* نافذة التأجيل */}
      {postponeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPostponeModal(null)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 mx-4 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-surface-900">
                🔄 تأجيل موعد {postponeModal.leadName}
              </h3>
              <button
                onClick={() => setPostponeModal(null)}
                className="p-1 rounded-lg hover:bg-surface-100"
              >
                <X className="h-5 w-5 text-surface-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>الموعد الجديد *</Label>
                <Input
                  type="datetime-local"
                  value={postponeDate}
                  onChange={(e) => setPostponeDate(e.target.value)}
                  dir="ltr"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>سبب التأجيل</Label>
                <Input
                  value={postponeReason}
                  onChange={(e) => setPostponeReason(e.target.value)}
                  placeholder="مثال: طلب العميل التأجيل بسبب السفر"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handlePostponeConfirm}
                  disabled={!postponeDate || isPending}
                  className="flex-1"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Calendar className="h-4 w-4" />
                      تأكيد التأجيل
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={() => setPostponeModal(null)}>
                  إلغاء
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isPending && (
        <div className="fixed bottom-4 start-1/2 -translate-x-1/2 bg-surface-900 text-white px-4 py-2 rounded-xl shadow-lg text-sm flex items-center gap-2 z-50">
          <Loader2 className="h-4 w-4 animate-spin" />
          جاري التحديث...
        </div>
      )}
    </>
  );
}
