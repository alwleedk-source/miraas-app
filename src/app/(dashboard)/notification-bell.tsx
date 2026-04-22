"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import { Bell, CheckCheck, X, UserPlus, UserCheck, Clock, Info } from "lucide-react";
import { getNotifications, getUnreadCount, markAsRead, markAllAsRead } from "@/app/actions/notifications";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/hooks";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  readAt: Date | null;
  createdAt: Date;
}

const TYPE_ICONS: Record<string, typeof Bell> = {
  NEW_LEAD: UserPlus,
  LEAD_ASSIGNED: UserCheck,
  FOLLOW_UP_REMINDER: Clock,
  SYSTEM: Info,
};

const TYPE_COLORS: Record<string, string> = {
  NEW_LEAD: "#3B82F6",
  LEAD_ASSIGNED: "#8B5CF6",
  FOLLOW_UP_REMINDER: "#F59E0B",
  SYSTEM: "#6B7280",
};

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isPending, startTransition] = useTransition();
  const now = useNow();
  const [loaded, setLoaded] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  // جلب عدد الإشعارات غير المقروءة
  useEffect(() => {
    getUnreadCount()
      .then((c) => setUnreadCount(c))
      .catch(() => {});

    const interval = setInterval(() => {
      getUnreadCount()
        .then((c) => setUnreadCount(c))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // جلب الإشعارات عند فتح القائمة
  useEffect(() => {
    if (isOpen && !loaded) {
      getNotifications()
        .then((data) => {
          setNotifications(data as Notification[]);
          setLoaded(true);
        })
        .catch(() => {});
    }
  }, [isOpen, loaded]);

  // حساب موقع القائمة
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 8,
        left: Math.max(8, rect.left - 240), // يظهر على اليسار من الزر
      });
    }
  }, [isOpen]);

  const handleMarkAsRead = (id: string) => {
    startTransition(async () => {
      await markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    });
  };

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date() })));
      setUnreadCount(0);
    });
  };

  function timeAgo(date: Date): string {
    if (now === 0) return "";
    const diff = now - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "الآن";
    if (mins < 60) return `منذ ${mins} د`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `منذ ${hours} س`;
    const days = Math.floor(hours / 24);
    return `منذ ${days} يوم`;
  }

  return (
    <div className="relative">
      {/* زر الجرس */}
      <button
        ref={buttonRef}
        onClick={() => { setIsOpen(!isOpen); if (isOpen) setLoaded(false); }}
        className="relative p-2 rounded-lg hover:bg-surface-100 transition-colors"
        title="الإشعارات"
      >
        <Bell className="h-5 w-5 text-surface-500" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -start-0.5 bg-danger-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold px-1 animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* القائمة المنسدلة — fixed لتظهر فوق كل شيء */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            onClick={() => setIsOpen(false)}
          />
          <div
            className="fixed w-80 bg-white rounded-xl shadow-xl border border-surface-200 z-[70] overflow-hidden animate-fade-in"
            style={{ top: dropdownPos.top, left: dropdownPos.left }}
          >
            {/* الهيدر */}
            <div className="flex items-center justify-between p-3 border-b border-surface-100">
              <h3 className="font-semibold text-surface-900 text-sm">الإشعارات</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    disabled={isPending}
                    className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    قراءة الكل
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 hover:bg-surface-100 rounded"
                >
                  <X className="h-4 w-4 text-surface-400" />
                </button>
              </div>
            </div>

            {/* قائمة الإشعارات */}
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="h-8 w-8 text-surface-300 mx-auto mb-2" />
                  <p className="text-sm text-surface-500">لا توجد إشعارات</p>
                </div>
              ) : (
                notifications.map((n) => {
                  const Icon = TYPE_ICONS[n.type] || Bell;
                  const color = TYPE_COLORS[n.type] || "#6B7280";
                  return (
                    <div
                      key={n.id}
                      className={cn(
                        "flex gap-3 p-3 border-b border-surface-50 hover:bg-surface-50 transition-colors cursor-pointer",
                        !n.readAt && "bg-primary-50/30"
                      )}
                      onClick={() => !n.readAt && handleMarkAsRead(n.id)}
                    >
                      <div
                        className="mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${color}15` }}
                      >
                        <Icon className="h-4 w-4" style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-sm text-surface-800 leading-relaxed",
                          !n.readAt && "font-semibold"
                        )}>
                          {n.title}
                        </p>
                        {n.message && (
                          <p className="text-xs text-surface-500 mt-0.5 truncate">
                            {n.message}
                          </p>
                        )}
                        <p className="text-[10px] text-surface-400 mt-1">
                          {timeAgo(n.createdAt)}
                        </p>
                      </div>
                      {!n.readAt && (
                        <div className="w-2 h-2 rounded-full bg-primary-500 mt-2 shrink-0" />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

