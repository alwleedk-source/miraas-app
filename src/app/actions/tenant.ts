"use server";

import { db } from "@/db";
import { tenants, pipelineStages, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth-server";
import { generateUniqueSlug } from "@/lib/utils";

/**
 * ينشئ شركة جديدة (Tenant) مع المراحل الافتراضية
 * ويربطها بالمستخدم الذي سجّل الآن
 *
 * ⚠️ السطر الأول هو ما يحمي من account hijack — userId يأتي من الـ session
 * لا من الـ client. وإذا كان لدى المستخدم tenant، نرفض.
 */
export async function createTenantForUser(companyName: string) {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("unauthorized");
  }
  const userId = session.user.id;

  const trimmed = companyName.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 255) {
    throw new Error("اسم الشركة غير صالح (2-255 حرف)");
  }

  // منع إنشاء شركة ثانية لمستخدم لديه واحدة
  const [existing] = await db
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!existing) throw new Error("المستخدم غير موجود");
  if (existing.tenantId) {
    throw new Error("لديك شركة بالفعل");
  }

  const slug = generateUniqueSlug(trimmed);

  return await db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: trimmed,
        slug,
        plan: "TRIAL",
        status: "ACTIVE",
        settings: { timezone: "Asia/Riyadh", language: "ar", currency: "SAR" },
      })
      .returning();

    await tx
      .update(users)
      .set({ tenantId: tenant.id, role: "OWNER" })
      .where(eq(users.id, userId));

    const defaultStages = [
      { name: "جديد", color: "#3B82F6", position: 0, isDefault: true },
      { name: "استفسار", color: "#F59E0B", position: 1, isDefault: false },
      { name: "مهتم", color: "#EF4444", position: 2, isDefault: false },
      { name: "عرض مُرسل", color: "#8B5CF6", position: 3, isDefault: false },
      { name: "مُحوّل", color: "#22C55E", position: 4, isDefault: false },
      { name: "مغلق", color: "#6B7280", position: 5, isDefault: false },
    ];

    await tx.insert(pipelineStages).values(
      defaultStages.map((stage) => ({ ...stage, tenantId: tenant.id })),
    );

    return tenant;
  });
}
