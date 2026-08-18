"use server";

import { db } from "@/db";
import { leads, followUps, activityLog, users, leadSources, pipelineStages } from "@/db/schema";
import { eq, and, isNull, isNotNull, desc, count, lte, ilike, or, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import {
  assertLeadInTenant,
  assertUserInTenant,
  assertCoordinatorCanAccessLead,
  assertRole,
  ROLE,
} from "@/lib/tenant-guards";
import { parseRiyadhDateTime, isUuid } from "@/lib/utils";
import { archiveLeadSchema } from "@/lib/schemas";
import { backupPush } from "@/lib/backup-push";
import { buildBackupPayload } from "@/lib/backup-payload";

type Fail = { success: false; error: string };

/**
 * عقد الأخطاء الموحّد: Next.js في production يُخفي رسائل الأخطاء المرمية من
 * server actions فيرى المستخدم نصاً إنجليزياً عاماً. لذا كل خطأ متوقَّع
 * (تحقق/صلاحية/غير موجود) يُعاد كـ { success: false, error: "عربي" }.
 * غير المتوقَّع فقط (أعطال DB ونحوها) يبقى مرمياً.
 */
function expectedError(err: unknown): string | null {
  if (err instanceof z.ZodError) {
    const msg = err.issues[0]?.message;
    // رسائل zod المدمجة إنجليزية — لا تُعرض كما هي
    return msg && /[؀-ۿ]/.test(msg) ? msg : "بيانات غير صالحة — تحقق من المدخلات";
  }
  if (err instanceof Error) {
    // رسائل الحراسات والتحقق الداخلية عربية مقصودة للمستخدم
    if (/[؀-ۿ]/.test(err.message)) return err.message;
  }
  return null;
}

/**
 * أرشف عميل مع سبب — لا يُحذف، يُحفظ في "archived list" للعودة لاحقاً
 *
 * الإجراءات الذرّية في transaction:
 *   1. set archivedAt + reason + (optional reactivateAt)
 *   2. canRecontact = false إذا DO_NOT_CONTACT
 *   3. إلغاء كل follow-ups المعلّقة (لا تذكيرات لعميل مؤرشف)
 *   4. activity log
 */
export async function archiveLead(raw: unknown) {
  try {
    const { tenantId, userId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    const input = archiveLeadSchema.parse(raw);
    await assertLeadInTenant(input.leadId, tenantId);
    // المنسق يؤرشف عملاء ضمن نطاقه فقط (عملاءه + حملاته — منطق getLeads) —
    // سابقاً كان يستطيع أرشفة أي عميل في الشركة
    await assertCoordinatorCanAccessLead(input.leadId, tenantId, userId, role);

    await db.transaction(async (tx) => {
      await tx
        .update(leads)
        .set({
          archivedAt: new Date(),
          archiveReason: input.reason,
          archiveNote: input.note?.trim() || null,
          reactivateAt: input.reactivateAt ? parseRiyadhDateTime(input.reactivateAt) : null,
          canRecontact: input.reason !== "DO_NOT_CONTACT" && !input.isDoNotContact,
          updatedAt: new Date(),
        })
        .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId)));

      // ألغِ كل follow-ups معلّقة — لا تذكيرات لعميل مؤرشف
      await tx
        .update(followUps)
        .set({ completedAt: new Date() })
        .where(
          and(
            eq(followUps.leadId, input.leadId),
            eq(followUps.tenantId, tenantId),
            isNull(followUps.completedAt),
            isNotNull(followUps.scheduledAt),
          ),
        );

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_UPDATED",
        entityType: "lead",
        entityId: input.leadId,
        details: {
          action: "archived",
          reason: input.reason,
          reactivateAt: input.reactivateAt ?? null,
          dnc: input.reason === "DO_NOT_CONTACT" || input.isDoNotContact,
        },
      });
    });

    revalidatePath("/leads");
    revalidatePath("/leads/aging");
    revalidatePath("/leads/archive");
    revalidatePath("/");

    // 🔄 backup push (خارج المعاملة — لا تُدفَع حالة غير مُثبَتة)
    void buildBackupPayload(input.leadId, tenantId, "lead.archived", {
      note: input.note,
    }).then((p) => {
      if (p) void backupPush(tenantId, p);
    });

    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * إعادة تفعيل عميل مؤرشف — يعود للـ pipeline العادي
 */
