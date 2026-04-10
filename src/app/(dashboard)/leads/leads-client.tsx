"use client";

import { useState, useTransition, useCallback, useEffect, lazy, Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Plus,
  Search,
  Filter,
  LayoutGrid,
  List,
  Phone,
  Mail,
  Clock,
  CalendarClock,
  User,
  Megaphone,
  X,
  Loader2,
  Inbox,
  Pencil,
  Trash2,
  ChevronDown,
  Eye,
  ArrowRightLeft,
  MessageSquare,
  Check,
  AlertTriangle,
  FileSpreadsheet,
  CheckSquare,
  Square,
  MinusSquare,
} from "lucide-react";
import { cn, getInitials, PRIORITY_LABELS, PRIORITY_COLORS } from "@/lib/utils";
import {
  createLead,
  updateLead,
  deleteLead,
  changeLeadStage,
  createFollowUp,
  getFollowUps,
} from "@/app/actions/leads";
import { createBooking } from "@/app/actions/bookings";
import { assignTag, removeTag, getLeadTags } from "@/app/actions/tags";

const ImportDialog = lazy(() => import("./import-dialog"));

// =============================================
// Types
// =============================================

interface LeadData {
  id: string;
  name: string;
  phone: string | null;
  email?: string | null;
  company?: string | null;
  priority: string;
  welcomeSentAt?: Date | null;
  createdAt: Date;
  assignedUser: { id: string; name: string; image: string | null } | null;
  stage: { id: string; name: string; color: string } | null;
  source: { id: string; name: string; platform: string | null } | null;
}

interface StageData {
  id: string;
  name: string;
  color: string;
  isBooking?: boolean;
}

interface TagData {
  id: string;
  name: string;
  color: string;
}

interface TeamMember {
  id: string;
  name: string;
}

interface Props {
  initialLeads: LeadData[];
  stages: StageData[];
  total: number;
  teamMembers?: TeamMember[];
  tags?: TagData[];
  currentUserRole?: string;
}

type FollowUpType = "CALL" | "MESSAGE" | "MEETING" | "EMAIL" | "WHATSAPP" | "NOTE";

const FOLLOW_UP_TYPES: { value: FollowUpType; label: string }[] = [
  { value: "CALL", label: "مكالمة" },
  { value: "WHATSAPP", label: "واتساب" },
  { value: "EMAIL", label: "بريد" },
  { value: "MESSAGE", label: "رسالة" },
  { value: "MEETING", label: "اجتماع" },
  { value: "NOTE", label: "ملاحظة" },
];

// =============================================
// Component
// =============================================

