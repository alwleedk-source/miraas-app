import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Webhook,
  ExternalLink,
} from "lucide-react";
import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { getWebhookKeys } from "@/app/actions/settings";
import WebhookActions from "./webhook-actions";

export default async function WebhooksSettingsPage() {
  const { tenantId } = await requireTenant();
  if (!tenantId) redirect("/register");

  let webhooks: Awaited<ReturnType<typeof getWebhookKeys>> = [];
  try {
    webhooks = await getWebhookKeys();
  } catch {
    // ignore
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-surface-900">الويب هوك</h1>
        <p className="text-surface-500 mt-1">
          ربط Google Sheets لاستقبال العملاء تلقائياً
        </p>
      </div>

      {/* مفاتيح الويب هوك */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Webhook className="h-5 w-5 text-primary-500" />
            مفاتيح الاستقبال
          </CardTitle>
          <CardDescription>
            أنشئ مفتاح ويب هوك لكل مصدر — الكود الجاهز سيظهر تلقائياً مع المفتاح الصحيح
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <WebhookActions webhooks={webhooks} appUrl={appUrl} />
        </CardContent>
      </Card>

      {/* دليل سريع */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">كيف تربط Google Sheets؟</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="space-y-3 text-sm text-surface-700">
            <li className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
              <span>أنشئ مفتاح ويب هوك من الأعلى <strong>بإسم الحملة</strong></span>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
              <span>اضغط <strong>&quot;الكود الجاهز&quot;</strong> ثم <strong>&quot;نسخ الكود&quot;</strong> — المفتاح واسم الحملة مضمّنين تلقائياً ✅</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</span>
              <span>افتح Google Sheet → <strong>الإضافات → برمجة التطبيقات</strong> → امسح الكود الموجود والصق كود مِراس واحفظ</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">4</span>
              <span>من القائمة الجانبية اضغط ⏰ <strong>عوامل التفعيل</strong> → إضافة مشغّل → الدالة: <strong>onFormSubmit</strong> → مصدر الحدث: <strong>من جدول البيانات</strong> → نوع الحدث: <strong>عند التعديل</strong></span>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">5</span>
              <span>اضغط <strong>حفظ</strong> ← وافق على الأذونات ← <strong>جاهز!</strong> كل صف جديد سيُرسل تلقائياً 🎉</span>
            </li>
          </ol>

          <a
            href="https://developers.google.com/apps-script/guides/triggers"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline mt-2"
          >
            دليل Google Apps Script التفصيلي
            <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
