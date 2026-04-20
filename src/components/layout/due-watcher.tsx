"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bell, Phone, MessageCircle, Check, Clock, X } from "lucide-react";
import {
  getJustDueFollowUps,
  completeFollowUp,
  snoozeFollowUpMinutes,
} from "@/app/actions/followups";
import { cn } from "@/lib/utils";

interface DueItem {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  type: string;
  notes: string | null;
  scheduledAt: Date;
}

const POLL_INTERVAL_MS = 30_000;
const TITLE_BLINK_INTERVAL_MS = 1200;

function playChime() {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new Ctx();
    const play = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + start + 0.02);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    play(880, 0, 0.18);
    play(1175, 0.18, 0.24);
  } catch {
    // ignored — audio blocked before user interaction
  }
}

export default function DueFollowUpsWatcher() {
  const [toasts, setToasts] = useState<DueItem[]>([]);
  const [isPending, startTransition] = useTransition();
  const sinceRef = useRef<string>(new Date().toISOString());
  const seenIdsRef = useRef<Set<string>>(new Set());
  const originalTitleRef = useRef<string>("");
  const blinkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    originalTitleRef.current = document.title;
    return () => {
      if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
      document.title = originalTitleRef.current;
    };
  }, []);

  useEffect(() => {
    if (toasts.length === 0) {
      if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
      blinkTimerRef.current = null;
      document.title = originalTitleRef.current;
      return;
    }
    const alert = `🔔 (${toasts.length}) حان وقت المتابعة`;
    let showAlert = true;
    document.title = alert;
    blinkTimerRef.current = setInterval(() => {
      document.title = showAlert ? originalTitleRef.current : alert;
      showAlert = !showAlert;
    }, TITLE_BLINK_INTERVAL_MS);
    return () => {
      if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
      blinkTimerRef.current = null;
    };
  }, [toasts.length]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const rows = await getJustDueFollowUps(sinceRef.current);
        if (cancelled) return;
        sinceRef.current = new Date().toISOString();
        const fresh = rows.filter(
          (r) => r.scheduledAt && !seenIdsRef.current.has(r.id)
        );
        if (fresh.length === 0) return;
        fresh.forEach((r) => seenIdsRef.current.add(r.id));
        setToasts((prev) => [
          ...prev,
          ...fresh.map((r) => ({ ...r, scheduledAt: new Date(r.scheduledAt!) })),
        ]);
        playChime();
      } catch {
        // network blip — try again on next tick
      }
    };

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleDone = (item: DueItem) => {
    startTransition(async () => {
      try {
        await completeFollowUp(item.id);
        dismiss(item.id);
      } catch {
        // keep toast visible on failure
      }
    });
  };

  const handleSnooze = (item: DueItem, minutes: number) => {
    startTransition(async () => {
      try {
        await snoozeFollowUpMinutes(item.id, minutes);
        seenIdsRef.current.delete(item.id);
        dismiss(item.id);
      } catch {
        // keep toast visible on failure
      }
    });
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 start-4 z-[80] flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)]">
      {toasts.map((t) => {
        const timeStr = t.scheduledAt.toLocaleTimeString("ar-SA", {
          hour: "2-digit",
          minute: "2-digit",
        });
        return (
          <div
            key={t.id}
            className={cn(
              "bg-white rounded-xl shadow-2xl border-s-4 border-warning-500 overflow-hidden animate-fade-in",
              "ring-2 ring-warning-200"
            )}
          >
            <div className="p-3">
              <div className="flex items-start gap-2 mb-2">
                <div className="w-9 h-9 rounded-full bg-warning-100 flex items-center justify-center shrink-0 animate-pulse">
                  <Bell className="h-4 w-4 text-warning-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-surface-900 truncate">
                    حان وقت الاتصال بـ {t.leadName}
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-surface-500 mt-0.5">
                    <Clock className="h-3 w-3" />
                    <span>{timeStr}</span>
                    {t.leadPhone && (
                      <>
                        <span className="text-surface-300">•</span>
                        <span dir="ltr" className="font-mono">{t.leadPhone}</span>
                      </>
                    )}
                  </div>
                  {t.notes && (
                    <p className="text-[11px] text-surface-600 mt-1 line-clamp-2">
                      💬 {t.notes}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="p-1 rounded hover:bg-surface-100 text-surface-400 shrink-0"
                  title="إخفاء"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {t.leadPhone && (
                  <>
                    <a
                      href={`tel:${t.leadPhone}`}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md bg-success-500 hover:bg-success-600 text-white font-medium transition-colors"
                    >
                      <Phone className="h-3 w-3" /> اتصال
                    </a>
                    <a
                      href={`https://wa.me/${t.leadPhone.replace(/^\+/, "")}`}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md bg-[#25D366] hover:bg-[#1da851] text-white font-medium transition-colors"
                    >
                      <MessageCircle className="h-3 w-3" /> واتساب
                    </a>
                  </>
                )}
                <button
                  onClick={() => handleDone(t)}
                  disabled={isPending}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white font-medium transition-colors"
                >
                  <Check className="h-3 w-3" /> تم
                </button>
                <div className="flex items-center gap-0.5 ms-auto">
                  <button
                    onClick={() => handleSnooze(t, 15)}
                    disabled={isPending}
                    className="px-2 py-1 text-[11px] rounded-md bg-surface-100 hover:bg-surface-200 disabled:opacity-50 text-surface-700 font-medium transition-colors"
                    title="أجّل ١٥ دقيقة"
                  >
                    +١٥د
                  </button>
                  <button
                    onClick={() => handleSnooze(t, 60)}
                    disabled={isPending}
                    className="px-2 py-1 text-[11px] rounded-md bg-surface-100 hover:bg-surface-200 disabled:opacity-50 text-surface-700 font-medium transition-colors"
                    title="أجّل ساعة"
                  >
                    +ساعة
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
