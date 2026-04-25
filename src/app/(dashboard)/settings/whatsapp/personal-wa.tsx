"use client";

import { useState, useEffect, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Key,
  Phone,
  CheckCircle2,
  Loader2,
  Send,
  Check,
  Trash2,
  AlertTriangle,
  Power,
} from "lucide-react";
import {
  getMyWhatsappCredentials,
  saveMyWhatsappCredentials,
  saveMyWhatsappApiKey,
  testMyWhatsappCredentialsAction,
  deleteMyWhatsappCredentials,
} from "@/app/actions/settings";

/**
 * قسم "الواتساب الخاص بي" — كل منسق يربط رقمه في Meta هنا.
 *
 * عند ربط: العميل الذي أُسنِد لهذا المنسق يستلم ترحيب وتذكيرات من رقمه (لا رقم العيادة العام).
 * عند عدم ربط: fallback لـ tenant default — التطبيق يعمل دون كسر.
 */
export default function PersonalWhatsApp() {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [hasCreds, setHasCreds] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [language, setLanguage] = useState("ar");
  const [isActive, setIsActive] = useState(false);
  const [lastTestedAt, setLastTestedAt] = useState<Date | null>(null);
  const [lastTestSuccess, setLastTestSuccess] = useState<boolean | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getMyWhatsappCredentials()
      .then((c) => {
        if (c) {
          setHasCreds(true);
          setHasApiKey(c.hasApiKey);
          setPhoneNumberId(c.phoneNumberId || "");
          setLanguage(c.templateLanguage || "ar");
          setIsActive(c.isActive);
          setLastTestedAt(c.lastTestedAt);
          setLastTestSuccess(c.lastTestSuccess);
          if (c.hasApiKey) setAccessToken("••••••••••");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = () => {
    setError("");
    if (!phoneNumberId.trim()) {
      setError("أدخل Phone Number ID");
      return;
    }
    const hasNewKey = !!accessToken && !accessToken.startsWith("••");
    if (!hasApiKey && !hasNewKey) {
      setError("أدخل Access Token من Meta — لا يمكن التفعيل بدونه");
      return;
    }
    startTransition(async () => {
      try {
        if (hasNewKey) {
          await saveMyWhatsappApiKey(accessToken);
          setHasApiKey(true);
        }
        await saveMyWhatsappCredentials({
          phoneNumberId,
          templateLanguage: language,
          isActive: true,
        });
        setIsActive(true);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "فشل الحفظ");
      }
    });
  };

  const handleToggle = () => {
    startTransition(async () => {
      try {
        await saveMyWhatsappCredentials({ isActive: !isActive });
        setIsActive(!isActive);
      } catch (e) {
        setError(e instanceof Error ? e.message : "فشل التغيير");
      }
    });
  };

  const handleTest = () => {
    if (!testPhone.trim()) {
      setTestResult("❌ أدخل رقم هاتف للاختبار");
      return;
    }
    setTesting(true);
    setTestResult(null);
    startTransition(async () => {
      try {
        const result = await testMyWhatsappCredentialsAction({ testPhone });
        if (result.success) {
          setTestResult(`✅ أُرسلت من رقمك! تحقّق من واتساب على ${testPhone}`);
          setLastTestSuccess(true);
          setLastTestedAt(new Date());
        } else {
          setTestResult(`❌ ${result.error || "فشل الإرسال"}`);
          setLastTestSuccess(false);
        }
      } catch {
        setTestResult("❌ فشل في الاتصال");
      } finally {
        setTesting(false);
      }
    });
  };

  const handleDelete = () => {
    if (!confirm("احذف اعتمادك الخاص؟ ستعود لاستخدام رقم العيادة الموحّد.")) return;
    startTransition(async () => {
      try {
        await deleteMyWhatsappCredentials();
        setHasCreds(false);
        setHasApiKey(false);
        setPhoneNumberId("");
        setAccessToken("");
        setIsActive(false);
        setLastTestedAt(null);
        setLastTestSuccess(null);
      } catch {
        setError("فشل الحذف");
      }
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-surface-300" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={isActive ? "border-success-200" : ""}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-5 w-5 text-primary-500" />
              الواتساب الخاص بي
              {isActive && (
                <Badge variant="success" className="text-[10px]">
                  <CheckCircle2 className="h-2.5 w-2.5 me-1" />
                  مفعّل
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              اربط رقم Meta الخاص بك — العملاء الذين أُسنِدوا لك سيستلمون رسائلك من رقمك (لا رقم العيادة الموحّد).
            </CardDescription>
          </div>
          {hasCreds && (
            <Button variant="ghost" size="sm" onClick={handleDelete} disabled={isPending} className="text-danger-500">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-50 text-danger-700 text-sm border border-danger-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5 text-surface-400" />
            Phone Number ID (من Meta)
          </Label>
          <Input
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            placeholder="مثال: 123456789012345"
            dir="ltr"
            className="text-left font-mono"
            maxLength={30}
          />
          <p className="text-[11px] text-surface-400">
            تجده في Meta Business Manager → WhatsApp → API Setup
          </p>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <Key className="h-3.5 w-3.5 text-surface-400" />
            Access Token
            {hasApiKey && (
              <Badge variant="success" className="text-[9px] ms-1">✓ محفوظ</Badge>
            )}
          </Label>
          <Input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={hasApiKey ? "السر محفوظ — اتركه فارغاً للإبقاء" : "الصق Token من Meta"}
            dir="ltr"
            className="text-left font-mono"
          />
          <p className="text-[11px] text-surface-400">
            يُحفظ مشفّراً بمفتاح خاص بحسابك (لا يُمكن لأي مستخدم آخر فك تشفيره)
          </p>
        </div>

        <div className="space-y-2">
          <Label>لغة القالب</Label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="flex h-9 w-full rounded-lg border border-surface-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="ar">العربية (ar)</option>
            <option value="en">English (en)</option>
            <option value="en_US">English US (en_US)</option>
          </select>
          <p className="text-[11px] text-surface-400">
            يجب أن تطابق لغة القالب المعتمد في Meta
          </p>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : saved ? <Check className="h-4 w-4 me-1" /> : null}
            {saved ? "تم الحفظ" : hasCreds ? "حفظ التغييرات" : "حفظ + تفعيل"}
          </Button>

          {hasCreds && hasApiKey && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggle}
              disabled={isPending}
              className={isActive ? "" : "text-surface-500"}
            >
              <Power className="h-4 w-4 me-1" />
              {isActive ? "تعطيل" : "تفعيل"}
            </Button>
          )}
        </div>

        {/* اختبار */}
        {hasApiKey && phoneNumberId && (
          <div className="pt-3 mt-3 border-t border-surface-100 space-y-2">
            <Label className="flex items-center gap-1.5">
              <Send className="h-3.5 w-3.5 text-surface-400" />
              اختبر الإرسال من رقمك
            </Label>
            <div className="flex gap-2">
              <Input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="مثال: 0551234567"
                dir="ltr"
                className="text-left font-mono flex-1"
                maxLength={20}
              />
              <Button variant="outline" onClick={handleTest} disabled={testing || !testPhone.trim()}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 me-1" /> أرسل</>}
              </Button>
            </div>
            {testResult && (
              <div
                className={`p-2.5 rounded-lg text-xs ${
                  testResult.startsWith("✅")
                    ? "bg-success-50 text-success-700 border border-success-200"
                    : "bg-danger-50 text-danger-700 border border-danger-200"
                }`}
              >
                {testResult}
              </div>
            )}
            {lastTestedAt && (
              <p className="text-[10px] text-surface-400">
                آخر اختبار: {new Date(lastTestedAt).toLocaleString("ar-SA-u-ca-gregory", { timeZone: "Asia/Riyadh" })}
                {lastTestSuccess !== null && (
                  lastTestSuccess
                    ? <span className="text-success-600 me-1"> ✓</span>
                    : <span className="text-danger-600 me-1"> ✗</span>
                )}
              </p>
            )}
          </div>
        )}

        <div className="p-2.5 rounded-lg bg-warning-50 border border-warning-300 text-[11px] text-warning-800 leading-relaxed">
          ⚠️ <strong>مهم:</strong> عندما يُسنَد لك عميل من حملاتك، الترحيب والتذكيرات تُرسَل من <strong>رقمك أنت</strong>.
          العميل يردّ على رقمك مباشرةً → يصلك الردّ على هاتفك.
          <br />
          <strong>لو لم تربط رقمك، عملاؤك لن يستلموا أي ترحيب أو تذكير</strong> (لتجنّب inbox مختلط مع رقم العيادة).
        </div>
      </CardContent>
    </Card>
  );
}
