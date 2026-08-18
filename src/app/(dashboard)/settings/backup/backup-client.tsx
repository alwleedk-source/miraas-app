"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2, Check, AlertCircle, Wifi, RefreshCw,
  CheckCircle2, XCircle, Power, Eye, EyeOff,
} from "lucide-react";
import {
  saveBackupSettings,
  testBackupAction,
  generateBackupSecret,
} from "@/app/actions/backup-settings";

type Status = {
  enabled: boolean;
  url: string;
  hasSecret: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
};

export default function BackupClient({ initial }: { initial: Status }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [url, setUrl] = useState(initial.url);
  // السر لا يُحمَّل من الخادم لأمانك — فارغ عند الفتح، يُملأ فقط لو تغيّر
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSecret = () => {
    startTransition(async () => {
      const s = await generateBackupSecret();
      setSecret(s);
      setShowSecret(true);
    });
  };

  const handleTest = () => {
    if (!url) {
      setTestResult({ ok: false, message: "أدخل URL أولاً" });
      return;
    }
    if (!secret) {
      setTestResult({
        ok: false,
        message: initial.hasSecret
          ? "أدخل السر أو ولّد سراً جديداً للاختبار"
          : "ولّد سراً أولاً",
      });
      return;
    }
    setTesting(true);
    setTestResult(null);
    startTransition(async () => {
      try {
        const result = await testBackupAction({ url, secret });
        setTestResult(result);
      } catch (e) {
        setTestResult({ ok: false, message: e instanceof Error ? e.message : "فشل الاختبار" });
      } finally {
        setTesting(false);
      }
    });
  };

  const handleSave = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        // لو السر فارغ ومحفوظ سابقاً، لا نُرسله — يُبقي على القديم
        const result = await saveBackupSettings({
          url,
          secret: secret || undefined,
          enabled,
        });
        if (!result.success) {
          setError(result.error);
          return;
        }
        setSaved(true);
        setSecret(""); // امسح من الـ UI بعد الحفظ
        setTimeout(() => setSaved(false), 3000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "فشل الحفظ");
      }
    });
  };

  return (
    <Card className={enabled ? "border-success-300" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Wifi className={`h-5 w-5 ${enabled ? "text-success-500" : "text-surface-400"}`} />
            إعدادات الربط
          </CardTitle>
          {/* Toggle */}
          <button
            onClick={() => setEnabled(!enabled)}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              enabled
                ? "bg-success-100 text-success-700 hover:bg-success-200"
                : "bg-surface-100 text-surface-500 hover:bg-surface-200"
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            {enabled ? "مُفعَّل" : "معطَّل"}
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* URL */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">رابط Web App (من Apps Script)</Label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/..."
            dir="ltr"
            className="text-left font-mono text-xs"
          />
        </div>

        {/* Secret */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">
              السر المشترك
              {initial.hasSecret && !secret && (
                <span className="ms-2 text-[10px] font-normal text-success-600 bg-success-50 px-1.5 py-0.5 rounded">
                  ✓ محفوظ
                </span>
              )}
            </Label>
            <button
              onClick={generateSecret}
              type="button"
              disabled={isPending}
              className="text-xs text-primary-600 hover:text-primary-800 inline-flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              {initial.hasSecret ? "ولّد سراً جديداً" : "ولّد سراً"}
            </button>
          </div>
          <div className="relative">
            <Input
              type={showSecret ? "text" : "password"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={
                initial.hasSecret
                  ? "السر محفوظ — اتركه فارغاً للإبقاء، أو الصق سراً جديداً"
                  : "ولّد سراً جديداً أو الصق واحداً"
              }
              dir="ltr"
              className="text-left font-mono pe-10"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute end-2 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-surface-600"
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[11px] text-surface-500 leading-relaxed">
            ⚠️ يجب أن يكون نفس السر الذي وضعته في كود Apps Script (السطر الأول).
            {initial.hasSecret && " السر مخفي لأمانك — لو نسيته، ولّد سراً جديداً وحدّث Apps Script."}
          </p>
        </div>

        {/* Test connection */}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button
            onClick={handleTest}
            disabled={!url || !secret || testing || isPending}
            variant="outline"
            size="sm"
          >
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Wifi className="h-4 w-4" />
                اختبر الاتصال
              </>
            )}
          </Button>

          <Button onClick={handleSave} disabled={isPending} size="sm">
            {isPending && !testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <>
                <Check className="h-4 w-4" />
                تم الحفظ
              </>
            ) : (
              "حفظ الإعدادات"
            )}
          </Button>
        </div>

        {/* Test result */}
        {testResult && (
          <div
            className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
              testResult.ok
                ? "bg-success-50 border border-success-200 text-success-700"
                : "bg-danger-50 border border-danger-200 text-danger-700"
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-50 border border-danger-200 text-sm text-danger-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Status indicators */}
        {enabled && (initial.lastSyncAt || initial.lastError) && (
          <div className="pt-3 border-t border-surface-100 space-y-1.5">
            {initial.lastSyncAt && (
              <p className="text-xs text-success-600 flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3" />
                آخر مزامنة ناجحة:{" "}
                {new Date(initial.lastSyncAt).toLocaleString("ar-SA", {
                  timeZone: "Asia/Riyadh",
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            )}
            {initial.lastError && (
              <p className="text-xs text-danger-600 flex items-center gap-1.5">
                <AlertCircle className="h-3 w-3" />
                آخر خطأ: {initial.lastError}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
