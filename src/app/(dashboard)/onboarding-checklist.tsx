import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Circle, ArrowLeft, Sparkles } from "lucide-react";
import type { OnboardingStatus } from "@/app/actions/onboarding";

export default function OnboardingChecklist({ status }: { status: OnboardingStatus }) {
  if (!status.shouldShow) return null;

  const pct = Math.round((status.completedCount / status.totalCount) * 100);
  const isStart = status.completedCount === 0;

  return (
    <Card className="border-primary-200 bg-gradient-to-br from-primary-50/40 via-white to-blue-50/30 shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary-500 to-blue-600 shadow-md">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            {isStart ? "🚀 لنبدأ — 4 خطوات لتفعيل مِراس" : "إكمال إعداد مِراس"}
          </CardTitle>
          <span className="text-xs font-semibold text-primary-700 tabular-nums bg-primary-100 px-2.5 py-1 rounded-full">
            {status.completedCount} / {status.totalCount}
          </span>
        </div>
        {/* progress bar */}
        <div className="h-1.5 w-full bg-surface-100 rounded-full overflow-hidden mt-2">
          <div
            className="h-full bg-gradient-to-l from-primary-500 to-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {status.steps.map((step) => (
          <Link
            key={step.key}
            href={step.href}
            className={`group flex items-center gap-3 p-3 rounded-xl border transition-all ${
              step.done
                ? "bg-success-50/40 border-success-100 hover:bg-success-50/70"
                : "bg-white border-surface-200 hover:border-primary-300 hover:shadow-sm"
            }`}
          >
            {/* icon checkbox */}
            <div className="shrink-0">
              {step.done ? (
                <CheckCircle2 className="h-5 w-5 text-success-500" />
              ) : (
                <Circle className="h-5 w-5 text-surface-300 group-hover:text-primary-400 transition-colors" />
              )}
            </div>
            {/* emoji + content */}
            <span className="text-xl shrink-0">{step.icon}</span>
            <div className="flex-1 min-w-0">
              <p
                className={`text-sm font-semibold ${
                  step.done ? "text-success-800 line-through decoration-success-300" : "text-surface-900"
                }`}
              >
                {step.label}
              </p>
              <p className="text-[11px] text-surface-500 truncate">{step.description}</p>
            </div>
            {!step.done && (
              <ArrowLeft className="h-4 w-4 text-surface-300 group-hover:text-primary-500 group-hover:-translate-x-1 transition-all shrink-0" />
            )}
          </Link>
        ))}

        {status.completedCount === status.totalCount && (
          <div className="text-center py-2">
            <p className="text-xs text-success-700 font-medium">
              🎉 ممتاز! إعدادك الأولي مكتمل. هذه البطاقة ستختفي بعد إضافة عميلَين آخَرين.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
