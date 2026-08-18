"use client";

import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock, Save, Loader2, X, Plus, Trash2, Calendar } from "lucide-react";
import {
  getProviderSchedule,
  saveProviderSchedule,
  getProviderDayOffs,
  addProviderDayOff,
  deleteProviderDayOff,
} from "@/app/actions/departments";

const DAY_LABELS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

type ScheduleDay = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
  isActive: boolean;
};

type DayOff = {
  id: string;
  date: Date;
  reason: string | null;
};

const DEFAULT_SCHEDULE: ScheduleDay[] = DAY_LABELS.map((_, i) => ({
  dayOfWeek: i,
  startTime: "09:00",
  endTime: "17:00",
  breakStart: "",
  breakEnd: "",
  isActive: i !== 5 && i !== 6, // الجمعة والسبت عطلة
}));

export default function ProviderScheduleEditor({
  userId,
  userName,
  open,
  onClose,
}: {
  userId: string;
  userName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [schedule, setSchedule] = useState<ScheduleDay[]>(DEFAULT_SCHEDULE);
  const [dayOffs, setDayOffs] = useState<DayOff[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dayOffError, setDayOffError] = useState<string | null>(null);
  const [tab, setTab] = useState<"schedule" | "dayoffs">("schedule");
  const [newDayOffDate, setNewDayOffDate] = useState("");
  const [newDayOffReason, setNewDayOffReason] = useState("");

  // loading يُشتقّ من حالة التحميل بدلاً من setState داخل effect
  const sessionKey = open ? userId : null;
  const loading = sessionKey !== null && loadedKey !== sessionKey;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([getProviderSchedule(userId), getProviderDayOffs(userId)])
      .then(([scheduleData, dayOffsData]) => {
        if (cancelled) return;
        if (scheduleData.length > 0) {
          const merged = DEFAULT_SCHEDULE.map((defaultDay) => {
            const found = scheduleData.find((s) => s.dayOfWeek === defaultDay.dayOfWeek);
            return found
              ? {
                  dayOfWeek: found.dayOfWeek,
                  startTime: found.startTime,
                  endTime: found.endTime,
                  breakStart: found.breakStart || "",
                  breakEnd: found.breakEnd || "",
                  isActive: found.isActive,
                }
              : defaultDay;
          });
          setSchedule(merged);
        }
        setDayOffs(dayOffsData);
        setLoadedKey(userId);
      })
      .catch(() => {
        if (!cancelled) setLoadedKey(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  const handleSave = () => {
    setSaveError(null);
    startTransition(async () => {
      try {
        const result = await saveProviderSchedule(userId, schedule);
        // أخطاء التحقق (نهاية>بداية، استراحة ضمن الدوام...) تُعاد الآن كـ Fail برسالة عربية
        if (!result.success) {
          setSaveError(result.error);
          return;
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch {
        setSaveError("تعذّر حفظ الجدول — حاول مرة أخرى");
      }
    });
  };

  const handleDayToggle = (dayOfWeek: number) => {
    setSchedule((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, isActive: !d.isActive } : d))
    );
  };

  const handleTimeChange = (dayOfWeek: number, field: keyof ScheduleDay, value: string) => {
    setSchedule((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, [field]: value } : d))
    );
  };

  const handleAddDayOff = () => {
    if (!newDayOffDate) return;
    setDayOffError(null);
    startTransition(async () => {
      try {
        const result = await addProviderDayOff(userId, newDayOffDate, newDayOffReason || undefined);
        if (!result.success) {
          setDayOffError(result.error);
          return;
        }
        const updated = await getProviderDayOffs(userId);
        setDayOffs(updated);
        setNewDayOffDate("");
        setNewDayOffReason("");
      } catch {
        setDayOffError("تعذّر إضافة الإجازة — حاول مرة أخرى");
      }
    });
  };

  const handleDeleteDayOff = (id: string) => {
    setDayOffError(null);
    // حذف متفائل — مع تراجع لو فشل الخادم (لا desync صامت)
    const removed = dayOffs.find((d) => d.id === id);
    setDayOffs((prev) => prev.filter((d) => d.id !== id));
    startTransition(async () => {
      try {
        await deleteProviderDayOff(id);
      } catch {
        if (removed) setDayOffs((prev) => [...prev, removed]);
        setDayOffError("تعذّر حذف الإجازة — أُعيدت للقائمة");
      }
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-surface-900">{userName}</h3>
            <p className="text-xs text-surface-500">جدول العمل والإجازات</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-100">
            <X className="h-4 w-4 text-surface-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-surface-100 rounded-lg p-1">
          <button
            onClick={() => setTab("schedule")}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
              tab === "schedule" ? "bg-white text-surface-900 shadow-sm" : "text-surface-500"
            }`}
          >
            <Clock className="h-4 w-4 inline-block me-1" />
            ساعات العمل
          </button>
          <button
            onClick={() => setTab("dayoffs")}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
              tab === "dayoffs" ? "bg-white text-surface-900 shadow-sm" : "text-surface-500"
            }`}
          >
            <Calendar className="h-4 w-4 inline-block me-1" />
            الإجازات ({dayOffs.length})
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-surface-400" />
          </div>
        ) : tab === "schedule" ? (
          <>
            {/* جدول أسبوعي */}
            <div className="space-y-2">
              {schedule.map((day) => (
                <div
                  key={day.dayOfWeek}
                  className={`p-3 rounded-lg border transition-all ${
                    day.isActive ? "border-surface-200 bg-white" : "border-surface-100 bg-surface-50 opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={day.isActive}
                        onChange={() => handleDayToggle(day.dayOfWeek)}
                        className="rounded border-surface-300"
                      />
                      <span className={`text-sm font-medium ${day.isActive ? "text-surface-900" : "text-surface-400"}`}>
                        {DAY_LABELS[day.dayOfWeek]}
                      </span>
                    </label>
                  </div>

                  {day.isActive && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-surface-400">من</Label>
                        <Input
                          type="time"
                          value={day.startTime}
                          onChange={(e) => handleTimeChange(day.dayOfWeek, "startTime", e.target.value)}
                          className="h-8 text-xs"
                          dir="ltr"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-surface-400">إلى</Label>
                        <Input
                          type="time"
                          value={day.endTime}
                          onChange={(e) => handleTimeChange(day.dayOfWeek, "endTime", e.target.value)}
                          className="h-8 text-xs"
                          dir="ltr"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-surface-400">استراحة من</Label>
                        <Input
                          type="time"
                          value={day.breakStart}
                          onChange={(e) => handleTimeChange(day.dayOfWeek, "breakStart", e.target.value)}
                          className="h-8 text-xs"
                          dir="ltr"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-surface-400">استراحة إلى</Label>
                        <Input
                          type="time"
                          value={day.breakEnd}
                          onChange={(e) => handleTimeChange(day.dayOfWeek, "breakEnd", e.target.value)}
                          className="h-8 text-xs"
                          dir="ltr"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* زر الحفظ */}
            {saveError && (
              <p className="mt-3 text-sm text-danger-600 bg-danger-50 border border-danger-500/20 rounded-lg p-2">
                ⚠️ {saveError}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <Button onClick={handleSave} disabled={isPending} className="flex-1">
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : saved ? (
                  <>✅ تم الحفظ</>
                ) : (
                  <><Save className="h-4 w-4 me-1" /> حفظ الجدول</>
                )}
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* إجازات */}
            <div className="space-y-3">
              {dayOffError && (
                <p className="text-sm text-danger-600 bg-danger-50 border border-danger-500/20 rounded-lg p-2">
                  ⚠️ {dayOffError}
                </p>
              )}
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={newDayOffDate}
                  onChange={(e) => setNewDayOffDate(e.target.value)}
                  className="flex-1 h-9 text-sm"
                  dir="ltr"
                />
                <Input
                  value={newDayOffReason}
                  onChange={(e) => setNewDayOffReason(e.target.value)}
                  placeholder="السبب (اختياري)"
                  className="flex-1 h-9 text-sm"
                />
                <Button onClick={handleAddDayOff} disabled={!newDayOffDate || isPending} size="sm" className="h-9">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {dayOffs.length === 0 ? (
                <p className="text-sm text-surface-400 text-center py-4">لا توجد إجازات مسجلة</p>
              ) : (
                <div className="space-y-1.5">
                  {dayOffs.map((off) => (
                    <div key={off.id} className="flex items-center justify-between p-2.5 rounded-lg bg-danger-50 border border-danger-100">
                      <div>
                        <p className="text-sm font-medium text-surface-900">
                          {new Date(off.date).toLocaleDateString("ar-SA-u-ca-gregory", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}
                        </p>
                        {off.reason && <p className="text-xs text-surface-500">{off.reason}</p>}
                      </div>
                      <button
                        onClick={() => handleDeleteDayOff(off.id)}
                        disabled={isPending}
                        className="p-1.5 rounded-lg hover:bg-danger-100 text-danger-400 hover:text-danger-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
