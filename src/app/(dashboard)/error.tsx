"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logClientError } from "@/app/actions/log-client-error";

/**
 * Error boundary لمجموعة (dashboard) — يمسك errors في صفحات dashboard
 * ويحافظ على Sidebar والـ layout.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("dashboard error", error);
    // أرسل للسيرفر ليُسجَّل في error_log
    logClientError({
      message: error.message,
      digest: error.digest,
      stack: error.stack,
      url: typeof window !== "undefined" ? window.location.href : undefined,
    }).catch(() => {});
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <div className="max-w-md text-center bg-white rounded-2xl shadow-sm border border-surface-200 p-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-danger-50 mb-4">
          <AlertTriangle className="h-6 w-6 text-danger-500" />
        </div>
        <h2 className="text-xl font-bold text-surface-900">حدث خطأ في هذه الصفحة</h2>
        <p className="text-surface-500 text-sm mt-2 leading-relaxed">
          يمكنك إعادة المحاولة. إذا استمر، أبلغ المدير بالرمز.
        </p>
        {error.digest && (
          <code className="inline-block mt-3 px-2 py-1 bg-surface-100 text-surface-600 rounded text-[11px] font-mono" dir="ltr">
            {error.digest}
          </code>
        )}
        <div className="mt-5">
          <Button onClick={reset}>
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </Button>
        </div>
      </div>
    </div>
  );
}
