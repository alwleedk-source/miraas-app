import { Trophy, Medal, Award, TrendingUp } from "lucide-react";
import type { CoordinatorPerformance } from "@/app/actions/analytics-funnel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";

type Props = {
  data: CoordinatorPerformance[];
};

const RANK_BADGES = [
  { icon: Trophy, color: "text-yellow-500", bg: "bg-yellow-50 border-yellow-200" },
  { icon: Medal, color: "text-gray-400", bg: "bg-gray-50 border-gray-200" },
  { icon: Award, color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
];

export default function CoordinatorLeaderboard({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="text-center py-12 bg-surface-50 rounded-xl">
        <p className="text-surface-500 text-sm">لا توجد بيانات منسقات في هذه الفترة</p>
      </div>
    );
  }

  const maxConverted = Math.max(...data.map((d) => d.converted), 1);

  return (
    <div className="space-y-2">
      {data.map((coord, idx) => {
        const rankBadge = idx < 3 ? RANK_BADGES[idx] : null;
        const RankIcon = rankBadge?.icon;
        const conversionWidth = (coord.converted / maxConverted) * 100;
        const tier =
          coord.conversionPct >= 50
            ? "elite"
            : coord.conversionPct >= 30
            ? "strong"
            : coord.conversionPct >= 15
            ? "average"
            : "needs_help";

        return (
          <div
            key={coord.userId}
            className={`relative overflow-hidden rounded-xl border p-3 transition-all hover:shadow-md ${
              idx < 3 ? rankBadge?.bg : "bg-white border-surface-200"
            }`}
          >
            {/* Background bar showing performance */}
            <div
              className="absolute inset-y-0 start-0 bg-gradient-to-l from-primary-50/40 to-transparent transition-all"
              style={{ width: `${conversionWidth}%` }}
            />

            <div className="relative flex items-center gap-3">
              {/* Rank */}
              <div className="shrink-0 w-10 text-center">
                {RankIcon ? (
                  <RankIcon className={`h-6 w-6 mx-auto ${rankBadge.color}`} />
                ) : (
                  <span className="text-sm font-bold text-surface-400">
                    #{idx + 1}
                  </span>
                )}
              </div>

              {/* Avatar + name */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className="bg-primary-100 text-primary-700 text-xs font-semibold">
                    {getInitials(coord.userName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-surface-900 truncate">
                    {coord.userName}
                  </p>
                  <p className="text-[11px] text-surface-500">
                    {coord.totalLeads.toLocaleString("ar-SA")} عميل ·{" "}
                    {coord.contacted.toLocaleString("ar-SA")} تواصل ·{" "}
                    {coord.booked.toLocaleString("ar-SA")} حجز
                  </p>
                </div>
              </div>

              {/* Stats — converted + rate */}
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-end">
                  <p className="text-2xl font-bold text-surface-900 tabular-nums leading-none">
                    {coord.converted.toLocaleString("ar-SA")}
                  </p>
                  <p className="text-[10px] text-surface-500 mt-0.5">صفقة</p>
                </div>
                <div
                  className={`text-end px-2.5 py-1 rounded-lg ${
                    tier === "elite"
                      ? "bg-emerald-100 text-emerald-700"
                      : tier === "strong"
                      ? "bg-blue-100 text-blue-700"
                      : tier === "average"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-rose-100 text-rose-700"
                  }`}
                >
                  <p className="text-lg font-bold tabular-nums leading-none">
                    {coord.conversionPct}%
                  </p>
                  <p className="text-[9px] mt-0.5">معدّل</p>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
