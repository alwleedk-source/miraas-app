import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { getBackupStatus } from "@/app/actions/backup-settings";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Database, FileSpreadsheet, ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import BackupClient from "./backup-client";

export default async function BackupPage() {
  const { tenantId, role } = await requireTenant();
  if (!tenantId) redirect("/register");
  if (!["OWNER", "ADMIN", "SUPER_ADMIN"].includes(role)) redirect("/");

  const status = await getBackupStatus();

  return (
    <div className="space-y-6 max-w-3xl animate-fade-in">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 mb-2"
        >
          <ArrowRight className="h-3.5 w-3.5" />
          الرجوع للإعدادات
        </Link>
        <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-2">
          <Database className="h-6 w-6 text-success-600" />
          النسخة الاحتياطية في Google Sheet
        </h1>
        <p className="text-surface-500 mt-1 text-sm leading-relaxed">
          بياناتك تُنسخ تلقائياً في Google Sheet خاص بك — كل lead جديد، كل تغيير،
          كل ملاحظة. حتى لو تعطّل Meras، بياناتك آمنة في حسابك أنت.
        </p>
      </div>

      {/* Why this matters — value prop */}
      <Card className="border-2 border-success-200 bg-gradient-to-br from-success-50 to-emerald-50/40">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="shrink-0 p-2 rounded-xl bg-success-100">
              <Sparkles className="h-5 w-5 text-success-700" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-surface-900 mb-1">
                ✨ بياناتك ملكك — Meras مجرد أداة
              </h3>
              <ul className="text-sm text-surface-700 space-y-1 mt-2">
                <li>📂 كل عميل، كل ملاحظة، كل حالة — في Google Sheet خاص بك</li>
                <li>⚡ التحديث فوري — ثانية واحدة من Meras للـ Sheet</li>
                <li>🔒 لا أحد يصل لها سواك — حتى نحن في Meras</li>
                <li>📥 تستطيع تنزيلها كـ Excel أي وقت</li>
                <li>🛡️ لو تعطّل Meras يوماً (بُعد عن الله) — بياناتك معك</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Setup steps */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary-500" />
            خطوات الربط (مرة واحدة فقط — 5 دقائق)
          </CardTitle>
          <CardDescription>اتبع الخطوات بالترتيب</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Step
            num={1}
            title="افتح Google Sheets جديد"
            body="اذهب إلى sheets.google.com وأنشئ ملف جديد، سمّه &quot;نسخة احتياطية مِراس&quot;"
          />

          <Step
            num={2}
            title="افتح Apps Script"
            body="من قائمة الملف: Extensions → Apps Script. ستفتح صفحة جديدة للكود."
          />

          <Step
            num={3}
            title="الصق هذا الكود"
            body="انسخ الكود أدناه والصقه (يستبدل المحتوى الموجود)، ثم احفظ بـ Ctrl+S."
            code={APPS_SCRIPT_TEMPLATE}
          />

          <Step
            num={4}
            title="انشر كـ Web App"
            body={`من القائمة: Deploy → New deployment → اختر "Web app" →
            Execute as: Me → Who has access: Anyone → Deploy.
            Google سيطلب صلاحيات (Authorize) — اقبلها.`}
          />

          <Step
            num={5}
            title="انسخ Web App URL"
            body="بعد deploy ستحصل على URL يبدأ بـ https://script.google.com/... — انسخه. هذا هو المطلوب أدناه."
          />

          <Step
            num={6}
            title="الصق URL في الحقل أدناه + اختبر"
            body="انسخه في &quot;رابط Web App&quot; ثم اضغط &quot;اختبر الاتصال&quot; — يجب أن يظهر صف اختبار في Sheet."
          />
        </CardContent>
      </Card>

      {/* Configuration form */}
      <BackupClient initial={status} />

      {/* FAQ */}
      <Card className="bg-surface-50/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">أسئلة شائعة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Faq
            q="هل يكلّفني Google شيئاً؟"
            a="لا، مجاناً تماماً. Google Sheets + Apps Script ضمن خطة Google المجانية (15GB)."
          />
          <Faq
            q="هل يستطيع أحد رؤية بياناتي في Sheet؟"
            a="لا. الـ Sheet في حسابك أنت فقط. حتى نحن في Meras لا نصل إليه. السر يحمي من أي شخص يعرف URL."
          />
          <Faq
            q="ماذا لو غيّرت سر الـ Web App؟"
            a="فقط حدّثه هنا في Meras أيضاً. النظام سيستخدم السر الجديد فوراً."
          />
          <Faq
            q="هل البيانات القديمة (قبل الربط) ستُنقل؟"
            a="لا، فقط التغييرات الجديدة بعد التفعيل. لنقل البيانات القديمة، استخدم تصدير CSV من /leads (ميزة قادمة)."
          />
          <Faq
            q="ماذا لو تعطّل Sheet أو Apps Script؟"
            a="Meras لن يتعطّل — يحاول مرتين ثم يكمل. آخر خطأ يظهر في الأعلى لتعرف."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Step({ num, title, body, code }: { num: number; title: string; body: string; code?: string }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-bold">
        {num}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-surface-900">{title}</p>
        <p className="text-sm text-surface-600 mt-0.5 leading-relaxed">{body}</p>
        {code && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-primary-600 hover:text-primary-800 font-medium">
              📋 عرض/نسخ الكود
            </summary>
            <pre className="mt-2 p-3 bg-surface-900 text-surface-100 rounded-lg text-[11px] overflow-x-auto leading-relaxed font-mono" dir="ltr">
              {code}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <p className="font-medium text-surface-900">{q}</p>
      <p className="text-surface-600 mt-0.5 leading-relaxed">{a}</p>
    </div>
  );
}

const APPS_SCRIPT_TEMPLATE = `// ━━━ Meras Backup Receiver ━━━
// يستقبل تحديثات من Meras ويسجّلها في الـ Sheet
// ضع السر نفسه الذي ستضعه في Meras

const SECRET = "PASTE_YOUR_SECRET_HERE"; // ← غيّر هذا
const HEADERS = [
  "ID", "الاسم", "الجوال", "البريد", "الأولوية",
  "المصدر", "المرحلة", "المنسقة",
  "حالة الحجز", "تاريخ الحجز", "الخدمة", "ملاحظة الحجز",
  "تاريخ الأرشفة", "سبب الأرشفة",
  "أُنشئ", "آخر تحديث", "آخر حدث"
];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // verify secret
    if (body.secret !== SECRET) {
      return out({ ok: false, error: "Unauthorized" });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // ensure headers
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    const lead = body.lead;
    const row = [
      lead.id, lead.name, lead.phone, lead.email, lead.priority,
      lead.sourceName, lead.stageName, lead.assignedToName,
      lead.bookingStatus, lead.bookingDate, lead.bookingService, lead.bookingNotes,
      lead.archivedAt, lead.archiveReason,
      lead.createdAt, lead.updatedAt, body.event
    ];

    // upsert by ID (column A)
    const data = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
    let foundRow = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === lead.id) { foundRow = i + 2; break; }
    }

    if (foundRow > 0) {
      sheet.getRange(foundRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function out(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;
