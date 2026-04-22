import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { getArchivedLeads, getArchiveStats } from "@/app/actions/archive";
import { Card, CardContent } from "@/components/ui/card";
import { Archive, ArrowRight, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { ARCHIVE_REASONS } from "@/lib/archive-reasons";
import ArchiveClient from "./archive-client";

type SearchParams = Promise<{
  reason?: string;
  q?: string;
  due?: string;
  page?: string;
}>;

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { tenantId, role } = await requireTenant();
  if (!tenantId) redirect("/register");
  if (role === "PROVIDER") redirect("/provider");

  const params = await searchParams;
  const reason = params.reason || undefined;
  const q = params.q || undefined;
  const due = params.due === "1";
  const page = Math.max(1, parseInt(params.page || "1", 10));

  let stats: Awaited<ReturnType<typeof getArchiveStats>>;
  let result: Awaited<ReturnType<typeof getArchivedLeads>>;

  try {
    [stats, result] = await Promise.all([
      getArchiveStats(),
      getArchivedLeads({ reason, search: q, dueForReactivation: due, page, limit: 50 }),
    ]);
  } catch {
    stats = { byReason: [], dueForReactivation: 0, total: 0 };
    result = { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };
  }

  return (
    <div className="space-y-6 max-w-6xl animate-fade-in">
      {/* Header */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 mb-2"
        >
          <ArrowRight className="h-3.5 w-3.5" />
          العودة للوحة التحكم
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-2">
              <Archive className="h-6 w-6 text-surface-500" />
              أرشيف العملاء
            </h1>
            <p className="text-surface-500 mt-1 text-sm">
              {stats.total.toLocaleString("ar-SA")} عميل مؤرشف — لم يُحذف، يمكن إعادتهم متى شئت
            </p>
          </div>
          {stats.dueForReactivation > 0 && (
            <Link
              href="/leads/archive?due=1"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-warning-50 hover:bg-warning-100 text-warning-700 border border-warning-200 text-sm font-medium"
            >
              <RefreshCw className="h-4 w-4" />
              {stats.dueForReactivation} عميل جاء وقت إعادتهم
            </Link>
          )}
        </div>
      </div>

      {/* Stats by reason */}
      {stats.byReason.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-surface-500 mb-3">
              📊 توزيع الأسباب — انقر للفلترة
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/leads/archive"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  !reason && !due
                    ? "bg-primary-100 text-primary-700 font-semibold"
                    : "bg-surface-100 hover:bg-surface-200 text-surface-700"
                }`}
              >
                الكل ({stats.total})
              </Link>
              {stats.byReason.map((b) => {
                const r = ARCHIVE_REASONS[b.reason as keyof typeof ARCHIVE_REASONS];
                if (!r) return null;
                const isActive = reason === b.reason;
                return (
                  <Link
                    key={b.reason}
                    href={`/leads/archive?reason=${b.reason}`}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      isActive
                        ? "bg-primary-100 text-primary-700 font-semibold"
                        : "bg-surface-100 hover:bg-surface-200 text-surface-700"
                    }`}
                  >
                    <span>{r.icon}</span>
                    <span>{r.label}</span>
                    <span className="text-xs opacity-70">({b.count})</span>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {result.data.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Archive className="h-12 w-12 mx-auto mb-3 text-surface-300" />
            <p className="text-surface-700 font-medium">
              {q || reason || due ? "لا نتائج بهذه الفلاتر" : "لا عملاء مؤرشفين بعد"}
            </p>
            <p className="text-sm text-surface-500 mt-1">
              {q || reason || due ? (
                <Link href="/leads/archive" className="text-primary-600 hover:underline">
                  مسح الفلاتر
                </Link>
              ) : (
                "أرشف من قائمة العملاء عندما يصبح العميل غير مهتم"
              )}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ArchiveClient
          initialData={result.data}
          total={result.total}
          page={result.page}
          totalPages={result.totalPages}
          currentReason={reason}
          currentSearch={q}
          dueOnly={due}
        />
      )}
    </div>
  );
}
