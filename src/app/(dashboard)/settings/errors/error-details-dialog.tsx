"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getErrorDetails } from "@/app/actions/errors";
import { AlertTriangle, Clock, Hash, X, Loader2, ChevronRight } from "lucide-react";
import { useNow } from "@/lib/hooks";

type ErrorSummary = {
  fingerprint: string | null;
  message: string;
  errorName: string | null;
  level: string;
  count: number;
  lastSeen: Date;
  firstSeen: Date;
};

type ErrorDetail = Awaited<ReturnType<typeof getErrorDetails>>[number];

export default function ErrorDetailsDialog({ summary }: { summary: ErrorSummary }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<ErrorDetail[]>([]);
  const now = useNow();

  const handleOpen = async () => {
    if (!summary.fingerprint) return;
    setOpen(true);
    setLoading(true);
    try {
      const data = await getErrorDetails(summary.fingerprint);
      setDetails(data);
    } catch {
      setDetails([]);
    } finally {
      setLoading(false);
    }
  };

  const timeAgo = (d: Date | string) => {
    if (now === 0) return "";
    const date = new Date(d);
    const diff = now - date.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "الآن";
    if (mins < 60) return `منذ ${mins} د`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `منذ ${hrs} س`;
    const days = Math.floor(hrs / 24);
    return `منذ ${days} يوم`;
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="w-full text-start p-3 rounded-lg border border-surface-200 hover:border-danger-300 hover:bg-danger-50/30 transition-all"
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <AlertTriangle
              className={`h-4 w-4 ${summary.level === "error" ? "text-danger-500" : "text-warning-500"}`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {summary.errorName && (
                <Badge variant="outline" className="text-[10px] font-mono">
                  {summary.errorName}
                </Badge>
              )}
              <Badge
                variant={summary.level === "error" ? "danger" : "warning"}
                className="text-[10px]"
              >
                ×{summary.count}
              </Badge>
            </div>
            <p className="text-sm text-surface-900 truncate">{summary.message}</p>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-surface-400">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {timeAgo(summary.lastSeen)}
              </span>
              {summary.fingerprint && (
                <span className="inline-flex items-center gap-1 font-mono">
                  <Hash className="h-3 w-3" />
                  {summary.fingerprint.slice(0, 8)}
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-surface-300 shrink-0 mt-1" />
        </div>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-surface-200">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-surface-900 truncate">
                  {summary.errorName || "Error"}: {summary.message}
                </h3>
                <p className="text-xs text-surface-500 mt-0.5">
                  {summary.count} حادث — أحدثها {timeAgo(summary.lastSeen)}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-surface-400" />
                </div>
              ) : details.length === 0 ? (
                <p className="text-center text-surface-400 py-8">لا توجد تفاصيل</p>
              ) : (
                details.map((d) => (
                  <div
                    key={d.id}
                    className="p-3 rounded-lg bg-surface-50 border border-surface-200"
                  >
                    <div className="flex items-center gap-2 text-[11px] text-surface-500 mb-2 flex-wrap">
                      <Clock className="h-3 w-3" />
                      <span>{new Date(d.createdAt).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}</span>
                      {d.userName && <span>• {d.userName}</span>}
                      {d.url && <span className="truncate">• {d.url}</span>}
                    </div>
                    {d.errorStack && (
                      <pre className="text-[11px] bg-surface-900 text-surface-100 p-2 rounded overflow-x-auto font-mono leading-relaxed">
                        {d.errorStack.slice(0, 2000)}
                      </pre>
                    )}
                    {d.context && Object.keys(d.context).length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-surface-500 cursor-pointer">
                          Context
                        </summary>
                        <pre className="text-[11px] bg-white p-2 rounded mt-1 overflow-x-auto">
                          {JSON.stringify(d.context, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
