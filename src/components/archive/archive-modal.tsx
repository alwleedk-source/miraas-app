"use client";

import { useState, useTransition } from "react";
import { X, Loader2, CalendarClock, Ban, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { archiveLead } from "@/app/actions/archive";
import {
  ARCHIVE_REASONS,
  ARCHIVE_REASON_KEYS,
  type ArchiveReasonKey,
} from "@/lib/archive-reasons";

type Props = {
  leadId: string;
  leadName: string;
  open: boolean;
  onClose: () => void;
  onArchived?: () => void;
};

const QUICK_REACTIVATE_PRESETS = [
  { label: "+ أسبوع", days: 7 },
  { label: "+ شهر", days: 30 },
  { label: "+ 3 أشهر", days: 90 },
  { label: "+ 6 أشهر", days: 180 },
];

export function ArchiveModal({ leadId, leadName, open, onClose, onArchived }: Props) {
  const [reason, setReason] = useState<ArchiveReasonKey | null>(null);
  const [note, setNote] = useState("");
  const [reactivateAt, setReactivateAt] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) return null;

  const reasonInfo = reason ? ARCHIVE_REASONS[reason] : null;
  const canScheduleReturn = reasonInfo?.canRevive ?? false;
  const isDnc = reason === "DO_NOT_CONTACT";

  const setReactivateInDays = (days: number) => {
    // 10 صباحاً بجدار الرياض بعد N يوم — تُرسل كسلسلة مجرّدة ويفسّرها الخادم
    // كتوقيت الرياض (parseRiyadhDateTime). الرياض UTC+3 بلا تبديل صيفي.
    const wall = new Date(new Date().getTime() + 3 * 60 * 60 * 1000 + days * 86400_000).toISOString();
    setReactivateAt(`${wall.slice(0, 10)}T10:00`);
  };

  const handleConfirm = () => {
    if (!reason) {
      setError("اختر سبباً للأرشفة");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await archiveLead({
          leadId,
          reason,
          note: note.trim() || undefined,
          // وقت جدار مجرّد — يُفسَّر رياضاً في الخادم (لا تحويل بتوقيت المتصفح)
          reactivateAt: reactivateAt && canScheduleReturn ? reactivateAt : undefined,
          isDoNotContact: isDnc,
        });
        if (!res.success) {
          setError(res.error);
          return;
        }
        onArchived?.();
        // reset state
        setReason(null);
        setNote("");
        setReactivateAt("");
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "فشلت الأرشفة");
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-surface-200">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-surface-900">
              📦 أرشفة العميل
            </h3>
            <p className="text-xs text-surface-500 mt-0.5 truncate">{leadName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-100"
          >
            <X className="h-4 w-4 text-surface-400" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* warning banner */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-primary-50 border border-primary-100 text-xs text-primary-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-primary-500" />
            <p className="leading-relaxed">
              <strong>الأرشفة لا تحذف العميل.</strong> يبقى محفوظاً في صفحة الأرشيف،
              ويمكنك إعادة تفعيله متى شئت. تذكيرات المتابعة تتوقف تلقائياً.
            </p>
          </div>

          {/* Reason picker */}
          <div className="space-y-2">
            <Label>سبب الأرشفة *</Label>
            <div className="grid grid-cols-1 gap-1.5">
              {ARCHIVE_REASON_KEYS.map((key) => {
                const r = ARCHIVE_REASONS[key];
                const selected = reason === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setReason(key)}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-start transition-all ${
                      selected
                        ? "border-primary-400 bg-primary-50 ring-2 ring-primary-100"
                        : "border-surface-200 hover:border-surface-300 hover:bg-surface-50"
                    }`}
                  >
                    <span className="text-lg shrink-0">{r.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${selected ? "text-primary-700" : "text-surface-900"}`}>
                        {r.label}
                      </p>
                      <p className="text-[11px] text-surface-500 mt-0.5 leading-relaxed">
                        {r.description}
                      </p>
                    </div>
                    {key === "DO_NOT_CONTACT" && (
                      <span className="text-[10px] bg-surface-200 text-surface-500 px-1.5 py-0.5 rounded-full shrink-0">
                        نهائي
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label>ملاحظة (اختياري)</Label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: قال السعر مرتفع، يفضّل التقسيط"
              rows={3}
              maxLength={2000}
              className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
            <p className="text-[10px] text-surface-400">{note.length}/2000</p>
          </div>

          {/* Reactivate date — only if reason allows revival (يشمل «سبب آخر») */}
          {canScheduleReturn && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5 text-surface-400" />
                ذكّرني بهذا العميل (اختياري)
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_REACTIVATE_PRESETS.map((p) => (
                  <button
                    key={p.days}
                    type="button"
                    onClick={() => setReactivateInDays(p.days)}
                    className="px-2.5 py-1 text-xs rounded-md bg-surface-100 hover:bg-surface-200 text-surface-700 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
                {reactivateAt && (
                  <button
                    type="button"
                    onClick={() => setReactivateAt("")}
                    className="px-2.5 py-1 text-xs rounded-md bg-danger-50 hover:bg-danger-100 text-danger-600 transition-colors"
                  >
                    ✕ مسح
                  </button>
                )}
              </div>
              <Input
                type="datetime-local"
                value={reactivateAt}
                onChange={(e) => setReactivateAt(e.target.value)}
                dir="ltr"
                className="text-left"
              />
              {reactivateAt && (
                <p className="text-[11px] text-success-600">
                  ✓ سيظهر تنبيه في لوحة التحكم في هذا الموعد
                </p>
              )}
            </div>
          )}

          {/* DNC warning */}
          {isDnc && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-danger-50 border border-danger-200 text-xs text-danger-700">
              <Ban className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                <strong>تحذير:</strong> اختيارك لـ &quot;طلب عدم التواصل&quot; يقفل العميل نهائياً —
                لن تستطيع إعادة تفعيله أو الاتصال به. هذا احتراماً لقراره.
              </p>
            </div>
          )}

          {error && (
            <div className="text-sm text-danger-600 bg-danger-50 p-2 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 p-4 border-t border-surface-200 bg-surface-50/30">
          <Button variant="outline" onClick={onClose} className="flex-1" disabled={isPending}>
            إلغاء
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!reason || isPending}
            className="flex-1"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "تأكيد الأرشفة"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
