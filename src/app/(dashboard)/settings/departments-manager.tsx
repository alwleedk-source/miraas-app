"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Loader2,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Settings2,
  X,
  Clock,
  Users,
} from "lucide-react";
import {
  addDepartment,
  updateDepartment,
  deleteDepartment,
  linkProviderToDepartment,
  unlinkProviderFromDepartment,
  getDepartmentProviders,
} from "@/app/actions/departments";
import ProviderScheduleEditor from "./provider-schedule-editor";

type Department = {
  id: string;
  name: string;
  color: string;
  defaultGapMinutes: number;
  isActive: boolean;
};

type Provider = {
  id: string;
  name: string;
  email: string;
};

type DepartmentProvider = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
};

const COLORS = [
  "#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6",
  "#EC4899", "#06B6D4", "#F97316", "#6366F1", "#14B8A6",
];

export default function DepartmentsManager({
  initialDepartments,
  allProviders,
}: {
  initialDepartments: Department[];
  allProviders: Provider[];
}) {
  const [deptList, setDeptList] = useState(initialDepartments);
  const [isPending, startTransition] = useTransition();

  // نافذة إضافة قسم
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3B82F6");
  const [newGap, setNewGap] = useState(15);

  // نافذة إعدادات القسم
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptProviders, setDeptProviders] = useState<DepartmentProvider[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);

  // نافذة جدول العمل
  const [scheduleEditor, setScheduleEditor] = useState<{ userId: string; userName: string } | null>(null);

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        const dep = await addDepartment({
          name: trimmed,
          color: newColor,
          defaultGapMinutes: newGap,
        });
        if (!dep.success) {
          alert(dep.error);
          return;
        }
        setDeptList((prev) => [
          ...prev,
          {
            id: dep.id,
            name: trimmed,
            color: newColor,
            defaultGapMinutes: newGap,
            isActive: true,
          },
        ]);
        setNewName("");
        setNewGap(15);
        setShowAdd(false);
      } catch {
        alert("تعذّر إضافة القسم — حاول مرة أخرى");
      }
    });
  };

  const handleToggle = (id: string) => {
    const dept = deptList.find((d) => d.id === id);
    if (!dept) return;
    setDeptList((prev) =>
      prev.map((d) => (d.id === id ? { ...d, isActive: !d.isActive } : d))
    );
    startTransition(async () => {
      try {
        const result = await updateDepartment(id, { isActive: !dept.isActive });
        if (!result.success) throw new Error(result.error);
      } catch (err) {
        // تراجع + إظهار الخطأ — لا desync صامت
        setDeptList((prev) =>
          prev.map((d) => (d.id === id ? { ...d, isActive: dept.isActive } : d))
        );
        alert(err instanceof Error ? err.message : "تعذّر تغيير حالة القسم");
      }
    });
  };

  const handleDelete = (id: string) => {
    // تأكيد — الحذف يُزيل ربط مقدّمي الخدمة بالقسم (cascade)
    if (!confirm("حذف هذا القسم نهائياً؟ سيُزال ربط مقدّمي الخدمة به.")) return;
    startTransition(async () => {
      try {
        await deleteDepartment(id);
        // نُزيل من القائمة بعد نجاح الخادم فقط (لا desync لو فشل الحذف)
        setDeptList((prev) => prev.filter((d) => d.id !== id));
      } catch (err) {
        alert(err instanceof Error ? err.message : "تعذّر حذف القسم");
      }
    });
  };

  const handleGapChange = (id: string, gap: number) => {
    const prevGap = deptList.find((d) => d.id === id)?.defaultGapMinutes;
    setDeptList((prev) =>
      prev.map((d) => (d.id === id ? { ...d, defaultGapMinutes: gap } : d))
    );
    // حدّث نسخة المودال أيضاً — أزرار الفجوة تقارن مع editingDept.defaultGapMinutes
    setEditingDept((prev) =>
      prev && prev.id === id ? { ...prev, defaultGapMinutes: gap } : prev
    );
    startTransition(async () => {
      try {
        const result = await updateDepartment(id, { defaultGapMinutes: gap });
        if (!result.success) throw new Error(result.error);
      } catch (err) {
        // تراجع — القيمة لم تُحفَظ، لا نُبقِ تغييراً وهمياً (الفجوة تؤثّر على تباعد المواعيد)
        setDeptList((prev) =>
          prev.map((d) =>
            d.id === id ? { ...d, defaultGapMinutes: prevGap ?? d.defaultGapMinutes } : d,
          ),
        );
        setEditingDept((prev) =>
          prev && prev.id === id
            ? { ...prev, defaultGapMinutes: prevGap ?? prev.defaultGapMinutes }
            : prev,
        );
        alert(err instanceof Error ? err.message : "تعذّر حفظ الفجوة الزمنية");
      }
    });
  };

  const openDeptSettings = async (dept: Department) => {
    setEditingDept(dept);
    setLoadingProviders(true);
    try {
      const providers = await getDepartmentProviders(dept.id);
      setDeptProviders(providers);
    } catch {
      setDeptProviders([]);
    }
    setLoadingProviders(false);
  };

  const handleLinkProvider = (userId: string) => {
    if (!editingDept) return;
    startTransition(async () => {
      try {
        const result = await linkProviderToDepartment(editingDept.id, userId);
        if (!result.success) {
          alert(result.error);
          return;
        }
        const providers = await getDepartmentProviders(editingDept.id);
        setDeptProviders(providers);
      } catch (err) {
        alert(err instanceof Error ? err.message : "تعذّر ربط المزوّد");
      }
    });
  };

  const handleUnlinkProvider = (linkId: string) => {
    const removed = deptProviders.find((p) => p.id === linkId);
    setDeptProviders((prev) => prev.filter((p) => p.id !== linkId));
    startTransition(async () => {
      try {
        const result = await unlinkProviderFromDepartment(linkId);
        if (!result.success) throw new Error(result.error);
      } catch (err) {
        // تراجع — لم يُفكّ الربط فعلياً، نُعيد المزوّد ونُظهر الخطأ (لا desync صامت)
        if (removed) setDeptProviders((prev) => [...prev, removed]);
        alert(err instanceof Error ? err.message : "تعذّر فكّ الربط");
      }
    });
  };

  // مقدمو الخدمة الغير مرتبطين بهذا القسم
  const availableProviders = allProviders.filter(
    (p) => !deptProviders.some((dp) => dp.userId === p.id)
  );

  return (
    <div className="space-y-3">
      {/* قائمة الأقسام */}
      {deptList.length === 0 && !showAdd ? (
        <p className="text-sm text-surface-400 text-center py-4">
          لا توجد أقسام — أضف قسماً لتنظيم الحجوزات حسب التخصصات
        </p>
      ) : (
        <div className="space-y-1.5">
          {deptList.map((dept) => (
            <div
              key={dept.id}
              className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                dept.isActive
                  ? "border-surface-200 bg-white"
                  : "border-surface-100 bg-surface-50 opacity-60"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: dept.color }}
                />
                <div>
                  <span
                    className={`text-sm font-medium ${
                      dept.isActive
                        ? "text-surface-900"
                        : "text-surface-400 line-through"
                    }`}
                  >
                    {dept.name}
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-surface-400 flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      فجوة: {dept.defaultGapMinutes} د
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openDeptSettings(dept)}
                  disabled={isPending}
                  className="p-1.5 rounded-lg hover:bg-surface-100 text-surface-400 hover:text-primary-600 transition-colors"
                  title="إعدادات القسم"
                >
                  <Settings2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleToggle(dept.id)}
                  disabled={isPending}
                  className="p-1.5 rounded-lg hover:bg-surface-100 text-surface-400 hover:text-surface-700 transition-colors"
                  title={dept.isActive ? "تعطيل" : "تفعيل"}
                >
                  {dept.isActive ? (
                    <ToggleRight className="h-4 w-4 text-success-500" />
                  ) : (
                    <ToggleLeft className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={() => handleDelete(dept.id)}
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

      {/* نموذج إضافة قسم جديد */}
      {showAdd ? (
        <div className="p-3 rounded-lg border border-primary-200 bg-primary-50/30 space-y-3">
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="اسم القسم (مثال: عيادة العيون)"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              disabled={isPending}
              autoFocus
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="space-y-1">
              <Label className="text-xs">اللون</Label>
              <div className="flex gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    className={`w-5 h-5 rounded-full border-2 transition-all ${
                      newColor === c ? "border-surface-900 scale-110" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">فجوة زمنية (دقيقة)</Label>
              <Input
                type="number"
                min={0}
                max={120}
                value={newGap}
                onChange={(e) => setNewGap(Number(e.target.value))}
                className="w-20 h-8 text-sm"
                dir="ltr"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAdd} disabled={!newName.trim() || isPending} size="sm">
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4" /> إضافة
                </>
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAdd(true)}
          className="w-full border-dashed"
        >
          <Plus className="h-4 w-4 me-1" /> إضافة قسم
        </Button>
      )}

      {/* نافذة إعدادات القسم (مقدمي الخدمة + الفجوة) */}
      {editingDept && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setEditingDept(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: editingDept.color }}
                />
                <h3 className="text-base font-bold text-surface-900">
                  إعدادات {editingDept.name}
                </h3>
              </div>
              <button
                onClick={() => setEditingDept(null)}
                className="p-1 rounded-lg hover:bg-surface-100"
              >
                <X className="h-4 w-4 text-surface-400" />
              </button>
            </div>

            {/* الفجوة الزمنية */}
            <div className="mb-4 p-3 rounded-lg bg-surface-50 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-surface-700">
                <Clock className="h-4 w-4 text-primary-500" />
                الفجوة الزمنية بين المواعيد
              </div>
              <div className="flex items-center gap-2">
                {[5, 10, 15, 20, 30, 45, 60].map((gap) => (
                  <button
                    key={gap}
                    onClick={() => handleGapChange(editingDept.id, gap)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                      editingDept.defaultGapMinutes === gap
                        ? "bg-primary-600 text-white"
                        : "bg-white border border-surface-200 text-surface-600 hover:border-primary-300"
                    }`}
                  >
                    {gap} د
                  </button>
                ))}
              </div>
            </div>

            {/* مقدمي الخدمة المرتبطين */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-surface-700">
                <Users className="h-4 w-4 text-primary-500" />
                مقدمي الخدمة في هذا القسم
              </div>

              {loadingProviders ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-surface-400" />
                </div>
              ) : (
                <>
                  {deptProviders.length === 0 ? (
                    <p className="text-xs text-surface-400 text-center py-3">
                      لا يوجد مقدمي خدمة مرتبطين — أضف من القائمة أدناه
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {deptProviders.map((dp) => (
                        <div
                          key={dp.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-success-50 border border-success-100"
                        >
                          <div>
                            <p className="text-sm font-medium text-surface-900">
                              {dp.userName}
                            </p>
                            <p className="text-[10px] text-surface-400" dir="ltr">
                              {dp.userEmail}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setScheduleEditor({ userId: dp.userId, userName: dp.userName })}
                              className="p-1 rounded-lg hover:bg-primary-50 text-surface-400 hover:text-primary-600 transition-colors"
                              title="جدول العمل"
                            >
                              <Clock className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleUnlinkProvider(dp.id)}
                              disabled={isPending}
                              className="p-1 rounded-lg hover:bg-danger-50 text-surface-400 hover:text-danger-500"
                              title="إلغاء الربط"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* مقدمي الخدمة المتاحين للإضافة */}
                  {availableProviders.length > 0 && (
                    <div className="pt-2 border-t border-surface-100 space-y-1.5">
                      <p className="text-[10px] text-surface-400 font-medium">
                        متاحون للإضافة:
                      </p>
                      {availableProviders.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleLinkProvider(p.id)}
                          disabled={isPending}
                          className="w-full flex items-center justify-between p-2 rounded-lg bg-surface-50 hover:bg-primary-50 border border-surface-100 hover:border-primary-200 transition-all text-start"
                        >
                          <div>
                            <p className="text-sm text-surface-700">{p.name}</p>
                            <p className="text-[10px] text-surface-400" dir="ltr">
                              {p.email}
                            </p>
                          </div>
                          <Plus className="h-3.5 w-3.5 text-primary-500" />
                        </button>
                      ))}
                    </div>
                  )}

                  {availableProviders.length === 0 && allProviders.length === 0 && (
                    <p className="text-xs text-warning-600 bg-warning-50 rounded-lg p-2.5 mt-2">
                      💡 لم يتم إنشاء أي حساب بدور &quot;مقدم خدمة&quot; بعد.
                      اذهب لصفحة الفريق وأضف عضواً بصلاحية &quot;مقدم خدمة&quot;.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* محرر جدول عمل المقدم */}
      {scheduleEditor && (
        <ProviderScheduleEditor
          userId={scheduleEditor.userId}
          userName={scheduleEditor.userName}
          open={true}
          onClose={() => setScheduleEditor(null)}
        />
      )}
    </div>
  );
}
