"use client";

import { useState, useEffect, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Key,
  Phone,
  Send,
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
  ExternalLink,
  Check,
  AlertTriangle,
  FileText,
  Globe,
  Braces,
  Plus,
  X,
  Shield,
  Lightbulb,
  BookOpen,
  Zap,
  CircleAlert,
  CheckCheck,
  CalendarDays,
} from "lucide-react";
import { getWhatsappConfig, saveWhatsappConfig, saveWhatsappApiKey, testWhatsappConnectionAction } from "@/app/actions/settings";

const AVAILABLE_PARAMS = [
  { value: "name", label: "اسم العميل", example: "أحمد" },
  { value: "phone", label: "رقم الهاتف", example: "0500000000" },
  { value: "company", label: "اسم الشركة", example: "شركة ABC" },
];

export default function WhatsAppSettingsPage() {
  const [isPending, startTransition] = useTransition();
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState("");

  // بيانات الربط — Meta Cloud API مباشرة
  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false); // مفتاح محفوظ مسبقاً
  const [testPhone, setTestPhone] = useState(""); // رقم هاتف لاستقبال رسالة الاختبار

  // بيانات القالب
  const [templateName, setTemplateName] = useState("");
  const [templateLanguage, setTemplateLang] = useState("ar");
  const [templateParams, setTemplateParams] = useState<string[]>(["name"]);

  // قالب التذكير بالحجوزات
  const [reminderTemplateName, setReminderTemplateName] = useState("");
  const [reminderEvening, setReminderEvening] = useState(true);
  const [reminderMorning, setReminderMorning] = useState(true);

  // دليل نصائح القوالب
  const [showGuide, setShowGuide] = useState(false);

  // جلب الإعدادات الحالية
  useEffect(() => {
    getWhatsappConfig()
      .then((config) => {
        if (config) {
          setPhoneNumberId(config.phoneNumber || "");
          setIsConnected(config.isActive || false);
          if (config.apiKeyEncrypted) {
            setAccessToken("••••••••••");
            setHasStoredKey(true);
          }
          setTemplateName(config.templateName || "");
          setTemplateLang(config.templateLanguage || "ar");
          setTemplateParams((config.templateParams as string[]) || ["name"]);
          setReminderTemplateName((config as Record<string, unknown>).reminderTemplateName as string || "");
          if ((config as Record<string, unknown>).reminderEvening !== undefined) setReminderEvening((config as Record<string, unknown>).reminderEvening as boolean);
          if ((config as Record<string, unknown>).reminderMorning !== undefined) setReminderMorning((config as Record<string, unknown>).reminderMorning as boolean);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveConfig = () => {
    setError("");
    if (!phoneNumberId.trim()) {
      setError("أدخل Phone Number ID من Meta Business Manager");
      return;
    }
    // تحقق: لو لا مفتاح محفوظ سابقاً، يجب إدخال واحد جديد
    const hasNewKey = !!accessToken && !accessToken.startsWith("••");
    if (!hasStoredKey && !hasNewKey) {
      setError("أدخل Access Token من Meta — لا يمكن التفعيل بدونه");
      return;
    }
    startTransition(async () => {
      try {
        if (hasNewKey) {
          await saveWhatsappApiKey(accessToken);
          setHasStoredKey(true);
        }
        await saveWhatsappConfig({
          provider: "meta",
          phoneNumber: phoneNumberId,
          isActive: true, // آمن: نضمن وجود مفتاح بسبب التحقق أعلاه
        });
        setSaved(true);
        setIsConnected(true);
        setTimeout(() => setSaved(false), 2000);
      } catch {
        setError("فشل في حفظ الإعدادات");
      }
    });
  };

  const handleSaveTemplate = () => {
    setError("");
    if (!templateName.trim()) {
      setError("أدخل اسم القالب المعتمد من Meta");
      return;
    }
    startTransition(async () => {
      try {
        await saveWhatsappConfig({
          templateName, templateLanguage, templateParams,
          reminderTemplateName: reminderTemplateName || undefined,
          reminderEvening,
          reminderMorning,
        });
        setTemplateSaved(true);
        setTimeout(() => setTemplateSaved(false), 2000);
      } catch {
        setError("فشل في حفظ إعدادات القالب");
      }
    });
  };

  const handleTest = () => {
    if (!testPhone.trim()) {
      setTestResult("❌ أدخل رقم هاتف لاستقبال رسالة الاختبار");
      return;
    }
    setTesting(true);
    setTestResult(null);
    startTransition(async () => {
      try {
        const result = await testWhatsappConnectionAction(testPhone);
        if (result.success) {
          setTestResult(`✅ أُرسلت! تحقّق من واتساب على ${testPhone}`);
        } else {
          setTestResult(`❌ ${result.error || "فشل الإرسال"}`);
        }
      } catch {
        setTestResult("❌ فشل في الاتصال بالخادم");
      } finally {
        setTesting(false);
      }
    });
  };

  const addParam = (param: string) => {
    if (!templateParams.includes(param)) {
      setTemplateParams([...templateParams, param]);
    }
  };

  const removeParam = (index: number) => {
    setTemplateParams(templateParams.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-surface-900">إعدادات واتساب</h1>
        <p className="text-surface-500 mt-1">ربط واتساب الأعمال عبر Meta Cloud API مباشرة — بدون وسيط</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-50 text-danger-600 text-sm border border-danger-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* حالة الربط */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${isConnected ? "bg-success-50" : "bg-surface-100"}`}>
              <MessageSquare className={`h-6 w-6 ${isConnected ? "text-success-600" : "text-surface-400"}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-surface-900">Meta Cloud API</h3>
                {isConnected ? (
                  <Badge variant="success">
                    <CheckCircle2 className="h-3 w-3 ml-1" />
                    متصل
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    <XCircle className="h-3 w-3 ml-1" />
                    غير مربوط
                  </Badge>
                )}
              </div>
              <p className="text-sm text-surface-500 mt-1">
                {isConnected
                  ? "الرسائل التلقائية مفعّلة عبر Template Messages"
                  : "أدخل بيانات Meta ثم القالب المعتمد للبدء"}
              </p>
            </div>
            <Badge variant="outline" className="text-xs shrink-0">
              <Zap className="h-3 w-3 me-1" />
              مجاني — بدون وسيط
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* =============================================
          الخطوة 1: بيانات الربط
          ============================================= */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-5 w-5 text-primary-500" />
            الخطوة 1: ربط Meta Cloud API
          </CardTitle>
          <CardDescription>
            أدخل بيانات حسابك من Meta Business Manager — العميل يدفع رسوم الرسائل مباشرة لـ Meta
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* كيف تحصل على البيانات */}
          <div className="p-3 rounded-lg bg-primary-50 border border-primary-200">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-primary-600 mt-0.5 shrink-0" />
              <div className="text-sm text-primary-700">
                <p className="font-medium mb-1.5">كيف تحصل على البيانات؟</p>
                <ol className="list-decimal list-inside space-y-1 text-primary-600">
                  <li>افتح <strong>Meta Business Manager</strong></li>
                  <li>اذهب إلى <strong>WhatsApp → API Setup</strong></li>
                  <li>انسخ <strong>Phone Number ID</strong> (رقم طويل)</li>
                  <li>أنشئ <strong>Access Token</strong> (أو استخدم Permanent Token)</li>
                  <li>الصقهما هنا وفعّل الربط</li>
                </ol>
                <a
                  href="https://business.facebook.com/wa/manage/phone-numbers/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-primary-700 font-medium hover:underline"
                >
                  فتح Meta Business Manager
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phoneNumberId" className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-surface-400" />
              Phone Number ID
            </Label>
            <Input
              id="phoneNumberId"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="مثال: 123456789012345"
              dir="ltr"
              className="text-left font-mono"
              maxLength={30}
            />
            <p className="text-[11px] text-surface-400">
              هذا <strong>ليس</strong> رقم الهاتف — تجده في Meta Business Manager → WhatsApp → API Setup
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="accessToken" className="flex items-center gap-1.5">
              <Key className="h-3.5 w-3.5 text-surface-400" />
              Access Token
            </Label>
            <Input
              id="accessToken"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="أدخل Access Token من Meta"
              dir="ltr"
              className="text-left font-mono"
            />
            <p className="text-[11px] text-surface-400">
              يُحفظ مشفراً — ننصح باستخدام <strong>System User Token</strong> (دائم) بدلاً من Token المؤقت
            </p>
          </div>

          <Button onClick={handleSaveConfig} disabled={isPending}>
            {isPending && !testing ? (
              <><Loader2 className="h-4 w-4 animate-spin me-1" /> جاري الحفظ...</>
            ) : saved ? (
              <><Check className="h-4 w-4 me-1" /> تم الحفظ</>
            ) : (
              "حفظ بيانات الربط"
            )}
          </Button>

          {/* اختبار الإرسال — يحتاج رقم هاتف حقيقي (Phone Number ID ليس رقم هاتف!) */}
          {hasStoredKey && templateName && (
            <div className="pt-3 mt-3 border-t border-surface-100 space-y-2">
              <Label htmlFor="testPhone" className="flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5 text-surface-400" />
                اختبار الإرسال (يُرسل قالب الترحيب لرقم تحدّده)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="testPhone"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="مثال: 0551234567 أو +966551234567"
                  dir="ltr"
                  className="text-left font-mono flex-1"
                  maxLength={20}
                />
                <Button variant="outline" onClick={handleTest} disabled={testing || !testPhone.trim()}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 me-1" /> أرسل</>}
                </Button>
              </div>
              <p className="text-[11px] text-surface-400">
                ضع رقمك الشخصي لتستقبل القالب وتتحقّق من نجاح الربط
              </p>
            </div>
          )}

          {testResult && (
            <div className={`p-3 rounded-lg text-sm ${
              testResult.startsWith("✅")
                ? "bg-success-50 text-success-700 border border-success-200"
                : "bg-danger-50 text-danger-700 border border-danger-200"
            }`}>
              {testResult}
            </div>
          )}
        </CardContent>
      </Card>

      {/* =============================================
          الخطوة 2: قالب الرسالة
          ============================================= */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary-500" />
            الخطوة 2: قالب الترحيب (Template Message)
          </CardTitle>
          <CardDescription>
            أدخل اسم القالب المعتمد من Meta — يجب إنشاؤه واعتماده أولاً في Meta Business Manager
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* لماذا Template */}
          <div className="p-3 rounded-lg bg-warning-50 border border-warning-200">
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-warning-600 mt-0.5 shrink-0" />
              <div className="text-sm text-warning-700">
                <p className="font-medium mb-1">⚠️ لماذا Template وليس نص حر؟</p>
                <p className="text-warning-600 leading-relaxed">
                  واتساب يمنع إرسال رسائل نصية حرة لعملاء لم يراسلوك من قبل.
                  لذلك يجب إنشاء <strong>Template Message</strong> في Meta Business Manager واعتماده أولاً، ثم إدخال اسمه هنا.
                </p>
                <a
                  href="https://business.facebook.com/wa/manage/message-templates/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-warning-700 font-medium hover:underline"
                >
                  إنشاء Template في Meta
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>

          {/* اسم القالب */}
          <div className="space-y-2">
            <Label htmlFor="templateName" className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-surface-400" />
              اسم القالب المعتمد
            </Label>
            <Input
              id="templateName"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="مثال: welcome_lead"
              dir="ltr"
              className="text-left font-mono"
              maxLength={50}
            />
            <p className="text-[11px] text-surface-400">
              هذا هو الاسم الذي أدخلته عند إنشاء القالب — مثل <code className="bg-surface-100 px-1 rounded">welcome_lead</code> أو <code className="bg-surface-100 px-1 rounded">new_customer_greeting</code>
            </p>
          </div>

          {/* لغة القالب */}
          <div className="space-y-2">
            <Label htmlFor="templateLang" className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-surface-400" />
              لغة القالب
            </Label>
            <select
              id="templateLang"
              value={templateLanguage}
              onChange={(e) => setTemplateLang(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-surface-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="ar">العربية (ar)</option>
              <option value="en">English (en)</option>
              <option value="en_US">English US (en_US)</option>
            </select>
          </div>

          {/* متغيرات القالب */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Braces className="h-3.5 w-3.5 text-surface-400" />
              متغيرات القالب (Parameters)
            </Label>
            <p className="text-[11px] text-surface-400 -mt-1">
              {`رتّب المتغيرات بنفس ترتيب {{1}}, {{2}}, {{3}} في القالب`}
            </p>

            <div className="space-y-2">
              {templateParams.map((param, index) => {
                const paramInfo = AVAILABLE_PARAMS.find(p => p.value === param);
                return (
                  <div key={index} className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-50 border border-surface-200">
                    <span className="text-xs font-mono bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full shrink-0">
                      {`{{${index + 1}}}`}
                    </span>
                    <span className="text-sm flex-1 text-surface-700">
                      {paramInfo?.label || param}
                    </span>
                    <span className="text-[11px] text-surface-400 font-mono">
                      {paramInfo?.example || ""}
                    </span>
                    <button
                      onClick={() => removeParam(index)}
                      className="p-1 rounded hover:bg-danger-50 text-surface-400 hover:text-danger-500 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              {AVAILABLE_PARAMS.filter(p => !templateParams.includes(p.value)).map(p => (
                <button
                  key={p.value}
                  onClick={() => addParam(p.value)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-surface-300 text-xs text-surface-500 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50/50 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* معاينة */}
          {templateName && (
            <div className="p-3 rounded-lg bg-surface-900 border border-surface-700">
              <p className="text-[11px] text-surface-400 mb-2 font-medium">معاينة طلب API:</p>
              <pre className="text-xs text-surface-200 overflow-x-auto leading-relaxed" dir="ltr">
{JSON.stringify({
  messaging_product: "whatsapp",
  to: "966500000000",
  type: "template",
  template: {
    name: templateName,
    language: { code: templateLanguage },
    components: templateParams.length > 0 ? [{
      type: "body",
      parameters: templateParams.map((p) => {
        const info = AVAILABLE_PARAMS.find(x => x.value === p);
        return { type: "text", text: info?.example || "" };
      })
    }] : undefined,
  }
}, null, 2)}
              </pre>
            </div>
          )}

          <Button onClick={handleSaveTemplate} disabled={isPending}>
            {templateSaved ? (
              <><Check className="h-4 w-4 me-1" /> تم الحفظ</>
            ) : (
              "حفظ إعدادات القالب"
            )}
          </Button>

          {/* ============================
              استراتيجية التذكير بالحجوزات
              ============================ */}
          <div className="pt-4 mt-4 border-t border-surface-200 space-y-4">
            <div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-success-500" />
                <h4 className="font-semibold text-sm text-surface-900">استراتيجية تذكير الحجوزات</h4>
              </div>
              <p className="text-xs text-surface-500 mt-1">
                يُرسل تلقائياً للعميل عبر واتساب قبل موعده — مبني على دراسات تقلل عدم الحضور بنسبة 39%
              </p>
            </div>

            {/* خطوات التفعيل */}
            <div className="p-3 rounded-lg bg-primary-50 border border-primary-200 text-xs text-primary-700 space-y-2">
              <p className="font-bold">📌 خطوات التفعيل:</p>
              <ol className="list-decimal list-inside space-y-1.5 text-primary-600">
                <li>
                  ادخل{" "}
                  <a href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noopener noreferrer" className="font-bold underline hover:text-primary-800">
                    Meta Business Manager
                  </a>
                  {" "}→ أنشئ Template جديد من نوع <strong>Utility</strong>
                </li>
                <li>سمّه <code className="bg-primary-100 px-1 rounded">booking_reminder</code> — الموافقة عادةً <strong>دقائق إلى ساعات</strong> (راجع &quot;دليل القبول السريع&quot; أدناه)</li>
                <li>بعد الموافقة → اكتب اسم القالب في الحقل أدناه واختر استراتيجيتك</li>
              </ol>
            </div>

            {/* اسم القالب */}
            <div className="space-y-1.5">
              <Label className="text-xs">اسم القالب المعتمد من Meta</Label>
              <Input
                value={reminderTemplateName}
                onChange={(e) => setReminderTemplateName(e.target.value)}
                placeholder="أدخل اسم القالب بعد موافقة Meta عليه"
                dir="ltr"
                className="text-left font-mono"
                maxLength={50}
              />
            </div>

            {/* تحذير */}
            <div className="p-2.5 rounded-lg bg-warning-50 border border-warning-200 text-xs text-warning-700">
              <p>⚠️ <strong>مهم:</strong> لن تُرسل التذكيرات إلا بعد إنشاء القالب في Meta والموافقة عليه. اسم قالب خاطئ → كل محاولة تُسجَّل في <a href="/settings/errors" className="underline font-medium">سجل الأخطاء</a>.</p>
            </div>

            {/* استراتيجية التذكير — toggles */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-surface-700">متى يُرسل التذكير؟</p>

              {/* تذكير مسائي */}
              <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                reminderEvening
                  ? "border-primary-300 bg-primary-50/50"
                  : "border-surface-200 bg-white hover:border-surface-300"
              }`}>
                <input
                  type="checkbox"
                  checked={reminderEvening}
                  onChange={(e) => setReminderEvening(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-10 h-5 rounded-full relative transition-colors ${
                  reminderEvening ? "bg-primary-500" : "bg-surface-300"
                }`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                    reminderEvening ? "right-0.5" : "left-0.5"
                  }`} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-surface-900">🌙 تذكير مسائي — اليوم السابق</p>
                  <p className="text-[11px] text-surface-500">يُرسل الساعة 8 مساءً لتذكير العميل بموعد الغد</p>
                </div>
              </label>

              {/* تذكير صباحي */}
              <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                reminderMorning
                  ? "border-primary-300 bg-primary-50/50"
                  : "border-surface-200 bg-white hover:border-surface-300"
              }`}>
                <input
                  type="checkbox"
                  checked={reminderMorning}
                  onChange={(e) => setReminderMorning(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-10 h-5 rounded-full relative transition-colors ${
                  reminderMorning ? "bg-primary-500" : "bg-surface-300"
                }`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                    reminderMorning ? "right-0.5" : "left-0.5"
                  }`} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-surface-900">☀️ تذكير صباحي — يوم الموعد</p>
                  <p className="text-[11px] text-surface-500">يُرسل الساعة 8 صباحاً لتذكير العميل بموعد اليوم</p>
                </div>
              </label>

              {/* معلومة */}
              <div className="p-2 rounded-lg bg-surface-50 border border-surface-100 text-[11px] text-surface-500">
                📊 <strong>بحسب الدراسات:</strong> التذكير المزدوج (مسائي + صباحي) يقلل حالات عدم الحضور بنسبة تصل إلى 39% مقارنة بتذكير واحد.
              </div>
            </div>

            {/* المتغيرات */}
            <div className="p-2.5 bg-success-50/50 rounded-lg border border-success-200 text-xs text-success-700">
              <p className="font-medium mb-1">📋 المتغيرات المطلوبة في القالب:</p>
              <p dir="rtl">{`{{1}}`} = اسم العميل &nbsp;|&nbsp; {`{{2}}`} = تاريخ ووقت الموعد &nbsp;|&nbsp; {`{{3}}`} = الخدمة</p>
            </div>

            {/* مثال نص القالب */}
            <div className="p-2.5 bg-surface-50 rounded-lg border border-surface-200 text-xs" dir="rtl">
              <p className="text-surface-400 text-[10px] mb-1 font-medium">مثال نص القالب (انسخه عند الإنشاء):</p>
              <p className="text-surface-700 leading-relaxed">
                {`مرحباً {{1}} 👋`}<br />
                {`تذكير بموعدك {{2}} — {{3}}`}<br />
                نتطلع لرؤيتك!
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* =============================================
          دليل نصائح القبول السريع للقوالب
          ============================================= */}
      <Card>
        <CardHeader>
          <button
            onClick={() => setShowGuide(!showGuide)}
            className="w-full text-start"
          >
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-success-500" />
              دليل القبول السريع للقوالب
              <Badge variant="success" className="text-[10px] ms-auto">
                {showGuide ? "إخفاء" : "عرض النصائح"}
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              نصائح ذهبية لضمان موافقة Meta على قالبك في دقائق وليس ساعات
            </CardDescription>
          </button>
        </CardHeader>

        {showGuide && (
          <CardContent className="space-y-4 animate-fade-in">

            {/* 1. اختر التصنيف الصحيح */}
            <div className="p-4 rounded-xl bg-gradient-to-l from-emerald-50 to-teal-50 border border-emerald-200">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm">1</div>
                <div>
                  <h4 className="font-bold text-surface-900 text-sm mb-1">اختر التصنيف الصحيح</h4>
                  <p className="text-sm text-surface-600 leading-relaxed">
                    أهم سبب للرفض هو التصنيف الخاطئ. اختر بدقة:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                    <div className="p-2 bg-white rounded-lg border border-surface-100 text-xs">
                      <span className="font-bold text-emerald-600">Utility ✅</span>
                      <p className="text-surface-500 mt-0.5">رسائل ترحيب، تأكيد، إشعارات</p>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-surface-100 text-xs">
                      <span className="font-bold text-blue-600">Marketing 📢</span>
                      <p className="text-surface-500 mt-0.5">عروض، تخفيضات، حملات ترويجية</p>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-surface-100 text-xs">
                      <span className="font-bold text-violet-600">Authentication 🔐</span>
                      <p className="text-surface-500 mt-0.5">رموز تحقق OTP فقط</p>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-surface-100 text-xs">
                      <span className="font-bold text-amber-600">Service 🛎️</span>
                      <p className="text-surface-500 mt-0.5">ردود على استفسارات العملاء</p>
                    </div>
                  </div>
                  <div className="mt-2 p-2 bg-emerald-100/60 rounded-lg">
                    <p className="text-xs text-emerald-700">
                      <strong>💡 لمِراس:</strong> رسالة الترحيب بعميل جديد = <strong>Utility</strong> (ليست Marketing)
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. محتوى واضح ومحترف */}
            <div className="p-4 rounded-xl bg-gradient-to-l from-blue-50 to-indigo-50 border border-blue-200">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">2</div>
                <div>
                  <h4 className="font-bold text-surface-900 text-sm mb-1">اكتب محتوى واضح ومحترف</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                    <div className="p-2 bg-success-50 rounded-lg border border-success-200 text-xs">
                      <p className="font-bold text-success-700 mb-1">✅ صحيح</p>
                      <p className="text-surface-600 leading-relaxed" dir="rtl">
                        {`مرحباً {{1}}، شكراً لتواصلك معنا. سيقوم فريقنا بالتواصل معك قريباً لمساعدتك.`}
                      </p>
                    </div>
                    <div className="p-2 bg-danger-50 rounded-lg border border-danger-200 text-xs">
                      <p className="font-bold text-danger-700 mb-1">❌ خاطئ</p>
                      <p className="text-surface-600 leading-relaxed" dir="rtl">
                        عرض حصري!!! اشترك الآن واحصل على خصم 50%!!! لا تفوت الفرصة 🔥🔥🔥
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. ضع قيم واقعية للمتغيرات */}
            <div className="p-4 rounded-xl bg-gradient-to-l from-amber-50 to-orange-50 border border-amber-200">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-sm">3</div>
                <div>
                  <h4 className="font-bold text-surface-900 text-sm mb-1">ضع قيم واقعية للمتغيرات عند الإنشاء</h4>
                  <p className="text-sm text-surface-600 leading-relaxed">
                    {`عند إنشاء القالب، Meta تطلب "Sample Values" لكل متغير. لا تتركها فارغة!`}
                  </p>
                  <div className="mt-2 p-2 bg-white rounded-lg border border-surface-100">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-surface-100">
                          <th className="text-start py-1 text-surface-400">المتغير</th>
                          <th className="text-start py-1 text-surface-400">القيمة النموذجية</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-surface-50">
                          <td className="py-1 font-mono text-primary-600">{`{{1}}`}</td>
                          <td className="py-1 text-surface-700">أحمد محمد</td>
                        </tr>
                        <tr className="border-b border-surface-50">
                          <td className="py-1 font-mono text-primary-600">{`{{2}}`}</td>
                          <td className="py-1 text-surface-700">شركة النخبة للعقارات</td>
                        </tr>
                        <tr>
                          <td className="py-1 font-mono text-primary-600">{`{{3}}`}</td>
                          <td className="py-1 text-surface-700">0500000000</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. تجنب الكلمات المحظورة */}
            <div className="p-4 rounded-xl bg-gradient-to-l from-red-50 to-rose-50 border border-red-200">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-700 font-bold text-sm">4</div>
                <div>
                  <h4 className="font-bold text-surface-900 text-sm mb-1">تجنب الكلمات والأساليب المحظورة</h4>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {["أحرف كبيرة كثيرة", "!!! علامات تعجب", "🔥🔥 إيموجي مبالغ", "\"مجاناً\" أو \"حصري\"", "ضغط نفسي", "روابط مختصرة", "محتوى مضلل"].map((w) => (
                      <Badge key={w} variant="danger" className="text-xs">{w}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 5. أضف خيار إلغاء الاشتراك */}
            <div className="p-4 rounded-xl bg-gradient-to-l from-violet-50 to-purple-50 border border-violet-200">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 font-bold text-sm">5</div>
                <div>
                  <h4 className="font-bold text-surface-900 text-sm mb-1">أضف خيار إلغاء الاشتراك (للتسويق)</h4>
                  <p className="text-sm text-surface-600 leading-relaxed">
                    إذا كان القالب من نوع <strong>Marketing</strong>، يجب أن يحتوي على طريقة لإلغاء الاشتراك:
                  </p>
                  <div className="mt-2 p-2 bg-white rounded-lg border border-violet-100 text-xs text-surface-600" dir="rtl">
                    <p>إذا لم تعد ترغب في استلام رسائلنا، أرسل &quot;إلغاء&quot;</p>
                  </div>
                  <p className="text-xs text-violet-600 mt-1.5">
                    <strong>ملاحظة:</strong> قوالب Utility (مثل الترحيب) لا تحتاج هذا عادةً
                  </p>
                </div>
              </div>
            </div>

            {/* 6. اسم القالب بالإنجليزية وحروف صغيرة */}
            <div className="p-4 rounded-xl bg-gradient-to-l from-cyan-50 to-sky-50 border border-cyan-200">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-700 font-bold text-sm">6</div>
                <div>
                  <h4 className="font-bold text-surface-900 text-sm mb-1">اسم القالب بالإنجليزية وحروف صغيرة</h4>
                  <p className="text-sm text-surface-600 leading-relaxed">
                    Meta تشترط أن يكون اسم القالب بالإنجليزية مع <code className="bg-surface-100 px-1 rounded">_</code> بدلاً من المسافات:
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="p-2 bg-success-50 rounded-lg text-xs text-center">
                      <p className="text-success-700 font-mono font-bold">welcome_lead ✅</p>
                    </div>
                    <div className="p-2 bg-danger-50 rounded-lg text-xs text-center">
                      <p className="text-danger-700 font-mono font-bold">Welcome Lead ❌</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 7. مواعيد الموافقة */}
            <div className="p-4 rounded-xl bg-gradient-to-l from-slate-50 to-gray-50 border border-slate-200">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-sm">7</div>
                <div>
                  <h4 className="font-bold text-surface-900 text-sm mb-1">مواعيد الموافقة المتوقعة</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                    <div className="p-2 bg-white rounded-lg border border-surface-100 text-center">
                      <p className="text-lg font-bold text-success-600">1-5 دقائق</p>
                      <p className="text-[11px] text-surface-400">قالب يلتزم بالشروط</p>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-surface-100 text-center">
                      <p className="text-lg font-bold text-warning-600">حتى 24 ساعة</p>
                      <p className="text-[11px] text-surface-400">مراجعة يدوية</p>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-surface-100 text-center">
                      <p className="text-lg font-bold text-danger-600">حتى 72 ساعة</p>
                      <p className="text-[11px] text-surface-400">حالات نادرة</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 8. مثال قالب جاهز */}
            <div className="p-4 rounded-xl bg-gradient-to-l from-green-50 to-emerald-50 border-2 border-emerald-300">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold text-sm">
                  <Lightbulb className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-surface-900 text-sm mb-1">مثال قالب ترحيب جاهز للنسخ ✨</h4>
                  <p className="text-xs text-surface-500 mb-2">استخدم هذا عند إنشاء القالب في Meta Business Manager:</p>
                  <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                    <div className="p-2 bg-white rounded-lg border border-surface-100">
                      <p className="text-surface-400">اسم القالب:</p>
                      <p className="font-mono font-bold text-surface-900">welcome_lead</p>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-surface-100">
                      <p className="text-surface-400">التصنيف:</p>
                      <p className="font-bold text-emerald-600">Utility</p>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-surface-100">
                      <p className="text-surface-400">اللغة:</p>
                      <p className="font-bold text-surface-900">Arabic (ar)</p>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-surface-100">
                      <p className="text-surface-400">المتغيرات:</p>
                      <p className="font-mono font-bold text-primary-600">{`{{1}}`} = اسم العميل</p>
                    </div>
                  </div>
                  <div className="p-3 bg-white rounded-lg border-2 border-dashed border-emerald-300" dir="rtl">
                    <p className="text-sm text-surface-800 leading-relaxed">
                      {`مرحباً {{1}} 👋`}
                    </p>
                    <p className="text-sm text-surface-800 leading-relaxed mt-1">
                      شكراً لتواصلك معنا. استلمنا طلبك وسيقوم أحد ممثلينا بالتواصل معك في أقرب وقت لمساعدتك.
                    </p>
                    <p className="text-sm text-surface-800 leading-relaxed mt-1">
                      إذا كان لديك أي استفسار عاجل، لا تتردد في الرد على هذه الرسالة.
                    </p>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <CheckCheck className="h-4 w-4 text-emerald-500" />
                    <p className="text-xs text-emerald-700 font-medium">
                      هذا القالب يُقبل عادةً في أقل من 5 دقائق
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </CardContent>
        )}
      </Card>

      {/* معلومات التكلفة */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-surface-50">
              <CircleAlert className="h-5 w-5 text-surface-400" />
            </div>
            <div className="text-sm text-surface-600">
              <p className="font-semibold text-surface-900 mb-1">عن التكاليف</p>
              <ul className="space-y-1 text-surface-500">
                <li className="flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-success-500 shrink-0" />
                  <span>مِراس <strong>لا يتقاضى</strong> أي رسوم على رسائل واتساب</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-success-500 shrink-0" />
                  <span>الربط عبر <strong>Meta Cloud API</strong> مجاني — بدون وسيط أو اشتراك إضافي</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <CircleAlert className="h-3 w-3 text-warning-500 shrink-0 mt-0.5" />
                  <span>قوالب الترحيب والتذكير = <strong>Utility messages</strong> — لها تسعير لكل دولة (السعودية ~٢٫٥ هللة/رسالة). تُدفع لـ Meta مباشرة.</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Check className="h-3 w-3 text-success-500 shrink-0 mt-0.5" />
                  <span>المحادثات التي يبدأها العميل (Service) أرخص — أول <strong>1,000 شهرياً مجانية</strong> من Meta لكنها لا تشمل قوالبك</span>
                </li>
              </ul>
              <a
                href="https://developers.facebook.com/docs/whatsapp/pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-primary-600 font-medium hover:underline text-xs"
              >
                تفاصيل أسعار Meta
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
