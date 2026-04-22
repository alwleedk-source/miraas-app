"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, X, ArrowLeft } from "lucide-react";

interface Props {
  overdueCount: number;
}

export default function OverdueFollowUpsBar({ overdueCount }: Props) {
  const [dismissed, setDismissed] = useState(false);

  if (overdueCount === 0 || dismissed) return null;

  return (
    <div className="bg-gradient-to-l from-warning-600 to-warning-500 text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 animate-fade-in mb-4">
      <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
        <Bell className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          لديك{" "}
          <span className="font-bold text-lg mx-1">{overdueCount}</span>
          {overdueCount === 1 ? "متابعة متأخرة" : overdueCount <= 10 ? "متابعات متأخرة" : "متابعة متأخرة"}
          {" "}تحتاج اهتمامك
        </p>
      </div>
      <Link
        href="/"
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-medium transition-colors shrink-0"
      >
        عرض المهام
        <ArrowLeft className="h-3 w-3" />
      </Link>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 hover:bg-white/20 rounded-lg transition-colors shrink-0"
        title="إخفاء"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
