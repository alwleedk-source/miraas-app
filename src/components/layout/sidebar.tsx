"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  UserCog,
  BarChart3,
  Settings,
  MessageSquare,
  Webhook,
  GitBranch,
  CalendarDays,
  LogOut,
  Menu,
  X,
  Stethoscope,
  AlertTriangle,
  Archive,
  Database,
} from "lucide-react";
import { signOut, useSession } from "@/lib/auth-client";
import NotificationBell from "@/app/(dashboard)/notification-bell";

type AllowedRoles = "OWNER" | "ADMIN" | "COORDINATOR";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
  // الأدوار التي ترى هذا العنصر — undefined = الجميع (non-PROVIDER)
  roles?: AllowedRoles[];
}

// القائمة الرئيسية — كل عنصر يعرّف من يراه
const mainNav: NavItem[] = [
  { label: "نظرة عامة", href: "/", icon: <LayoutDashboard className="h-5 w-5" /> },
  { label: "العملاء", href: "/leads", icon: <Users className="h-5 w-5" /> },
  { label: "الحجوزات", href: "/bookings", icon: <CalendarDays className="h-5 w-5" /> },
  { label: "الأنابيب", href: "/pipeline", icon: <GitBranch className="h-5 w-5" />, roles: ["OWNER", "ADMIN"] },
  { label: "الفريق", href: "/team", icon: <UserCog className="h-5 w-5" />, roles: ["OWNER", "ADMIN"] },
  { label: "التحليلات", href: "/analytics", icon: <BarChart3 className="h-5 w-5" />, roles: ["OWNER", "ADMIN"] },
  { label: "قمع التحويل", href: "/analytics/funnel", icon: <BarChart3 className="h-5 w-5" />, roles: ["OWNER", "ADMIN"] },
];

// كل عناصر الإعدادات محصورة في OWNER/ADMIN
const settingsNav: NavItem[] = [
  { label: "الإعدادات", href: "/settings", icon: <Settings className="h-5 w-5" />, roles: ["OWNER", "ADMIN"] },
  { label: "واتساب", href: "/settings/whatsapp", icon: <MessageSquare className="h-5 w-5" />, roles: ["OWNER", "ADMIN"] },
  { label: "الويب هوك", href: "/settings/webhooks", icon: <Webhook className="h-5 w-5" />, roles: ["OWNER", "ADMIN"] },
  { label: "أرشيف العملاء", href: "/leads/archive", icon: <Archive className="h-5 w-5" /> },
  { label: "نسخة احتياطية", href: "/settings/backup", icon: <Database className="h-5 w-5" />, roles: ["OWNER", "ADMIN"] },
  { label: "سجل الأخطاء", href: "/settings/errors", icon: <AlertTriangle className="h-5 w-5" />, roles: ["OWNER", "ADMIN"] },
];

// القائمة المخصصة لمقدم الخدمة
const providerNav: NavItem[] = [
  { label: "مواعيدي", href: "/provider", icon: <Stethoscope className="h-5 w-5" /> },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: session } = useSession();

  const userRole = (session?.user as Record<string, unknown>)?.role as string || "";
  const isProvider = userRole === "PROVIDER";

  // فلترة عناصر القائمة حسب الدور
  const visibleFor = (items: NavItem[]) =>
    items.filter((item) => !item.roles || item.roles.includes(userRole as AllowedRoles));
  const visibleMain = visibleFor(mainNav);
  const visibleSettings = visibleFor(settingsNav);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const NavLink = ({ item }: { item: NavItem }) => (
    <Link
      href={item.href}
      onClick={() => setMobileOpen(false)}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
        isActive(item.href)
          ? "bg-primary-50 text-primary-700 shadow-sm"
          : "text-surface-600 hover:bg-surface-100 hover:text-surface-900"
      )}
    >
      <span
        className={cn(
          "shrink-0 transition-colors",
          isActive(item.href) ? "text-primary-600" : "text-surface-400"
        )}
      >
        {item.icon}
      </span>
      <span className="truncate">{item.label}</span>
      {item.badge && (
        <span className="ms-auto bg-primary-600 text-white text-xs rounded-full px-2 py-0.5">
          {item.badge}
        </span>
      )}
    </Link>
  );

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* الشعار */}
      <div className="p-5 pb-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-md shrink-0">
          <span className="text-xl font-bold text-white">م</span>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-surface-900 truncate">مِراس</h1>
          <p className="text-xs text-surface-400">
            {isProvider ? "بوابة مقدم الخدمة" : "إدارة العملاء"}
          </p>
        </div>
        {!isProvider && <NotificationBell />}
      </div>

      {/* التنقل */}
      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {isProvider ? (
          <>
            <p className="text-xs font-semibold text-surface-400 px-3 mb-2">
              بوابتي
            </p>
            {providerNav.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </>
        ) : (
          <>
            <p className="text-xs font-semibold text-surface-400 px-3 mb-2">
              الرئيسية
            </p>
            {visibleMain.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}

            {visibleSettings.length > 0 && (
              <>
                <div className="my-4 border-t border-surface-100" />
                <p className="text-xs font-semibold text-surface-400 px-3 mb-2">
                  الأدوات
                </p>
                {visibleSettings.map((item) => (
                  <NavLink key={item.href} item={item} />
                ))}
              </>
            )}
          </>
        )}
      </nav>

      {/* تسجيل الخروج */}
      <div className="p-4 border-t border-surface-100">
        <button
          onClick={() => {
            signOut();
            window.location.href = "/login";
          }}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-surface-600 hover:bg-danger-50 hover:text-danger-600 transition-all w-full"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          <span>تسجيل الخروج</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* زر الموبايل */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 right-4 z-50 p-2 rounded-lg bg-white shadow-md border border-surface-200 hover:bg-surface-50 transition-colors"
        aria-label="فتح القائمة"
      >
        <Menu className="h-5 w-5 text-surface-700" />
      </button>

      {/* Overlay للموبايل */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar للموبايل */}
      <aside
        className={cn(
          "lg:hidden fixed top-0 right-0 z-50 h-full w-72 bg-white shadow-2xl transition-transform duration-300",
          mobileOpen ? "translate-x-0" : "translate-x-full"
        )}
        style={{ borderLeft: "1px solid var(--color-surface-200)" }}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 left-4 p-1 rounded-lg hover:bg-surface-100"
          aria-label="إغلاق القائمة"
        >
          <X className="h-5 w-5 text-surface-500" />
        </button>
        {sidebarContent}
      </aside>

      {/* Sidebar للكمبيوتر — عنصر عادي في Grid */}
      <aside className="hidden lg:block w-64 bg-white border-e border-surface-200 h-screen sticky top-0 overflow-y-auto overflow-x-hidden">
        {sidebarContent}
      </aside>
    </>
  );
}
