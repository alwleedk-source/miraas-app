"use client";

import { useState, useCallback, useTransition, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileSpreadsheet,
  X,
  Check,
  Loader2,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { bulkImportLeads, checkDuplicatePhones } from "@/app/actions/leads";
import { detectColumns } from "@/lib/smart-import";
import { normalizePhoneStrict } from "@/lib/utils";
import * as XLSX from "xlsx";

type RowStatus = "valid" | "duplicate" | "deleted" | "invalid_phone" | "no_phone" | "no_name";

interface ImportRow {
  name: string;
  rawPhone: string; // الرقم كما جاء من الملف
  normalizedPhone: string | null; // E.164 لو صالح
  status: RowStatus;
  errorReason?: string;
}

interface Props {
  onClose: () => void;
  onComplete: (created: number, skipped: number) => void;
}

const STATUS_BADGES: Record<RowStatus, { label: string; cls: string }> = {
  valid: { label: "✓ جديد", cls: "bg-success-50 text-success-700 border-success-200" },
  duplicate: { label: "⚠️ مكرر", cls: "bg-warning-50 text-warning-700 border-warning-200" },
  deleted: { label: "🗑️ محذوف", cls: "bg-surface-50 text-surface-500 border-surface-200" },
  invalid_phone: { label: "❌ رقم غير صالح", cls: "bg-danger-50 text-danger-700 border-danger-200" },
  no_phone: { label: "📭 بلا رقم", cls: "bg-surface-50 text-surface-500 border-surface-200" },
  no_name: { label: "❌ بلا اسم", cls: "bg-danger-50 text-danger-700 border-danger-200" },
};

export default function ImportDialog({ onClose, onComplete }: Props) {
  const [step, setStep] = useState<"upload" | "mapping" | "preview" | "done">("upload");
  const [campaignName, setCampaignName] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<string[][]>([]);
  const [nameCol, setNameCol] = useState(0);
  const [phoneCol, setPhoneCol] = useState(1);
  const [detectionConfidence, setDetectionConfidence] = useState(0);
  const [detectionMethod, setDetectionMethod] = useState<"headers" | "content" | "fallback" | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [isPending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    skipped: number;
    skippedDuplicate?: number;
    skippedInvalid?: number;
    skippedNoPhone?: number;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // معالجة الملف — كاشف ذكي للأعمدة
  const processFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      const wb = XLSX.read(data, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      if (json.length < 2) return;

      const hdrs = json[0].map((h) => String(h));
      const body = json.slice(1).filter((r) => r.some((c) => String(c).trim()));

      setHeaders(hdrs);
      setRawData(body);

      // 🧠 كاشف ذكي
      const detection = detectColumns(hdrs, body);
      setNameCol(detection.nameCol >= 0 ? detection.nameCol : 0);
      setPhoneCol(detection.phoneCol >= 0 ? detection.phoneCol : 1);
      setDetectionConfidence(detection.confidence);
      setDetectionMethod(detection.method);

      setStep("mapping");
    };
    reader.readAsBinaryString(file);
  }, []);

  // السحب والإفلات
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  // تأكيد الأعمدة ← المعاينة
  const handleConfirmMapping = () => {
    // تصنيف كل صف بشكل صارم
    const parsed: ImportRow[] = rawData.map((row) => {
      const name = String(row[nameCol] || "").trim();
      const rawPhone = String(row[phoneCol] || "").trim();

      if (!name) {
        return {
          name: rawPhone || "—",
          rawPhone,
          normalizedPhone: null,
          status: "no_name" as RowStatus,
          errorReason: "بدون اسم",
        };
      }
      if (!rawPhone) {
        return {
          name,
          rawPhone: "",
          normalizedPhone: null,
          status: "no_phone" as RowStatus,
        };
      }
      const r = normalizePhoneStrict(rawPhone);
      if (!r.ok) {
        return {
          name,
          rawPhone,
          normalizedPhone: null,
          status: "invalid_phone" as RowStatus,
          errorReason: r.error,
        };
      }
      return {
        name,
        rawPhone,
        normalizedPhone: r.phone,
        status: "valid" as RowStatus,
      };
    });

    setRows(parsed);
    setStep("preview");

    // فحص المكررات على الصالحة فقط
    const validPhones = parsed
      .filter((r) => r.status === "valid" && r.normalizedPhone)
      .map((r) => r.normalizedPhone!);
    if (validPhones.length > 0) {
      startTransition(async () => {
        const dupes = await checkDuplicatePhones(validPhones);
        const dupeMap = new Map(dupes.map((d) => [d.phone, d.status]));
        setRows((prev) =>
          prev.map((r) => {
            if (r.status !== "valid" || !r.normalizedPhone) return r;
            const dupStatus = dupeMap.get(r.normalizedPhone);
            if (dupStatus === "active") return { ...r, status: "duplicate" as RowStatus };
            if (dupStatus === "deleted") return { ...r, status: "deleted" as RowStatus };
            return r;
          })
        );
      });
    }
  };

  // تنفيذ الاستيراد — يرسل فقط الصالحة (الـ backend يتحقق مرة أخرى)
  const handleImport = () => {
    const toImport = rows
      .filter((r) => r.status === "valid")
      .map((r) => ({ name: r.name, phone: r.normalizedPhone! }));
    if (toImport.length === 0) return;

    startTransition(async () => {
      const res = await bulkImportLeads({
        campaignName,
        leads: toImport,
      });
      setResult(res);
      setStep("done");
    });
  };

  // إحصاءات
  const counts = rows.reduce(
    (acc, r) => {
      acc[r.status]++;
      return acc;
    },
    { valid: 0, duplicate: 0, deleted: 0, invalid_phone: 0, no_phone: 0, no_name: 0 } as Record<RowStatus, number>,
  );

  const confidenceLabel =
    detectionConfidence >= 85
      ? "ثقة عالية"
      : detectionConfidence >= 60
      ? "ثقة متوسطة"
      : "ثقة منخفضة — راجع الأعمدة";
  const confidenceColor =
    detectionConfidence >= 85
      ? "text-success-700 bg-success-50 border-success-200"
      : detectionConfidence >= 60
      ? "text-primary-700 bg-primary-50 border-primary-200"
      : "text-warning-700 bg-warning-50 border-warning-200";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <CardHeader className="pb-3 border-b border-surface-100 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-success-600" />
              استيراد عملاء من ملف
            </CardTitle>
            <button onClick={onClose} className="p-1 rounded hover:bg-surface-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </CardHeader>

        <CardContent className="p-5 overflow-y-auto flex-1">
          {/* الخطوة 1: اسم الحملة + رفع الملف */}
          {step === "upload" && (
            <div className="space-y-5">
              <div>
                <label className="text-sm font-medium text-surface-700 block mb-1.5">
                  اسم الحملة
                </label>
                <Input
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="مثال: حملة رمضان 2026"
                  autoFocus
                />
                <p className="text-xs text-surface-400 mt-1">
                  سيُستخدم كمصدر للعملاء المستوردين
                </p>
              </div>

              <div
                className={`border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer ${
                  dragOver
                    ? "border-primary-400 bg-primary-50"
                    : "border-surface-200 hover:border-primary-300 hover:bg-surface-50"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-10 w-10 mx-auto mb-3 text-surface-300" />
                <p className="text-sm font-medium text-surface-700">
                  اسحب الملف هنا أو اضغط للتحميل
                </p>
                <p className="text-xs text-surface-400 mt-1">
                  يدعم: .xlsx .xls .csv
                </p>
                <p className="text-xs text-primary-600 mt-2 inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  كاشف ذكي يجد الاسم والرقم تلقائياً حتى لو فيه أعمدة كثيرة
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) processFile(file);
                  }}
                />
              </div>
            </div>
          )}

          {/* الخطوة 2: تعيين الأعمدة (مع كاشف ذكي) */}
          {step === "mapping" && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 p-3 bg-success-50 rounded-lg border border-success-200">
                <FileSpreadsheet className="h-5 w-5 text-success-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-success-800 truncate">{fileName}</p>
                  <p className="text-xs text-success-600">
                    {rawData.length} صف • {headers.length} عمود
                  </p>
                </div>
              </div>

              {/* بطاقة الكشف الذكي */}
              {detectionMethod && (
                <div className={`flex items-start gap-2 p-3 rounded-lg border ${confidenceColor}`}>
                  <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="text-xs">
                    <p className="font-semibold">
                      🧠 الكاشف الذكي: {confidenceLabel} ({detectionConfidence}%)
                    </p>
                    <p className="opacity-80 mt-0.5">
                      {detectionMethod === "headers" && "تم التعرّف من عناوين الأعمدة"}
                      {detectionMethod === "content" && "تم التعرّف بتحليل محتوى الصفوف"}
                      {detectionMethod === "fallback" && "تخمين أولي — راجع الأعمدة بدقة"}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-surface-700 block mb-1.5">
                    عمود الاسم
                  </label>
                  <select
                    value={nameCol}
                    onChange={(e) => setNameCol(Number(e.target.value))}
                    className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm bg-white"
                  >
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        العمود {String.fromCharCode(65 + i)}: {h || `(فارغ)`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 block mb-1.5">
                    عمود الرقم
                  </label>
                  <select
                    value={phoneCol}
                    onChange={(e) => setPhoneCol(Number(e.target.value))}
                    className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm bg-white"
                  >
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        العمود {String.fromCharCode(65 + i)}: {h || `(فارغ)`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* معاينة سريعة — يبرز الأعمدة المُختارة فقط */}
              <div className="border border-surface-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-50">
                      <th className="text-start p-2 font-medium text-surface-600">الاسم</th>
                      <th className="text-start p-2 font-medium text-surface-600">الرقم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rawData.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t border-surface-100">
                        <td className="p-2 text-surface-900">{String(row[nameCol] || "—")}</td>
                        <td className="p-2 text-surface-600 font-mono text-xs" dir="ltr">
                          {String(row[phoneCol] || "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rawData.length > 5 && (
                  <p className="text-xs text-surface-400 text-center py-2 border-t border-surface-100">
                    ...و {rawData.length - 5} صف إضافي (بقية الأعمدة ستُتجاهل)
                  </p>
                )}
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setStep("upload")}>رجوع</Button>
                <Button onClick={handleConfirmMapping}>
                  <Check className="h-4 w-4 me-1" />
                  تأكيد ومعاينة
                </Button>
              </div>
            </div>
          )}

          {/* الخطوة 3: المعاينة الكاملة + كشف الأخطاء */}
          {step === "preview" && (
            <div className="space-y-4">
              {/* ملخص شامل */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 bg-success-50 rounded-lg border border-success-200 text-center">
                  <p className="text-xl font-bold text-success-700">{counts.valid}</p>
                  <p className="text-[10px] text-success-600 mt-0.5">سيُستورد</p>
                </div>
                <div className="p-2.5 bg-warning-50 rounded-lg border border-warning-200 text-center">
                  <p className="text-xl font-bold text-warning-700">{counts.duplicate + counts.deleted}</p>
                  <p className="text-[10px] text-warning-600 mt-0.5">مكرر</p>
                </div>
                <div className="p-2.5 bg-danger-50 rounded-lg border border-danger-200 text-center">
                  <p className="text-xl font-bold text-danger-700">{counts.invalid_phone + counts.no_name}</p>
                  <p className="text-[10px] text-danger-600 mt-0.5">رفض/خطأ</p>
                </div>
                <div className="p-2.5 bg-surface-50 rounded-lg border border-surface-200 text-center">
                  <p className="text-xl font-bold text-surface-500">{counts.no_phone}</p>
                  <p className="text-[10px] text-surface-400 mt-0.5">بلا رقم</p>
                </div>
              </div>

              {/* تحذير لو فيها رفض */}
              {(counts.invalid_phone > 0 || counts.no_name > 0) && (
                <div className="flex items-start gap-2 p-3 bg-danger-50 border border-danger-200 rounded-lg text-xs text-danger-700">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">صفوف لن تُستورد:</p>
                    <ul className="mt-1 list-disc list-inside space-y-0.5">
                      {counts.invalid_phone > 0 && <li>{counts.invalid_phone} رقم غير صالح (راجع الجدول)</li>}
                      {counts.no_name > 0 && <li>{counts.no_name} صف بدون اسم</li>}
                      {counts.no_phone > 0 && <li>{counts.no_phone} بدون رقم — لن تستفيد منهم العيادة</li>}
                    </ul>
                  </div>
                </div>
              )}

              {/* الجدول */}
              <div className="border border-surface-200 rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-50">
                    <tr>
                      <th className="text-start p-2 font-medium text-surface-600 w-8">#</th>
                      <th className="text-start p-2 font-medium text-surface-600">الاسم</th>
                      <th className="text-start p-2 font-medium text-surface-600">الرقم</th>
                      <th className="text-start p-2 font-medium text-surface-600 w-32">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const dimmed = row.status !== "valid";
                      return (
                        <tr
                          key={i}
                          className={`border-t border-surface-100 ${dimmed ? "bg-surface-50/50" : ""}`}
                        >
                          <td className="p-2 text-surface-400 text-xs">{i + 1}</td>
                          <td className={`p-2 ${dimmed ? "text-surface-500" : "text-surface-900"}`}>
                            {row.name}
                          </td>
                          <td className="p-2 font-mono text-xs" dir="ltr">
                            {row.status === "valid" ? (
                              <span className="text-success-700">{row.normalizedPhone}</span>
                            ) : row.rawPhone ? (
                              <span className="text-surface-500 line-through">{row.rawPhone}</span>
                            ) : (
                              <span className="text-surface-300">—</span>
                            )}
                          </td>
                          <td className="p-2">
                            {isPending && row.status === "valid" ? (
                              <Loader2 className="h-3 w-3 animate-spin text-surface-400" />
                            ) : (
                              <Badge
                                className={`text-[10px] ${STATUS_BADGES[row.status].cls}`}
                                variant="outline"
                                title={row.errorReason}
                              >
                                {STATUS_BADGES[row.status].label}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setStep("mapping")}>رجوع</Button>
                <Button
                  onClick={handleImport}
                  disabled={isPending || counts.valid === 0}
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin me-1" />
                  ) : (
                    <Upload className="h-4 w-4 me-1" />
                  )}
                  استيراد {counts.valid} عميل صالح
                </Button>
              </div>
            </div>
          )}

          {/* الخطوة 4: النتيجة */}
          {step === "done" && result && (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-success-50 flex items-center justify-center">
                <Check className="h-8 w-8 text-success-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-surface-900">تم الاستيراد بنجاح!</h3>
                <p className="text-surface-500 mt-1">
                  أُضيف <span className="font-bold text-success-600">{result.created}</span> عميل
                </p>
                {result.skipped > 0 && (
                  <div className="mt-3 inline-block text-start p-3 bg-surface-50 rounded-lg border border-surface-200 text-xs space-y-1">
                    <p className="font-semibold text-surface-700">تفصيل المتخطّى:</p>
                    {(result.skippedDuplicate ?? 0) > 0 && (
                      <p>⚠️ مكرر: {result.skippedDuplicate}</p>
                    )}
                    {(result.skippedInvalid ?? 0) > 0 && (
                      <p>❌ رقم غير صالح: {result.skippedInvalid}</p>
                    )}
                    {(result.skippedNoPhone ?? 0) > 0 && (
                      <p>📭 بلا رقم: {result.skippedNoPhone}</p>
                    )}
                  </div>
                )}
                {campaignName && (
                  <p className="text-xs text-surface-400 mt-3">
                    الحملة: {campaignName}
                  </p>
                )}
              </div>
              <Button onClick={() => onComplete(result.created, result.skipped)}>
                إغلاق
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
