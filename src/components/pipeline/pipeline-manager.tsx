"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GripVertical,
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
  Star,
  Loader2,
  AlertTriangle,
  Inbox,
  Lock,
  LockOpen,
} from "lucide-react";
import {
  createStage,
  updateStage,
  deleteStage,
  reorderStages,
  setDefaultStage,
  toggleExclusive,
} from "@/actions/pipeline";

interface Stage {
  id: string;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
  isExclusive: boolean;
  count: number;
}

const PRESET_COLORS = [
  "#3B82F6", "#F59E0B", "#EF4444", "#8B5CF6",
  "#22C55E", "#6B7280", "#EC4899", "#14B8A6",
  "#F97316", "#06B6D4",
];

export function PipelineManager({
  stages: initialStages,
  totalLeads,
}: {
  stages: Stage[];
  totalLeads: number;
}) {
  const [stages, setStages] = useState(initialStages);
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  // إضافة مرحلة
  const handleAdd = () => {
    if (!newName.trim()) return;
    setError(null);
    startTransition(async () => {
      const stage = await createStage({
        name: newName.trim(),
        color: newColor,
      });
      setStages((prev) => [...prev, { ...stage, count: 0 }]);
      setNewName("");
      setNewColor(PRESET_COLORS[0]);
      setShowAdd(false);
    });
  };

  // بدء التعديل
  const startEdit = (stage: Stage) => {
    setEditingId(stage.id);
    setEditName(stage.name);
    setEditColor(stage.color);
    setError(null);
  };

  // حفظ التعديل
  const handleSave = () => {
    if (!editingId || !editName.trim()) return;
    setError(null);
    startTransition(async () => {
      await updateStage({
        stageId: editingId,
        name: editName.trim(),
        color: editColor,
      });
      setStages((prev) =>
        prev.map((s) =>
          s.id === editingId ? { ...s, name: editName.trim(), color: editColor } : s
        )
      );
      setEditingId(null);
    });
  };

  // حذف مرحلة
  const handleDelete = (stageId: string) => {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;

    if (stage.count > 0) {
      setError(`لا يمكن حذف "${stage.name}" — تحتوي على ${stage.count} عميل`);
      return;
    }

    if (stage.isDefault) {
      setError(`لا يمكن حذف المرحلة الافتراضية "${stage.name}"`);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await deleteStage({ stageId });
      if ("error" in result) {
        setError(result.error ?? "حدث خطأ");
        return;
      }
      setStages((prev) => prev.filter((s) => s.id !== stageId));
    });
  };

  // تعيين كافتراضي
  const handleSetDefault = (stageId: string) => {
    setError(null);
    startTransition(async () => {
      await setDefaultStage({ stageId });
      setStages((prev) =>
        prev.map((s) => ({ ...s, isDefault: s.id === stageId }))
      );
    });
  };

  // تبديل حصرية
  const handleToggleExclusive = (stageId: string) => {
    setError(null);
    startTransition(async () => {
      await toggleExclusive({ stageId });
      setStages((prev) =>
        prev.map((s) => s.id === stageId ? { ...s, isExclusive: !s.isExclusive } : s)
      );
    });
  };

  // السحب والإفلات
  const handleDragStart = (id: string) => setDraggedId(id);

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) return;

    setStages((prev) => {
      const items = [...prev];
      const fromIndex = items.findIndex((s) => s.id === draggedId);
      const toIndex = items.findIndex((s) => s.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      return items;
    });
  };

  const handleDragEnd = () => {
    if (!draggedId) return;
    setDraggedId(null);
    startTransition(async () => {
      await reorderStages({
        stageIds: stages.map((s) => s.id),
      });
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">خط الأنابيب</h1>
          <p className="text-surface-500 mt-1">
            تخصيص مراحل متابعة العملاء ({totalLeads} عميل)
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} disabled={showAdd}>
          <Plus className="h-4 w-4 me-2" />
          إضافة مرحلة
        </Button>
      </div>

      {/* رسالة خطأ */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-50 text-danger-600 text-sm border border-danger-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ms-auto">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* نموذج إضافة مرحلة */}
      {showAdd && (
        <Card className="border-primary-200 bg-primary-50/30">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
              <div className="flex-1 w-full">
                <label className="text-sm font-medium text-surface-700 block mb-1.5">
                  اسم المرحلة
                </label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="مثال: مؤهّل، تفاوض..."
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  autoFocus
                  maxLength={30}
                />
                <span className="text-[10px] text-surface-400 mt-0.5">{newName.length}/30</span>
              </div>

              <div>
                <label className="text-sm font-medium text-surface-700 block mb-1.5">
                  اللون
                </label>
                <div className="flex gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewColor(c)}
                      className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c,
                        borderColor: newColor === c ? "#1E293B" : "transparent",
                        transform: newColor === c ? "scale(1.15)" : undefined,
                      }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleAdd}
                  disabled={!newName.trim() || isPending}
                  size="sm"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  <span className="ms-1">حفظ</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAdd(false);
                    setNewName("");
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* المراحل */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">المراحل الحالية</CardTitle>
        </CardHeader>
        <CardContent>
          {stages.length > 0 ? (
            <>
              <div className="space-y-2">
                {stages.map((stage, index) => (
                  <div
                    key={stage.id}
                    draggable={editingId !== stage.id}
                    onDragStart={() => handleDragStart(stage.id)}
                    onDragOver={(e) => handleDragOver(e, stage.id)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all group ${
                      draggedId === stage.id
                        ? "border-primary-300 bg-primary-50 opacity-60 scale-[0.98]"
                        : "border-surface-200 bg-white hover:bg-surface-50"
                    }`}
                  >
                    {/* أيقونة السحب */}
                    <span className="cursor-grab active:cursor-grabbing text-surface-300 hover:text-surface-500 transition-colors">
                      <GripVertical className="h-5 w-5" />
                    </span>

                    {/* دائرة اللون */}
                    {editingId === stage.id ? (
                      <div className="flex gap-1">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => setEditColor(c)}
                            className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-125"
                            style={{
                              backgroundColor: c,
                              borderColor: editColor === c ? "#1E293B" : "transparent",
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <div
                        className="w-4 h-4 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: stage.color }}
                      />
                    )}

                    {/* الاسم */}
                    {editingId === stage.id ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 h-8 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSave();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                        maxLength={30}
                      />
                    ) : (
                      <span className="font-medium text-surface-900 flex-1">
                        {stage.name}
                      </span>
                    )}

                    {/* الشارات */}
                    {stage.isDefault && editingId !== stage.id && (
                      <Badge variant="outline" className="text-xs bg-primary-50 text-primary-700 border-primary-200">
                        <Star className="h-3 w-3 me-1 fill-current" />
                        افتراضي
                      </Badge>
                    )}

                    {stage.isExclusive && editingId !== stage.id && (
                      <Badge variant="outline" className="text-xs bg-warning-50 text-warning-700 border-warning-200">
                        <Lock className="h-3 w-3 me-1" />
                        حصرية
                      </Badge>
                    )}

                    <Badge variant="secondary">{stage.count} عميل</Badge>

                    {/* أزرار التحكم */}
                    {editingId === stage.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleSave}
                          disabled={isPending}
                          className="p-1.5 rounded-md bg-success-50 text-success-600 hover:bg-success-100 transition-colors"
                        >
                          {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1.5 rounded-md hover:bg-surface-100 text-surface-400 transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!stage.isDefault && (
                          <button
                            onClick={() => handleSetDefault(stage.id)}
                            title="تعيين كافتراضي"
                            className="p-1.5 rounded-md hover:bg-warning-50 text-surface-400 hover:text-warning-500 transition-colors"
                          >
                            <Star className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleToggleExclusive(stage.id)}
                          title={stage.isExclusive ? "إلغاء الحصرية" : "تعيين كحصرية"}
                          className={`p-1.5 rounded-md transition-colors ${stage.isExclusive ? "bg-warning-50 text-warning-600" : "hover:bg-surface-100 text-surface-400 hover:text-surface-600"}`}
                        >
                          {stage.isExclusive ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => startEdit(stage)}
                          className="p-1.5 rounded-md hover:bg-surface-100 text-surface-400 hover:text-surface-600 transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {!stage.isDefault && (
                          <button
                            onClick={() => handleDelete(stage.id)}
                            className="p-1.5 rounded-md hover:bg-danger-50 text-surface-400 hover:text-danger-500 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}

                    <span className="text-xs text-surface-400">#{index + 1}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 bg-surface-50 rounded-lg border border-dashed border-surface-200">
                <p className="text-sm text-surface-500 text-center">
                  اسحب المراحل لإعادة ترتيبها • اضغط على القلم للتعديل • ⭐ لتعيين الافتراضي
                </p>
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <Inbox className="h-10 w-10 mx-auto mb-3 text-surface-300" />
              <p className="text-surface-500 text-sm mb-3">لا توجد مراحل</p>
              <Button size="sm" onClick={() => setShowAdd(true)}>
                <Plus className="h-4 w-4 me-2" />
                إضافة أول مرحلة
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* معاينة بصرية */}
      {stages.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">المعاينة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1 overflow-x-auto pb-2">
              {stages.map((stage, index) => (
                <div key={stage.id} className="flex items-center">
                  <div
                    className="px-4 py-2 rounded-lg text-white text-sm font-medium whitespace-nowrap shadow-sm"
                    style={{ backgroundColor: stage.color }}
                  >
                    {stage.name}
                    {stage.count > 0 && (
                      <span className="ms-1.5 bg-white/25 px-1.5 py-0.5 rounded text-xs">
                        {stage.count}
                      </span>
                    )}
                  </div>
                  {index < stages.length - 1 && (
                    <span className="text-surface-300 mx-1">←</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
