"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CalendarClock,
  Check,
  Clock,
  Phone,
  MessageSquare,
  MessageCircle,
  Mail,
  User,
  Pencil,
  Loader2,
  ChevronDown,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { completeFollowUp, snoozeFollowUp } from "@/app/actions/followups";
import { cn } from "@/lib/utils";

interface Task {
  id: string;
  type: string;
  notes: string | null;
  scheduledAt: Date;
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  leadSource: string | null;
}

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Phone; color: string }> = {
  CALL: { label: "مكالمة", icon: Phone, color: "#3B82F6" },
  WHATSAPP: { label: "واتساب", icon: MessageSquare, color: "#22C55E" },
  EMAIL: { label: "بريد", icon: Mail, color: "#8B5CF6" },
  MESSAGE: { label: "رسالة", icon: MessageSquare, color: "#06B6D4" },
  MEETING: { label: "اجتماع", icon: User, color: "#F97316" },
  NOTE: { label: "ملاحظة", icon: Pencil, color: "#6B7280" },
};

export default function TodayTasks({ tasks: initialTasks }: { tasks: Task[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [isPending, startTransition] = useTransition();
  const [activeSnooze, setActiveSnooze] = useState<string | null>(null);
  const router = useRouter();

  const handleComplete = (taskId: string) => {
    startTransition(async () => {
      await completeFollowUp(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      router.refresh();
    });
  };

  const handleSnooze = (taskId: string, days: number) => {
    startTransition(async () => {
      await snoozeFollowUp(taskId, days);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setActiveSnooze(null);
      router.refresh();
    });
  };

  if (tasks.length === 0) return null;

  const now = new Date();
  const todayStr = now.toDateString();

  // تقسيم المهام: متأخرة (من أمس وما قبل) vs اليوم
  const overdueTasks = tasks.filter((t) => {
    const d = new Date(t.scheduledAt);
    return d.toDateString() !== todayStr && d < now;
  });
  const todayTasks = tasks.filter((t) => {
    const d = new Date(t.scheduledAt);
    return d.toDateString() === todayStr || d >= now;
  });

  const renderTask = (task: Task, isOverdue: boolean) => {
    const config = TYPE_CONFIG[task.type] || TYPE_CONFIG.NOTE;
    const IconComp = config.icon;
    const scheduledDate = new Date(task.scheduledAt);
    const timeStr = scheduledDate.getHours() !== 0
      ? scheduledDate.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })
      : null;
    const dateStr = isOverdue
      ? scheduledDate.toLocaleDateString("ar-SA", { day: "numeric", month: "short" })
      : null;

    return (
      <div
        key={task.id}
        className={cn(
          "flex items-start gap-3 p-3 rounded-lg bg-white border transition-all",
          isOverdue ? "border-danger-200 bg-danger-50/20" : "border-surface-200"
        )}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
          style={{ backgroundColor: isOverdue ? "#FEE2E2" : `${config.color}15` }}
        >
          <IconComp className="h-4 w-4" style={{ color: isOverdue ? "#DC2626" : config.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            {isOverdue && (
              <Badge variant="danger" className="text-[10px] px-1.5 py-0">
                متأخر {dateStr && `(${dateStr})`}
              </Badge>
            )}
            {timeStr && (
              <span className="text-xs font-medium text-surface-500">
                <Clock className="h-3 w-3 inline me-0.5" />
                {timeStr}
              </span>
            )}
            <Badge variant="outline" className="text-[10px]">{config.label}</Badge>
            {task.leadSource && (
              <span className="text-[10px] text-primary-600 bg-primary-50 rounded px-1.5 py-0.5">
                📢 {task.leadSource}
              </span>
            )}
          </div>

          <a
            href={`/leads?search=${encodeURIComponent(task.leadName)}`}
            className="text-sm font-medium text-surface-900 hover:text-primary-600 hover:underline truncate block"
          >
            {task.leadName}
            <ExternalLink className="h-3 w-3 inline ms-1 text-surface-300" />
          </a>

          {task.notes && (
            <p className="text-xs text-surface-500 truncate mt-0.5">💬 {task.notes}</p>
          )}

          {task.leadPhone && (
            <div className="flex items-center gap-2 mt-1.5">
              <a
                href={`tel:${task.leadPhone}`}
                className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 bg-primary-50 hover:bg-primary-100 px-2 py-1 rounded-lg transition-colors"
              >
                <Phone className="h-3 w-3" />
                اتصال
              </a>
              <a
                href={`https://wa.me/${task.leadPhone.replace("+", "")}`}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-1 text-xs text-success-600 hover:text-success-800 bg-success-50 hover:bg-success-100 px-2 py-1 rounded-lg transition-colors"
              >
                <MessageCircle className="h-3 w-3" />
                واتساب
              </a>
              <span className="text-[10px] text-surface-300" dir="ltr">{task.leadPhone}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-success-600 hover:bg-success-50"
            onClick={() => handleComplete(task.id)}
            disabled={isPending}
            title="تم ✅"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </Button>

          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs text-surface-500 hover:bg-surface-100"
              onClick={() => setActiveSnooze(activeSnooze === task.id ? null : task.id)}
              disabled={isPending}
              title="تأجيل"
            >
              <Clock className="h-3.5 w-3.5 me-0.5" />
              تأجيل
              <ChevronDown className="h-3 w-3 ms-0.5" />
            </Button>

            {activeSnooze === task.id && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setActiveSnooze(null)} />
                <div className="absolute start-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-surface-200 z-50 py-1 w-32 animate-fade-in">
                  {[
                    { label: "+١ يوم", days: 1 },
                    { label: "+٣ أيام", days: 3 },
                    { label: "+أسبوع", days: 7 },
                  ].map((opt) => (
                    <button
                      key={opt.days}
                      onClick={() => handleSnooze(task.id, opt.days)}
                      className="w-full text-start px-3 py-1.5 text-xs hover:bg-surface-50 text-surface-700 transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* المتابعات المتأخرة */}
      {overdueTasks.length > 0 && (
        <Card className="border-danger-200 bg-danger-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-danger-600" />
                <span className="text-danger-700">متابعات متأخرة</span>
                <Badge variant="default" className="bg-danger-600 text-white">
                  {overdueTasks.length}
                </Badge>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {overdueTasks.map((task) => renderTask(task, true))}
          </CardContent>
        </Card>
      )}

      {/* مهام اليوم */}
      {todayTasks.length > 0 && (
        <Card className="border-warning-200 bg-warning-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-warning-600" />
                مهام اليوم
                <Badge variant="default" className="bg-warning-600 text-white">
                  {todayTasks.length}
                </Badge>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {todayTasks.map((task) => renderTask(task, false))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
