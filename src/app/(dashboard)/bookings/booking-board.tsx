"use client";

import { useState, useTransition } from "react";
import { updateBookingStatus, updateBookingDate } from "@/app/actions/bookings";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_COLORS,
  BOOKING_STATUS_ICONS,
} from "@/lib/utils";
import { Phone, MessageCircle, Calendar, X, Loader2, Pencil } from "lucide-react";
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
  sourceName: string | null;
};

type PostponeData = {
  leadId: string;
  leadName: string;
};

type EditData = {
  leadId: string;
  leadName: string;
  bookingDate: string;
  bookingService: string;
  bookingNotes: string;
};

export default function BookingBoard({ bookings, services = [] }: { bookings: Booking[]; services?: { id: string; name: string }[] }) {
  const [isPending, startTransition] = useTransition();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [postponeModal, setPostponeModal] = useState<PostponeData | null>(null);
  const [postponeDate, setPostponeDate] = useState("");
  const [postponeReason, setPostponeReason] = useState("");
  const [editModal, setEditModal] = useState<EditData | null>(null);

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

  const openEditModal = (booking: Booking) => {
    setEditModal({
      leadId: booking.id,
      leadName: booking.name,
      bookingDate: booking.bookingDate
        ? new Date(booking.bookingDate).toISOString().slice(0, 16)
        : "",
      bookingService: booking.bookingService || "",
      bookingNotes: booking.bookingNotes || "",
    });
  };

  const handleEditConfirm = () => {
    if (!editModal || !editModal.bookingDate) return;
    startTransition(async () => {
      await updateBookingDate({
        leadId: editModal.leadId,
        bookingDate: editModal.bookingDate,
        bookingService: editModal.bookingService,
        bookingNotes: editModal.bookingNotes,
      });
      setEditModal(null);
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
            className="min-w-[280px] w-[280px] flex-shrink-0"
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
                  {/* الاسم + زر التعديل */}
                  <div className="flex items-start justify-between mb-1">
                    <p className="font-medium text-sm text-surface-900">{booking.name}</p>
                    <button
                      onClick={() => openEditModal(booking)}
                      className="p-1 rounded-lg hover:bg-surface-100 text-surface-400 hover:text-primary-500 transition-colors shrink-0"
                      title="تعديل"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* اسم الحملة */}
                  {booking.sourceName && (
                    <p className="text-[10px] text-primary-600 bg-primary-50 rounded-md px-1.5 py-0.5 inline-block mb-1">
                      📢 {booking.sourceName}
                    </p>
                  )}

                  {booking.bookingService && (
                    <p className="text-xs text-surface-500 mb-1">🏷️ {booking.bookingService}</p>
                  )}

                  {booking.bookingDate && (
                    <p className="text-xs text-surface-500 mb-1">
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

                  {/* الملاحظات — تظهر دائماً */}
                  {booking.bookingNotes && (
                    <p className={`text-xs rounded-lg p-1.5 mb-1 ${
                      status === "POSTPONED"
                        ? "text-blue-600 bg-blue-50"
                        : "text-surface-500 bg-surface-50"
                    }`}>
                      💬 {booking.bookingNotes}
                    </p>
                  )}

                  {/* أزرار التواصل */}
                  {booking.phone && (
                    <div className="flex items-center gap-1 pt-1.5 border-t border-surface-50">
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

      {/* نافذة تعديل الحجز */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditModal(null)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 mx-4 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-surface-900">
                ✏️ تعديل حجز {editModal.leadName}
              </h3>
              <button
                onClick={() => setEditModal(null)}
                className="p-1 rounded-lg hover:bg-surface-100"
              >
                <X className="h-5 w-5 text-surface-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>تاريخ ووقت الموعد *</Label>
                <Input
                  type="datetime-local"
                  value={editModal.bookingDate}
                  onChange={(e) => setEditModal({ ...editModal, bookingDate: e.target.value })}
                  dir="ltr"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>الخدمات</Label>
                {services.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {services.map((svc) => {
                      const currentServices = editModal.bookingService.split("،").map((s: string) => s.trim()).filter(Boolean);
                      const isSelected = currentServices.includes(svc.name);
                      return (
                        <button
                          key={svc.id}
                          type="button"
                          onClick={() => {
                            const updated = isSelected
                              ? currentServices.filter((s: string) => s !== svc.name)
                              : [...currentServices, svc.name];
                            setEditModal({ ...editModal, bookingService: updated.join("، ") });
                          }}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border-2 transition-all ${
                            isSelected
                              ? "border-primary-500 bg-primary-50 text-primary-700"
                              : "border-surface-200 bg-white text-surface-600 hover:border-surface-300"
                          }`}
                        >
                          {isSelected && "✓ "}{svc.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Input
                    value={editModal.bookingService}
                    onChange={(e) => setEditModal({ ...editModal, bookingService: e.target.value })}
                    placeholder="الخدمة"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <textarea
                  value={editModal.bookingNotes}
                  onChange={(e) => setEditModal({ ...editModal, bookingNotes: e.target.value })}
                  placeholder="ملاحظات إضافية..."
                  className="flex w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 min-h-[80px] resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleEditConfirm}
                  disabled={!editModal.bookingDate || isPending}
                  className="flex-1"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Pencil className="h-4 w-4" />
                      حفظ التعديلات
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={() => setEditModal(null)}>
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
