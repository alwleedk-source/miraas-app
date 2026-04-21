"use server";

import { db } from "@/db";
import { services } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { assertRole, ROLE, assertDepartmentInTenant } from "@/lib/tenant-guards";

// =============================================
// جلب خدمات الشركة (كل المستخدمين)
// =============================================

export async function getServices() {
  const { tenantId } = await requireTenant();

  return db
    .select({
      id: services.id,
      name: services.name,
      isActive: services.isActive,
      departmentId: services.departmentId,
      defaultDurationMin: services.defaultDurationMin,
    })
    .from(services)
    .where(eq(services.tenantId, tenantId))
    .orderBy(services.createdAt);
}

// =============================================
// جلب الخدمات النشطة فقط (للاختيار في الحجز)
// =============================================

export async function getActiveServices() {
  const { tenantId } = await requireTenant();

  return db
    .select({ id: services.id, name: services.name })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.isActive, true)))
    .orderBy(services.name);
}

// =============================================
// إضافة خدمة جديدة (OWNER/ADMIN)
// =============================================

export async function addService(
  name: string,
  departmentId?: string,
  defaultDurationMin?: number,
) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 255) throw new Error("اسم الخدمة غير صالح");
  if (departmentId) await assertDepartmentInTenant(departmentId, tenantId);
  if (defaultDurationMin !== undefined && (defaultDurationMin < 5 || defaultDurationMin > 480)) {
    throw new Error("مدة غير صالحة (5-480 دقيقة)");
  }

  const [existing] = await db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.tenantId, tenantId), eq(services.name, trimmed)))
    .limit(1);
  if (existing) throw new Error("هذه الخدمة موجودة بالفعل");

  await db.insert(services).values({
    tenantId,
    name: trimmed,
    departmentId: departmentId || null,
    defaultDurationMin: defaultDurationMin || 30,
  });
  revalidatePath("/settings");
}

// =============================================
// تحديث تفاصيل خدمة (قسم + مدة)
// =============================================

export async function updateServiceDetails(
  serviceId: string,
  data: { departmentId?: string | null; defaultDurationMin?: number },
) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  // تحقق أن الخدمة في نفس الـ tenant
  const [existing] = await db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)))
    .limit(1);
  if (!existing) throw new Error("الخدمة غير موجودة");

  if (data.departmentId) await assertDepartmentInTenant(data.departmentId, tenantId);
  if (data.defaultDurationMin !== undefined && (data.defaultDurationMin < 5 || data.defaultDurationMin > 480)) {
    throw new Error("مدة غير صالحة");
  }

  const updateData: Record<string, unknown> = {};
  if (data.departmentId !== undefined) updateData.departmentId = data.departmentId;
  if (data.defaultDurationMin !== undefined) updateData.defaultDurationMin = data.defaultDurationMin;

  await db
    .update(services)
    .set(updateData)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)));

  revalidatePath("/settings");
}

// =============================================
// تعطيل/تفعيل خدمة
// =============================================

export async function toggleService(serviceId: string) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  const [existing] = await db
    .select({ isActive: services.isActive })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)));
  if (!existing) throw new Error("الخدمة غير موجودة");

  await db
    .update(services)
    .set({ isActive: !existing.isActive })
    .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)));

  revalidatePath("/settings");
}

// =============================================
// حذف خدمة
// =============================================

export async function deleteService(serviceId: string) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  await db
    .delete(services)
    .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)));

  revalidatePath("/settings");
}
