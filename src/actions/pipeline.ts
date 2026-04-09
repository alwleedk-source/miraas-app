"use server";

import { db } from "@/db";
import { pipelineStages, leads } from "@/db/schema";
import { eq, and, asc, count, gt, lt, gte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * إضافة مرحلة جديدة
 */
export async function createStage(input: {
  tenantId: string;
  name: string;
  color: string;
}) {
  // اجلب أعلى position حالي
  const existing = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(${pipelineStages.position}), -1)` })
    .from(pipelineStages)
    .where(eq(pipelineStages.tenantId, input.tenantId));

  const nextPosition = (existing[0]?.maxPos ?? -1) + 1;

  const [stage] = await db
    .insert(pipelineStages)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      color: input.color,
      position: nextPosition,
      isDefault: false,
    })
    .returning();

  revalidatePath("/pipeline");
  return stage;
}

/**
 * تعديل مرحلة
 */
export async function updateStage(input: {
  stageId: string;
  tenantId: string;
  name: string;
  color: string;
}) {
  const [updated] = await db
    .update(pipelineStages)
    .set({
      name: input.name,
      color: input.color,
    })
    .where(
      and(
        eq(pipelineStages.id, input.stageId),
        eq(pipelineStages.tenantId, input.tenantId)
      )
    )
    .returning();

  revalidatePath("/pipeline");
  return updated;
}

/**
 * حذف مرحلة (مع التحقق من عدم وجود عملاء)
 */
export async function deleteStage(input: {
  stageId: string;
  tenantId: string;
}) {
  // تحقق من عدم وجود عملاء في هذه المرحلة
  const [{ leadsCount }] = await db
    .select({ leadsCount: count() })
    .from(leads)
    .where(
      and(
        eq(leads.stageId, input.stageId),
        eq(leads.tenantId, input.tenantId),
        eq(leads.isDeleted, false)
      )
    );

  if (leadsCount > 0) {
    return { error: `لا يمكن حذف هذه المرحلة لأنها تحتوي على ${leadsCount} عميل. انقل العملاء أولاً.` };
  }

  // تحقق أنها ليست المرحلة الافتراضية الوحيدة
  const stage = await db.query.pipelineStages.findFirst({
    where: and(
      eq(pipelineStages.id, input.stageId),
      eq(pipelineStages.tenantId, input.tenantId)
    ),
  });

  if (!stage) return { error: "المرحلة غير موجودة" };

  if (stage.isDefault) {
    return { error: "لا يمكن حذف المرحلة الافتراضية" };
  }

  await db
    .delete(pipelineStages)
    .where(
      and(
        eq(pipelineStages.id, input.stageId),
        eq(pipelineStages.tenantId, input.tenantId)
      )
    );

  // أعد ترتيب positions
  const remaining = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(eq(pipelineStages.tenantId, input.tenantId))
    .orderBy(asc(pipelineStages.position));

  await Promise.all(
    remaining.map((s, i) =>
      db
        .update(pipelineStages)
        .set({ position: i })
        .where(eq(pipelineStages.id, s.id))
    )
  );

  revalidatePath("/pipeline");
  return { success: true };
}

/**
 * إعادة ترتيب المراحل
 */
export async function reorderStages(input: {
  tenantId: string;
  stageIds: string[]; // الترتيب الجديد
}) {
  await Promise.all(
    input.stageIds.map((id, index) =>
      db
        .update(pipelineStages)
        .set({ position: index })
        .where(
          and(
            eq(pipelineStages.id, id),
            eq(pipelineStages.tenantId, input.tenantId)
          )
        )
    )
  );

  revalidatePath("/pipeline");
  return { success: true };
}

/**
 * تعيين مرحلة كافتراضية
 */
export async function setDefaultStage(input: {
  stageId: string;
  tenantId: string;
}) {
  // ألغِ الافتراضي من الكل
  await db
    .update(pipelineStages)
    .set({ isDefault: false })
    .where(eq(pipelineStages.tenantId, input.tenantId));

  // عيّن الجديد
  const [updated] = await db
    .update(pipelineStages)
    .set({ isDefault: true })
    .where(
      and(
        eq(pipelineStages.id, input.stageId),
        eq(pipelineStages.tenantId, input.tenantId)
      )
    )
    .returning();

  revalidatePath("/pipeline");
  return updated;
}

/**
 * تبديل حصرية مرحلة
 */
export async function toggleExclusive(input: {
  stageId: string;
  tenantId: string;
}) {
  const stage = await db.query.pipelineStages.findFirst({
    where: and(
      eq(pipelineStages.id, input.stageId),
      eq(pipelineStages.tenantId, input.tenantId)
    ),
  });

  if (!stage) throw new Error("المرحلة غير موجودة");

  const [updated] = await db
    .update(pipelineStages)
    .set({ isExclusive: !stage.isExclusive })
    .where(
      and(
        eq(pipelineStages.id, input.stageId),
        eq(pipelineStages.tenantId, input.tenantId)
      )
    )
    .returning();

  revalidatePath("/pipeline");
  revalidatePath("/leads");
  return updated;
}