export default function LeadsClient({ initialLeads, stages, total, teamMembers = [], tags: availableTags = [], currentUserRole = "OWNER" }: Props) {
  const [leads, setLeads] = useState(initialLeads);
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedLead, setSelectedLead] = useState<LeadData | null>(null);
  const [editingLead, setEditingLead] = useState<LeadData | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  // فلاتر
  const [filterStage, setFilterStage] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<string>("");
  const [filterAssigned, setFilterAssigned] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);

  // تحديد جماعي
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // نموذج الإضافة
  const [newLead, setNewLead] = useState({
    name: "",
    phone: "",
    email: "",
    priority: "MEDIUM" as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
    stageId: "",
    source: "",
  });

  // نموذج المتابعة
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpType, setFollowUpType] = useState<FollowUpType>("CALL");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [followUpScheduled, setFollowUpScheduled] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");

  // سجل المتابعات
  const [followUpsList, setFollowUpsList] = useState<Array<{
    id: string;
    type: string;
    notes: string | null;
    createdAt: Date;
    scheduledAt?: Date | null;
    user: { id: string; name: string; image: string | null } | null;
  }>>([]);
  const [loadingFollowUps, setLoadingFollowUps] = useState(false);

  // تصنيفات العميل
  const [leadTags, setLeadTags] = useState<TagData[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);

  // نافذة الحجز
  const [bookingModal, setBookingModal] = useState<{ leadId: string; stageId: string; leadName: string } | null>(null);
  const [bookingDate, setBookingDate] = useState("");
  const [bookingService, setBookingService] = useState("");
  const [bookingNotes, setBookingNotes] = useState("");

  // جلب المتابعات عند اختيار عميل
  useEffect(() => {
    if (selectedLead && !editingLead) {
      setLoadingFollowUps(true);
      getFollowUps(selectedLead.id)
        .then((data) => setFollowUpsList(data))
        .catch(() => setFollowUpsList([]))
        .finally(() => setLoadingFollowUps(false));
      // جلب تصنيفات العميل
      setLoadingTags(true);
      getLeadTags(selectedLead.id)
        .then((data) => setLeadTags(data))
        .catch(() => setLeadTags([]))
        .finally(() => setLoadingTags(false));
    } else {
      setFollowUpsList([]);
      setLeadTags([]);
    }
  }, [selectedLead?.id, editingLead]);

  // تنسيق الأرقام بالإنجليزية
  const formatPhoneDisplay = (phone: string) => {
    // تحويل الأرقام العربية إلى إنجليزية
    return phone.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString());
  };

  // فلتر محلي
  const filteredLeads = leads.filter((lead) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !searchQuery ||
      lead.name.toLowerCase().includes(q) ||
      lead.phone?.includes(q) ||
      lead.source?.name.toLowerCase().includes(q);

    const matchesStage = !filterStage || lead.stage?.id === filterStage;
    const matchesPriority = !filterPriority || lead.priority === filterPriority;
    const matchesAssigned = !filterAssigned || lead.assignedUser?.id === filterAssigned;

    return matchesSearch && matchesStage && matchesPriority && matchesAssigned;
  });

  const activeFiltersCount = [filterStage, filterPriority, filterAssigned].filter(Boolean).length;

  // إجراءات جماعية
  const isAllSelected = filteredLeads.length > 0 && filteredLeads.every((l) => selectedIds.has(l.id));
  const isSomeSelected = filteredLeads.some((l) => selectedIds.has(l.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLeads.map((l) => l.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkStageChange = (stageId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const stage = stages.find((s) => s.id === stageId);
        await Promise.all(Array.from(selectedIds).map((id) =>
          changeLeadStage(id, stageId)
        ));
        setLeads((prev) =>
          prev.map((l) => (selectedIds.has(l.id) ? { ...l, stage: stage || null } : l))
        );
        setSelectedIds(new Set());
      } catch {
        setError("فشل في تغيير المرحلة");
      }
    });
  };

  const handleBulkAssign = (memberId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const member = teamMembers.find((m) => m.id === memberId);
        await Promise.all(Array.from(selectedIds).map((id) =>
          updateLead({ id, assignedTo: memberId || undefined })
        ));
        setLeads((prev) =>
          prev.map((l) =>
            selectedIds.has(l.id)
              ? { ...l, assignedUser: member ? { id: member.id, name: member.name, image: null } : null }
              : l
          )
        );
        setSelectedIds(new Set());
      } catch {
        setError("فشل في التعيين");
      }
    });
  };

  const handleBulkDelete = () => {
    if (currentUserRole === "COORDINATOR") return;
    setError(null);
    startTransition(async () => {
      try {
        await Promise.all(Array.from(selectedIds).map((id) => deleteLead(id)));
        setLeads((prev) => prev.filter((l) => !selectedIds.has(l.id)));
        setSelectedIds(new Set());
      } catch (err) {
        const msg = err instanceof Error ? err.message : "فشل في الحذف";
        setError(msg);
      }
    });
  };

  // =============================================
  // Actions
  // =============================================

  const handleAddLead = () => {
    if (!newLead.name.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const lead = await createLead({
          name: newLead.name.trim(),
          phone: newLead.phone || undefined,
          email: newLead.email || undefined,
          priority: newLead.priority,
          stageId: newLead.stageId || undefined,
          sourceName: newLead.source || undefined,
        });
        // Add to local state with stage info
        const stage = stages.find((s) => s.id === lead.stageId);
        setLeads((prev) => [
          {
            ...lead,
            assignedUser: null,
            stage: stage || null,
            source: null,
          } as LeadData,
          ...prev,
        ]);
        setNewLead({ name: "", phone: "", email: "", priority: "MEDIUM", stageId: "", source: "" });
        setShowAddForm(false);
      } catch (err) {
        setError("فشل في إضافة العميل");
      }
    });
  };

  const handleUpdateLead = () => {
    if (!editingLead) return;
    setError(null);
    startTransition(async () => {
      try {
        await updateLead({
          id: editingLead.id,
          name: editingLead.name,
          phone: editingLead.phone || undefined,
          email: (editingLead as LeadData & { email?: string }).email || undefined,
          priority: editingLead.priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
        });
        setLeads((prev) =>
          prev.map((l) => (l.id === editingLead.id ? { ...l, ...editingLead } : l))
        );
        setEditingLead(null);
        setSelectedLead(null);
      } catch {
        setError("فشل في تحديث بيانات العميل");
      }
    });
  };

  const handleDeleteLead = (leadId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await deleteLead(leadId);
        setLeads((prev) => prev.filter((l) => l.id !== leadId));
        setShowDeleteConfirm(null);
        setSelectedLead(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "فشل في حذف العميل";
        setError(msg);
      }
    });
  };

  const handleChangeStage = (leadId: string, stageId: string) => {
    const stage = stages.find((s) => s.id === stageId);

    // إذا كانت مرحلة حجز — نفتح نافذة الحجز أولاً
    if (stage?.isBooking) {
      const lead = leads.find((l) => l.id === leadId);
      setBookingModal({ leadId, stageId, leadName: lead?.name || "" });
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await changeLeadStage(leadId, stageId);
        setLeads((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, stage: stage || null } : l))
        );
      } catch {
        setError("فشل في تغيير المرحلة");
      }
    });
  };

  // تأكيد الحجز
  const handleBookingConfirm = () => {
    if (!bookingModal || !bookingDate || !bookingService.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await changeLeadStage(bookingModal.leadId, bookingModal.stageId);
        await createBooking({
          leadId: bookingModal.leadId,
          bookingDate,
          bookingService: bookingService.trim(),
          bookingNotes: bookingNotes || undefined,
        });
        const stage = stages.find((s) => s.id === bookingModal.stageId);
        setLeads((prev) =>
          prev.map((l) => (l.id === bookingModal.leadId ? { ...l, stage: stage || null } : l))
        );
        setBookingModal(null);
        setBookingDate("");
        setBookingService("");
        setBookingNotes("");
      } catch {
        setError("فشل في إنشاء الحجز");
      }
    });
  };

  // تعيين منسق
  const handleAssignLead = (leadId: string, memberId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await updateLead({ id: leadId, assignedTo: memberId || undefined });
        const member = teamMembers.find((m) => m.id === memberId);
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId
              ? { ...l, assignedUser: member ? { id: member.id, name: member.name, image: null } : null }
              : l
          )
        );
        if (selectedLead?.id === leadId) {
          setSelectedLead((p) =>
            p ? { ...p, assignedUser: member ? { id: member.id, name: member.name, image: null } : null } : p
          );
        }
      } catch {
        setError("فشل في تعيين المنسق");
      }
    });
  };

  // إضافة/إزالة تصنيف
  const handleToggleTag = (leadId: string, tagId: string) => {
    const isAssigned = leadTags.some((t) => t.id === tagId);
    startTransition(async () => {
      try {
        if (isAssigned) {
          await removeTag(leadId, tagId);
          setLeadTags((prev) => prev.filter((t) => t.id !== tagId));
        } else {
          await assignTag(leadId, tagId);
          const tag = availableTags.find((t) => t.id === tagId);
          if (tag) setLeadTags((prev) => [...prev, tag]);
        }
      } catch {
        setError("فشل في تحديث التصنيف");
      }
    });
  };

  const handleAddFollowUp = () => {
    if (!selectedLead || !followUpNotes.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        // تجميع التاريخ/الوقت
        let scheduledAt: Date | undefined;
        if (followUpScheduled && followUpDate) {
          const timeStr = followUpTime || "09:00";
          scheduledAt = new Date(`${followUpDate}T${timeStr}:00`);
        }

        const followUp = await createFollowUp({
          leadId: selectedLead.id,
          type: followUpType,
          notes: followUpNotes.trim(),
          scheduledAt,
        });
        // أضف المتابعة الجديدة لأعلى القائمة فورًا
        setFollowUpsList((prev) => [
          {
            id: followUp.id,
            type: followUp.type,
            notes: followUp.notes,
            createdAt: followUp.createdAt,
            scheduledAt: followUp.scheduledAt,
            user: null,
          },
          ...prev,
        ]);
        setFollowUpNotes("");
        setFollowUpScheduled(false);
        setFollowUpDate("");
        setFollowUpTime("");
        setShowFollowUp(false);
      } catch {
        setError("فشل في إضافة المتابعة");
      }
    });
  };

  function timeAgo(date: Date): string {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "الآن";
    if (mins < 60) return `منذ ${mins} دقيقة`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `منذ ${hours} ساعة`;
    const days = Math.floor(hours / 24);
    return `منذ ${days} يوم`;
  }

  // =============================================
  // Render
  // =============================================

  return (
    <div className="space-y-6 animate-fade-in">
      {/* العنوان */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">العملاء</h1>
          <p className="text-surface-500 mt-1">
            إدارة ومتابعة العملاء المحتملين ({leads.length} عميل)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <FileSpreadsheet className="h-4 w-4 me-2" />
            استيراد
          </Button>
          <Button onClick={() => setShowAddForm(true)} disabled={showAddForm}>
            <Plus className="h-4 w-4 me-2" />
            إضافة عميل
          </Button>
        </div>
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

      {/* نموذج إضافة عميل */}
      {showAddForm && (
        <Card className="border-primary-200 bg-primary-50/30 animate-fade-in">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-surface-900">إضافة عميل جديد</h3>
              <button
                onClick={() => setShowAddForm(false)}
                className="p-1 hover:bg-surface-100 rounded"
              >
                <X className="h-4 w-4 text-surface-500" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label>الاسم *</Label>
                <Input
                  value={newLead.name}
                  onChange={(e) => setNewLead((p) => ({ ...p, name: e.target.value }))}
                  placeholder="اسم العميل"
                  autoFocus
                  maxLength={80}
                />
              </div>
              <div className="space-y-1.5">
                <Label>الهاتف</Label>
                <Input
                  value={newLead.phone}
                  onChange={(e) => setNewLead((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="+966..."
                  dir="ltr"
                  className="text-left"
                  maxLength={20}
                />
              </div>
              <div className="space-y-1.5">
                <Label>البريد الإلكتروني</Label>
                <Input
                  value={newLead.email}
                  onChange={(e) => setNewLead((p) => ({ ...p, email: e.target.value }))}
                  placeholder="email@example.com"
                  dir="ltr"
                  className="text-left"
                  type="email"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label>المرحلة</Label>
                <select
                  value={newLead.stageId}
                  onChange={(e) => setNewLead((p) => ({ ...p, stageId: e.target.value }))}
                  className="w-full h-9 rounded-lg border border-surface-200 bg-white px-3 text-sm text-surface-900"
                >
                  <option value="">الافتراضية</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>المصدر / الحملة</Label>
                <Input
                  value={newLead.source || ""}
                  onChange={(e) => setNewLead((p) => ({ ...p, source: e.target.value }))}
                  placeholder="مثال: إعلان فيسبوك، موقع الشركة..."
                  maxLength={50}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 mt-4">
              <div className="space-y-1.5">
                <Label>الأولوية</Label>
                <div className="flex gap-1.5">
                  {(["LOW", "MEDIUM", "HIGH", "URGENT"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setNewLead((prev) => ({ ...prev, priority: p }))}
                      className={cn(
                        "px-3 py-1.5 text-xs rounded-lg border transition-colors",
                        newLead.priority === p
                          ? "border-current font-semibold"
                          : "border-surface-200 text-surface-500"
                      )}
                      style={
                        newLead.priority === p
                          ? { color: PRIORITY_COLORS[p], borderColor: PRIORITY_COLORS[p], backgroundColor: `${PRIORITY_COLORS[p]}10` }
                          : undefined
                      }
                    >
                      {PRIORITY_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ms-auto flex gap-2">
                <Button onClick={handleAddLead} disabled={!newLead.name.trim() || isPending}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Plus className="h-4 w-4 me-1" />}
                  إضافة
                </Button>
                <Button variant="ghost" onClick={() => setShowAddForm(false)}>
                  إلغاء
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* شريط البحث والفلاتر */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
          <Input
            placeholder="ابحث بالاسم أو الهاتف أو الحملة..."
            className="pe-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            maxLength={100}
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(activeFiltersCount > 0 && "border-primary-300 bg-primary-50")}
          >
            <Filter className="h-4 w-4 me-1" />
            فلتر
            {activeFiltersCount > 0 && (
              <span className="ms-1 bg-primary-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                {activeFiltersCount}
              </span>
            )}
          </Button>
          <div className="flex border border-surface-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("table")}
              className={cn(
                "p-2.5 transition-colors",
                viewMode === "table"
                  ? "bg-primary-50 text-primary-600"
                  : "bg-white text-surface-400 hover:bg-surface-50"
              )}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("kanban")}
              className={cn(
                "p-2.5 transition-colors",
                viewMode === "kanban"
                  ? "bg-primary-50 text-primary-600"
                  : "bg-white text-surface-400 hover:bg-surface-50"
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* شريط الفلاتر */}
      {showFilters && (
        <div className="flex flex-wrap gap-3 p-3 bg-surface-50 rounded-lg border border-surface-200 animate-fade-in">
          <div className="space-y-1">
            <Label className="text-xs">المرحلة</Label>
            <select
              value={filterStage}
              onChange={(e) => setFilterStage(e.target.value)}
              className="h-8 rounded-md border border-surface-200 bg-white px-2 text-sm"
            >
              <option value="">الكل</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">الأولوية</Label>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="h-8 rounded-md border border-surface-200 bg-white px-2 text-sm"
            >
              <option value="">الكل</option>
              {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">المنسق</Label>
            <select
              value={filterAssigned}
              onChange={(e) => setFilterAssigned(e.target.value)}
              className="h-8 rounded-md border border-surface-200 bg-white px-2 text-sm"
            >
              <option value="">الكل</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          {activeFiltersCount > 0 && (
            <button
              onClick={() => { setFilterStage(""); setFilterPriority(""); setFilterAssigned(""); }}
              className="self-end text-xs text-danger-500 hover:text-danger-700 pb-1.5"
            >
              مسح الفلاتر
            </button>
          )}
        </div>
      )}

      {/* شريط الإجراءات الجماعية */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-lg border border-primary-200 animate-fade-in">
          <span className="text-sm font-medium text-primary-700">
            تم تحديد {selectedIds.size} عميل
          </span>
          <div className="flex items-center gap-2 ms-auto">
            <select
              onChange={(e) => { if (e.target.value) handleBulkStageChange(e.target.value); e.target.value = ""; }}
              className="h-8 rounded-md border border-primary-200 bg-white px-2 text-xs"
              defaultValue=""
            >
              <option value="" disabled>نقل للمرحلة...</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {teamMembers.length > 0 && (
              <select
                onChange={(e) => { if (e.target.value) handleBulkAssign(e.target.value); e.target.value = ""; }}
                className="h-8 rounded-md border border-primary-200 bg-white px-2 text-xs"
                defaultValue=""
              >
                <option value="" disabled>تعيين لـ...</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            )}
            {currentUserRole !== "COORDINATOR" && (
              <button
                onClick={handleBulkDelete}
                className="h-8 px-3 rounded-md bg-danger-50 text-danger-600 text-xs font-medium hover:bg-danger-100 transition-colors"
              >
                حذف ({selectedIds.size})
              </button>
            )}
            <button
              onClick={() => setSelectedIds(new Set())}
              className="h-8 px-3 rounded-md bg-white text-surface-600 text-xs border border-surface-200 hover:bg-surface-50"
            >
              إلغاء التحديد
            </button>
          </div>
        </div>
      )}

      {/* حالة فارغة */}
      {filteredLeads.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Inbox className="h-12 w-12 mx-auto mb-4 text-surface-300" />
            <h3 className="text-lg font-semibold text-surface-700 mb-2">
              {searchQuery || activeFiltersCount > 0 ? "لا توجد نتائج" : "لا يوجد عملاء بعد"}
            </h3>
            <p className="text-surface-500 text-sm mb-4">
              {searchQuery || activeFiltersCount > 0
                ? "جرب البحث بكلمات مختلفة أو غيّر الفلاتر"
                : "أضف أول عميل أو اربط Google Sheets عبر الويب هوك"}
            </p>
            {!searchQuery && activeFiltersCount === 0 && (
              <Button onClick={() => setShowAddForm(true)}>
                <Plus className="h-4 w-4 me-2" />
                إضافة أول عميل
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* عرض الجدول */}
      {viewMode === "table" && filteredLeads.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-100 bg-surface-50/50">
                    <th className="py-3 px-2 w-10">
                      <button onClick={toggleSelectAll} className="p-1 hover:text-primary-600 text-surface-400">
                        {isAllSelected ? <CheckSquare className="h-4 w-4 text-primary-600" /> : isSomeSelected ? <MinusSquare className="h-4 w-4 text-primary-400" /> : <Square className="h-4 w-4" />}
                      </button>
                    </th>
                    <th className="text-right py-3 px-4 text-surface-500 font-medium">العميل</th>
                    <th className="text-right py-3 px-4 text-surface-500 font-medium">الهاتف</th>
                    <th className="text-right py-3 px-4 text-surface-500 font-medium hidden md:table-cell">الحملة</th>
                    <th className="text-right py-3 px-4 text-surface-500 font-medium">المرحلة</th>
                    <th className="text-right py-3 px-4 text-surface-500 font-medium hidden lg:table-cell">المنسق</th>
                    <th className="text-right py-3 px-4 text-surface-500 font-medium hidden lg:table-cell">الأولوية</th>
                    <th className="text-right py-3 px-4 text-surface-500 font-medium hidden xl:table-cell">التاريخ</th>
                    <th className="w-28 text-center py-3 px-4 text-surface-500 font-medium">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.map((lead) => (
                    <tr
                      key={lead.id}
                      className={cn(
                        "border-b border-surface-50 hover:bg-surface-50/80 transition-colors",
                        selectedIds.has(lead.id) && "bg-primary-50/30"
                      )}
                    >
                      <td className="py-3 px-2">
                        <button onClick={() => toggleSelect(lead.id)} className="p-1 hover:text-primary-600 text-surface-400">
                          {selectedIds.has(lead.id) ? <CheckSquare className="h-4 w-4 text-primary-600" /> : <Square className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => setSelectedLead(lead)}
                          className="flex items-center gap-3 text-start hover:text-primary-600 transition-colors"
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs bg-primary-50 text-primary-700">
                              {getInitials(lead.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <span className="font-medium text-surface-900 block truncate max-w-[180px]">
                              {lead.name}
                              {lead.welcomeSentAt && (
                                <span
                                  className="inline-flex items-center ms-1.5 text-[10px] text-success-600 bg-success-50 rounded-full px-1.5 py-0.5"
                                  title={`تم إرسال ترحيب واتساب: ${new Date(lead.welcomeSentAt).toLocaleDateString("ar-SA")}`}
                                >
                                  <MessageSquare className="h-2.5 w-2.5 me-0.5" />
                                  ✓
                                </span>
                              )}
                            </span>
                            {lead.email && (
                              <span className="text-xs text-surface-400">{lead.email}</span>
                            )}
                          </div>
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        {lead.phone ? (
                          <div className="flex items-center gap-2">
                            <a
                              href={`tel:${lead.phone}`}
                              className="p-1 rounded hover:bg-success-50 text-surface-400 hover:text-success-600 transition-colors"
                              title="اتصال"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Phone className="h-3.5 w-3.5" />
                            </a>
                            <a
                              href={`https://wa.me/${lead.phone}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 rounded hover:bg-success-50 text-surface-400 hover:text-success-600 transition-colors"
                              title="واتساب"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                            </a>
                            <span dir="ltr" className="whitespace-nowrap text-surface-600 text-xs">{formatPhoneDisplay(lead.phone)}</span>
                          </div>
                        ) : (
                          <span className="text-surface-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        {lead.source ? (
                          <div className="flex items-center gap-1.5 text-surface-600 max-w-[140px]" title={lead.source.name}>
                            <Megaphone className="h-3.5 w-3.5 shrink-0 text-surface-400" />
                            <span className="truncate text-xs">{lead.source.name}</span>
                          </div>
                        ) : (
                          <span className="text-surface-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <StageDropdown
                          stages={stages}
                          currentStage={lead.stage}
                          onSelect={(stageId) => handleChangeStage(lead.id, stageId)}
                          disabled={isPending}
                        />
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        {lead.assignedUser ? (
                          <div className="flex items-center gap-1.5">
                            <Avatar className="h-5 w-5">
                              <AvatarFallback className="text-[9px] bg-primary-50 text-primary-700">
                                {getInitials(lead.assignedUser.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs text-surface-600 whitespace-nowrap">{lead.assignedUser.name}</span>
                          </div>
                        ) : (
                          <span className="text-surface-400 text-xs">غير معيّن</span>
                        )}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        <span
                          className="text-xs font-medium"
                          style={{ color: PRIORITY_COLORS[lead.priority] }}
                        >
                          {PRIORITY_LABELS[lead.priority]}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden xl:table-cell">
                        <div className="flex items-center gap-1.5 text-surface-400 text-xs whitespace-nowrap">
                          <Clock className="h-3 w-3" />
                          {timeAgo(lead.createdAt)}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setSelectedLead(lead)}
                            className="p-1.5 rounded-md hover:bg-surface-100 text-surface-400 hover:text-primary-600 transition-colors"
                            title="عرض التفاصيل"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => { setEditingLead({ ...lead }); setSelectedLead(lead); }}
                            className="p-1.5 rounded-md hover:bg-surface-100 text-surface-400 hover:text-surface-600 transition-colors"
                            title="تعديل"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {currentUserRole !== "COORDINATOR" && (
                          <button
                            onClick={() => setShowDeleteConfirm(lead.id)}
                            className="p-1.5 rounded-md hover:bg-danger-50 text-surface-400 hover:text-danger-500 transition-colors"
                            title="حذف"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* عرض Kanban */}
      {viewMode === "kanban" && filteredLeads.length > 0 && (
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
          {stages.map((stage) => {
            const stageLeads = filteredLeads.filter(
              (l) => l.stage?.id === stage.id
            );
            return (
              <div key={stage.id} className="min-w-[280px] w-[280px] shrink-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="text-sm font-semibold text-surface-700">{stage.name}</span>
                  <span className="text-xs bg-surface-100 text-surface-500 rounded-full px-2 py-0.5 ms-auto">
                    {stageLeads.length}
                  </span>
                </div>

                <div className="space-y-2">
                  {stageLeads.map((lead) => (
                    <div
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs bg-primary-50 text-primary-700">
                              {getInitials(lead.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-surface-900" title={lead.name}>
                              {lead.name.length > 30 ? lead.name.slice(0, 30) + "…" : lead.name}
                            </p>
                            {lead.source && (
                              <div className="flex items-center gap-1 text-xs text-surface-400" title={lead.source.name}>
                                <Megaphone className="h-3 w-3 shrink-0" />
                                <span>{lead.source.name.length > 20 ? lead.source.name.slice(0, 20) + "…" : lead.source.name}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <span
                          className="w-2 h-2 rounded-full mt-1"
                          style={{ backgroundColor: PRIORITY_COLORS[lead.priority] }}
                          title={PRIORITY_LABELS[lead.priority]}
                        />
                      </div>

                      <div className="flex items-center gap-3 text-xs text-surface-500 mt-3">
                        {lead.phone && (
                          <div className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            <span dir="ltr">{lead.phone}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1 ms-auto text-surface-400">
                          <Clock className="h-3 w-3" />
                          {timeAgo(lead.createdAt)}
                        </div>
                      </div>
                    </div>
                  ))}

                  {stageLeads.length === 0 && (
                    <div className="text-center py-8 text-xs text-surface-400 border-2 border-dashed border-surface-200 rounded-xl">
                      لا يوجد عملاء
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================================ */}
      {/* نافذة تفاصيل العميل (Side Panel) */}
      {/* ================================ */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => { setSelectedLead(null); setEditingLead(null); setShowFollowUp(false); }}
          />

          {/* Panel */}
          <div className="relative ms-auto w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl animate-slide-in-right">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-surface-100 p-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-surface-900">
                {editingLead ? "تعديل العميل" : "تفاصيل العميل"}
              </h2>
              <div className="flex items-center gap-2">
                {!editingLead && (
                  <>
                    <button
                      onClick={() => setEditingLead({ ...selectedLead })}
                      className="p-2 rounded-md hover:bg-surface-100 text-surface-500 transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {currentUserRole !== "COORDINATOR" && (
                    <button
                      onClick={() => setShowDeleteConfirm(selectedLead.id)}
                      className="p-2 rounded-md hover:bg-danger-50 text-surface-500 hover:text-danger-500 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    )}
                  </>
                )}
                <button
                  onClick={() => { setSelectedLead(null); setEditingLead(null); setShowFollowUp(false); }}
                  className="p-2 rounded-md hover:bg-surface-100 text-surface-500 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-6">
              {editingLead ? (
                // ---- وضع التعديل ----
                <>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>الاسم</Label>
                      <Input
                        value={editingLead.name}
                        onChange={(e) => setEditingLead((p) => p ? { ...p, name: e.target.value } : p)}
                        autoFocus
                        maxLength={80}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>الهاتف</Label>
                      <Input
                        value={editingLead.phone || ""}
                        onChange={(e) => setEditingLead((p) => p ? { ...p, phone: e.target.value } : p)}
                        dir="ltr"
                        className="text-left"
                        maxLength={20}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>البريد الإلكتروني</Label>
                      <Input
                        value={(editingLead as LeadData & { email?: string }).email || ""}
                        onChange={(e) => setEditingLead((p) => p ? { ...p, email: e.target.value } : p)}
                        dir="ltr"
                        className="text-left"
                        type="email"
                        maxLength={100}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>الأولوية</Label>
                      <div className="flex gap-1.5">
                        {(["LOW", "MEDIUM", "HIGH", "URGENT"] as const).map((p) => (
                          <button
                            key={p}
                            onClick={() => setEditingLead((prev) => prev ? { ...prev, priority: p } : prev)}
                            className={cn(
                              "px-3 py-1.5 text-xs rounded-lg border transition-colors",
                              editingLead.priority === p
                                ? "font-semibold"
                                : "border-surface-200 text-surface-500"
                            )}
                            style={
                              editingLead.priority === p
                                ? { color: PRIORITY_COLORS[p], borderColor: PRIORITY_COLORS[p], backgroundColor: `${PRIORITY_COLORS[p]}10` }
                                : undefined
                            }
                          >
                            {PRIORITY_LABELS[p]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleUpdateLead} disabled={isPending} className="flex-1">
                      {isPending ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Check className="h-4 w-4 me-1" />}
                      حفظ التعديلات
                    </Button>
                    <Button variant="ghost" onClick={() => setEditingLead(null)}>إلغاء</Button>
                  </div>
                </>
              ) : (
                // ---- وضع العرض ----
                <>
                  {/* معلومات أساسية */}
                  <div className="flex items-center gap-4">
                    <Avatar className="h-14 w-14">
                      <AvatarFallback className="text-lg bg-primary-50 text-primary-700">
                        {getInitials(selectedLead.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="text-xl font-bold text-surface-900">{selectedLead.name}</h3>
                      {selectedLead.source && (
                        <p className="text-sm text-surface-500 flex items-center gap-1">
                          <Megaphone className="h-3.5 w-3.5" />
                          {selectedLead.source.name}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* بيانات التواصل */}
                  <div className="space-y-3">
                    {selectedLead.phone && (
                      <div className="flex items-center gap-3 p-3 bg-surface-50 rounded-lg">
                        <Phone className="h-4 w-4 text-surface-500" />
                        <span className="text-sm" dir="ltr">{selectedLead.phone}</span>
                        <a
                          href={`https://wa.me/${selectedLead.phone.replace(/[^0-9]/g, "")}`}
                          target="_blank"
                          className="ms-auto text-xs text-success-600 hover:text-success-700 font-medium"
                        >
                          واتساب →
                        </a>
                      </div>
                    )}
                    {selectedLead.email && (
                      <div className="flex items-center gap-3 p-3 bg-surface-50 rounded-lg">
                        <Mail className="h-4 w-4 text-surface-500" />
                        <span className="text-sm" dir="ltr">{selectedLead.email}</span>
                      </div>
                    )}
                  </div>

                  {/* المرحلة والأولوية */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-surface-50 rounded-lg">
                      <p className="text-xs text-surface-500 mb-1">المرحلة</p>
                      <StageDropdown
                        stages={stages}
                        currentStage={selectedLead.stage}
                        onSelect={(stageId) => {
                          handleChangeStage(selectedLead.id, stageId);
                          const stage = stages.find((s) => s.id === stageId);
                          setSelectedLead((p) => p ? { ...p, stage: stage || null } : p);
                        }}
                        disabled={isPending}
                      />
                    </div>
                    <div className="p-3 bg-surface-50 rounded-lg">
                      <p className="text-xs text-surface-500 mb-1">الأولوية</p>
                      <span
                        className="text-sm font-semibold"
                        style={{ color: PRIORITY_COLORS[selectedLead.priority] }}
                      >
                        {PRIORITY_LABELS[selectedLead.priority]}
                      </span>
                    </div>
                  </div>

                  {/* المنسق والتاريخ */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-surface-50 rounded-lg">
                      <p className="text-xs text-surface-500 mb-1">المنسق</p>
                      {currentUserRole !== "COORDINATOR" ? (
                        <select
                          value={selectedLead.assignedUser?.id || ""}
                          onChange={(e) => handleAssignLead(selectedLead.id, e.target.value)}
                          className="w-full h-7 text-sm rounded border border-surface-200 bg-white px-2"
                          disabled={isPending}
                        >
                          <option value="">غير معيّن</option>
                          {teamMembers.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      ) : selectedLead.assignedUser ? (
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-surface-500" />
                          <span className="text-sm">{selectedLead.assignedUser.name}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-surface-400">غير معيّن</span>
                      )}
                    </div>
                    <div className="p-3 bg-surface-50 rounded-lg">
                      <p className="text-xs text-surface-500 mb-1">تاريخ الإضافة</p>
                      <div className="flex items-center gap-1.5 text-sm">
                        <Clock className="h-3.5 w-3.5 text-surface-500" />
                        {timeAgo(selectedLead.createdAt)}
                      </div>
                    </div>
                  </div>

                  {/* التصنيفات */}
                  {availableTags.length > 0 && (
                    <div className="p-3 bg-surface-50 rounded-lg">
                      <p className="text-xs text-surface-500 mb-2">التصنيفات</p>
                      <div className="flex flex-wrap gap-1.5">
                        {availableTags.map((tag) => {
                          const isActive = leadTags.some((t) => t.id === tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={() => handleToggleTag(selectedLead.id, tag.id)}
                              disabled={isPending}
                              className={cn(
                                "px-2.5 py-1 text-xs rounded-full border transition-all",
                                isActive
                                  ? "font-semibold shadow-sm"
                                  : "border-surface-200 text-surface-500 hover:border-surface-300"
                              )}
                              style={
                                isActive
                                  ? { backgroundColor: `${tag.color}20`, color: tag.color, borderColor: tag.color }
                                  : undefined
                              }
                            >
                              {tag.name}
                              {isActive && " ✓"}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* إضافة متابعة */}
                  <div className="border-t border-surface-100 pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-surface-800 flex items-center gap-1.5">
                        <MessageSquare className="h-4 w-4" />
                        سجل المتابعات
                        {followUpsList.length > 0 && (
                          <span className="bg-surface-100 text-surface-500 rounded-full px-2 py-0.5 text-xs">
                            {followUpsList.length}
                          </span>
                        )}
                      </h4>
                      {!showFollowUp && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowFollowUp(true)}
                        >
                          <Plus className="h-3.5 w-3.5 me-1" />
                          إضافة
                        </Button>
                      )}
                    </div>

                    {/* نموذج الإضافة */}
                    {showFollowUp && (
                      <div className="space-y-3 p-4 bg-primary-50/30 rounded-lg border border-primary-200 mb-4">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-semibold">متابعة جديدة</Label>
                          <button onClick={() => setShowFollowUp(false)}>
                            <X className="h-4 w-4 text-surface-400" />
                          </button>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {FOLLOW_UP_TYPES.map((t) => (
                            <button
                              key={t.value}
                              onClick={() => setFollowUpType(t.value)}
                              className={cn(
                                "px-3 py-1 text-xs rounded-lg border transition-colors",
                                followUpType === t.value
                                  ? "bg-primary-50 text-primary-700 border-primary-200"
                                  : "border-surface-200 text-surface-500 bg-white"
                              )}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                        <textarea
                          value={followUpNotes}
                          onChange={(e) => setFollowUpNotes(e.target.value)}
                          placeholder="ملاحظات المتابعة..."
                          className="w-full p-3 border border-surface-200 rounded-lg text-sm resize-none h-20 bg-white"
                          autoFocus
                          maxLength={500}
                        />
                        <span className="text-[10px] text-surface-400 text-left block">{followUpNotes.length}/500</span>

                        {/* جدولة */}
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => setFollowUpScheduled(!followUpScheduled)}
                            className={cn(
                              "flex items-center gap-2 text-xs px-3 py-2 rounded-lg border transition-all w-full",
                              followUpScheduled
                                ? "bg-warning-50 text-warning-700 border-warning-200"
                                : "bg-white text-surface-500 border-surface-200 hover:border-surface-300"
                            )}
                          >
                            <CalendarClock className="h-3.5 w-3.5" />
                            {followUpScheduled ? "جدولة متابعة مستقبلية" : "جدولة لوقت لاحق"}
                          </button>
                          {followUpScheduled && (
                            <div className="flex gap-2 animate-fade-in">
                              <Input
                                type="date"
                                value={followUpDate}
                                onChange={(e) => setFollowUpDate(e.target.value)}
                                min={new Date().toISOString().split("T")[0]}
                                className="flex-1 text-sm"
                                dir="ltr"
                              />
                              <Input
                                type="time"
                                value={followUpTime}
                                onChange={(e) => setFollowUpTime(e.target.value)}
                                className="w-28 text-sm"
                                dir="ltr"
                                placeholder="09:00"
                              />
                            </div>
                          )}
                        </div>

                        <Button
                          onClick={handleAddFollowUp}
                          disabled={!followUpNotes.trim() || isPending || (followUpScheduled && !followUpDate)}
                          size="sm"
                          className="w-full"
                        >
                          {isPending ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : followUpScheduled ? <CalendarClock className="h-4 w-4 me-1" /> : <Check className="h-4 w-4 me-1" />}
                          {followUpScheduled ? "جدولة المتابعة" : "حفظ المتابعة"}
                        </Button>
                      </div>
                    )}

                    {/* سجل المتابعات */}
                    {loadingFollowUps ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-surface-400" />
                      </div>
                    ) : (
                      <>
                        {/* الملاحظات المثبتة */}
                        {followUpsList.filter((fu) => fu.type === "NOTE").length > 0 && (
                          <div className="space-y-2 mb-4">
                            <h5 className="text-xs font-semibold text-surface-500 flex items-center gap-1">
                              📌 ملاحظات مثبتة
                            </h5>
                            {followUpsList
                              .filter((fu) => fu.type === "NOTE")
                              .map((fu) => (
                                <div
                                  key={fu.id}
                                  className="p-3 bg-warning-50/40 rounded-lg border border-warning-200/50"
                                >
                                  <p className="text-sm text-surface-700 whitespace-pre-wrap">
                                    {fu.notes}
                                  </p>
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <span className="text-[10px] text-surface-400">{timeAgo(fu.createdAt)}</span>
                                    {fu.user && (
                                      <span className="text-[10px] text-surface-400 flex items-center gap-1 ms-auto">
                                        <User className="h-2.5 w-2.5" />
                                        {fu.user.name}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                          </div>
                        )}

                        {/* المتابعات الفعلية */}
                        {followUpsList.filter((fu) => fu.type !== "NOTE").length > 0 ? (
                          <div className="space-y-3">
                            {followUpsList
                              .filter((fu) => fu.type !== "NOTE")
                              .map((fu) => {
                                const typeInfo = FOLLOW_UP_TYPES.find((t) => t.value === fu.type);
                                const typeIcon = {
                                  CALL: Phone,
                                  WHATSAPP: MessageSquare,
                                  EMAIL: Mail,
                                  MESSAGE: MessageSquare,
                                  MEETING: User,
                                }[fu.type] || MessageSquare;
                                const IconComp = typeIcon;
                                return (
                                  <div
                                    key={fu.id}
                                    className="flex gap-3 p-3 bg-surface-50 rounded-lg border border-surface-100"
                                  >
                                    <div className="w-8 h-8 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center shrink-0 mt-0.5">
                                      <IconComp className="h-4 w-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="outline" className="text-xs">
                                          {typeInfo?.label || fu.type}
                                        </Badge>
                                        <span className="text-xs text-surface-400">
                                          {timeAgo(fu.createdAt)}
                                        </span>
                                        {fu.user && (
                                          <span className="text-xs text-surface-400 ms-auto flex items-center gap-1">
                                            <User className="h-3 w-3" />
                                            {fu.user.name}
                                          </span>
                                        )}
                                      </div>
                                      {fu.notes && (
                                        <p className="text-sm text-surface-700 whitespace-pre-wrap">
                                          {fu.notes}
                                        </p>
                                      )}
                                      {fu.scheduledAt && (
                                        <div className="flex items-center gap-1.5 mt-1 text-xs text-warning-600 bg-warning-50 rounded px-2 py-1 w-fit">
                                          <CalendarClock className="h-3 w-3" />
                                          مجدول: {new Date(fu.scheduledAt).toLocaleDateString("ar-SA", { day: "numeric", month: "short", year: "numeric" })}
                                          {new Date(fu.scheduledAt).getHours() !== 0 && ` — ${new Date(fu.scheduledAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}`}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        ) : followUpsList.length === 0 ? (
                          <div className="text-center py-6 text-surface-400 text-sm">
                            <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
                            لا توجد متابعات بعد
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================ */}
      {/* تأكيد الحذف */}
      {/* ================================ */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4 animate-fade-in">
            <div className="text-center">
              <div className="w-12 h-12 bg-danger-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="h-6 w-6 text-danger-500" />
              </div>
              <h3 className="text-lg font-bold text-surface-900 mb-2">حذف العميل؟</h3>
              <p className="text-sm text-surface-500 mb-6">
                سيتم حذف هذا العميل من القائمة. يمكنك استعادته لاحقاً.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => handleDeleteLead(showDeleteConfirm)}
                  disabled={isPending}
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Trash2 className="h-4 w-4 me-1" />}
                  نعم، احذف
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={() => setShowDeleteConfirm(null)}
                >
                  إلغاء
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* نافذة الاستيراد */}
      {showImport && (
        <Suspense fallback={null}>
          <ImportDialog
            onClose={() => setShowImport(false)}
            onComplete={(created) => {
              setShowImport(false);
              if (created > 0) {
                window.location.reload();
              }
            }}
          />
        </Suspense>
      )}

      {/* نافذة الحجز */}
      {bookingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setBookingModal(null)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 mx-4 animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-surface-900">
                📅 حجز موعد — {bookingModal.leadName}
              </h3>
              <button
                onClick={() => setBookingModal(null)}
                className="p-1 rounded-lg hover:bg-surface-100"
              >
                <X className="h-5 w-5 text-surface-400" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>تاريخ ووقت الموعد *</Label>
                <Input
                  type="datetime-local"
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  dir="ltr"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>الخدمة *</Label>
                <Input
                  value={bookingService}
                  onChange={(e) => setBookingService(e.target.value)}
                  placeholder="مثال: تنظيف أسنان، فحص عيون..."
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label>ملاحظات (اختياري)</Label>
                <Input
                  value={bookingNotes}
                  onChange={(e) => setBookingNotes(e.target.value)}
                  placeholder="أي ملاحظات إضافية..."
                  maxLength={250}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleBookingConfirm}
                  disabled={!bookingDate || !bookingService.trim() || isPending}
                  className="flex-1"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <CalendarClock className="h-4 w-4 me-1" />
                      تأكيد الحجز
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={() => setBookingModal(null)}>
                  إلغاء
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================
// Stage Dropdown Component
// =============================================

function StageDropdown({
  stages,
  currentStage,
  onSelect,
  disabled,
}: {
  stages: StageData[];
  currentStage: StageData | null;
  onSelect: (stageId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useCallback(
    (node: HTMLButtonElement | null) => {
      if (node && open) {
        const rect = node.getBoundingClientRect();
        setMenuPos({ top: rect.bottom + 4, left: rect.left });
      }
    },
    [open]
  );
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
          disabled ? "opacity-60" : "hover:opacity-80 cursor-pointer"
        )}
        style={
          currentStage
            ? {
                backgroundColor: `${currentStage.color}15`,
                color: currentStage.color,
              }
            : { backgroundColor: "#f1f5f9", color: "#64748b" }
        }
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: currentStage?.color || "#94a3b8" }}
        />
        {currentStage?.name || "غير محدد"}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[101] bg-white rounded-lg shadow-lg border border-surface-200 py-1 min-w-[160px]"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {stages.map((stage) => (
              <button
                key={stage.id}
                onClick={() => {
                  onSelect(stage.id);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-50 transition-colors text-start",
                  currentStage?.id === stage.id && "bg-surface-50 font-medium"
                )}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: stage.color }}
                />
                {stage.name}
                {currentStage?.id === stage.id && (
                  <Check className="h-3.5 w-3.5 ms-auto text-primary-600" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
