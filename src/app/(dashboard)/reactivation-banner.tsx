import Link from "next/link";
import { RefreshCw, ArrowLeft } from "lucide-react";
import { getArchiveStats } from "@/app/actions/archive";

/**
 * Banner يظهر إذا فيه عملاء مؤرشفين حلّ موعد إعادة تفعيلهم
 * (المنسقة قالت "ذكّرني بعد شهر" والشهر انقضى).
 *
 * يظهر فقط إذا dueForReactivation > 0.
 */
export default async function ReactivationBanner() {
  let stats: Awaited<ReturnType<typeof getArchiveStats>>;
  try {
    stats = await getArchiveStats();
  } catch {
    return null;
  }

  if (stats.dueForReactivation === 0) return null;

  return (
    <Link
      href="/leads/archive?due=1"
      className="block rounded-xl border border-success-200 bg-success-50 p-4 hover:bg-success-100 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0 p-2 rounded-lg bg-success-100">
          <RefreshCw className="h-5 w-5 text-success-700" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm text-success-800">
            🔔 {stats.dueForReactivation} عميل من الأرشيف جاء وقت العودة
          </p>
          <p className="text-xs text-success-700 mt-0.5">
            هؤلاء قلت لهم سابقاً &quot;سأتواصل معك بعد فترة&quot; — حان الوقت
          </p>
        </div>
        <ArrowLeft className="h-4 w-4 text-success-600 shrink-0" />
      </div>
    </Link>
  );
}
