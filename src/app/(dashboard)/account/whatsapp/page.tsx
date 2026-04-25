import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, MessageCircle } from "lucide-react";
import Link from "next/link";
import PersonalWhatsApp from "@/app/(dashboard)/settings/whatsapp/personal-wa";

/**
 * صفحة "حسابي → الواتساب الخاص بي"
 * متاحة لكل الأدوار (OWNER, ADMIN, COORDINATOR) — لا PROVIDER.
 *
 * هنا يربط كل منسق رقمه الشخصي في Meta. عند ربطه، العملاء الذين أُسنِدوا له
 * يستلمون رسائلهم من رقمه (لا من رقم العيادة الموحّد).
 */
export default async function AccountWhatsappPage() {
  const { role, session } = await requireTenant();
  if (role === "PROVIDER") redirect("/provider");

  return (
    <div className="space-y-6 max-w-3xl animate-fade-in">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 mb-2"
        >
          <ArrowRight className="h-3.5 w-3.5" />
          الرجوع
        </Link>
        <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-2">
          <MessageCircle className="h-6 w-6 text-primary-500" />
          الواتساب الخاص بي
        </h1>
        <p className="text-surface-500 mt-1 text-sm">
          أهلاً {session.user.name} — اربط رقم Meta الخاص بك ليصل عملاؤك من رقمك (لا رقم العيادة الموحّد).
        </p>
      </div>

      <PersonalWhatsApp />

      {/* مساعد بصري لشرح الفرق */}
      <Card className="bg-surface-50/50 border-surface-200">
        <CardContent className="p-4 text-xs text-surface-600 leading-relaxed space-y-2">
          <p className="font-semibold text-surface-900">📞 كيف يعمل ربط الرقم الخاص؟</p>
          <ul className="list-disc list-inside space-y-1.5">
            <li>
              <strong>دون ربط رقمك:</strong> العميل يستلم الترحيب والتذكيرات من رقم العيادة الموحّد (إعدادات OWNER العامة).
            </li>
            <li>
              <strong>مع ربط رقمك:</strong> عملاء حملاتك يستلمون رسائلهم من رقمك أنت — تجربة شخصية ومتّسقة.
            </li>
            <li>
              <strong>اتّساق:</strong> العميل يستلم الترحيب من رقمك، ثم كل التذكيرات من نفس الرقم (لا تشتيت).
            </li>
            <li>
              <strong>عزل:</strong> الـ Access Token الخاص بك مشفّر بمفتاح خاص بحسابك — لا يمكن لأيّ مستخدم آخر فك تشفيره.
            </li>
          </ul>
          {role === "OWNER" || role === "ADMIN" ? (
            <p className="text-primary-600 mt-3">
              💡 بصفتك {role === "OWNER" ? "مالكاً" : "مديراً"}: تستطيع إدارة رقم العيادة الموحّد + رؤية حالة الفريق من{" "}
              <Link href="/settings/whatsapp" className="underline hover:text-primary-800">
                إعدادات واتساب
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
