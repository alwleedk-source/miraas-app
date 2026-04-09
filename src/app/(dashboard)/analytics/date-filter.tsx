"use client";

import { useRouter, useSearchParams } from "next/navigation";

const PRESETS: { value: string; label: string }[] = [
  { value: "", label: "كل الأوقات" },
  { value: "today", label: "اليوم" },
  { value: "7", label: "آخر 7 أيام" },
  { value: "30", label: "آخر 30 يوم" },
  { value: "90", label: "آخر 3 أشهر" },
];

export default function AnalyticsDateFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentRange = searchParams.get("range") || "";

  const handleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("range", value);
    } else {
      params.delete("range");
    }
    router.push(`/analytics?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PRESETS.map((p) => (
        <button
          key={p.value}
          onClick={() => handleChange(p.value)}
          className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
            currentRange === p.value
              ? "bg-primary-100 text-primary-700 font-medium"
              : "bg-surface-100 text-surface-500 hover:bg-surface-200"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
