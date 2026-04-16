import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Globe, Clock, Palette, Tag, Briefcase, LayoutGrid } from "lucide-react";
import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { getTenantSettings } from "@/app/actions/settings";
import SettingsForm from "./settings-form";
import TagsManager from "./tags-manager";
import ServicesManager from "./services-manager";
import DepartmentsManager from "./departments-manager";
import { db } from "@/db";
import { tags, services, departments, users } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";

const planLabels: Record<string, string> = {
  TRIAL: "الخطة التجريبية",
  STARTER: "الباقة الأساسية",
  PROFESSIONAL: "الباقة الاحترافية",
  ENTERPRISE: "باقة المؤسسات",
};

export default async function SettingsPage() {
  const { tenantId } = await requireTenant();
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

  // جلب الخدمات
  let servicesData: { id: string; name: string; isActive: boolean }[] = [];
  try {
    servicesData = await db
      .select({ id: services.id, name: services.name, isActive: services.isActive })
      .from(services)
      .where(eq(services.tenantId, tenantId))
      .orderBy(asc(services.createdAt));
  } catch {}

  // جلب الأقسام
  let departmentsData: { id: string; name: string; color: string; defaultGapMinutes: number; position: number; isActive: boolean }[] = [];
  try {
    departmentsData = await db
      .select({
        id: departments.id,
        name: departments.name,
        color: departments.color,
        defaultGapMinutes: departments.defaultGapMinutes,
        position: departments.position,
        isActive: departments.isActive,
      })
      .from(departments)
      .where(eq(departments.tenantId, tenantId))
      .orderBy(asc(departments.position));
  } catch {}

  // جلب مقدمي الخدمة (لربطهم بالأقسام)
  let providersData: { id: string; name: string; email: string }[] = [];
  try {
    providersData = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "PROVIDER"), eq(users.isActive, true)))
      .orderBy(asc(users.name));
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

      {/* الأقسام */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-primary-500" />
            الأقسام
          </CardTitle>
          <CardDescription>أنشئ أقساماً لتنظيم الحجوزات (مثل: عيادة العيون، عيادة الجلدية) وحدد الفجوة الزمنية بين المواعيد</CardDescription>
        </CardHeader>
        <CardContent>
          <DepartmentsManager initialDepartments={departmentsData} allProviders={providersData} />
        </CardContent>
      </Card>

      {/* الخدمات المقدمة */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary-500" />
            الخدمات المقدمة
          </CardTitle>
          <CardDescription>أضف الخدمات التي تقدمها لتظهر في نموذج الحجز (مثل: تنظيف أسنان، استشارة، عملية)</CardDescription>
        </CardHeader>
        <CardContent>
          <ServicesManager initialServices={servicesData} />
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
