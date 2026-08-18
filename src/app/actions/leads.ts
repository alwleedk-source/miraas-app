"use server";

import { db } from "@/db";
import { leads, followUps, activityLog, pipelineStages, notifications, leadSources, users } from "@/db/schema";
import { eq, and, desc, asc, ilike, or, count, sql, inArray, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { normalizePhoneStrict, isUuid } from "@/lib/utils";
import {
  assertLeadInTenant,
  assertUserInTenant,
  assertStageInTenant,
  assertSourceInTenant,
  assertCoordinatorCanAccessLead,
  coordinatorLeadVisibilityCondition,
  assertRole,
  ROLE,
} from "@/lib/tenant-guards";
import {
  createLeadSchema,
  updateLeadSchema,
  bulkImportSchema,
  bulkUpdateLeadsSchema,
  bulkDeleteLeadsSchema,
} from "@/lib/schemas";
import { backupPush } from "@/lib/backup-push";
import { buildBackupPayload, backupPushBatch } from "@/lib/backup-payload";

const getTenantId = requireTenant;

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
    if (err.message === "not_found") return "العنصر غير موجود أو ليس ضمن صلاحياتك";
    // رسائل الحراسات والتحقق الداخلية عربية مقصودة للمستخدم
    if (/[؀-ۿ]/.test(err.message)) return err.message;
  }
  return null;
}

// =============================================
// إنشاء عميل جديد
// =============================================

export async function createLead(raw: unknown) {
  try {
    const { tenantId, userId, role } = await getTenantId();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    const input = createLeadSchema.parse(raw);

    // تحقق من FK cross-tenant
    if (input.stageId) await assertStageInTenant(input.stageId, tenantId);
    if (input.sourceId) await assertSourceInTenant(input.sourceId, tenantId);
    if (input.assignedTo) await assertUserInTenant(input.assignedTo, tenantId);

    let stageId = input.stageId;
    if (!stageId) {
      const [defaultStage] = await db
        .select({ id: pipelineStages.id })
        .from(pipelineStages)
        .where(
          and(
            eq(pipelineStages.tenantId, tenantId),
            eq(pipelineStages.isDefault, true),
          ),
        )
        .limit(1);
      stageId = defaultStage?.id;
    }

    const assignedTo = input.assignedTo || (role === "COORDINATOR" ? userId : null);

    let resolvedSourceId = input.sourceId || null;
    if (!resolvedSourceId && input.sourceName?.trim()) {
      const srcName = input.sourceName.trim();
      const [existingSrc] = await db
        .select({ id: leadSources.id })
        .from(leadSources)
        .where(and(eq(leadSources.tenantId, tenantId), eq(leadSources.name, srcName)))
        .limit(1);

      if (existingSrc) {
        resolvedSourceId = existingSrc.id;
      } else {
        const [newSrc] = await db
          .insert(leadSources)
          .values({ tenantId, name: srcName, platform: "إضافة يدوية" })
          .returning();
        resolvedSourceId = newSrc.id;
      }
    }

    // تحقق صارم من الرقم — لو موجود يجب أن يكون صالحاً (E.164)
    let normalizedPhone: string | undefined;
    if (input.phone) {
      const r = normalizePhoneStrict(input.phone);
      if (!r.ok) throw new Error(`الرقم غير صالح: ${r.error}`);
      normalizedPhone = r.phone;
    }

    const lead = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(leads)
        .values({
          tenantId,
          name: input.name,
          phone: normalizedPhone,
          email: input.email ?? undefined,
          priority: input.priority,
          sourceId: resolvedSourceId,
          stageId: stageId || null,
          assignedTo,
        })
        .returning({ id: leads.id, name: leads.name, phone: leads.phone, priority: leads.priority });

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_CREATED",
        entityType: "lead",
        entityId: row.id,
        details: { leadName: input.name },
      });

      return row;
    });

    revalidatePath("/leads");
    revalidatePath("/");

    // 🔄 backup push — fire-and-forget لـ Google Sheet
    // بعد انتهاء المعاملة كي لا تُدفَع حالة غير مُثبَتة
    void buildBackupPayload(lead.id, tenantId, "lead.created").then((p) => {
      if (p) void backupPush(tenantId, p);
    });

    return { success: true as const, ...lead };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// تحديث عميل
// =============================================

