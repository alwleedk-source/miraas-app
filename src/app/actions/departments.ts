"use server";

import { db } from "@/db";
import { departments, departmentProviders, providerSchedules, providerDayOffs, users, activityLog } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";

// =============================================
// جلب الأقسام
// =============================================

export async function getDepartments() {
  const { tenantId } = await requireTenant();

  const deps = await db
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

  return deps;
}

// =============================================
// إضافة قسم
// =============================================

export async function addDepartment(input: {
  name: string;
  color?: string;
  defaultGapMinutes?: number;
}) {
  const { tenantId, userId } = await requireTenant();
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("اسم القسم مطلوب");

  // منع التكرار
  const [existing] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), eq(departments.name, trimmed)))
    .limit(1);
  if (existing) throw new Error("هذا القسم موجود بالفعل");

  // الترتيب التلقائي
  const allDeps = await db
    .select({ position: departments.position })
    .from(departments)
    .where(eq(departments.tenantId, tenantId));
  const nextPos = allDeps.length > 0 ? Math.max(...allDeps.map((d) => d.position)) + 1 : 0;

  const [dep] = await db
    .insert(departments)
    .values({
      tenantId,
      name: trimmed,
      color: input.color || "#3B82F6",
      defaultGapMinutes: input.defaultGapMinutes ?? 15,
      position: nextPos,
    })
    .returning({ id: departments.id });

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "DEPARTMENT_CREATED",
    entityType: "department",
    entityId: dep.id,
    details: { name: trimmed },
  });

  revalidatePath("/settings");
  return dep;
}

// =============================================
// تعديل قسم
// =============================================

export async function updateDepartment(
  departmentId: string,
  input: { name?: string; color?: string; defaultGapMinutes?: number; isActive?: boolean }
) {
  const { tenantId, userId } = await requireTenant();

  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name.trim();
  if (input.color !== undefined) updateData.color = input.color;
  if (input.defaultGapMinutes !== undefined) updateData.defaultGapMinutes = input.defaultGapMinutes;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;

  await db
    .update(departments)
    .set(updateData)
    .where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)));

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "DEPARTMENT_UPDATED",
    entityType: "department",
    entityId: departmentId,
    details: updateData,
  });

  revalidatePath("/settings");
}

// =============================================
// حذف قسم
// =============================================

export async function deleteDepartment(departmentId: string) {
  const { tenantId } = await requireTenant();

  await db
    .delete(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)));

  revalidatePath("/settings");
}

// =============================================
// جلب مقدمي الخدمة (PROVIDER) لقسم معين
// =============================================

export async function getDepartmentProviders(departmentId: string) {
  const { tenantId } = await requireTenant();

  const providers = await db
    .select({
      id: departmentProviders.id,
      userId: departmentProviders.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(departmentProviders)
    .innerJoin(users, eq(departmentProviders.userId, users.id))
    .innerJoin(departments, eq(departmentProviders.departmentId, departments.id))
    .where(
      and(
        eq(departmentProviders.departmentId, departmentId),
        eq(departments.tenantId, tenantId)
      )
    );

  return providers;
}

// =============================================
// جلب كل مقدمي الخدمة في الشركة
// =============================================

export async function getAllProviders() {
  const { tenantId } = await requireTenant();

  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "PROVIDER"), eq(users.isActive, true)))
    .orderBy(asc(users.name));
}

// =============================================
// ربط مقدم خدمة بقسم
// =============================================

export async function linkProviderToDepartment(departmentId: string, userId: string) {
  const { tenantId } = await requireTenant();

  // تحقق أن القسم تابع للشركة
  const [dep] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)));
  if (!dep) throw new Error("القسم غير موجود");

  // تحقق أن المستخدم PROVIDER وتابع للشركة
  const [provider] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.role, "PROVIDER")));
  if (!provider) throw new Error("مقدم الخدمة غير موجود");

  // منع التكرار
  const [existing] = await db
    .select({ id: departmentProviders.id })
    .from(departmentProviders)
    .where(
      and(eq(departmentProviders.departmentId, departmentId), eq(departmentProviders.userId, userId))
    )
    .limit(1);
  if (existing) throw new Error("مقدم الخدمة مرتبط بهذا القسم بالفعل");

  await db.insert(departmentProviders).values({ departmentId, userId });
  revalidatePath("/settings");
}

// =============================================
// إلغاء ربط مقدم خدمة من قسم
// =============================================

export async function unlinkProviderFromDepartment(linkId: string) {
  await db.delete(departmentProviders).where(eq(departmentProviders.id, linkId));
  revalidatePath("/settings");
}

// =============================================
// جلب جدول عمل مقدم خدمة
// =============================================

export async function getProviderSchedule(userId: string) {
  const { tenantId } = await requireTenant();

  return db
    .select({
      id: providerSchedules.id,
      dayOfWeek: providerSchedules.dayOfWeek,
      startTime: providerSchedules.startTime,
      endTime: providerSchedules.endTime,
      breakStart: providerSchedules.breakStart,
      breakEnd: providerSchedules.breakEnd,
      isActive: providerSchedules.isActive,
    })
    .from(providerSchedules)
    .where(and(eq(providerSchedules.tenantId, tenantId), eq(providerSchedules.userId, userId)))
    .orderBy(asc(providerSchedules.dayOfWeek));
}

// =============================================
// حفظ جدول عمل أسبوعي كامل (يحل محل القديم)
// =============================================

export async function saveProviderSchedule(
  userId: string,
  schedule: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    breakStart?: string;
    breakEnd?: string;
    isActive: boolean;
  }>
) {
  const { tenantId } = await requireTenant();

  // حذف الجدول القديم
  await db
    .delete(providerSchedules)
    .where(and(eq(providerSchedules.tenantId, tenantId), eq(providerSchedules.userId, userId)));

  // إدراج الجديد
  if (schedule.length > 0) {
    await db.insert(providerSchedules).values(
      schedule.map((s) => ({
        tenantId,
        userId,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        breakStart: s.breakStart || null,
        breakEnd: s.breakEnd || null,
        isActive: s.isActive,
      }))
    );
  }

  revalidatePath("/settings");
}

// =============================================
// جلب إجازات مقدم خدمة
// =============================================

export async function getProviderDayOffs(userId: string) {
  const { tenantId } = await requireTenant();

  return db
    .select({
      id: providerDayOffs.id,
      date: providerDayOffs.date,
      reason: providerDayOffs.reason,
    })
    .from(providerDayOffs)
    .where(and(eq(providerDayOffs.tenantId, tenantId), eq(providerDayOffs.userId, userId)))
    .orderBy(asc(providerDayOffs.date));
}

// =============================================
// إضافة إجازة
// =============================================

export async function addProviderDayOff(userId: string, date: string, reason?: string) {
  const { tenantId } = await requireTenant();

  await db.insert(providerDayOffs).values({
    tenantId,
    userId,
    date: new Date(date),
    reason: reason || null,
  });

  revalidatePath("/settings");
}

// =============================================
// حذف إجازة
// =============================================

export async function deleteProviderDayOff(dayOffId: string) {
  await db.delete(providerDayOffs).where(eq(providerDayOffs.id, dayOffId));
  revalidatePath("/settings");
}
