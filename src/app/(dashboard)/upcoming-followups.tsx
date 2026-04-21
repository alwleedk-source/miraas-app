"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Phone, MessageCircle, ExternalLink } from "lucide-react";
import { toWhatsappUrl } from "@/lib/utils";

interface UpcomingTask {
  id: string;
  type: string;
  notes: string | null;
  scheduledAt: Date;
  leadName: string;
  leadPhone: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  CALL: "مكالمة",
  WHATSAPP: "واتساب",
  EMAIL: "بريد",
  MESSAGE: "رسالة",
  MEETING: "اجتماع",
  NOTE: "ملاحظة",
};

export default function UpcomingFollowUps({ tasks }: { tasks: UpcomingTask[] }) {
  if (tasks.length === 0) return null;

  // تجميع حسب اليوم
  const grouped = tasks.reduce<Record<string, UpcomingTask[]>>((acc, task) => {
    const dateKey = new Date(task.scheduledAt).toLocaleDateString("ar-SA", {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(task);
    return acc;
  }, {});

  return (
    <Card className="border-primary-200 bg-primary-50/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary-600" />
            المتابعات القادمة
            <Badge variant="default" className="bg-primary-600 text-white">
              {tasks.length}
            </Badge>
          </CardTitle>
          <span className="text-xs text-surface-400">الأسبوع القادم</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(grouped).map(([dateLabel, dayTasks]) => (
          <div key={dateLabel}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-primary-700 bg-primary-100 rounded-full px-2.5 py-0.5">
                {dateLabel}
              </span>
              <span className="text-[10px] text-surface-400">({dayTasks.length})</span>
            </div>
            <div className="space-y-1.5 ps-3 border-s-2 border-primary-200">
              {dayTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-3 p-2 rounded-lg bg-white border border-surface-100 hover:border-primary-200 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <a
                        href={`/leads?search=${encodeURIComponent(task.leadName)}`}
                        className="text-sm font-medium text-surface-800 hover:text-primary-600 truncate"
                      >
                        {task.leadName}
                        <ExternalLink className="h-2.5 w-2.5 inline ms-0.5 text-surface-300" />
                      </a>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {TYPE_LABELS[task.type] || task.type}
                      </Badge>
                      <span className="text-[10px] text-surface-400 ms-auto shrink-0">
                        {new Date(task.scheduledAt).toLocaleTimeString("ar-SA", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {task.notes && (
                      <p className="text-[11px] text-surface-400 truncate mt-0.5">💬 {task.notes}</p>
                    )}
                  </div>
                  {task.leadPhone && (
                    <div className="flex items-center gap-1 shrink-0">
                      <a
                        href={`tel:${task.leadPhone}`}
                        className="p-1 rounded hover:bg-primary-50 text-surface-400 hover:text-primary-600 transition-colors"
                        title="اتصال"
                      >
                        <Phone className="h-3.5 w-3.5" />
                      </a>
                      <a
                        href={toWhatsappUrl(task.leadPhone) ?? "#"}
                        target="_blank"
                        rel="noopener"
                        className="p-1 rounded hover:bg-success-50 text-surface-400 hover:text-success-600 transition-colors"
                        title="واتساب"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
