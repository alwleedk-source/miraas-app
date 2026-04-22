"use server";

import { db } from "@/db";
import { leads, users, whatsappConfigs, webhookEndpoints, tenants } from "@/db/schema";
import { eq, and, count, ne } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { assertRole, ROLE } from "@/lib/tenant-guards";

export type OnboardingStep = {
  key: "whatsapp" | "team" | "webhook" | "first_lead";
  label: string;
  description: string;
  icon: string;
  href: string;
  done: boolean;
};

export type OnboardingStatus = {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  shouldShow: boolean; // false إذا كل الخطوات مكتملة + الـ tenant ناضج
  tenantName: string;
};

/**
 * حالة الإعداد الأولي — ما الذي تم وما المتبقّي.
 *
 * يُستخدم في dashboard لـ OWNER/ADMIN لتوجيه الـ tenants الجدد.
 * يخفي نفسه تلقائياً عند اكتمال كل الخطوات + وجود ≥3 leads.
 */
export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  const [
    tenantInfo,
    whatsapp,
    teamCount,
    webhookCount,
    leadCount,
  ] = await Promise.all([
    db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({ isActive: whatsappConfigs.isActive })
      .from(whatsappConfigs)
      .where(eq(whatsappConfigs.tenantId, tenantId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({ c: count() })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), ne(users.role, "OWNER")))
      .then((r) => Number(r[0]?.c ?? 0)),
    db
      .select({ c: count() })
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.isActive, true)))
      .then((r) => Number(r[0]?.c ?? 0)),
    db
      .select({ c: count() })
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), eq(leads.isDeleted, false)))
      .then((r) => Number(r[0]?.c ?? 0)),
  ]);

  const steps: OnboardingStep[] = [
    {
      key: "whatsapp",
      label: "اربط واتساب الأعمال",
      description: "تذكيرات الحجوزات تلقائياً للعملاء (يقلل عدم الحضور ٣٩٪)",
      icon: "💬",
      href: "/settings/whatsapp",
      done: !!whatsapp?.isActive,
    },
    {
      key: "team",
      label: "أضف فريق العمل",
      description: "ادعُ المنسقين/مقدمي الخدمة بأدوار مناسبة",
      icon: "👥",
      href: "/team",
      done: teamCount > 0,
    },
    {
      key: "webhook",
      label: "اربط webhook لاستقبال العملاء",
      description: "TikTok/Snap/Instagram → Meras مباشرة بدون نسخ يدوي",
      icon: "🔗",
      href: "/settings/webhooks",
      done: webhookCount > 0,
    },
    {
      key: "first_lead",
      label: "أضف أول عميل",
      description: "يدوياً للتجربة، أو انتظر استقبال من webhook",
      icon: "🚀",
      href: "/leads",
      done: leadCount > 0,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  // أخف نفسي إذا كل الخطوات مكتملة + ≥3 leads (يعني Meras بدأ يُستخدم فعلاً)
  const shouldShow = !(completedCount === steps.length && leadCount >= 3);

  return {
    steps,
    completedCount,
    totalCount: steps.length,
    shouldShow,
    tenantName: tenantInfo?.name ?? "",
  };
}
