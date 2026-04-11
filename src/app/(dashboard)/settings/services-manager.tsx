"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Loader2, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { addService, toggleService, deleteService } from "@/app/actions/services";

type Service = {
  id: string;
  name: string;
  isActive: boolean;
};

export default function ServicesManager({ initialServices }: { initialServices: Service[] }) {
  const [servicesList, setServicesList] = useState(initialServices);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        await addService(trimmed);
        setServicesList((prev) => [...prev, { id: crypto.randomUUID(), name: trimmed, isActive: true }]);
        setNewName("");
      } catch {}
    });
  };

  const handleToggle = (id: string) => {
    startTransition(async () => {
      try {
        await toggleService(id);
        setServicesList((prev) =>
          prev.map((s) => (s.id === id ? { ...s, isActive: !s.isActive } : s))
        );
      } catch {}
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      try {
        await deleteService(id);
        setServicesList((prev) => prev.filter((s) => s.id !== id));
      } catch {}
    });
  };

  return (
    <div className="space-y-3">
      {/* إضافة خدمة */}
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="اسم الخدمة الجديدة..."
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          disabled={isPending}
        />
        <Button onClick={handleAdd} disabled={!newName.trim() || isPending} size="sm" className="shrink-0">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4" /> إضافة</>}
        </Button>
      </div>

      {/* قائمة الخدمات */}
      {servicesList.length === 0 ? (
        <p className="text-sm text-surface-400 text-center py-4">لا توجد خدمات — أضف خدماتك لتظهر في نموذج الحجز</p>
      ) : (
        <div className="space-y-1.5">
          {servicesList.map((service) => (
            <div
              key={service.id}
              className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                service.isActive
                  ? "border-surface-200 bg-white"
                  : "border-surface-100 bg-surface-50 opacity-60"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${service.isActive ? "bg-success-500" : "bg-surface-300"}`} />
                <span className={`text-sm ${service.isActive ? "text-surface-900" : "text-surface-400 line-through"}`}>
                  {service.name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleToggle(service.id)}
                  disabled={isPending}
                  className="p-1.5 rounded-lg hover:bg-surface-100 text-surface-400 hover:text-surface-700 transition-colors"
                  title={service.isActive ? "تعطيل" : "تفعيل"}
                >
                  {service.isActive ? (
                    <ToggleRight className="h-4 w-4 text-success-500" />
                  ) : (
                    <ToggleLeft className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={() => handleDelete(service.id)}
                  disabled={isPending}
                  className="p-1.5 rounded-lg hover:bg-danger-50 text-surface-400 hover:text-danger-500 transition-colors"
                  title="حذف"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
