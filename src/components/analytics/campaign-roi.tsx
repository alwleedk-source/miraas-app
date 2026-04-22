import { Megaphone, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import type { CampaignROI } from "@/app/actions/analytics-funnel";

type Props = {
  data: CampaignROI[];
};

const PLATFORM_ICONS: Record<string, string> = {
  Instagram: "📷",
  Snapchat: "👻",
  TikTok: "🎵",
  "Google Sheets": "📊",
  "Sheet Import": "📄",
  Facebook: "📘",
  WhatsApp: "💬",
  Twitter: "🐦",
  X: "𝕏",
};

export default function CampaignROI({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="text-center py-12 bg-surface-50 rounded-xl">
        <Megaphone className="h-10 w-10 mx-auto mb-2 text-surface-300" />
        <p className="text-surface-500 text-sm">لا توجد حملات في هذه الفترة</p>
      </div>
    );
  }

  // best campaign for highlight
  const bestRate = Math.max(...data.map((d) => d.conversionPct));
  const worstRate = Math.min(...data.filter((d) => d.totalLeads > 5).map((d) => d.conversionPct));

  return (
    <div className="space-y-2">
      {data.map((c) => {
        const isBest = c.conversionPct === bestRate && bestRate > 0;
        const isWorst = c.conversionPct === worstRate && c.totalLeads > 5 && bestRate !== worstRate;
        const platformIcon = c.platform ? PLATFORM_ICONS[c.platform] || "📢" : "📢";

        return (
          <div
            key={c.sourceId ?? c.sourceName}
            className={`rounded-xl border p-3 transition-all hover:shadow-md ${
              isBest
                ? "border-emerald-300 bg-emerald-50/40"
                : isWorst
                ? "border-rose-300 bg-rose-50/40"
                : "border-surface-200 bg-white"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="text-2xl shrink-0">{platformIcon}</div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <p className="font-semibold text-sm text-surface-900 truncate">
                    {c.sourceName}
                  </p>
                  {c.platform && (
                    <span className="text-[10px] bg-surface-100 text-surface-600 px-1.5 py-0.5 rounded-full">
                      {c.platform}
                    </span>
                  )}
                  {isBest && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">
                      <ArrowUpRight className="h-2.5 w-2.5" />
                      الأفضل
                    </span>
                  )}
                  {isWorst && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-medium">
                      <ArrowDownRight className="h-2.5 w-2.5" />
                      الأضعف
                    </span>
                  )}
                </div>

                {/* Mini funnel: leads → booked → converted */}
                <div className="flex items-center gap-1 text-[11px] text-surface-500">
                  <span className="tabular-nums">
                    {c.totalLeads.toLocaleString("ar-SA")} lead
                  </span>
                  <Minus className="h-2.5 w-2.5 rotate-90" />
                  <span className="tabular-nums">
                    {c.contacted.toLocaleString("ar-SA")} تواصل
                  </span>
                  <Minus className="h-2.5 w-2.5 rotate-90" />
                  <span className="tabular-nums">
                    {c.booked.toLocaleString("ar-SA")} حجز
                  </span>
                  <Minus className="h-2.5 w-2.5 rotate-90" />
                  <span className="tabular-nums font-medium text-surface-700">
                    {c.converted.toLocaleString("ar-SA")} صفقة
                  </span>
                </div>
              </div>

              {/* Conversion rate badge */}
              <div className="text-end shrink-0">
                <p
                  className={`text-2xl font-bold tabular-nums ${
                    c.conversionPct >= 30
                      ? "text-emerald-600"
                      : c.conversionPct >= 15
                      ? "text-blue-600"
                      : c.conversionPct >= 5
                      ? "text-amber-600"
                      : "text-rose-600"
                  }`}
                >
                  {c.conversionPct}%
                </p>
                <p className="text-[10px] text-surface-400">تحويل</p>
              </div>
            </div>

            {/* Mini progress bar */}
            <div className="mt-2.5 flex h-1.5 rounded-full overflow-hidden bg-surface-100">
              {/* leads (full = total) */}
              <div className="bg-surface-300" style={{ width: "100%" }} />
            </div>
            <div className="-mt-1.5 flex h-1.5 rounded-full overflow-hidden">
              {/* contacted */}
              <div
                className="bg-blue-300"
                style={{ width: `${(c.contacted / c.totalLeads) * 100}%` }}
              />
            </div>
            <div className="-mt-1.5 flex h-1.5 rounded-full overflow-hidden">
              {/* booked */}
              <div
                className="bg-purple-400"
                style={{ width: `${(c.booked / c.totalLeads) * 100}%` }}
              />
            </div>
            <div className="-mt-1.5 flex h-1.5 rounded-full overflow-hidden">
              {/* converted */}
              <div
                className="bg-emerald-500"
                style={{ width: `${(c.converted / c.totalLeads) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
