import { AlertTriangle, AlertOctagon, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getAgingLeadsCount } from "@/app/actions/leads";

/**
 * Banner أعلى Dashboard يُظهر عدد العملاء المُهمَلين (لم يُتابَعوا منذ 3+ أيام)
 *
 * - إذا 0 → ما يظهر شيء (لا ضوضاء)
 * - 1-7 → banner أصفر تحذيري
 * - 8+ مع وجود critical (7+ days) → banner أحمر
 *
 * COORDINATOR يرى عملاءه فقط.
 * OWNER/ADMIN يرى الكل + breakdown per منسقة.
 */
export default async function AgingLeadsBanner() {
  let stats: Awaited<ReturnType<typeof getAgingLeadsCount>>;
  try {
    stats = await getAgingLeadsCount(3);
  } catch {
    return null;
  }

  if (stats.total === 0) return null;

  const isCritical = stats.critical >= 5 || stats.total >= 15;
  const colorClass = isCritical
    ? "bg-danger-50 border-danger-200 text-danger-700"
    : "bg-warning-50 border-warning-200 text-warning-700";
  const iconClass = isCritical ? "text-danger-500" : "text-warning-500";
  const Icon = isCritical ? AlertOctagon : AlertTriangle;

  return (
    <div className={`rounded-xl border p-4 ${colorClass}`}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          <Icon className={`h-5 w-5 ${iconClass}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm">
            {stats.total} عميل بحاجة متابعة
            {stats.critical > 0 && (
              <span className="ms-2 text-xs font-normal">
                (منهم {stats.critical} متروك أكثر من أسبوع)
              </span>
            )}
          </h3>
          <p className="text-xs mt-1 opacity-90">
            هؤلاء العملاء لم يحدث لهم تواصل منذ 3 أيام أو أكثر — تواصل معهم قبل أن تخسرهم.
          </p>

          {stats.byCoordinator.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {stats.byCoordinator.slice(0, 5).map((c) => (
                <span
                  key={c.userId}
                  className="text-[11px] bg-white/60 rounded-full px-2 py-0.5 font-medium"
                >
                  {c.userName}: {c.count}
                </span>
              ))}
            </div>
          )}
        </div>
        <Link
          href="/leads/aging"
          className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg ${
            isCritical
              ? "bg-danger-600 hover:bg-danger-700 text-white"
              : "bg-warning-600 hover:bg-warning-700 text-white"
          } transition-colors`}
        >
          عرض الكل
          <ArrowLeft className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
