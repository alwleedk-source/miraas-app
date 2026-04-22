"use server";

import { db } from "@/db";
import { pipelineStages, leads } from "@/db/schema";
import { eq, and, asc, count, sql, isNull, isNotNull, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/auth-server";
import { assertRole, ROLE, assertStageInTenant } from "@/lib/tenant-guards";

/**
 * إضافة مرحلة جديدة
 */
export async function createStage(input: { name: string; color: string }) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error("اسم المرحلة غير صالح");
  if (!/^#[0-9A-Fa-f]{6}$/.test(input.color)) throw new Error("لون غير صالح");

  const existing = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(${pipelineStages.position}), -1)` })
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.tenantId, tenantId),
        isNull(pipelineStages.archivedAt),
      ),
    );

  const nextPosition = (existing[0]?.maxPos ?? -1) + 1;

  const [stage] = await db
    .insert(pipelineStages)
    .values({
      tenantId,
      name,
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
  name: string;
  color: string;
}) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  await assertStageInTenant(input.stageId, tenantId);

  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error("اسم المرحلة غير صالح");
  if (!/^#[0-9A-Fa-f]{6}$/.test(input.color)) throw new Error("لون غير صالح");

  const [updated] = await db
    .update(pipelineStages)
    .set({ name, color: input.color })
    .where(and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)))
    .returning();

  revalidatePath("/pipeline");
  return updated;
}

/**
 * أرشفة مرحلة (Soft Archive — لا حذف نهائي).
 *
 * فلسفة:
 *   - المراحل لا تُحذف أبداً — تُؤرشف فقط
 *   - الأرشفة قابلة للإسترجاع بنقرة (unarchiveStage)
 *   - يحمي المالك من تخريب workflow بالخطأ
 *   - المراحل المؤرشفة تختفي من Kanban + selectors لكن البيانات تبقى
 *
 * شروط الأرشفة:
 *   - لا توجد leads نشطة فيها (يجب نقلهم أولاً)
 *   - ليست المرحلة الافتراضية (تبقى دائماً)
 */
export async function archiveStage(input: { stageId: string }) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  await assertStageInTenant(input.stageId, tenantId);

  const [{ leadsCount }] = await db
    .select({ leadsCount: count() })
    .from(leads)
    .where(
      and(
        eq(leads.stageId, input.stageId),
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
      ),
    );

  if (leadsCount > 0) {
    return {
      error: `لا يمكن أرشفة هذه المرحلة لأنها تحتوي على ${leadsCount} عميل. انقل العملاء أولاً (سحب على Kanban).`,
    };
  }

  const stage = await db.query.pipelineStages.findFirst({
    where: and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)),
  });

  if (!stage) return { error: "المرحلة غير موجودة" };
  if (stage.archivedAt) return { error: "المرحلة مؤرشفة بالفعل" };
  if (stage.isDefault) {
    return {
      error: "لا يمكن أرشفة المرحلة الافتراضية. عيّن مرحلة أخرى افتراضية أولاً.",
    };
  }

  await db.transaction(async (tx) => {
    // soft archive — لا حذف
    await tx
      .update(pipelineStages)
      .set({ archivedAt: new Date() })
      .where(and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)));

    // أعد ترتيب positions للمراحل النشطة فقط
    const remaining = await tx
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.tenantId, tenantId),
          isNull(pipelineStages.archivedAt),
        ),
      )
      .orderBy(asc(pipelineStages.position));

    for (let i = 0; i < remaining.length; i++) {
      await tx
        .update(pipelineStages)
        .set({ position: i })
        .where(eq(pipelineStages.id, remaining[i].id));
    }
  });

  revalidatePath("/pipeline");
  revalidatePath("/leads");
  return { success: true };
}

/**
 * إعادة تفعيل مرحلة مؤرشفة — تعود للـ Kanban بنفس بياناتها.
 * توضع في النهاية بعد آخر مرحلة نشطة.
 */
export async function unarchiveStage(input: { stageId: string }) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  // نسمح بالمرحلة المؤرشفة لأن هذه عملية الاسترجاع
  await assertStageInTenant(input.stageId, tenantId, { allowArchived: true });

  const stage = await db.query.pipelineStages.findFirst({
    where: and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)),
  });
  if (!stage) return { error: "المرحلة غير موجودة" };
  if (!stage.archivedAt) return { error: "المرحلة نشطة بالفعل" };

  // ضعها في النهاية
  const [{ maxPos }] = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(${pipelineStages.position}), -1)` })
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.tenantId, tenantId),
        isNull(pipelineStages.archivedAt),
      ),
    );

  await db
    .update(pipelineStages)
    .set({ archivedAt: null, position: (maxPos ?? -1) + 1 })
    .where(and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)));

  revalidatePath("/pipeline");
  revalidatePath("/leads");
  return { success: true };
}

/**
 * جلب المراحل المؤرشفة — لعرضها في "قسم الأرشيف"
 */
export async function getArchivedStages() {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  return db
    .select({
      id: pipelineStages.id,
      name: pipelineStages.name,
      color: pipelineStages.color,
      archivedAt: pipelineStages.archivedAt,
    })
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.tenantId, tenantId),
        isNotNull(pipelineStages.archivedAt),
      ),
    )
    .orderBy(desc(pipelineStages.archivedAt));
}

/**
 * إعادة ترتيب المراحل
 */
export async function reorderStages(input: { stageIds: string[] }) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  if (input.stageIds.length === 0 || input.stageIds.length > 50) {
    throw new Error("عدد المراحل غير صالح");
  }

  // تحقق أن كل الـ stageIds تخص هذا tenant
  const owned = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.tenantId, tenantId),
        sql`${pipelineStages.id} IN (${sql.join(input.stageIds.map((id) => sql`${id}`), sql`, `)})`,
      ),
    );
  if (owned.length !== input.stageIds.length) {
    throw new Error("بعض المراحل ليست ضمن صلاحياتك");
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < input.stageIds.length; i++) {
      await tx
        .update(pipelineStages)
        .set({ position: i })
        .where(
          and(
            eq(pipelineStages.id, input.stageIds[i]),
            eq(pipelineStages.tenantId, tenantId),
          ),
        );
    }
  });

  revalidatePath("/pipeline");
  return { success: true };
}

/**
 * تعيين مرحلة كافتراضية
 */
export async function setDefaultStage(input: { stageId: string }) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  await assertStageInTenant(input.stageId, tenantId);

  const [updated] = await db.transaction(async (tx) => {
    // ألغِ الافتراضي من الكل لهذا الـ tenant
    await tx
      .update(pipelineStages)
      .set({ isDefault: false })
      .where(eq(pipelineStages.tenantId, tenantId));

    return await tx
      .update(pipelineStages)
      .set({ isDefault: true })
      .where(and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)))
      .returning();
  });

  revalidatePath("/pipeline");
  return updated;
}

/**
 * تبديل حصرية مرحلة
 */
export async function toggleExclusive(input: { stageId: string }) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  await assertStageInTenant(input.stageId, tenantId);

  const stage = await db.query.pipelineStages.findFirst({
    where: and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)),
  });
  if (!stage) throw new Error("المرحلة غير موجودة");

  const [updated] = await db
    .update(pipelineStages)
    .set({ isExclusive: !stage.isExclusive })
    .where(and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)))
    .returning();

  revalidatePath("/pipeline");
  revalidatePath("/leads");
  return updated;
}
