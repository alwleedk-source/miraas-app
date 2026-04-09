"use server";

import { db } from "@/db";
import { tenants, pipelineStages, users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * ينشئ شركة جديدة (Tenant) مع المراحل الافتراضية
 * ويربطها بالمستخدم الذي سجّل
 */
export async function createTenantForUser(userId: string, companyName: string) {
  // إنشاء slug من اسم الشركة
  const slug = companyName
    .toLowerCase()
    .replace(/[^\u0621-\u064Aa-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim()
    .slice(0, 50) + "-" + Date.now().toString(36);

  // إنشاء الشركة
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: companyName,
      slug,
      plan: "TRIAL",
      status: "ACTIVE",
      settings: { timezone: "Asia/Riyadh", language: "ar", currency: "SAR" },
    })
    .returning();

  // ربط المستخدم بالشركة + ترقيته كمالك
  await db
    .update(users)
    .set({ tenantId: tenant.id, role: "OWNER" })
    .where(eq(users.id, userId));

  // إنشاء مراحل الأنابيب الافتراضية
  const defaultStages = [
    { name: "جديد", color: "#3B82F6", position: 0, isDefault: true },
    { name: "تم التواصل", color: "#F59E0B", position: 1, isDefault: false },
    { name: "مهتم", color: "#EF4444", position: 2, isDefault: false },
    { name: "عرض مُرسل", color: "#8B5CF6", position: 3, isDefault: false },
    { name: "مُحوّل", color: "#22C55E", position: 4, isDefault: false },
    { name: "مغلق", color: "#6B7280", position: 5, isDefault: false },
  ];

  await db.insert(pipelineStages).values(
    defaultStages.map((stage) => ({
      ...stage,
      tenantId: tenant.id,
    }))
  );

  return tenant;
}
