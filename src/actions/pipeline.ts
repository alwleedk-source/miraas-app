"use server";

import { db } from "@/db";
import { pipelineStages, leads } from "@/db/schema";
import { eq, and, asc, count, sql, isNull, isNotNull, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/auth-server";
import { assertRole, ROLE, assertStageInTenant } from "@/lib/tenant-guards";

type Fail = { success: false; error: string };

/**
 * عقد الأخطاء الموحّد: Next.js في production يُخفي رسائل الأخطاء المرمية من
 * server actions فيرى المستخدم نصاً إنجليزياً عاماً. لذا كل خطأ متوقَّع
 * (تحقق/صلاحية/غير موجود) يُعاد كـ { success: false, error: "عربي" }.
 * غير المتوقَّع فقط (أعطال DB ونحوها) يبقى مرمياً.
 */
function expectedError(err: unknown): string | null {
  if (err instanceof Error && /[؀-ۿ]/.test(err.message)) return err.message;
  return null;
}

/**
 * إضافة مرحلة جديدة
 */
export async function createStage(input: { name: string; color: string }) {
  try {
    const { tenantId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN);

    const name = input.name.trim();
    if (!name || name.length > 100) {
      return { success: false as const, error: "اسم المرحلة غير صالح" } satisfies Fail;
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(input.color)) {
      return { success: false as const, error: "لون غير صالح" } satisfies Fail;
    }

    // max(position) + insert في معاملة واحدة — بلا ذلك كان إنشاء مرحلتين
    // متزامنتين يقرأ نفس max فيُنتج position مكرراً
    const stage = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ maxPos: sql<number>`COALESCE(MAX(${pipelineStages.position}), -1)` })
        .from(pipelineStages)
        .where(
          and(
            eq(pipelineStages.tenantId, tenantId),
            isNull(pipelineStages.archivedAt),
          ),
        );

      const nextPosition = (existing[0]?.maxPos ?? -1) + 1;

      const [created] = await tx
        .insert(pipelineStages)
        .values({
          tenantId,
          name,
          color: input.color,
          position: nextPosition,
          isDefault: false,
        })
        .returning();
      return created;
    });

    revalidatePath("/pipeline");
    return { success: true as const, stage };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * تعديل مرحلة
 */
export async function updateStage(input: {
  stageId: string;
  name: string;
  color: string;
}) {
  try {
    const { tenantId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN);
    await assertStageInTenant(input.stageId, tenantId);

    const name = input.name.trim();
    if (!name || name.length > 100) {
      return { success: false as const, error: "اسم المرحلة غير صالح" } satisfies Fail;
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(input.color)) {
      return { success: false as const, error: "لون غير صالح" } satisfies Fail;
    }

    const [updated] = await db
      .update(pipelineStages)
      .set({ name, color: input.color })
      .where(and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)))
      .returning();

    revalidatePath("/pipeline");
    return { success: true as const, stage: updated };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
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
  try {
    const { tenantId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN);
    await assertStageInTenant(input.stageId, tenantId);

    // count-check + فحوص المرحلة + الأرشفة في معاملة واحدة — check-then-act
    // المنفصل كان يسمح بأرشفة مرحلة بينما يُسنَد لها عميل في نفس اللحظة
    const result = await db.transaction(async (tx) => {
      const [{ leadsCount }] = await tx
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
          success: false as const,
          error: `لا يمكن أرشفة هذه المرحلة لأنها تحتوي على ${leadsCount} عميل. انقل العملاء أولاً (سحب على Kanban).`,
        };
      }

      const stage = await tx.query.pipelineStages.findFirst({
        where: and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)),
      });

      if (!stage) return { success: false as const, error: "المرحلة غير موجودة" };
      if (stage.archivedAt) return { success: false as const, error: "المرحلة مؤرشفة بالفعل" };
      if (stage.isDefault) {
        return {
          success: false as const,
          error: "لا يمكن أرشفة المرحلة الافتراضية. عيّن مرحلة أخرى افتراضية أولاً.",
        };
      }

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

      return { success: true as const };
    });

    if (!result.success) return result;

    revalidatePath("/pipeline");
    revalidatePath("/leads");
    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * إعادة تفعيل مرحلة مؤرشفة — تعود للـ Kanban بنفس بياناتها.
 * توضع في النهاية بعد آخر مرحلة نشطة.
 */
export async function unarchiveStage(input: { stageId: string }) {
  try {
    const { tenantId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN);
    // نسمح بالمرحلة المؤرشفة لأن هذه عملية الاسترجاع
    await assertStageInTenant(input.stageId, tenantId, { allowArchived: true });

    const stage = await db.query.pipelineStages.findFirst({
      where: and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)),
    });
    if (!stage) return { success: false as const, error: "المرحلة غير موجودة" } satisfies Fail;
    if (!stage.archivedAt) {
      return { success: false as const, error: "المرحلة نشطة بالفعل" } satisfies Fail;
    }

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
    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * جلب المراحل المؤرشفة — لعرضها في "قسم الأرشيف"
 */
export async function getArchivedStages() {
  try {
    const { tenantId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN);

    const stages = await db
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

    return { success: true as const, stages };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * إعادة ترتيب المراحل
 */
export async function reorderStages(input: { stageIds: string[] }) {
  try {
    const { tenantId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN);

    if (!Array.isArray(input?.stageIds) || input.stageIds.length === 0 || input.stageIds.length > 50) {
      return { success: false as const, error: "عدد المراحل غير صالح" } satisfies Fail;
    }

    // فحص الملكية + إسناد المواقع في معاملة واحدة — تسلسل ذرّي لا يقرأ حالة
    // تغيّرت بين التحقق والكتابة
    await db.transaction(async (tx) => {
      // تحقق أن كل الـ stageIds تخص هذا tenant
      const owned = await tx
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
    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * تعيين مرحلة كافتراضية
 */
export async function setDefaultStage(input: { stageId: string }) {
  try {
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
    return { success: true as const, stage: updated };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * تبديل حصرية مرحلة
 */
export async function toggleExclusive(input: { stageId: string }) {
  try {
    const { tenantId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN);
    await assertStageInTenant(input.stageId, tenantId);

    const stage = await db.query.pipelineStages.findFirst({
      where: and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)),
    });
    if (!stage) return { success: false as const, error: "المرحلة غير موجودة" } satisfies Fail;

    const [updated] = await db
      .update(pipelineStages)
      .set({ isExclusive: !stage.isExclusive })
      .where(and(eq(pipelineStages.id, input.stageId), eq(pipelineStages.tenantId, tenantId)))
      .returning();

    revalidatePath("/pipeline");
    revalidatePath("/leads");
    return { success: true as const, stage: updated };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}
