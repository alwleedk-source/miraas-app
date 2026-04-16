"use client";

import { useState, useTransition, useMemo } from "react";
import { updateBookingStatus, updateBookingDate } from "@/app/actions/bookings";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_COLORS,
  BOOKING_STATUS_ICONS,
} from "@/lib/utils";
import { Phone, MessageCircle, Calendar, X, Loader2, Pencil, Search, EyeOff, Eye } from "lucide-react";
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
  assignedUserName: string | null;
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
  const [postponeWaitlist, setPostponeWaitlist] = useState(false);
  const [editModal, setEditModal] = useState<EditData | null>(null);
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "tomorrow" | "next_7" | "past">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [hideCompleted, setHideCompleted] = useState(false);

  const COMPLETED_STATUSES = ["COMPLETED", "ATTENDED_NOT_SUITABLE", "CANCELLED", "NO_RESPONSE"];

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
    if (!postponeModal) return;
    // إذا كان في وضع قائمة الانتظار لا نحتاج تاريخ
    if (!postponeWaitlist && !postponeDate) return;

    startTransition(async () => {
      await updateBookingStatus({
        leadId: postponeModal.leadId,
        status: "POSTPONED",
        postponeDate: postponeWaitlist ? undefined : postponeDate,
        postponeReason,
      });
      setPostponeModal(null);
      setPostponeDate("");
      setPostponeReason("");
      setPostponeWaitlist(false);
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

  // فلترة متقدمة: تاريخ + بحث + إخفاء المكتمل
  const filteredBookings = useMemo(() => {
    let result = bookings;

    // فلتر التاريخ
    if (dateFilter !== "all") {
      result = result.filter((b) => {
        if (!b.bookingDate) return false;
        const bDate = new Date(b.bookingDate);
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const tomorrowStart = new Date(todayStart.getTime() + 86400000);
        const dayAfterTomorrowStart = new Date(tomorrowStart.getTime() + 86400000);
        const next7End = new Date(todayStart.getTime() + 7 * 86400000);

        if (dateFilter === "past") return bDate < todayStart;
        if (dateFilter === "today") return bDate >= todayStart && bDate < tomorrowStart;
        if (dateFilter === "tomorrow") return bDate >= tomorrowStart && bDate < dayAfterTomorrowStart;
        if (dateFilter === "next_7") return bDate >= todayStart && bDate < next7End;
        return true;
      });
    }

    // فلتر البحث
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          (b.phone && b.phone.includes(q)) ||
          (b.bookingService && b.bookingService.toLowerCase().includes(q))
      );
    }

    // إخفاء المكتمل
    if (hideCompleted) {
      result = result.filter((b) => !COMPLETED_STATUSES.includes(b.bookingStatus || ""));
    }

    return result;
  }, [bookings, dateFilter, searchQuery, hideCompleted]);

  const grouped = BOOKING_STATUSES.reduce(
    (acc, status) => {
      acc[status] = filteredBookings.filter((b) => b.bookingStatus === status);
      return acc;
    },
    {} as Record<string, Booking[]>
  );

  // الأعمدة المعروضة (إخفاء أعمدة المكتمل إذا مفعلة)
  const visibleStatuses = hideCompleted
    ? BOOKING_STATUSES.filter((s) => !COMPLETED_STATUSES.includes(s))
    : BOOKING_STATUSES;

  return (
    <>
      {/* شريط البحث + الفلاتر */}
      <div className="space-y-3 mb-4">
        {/* صف البحث + إخفاء المكتمل */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث بالاسم أو الجوال أو الخدمة..."
              className="pl-9 h-9 text-sm"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
          </div>
          <button
            onClick={() => setHideCompleted(!hideCompleted)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              hideCompleted
                ? "bg-primary-100 text-primary-700 border border-primary-200"
                : "bg-white border border-surface-200 text-surface-500 hover:bg-surface-50"
            }`}
          >
            {hideCompleted ? (
              <>
                <Eye className="h-3.5 w-3.5" />
                إظهار المنتهية
              </>
            ) : (
              <>
                <EyeOff className="h-3.5 w-3.5" />
                إخفاء المنتهية
              </>
            )}
          </button>
          {searchQuery && (
            <span className="text-xs text-surface-400">
              {filteredBookings.length} نتيجة
            </span>
          )}
        </div>

        {/* فلتر التاريخ */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {(
            [
              { id: "all", label: "كل الأوقات" },
              { id: "today", label: "اليوم" },
              { id: "tomorrow", label: "غداً" },
              { id: "next_7", label: "القادمة (7 أيام)" },
              { id: "past", label: "السابقة" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setDateFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                dateFilter === f.id
                  ? "bg-primary-100 text-primary-700"
                  : "bg-white border border-surface-200 text-surface-600 hover:bg-surface-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {visibleStatuses.map((status) => (
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
                    <a
                      href={`/leads?search=${encodeURIComponent(booking.name)}`}
                      className="font-medium text-sm text-surface-900 hover:text-primary-600 hover:underline transition-colors"
                    >
                      {booking.name}
                    </a>
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

                  {booking.assignedUserName && (
                    <p className="text-[10px] text-surface-400 mb-1">
                      👤 {booking.assignedUserName}
                    </p>
                  )}

                  {booking.bookingService && (
                    <p className="text-xs text-surface-500 mb-1">🏷️ {booking.bookingService}</p>
                  )}

                  {booking.bookingDate ? (
                    <p className="text-xs text-surface-500 mb-1">
                      📅{" "}
                      {new Date(booking.bookingDate).toLocaleDateString("ar-SA-u-ca-gregory", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        timeZone: "Asia/Riyadh",
                      })}{" "}
                      —{" "}
                      {new Date(booking.bookingDate).toLocaleTimeString("ar-SA-u-ca-gregory", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Riyadh",
                      })}
                    </p>
                  ) : status === "POSTPONED" ? (
                    <p className="text-xs text-blue-500 mb-1 flex items-center gap-1">
                      ⏸️ قائمة انتظار — بدون موعد
                    </p>
                  ) : null}

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

      {/* نافذة التأجيل — التاريخ اختياري */}
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
              {/* خيار قائمة الانتظار */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPostponeWaitlist(false)}
                  className={`flex-1 p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                    !postponeWaitlist
                      ? "border-primary-500 bg-primary-50 text-primary-700"
                      : "border-surface-200 text-surface-500 hover:border-surface-300"
                  }`}
                >
                  📅 تأجيل لموعد محدد
                </button>
                <button
                  onClick={() => setPostponeWaitlist(true)}
                  className={`flex-1 p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                    postponeWaitlist
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-surface-200 text-surface-500 hover:border-surface-300"
                  }`}
                >
                  ⏸️ قائمة انتظار
                </button>
              </div>

              {!postponeWaitlist && (
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
              )}

              {postponeWaitlist && (
                <p className="text-xs text-blue-600 bg-blue-50 rounded-lg p-3">
                  💡 العميل سيظهر في قائمة الانتظار بدون موعد محدد. يمكنك لاحقاً تعديل الموعد عند الاتفاق مع العميل.
                </p>
              )}

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
                  disabled={(!postponeWaitlist && !postponeDate) || isPending}
                  className="flex-1"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Calendar className="h-4 w-4" />
                      {postponeWaitlist ? "تأكيد (قائمة انتظار)" : "تأكيد التأجيل"}
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
