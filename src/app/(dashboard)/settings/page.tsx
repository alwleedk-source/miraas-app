import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Globe, Clock, Palette, Tag } from "lucide-react";
import { requireAuth } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { getTenantSettings } from "@/app/actions/settings";
import SettingsForm from "./settings-form";
import TagsManager from "./tags-manager";
import { db } from "@/db";
import { tags } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

const planLabels: Record<string, string> = {
  TRIAL: "الخطة التجريبية",
  STARTER: "الباقة الأساسية",
  PROFESSIONAL: "الباقة الاحترافية",
  ENTERPRISE: "باقة المؤسسات",
};

export default async function SettingsPage() {
  const session = await requireAuth();
  const tenantId = (session.user as Record<string, unknown>).tenantId as string;
  if (!tenantId) redirect("/register");

  let tenant;
  try {
    tenant = await getTenantSettings();
  } catch {
    tenant = null;
  }

  // جلب التصنيفات
  let tagsData: { id: string; name: string; color: string }[] = [];
  try {
    tagsData = await db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(tags)
      .where(eq(tags.tenantId, tenantId))
      .orderBy(asc(tags.name));
  } catch {}

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-surface-900">الإعدادات</h1>
        <p className="text-surface-500 mt-1">إعدادات الشركة والتخصيص</p>
      </div>

      {/* معلومات الشركة */}
      <SettingsForm tenantName={tenant?.name || ""} />

      {/* التخصيص */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary-500" />
            التخصيص
          </CardTitle>
          <CardDescription>تخصيص مظهر لوحة التحكم</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-surface-700">المنطقة الزمنية</p>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-surface-400" />
              <Badge variant="secondary">Asia/Riyadh (GMT+3)</Badge>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-surface-700">اللغة</p>
            <Badge variant="default">العربية</Badge>
          </div>
        </CardContent>
      </Card>

      {/* تصنيفات العملاء */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary-500" />
            تصنيفات العملاء
          </CardTitle>
          <CardDescription>أنشئ تصنيفات لتنظيم عملائك (مثل: VIP، عقاري، مهم)</CardDescription>
        </CardHeader>
        <CardContent>
          <TagsManager initialTags={tagsData} />
        </CardContent>
      </Card>

      {/* الاشتراك */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary-500" />
            الاشتراك
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 bg-primary-50 rounded-lg">
            <div>
              <p className="font-semibold text-primary-900">
                {planLabels[tenant?.plan || "TRIAL"]}
              </p>
              <p className="text-sm text-primary-600 mt-1">
                الحالة: <Badge variant={tenant?.status === "ACTIVE" ? "success" : "outline"}>
                  {tenant?.status === "ACTIVE" ? "نشط" : tenant?.status === "SUSPENDED" ? "موقوف" : "تجريبي"}
                </Badge>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
