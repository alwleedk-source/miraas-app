"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Copy,
  Check,
  Loader2,
  Trash2,
  CheckCircle2,
  XCircle,
  Key,
  Code2,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Users,
  AlertTriangle,
} from "lucide-react";
import { createWebhookKey, deleteWebhook, toggleWebhook, toggleWebhookWelcome, updateWebhookWelcomeTemplate, setWebhookCoordinators } from "@/app/actions/settings";

interface Webhook {
  id: string;
  // secretKey يكون null للـ webhooks الجديدة (hash-only)، موجود للبيانات القديمة فقط
  secretKey: string | null;
  label: string | null;
  isActive: boolean;
  sendWelcome: boolean;
  welcomeTemplateName: string | null;
  coordinatorIds: string[]; // فارغ = مرئية لكل المنسقين (السلوك الافتراضي)
  lastReceivedAt: Date | null;
  createdAt: Date;
}

interface Coordinator {
  id: string;
  name: string;
}

interface Props {
  webhooks: Webhook[];
  appUrl: string;
  availableCoordinators: Coordinator[];
}

function generateScript(appUrl: string, secretKey: string, campaignName: string) {
  return `function onFormSubmit(e) {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  var data = {
    name: sheet.getRange(lastRow, 1).getValue(),
    phone: sheet.getRange(lastRow, 2).getValue(),
    campaign: "${campaignName}",
    joinedAt: new Date().toISOString()
  };
  
  UrlFetchApp.fetch("${appUrl}/api/webhook/leads", {
    method: "POST",
    contentType: "application/json",
    headers: { "x-webhook-secret": "${secretKey}" },
    payload: JSON.stringify(data)
  });
}`;
}

