"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search, RefreshCw, ArrowLeft, ArrowRight, Loader2, Ban,
  CheckCircle2, X, Clock, MessageCircle, Phone,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ARCHIVE_REASONS } from "@/lib/archive-reasons";
import { unarchiveLead, bulkReactivateLeads } from "@/app/actions/archive";
import { toTelUrl, toWhatsappUrl } from "@/lib/utils";

type ArchivedLeadRow = {
  id: string;
  name: string;
  phone: string | null;
  archivedAt: Date | null;
  archiveReason: string | null;
  archiveNote: string | null;
  reactivateAt: Date | null;
  canRecontact: boolean;
  assignedUserName: string | null;
  sourceName: string | null;
  stageName: string | null;
};

type Props = {
  initialData: ArchivedLeadRow[];
  total: number;
  page: number;
  totalPages: number;
  currentReason?: string;
  currentSearch?: string;
  dueOnly?: boolean;
};

function timeAgo(date: Date | string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400_000);
  if (days < 1) return "اليوم";
  if (days === 1) return "أمس";
  if (days < 30) return `منذ ${days} يوم`;
  const months = Math.floor(days / 30);
  if (months < 12) return `منذ ${months} شهر`;
  return `منذ ${Math.floor(months / 12)} سنة`;
}

export default function ArchiveClient({
  initialData,
  total,
  page,
  totalPages,
  currentReason,
  currentSearch,
  dueOnly,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(currentSearch || "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, startBulkTransition] = useTransition();
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const updateSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams);
    if (search.trim()) params.set("q", search.trim());
    else params.delete("q");
    params.delete("page");
    router.push(`/leads/archive?${params.toString()}`);
  };

  const goToPage = (p: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(p));
    router.push(`/leads/archive?${params.toString()}`);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === initialData.length) setSelected(new Set());
    else setSelected(new Set(initialData.map((l) => l.id)));
  };

  const handleSingleReactivate = (id: string, name: string) => {
    startBulkTransition(async () => {
      try {
        await unarchiveLead(id);
        setBulkResult(`✅ تم إعادة تفعيل ${name}`);
        router.refresh();
        setTimeout(() => setBulkResult(null), 3000);
      } catch (e) {
        setBulkResult(`❌ ${e instanceof Error ? e.message : "فشل"}`);
        setTimeout(() => setBulkResult(null), 5000);
      }
    });
  };

  const handleBulkReactivate = () => {
    if (selected.size === 0) return;
    if (!confirm(`أعد تفعيل ${selected.size} عميل؟ سيعودون للـ pipeline.`)) return;

    startBulkTransition(async () => {
      try {
        const result = await bulkReactivateLeads({
          leadIds: Array.from(selected),
          resetStage: true,
        });
        let msg = `✅ تمت إعادة ${result.reactivated} عميل`;
        if (result.dncSkipped > 0) {
          msg += ` (تخطّينا ${result.dncSkipped} طلبوا عدم التواصل)`;
        }
        setBulkResult(msg);
        setSelected(new Set());
        router.refresh();
        setTimeout(() => setBulkResult(null), 5000);
      } catch (e) {
        setBulkResult(`❌ ${e instanceof Error ? e.message : "فشل"}`);
        setTimeout(() => setBulkResult(null), 5000);
      }
    });
  };

  const allSelected = selected.size === initialData.length && initialData.length > 0;

  return (
    <>
      {/* Search + bulk bar */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <form onSubmit={updateSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالاسم أو الجوال..."
                className="ps-9"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">
              بحث
            </Button>
            {(currentSearch || currentReason || dueOnly) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => router.push("/leads/archive")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </form>

          {selected.size > 0 && (
            <div className="flex items-center justify-between p-2 bg-primary-50 rounded-lg border border-primary-100 animate-fade-in">
              <span className="text-xs font-medium text-primary-700">
                ✓ اخترت {selected.size} عميل
              </span>
              <Button
                size="sm"
                onClick={handleBulkReactivate}
                disabled={bulkPending}
                className="h-7"
              >
                {bulkPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3" />
                    أعد تفعيل الكل
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Result toast */}
      {bulkResult && (
        <div className="fixed bottom-4 start-1/2 -translate-x-1/2 bg-surface-900 text-white px-4 py-2 rounded-xl shadow-lg text-sm z-50 animate-fade-in">
          {bulkResult}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-200 bg-surface-50">
                <tr>
                  <th className="p-2 text-start w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={selectAll}
                      className="rounded border-surface-300"
                    />
                  </th>
                  <th className="p-2 text-start text-xs font-semibold text-surface-500">العميل</th>
                  <th className="p-2 text-start text-xs font-semibold text-surface-500 hidden md:table-cell">السبب</th>
                  <th className="p-2 text-start text-xs font-semibold text-surface-500 hidden lg:table-cell">الملاحظة</th>
                  <th className="p-2 text-start text-xs font-semibold text-surface-500 hidden md:table-cell">منذ</th>
                  <th className="p-2 text-start text-xs font-semibold text-surface-500"></th>
                </tr>
              </thead>
              <tbody>
                {initialData.map((lead) => {
                  const reasonInfo = lead.archiveReason
                    ? ARCHIVE_REASONS[lead.archiveReason as keyof typeof ARCHIVE_REASONS]
                    : null;
                  const isDnc = !lead.canRecontact;
                  const isDue =
                    lead.reactivateAt &&
                    new Date(lead.reactivateAt).getTime() <= Date.now();

                  return (
                    <tr key={lead.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selected.has(lead.id)}
                          onChange={() => toggleSelect(lead.id)}
                          disabled={isDnc}
                          className="rounded border-surface-300"
                          title={isDnc ? "DNC — لا يُعاد تفعيله" : ""}
                        />
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-surface-900">{lead.name}</span>
                          {isDnc && (
                            <span className="inline-flex items-center gap-1 text-[10px] bg-danger-50 text-danger-600 px-1.5 py-0.5 rounded-full">
                              <Ban className="h-2.5 w-2.5" />
                              لا تواصل
                            </span>
                          )}
                          {isDue && (
                            <span className="inline-flex items-center gap-1 text-[10px] bg-warning-50 text-warning-700 px-1.5 py-0.5 rounded-full">
                              <Clock className="h-2.5 w-2.5" />
                              وقت العودة
                            </span>
                          )}
                        </div>
                        {lead.phone && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[11px] text-surface-400 font-mono" dir="ltr">
                              {lead.phone}
                            </span>
                            {!isDnc && (
                              <>
                                <a
                                  href={toTelUrl(lead.phone) ?? "#"}
                                  className="text-[10px] text-success-600 hover:text-success-800"
                                  title="اتصال"
                                >
                                  <Phone className="h-3 w-3" />
                                </a>
                                <a
                                  href={toWhatsappUrl(lead.phone) ?? "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-[#25D366] hover:opacity-80"
                                  title="واتساب"
                                >
                                  <MessageCircle className="h-3 w-3" />
                                </a>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-2 hidden md:table-cell">
                        {reasonInfo && (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <span>{reasonInfo.icon}</span>
                            <span className="text-surface-600">{reasonInfo.label}</span>
                          </span>
                        )}
                      </td>
                      <td className="p-2 hidden lg:table-cell">
                        {lead.archiveNote && (
                          <p className="text-xs text-surface-500 max-w-xs truncate" title={lead.archiveNote}>
                            {lead.archiveNote}
                          </p>
                        )}
                      </td>
                      <td className="p-2 hidden md:table-cell">
                        <span className="text-[11px] text-surface-400">
                          {timeAgo(lead.archivedAt)}
                        </span>
                      </td>
                      <td className="p-2">
                        {!isDnc ? (
                          <button
                            onClick={() => handleSingleReactivate(lead.id, lead.name)}
                            disabled={bulkPending}
                            className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 hover:bg-primary-50 px-2 py-1 rounded transition-colors"
                          >
                            <RefreshCw className="h-3 w-3" />
                            <span className="hidden md:inline">إعادة تفعيل</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-surface-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-surface-500">
            صفحة {page.toLocaleString("ar-SA")} من{" "}
            {totalPages.toLocaleString("ar-SA")} • مجموع {total.toLocaleString("ar-SA")} عميل
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              <ArrowRight className="h-4 w-4" />
              السابق
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              التالي
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
