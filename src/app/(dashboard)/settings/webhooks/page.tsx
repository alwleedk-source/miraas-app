import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Webhook,
  ExternalLink,
} from "lucide-react";
import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { getWebhookKeys } from "@/app/actions/settings";
import { db } from "@/db";
import { users, webhookCoordinators, webhookEndpoints } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
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

  // جلب كل المنسقين النشطين (للـ picker) + خريطة assignments لكل webhook
  let coordinators: { id: string; name: string }[] = [];
  let assignmentsByWebhook = new Map<string, string[]>();
  try {
    coordinators = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.isActive, true),
          eq(users.role, "COORDINATOR"),
        ),
      )
      .orderBy(asc(users.name));

    // كل assignments بـ JOIN واحد (يستثني cross-tenant بـ webhookEndpoints filter)
    const allAssignments = await db
      .select({
        webhookId: webhookCoordinators.webhookId,
        userId: webhookCoordinators.userId,
      })
      .from(webhookCoordinators)
      .innerJoin(
        webhookEndpoints,
        eq(webhookEndpoints.id, webhookCoordinators.webhookId),
      )
      .where(eq(webhookEndpoints.tenantId, tenantId));

    assignmentsByWebhook = allAssignments.reduce((acc, a) => {
      const arr = acc.get(a.webhookId) ?? [];
      arr.push(a.userId);
      acc.set(a.webhookId, arr);
      return acc;
    }, new Map<string, string[]>());
  } catch {
    // ignore — ميزة الـ coordinators تعمل بدون هذا (عرض فارغ)
  }

  // اربط assignments بكل webhook
  const webhooksWithCoords = webhooks.map((w) => ({
    ...w,
    coordinatorIds: assignmentsByWebhook.get(w.id) ?? [],
  }));

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
          <WebhookActions
            webhooks={webhooksWithCoords}
            appUrl={appUrl}
            availableCoordinators={coordinators}
          />
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