export async function updateLead(raw: unknown) {
  try {
    const { tenantId, userId, role } = await getTenantId();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    const input = updateLeadSchema.parse(raw);

    await assertLeadInTenant(input.id, tenantId);
    // المنسق يحدّث عملاء ضمن نطاقه فقط (عملاءه + حملاته — منطق getLeads)
    await assertCoordinatorCanAccessLead(input.id, tenantId, userId, role);
    if (input.stageId) await assertStageInTenant(input.stageId, tenantId);
    if (input.sourceId) await assertSourceInTenant(input.sourceId, tenantId);
    if (input.assignedTo) await assertUserInTenant(input.assignedTo, tenantId);

    // تحقق صارم من الرقم — لو تم تغييره يجب أن يكون صالحاً (أو null للحذف)
    let phoneUpdate: string | null | undefined = undefined;
    if (input.phone !== undefined) {
      if (!input.phone) {
        phoneUpdate = null; // حذف الرقم
      } else {
        const r = normalizePhoneStrict(input.phone);
        if (!r.ok) throw new Error(`الرقم غير صالح: ${r.error}`);
        phoneUpdate = r.phone;
      }
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(leads)
        .set({
          ...(input.name && { name: input.name }),
          ...(phoneUpdate !== undefined && { phone: phoneUpdate }),
          ...(input.email !== undefined && { email: input.email }),
          ...(input.priority && { priority: input.priority }),
          ...(input.sourceId !== undefined && { sourceId: input.sourceId || null }),
          ...(input.stageId !== undefined && { stageId: input.stageId || null }),
          ...(input.assignedTo !== undefined && { assignedTo: input.assignedTo || null }),
          updatedAt: new Date(),
        })
        .where(and(eq(leads.id, input.id), eq(leads.tenantId, tenantId)))
        .returning({ id: leads.id, name: leads.name, phone: leads.phone, priority: leads.priority });

      if (!row) throw new Error("العميل غير موجود");

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_UPDATED",
        entityType: "lead",
        entityId: input.id,
        details: { changedFields: Object.keys(input).filter((k) => k !== "id") },
      });

      if (input.assignedTo && input.assignedTo !== userId) {
        await tx.insert(notifications).values({
          tenantId,
          userId: input.assignedTo,
          type: "LEAD_ASSIGNED",
          title: `تم تعيينك على عميل جديد: ${row.name}`,
          message: `قام المدير بتعيينك لمتابعة العميل "${row.name}"`,
        });
      }

      return row;
    });

    revalidatePath("/leads");
    revalidatePath("/");

    // 🔄 backup push — بعد المعاملة كي لا تُدفَع حالة غير مُثبَتة
    const event = input.assignedTo ? "lead.assigned" : "lead.updated";
    void buildBackupPayload(input.id, tenantId, event).then((p) => {
      if (p) void backupPush(tenantId, p);
    });

    return { success: true as const, ...updated };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// تغيير مرحلة العميل
// =============================================

export async function changeLeadStage(leadId: string, stageId: string) {
  try {
    const { tenantId, userId, role } = await getTenantId();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(leadId) || !isUuid(stageId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    await assertLeadInTenant(leadId, tenantId);
    // المنسق ينقل عملاء ضمن نطاقه فقط (عملاءه + حملاته — منطق getLeads)
    await assertCoordinatorCanAccessLead(leadId, tenantId, userId, role);
    await assertStageInTenant(stageId, tenantId);

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(leads)
        .set({ stageId, updatedAt: new Date() })
        .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
        .returning({ id: leads.id, name: leads.name });

      if (!row) throw new Error("العميل غير موجود");

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_STAGE_CHANGED",
        entityType: "lead",
        entityId: leadId,
        details: { newStageId: stageId },
      });

      return row;
    });

    revalidatePath("/leads");
    revalidatePath("/pipeline");
    revalidatePath("/");

    // 🔄 backup push — بعد المعاملة كي لا تُدفَع حالة غير مُثبَتة
    void buildBackupPayload(leadId, tenantId, "lead.stage_changed").then((p) => {
      if (p) void backupPush(tenantId, p);
    });

    return { success: true as const, ...updated };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// حذف عميل (soft delete)
// =============================================

export async function deleteLead(leadId: string) {
  try {
    const { tenantId, userId, role } = await getTenantId();
    assertRole(role, ROLE.OWNER_ADMIN);
    if (!isUuid(leadId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    await assertLeadInTenant(leadId, tenantId);

    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ name: leads.name })
        .from(leads)
        .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
        .limit(1);

      await tx
        .update(leads)
        .set({ isDeleted: true, bookingStatus: null, updatedAt: new Date() })
        .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)));

      // ألغِ أي follow-ups نشطة لمنع cron تذكير على lead محذوف
      await tx
        .update(followUps)
        .set({ completedAt: new Date() })
        .where(
          and(
            eq(followUps.leadId, leadId),
            eq(followUps.tenantId, tenantId),
            sql`${followUps.completedAt} IS NULL`,
          ),
        );

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_DELETED",
        entityType: "lead",
        entityId: leadId,
        details: { leadName: target?.name || "غير معروف" },
      });
    });

    revalidatePath("/leads");
    revalidatePath("/bookings");
    revalidatePath("/pipeline");
    revalidatePath("/");
    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// جلب العملاء مع الفلتر والبحث
