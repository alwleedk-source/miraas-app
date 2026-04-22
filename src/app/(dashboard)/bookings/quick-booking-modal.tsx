"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { searchLeadByPhone, quickCreateBooking } from "@/app/actions/bookings";
import { getDepartmentProviders } from "@/app/actions/departments";
import { generateAvailableSlots, checkBookingConflict } from "@/app/actions/scheduling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  X,
  Loader2,
  Search,
  UserPlus,
  CalendarPlus,
  CheckCircle2,
  Phone,
  User,
  Clock,
  AlertTriangle,
} from "lucide-react";

type FoundLead = {
  id: string;
  name: string;
  phone: string | null;
  bookingStatus: string | null;
  bookingDate: Date | null;
  bookingService: string | null;
  sourceName: string | null;
};

type Service = { id: string; name: string; departmentId?: string | null; defaultDurationMin?: number | null };
type Department = { id: string; name: string; color: string; defaultGapMinutes: number };
type DeptProvider = { id: string; userId: string; userName: string; userEmail: string };
type TimeSlot = { time: string; available: boolean; conflictWith?: string };

const DURATION_CHIPS = [
  { label: "15 د", value: 15 },
  { label: "30 د", value: 30 },
  { label: "45 د", value: 45 },
  { label: "ساعة", value: 60 },
  { label: "ساعتين", value: 120 },
];

