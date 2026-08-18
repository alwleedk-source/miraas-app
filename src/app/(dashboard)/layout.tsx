import { Sidebar } from "@/components/layout/sidebar";
import OverdueFollowUpsBar from "@/components/layout/overdue-bar";
import DueFollowUpsWatcher from "@/components/layout/due-watcher";
import { getOverdueFollowUpsCount } from "@/app/actions/followups";
import { requireTenant } from "@/lib/auth-server";

// تعرّف على أخطاء redirect من Next — لا تبتلعها عن طريق الخطأ
function isNextRedirect(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    typeof (e as { digest: unknown }).digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // حماية على مستوى layout — تضمن auth حتى لو page نسي
  // (middleware.ts يحمي أيضاً — هذه layer إضافية)
  await requireTenant();

  let overdueCount = 0;
  try {
    // العقد الجديد: { success: true, count } | { success: false } — عند الفشل
    // (PROVIDER غير مخوّل مثلاً) نُخفي الشريط بهدوء (count = 0)
    const res = await getOverdueFollowUpsCount();
    if (res.success) overdueCount = res.count;
  } catch (e) {
    // لا تبتلع redirect من requireTenant داخل dependencies
    if (isNextRedirect(e)) throw e;
  }

  return (
    <div className="flex min-h-screen bg-surface-50">
      {/* الشريط الجانبي — يمين في RTL */}
      <Sidebar />

      {/* المحتوى الرئيسي */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="p-6 lg:p-8">
          {/* شريط المتابعات المتأخرة */}
          <OverdueFollowUpsBar overdueCount={overdueCount} />
          {children}
        </div>
      </main>

      {/* إشعارات المتابعات حين يحين موعدها (داخل التطبيق) */}
      <DueFollowUpsWatcher />
    </div>
  );
}
