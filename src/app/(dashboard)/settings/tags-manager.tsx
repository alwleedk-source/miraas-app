"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X, Loader2 } from "lucide-react";
import { createTag, deleteTag } from "@/app/actions/tags";

interface TagData {
  id: string;
  name: string;
  color: string;
}

const COLORS = [
  "#3B82F6", "#8B5CF6", "#EC4899", "#EF4444", "#F97316",
  "#F59E0B", "#22C55E", "#14B8A6", "#06B6D4", "#6B7280",
];

export default function TagsManager({ initialTags }: { initialTags: TagData[] }) {
  const [tags, setTags] = useState(initialTags);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      try {
        const tag = await createTag({ name: newName.trim(), color: newColor });
        setTags((prev) => [...prev, tag]);
        setNewName("");
        setShowForm(false);
      } catch {
        // ignore
      }
    });
  };

  const handleDelete = (tagId: string) => {
    startTransition(async () => {
      await deleteTag(tagId);
      setTags((prev) => prev.filter((t) => t.id !== tagId));
    });
  };

  return (
    <div className="space-y-3">
      {/* التصنيفات الحالية */}
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm"
              style={{ backgroundColor: `${tag.color}15`, color: tag.color, borderColor: `${tag.color}40` }}
            >
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
              {tag.name}
              <button
                onClick={() => handleDelete(tag.id)}
                className="hover:bg-white/50 rounded-full p-0.5 ms-1 transition-colors"
                disabled={isPending}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-surface-400">لا توجد تصنيفات — أنشئ تصنيفات لتنظيم عملائك</p>
      )}

      {/* نموذج إضافة */}
      {showForm ? (
        <div className="flex items-end gap-2 p-3 bg-surface-50 rounded-lg animate-fade-in">
          <div className="flex-1 space-y-1.5">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="اسم التصنيف (مثال: VIP، مهم، عقاري)"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              maxLength={30}
            />
            <div className="flex gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className="w-6 h-6 rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: c,
                    borderColor: newColor === c ? "#1e293b" : "transparent",
                    transform: newColor === c ? "scale(1.2)" : "scale(1)",
                  }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 me-1" />
          إضافة تصنيف
        </Button>
      )}
    </div>
  );
}
