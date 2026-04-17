"use client";

import { useState, useTransition, useEffect } from "react";
import { MessageCircle, X, Check, Bell } from "lucide-react";
import { markMessagesAsRead } from "@/app/actions/provider";

type Message = {
  id: string;
  content: string;
  senderRole: string;
  senderId: string;
  messageType: string;
  createdAt: Date;
  isRead: boolean;
};

export default function InternalMessagesBar({ messages }: { messages: Message[] }) {
  const [isPending, startTransition] = useTransition();
  const [visibleMessages, setVisibleMessages] = useState(messages);
  const [dismissed, setDismissed] = useState<string[]>([]);

  if (visibleMessages.length === 0) return null;

  const activeMessages = visibleMessages.filter((m) => !dismissed.includes(m.id));
  if (activeMessages.length === 0) return null;

  const handleDismiss = (id: string) => {
    setDismissed((prev) => [...prev, id]);
    startTransition(async () => {
      await markMessagesAsRead([id]);
    });
  };

  const handleDismissAll = () => {
    const ids = activeMessages.map((m) => m.id);
    setDismissed((prev) => [...prev, ...ids]);
    startTransition(async () => {
      await markMessagesAsRead(ids);
    });
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString("ar-SA-u-ca-gregory", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-3 animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-amber-100 rounded-lg">
            <Bell className="h-4 w-4 text-amber-600" />
          </div>
          <span className="text-sm font-bold text-amber-800">
            رسائل من مقدمي الخدمة ({activeMessages.length})
          </span>
        </div>
        <button
          onClick={handleDismissAll}
          disabled={isPending}
          className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1"
        >
          <Check className="h-3 w-3" />
          قراءة الكل
        </button>
      </div>

      <div className="space-y-1.5">
        {activeMessages.map((msg) => (
          <div
            key={msg.id}
            className="flex items-center justify-between p-2.5 rounded-lg bg-white/80 border border-amber-100"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <MessageCircle className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="text-sm text-surface-800 truncate">
                {msg.content}
              </span>
              <span className="text-[10px] text-surface-400 shrink-0">
                {formatTime(msg.createdAt)}
              </span>
            </div>
            <button
              onClick={() => handleDismiss(msg.id)}
              disabled={isPending}
              className="p-1 rounded hover:bg-surface-100 text-surface-400 shrink-0 ms-2"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
