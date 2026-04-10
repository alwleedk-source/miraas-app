"use server";

import { db } from "@/db";
import { tenants, users, pipelineStages, leadSources, webhookEndpoints } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateSlug, generateSecretKey, PIPELINE_STAGE_DEFAULTS } from "@/lib/utils";

/**
 * إنشاء شركة جديدة مع المراحل الافتراضية + webhook endpoint
 * يُستدعى بعد تسجيل المستخدم الجديد
 */
export async function createTenant(input: {
  name: string;
  ownerUserId: string;
}) {
  const slug = generateSlug(input.name) + "-" + Date.now().toString(36);

  // 1. إنشاء الشركة
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: input.name,
      slug,
      plan: "TRIAL",
      status: "ACTIVE",
      settings: {
        timezone: "Asia/Riyadh",
        language: "ar",
        currency: "SAR",
      },
    })
    .returning();

  // 2. ربط المستخدم بالشركة وتعيينه كمالك
  await db
    .update(users)
    .set({
      tenantId: tenant.id,
      role: "OWNER",
    })
    .where(eq(users.id, input.ownerUserId));

  // 3. إنشاء مراحل الأنابيب الافتراضية
  const stageValues = PIPELINE_STAGE_DEFAULTS.map((stage) => ({
    tenantId: tenant.id,
    name: stage.name,
    color: stage.color,
    position: stage.position,
    isDefault: stage.isDefault,
    isBooking: stage.isBooking,
  }));
  await db.insert(pipelineStages).values(stageValues);

  // 4. إنشاء مصادر العملاء الافتراضية
  const defaultSources = [
    { name: "فيسبوك", platform: "facebook" },
    { name: "إنستغرام", platform: "instagram" },
    { name: "قوقل", platform: "google" },
    { name: "تيك توك", platform: "tiktok" },
    { name: "مباشر", platform: "direct" },
    { name: "إحالة", platform: "referral" },
  ];
  await db.insert(leadSources).values(
    defaultSources.map((s) => ({
      tenantId: tenant.id,
      name: s.name,
      platform: s.platform,
    }))
  );

  // 5. إنشاء Webhook endpoint افتراضي
  await db.insert(webhookEndpoints).values({
    tenantId: tenant.id,
    secretKey: generateSecretKey(),
    label: "Google Sheets",
    isActive: true,
  });

  return tenant;
}

/**
 * جلب بيانات الشركة
 */
export async function getTenant(tenantId: string) {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });
  return tenant;
}

/**
 * تحديث إعدادات الشركة
 */
export async function updateTenant(
  tenantId: string,
  data: {
    name?: string;
    logoUrl?: string;
    settings?: Record<string, string>;
  }
) {
  const [updated] = await db
    .update(tenants)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId))
    .returning();

  return updated;
}
