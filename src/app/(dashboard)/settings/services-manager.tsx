"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Loader2, Trash2, ToggleLeft, ToggleRight, Clock, Settings2, X } from "lucide-react";
import { addService, toggleService, deleteService, updateServiceDetails } from "@/app/actions/services";

type Service = {
  id: string;
  name: string;
  isActive: boolean;
  departmentId?: string | null;
  defaultDurationMin?: number | null;
};

type Department = {
  id: string;
  name: string;
  color: string;
};

const DURATION_OPTIONS = [15, 20, 30, 45, 60, 90, 120];

export default function ServicesManager({
  initialServices,
  departments = [],
}: {
  initialServices: Service[];
  departments?: Department[];
}) {
  const [servicesList, setServicesList] = useState(initialServices);
  const [newName, setNewName] = useState("");
  const [newDeptId, setNewDeptId] = useState("");
  const [newDuration, setNewDuration] = useState(30);
  const [isPending, startTransition] = useTransition();
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        // نستخدم الـ id الحقيقي العائد من الخادم (كان id عشوائياً فتفشل أزرار
        // التعديل/الحذف على الصف الجديد وتُبتلَع أخطاؤها).
        const created = await addService(trimmed, newDeptId || undefined, newDuration);
        if (!created.success) {
          // لا نبتلع الخطأ — نُظهره (مثلاً "هذه الخدمة موجودة بالفعل")
          alert(created.error);
          return;
        }
        setServicesList((prev) => [
          ...prev,
          {
            id: created.id,
            name: created.name,
            isActive: created.isActive,
            departmentId: created.departmentId,
            defaultDurationMin: created.defaultDurationMin,
          },
        ]);
        setNewName("");
        setNewDeptId("");
        setNewDuration(30);
        setShowAddForm(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : "تعذّر إضافة الخدمة");
      }
    });
  };

  const handleToggle = (id: string) => {
    startTransition(async () => {
      try {
        const result = await toggleService(id);
        if (!result.success) {
          alert(result.error);
          return;
        }
        setServicesList((prev) =>
          prev.map((s) => (s.id === id ? { ...s, isActive: !s.isActive } : s))
        );
      } catch {
        alert("تعذّر تغيير حالة الخدمة — حاول مرة أخرى");
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("حذف هذه الخدمة؟")) return;
    startTransition(async () => {
      try {
        await deleteService(id);
        setServicesList((prev) => prev.filter((s) => s.id !== id));
      } catch (err) {
        alert(err instanceof Error ? err.message : "تعذّر حذف الخدمة");
      }
    });
  };

  const handleUpdateDetails = (serviceId: string, data: { departmentId?: string | null; defaultDurationMin?: number }) => {
    startTransition(async () => {
      try {
        const result = await updateServiceDetails(serviceId, data);
        if (!result.success) {
          alert(result.error);
          return;
        }
        setServicesList((prev) =>
          prev.map((s) => (s.id === serviceId ? { ...s, ...data } : s))
        );
        if (editingService?.id === serviceId) {
          setEditingService((prev) => prev ? { ...prev, ...data } : prev);
        }
      } catch {
        alert("تعذّر حفظ تفاصيل الخدمة — حاول مرة أخرى");
      }
    });
  };

  const getDeptName = (deptId: string | null | undefined) => {
    if (!deptId) return null;
    return departments.find((d) => d.id === deptId);
  };

  return (
    <div className="space-y-3">
      {/* قائمة الخدمات */}
      {servicesList.length === 0 && !showAddForm ? (
        <p className="text-sm text-surface-400 text-center py-4">لا توجد خدمات — أضف خدماتك لتظهر في نموذج الحجز</p>
      ) : (
        <div className="space-y-1.5">
          {servicesList.map((service) => {
            const dept = getDeptName(service.departmentId);
            return (
              <div
                key={service.id}
                className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                  service.isActive
                    ? "border-surface-200 bg-white"
                    : "border-surface-100 bg-surface-50 opacity-60"
                }`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${service.isActive ? "bg-success-500" : "bg-surface-300"}`} />
                  <div className="min-w-0">
                    <span className={`text-sm ${service.isActive ? "text-surface-900" : "text-surface-400 line-through"}`}>
                      {service.name}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      {dept && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: dept.color + "20", color: dept.color }}>
                          {dept.name}
                        </span>
                      )}
                      <span className="text-[10px] text-surface-400 flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {service.defaultDurationMin || 30} د
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingService(service)}
                    disabled={isPending}
                    className="p-1.5 rounded-lg hover:bg-surface-100 text-surface-400 hover:text-primary-600 transition-colors"
                    title="إعدادات"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
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
            );
          })}
        </div>
      )}

      {/* نموذج إضافة خدمة */}
      {showAddForm ? (
        <div className="p-3 rounded-lg border border-primary-200 bg-primary-50/30 space-y-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="اسم الخدمة (مثال: تنظيف أسنان)"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            disabled={isPending}
            autoFocus
          />
          <div className="flex gap-3 items-end">
            {departments.length > 0 && (
              <div className="space-y-1 flex-1">
                <Label className="text-xs">القسم</Label>
                <select
                  value={newDeptId}
                  onChange={(e) => setNewDeptId(e.target.value)}
                  className="w-full h-8 px-2 rounded-lg border border-surface-200 bg-white text-xs"
                >
                  <option value="">بدون قسم</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">المدة (دقيقة)</Label>
              <select
                value={newDuration}
                onChange={(e) => setNewDuration(Number(e.target.value))}
                className="w-20 h-8 px-2 rounded-lg border border-surface-200 bg-white text-xs"
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d} د</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAdd} disabled={!newName.trim() || isPending} size="sm">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4" /> إضافة</>}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>إلغاء</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowAddForm(true)} className="w-full border-dashed">
          <Plus className="h-4 w-4 me-1" /> إضافة خدمة
        </Button>
      )}

      {/* مودال تعديل تفاصيل الخدمة */}
      {editingService && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingService(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-surface-900">إعدادات: {editingService.name}</h3>
              <button onClick={() => setEditingService(null)} className="p-1 rounded-lg hover:bg-surface-100">
                <X className="h-4 w-4 text-surface-400" />
              </button>
            </div>

            {departments.length > 0 && (
              <div className="space-y-2 mb-4">
                <Label className="text-sm">القسم</Label>
                <select
                  value={editingService.departmentId || ""}
                  onChange={(e) => handleUpdateDetails(editingService.id, { departmentId: e.target.value || null })}
                  className="w-full h-9 px-3 rounded-lg border border-surface-200 bg-white text-sm"
                >
                  <option value="">بدون قسم</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-sm flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                المدة الافتراضية
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {DURATION_OPTIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => handleUpdateDetails(editingService.id, { defaultDurationMin: d })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      (editingService.defaultDurationMin || 30) === d
                        ? "bg-primary-600 text-white"
                        : "bg-surface-100 text-surface-600 hover:bg-surface-200"
                    }`}
                  >
                    {d} د
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
