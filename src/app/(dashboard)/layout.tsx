import { Sidebar } from "@/components/layout/sidebar";
import OverdueFollowUpsBar from "@/components/layout/overdue-bar";
import DueFollowUpsWatcher from "@/components/layout/due-watcher";
import { getOverdueFollowUpsCount } from "@/app/actions/followups";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let overdueCount = 0;
  try {
    overdueCount = await getOverdueFollowUpsCount();
  } catch {}

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