export async function unarchiveLead(leadId: string, note?: string) {
  try {
    const { tenantId, userId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(leadId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    await assertLeadInTenant(leadId, tenantId);
    // المنسق يعيد تفعيل عملاء ضمن نطاقه فقط — مثل archiveLead
    await assertCoordinatorCanAccessLead(leadId, tenantId, userId, role);

    // تحقق من DNC — لا يمكن إعادة عميل طلب عدم التواصل
    const [lead] = await db
      .select({ canRecontact: leads.canRecontact, archivedAt: leads.archivedAt })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
      .limit(1);
    if (!lead?.archivedAt) throw new Error("العميل ليس مؤرشفاً");
    if (!lead.canRecontact) {
      throw new Error("هذا العميل طلب عدم التواصل — لا يمكن إعادة تفعيله بدون موافقته");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(leads)
        .set({
          archivedAt: null,
          archiveReason: null,
          archiveNote: null,
          reactivateAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)));

      // أنشئ follow-up مكتمل ليُسجَّل أن المنسق أعاد التفعيل وفتح الباب
      await tx.insert(followUps).values({
        tenantId,
        leadId,
        userId,
        type: "NOTE",
        notes: `🔄 أُعيد تفعيل العميل من الأرشيف${note ? ` — ${note}` : ""}`,
        completedAt: new Date(),
      });

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_UPDATED",
        entityType: "lead",
        entityId: leadId,
        details: { action: "unarchived", note: note?.slice(0, 500) },
      });
    });

    revalidatePath("/leads");
    revalidatePath("/leads/archive");

    // 🔄 backup push (خارج المعاملة)
    void buildBackupPayload(leadId, tenantId, "lead.unarchived", { note }).then((p) => {
      if (p) void backupPush(tenantId, p);
    });

    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * جلب العملاء المؤرشفين — مع filter حسب السبب + بحث + pagination
 */
