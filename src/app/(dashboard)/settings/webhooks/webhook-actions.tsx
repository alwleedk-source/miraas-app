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
} from "lucide-react";
import { createWebhookKey, deleteWebhook, toggleWebhook, toggleWebhookWelcome } from "@/app/actions/settings";

interface Webhook {
  id: string;
  secretKey: string;
  label: string | null;
  isActive: boolean;
  sendWelcome: boolean;
  lastReceivedAt: Date | null;
  createdAt: Date;
}

interface Props {
  webhooks: Webhook[];
  appUrl: string;
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

export default function WebhookActions({ webhooks, appUrl }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      {/* قائمة المفاتيح */}
      {webhooks.map((wh) => {
        const campaignName = wh.label || "حملتي الإعلانية";
        const script = generateScript(appUrl, wh.secretKey, campaignName);
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
                  {wh.secretKey}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleCopy(wh.secretKey, `key-${wh.id}`)}
                  className="shrink-0"
                  title="نسخ المفتاح"
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
                <p className="text-[11px] text-surface-400 -mt-1 px-1">
                  ⚡ تُرسل فقط للعملاء الجدد من فورم حقيقي (عميل واحد). الدفع الجماعي لا يُرسل ترحيب.
                </p>
              )}

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
            <Label htmlFor="wh-label">اسم الحملة / المصدر</Label>
            <Input id="wh-label" name="label" placeholder="مثال: حملة رمضان - فيسبوك" autoFocus maxLength={50} />
            <p className="text-[11px] text-surface-400">
              هذا الاسم سيظهر في الكود الجاهز كاسم الحملة تلقائياً
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