// =============================================

export async function getLeads(options?: {
  search?: string;
  stageId?: string;
  priority?: string;
  assignedTo?: string;
  excludeExclusiveForUser?: string; // يخفي عملاء مراحل حصرية مُعيّنين لغيره
  page?: number;
  limit?: number;
}) {
  try {
    const { tenantId, userId: currentUserId, role } = await getTenantId();
    if (role === "PROVIDER") throw new Error("ليس لديك صلاحية");

    // clamp — لا OFFSET سالب ولا limit جامح (page/limit يأتيان من client)
    const rawPage = Math.trunc(options?.page ?? 1);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
    const rawLimit = Math.trunc(options?.limit ?? 50);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 200) : 50;
    const offset = (page - 1) * limit;

    const conditions = [
      eq(leads.tenantId, tenantId),
      eq(leads.isDeleted, false),
      // استثنِ المؤرشفين من القائمة الرئيسية — يظهرون فقط في /leads/archive
      sql`${leads.archivedAt} IS NULL`,
    ];

    if (options?.stageId) {
      conditions.push(eq(leads.stageId, options.stageId));
    }
    if (options?.priority) {
      conditions.push(eq(leads.priority, options.priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT"));
    }
    if (options?.assignedTo) {
      conditions.push(eq(leads.assignedTo, options.assignedTo));
    }

    // ✅ فلتر أمني على مستوى الخادم — لا يُعتمد على client:
    // COORDINATOR يرى فقط عملاءه + (إما حملاته الخاصة، أو المراحل غير الحصرية لو لم يُربَط بحملات)
    // المنطق مستخرج في coordinatorLeadVisibilityCondition ليعيد استخدامه كل
    // action يتعامل مع عميل واحد (assertCoordinatorCanAccessLead) بنفس القاعدة.
    if (role === "COORDINATOR") {
      const visibility = await coordinatorLeadVisibilityCondition(tenantId, currentUserId);
      if (visibility) conditions.push(visibility);
    }

    // فلتر إضافي اختياري من client (UX فقط، ليس أمنياً)
    if (options?.excludeExclusiveForUser) {
      const userId = options.excludeExclusiveForUser;
      conditions.push(
        sql`NOT (
          ${leads.assignedTo} IS NOT NULL
          AND ${leads.assignedTo} != ${userId}
          AND ${leads.stageId} IN (
            SELECT id FROM pipeline_stages
            WHERE tenant_id = ${tenantId} AND is_exclusive = true
          )
        )`,
      );
    }

    const whereClause = and(...conditions);

    // بحث server-side (name/phone ILIKE) — tenant-scoped ويستثني المؤرشفين
    // تلقائياً لأنه يبني فوق whereClause
    const searchClause = options?.search?.trim()
      ? and(
          whereClause,
          or(
            ilike(leads.name, `%${options.search.trim()}%`),
            ilike(leads.phone, `%${options.search.trim()}%`)
          )
        )
      : whereClause;

    const [rawData, [{ total }]] = await Promise.all([
      db
        .select({
          id: leads.id,
          name: leads.name,
          phone: leads.phone,
          email: leads.email,
          company: leads.company,
          priority: leads.priority,
          welcomeSentAt: leads.welcomeSentAt,
          createdAt: leads.createdAt,
          bookingStatus: leads.bookingStatus,
          bookingDate: leads.bookingDate,
          bookingService: leads.bookingService,
          bookingNotes: leads.bookingNotes,
          assignedUser: {
            id: users.id,
            name: users.name,
            image: users.image,
          },
          stage: {
            id: pipelineStages.id,
            name: pipelineStages.name,
            color: pipelineStages.color,
          },
          source: {
            id: leadSources.id,
            name: leadSources.name,
            platform: leadSources.platform,
          },
          nextFollowUpDate: sql<string | null>`(
            SELECT MIN(scheduled_at) FROM follow_ups
            WHERE follow_ups.lead_id = ${leads.id}
              AND follow_ups.completed_at IS NULL
              AND follow_ups.scheduled_at IS NOT NULL
          )`.as("next_follow_up_date"),
        })
        .from(leads)
        .leftJoin(users, eq(leads.assignedTo, users.id))
        .leftJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
        .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
        .where(searchClause)
        .orderBy(desc(leads.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(leads)
        .where(searchClause),
    ]);

    // تحويل النتائج: leftJoin يرجع null للعلاقات الفارغة
    const data = rawData.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      company: row.company,
      priority: row.priority,
      welcomeSentAt: row.welcomeSentAt,
      createdAt: row.createdAt,
      bookingStatus: row.bookingStatus,
      bookingDate: row.bookingDate,
      bookingService: row.bookingService,
      bookingNotes: row.bookingNotes,
      assignedUser: row.assignedUser?.id ? row.assignedUser : null,
      stage: row.stage?.id ? row.stage : null,
      source: row.source?.id ? row.source : null,
      nextFollowUpDate: row.nextFollowUpDate ? new Date(row.nextFollowUpDate) : null,
    }));

    return { success: true as const, data, total, page, limit, totalPages: Math.ceil(total / limit) };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// جلب عميل واحد مع التفاصيل
// =============================================

export async function getLeadById(leadId: string) {
  try {
    const { tenantId, userId, role } = await getTenantId();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(leadId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    await assertLeadInTenant(leadId, tenantId);
    // المنسق يرى عملاء ضمن نطاقه فقط (عملاءه + حملاته — منطق getLeads)
    await assertCoordinatorCanAccessLead(leadId, tenantId, userId, role);

    // جلب العميل الأساسي
    const [lead] = await db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        company: leads.company,
        priority: leads.priority,
        welcomeSentAt: leads.welcomeSentAt,
        createdAt: leads.createdAt,
        updatedAt: leads.updatedAt,
        assignedUser: {
          id: users.id,
          name: users.name,
          image: users.image,
        },
        stage: {
          id: pipelineStages.id,
          name: pipelineStages.name,
          color: pipelineStages.color,
        },
        source: {
          id: leadSources.id,
          name: leadSources.name,
          platform: leadSources.platform,
        },
      })
      .from(leads)
      .leftJoin(users, eq(leads.assignedTo, users.id))
      .leftJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
      .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
      .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId), eq(leads.isDeleted, false)))
      .limit(1);

    if (!lead) throw new Error("العميل غير موجود");

    return {
      success: true as const,
      ...lead,
      assignedUser: lead.assignedUser?.id ? lead.assignedUser : null,
      stage: lead.stage?.id ? lead.stage : null,
      source: lead.source?.id ? lead.source : null,
    };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// إضافة متابعة
