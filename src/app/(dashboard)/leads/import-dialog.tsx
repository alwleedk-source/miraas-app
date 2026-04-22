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
} from "lucide-react";
import { bulkImportLeads, checkDuplicatePhones } from "@/app/actions/leads";
import * as XLSX from "xlsx";

interface ImportRow {
  name: string;
  phone: string;
  status?: "new" | "duplicate" | "deleted" | "no_phone";
}

interface Props {
  onClose: () => void;
  onComplete: (created: number, skipped: number) => void;
}

export default function ImportDialog({ onClose, onComplete }: Props) {
  const [step, setStep] = useState<"upload" | "mapping" | "preview" | "done">("upload");
  const [campaignName, setCampaignName] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<string[][]>([]);
  const [nameCol, setNameCol] = useState(0);
  const [phoneCol, setPhoneCol] = useState(1);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [isPending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // معالجة الملف
  const processFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      const wb = XLSX.read(data, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      if (json.length < 2) return;

      setHeaders(json[0].map((h) => String(h)));
      setRawData(json.slice(1).filter((r) => r.some((c) => String(c).trim())));

      // محاولة تحديد الأعمدة تلقائياً
      const h = json[0].map((c) => String(c).toLowerCase());
      const guessName = h.findIndex((c) =>
        c.includes("name") || c.includes("اسم") || c.includes("الاسم")
      );
      const guessPhone = h.findIndex((c) =>
        c.includes("phone") || c.includes("رقم") || c.includes("هاتف") || c.includes("جوال") || c.includes("mobile")
      );

      if (guessName >= 0) setNameCol(guessName);
      if (guessPhone >= 0) setPhoneCol(guessPhone);

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

  // تأكيد الأعمدة ← الانتقال للمعاينة
  const handleConfirmMapping = () => {
    const parsed: ImportRow[] = rawData
      .map((row) => ({
        name: String(row[nameCol] || "").trim(),
        phone: String(row[phoneCol] || "").trim().replace(/\D/g, ""),
      }))
      .filter((r) => r.name);

    setRows(parsed);
    setStep("preview");

    // فحص المكررات
    const phones = parsed.filter((r) => r.phone).map((r) => r.phone);
    if (phones.length > 0) {
      startTransition(async () => {
        const dupes = await checkDuplicatePhones(phones);
        const dupeMap = new Map(dupes.map((d) => [d.phone, d.status]));
        setRows((prev) =>
          prev.map((r) => ({
            ...r,
            status: !r.phone
              ? "no_phone"
              : dupeMap.has(r.phone)
              ? dupeMap.get(r.phone) === "active"
                ? "duplicate"
                : "deleted"
              : "new",
          }))
        );
      });
    } else {
      setRows((prev) => prev.map((r) => ({ ...r, status: r.phone ? "new" : "no_phone" })));
    }
  };

  // تنفيذ الاستيراد
  const handleImport = () => {
    const toImport = rows.filter((r) => r.status === "new" || r.status === "no_phone");
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

  const newCount = rows.filter((r) => r.status === "new" || r.status === "no_phone").length;
  const dupeCount = rows.filter((r) => r.status === "duplicate" || r.status === "deleted").length;

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

          {/* الخطوة 2: تعيين الأعمدة */}
          {step === "mapping" && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 p-3 bg-success-50 rounded-lg border border-success-200">
                <FileSpreadsheet className="h-5 w-5 text-success-600 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-success-800">{fileName}</p>
                  <p className="text-xs text-success-600">
                    {rawData.length} صف • {headers.length} عمود
                  </p>
                </div>
              </div>

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

              {/* معاينة سريعة */}
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
                    ...و {rawData.length - 5} صف إضافي
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

          {/* الخطوة 3: المعاينة مع كشف المكررات */}
          {step === "preview" && (
            <div className="space-y-4">
              {/* ملخص */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-success-50 rounded-lg border border-success-200 text-center">
                  <p className="text-2xl font-bold text-success-700">{newCount}</p>
                  <p className="text-xs text-success-600 mt-0.5">عميل جديد</p>
                </div>
                <div className="p-3 bg-surface-50 rounded-lg border border-surface-200 text-center">
                  <p className="text-2xl font-bold text-surface-500">{dupeCount}</p>
                  <p className="text-xs text-surface-400 mt-0.5">مكرر (سيُتخطى)</p>
                </div>
              </div>

              {/* الجدول */}
              <div className="border border-surface-200 rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-50">
                    <tr>
                      <th className="text-start p-2 font-medium text-surface-600 w-8">#</th>
                      <th className="text-start p-2 font-medium text-surface-600">الاسم</th>
                      <th className="text-start p-2 font-medium text-surface-600">الرقم</th>
                      <th className="text-start p-2 font-medium text-surface-600 w-24">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-t border-surface-100 ${
                          row.status === "duplicate" || row.status === "deleted"
                            ? "bg-surface-50 opacity-50"
                            : ""
                        }`}
                      >
                        <td className="p-2 text-surface-400 text-xs">{i + 1}</td>
                        <td className="p-2 text-surface-900">{row.name}</td>
                        <td className="p-2 text-surface-600 font-mono text-xs" dir="ltr">
                          {row.phone || "—"}
                        </td>
                        <td className="p-2">
                          {isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin text-surface-400" />
                          ) : row.status === "new" ? (
                            <Badge className="text-[10px] bg-success-50 text-success-700 border-success-200" variant="outline">
                              جديد
                            </Badge>
                          ) : row.status === "duplicate" ? (
                            <Badge className="text-[10px] bg-warning-50 text-warning-700 border-warning-200" variant="outline">
                              ⚠️ مكرر
                            </Badge>
                          ) : row.status === "deleted" ? (
                            <Badge className="text-[10px] bg-surface-50 text-surface-500 border-surface-200" variant="outline">
                              محذوف
                            </Badge>
                          ) : row.status === "no_phone" ? (
                            <Badge className="text-[10px] bg-primary-50 text-primary-700 border-primary-200" variant="outline">
                              جديد
                            </Badge>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setStep("mapping")}>رجوع</Button>
                <Button
                  onClick={handleImport}
                  disabled={isPending || newCount === 0}
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin me-1" />
                  ) : (
                    <Upload className="h-4 w-4 me-1" />
                  )}
                  استيراد {newCount} عميل
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
                  تم إضافة <span className="font-bold text-success-600">{result.created}</span> عميل
                  {result.skipped > 0 && (
                    <> • تم تخطي <span className="font-bold text-surface-500">{result.skipped}</span> مكرر</>
                  )}
                </p>
                {campaignName && (
                  <p className="text-xs text-surface-400 mt-1">
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