export async function getArchivedLeads(options?: {
  reason?: string;
  search?: string;
  dueForReactivation?: boolean; // فقط الذين حلّ موعد إعادة تفعيلهم
  page?: number;
  limit?: number;
}) {
  try {
    const { tenantId, userId, role } = await requireTenant();
    if (role === "PROVIDER") throw new Error("ليس لديك صلاحية");

    // clamp — لا OFFSET سالب ولا limit جامح
    const rawPage = Math.trunc(options?.page ?? 1);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
    const rawLimit = Math.trunc(options?.limit ?? 50);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 200) : 50;
    const offset = (page - 1) * limit;

    const conditions = [
      eq(leads.tenantId, tenantId),
      eq(leads.isDeleted, false),
      isNotNull(leads.archivedAt),
    ];

    if (role === "COORDINATOR") {
      conditions.push(eq(leads.assignedTo, userId));
    }
    if (options?.reason) {
      conditions.push(eq(leads.archiveReason, options.reason));
    }
    if (options?.dueForReactivation) {
      conditions.push(isNotNull(leads.reactivateAt));
      conditions.push(lte(leads.reactivateAt, new Date()));
    }
    if (options?.search?.trim()) {
      const q = `%${options.search.trim()}%`;
      const orExpr = or(ilike(leads.name, q), ilike(leads.phone, q));
      if (orExpr) conditions.push(orExpr);
    }

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: leads.id,
          name: leads.name,
          phone: leads.phone,
          archivedAt: leads.archivedAt,
          archiveReason: leads.archiveReason,
          archiveNote: leads.archiveNote,
          reactivateAt: leads.reactivateAt,
          canRecontact: leads.canRecontact,
          assignedUserName: users.name,
          sourceName: leadSources.name,
          stageName: pipelineStages.name,
        })
        .from(leads)
        .leftJoin(users, eq(leads.assignedTo, users.id))
        .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
        .leftJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
        .where(and(...conditions))
        .orderBy(desc(leads.archivedAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(leads).where(and(...conditions)),
    ]);

    return { success: true as const, data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * إعادة تفعيل جماعية — لحملات إعادة استهداف
 *   "كل من رفض السعر قبل 6 أشهر — أعدهم للدورة مع عرض جديد"
 *
 * يحترم DNC تلقائياً (لا يُعاد تفعيل من طلب عدم التواصل).
 */
export async function bulkReactivateLeads(input: {
  leadIds: string[];
  assignToUserId?: string;
  resetStage?: boolean; // إعادة لـ stage الافتراضي
  note?: string;
}) {
  try {
    const { tenantId, userId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN);

    if (!Array.isArray(input?.leadIds) || input.leadIds.length === 0 || input.leadIds.length > 500) {
      return { success: false as const, error: "اختر بين 1 و 500 عميل" } satisfies Fail;
    }
    // تحقق شكلي — ids تذهب خام إلى IN(...) في PG
    if (!input.leadIds.every(isUuid)) {
      return { success: false as const, error: "معرّف غير صالح ضمن القائمة" } satisfies Fail;
    }
    if (input.assignToUserId && !isUuid(input.assignToUserId)) {
      return { success: false as const, error: "معرّف المستخدم غير صالح" } satisfies Fail;
    }

    // 🔒 لو سنُسنِد الـ leads لمنسق، تأكّد أنه ضمن نفس الشركة (يمنع كتابة عبر الشركات).
    if (input.assignToUserId) {
      await assertUserInTenant(input.assignToUserId, tenantId);
    }

    // تحقق أن كل الـ leads تخص الـ tenant + مؤرشفين + قابلين للعودة
    const eligible = await db
      .select({ id: leads.id, name: leads.name })
      .from(leads)
      .where(
        and(
          inArray(leads.id, input.leadIds),
          eq(leads.tenantId, tenantId),
          isNotNull(leads.archivedAt),
          eq(leads.canRecontact, true), // يستثني DNC تلقائياً
        ),
      );

    if (eligible.length === 0) {
      return {
        success: true as const,
        reactivated: 0,
        skipped: input.leadIds.length,
        dncSkipped: input.leadIds.length,
      };
    }

    const eligibleIds = eligible.map((l) => l.id);
    const dncSkipped = input.leadIds.length - eligibleIds.length;

    await db.transaction(async (tx) => {
      const updateData: Record<string, unknown> = {
        archivedAt: null,
        archiveReason: null,
        archiveNote: null,
        reactivateAt: null,
        updatedAt: new Date(),
      };
      if (input.assignToUserId) {
        updateData.assignedTo = input.assignToUserId;
      }
      if (input.resetStage) {
        const [defaultStage] = await tx
          .select({ id: pipelineStages.id })
          .from(pipelineStages)
          .where(
            and(
              eq(pipelineStages.tenantId, tenantId),
              eq(pipelineStages.isDefault, true),
            ),
          )
          .limit(1);
        if (defaultStage) updateData.stageId = defaultStage.id;
      }

      await tx
        .update(leads)
        .set(updateData)
        .where(and(inArray(leads.id, eligibleIds), eq(leads.tenantId, tenantId)));

      // activity log واحد مجمّع — لا تُكرّر row لكل lead
      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_UPDATED",
        entityType: "lead",
        details: {
          action: "bulk_reactivate",
          count: eligibleIds.length,
          dncSkipped,
          assignTo: input.assignToUserId ?? null,
          note: input.note?.slice(0, 500),
        },
      });

      // follow-up note لكل عميل مُعاد للسجل
      if (input.note) {
        const noteValues = eligibleIds.map((leadId) => ({
          tenantId,
          leadId,
          userId,
          type: "NOTE" as const,
          notes: `🔄 أُعيد تفعيل ضمن حملة: ${input.note?.slice(0, 200)}`,
          completedAt: new Date(),
        }));
        // chunk to avoid 1000-row insert in single statement
        for (let i = 0; i < noteValues.length; i += 100) {
          await tx.insert(followUps).values(noteValues.slice(i, i + 100));
        }
      }
    });

    revalidatePath("/leads");
    revalidatePath("/leads/archive");
    revalidatePath("/");
    return {
      success: true as const,
      reactivated: eligibleIds.length,
      skipped: dncSkipped,
      dncSkipped,
    };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * إحصائيات الأرشيف للمالك — breakdown per reason
 */
export async function getArchiveStats() {
  try {
    const { tenantId, role } = await requireTenant();
    if (role === "PROVIDER") {
      return { success: true as const, byReason: [], dueForReactivation: 0, total: 0 };
    }

    const conditions = [
      eq(leads.tenantId, tenantId),
      eq(leads.isDeleted, false),
      isNotNull(leads.archivedAt),
    ];

    const [byReason, dueForReactivationRow, totalRow] = await Promise.all([
      db
        .select({
          reason: leads.archiveReason,
          c: count(),
        })
        .from(leads)
        .where(and(...conditions))
        .groupBy(leads.archiveReason)
        .orderBy(desc(count())),
      db
        .select({ c: count() })
        .from(leads)
        .where(
          and(
            ...conditions,
            isNotNull(leads.reactivateAt),
            lte(leads.reactivateAt, new Date()),
          ),
        ),
      db.select({ c: count() }).from(leads).where(and(...conditions)),
    ]);

    return {
      success: true as const,
      byReason: byReason
        .filter((b): b is { reason: string; c: number } => !!b.reason)
        .map((b) => ({ reason: b.reason, count: b.c })),
      dueForReactivation: dueForReactivationRow[0]?.c ?? 0,
      total: totalRow[0]?.c ?? 0,
    };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}
