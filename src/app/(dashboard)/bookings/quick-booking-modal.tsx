"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { searchLeadByPhone, quickCreateBooking } from "@/app/actions/bookings";
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

type Service = { id: string; name: string };

export default function QuickBookingModal({
  open,
  onClose,
  services = [],
}: {
  open: boolean;
  onClose: () => void;
  services?: Service[];
}) {
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"phone" | "details" | "done">("phone");
  const [phone, setPhone] = useState("");
  const [searchResults, setSearchResults] = useState<FoundLead[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedLead, setSelectedLead] = useState<FoundLead | null>(null);

  // حقول العميل الجديد
  const [newName, setNewName] = useState("");

  // حقول الحجز
  const [bookingDate, setBookingDate] = useState("");
  const [bookingService, setBookingService] = useState("");
  const [bookingNotes, setBookingNotes] = useState("");
  const [createdName, setCreatedName] = useState("");

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

  // إعادة تعيين عند الإغلاق
  useEffect(() => {
    if (!open) {
      setStep("phone");
      setPhone("");
      setSearchResults(null);
      setSelectedLead(null);
      setNewName("");
      setBookingDate("");
      setBookingService("");
      setBookingNotes("");
      setCreatedName("");
    }
  }, [open]);

  const handleSelectExisting = (lead: FoundLead) => {
    setSelectedLead(lead);
    setStep("details");
  };

  const handleNewLead = () => {
    setSelectedLead(null);
    setStep("details");
  };

  const handleSubmit = () => {
    if (!bookingDate) return;
    startTransition(async () => {
      try {
        const result = await quickCreateBooking({
          existingLeadId: selectedLead?.id,
          name: selectedLead ? undefined : newName,
          phone,
          bookingDate,
          bookingService,
          bookingNotes,
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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 animate-fade-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
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

              <div className="space-y-2">
                <Label>تاريخ ووقت الموعد *</Label>
                <Input
                  type="datetime-local"
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  dir="ltr"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>الخدمة</Label>
                {services.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {services.map((svc) => {
                      const currentServices = bookingService
                        .split("،")
                        .map((s) => s.trim())
                        .filter(Boolean);
                      const isSelected = currentServices.includes(svc.name);
                      return (
                        <button
                          key={svc.id}
                          type="button"
                          onClick={() => {
                            const updated = isSelected
                              ? currentServices.filter((s) => s !== svc.name)
                              : [...currentServices, svc.name];
                            setBookingService(updated.join("، "));
                          }}
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

              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <textarea
                  value={bookingNotes}
                  onChange={(e) => setBookingNotes(e.target.value)}
                  placeholder="ملاحظات إضافية..."
                  className="flex w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 min-h-[70px] resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleSubmit}
                  disabled={
                    !bookingDate ||
                    (!selectedLead && !newName.trim()) ||
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
