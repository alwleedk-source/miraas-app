import { TrendingDown, TrendingUp, Minus, Target, AlertCircle } from "lucide-react";
import type { FunnelData } from "@/app/actions/analytics-funnel";

type Props = {
  data: FunnelData;
  changes?: {
    totalChange: number;
    convertedChange: number;
    conversionRateChange: number;
  };
};

const STAGE_GRADIENTS = [
  "from-blue-500 to-blue-600",
  "from-indigo-500 to-indigo-600",
  "from-purple-500 to-purple-600",
  "from-pink-500 to-pink-600",
  "from-emerald-500 to-emerald-600",
  "from-amber-500 to-amber-600",
];

const STAGE_BG = [
  "bg-blue-50",
  "bg-indigo-50",
  "bg-purple-50",
  "bg-pink-50",
  "bg-emerald-50",
  "bg-amber-50",
];

const STAGE_TEXT = [
  "text-blue-700",
  "text-indigo-700",
  "text-purple-700",
  "text-pink-700",
  "text-emerald-700",
  "text-amber-700",
];

function ChangeIndicator({ value, suffix = "%" }: { value: number; suffix?: string }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-surface-400">
        <Minus className="h-3 w-3" />
        ثابت
      </span>
    );
  }
  const positive = value > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        positive ? "text-success-700" : "text-danger-600"
      }`}
    >
      {positive ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {positive ? "+" : ""}
      {value}
      {suffix}
    </span>
  );
}

export default function ConversionFunnel({ data, changes }: Props) {
  const { stages, conversionRate, total, insights } = data;
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="space-y-6">
      {/* KPIs ribbon */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-surface-200 bg-white p-4">
          <p className="text-xs text-surface-500 font-medium">إجمالي الـ leads</p>
          <div className="flex items-end gap-2 mt-1">
            <p className="text-3xl font-bold text-surface-900 tabular-nums">
              {total.toLocaleString("ar-SA")}
            </p>
            {changes && <ChangeIndicator value={changes.totalChange} />}
          </div>
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4">
          <p className="text-xs text-surface-500 font-medium">صفقات مُتمَّمة</p>
          <div className="flex items-end gap-2 mt-1">
            <p className="text-3xl font-bold text-surface-900 tabular-nums">
              {(stages[stages.length - 1]?.count ?? 0).toLocaleString("ar-SA")}
            </p>
            {changes && <ChangeIndicator value={changes.convertedChange} />}
          </div>
        </div>
        <div
          className={`rounded-xl border p-4 ${
            conversionRate >= 25
              ? "border-success-200 bg-gradient-to-br from-success-50 to-emerald-50"
              : conversionRate >= 10
              ? "border-primary-200 bg-gradient-to-br from-primary-50 to-blue-50"
              : "border-warning-200 bg-gradient-to-br from-warning-50 to-orange-50"
          }`}
        >
          <p className="text-xs text-surface-600 font-medium flex items-center gap-1">
            <Target className="h-3 w-3" />
            معدّل التحويل النهائي
          </p>
          <div className="flex items-end gap-2 mt-1">
            <p className="text-3xl font-bold text-surface-900 tabular-nums">
              {conversionRate}%
            </p>
            {changes && <ChangeIndicator value={changes.conversionRateChange} suffix="pt" />}
          </div>
        </div>
      </div>

      {/* Funnel visualization — perspective trapezoids */}
      <div className="space-y-2">
        {stages.map((stage, idx) => {
          const widthPct = total > 0 ? Math.max(15, (stage.count / maxCount) * 100) : 15;
          const isFirst = idx === 0;
          const lostFromPrev = isFirst ? 0 : (stages[idx - 1]?.count ?? 0) - stage.count;
          const dropPct = isFirst ? 0 : 100 - stage.pct;

          return (
            <div key={stage.key} className="group">
              {/* Drop indicator between stages */}
              {!isFirst && lostFromPrev > 0 && (
                <div className="flex items-center justify-center py-1">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      dropPct >= 50
                        ? "bg-danger-50 text-danger-600"
                        : dropPct >= 30
                        ? "bg-warning-50 text-warning-700"
                        : "bg-surface-100 text-surface-500"
                    }`}
                  >
                    <TrendingDown className="h-3 w-3" />
                    -{dropPct}% ({lostFromPrev.toLocaleString("ar-SA")} ضائع)
                  </span>
                </div>
              )}

              {/* Stage bar */}
              <div className="flex items-center justify-center">
                <div
                  className="relative transition-all duration-500 hover:scale-[1.01]"
                  style={{ width: `${widthPct}%`, minWidth: "200px" }}
                >
                  <div
                    className={`bg-gradient-to-l ${STAGE_GRADIENTS[idx]} rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-2xl shrink-0">{stage.icon}</span>
                        <div className="min-w-0">
                          <p className="text-white font-semibold text-sm truncate">
                            {stage.label}
                          </p>
                          <p className="text-white/80 text-[11px]">
                            {stage.pctTotal}% من الإجمالي
                          </p>
                        </div>
                      </div>
                      <div className="text-end shrink-0">
                        <p className="text-white text-2xl font-bold tabular-nums">
                          {stage.count.toLocaleString("ar-SA")}
                        </p>
                        {!isFirst && (
                          <p className="text-white/80 text-[11px]">
                            {stage.pct}% من السابق
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="space-y-2">
          {insights.map((insight, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 p-3 rounded-xl border text-sm ${
                insight.startsWith("🔴")
                  ? "bg-danger-50 border-danger-200 text-danger-800"
                  : insight.startsWith("⚠️")
                  ? "bg-warning-50 border-warning-200 text-warning-800"
                  : "bg-success-50 border-success-200 text-success-800"
              }`}
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 opacity-70" />
              <p className="flex-1">{insight}</p>
            </div>
          ))}
        </div>
      )}

      {total === 0 && (
        <div className="text-center py-12 bg-surface-50 rounded-xl">
          <p className="text-surface-500 text-sm">لا توجد بيانات في هذه الفترة</p>
          <p className="text-surface-400 text-xs mt-1">جرّب فترة أوسع</p>
        </div>
      )}

      {/* Stage colors legend (small) */}
      <div className="hidden">
        {STAGE_BG.concat(STAGE_TEXT).map((c) => (
          <div key={c} className={c} />
        ))}
      </div>
    </div>
  );
}
