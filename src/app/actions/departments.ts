"use server";

import { db } from "@/db";
import { departments, departmentProviders, providerSchedules, providerDayOffs, users, activityLog } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { assertRole, ROLE, assertUserInTenant, assertDepartmentInTenant } from "@/lib/tenant-guards";

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
  const { tenantId, userId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  const trimmed = input.name.trim();
  if (!trimmed || trimmed.length > 255) return { success: false as const, error: "اسم القسم غير صالح" };
  if (input.color && !/^#[0-9A-Fa-f]{6}$/.test(input.color)) {
    return { success: false as const, error: "لون غير صالح" };
  }
  if (input.defaultGapMinutes !== undefined && (input.defaultGapMinutes < 0 || input.defaultGapMinutes > 120)) {
    return { success: false as const, error: "فارق زمني غير صالح" };
  }

  // منع التكرار
  const [existing] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), eq(departments.name, trimmed)))
    .limit(1);
  if (existing) return { success: false as const, error: "هذا القسم موجود بالفعل" };

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
  return { success: true as const, id: dep.id };
}

// =============================================
// تعديل قسم
// =============================================

export async function updateDepartment(
  departmentId: string,
  input: { name?: string; color?: string; defaultGapMinutes?: number; isActive?: boolean }
) {
  const { tenantId, userId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  await assertDepartmentInTenant(departmentId, tenantId);

  // نفس تحقّقات addDepartment — كان updateDepartment بلا أي validation:
  // فارق سالب يجعل bookingEndTime < bookingDate فيكسر قيد tstzrange
  // فيُقتل كل حجوزات هذا القسم بخطأ PG خام.
  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed || trimmed.length > 255) {
      return { success: false as const, error: "اسم القسم غير صالح" };
    }
    updateData.name = trimmed;
  }
  if (input.color !== undefined) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(input.color)) {
      return { success: false as const, error: "لون غير صالح" };
    }
    updateData.color = input.color;
  }
  if (input.defaultGapMinutes !== undefined) {
    if (input.defaultGapMinutes < 0 || input.defaultGapMinutes > 120) {
      return { success: false as const, error: "فارق زمني غير صالح" };
    }
    updateData.defaultGapMinutes = input.defaultGapMinutes;
  }
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
  return { success: true as const };
}

// =============================================
// حذف قسم
// =============================================

export async function deleteDepartment(departmentId: string) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  await assertDepartmentInTenant(departmentId, tenantId);

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
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  await assertDepartmentInTenant(departmentId, tenantId);
  await assertUserInTenant(userId, tenantId);

  // تحقق أن القسم تابع للشركة
  const [dep] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)));
  if (!dep) return { success: false as const, error: "القسم غير موجود" };

  // تحقق أن المستخدم PROVIDER وتابع للشركة
  const [provider] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.role, "PROVIDER")));
  if (!provider) return { success: false as const, error: "مقدم الخدمة غير موجود" };

  // منع التكرار
  const [existing] = await db
    .select({ id: departmentProviders.id })
    .from(departmentProviders)
    .where(
      and(eq(departmentProviders.departmentId, departmentId), eq(departmentProviders.userId, userId))
    )
    .limit(1);
  if (existing) return { success: false as const, error: "مقدم الخدمة مرتبط بهذا القسم بالفعل" };

  await db.insert(departmentProviders).values({ departmentId, userId });
  revalidatePath("/settings");
  return { success: true as const };
}

// =============================================
// إلغاء ربط مقدم خدمة من قسم
// =============================================

export async function unlinkProviderFromDepartment(linkId: string) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  // تحقق أن الـ link يخص قسماً في الـ tenant (يمنع IDOR)
  const [link] = await db
    .select({ id: departmentProviders.id })
    .from(departmentProviders)
    .innerJoin(departments, eq(departmentProviders.departmentId, departments.id))
    .where(and(eq(departmentProviders.id, linkId), eq(departments.tenantId, tenantId)))
    .limit(1);
  if (!link) return { success: false as const, error: "الرابط غير موجود" };

  await db.delete(departmentProviders).where(eq(departmentProviders.id, linkId));
  revalidatePath("/settings");
  return { success: true as const };
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
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  await assertUserInTenant(userId, tenantId);

  // validate inputs
  if (schedule.length > 7) return { success: false as const, error: "أيام أكثر من اللازم" };
  const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const s of schedule) {
    if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 0 || s.dayOfWeek > 6) {
      return { success: false as const, error: "يوم غير صالح" };
    }
    if (!TIME_REGEX.test(s.startTime) || !TIME_REGEX.test(s.endTime)) {
      return { success: false as const, error: "وقت غير صالح" };
    }
    // مقارنة نصّية على "HH:MM" المُصفَّرة = ترتيب زمني صحيح
    if (s.startTime >= s.endTime) {
      return { success: false as const, error: "وقت النهاية يجب أن يكون بعد وقت البداية" };
    }
    if (s.breakStart && !TIME_REGEX.test(s.breakStart)) {
      return { success: false as const, error: "وقت استراحة غير صالح" };
    }
    if (s.breakEnd && !TIME_REGEX.test(s.breakEnd)) {
      return { success: false as const, error: "وقت استراحة غير صالح" };
    }
    // الاستراحة: إمّا الطرفان معاً أو لا شيء (لا استراحة معلّقة بطرف واحد يكسر حساب التوفّر)
    if (Boolean(s.breakStart) !== Boolean(s.breakEnd)) {
      return { success: false as const, error: "حدّد بداية ونهاية الاستراحة معاً" };
    }
    if (s.breakStart && s.breakEnd) {
      if (s.breakStart >= s.breakEnd) {
        return { success: false as const, error: "نهاية الاستراحة يجب أن تكون بعد بدايتها" };
      }
      if (s.breakStart < s.startTime || s.breakEnd > s.endTime) {
        return { success: false as const, error: "الاستراحة يجب أن تكون ضمن ساعات العمل" };
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(providerSchedules)
      .where(and(eq(providerSchedules.tenantId, tenantId), eq(providerSchedules.userId, userId)));

    if (schedule.length > 0) {
      await tx.insert(providerSchedules).values(
        schedule.map((s) => ({
          tenantId,
          userId,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          breakStart: s.breakStart || null,
          breakEnd: s.breakEnd || null,
          isActive: s.isActive,
        })),
      );
    }
  });

  revalidatePath("/settings");
  return { success: true as const };
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
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  await assertUserInTenant(userId, tenantId);

  const parsedDate = new Date(date);
  if (isNaN(parsedDate.getTime())) return { success: false as const, error: "تاريخ غير صالح" };
  if (reason && reason.length > 255) return { success: false as const, error: "سبب طويل جداً" };

  await db.insert(providerDayOffs).values({
    tenantId,
    userId,
    date: parsedDate,
    reason: reason || null,
  });

  revalidatePath("/settings");
  return { success: true as const };
}

// =============================================
// حذف إجازة
// =============================================

export async function deleteProviderDayOff(dayOffId: string) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  // قيّد الحذف بـ tenantId — يمنع IDOR
  await db
    .delete(providerDayOffs)
    .where(and(eq(providerDayOffs.id, dayOffId), eq(providerDayOffs.tenantId, tenantId)));
  revalidatePath("/settings");
}
