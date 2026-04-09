"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";

interface Activity {
  id: string;
  action: string;
  entityType: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
  userName: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  LEAD_CREATED: "أضاف عميل جديد",
  LEAD_UPDATED: "حدّث بيانات عميل",
  LEAD_STAGE_CHANGED: "نقل عميل لمرحلة جديدة",
  LEAD_DELETED: "حذف عميل",
  FOLLOW_UP_CREATED: "أضاف متابعة",
  FOLLOW_UP_COMPLETED: "أنجز مهمة",
  USER_CREATED: "أضاف عضو جديد",
  SETTINGS_UPDATED: "حدّث الإعدادات",
  WEBHOOK_RECEIVED: "عميل جديد من Google Sheets",
  WHATSAPP_SENT: "أرسل رسالة واتساب",
};

const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "الكل" },
  { value: "LEAD_CREATED", label: "إضافة" },
  { value: "LEAD_STAGE_CHANGED", label: "نقل مرحلة" },
  { value: "LEAD_DELETED", label: "حذف" },
  { value: "FOLLOW_UP_CREATED", label: "متابعات" },
  { value: "USER_CREATED", label: "أعضاء" },
  { value: "WEBHOOK_RECEIVED", label: "ويب هوك" },
];

function timeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

export default function ActivityLog({ activities }: { activities: Activity[] }) {
  const [filter, setFilter] = useState("");

  const filtered = filter
    ? activities.filter((a) => a.action === filter)
    : activities;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">آخر النشاطات</CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {ACTION_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={`text-[10px] px-2 py-1 rounded-full transition-colors ${
                    filter === f.value
                      ? "bg-primary-100 text-primary-700 font-medium"
                      : "bg-surface-100 text-surface-500 hover:bg-surface-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Badge variant="secondary">
              <Clock className="h-3 w-3 me-1" />
              مباشر
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length > 0 ? (
          <div className="space-y-4">
            {filtered.map((activity, index) => (
              <div
                key={activity.id}
                className="flex items-start gap-3 animate-slide-in-right"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="w-2 h-2 rounded-full mt-2 shrink-0 bg-primary-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-surface-800">
                    <span className="font-medium">
                      {activity.userName || "النظام"}
                    </span>{" "}
                    {ACTION_LABELS[activity.action] || activity.action}
                    {(() => {
                      const details = activity.details as Record<string, unknown> | null;
                      const leadName = details?.leadName;
                      if (!leadName) return null;
                      return (
                        <>
                          {" "}
                          <span className="font-medium text-primary-600">
                            {String(leadName)}
                          </span>
                        </>
                      );
                    })()}
                  </p>
                  <span className="text-xs text-surface-400">
                    {timeAgo(activity.createdAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-surface-400 text-sm">
            <Clock className="h-8 w-8 mx-auto mb-2 text-surface-300" />
            {filter ? "لا توجد نشاطات من هذا النوع" : "لا توجد نشاطات بعد — أضف أول عميل!"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