// =============================================

export async function createFollowUp(input: {
  leadId: string;
  type: "CALL" | "MESSAGE" | "MEETING" | "EMAIL" | "WHATSAPP" | "NOTE";
  notes?: string;
  scheduledAt?: Date;
}) {
  try {
    const { tenantId, userId, role } = await getTenantId();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(input.leadId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    await assertLeadInTenant(input.leadId, tenantId);
    // المنسق يتابع عملاء ضمن نطاقه فقط (عملاءه + حملاته — منطق getLeads)
    await assertCoordinatorCanAccessLead(input.leadId, tenantId, userId, role);

    const followUp = await db.transaction(async (tx) => {
      const [fu] = await tx
        .insert(followUps)
        .values({
          tenantId,
          leadId: input.leadId,
          userId,
          type: input.type,
          notes: input.notes?.slice(0, 2000),
          scheduledAt: input.scheduledAt,
        })
        .returning();

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "FOLLOW_UP_CREATED",
        entityType: "follow_up",
        entityId: fu.id,
        details: { leadId: input.leadId, type: input.type },
      });

      return fu;
    });

    revalidatePath("/leads");
    revalidatePath("/");

    // 🔄 backup push — متابعة جديدة تظهر في Sheet (بعد المعاملة)
    void buildBackupPayload(input.leadId, tenantId, "lead.followup_added", {
      note: `${input.type}${input.notes ? `: ${input.notes.slice(0, 100)}` : ""}`,
    }).then((p) => {
      if (p) void backupPush(tenantId, p);
    });

    return { success: true as const, followUp };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// جلب متابعات عميل
// =============================================

export async function getFollowUps(leadId: string) {
  try {
    const { tenantId, userId, role } = await getTenantId();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(leadId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    await assertLeadInTenant(leadId, tenantId);
    // المنسق يرى متابعات عملاء ضمن نطاقه فقط
    await assertCoordinatorCanAccessLead(leadId, tenantId, userId, role);

    const data = await db.query.followUps.findMany({
      where: and(
        eq(followUps.leadId, leadId),
        eq(followUps.tenantId, tenantId)
      ),
      with: {
        user: { columns: { id: true, name: true, image: true } },
      },
      orderBy: [desc(followUps.createdAt)],
    });

    return { success: true as const, followUps: data };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// إحصائيات لوحة التحكم
// =============================================

export async function getDashboardStats() {
  try {
    const { tenantId, role } = await getTenantId();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

    // dashboard يستثني المؤرشفين ليطابق ما يراه المستخدم في /leads
    const notArchived = sql`${leads.archivedAt} IS NULL`;

    // "اليوم" بحدود الرياض — ::date = CURRENT_DATE كان يُحسَب بتوقيت جلسة DB (UTC)
    // فينزاح اليوم 3 ساعات (يُسقط عملاء فجر الرياض ويضمّ عملاء فجر الغد).
    const now = new Date();
    const riyadhStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
    const [ry, rm, rd] = riyadhStr.split("-").map(Number);
    const todayStart = new Date(Date.UTC(ry, rm - 1, rd, -3, 0, 0));
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const [
      totalLeads,
      todayLeads,
      todayFollowUps,
      stageBreakdown,
    ] = await Promise.all([
      // إجمالي العملاء (بدون مؤرشفين)
      db
        .select({ count: count() })
        .from(leads)
        .where(and(eq(leads.tenantId, tenantId), eq(leads.isDeleted, false), notArchived)),
      // عملاء اليوم
      db
        .select({ count: count() })
        .from(leads)
        .where(
          and(
            eq(leads.tenantId, tenantId),
            eq(leads.isDeleted, false),
            notArchived,
            gte(leads.createdAt, todayStart),
            lt(leads.createdAt, todayEnd)
          )
        ),
      // متابعات مجدولة لليوم (Fix #3: scheduledAt بدل createdAt)
      db
        .select({ count: count() })
        .from(followUps)
        .where(
          and(
            eq(followUps.tenantId, tenantId),
            gte(followUps.scheduledAt, todayStart),
            lt(followUps.scheduledAt, todayEnd),
            sql`${followUps.completedAt} IS NULL`
          )
        ),
      // توزيع المراحل (بدون مؤرشفين)
      db
        .select({
          stageId: leads.stageId,
          stageName: pipelineStages.name,
          stageColor: pipelineStages.color,
          count: count(),
        })
        .from(leads)
        .leftJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
        .where(and(eq(leads.tenantId, tenantId), eq(leads.isDeleted, false), notArchived))
        .groupBy(leads.stageId, pipelineStages.name, pipelineStages.color, pipelineStages.position)
        .orderBy(asc(pipelineStages.position)),
    ]);

    return {
      success: true as const,
      totalLeads: totalLeads[0]?.count || 0,
      todayLeads: todayLeads[0]?.count || 0,
      todayFollowUps: todayFollowUps[0]?.count || 0,
      stageBreakdown,
    };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// التحقق من الأرقام المكررة
// =============================================

export async function checkDuplicatePhones(phones: string[]) {
  try {
    const { tenantId, role } = await getTenantId();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

    // سقف حماية — بلا حد كانت array ضخمة تبني استعلام IN(...) عملاقاً
    if (!Array.isArray(phones) || phones.length > 500) {
      return { success: false as const, error: "الحد الأقصى 500 رقم في المرة الواحدة" } satisfies Fail;
    }
    if (phones.length === 0) return { success: true as const, duplicates: [] };

    // نطبّع بنفس منطق الاستيراد الصارم (normalizePhoneStrict) لتطابق المعاينة ما
    // يحفظه/يتخطّاه الاستيراد فعلاً. الأرقام غير الصالحة لن تُستورَد → نتجاهلها هنا
    // (سابقاً كان التطبيع المتساهل يُنتج صيغاً مختلفة عن المخزّن E.164 فتُفوَّت مكررات).
    const normalizedPhones = [
      ...new Set(
        phones
          .map((p) => normalizePhoneStrict(p))
          .filter((r): r is { ok: true; phone: string } => r.ok)
          .map((r) => r.phone),
      ),
    ];
    if (normalizedPhones.length === 0) return { success: true as const, duplicates: [] };

    const existing = await db
      .select({ phone: leads.phone, isDeleted: leads.isDeleted })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          inArray(leads.phone, normalizedPhones)
        )
      );

    return {
      success: true as const,
      duplicates: existing.map((e) => ({
        phone: e.phone,
        status: e.isDeleted ? "deleted" as const : "active" as const,
      })),
    };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// استيراد عملاء بالجملة (من ملف Sheet)
// =============================================

export async function bulkImportLeads(raw: unknown) {
  try {
    const { tenantId, userId, role } = await getTenantId();
    assertRole(role, ROLE.OWNER_ADMIN);
    const input = bulkImportSchema.parse(raw);

    let createdIds: string[] = [];

    const result = await db.transaction(async (tx) => {
      // 1. إنشاء/إيجاد المصدر
      let sourceId: string | null = null;
      if (input.campaignName.trim()) {
        const [existingSource] = await tx
          .select({ id: leadSources.id })
          .from(leadSources)
          .where(
            and(
              eq(leadSources.tenantId, tenantId),
              eq(leadSources.name, input.campaignName.trim()),
            ),
          )
          .limit(1);

        if (existingSource) {
          sourceId = existingSource.id;
        } else {
          const [newSource] = await tx
            .insert(leadSources)
            .values({
              tenantId,
              name: input.campaignName.trim(),
              platform: "Sheet Import",
            })
            .returning();
          sourceId = newSource.id;
        }
      }

      // 2. المرحلة الافتراضية
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

      // 3. تحقق صارم من كل رقم — يفصل بين: صالح / فارغ / غير صالح
      type Categorized = { name: string; phone: string }; // صالح فقط
      const valid: Categorized[] = [];
      let skippedNoPhone = 0;
      let skippedInvalid = 0;
      for (const e of input.leads) {
        if (!e.phone || !String(e.phone).trim()) {
          skippedNoPhone++;
          continue;
        }
        const r = normalizePhoneStrict(e.phone);
        if (!r.ok) {
          skippedInvalid++;
          continue;
        }
        valid.push({ name: e.name, phone: r.phone });
      }

      // 4a. إزالة التكرار داخل الملف نفسه أولاً — leads.phone بلا قيد فريد، فبدون
      // هذا يُدرَج نفس الرقم مرّتين إن تكرّر في الملف المستورد.
      const seenInFile = new Set<string>();
      const deduped = valid.filter((e) => {
        if (seenInFile.has(e.phone)) return false;
        seenInFile.add(e.phone);
        return true;
      });
      const skippedInFileDup = valid.length - deduped.length;

      // 4b. فحص المكررات الموجودة مسبقاً في قاعدة البيانات
      const phones = deduped.map((e) => e.phone);
      const existing =
        phones.length > 0
          ? await tx
              .select({ phone: leads.phone })
              .from(leads)
              .where(
                and(eq(leads.tenantId, tenantId), inArray(leads.phone, phones)),
              )
          : [];
      const existingSet = new Set(existing.map((e) => e.phone));
      const toInsert = deduped.filter((e) => !existingSet.has(e.phone));
      // skippedDuplicate يشمل: مكررات الملف + مكررات قاعدة البيانات
      const skippedDuplicate = deduped.length - toInsert.length + skippedInFileDup;

      if (toInsert.length > 0) {
        const inserted = await tx
          .insert(leads)
          .values(
            toInsert.map((e) => ({
              tenantId,
              name: e.name,
              phone: e.phone,
              priority: "MEDIUM" as const,
              stageId: defaultStage?.id || null,
              sourceId,
            })),
          )
          .returning({ id: leads.id });
        createdIds = inserted.map((r) => r.id);
      }

      const created = toInsert.length;
      const totalSkipped = skippedNoPhone + skippedInvalid + skippedDuplicate;

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_CREATED",
        entityType: "lead",
        details: {
          bulkImport: true,
          campaign: input.campaignName,
          created,
          skippedNoPhone,
          skippedInvalid,
          skippedDuplicate,
        },
      });

      // skipped للتوافق العكسي مع UI القديمة
      return { created, skipped: totalSkipped, skippedNoPhone, skippedInvalid, skippedDuplicate };
    });

    revalidatePath("/leads");
    revalidatePath("/");

    // 🔄 backup push — كل lead مستورد يصل للـ Sheet (بـ batches)
    // بعد انتهاء المعاملة كي لا تُدفَع حالة غير مُثبَتة
    if (createdIds.length > 0) {
      void backupPushBatch(createdIds, tenantId, "lead.created", {
        note: `bulk import: ${input.campaignName}`,
      });
    }

    return { success: true as const, ...result };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// عمليات جماعية على السيرفر — يمنع Promise.all DoS في العميل
// =============================================

/**
 * تحديث جماعي (تعيين / نقل مرحلة) — UPDATE واحد في DB بدل N
 */
export async function bulkUpdateLeads(raw: unknown) {
  try {
    const { tenantId, userId, role } = await getTenantId();
    assertRole(role, ROLE.OWNER_ADMIN);
    const input = bulkUpdateLeadsSchema.parse(raw);

    // تحقق أن كل الـ ids للـ tenant (يمنع cross-tenant update)
    const owned = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(inArray(leads.id, input.ids), eq(leads.tenantId, tenantId)));
    if (owned.length !== input.ids.length) {
      throw new Error("بعض العملاء غير موجودين أو ليسوا ضمن صلاحياتك");
    }

    if (input.patch.assignedTo) {
      await assertUserInTenant(input.patch.assignedTo, tenantId);
    }
    if (input.patch.stageId) {
      await assertStageInTenant(input.patch.stageId, tenantId);
    }

    const setObj: Record<string, unknown> = { updatedAt: new Date() };
    if (input.patch.assignedTo !== undefined) setObj.assignedTo = input.patch.assignedTo;
    if (input.patch.stageId !== undefined) setObj.stageId = input.patch.stageId;

    await db.transaction(async (tx) => {
      await tx
        .update(leads)
        .set(setObj)
        .where(and(inArray(leads.id, input.ids), eq(leads.tenantId, tenantId)));

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_UPDATED",
        entityType: "lead",
        details: {
          bulk: true,
          count: input.ids.length,
          changedFields: Object.keys(input.patch),
        },
      });
    });

    revalidatePath("/leads");
    revalidatePath("/");

    // 🔄 backup push — كل lead مُحدَّث يصل للـ Sheet
    const event = input.patch.assignedTo ? "lead.assigned" : "lead.updated";
    void backupPushBatch(input.ids, tenantId, event, { note: "bulk update" });

    return { success: true as const, updated: input.ids.length };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * حذف جماعي (soft) — UPDATE واحد
 */
export async function bulkDeleteLeads(raw: unknown) {
  try {
    const { tenantId, userId, role } = await getTenantId();
    assertRole(role, ROLE.OWNER_ADMIN);
    const input = bulkDeleteLeadsSchema.parse(raw);

    const owned = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(inArray(leads.id, input.ids), eq(leads.tenantId, tenantId)));
    if (owned.length !== input.ids.length) {
      throw new Error("بعض العملاء غير موجودين أو ليسوا ضمن صلاحياتك");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(leads)
        .set({ isDeleted: true, bookingStatus: null, updatedAt: new Date() })
        .where(and(inArray(leads.id, input.ids), eq(leads.tenantId, tenantId)));

      // ألغِ follow-ups المرتبطة لمنع cron تذكير على leads محذوفين
      await tx
        .update(followUps)
        .set({ completedAt: new Date() })
        .where(
          and(
            inArray(followUps.leadId, input.ids),
            eq(followUps.tenantId, tenantId),
            sql`${followUps.completedAt} IS NULL`,
          ),
        );

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_DELETED",
        entityType: "lead",
        details: { bulk: true, count: input.ids.length },
      });
    });

    revalidatePath("/leads");
    revalidatePath("/");

    // 🔄 backup push — يُعلم Sheet بالحذف ليُعرف أي صفوف لم تعد نشطة
    void backupPushBatch(input.ids, tenantId, "lead.deleted", { note: "bulk delete" });

    return { success: true as const, deleted: input.ids.length };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// عملاء مُهمَلون (Aging Leads) — لم يُتابَعون منذ X يوم
// =============================================

export type AgingLead = {
  id: string;
  name: string;
  phone: string | null;
  createdAt: Date;
  assignedTo: string | null;
  assignedUserName: string | null;
  stageName: string | null;
  stageColor: string | null;
  sourceName: string | null;
  lastActivityAt: Date;
  daysSilent: number;
  severity: "warning" | "critical"; // warning: 3-6 يوم، critical: 7+
};

/**
 * جلب العملاء الذين لم يحدث لهم تواصل (follow-up) منذ X أيام
 * يحدد "آخر نشاط" = آخر follow_up أو وقت الإنشاء إن لم يكن هناك متابعات
 *
 * COORDINATOR: يرى عملاءه فقط
 * OWNER/ADMIN: يرى الكل
 * PROVIDER: قائمة فارغة
 */
export async function getAgingLeads(
  minDays: number = 3,
): Promise<{ success: true; leads: AgingLead[] } | Fail> {
  try {
    const { tenantId, userId, role } = await getTenantId();
    if (role === "PROVIDER") return { success: true as const, leads: [] };
    if (!Number.isFinite(minDays) || minDays < 1 || minDays > 365) {
      return { success: false as const, error: "minDays غير صالح" } satisfies Fail;
    }

    const cutoff = new Date(Date.now() - minDays * 86400_000);
    // "آخر نشاط" = COALESCE(آخر follow_up, createdAt) — الفلتر والترتيب في SQL
    // نفسه (كان يجلب كل العملاء ثم يصفّي في JS — ثقيل على tenants الكبيرة)
    const lastActivitySql = sql`COALESCE(
      (SELECT MAX(created_at) FROM follow_ups WHERE follow_ups.lead_id = ${leads.id}),
      ${leads.createdAt}
    )`;

    const conditions = [
      eq(leads.tenantId, tenantId),
      eq(leads.isDeleted, false),
      sql`${leads.bookingStatus} IS NULL`,
      // المؤرشفون يخرجون من قائمة المُهمَلين — هم قرار قصدي
      sql`${leads.archivedAt} IS NULL`,
      sql`${lastActivitySql} <= ${cutoff}`,
    ];
    if (role === "COORDINATOR") {
      conditions.push(eq(leads.assignedTo, userId));
    }

    const rows = await db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        createdAt: leads.createdAt,
        assignedTo: leads.assignedTo,
        assignedUserName: users.name,
        stageName: pipelineStages.name,
        stageColor: pipelineStages.color,
        sourceName: leadSources.name,
        lastActivityRaw: sql<string>`${lastActivitySql}`.as("last_activity_raw"),
      })
      .from(leads)
      .leftJoin(users, eq(leads.assignedTo, users.id))
      .leftJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
      .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
      .where(and(...conditions))
      // الأقدم نشاطاً أولاً = الأكثر إهمالاً — مع سقف حماية
      .orderBy(asc(lastActivitySql))
      .limit(200);

    const now = Date.now();

    const aging = rows.map((r) => {
      const lastActivityAt = new Date(r.lastActivityRaw);
      const daysSilent = Math.floor((now - lastActivityAt.getTime()) / 86400_000);
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        createdAt: r.createdAt,
        assignedTo: r.assignedTo,
        assignedUserName: r.assignedUserName,
        stageName: r.stageName,
        stageColor: r.stageColor,
        sourceName: r.sourceName,
        lastActivityAt,
        daysSilent,
        severity: (daysSilent >= 7 ? "critical" : "warning") as "warning" | "critical",
      };
    });

    return { success: true as const, leads: aging };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * عدد سريع للـ aging leads — للـ banner في dashboard
 * أرخص من جلب الكل (يستخدم COUNT)
 */
export async function getAgingLeadsCount(minDays: number = 3): Promise<
  | {
      success: true;
      total: number;
      critical: number; // 7+ days
      byCoordinator: Array<{ userId: string; userName: string; count: number }>;
    }
  | Fail
> {
  try {
    const { tenantId, userId, role } = await getTenantId();
    if (role === "PROVIDER") {
      return { success: true as const, total: 0, critical: 0, byCoordinator: [] };
    }
    if (!Number.isFinite(minDays) || minDays < 1 || minDays > 365) {
      return { success: false as const, error: "minDays غير صالح" } satisfies Fail;
    }

    const cutoffWarning = new Date(Date.now() - minDays * 86400_000);
    const cutoffCritical = new Date(Date.now() - 7 * 86400_000);

    const baseConditions = [
      eq(leads.tenantId, tenantId),
      eq(leads.isDeleted, false),
      sql`${leads.bookingStatus} IS NULL`,
      sql`${leads.archivedAt} IS NULL`,
      sql`COALESCE(
        (SELECT MAX(created_at) FROM follow_ups WHERE follow_ups.lead_id = ${leads.id}),
        ${leads.createdAt}
      ) <= ${cutoffWarning}`,
    ];
    if (role === "COORDINATOR") {
      baseConditions.push(eq(leads.assignedTo, userId));
    }

    const [totalRow] = await db
      .select({ c: count() })
      .from(leads)
      .where(and(...baseConditions));

    const [criticalRow] = await db
      .select({ c: count() })
      .from(leads)
      .where(
        and(
          ...baseConditions,
          sql`COALESCE(
            (SELECT MAX(created_at) FROM follow_ups WHERE follow_ups.lead_id = ${leads.id}),
            ${leads.createdAt}
          ) <= ${cutoffCritical}`,
        ),
      );

    // breakdown per coordinator (OWNER/ADMIN only)
    let byCoordinator: Array<{ userId: string; userName: string; count: number }> = [];
    if (role !== "COORDINATOR") {
      const grouped = await db
        .select({
          userId: leads.assignedTo,
          userName: users.name,
          c: count(),
        })
        .from(leads)
        .leftJoin(users, eq(leads.assignedTo, users.id))
        .where(and(...baseConditions, sql`${leads.assignedTo} IS NOT NULL`))
        .groupBy(leads.assignedTo, users.name)
        .orderBy(desc(count()))
        .limit(10);

      byCoordinator = grouped
        .filter((g) => g.userId)
        .map((g) => ({
          userId: g.userId!,
          userName: g.userName ?? "غير معروف",
          count: g.c,
        }));
    }

    return {
      success: true as const,
      total: totalRow?.c ?? 0,
      critical: criticalRow?.c ?? 0,
      byCoordinator,
    };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}