export default function WebhookActions({ webhooks, appUrl, availableCoordinators }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [editingCoords, setEditingCoords] = useState<string | null>(null);
  const [draftCoords, setDraftCoords] = useState<Set<string>>(new Set());
  // عداد الأحرف للـ label الجديد عند الإنشاء
  const [newLabelLen, setNewLabelLen] = useState(0);

  const handleSaveCoords = (webhookId: string) => {
    startTransition(async () => {
      await setWebhookCoordinators({
        webhookId,
        userIds: Array.from(draftCoords),
      });
      setEditingCoords(null);
      setDraftCoords(new Set());
    });
  };

  const startEditCoords = (webhook: Webhook) => {
    setEditingCoords(webhook.id);
    setDraftCoords(new Set(webhook.coordinatorIds));
  };

  const toggleDraftCoord = (id: string) => {
    setDraftCoords((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCreate = (formData: FormData) => {
    const label = formData.get("label") as string;
    startTransition(async () => {
      await createWebhookKey(label || undefined);
      setShowCreate(false);
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("هل تريد حذف هذا المفتاح؟")) return;
    startTransition(async () => {
      await deleteWebhook(id);
    });
  };

  const handleToggle = (id: string) => {
    startTransition(async () => {
      await toggleWebhook(id);
    });
  };

  const handleToggleWelcome = (id: string) => {
    startTransition(async () => {
      await toggleWebhookWelcome(id);
    });
  };

  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [templateInput, setTemplateInput] = useState("");

  const handleSaveTemplate = (id: string) => {
    const value = templateInput.trim();
    startTransition(async () => {
      await updateWebhookWelcomeTemplate(id, value || null);
      setEditingTemplate(null);
      setTemplateInput("");
    });
  };

  return (
    <div className="space-y-4">
      {/* قائمة المفاتيح */}
      {webhooks.map((wh) => {
        const campaignName = wh.label || "حملتي الإعلانية";
        // للـ webhooks الجديدة (hash-only) السر لا يُخزَّن plaintext
        // يظهر فقط مرة واحدة عند الإنشاء في newlyCreated state
        const displaySecret = wh.secretKey ?? "••• السر مخفي لأمانك (احفظه عند الإنشاء) •••";
        const canCopy = !!wh.secretKey;
        const script = generateScript(appUrl, wh.secretKey ?? "", campaignName);
        const isExpanded = expandedCode === wh.id;

        return (
          <div
            key={wh.id}
            className="rounded-xl border border-surface-200 hover:border-surface-300 transition-colors overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-primary-500" />
                  <span className="text-sm font-medium text-surface-900">
                    {wh.label || "Webhook"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={wh.isActive ? "success" : "outline"}
                    className="cursor-pointer"
                    onClick={() => handleToggle(wh.id)}
                  >
                    {wh.isActive ? (
                      <>
                        <CheckCircle2 className="h-3 w-3 me-1" />
                        نشط
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3 me-1" />
                        معطّل
                      </>
                    )}
                  </Badge>
                  <button
                    onClick={() => handleDelete(wh.id)}
                    className="p-1 rounded hover:bg-danger-50 text-surface-400 hover:text-danger-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Secret Key */}
              <div className="flex items-center gap-2">
                <div className="flex-1 p-2.5 bg-surface-50 rounded-lg border border-surface-200 font-mono text-xs text-surface-600 overflow-x-auto" dir="ltr">
                  {displaySecret}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => canCopy && handleCopy(wh.secretKey!, `key-${wh.id}`)}
                  className="shrink-0"
                  disabled={!canCopy}
                  title={canCopy ? "نسخ المفتاح" : "السر مخفي — أعد التوليد إذا احتجته"}
                >
                  {copied === `key-${wh.id}` ? (
                    <Check className="h-4 w-4 text-success-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {/* URL + Welcome toggle + last received */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-surface-400" dir="ltr">{appUrl}/api/webhook/leads</span>
                {wh.lastReceivedAt && (
                  <span className="text-surface-400">آخر استقبال: {new Date(wh.lastReceivedAt).toLocaleDateString("ar-SA")}</span>
                )}
              </div>

              {/* Welcome toggle */}
              <button
                onClick={() => handleToggleWelcome(wh.id)}
                className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-xs transition-colors ${
                  wh.sendWelcome
                    ? "bg-success-50/50 border-success-200 text-success-700"
                    : "bg-surface-50 border-surface-200 text-surface-500"
                }`}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span className="font-medium">رسالة ترحيب واتساب تلقائية</span>
                </div>
                <Badge variant={wh.sendWelcome ? "success" : "outline"} className="text-[10px]">
                  {wh.sendWelcome ? "مفعّل" : "معطّل"}
                </Badge>
              </button>
              {wh.sendWelcome && (
                <>
                  <p className="text-[11px] text-surface-400 -mt-1 px-1">
                    ⚡ تُرسل فقط للعملاء الجدد من فورم حقيقي (عميل واحد). الدفع الجماعي لا يُرسل ترحيب.
                  </p>

                  {/* قالب ترحيب مخصّص لهذه الحملة (override الافتراضي) */}
                  <div className="rounded-lg border border-primary-100 bg-primary-50/30 p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-primary-700 flex items-center gap-1">
                        <Code2 className="h-3 w-3" />
                        قالب ترحيب خاص بهذه الحملة
                      </span>
                      {wh.welcomeTemplateName && editingTemplate !== wh.id && (
                        <Badge variant="outline" className="text-[9px] border-primary-300 text-primary-700">
                          {wh.welcomeTemplateName}
                        </Badge>
                      )}
                    </div>

                    {editingTemplate === wh.id ? (
                      <div className="flex gap-1.5">
                        <Input
                          value={templateInput}
                          onChange={(e) => setTemplateInput(e.target.value)}
                          placeholder="مثال: welcome_eyes_clinic (اتركه فارغاً للافتراضي)"
                          dir="ltr"
                          className="text-left font-mono text-xs h-8 flex-1"
                          maxLength={255}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={() => handleSaveTemplate(wh.id)}
                          disabled={isPending}
                          className="h-8 text-xs"
                        >
                          حفظ
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setEditingTemplate(null); setTemplateInput(""); }}
                          className="h-8 text-xs"
                        >
                          إلغاء
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingTemplate(wh.id);
                          setTemplateInput(wh.welcomeTemplateName ?? "");
                        }}
                        className="w-full text-start text-[11px] text-primary-600 hover:text-primary-800 hover:underline"
                      >
                        {wh.welcomeTemplateName
                          ? `✏️ تغيير القالب الخاص (الحالي: ${wh.welcomeTemplateName})`
                          : "➕ استخدم قالب مخصّص لهذه الحملة (افتراضي: قالب الإعدادات العام)"}
                      </button>
                    )}
                    <p className="text-[10px] text-primary-600/70 leading-relaxed">
                      مفيد لمن يدير عيادات/تخصصات متعدّدة — كل حملة برسالة مناسبة لجمهورها.
                      اسم القالب يجب أن يكون معتمداً من Meta أولاً.
                    </p>
                  </div>
                </>
              )}

              {/* تخصيص المنسقين — يقيّد رؤية leads هذه الحملة */}
              <div className={`rounded-lg border p-2.5 space-y-2 ${
                wh.coordinatorIds.length === 0
                  ? "border-warning-200 bg-warning-50/40"
                  : "border-surface-200 bg-surface-50/50"
              }`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold text-surface-700 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    المنسقون المسؤولون عن هذه الحملة
                  </span>
                  {wh.coordinatorIds.length === 0 ? (
                    <Badge variant="outline" className="text-[9px] border-warning-300 text-warning-700 bg-warning-50">
                      <AlertTriangle className="h-2.5 w-2.5 me-1" />
                      الكل يرى
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px]">
                      {wh.coordinatorIds.length} منسق
                    </Badge>
                  )}
                </div>

                {editingCoords === wh.id ? (
                  <div className="space-y-2">
                    {availableCoordinators.length === 0 ? (
                      <p className="text-[11px] text-surface-500">
                        لا منسقين بعد —{" "}
                        <a href="/team" className="text-primary-600 underline">أضف فريق العمل</a>
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                        {availableCoordinators.map((c) => {
                          const checked = draftCoords.has(c.id);
                          return (
                            <label
                              key={c.id}
                              className={`flex items-center gap-2 p-1.5 rounded cursor-pointer text-xs transition-colors ${
                                checked ? "bg-primary-100 text-primary-800" : "bg-white hover:bg-surface-50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleDraftCoord(c.id)}
                                className="rounded"
                              />
                              <span className="truncate">{c.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => handleSaveCoords(wh.id)}
                        disabled={isPending}
                        className="h-8 text-xs"
                      >
                        حفظ ({draftCoords.size})
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setEditingCoords(null); setDraftCoords(new Set()); }}
                        className="h-8 text-xs"
                      >
                        إلغاء
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {wh.coordinatorIds.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {wh.coordinatorIds.map((id) => {
                          const c = availableCoordinators.find((x) => x.id === id);
                          return (
                            <Badge
                              key={id}
                              variant="outline"
                              className="text-[10px] border-primary-200 bg-primary-50 text-primary-700"
                            >
                              {c?.name ?? "منسق محذوف"}
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                    <button
                      onClick={() => startEditCoords(wh)}
                      className="w-full text-start text-[11px] text-primary-600 hover:text-primary-800 hover:underline"
                    >
                      {wh.coordinatorIds.length === 0
                        ? "➕ خصّص منسقاً (أو أكثر) ليرى عملاء هذه الحملة فقط"
                        : "✏️ تعديل المنسقين"}
                    </button>
                  </>
                )}

                <p className="text-[10px] text-surface-500 leading-relaxed">
                  {wh.coordinatorIds.length === 0
                    ? "حالياً كل المنسقين يرون عملاء هذه الحملة. خصّص منسقاً ليرى وحده."
                    : "فقط المنسقون المختارون يرون عملاء هذه الحملة. الباقون لا يرونها."}
                </p>
              </div>

              {/* زر عرض الكود الجاهز */}
              <button
                onClick={() => setExpandedCode(isExpanded ? null : wh.id)}
                className="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-primary-50 text-primary-700 text-xs font-medium hover:bg-primary-100 transition-colors"
              >
                <Code2 className="h-3.5 w-3.5" />
                {isExpanded ? "إخفاء الكود الجاهز" : "👈 الكود الجاهز — انسخه والصقه في Apps Script"}
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>

            {/* الكود الجاهز للنسخ */}
            {isExpanded && (
              <div className="border-t border-surface-200 bg-surface-900 p-4 animate-fade-in">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-surface-300">كود جاهز للنسخ</span>
                    <Badge variant="outline" className="text-[10px] border-success-500/30 text-success-400">
                      ✅ المفتاح + اسم الحملة + التاريخ
                    </Badge>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(script, `code-${wh.id}`)}
                    className="text-xs border-surface-600 text-surface-300 hover:bg-surface-800 hover:text-white"
                  >
                    {copied === `code-${wh.id}` ? (
                      <>
                        <Check className="h-3.5 w-3.5 me-1 text-success-400" />
                        تم النسخ!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 me-1" />
                        نسخ الكود
                      </>
                    )}
                  </Button>
                </div>
                <pre className="text-xs text-surface-100 overflow-x-auto leading-relaxed whitespace-pre" dir="ltr">
                  <code>{script}</code>
                </pre>

                <div className="mt-3 p-3 rounded-lg bg-surface-800/50 border border-surface-700">
                  <p className="text-[11px] text-surface-400 leading-relaxed">
                    <strong className="text-warning-400">⚡ الخطوات:</strong>{" "}
                    افتح Google Sheet → Extensions → Apps Script → احذف الكود الموجود → الصق هذا الكود → اضغط 💾 Save → اذهب لـ Triggers → أضف trigger من نوع <code className="bg-surface-700 px-1 rounded text-[10px]">On form submit</code>
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* حالة فارغة */}
      {webhooks.length === 0 && !showCreate && (
        <div className="text-center py-8 text-surface-400 text-sm space-y-2">
          <Key className="h-8 w-8 mx-auto text-surface-300" />
          <p>لا توجد مفاتيح — أنشئ أول مفتاح للبدء</p>
          <p className="text-xs text-surface-300">سيتم إنشاء كود Apps Script جاهز لكل مفتاح تلقائياً</p>
        </div>
      )}

      {/* نموذج إنشاء */}
      {showCreate ? (
        <form action={handleCreate} className="p-4 bg-primary-50/30 rounded-xl border border-primary-200 animate-fade-in space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Plus className="h-4 w-4 text-primary-600" />
            <span className="text-sm font-semibold text-surface-900">مفتاح جديد</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="wh-label">اسم الحملة / المصدر</Label>
              <span
                className={`text-[10px] tabular-nums ${
                  newLabelLen > 50 ? "text-warning-600 font-semibold" : "text-surface-400"
                }`}
              >
                {newLabelLen} / 60
              </span>
            </div>
            <Input
              id="wh-label"
              name="label"
              placeholder="مثال: حملة رمضان - فيسبوك"
              autoFocus
              maxLength={60}
              onChange={(e) => setNewLabelLen(e.target.value.length)}
            />
            <p className="text-[11px] text-surface-400">
              اسم قصير وواضح — يظهر في الكود وفي قوائم العملاء (60 حرف كحد أقصى)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={isPending} className="flex-1">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Key className="h-4 w-4 me-1" />}
              إنشاء المفتاح + الكود
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              إلغاء
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" onClick={() => setShowCreate(true)} className="w-full">
          <Plus className="h-4 w-4" />
          إنشاء مفتاح جديد
        </Button>
      )}
    </div>
  );
}