export default function QuickBookingModal({
  open,
  onClose,
  services = [],
  departments = [],
}: {
  open: boolean;
  onClose: () => void;
  services?: Service[];
  departments?: Department[];
}) {
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"phone" | "details" | "done">("phone");
  const [phone, setPhone] = useState("");
  const [searchResults, setSearchResults] = useState<FoundLead[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<FoundLead | null>(null);

  // حقول العميل الجديد
  const [newName, setNewName] = useState("");

  // حقول الحجز الجديدة
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [deptProviders, setDeptProviders] = useState<DeptProvider[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [bookingDate, setBookingDate] = useState("");
  const [bookingService, setBookingService] = useState("");
  const [bookingDuration, setBookingDuration] = useState(30);
  const [bookingNotes, setBookingNotes] = useState("");
  const [createdName, setCreatedName] = useState("");

  // أوقات متاحة
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [selectedTime, setSelectedTime] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);

  // تحذير التعارض
  const [conflictWarning, setConflictWarning] = useState("");
  const [forceOverbook, setForceOverbook] = useState(false);

  // بحث بالجوال مع debounce
  const doSearch = useCallback(async (value: string) => {
    if (value.length < 4) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const results = await searchLeadByPhone(value);
      setSearchResults(results);
    } catch {
      setSearchResults(null);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => doSearch(phone), 400);
    return () => clearTimeout(timer);
  }, [phone, doSearch]);

  // إعادة تعيين عند الإغلاق — 16 حقل، استخدام key للـ remount يبدو أنظف لكن يكسر animations
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- إعادة تعيين عند إغلاق المودال
      setStep("phone");
      setPhone("");
      setSearchResults(null);
      setSelectedLead(null);
      setNewName("");
      setSelectedDeptId("");
      setSelectedProviderId("");
      setDeptProviders([]);
      setBookingDate("");
      setBookingService("");
      setBookingDuration(30);
      setBookingNotes("");
      setCreatedName("");
      setAvailableSlots([]);
      setSelectedTime("");
      setConflictWarning("");
      setForceOverbook(false);
    }
  }, [open]);

  // جلب مقدمي الخدمة عند اختيار القسم
  useEffect(() => {
    if (!selectedDeptId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- مسح القائمة عند إلغاء القسم
      setDeptProviders([]);
      setSelectedProviderId("");
      return;
    }
    setLoadingProviders(true);
    getDepartmentProviders(selectedDeptId)
      .then((providers) => {
        setDeptProviders(providers);
        setSelectedProviderId("");
      })
      .catch(() => setDeptProviders([]))
      .finally(() => setLoadingProviders(false));
  }, [selectedDeptId]);

  // توليد الأوقات المتاحة عند اختيار الطبيب + التاريخ + المدة
  useEffect(() => {
    if (!selectedProviderId || !selectedDeptId || !bookingDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- مسح الأوقات عند نقص المدخلات
      setAvailableSlots([]);
      return;
    }
    setLoadingSlots(true);
    setSelectedTime("");
    generateAvailableSlots({
      providerId: selectedProviderId,
      departmentId: selectedDeptId,
      date: bookingDate,
      durationMin: bookingDuration,
    })
      .then((result) => {
        setAvailableSlots(result.slots);
      })
      .catch(() => setAvailableSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [selectedProviderId, selectedDeptId, bookingDate, bookingDuration]);

  // الخدمات المفلترة حسب القسم المحدد
  const filteredServices = selectedDeptId
    ? services.filter((s) => !s.departmentId || s.departmentId === selectedDeptId)
    : services;

  const handleSelectExisting = (lead: FoundLead) => {
    setSelectedLead(lead);
    setStep("details");
  };

  const handleNewLead = () => {
    setSelectedLead(null);
    setStep("details");
  };

  const handleServiceSelect = (svc: Service) => {
    const currentServices = bookingService
      .split("،")
      .map((s) => s.trim())
      .filter(Boolean);
    const isSelected = currentServices.includes(svc.name);
    const updated = isSelected
      ? currentServices.filter((s) => s !== svc.name)
      : [...currentServices, svc.name];
    setBookingService(updated.join("، "));

    // تعبئة المدة الافتراضية من الخدمة
    if (!isSelected && svc.defaultDurationMin) {
      setBookingDuration(svc.defaultDurationMin);
    }
  };

  const handleTimeSelect = async (time: string, slot: TimeSlot) => {
    setSelectedTime(time);
    setConflictWarning("");
    setForceOverbook(false);

    if (!slot.available) {
      // فحص التعارض (Soft Block)
      const dateTime = `${bookingDate}T${time}`;
      const result = await checkBookingConflict({
        providerId: selectedProviderId,
        departmentId: selectedDeptId,
        date: dateTime,
        durationMin: bookingDuration,
      });
      if (result.hasConflict) {
        const names = result.conflictingBookings.map((c) => c.name).join("، ");
        setConflictWarning(`⚠️ تعارض مع: ${names}`);
      }
    }
  };

  const handleSubmit = () => {
    if (!bookingDate || !selectedTime) return;
    if (conflictWarning && !forceOverbook) return;

    const fullDateTime = `${bookingDate}T${selectedTime}`;

    startTransition(async () => {
      try {
        const result = await quickCreateBooking({
          existingLeadId: selectedLead?.id,
          name: selectedLead ? undefined : newName,
          phone,
          bookingDate: fullDateTime,
          bookingService,
          bookingNotes,
          bookingDepartmentId: selectedDeptId || undefined,
          bookingResourceId: selectedProviderId || undefined,
          bookingDurationMin: bookingDuration,
        });
        setCreatedName(result.name);
        setStep("done");
      } catch (err) {
        alert(err instanceof Error ? err.message : "حدث خطأ");
      }
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 animate-fade-in overflow-hidden max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-100 sticky top-0 bg-white z-10">
          <h3 className="text-lg font-bold text-surface-900 flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-primary-500" />
            موعد سريع
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-100 transition-colors"
          >
            <X className="h-5 w-5 text-surface-400" />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-0 px-5 pt-4">
          {(["phone", "details", "done"] as const).map((s, i) => (
            <div key={s} className="flex items-center flex-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  step === s
                    ? "bg-primary-500 text-white scale-110"
                    : i < ["phone", "details", "done"].indexOf(step)
                      ? "bg-success-500 text-white"
                      : "bg-surface-200 text-surface-500"
                }`}
              >
                {i < ["phone", "details", "done"].indexOf(step) ? "✓" : i + 1}
              </div>
              {i < 2 && (
                <div
                  className={`flex-1 h-0.5 mx-1 rounded ${
                    i < ["phone", "details", "done"].indexOf(step)
                      ? "bg-success-500"
                      : "bg-surface-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="p-5">
          {/* ========== الخطوة 1: البحث بالجوال ========== */}
          {step === "phone" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" />
                  رقم الجوال
                </Label>
                <div className="relative">
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="مثال: 0551234567"
                    dir="ltr"
                    className="pl-9"
                    autoFocus
                  />
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
                </div>
                {searching && (
                  <p className="text-xs text-surface-400 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    جاري البحث ...
                  </p>
                )}
              </div>

              {/* نتائج البحث */}
              {searchResults && searchResults.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-surface-600">
                    عملاء موجودون:
                  </p>
                  {searchResults.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => handleSelectExisting(lead)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-primary-50/50 transition-all text-start"
                    >
                      <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center">
                        <User className="h-4 w-4 text-primary-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-surface-900 truncate">
                          {lead.name}
                        </p>
                        <p className="text-xs text-surface-500" dir="ltr">
                          {lead.phone}
                        </p>
                      </div>
                      {lead.bookingStatus && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning-100 text-warning-700">
                          لديه حجز
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* زر إضافة عميل جديد */}
              {phone.length >= 4 && (
                <Button
                  onClick={handleNewLead}
                  variant="outline"
                  className="w-full gap-2"
                >
                  <UserPlus className="h-4 w-4" />
                  عميل جديد بهذا الرقم
                </Button>
              )}
            </div>
          )}

          {/* ========== الخطوة 2: تفاصيل الحجز ========== */}
          {step === "details" && (
            <div className="space-y-4">
              {/* إذا عميل قائم */}
              {selectedLead ? (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-success-50 border border-success-200">
                  <div className="w-9 h-9 rounded-full bg-success-100 flex items-center justify-center">
                    <CheckCircle2 className="h-4 w-4 text-success-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-surface-900">
                      {selectedLead.name}
                    </p>
                    <p className="text-xs text-surface-500" dir="ltr">
                      {selectedLead.phone}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>اسم العميل *</Label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="أدخل اسم العميل"
                    autoFocus
                  />
                </div>
              )}

              {/* القسم */}
              {departments.length > 0 && (
                <div className="space-y-2">
                  <Label>القسم</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {departments.map((dept) => (
                      <button
                        key={dept.id}
                        type="button"
                        onClick={() => setSelectedDeptId(selectedDeptId === dept.id ? "" : dept.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all flex items-center gap-1.5 ${
                          selectedDeptId === dept.id
                            ? "border-primary-500 bg-primary-50 text-primary-700"
                            : "border-surface-200 bg-white text-surface-600 hover:border-surface-300"
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: dept.color }}
                        />
                        {dept.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* مقدم الخدمة (يظهر بعد اختيار القسم) */}
              {selectedDeptId && (
                <div className="space-y-2">
                  <Label>مقدم الخدمة</Label>
                  {loadingProviders ? (
                    <div className="flex items-center gap-2 py-2">
                      <Loader2 className="h-4 w-4 animate-spin text-surface-400" />
                      <span className="text-sm text-surface-400">جاري التحميل...</span>
                    </div>
                  ) : deptProviders.length === 0 ? (
                    <p className="text-xs text-warning-600 bg-warning-50 rounded-lg p-2">
                      لا يوجد مقدمي خدمة في هذا القسم. اذهب للإعدادات لإضافتهم.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {deptProviders.map((dp) => (
                        <button
                          key={dp.userId}
                          type="button"
                          onClick={() =>
                            setSelectedProviderId(
                              selectedProviderId === dp.userId ? "" : dp.userId
                            )
                          }
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all ${
                            selectedProviderId === dp.userId
                              ? "border-primary-500 bg-primary-50 text-primary-700"
                              : "border-surface-200 bg-white text-surface-600 hover:border-surface-300"
                          }`}
                        >
                          {dp.userName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* الخدمة */}
              <div className="space-y-2">
                <Label>الخدمة</Label>
                {filteredServices.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {filteredServices.map((svc) => {
                      const currentServices = bookingService
                        .split("،")
                        .map((s) => s.trim())
                        .filter(Boolean);
                      const isSelected = currentServices.includes(svc.name);
                      return (
                        <button
                          key={svc.id}
                          type="button"
                          onClick={() => handleServiceSelect(svc)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border-2 transition-all ${
                            isSelected
                              ? "border-primary-500 bg-primary-50 text-primary-700"
                              : "border-surface-200 bg-white text-surface-600 hover:border-surface-300"
                          }`}
                        >
                          {isSelected && "✓ "}
                          {svc.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Input
                    value={bookingService}
                    onChange={(e) => setBookingService(e.target.value)}
                    placeholder="مثال: استشارة، فحص..."
                  />
                )}
              </div>

              {/* المدة المتوقعة */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  المدة المتوقعة
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {DURATION_CHIPS.map((chip) => (
                    <button
                      key={chip.value}
                      type="button"
                      onClick={() => setBookingDuration(chip.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        bookingDuration === chip.value
                          ? "bg-primary-600 text-white"
                          : "bg-surface-100 text-surface-600 hover:bg-surface-200"
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                  {/* مخصص */}
                  {!DURATION_CHIPS.some((c) => c.value === bookingDuration) && (
                    <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-600 text-white">
                      {bookingDuration} د
                    </span>
                  )}
                </div>
              </div>

              {/* التاريخ */}
              <div className="space-y-2">
                <Label>تاريخ الموعد *</Label>
                <Input
                  type="date"
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  dir="ltr"
                  required
                />
              </div>

              {/* الأوقات المتاحة (تظهر بعد اختيار الطبيب والتاريخ) */}
              {selectedProviderId && bookingDate && (
                <div className="space-y-2">
                  <Label>الوقت المتاح</Label>
                  {loadingSlots ? (
                    <div className="flex items-center gap-2 py-3">
                      <Loader2 className="h-4 w-4 animate-spin text-surface-400" />
                      <span className="text-sm text-surface-400">جاري حساب الأوقات...</span>
                    </div>
                  ) : availableSlots.length === 0 ? (
                    <p className="text-xs text-warning-600 bg-warning-50 rounded-lg p-2.5">
                      لا توجد أوقات متاحة في هذا اليوم. قد يكون مقدم الخدمة في إجازة أو لم يُعدّ جدول عمله بعد.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {availableSlots.map((slot) => (
                        <button
                          key={slot.time}
                          type="button"
                          onClick={() => handleTimeSelect(slot.time, slot)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            selectedTime === slot.time
                              ? "bg-primary-600 text-white ring-2 ring-primary-300"
                              : slot.available
                                ? "bg-surface-50 text-surface-700 hover:bg-primary-50 hover:text-primary-700 border border-surface-200"
                                : "bg-danger-50 text-danger-400 border border-danger-200 line-through"
                          }`}
                          title={
                            slot.available
                              ? "متاح"
                              : `محجوز: ${slot.conflictWith || ""}`
                          }
                        >
                          {slot.time}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* إذا لم يُحدد طبيب، نظهر حقل وقت تقليدي */}
              {!selectedProviderId && (
                <div className="space-y-2">
                  <Label>وقت الموعد *</Label>
                  <Input
                    type="time"
                    value={selectedTime}
                    onChange={(e) => setSelectedTime(e.target.value)}
                    dir="ltr"
                  />
                </div>
              )}

              {/* تحذير التعارض (Soft Block) */}
              {conflictWarning && (
                <div className="p-3 rounded-lg bg-danger-50 border border-danger-200 space-y-2">
                  <div className="flex items-center gap-2 text-sm text-danger-700 font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    {conflictWarning}
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={forceOverbook}
                      onChange={(e) => setForceOverbook(e.target.checked)}
                      className="rounded border-danger-300"
                    />
                    <span className="text-xs text-danger-600">
                      متأكد — أريد الحجز رغم التعارض (حالة طوارئ)
                    </span>
                  </label>
                </div>
              )}

              {/* ملاحظات */}
              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <textarea
                  value={bookingNotes}
                  onChange={(e) => setBookingNotes(e.target.value)}
                  placeholder="ملاحظات إضافية..."
                  className="flex w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 min-h-[60px] resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleSubmit}
                  disabled={
                    !bookingDate ||
                    !selectedTime ||
                    (!selectedLead && !newName.trim()) ||
                    (conflictWarning !== "" && !forceOverbook) ||
                    isPending
                  }
                  className="flex-1 gap-2"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <CalendarPlus className="h-4 w-4" />
                      تأكيد الحجز
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={() => setStep("phone")}>
                  رجوع
                </Button>
              </div>
            </div>
          )}

          {/* ========== الخطوة 3: تم بنجاح ========== */}
          {step === "done" && (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-success-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-success-600" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-surface-900">
                  تم إنشاء الحجز! 🎉
                </h4>
                <p className="text-sm text-surface-500 mt-1">
                  تم حجز موعد لـ{" "}
                  <span className="font-semibold">{createdName}</span> بنجاح
                </p>
              </div>
              <Button onClick={onClose} className="gap-2">
                إغلاق
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
