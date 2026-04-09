import { Sidebar } from "@/components/layout/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-surface-50">
      {/* الشريط الجانبي — يمين في RTL */}
      <Sidebar />

      {/* المحتوى الرئيسي */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
