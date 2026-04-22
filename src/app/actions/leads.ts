"use server";

import { db } from "@/db";
import { leads, followUps, activityLog, pipelineStages, notifications, leadSources, users } from "@/db/schema";
import { eq, and, desc, asc, ilike, or, count, sql, inArray } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { normalizePhone } from "@/lib/utils";
import {
  assertLeadInTenant,
  assertUserInTenant,
  assertStageInTenant,
  assertSourceInTenant,
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

const getTenantId = requireTenant;

// =============================================
// إنشاء عميل جديد
// =============================================

export async function createLead(raw: unknown) {
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

  return await db.transaction(async (tx) => {
    const [lead] = await tx
      .insert(leads)
      .values({
        tenantId,
        name: input.name,
        phone: input.phone ? normalizePhone(input.phone) : undefined,
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
      entityId: lead.id,
      details: { leadName: input.name },
    });

    revalidatePath("/leads");
    revalidatePath("/");
    return lead;
  });
}

// =============================================
// تحديث عميل
// =============================================

export async function updateLead(raw: unknown) {
  const { tenantId, userId, role } = await getTenantId();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  const input = updateLeadSchema.parse(raw);

  await assertLeadInTenant(input.id, tenantId);
  if (input.stageId) await assertStageInTenant(input.stageId, tenantId);
  if (input.sourceId) await assertSourceInTenant(input.sourceId, tenantId);
  if (input.assignedTo) await assertUserInTenant(input.assignedTo, tenantId);

  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(leads)
      .set({
        ...(input.name && { name: input.name }),
        ...(input.phone !== undefined && { phone: input.phone ? normalizePhone(input.phone) : null }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.priority && { priority: input.priority }),
        ...(input.sourceId !== undefined && { sourceId: input.sourceId || null }),
        ...(input.stageId !== undefined && { stageId: input.stageId || null }),
        ...(input.assignedTo !== undefined && { assignedTo: input.assignedTo || null }),
        updatedAt: new Date(),
      })
      .where(and(eq(leads.id, input.id), eq(leads.tenantId, tenantId)))
      .returning({ id: leads.id, name: leads.name, phone: leads.phone, priority: leads.priority });

    if (!updated) throw new Error("العميل غير موجود");

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
        title: `تم تعيينك على عميل جديد: ${updated.name}`,
        message: `قام المدير بتعيينك لمتابعة العميل "${updated.name}"`,
      });
    }

    revalidatePath("/leads");
    revalidatePath("/");
    return updated;
  });
}

// =============================================
// تغيير مرحلة العميل
// =============================================

export async function changeLeadStage(leadId: string, stageId: string) {
  const { tenantId, userId, role } = await getTenantId();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  await assertLeadInTenant(leadId, tenantId);
  await assertStageInTenant(stageId, tenantId);

  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(leads)
      .set({ stageId, updatedAt: new Date() })
      .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
      .returning({ id: leads.id, name: leads.name });

    if (!updated) throw new Error("العميل غير موجود");

    await tx.insert(activityLog).values({
      tenantId,
      userId,
      action: "LEAD_STAGE_CHANGED",
      entityType: "lead",
      entityId: leadId,
      details: { newStageId: stageId },
    });

    revalidatePath("/leads");
    revalidatePath("/pipeline");
    revalidatePath("/");
    return updated;
  });
}

// =============================================
// حذف عميل (soft delete)
// =============================================

export async function deleteLead(leadId: string) {
  const { tenantId, userId, role } = await getTenantId();
  assertRole(role, ROLE.OWNER_ADMIN);
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
  revalidatePath("/");
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
  const { tenantId, userId: currentUserId, role } = await getTenantId();
  if (role === "PROVIDER") throw new Error("ليس لديك صلاحية");

  const page = options?.page || 1;
  const limit = Math.min(options?.limit || 50, 200);
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
  // COORDINATOR يرى فقط عملاءه + عملاء المراحل غير الحصرية
  if (role === "COORDINATOR") {
    const orExpr = or(
      eq(leads.assignedTo, currentUserId),
      sql`${leads.stageId} NOT IN (
        SELECT id FROM pipeline_stages
        WHERE tenant_id = ${tenantId} AND is_exclusive = true
      )`,
    );
    if (orExpr) conditions.push(orExpr);
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

  // بحث
  const searchClause = options?.search
    ? and(
        whereClause,
        or(
          ilike(leads.name, `%${options.search}%`),
          ilike(leads.phone, `%${options.search}%`)
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

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

// =============================================
// جلب عميل واحد مع التفاصيل
// =============================================

export async function getLeadById(leadId: string) {
  const { tenantId } = await getTenantId();

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
    ...lead,
    assignedUser: lead.assignedUser?.id ? lead.assignedUser : null,
    stage: lead.stage?.id ? lead.stage : null,
    source: lead.source?.id ? lead.source : null,
  };
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
  const { tenantId, userId, role } = await getTenantId();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  await assertLeadInTenant(input.leadId, tenantId);

  return await db.transaction(async (tx) => {
    const [followUp] = await tx
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
      entityId: followUp.id,
      details: { leadId: input.leadId, type: input.type },
    });

    revalidatePath("/leads");
    revalidatePath("/");
    return followUp;
  });
}

// =============================================
// جلب متابعات عميل
// =============================================

export async function getFollowUps(leadId: string) {
  const { tenantId } = await getTenantId();

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

  return data;
}

// =============================================
// إحصائيات لوحة التحكم
// =============================================

export async function getDashboardStats() {
  const { tenantId } = await getTenantId();

  const [
    totalLeads,
    todayLeads,
    todayFollowUps,
    stageBreakdown,
  ] = await Promise.all([
    // إجمالي العملاء
    db
      .select({ count: count() })
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), eq(leads.isDeleted, false))),
    // عملاء اليوم
    db
      .select({ count: count() })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.isDeleted, false),
          sql`${leads.createdAt}::date = CURRENT_DATE`
        )
      ),
    // متابعات مجدولة لليوم (Fix #3: scheduledAt بدل createdAt)
    db
      .select({ count: count() })
      .from(followUps)
      .where(
        and(
          eq(followUps.tenantId, tenantId),
          sql`${followUps.scheduledAt}::date = CURRENT_DATE`,
          sql`${followUps.completedAt} IS NULL`
        )
      ),
    // توزيع المراحل
    db
      .select({
        stageId: leads.stageId,
        stageName: pipelineStages.name,
        stageColor: pipelineStages.color,
        count: count(),
      })
      .from(leads)
      .leftJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
      .where(and(eq(leads.tenantId, tenantId), eq(leads.isDeleted, false)))
      .groupBy(leads.stageId, pipelineStages.name, pipelineStages.color, pipelineStages.position)
      .orderBy(asc(pipelineStages.position)),
  ]);

  return {
    totalLeads: totalLeads[0]?.count || 0,
    todayLeads: todayLeads[0]?.count || 0,
    todayFollowUps: todayFollowUps[0]?.count || 0,
    stageBreakdown,
  };
}

// =============================================
// التحقق من الأرقام المكررة
// =============================================

export async function checkDuplicatePhones(phones: string[]) {
  const { tenantId } = await getTenantId();

  if (phones.length === 0) return [];

  const normalizedPhones = phones.map((p) => normalizePhone(p));

  const existing = await db
    .select({ phone: leads.phone, isDeleted: leads.isDeleted })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        sql`${leads.phone} IN (${sql.join(normalizedPhones.map((p) => sql`${p}`), sql`, `)})`
      )
    );

  return existing.map((e) => ({
    phone: e.phone,
    status: e.isDeleted ? "deleted" as const : "active" as const,
  }));
}

// =============================================
// استيراد عملاء بالجملة (من ملف Sheet)
// =============================================

export async function bulkImportLeads(raw: unknown) {
  const { tenantId, userId, role } = await getTenantId();
  assertRole(role, ROLE.OWNER_ADMIN);
  const input = bulkImportSchema.parse(raw);

  return await db.transaction(async (tx) => {
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

    // 3. normalize + batch dup check
    const normalized = input.leads
      .map((e) => ({ name: e.name, phone: normalizePhone(e.phone) }))
      .filter((e) => !!e.phone);
    const phones = normalized.map((e) => e.phone);

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
    const toInsert = normalized.filter((e) => !existingSet.has(e.phone));

    if (toInsert.length > 0) {
      await tx.insert(leads).values(
        toInsert.map((e) => ({
          tenantId,
          name: e.name,
          phone: e.phone,
          priority: "MEDIUM" as const,
          stageId: defaultStage?.id || null,
          sourceId,
        })),
      );
    }

    const created = toInsert.length;
    const skipped = input.leads.length - created;

    await tx.insert(activityLog).values({
      tenantId,
      userId,
      action: "LEAD_CREATED",
      entityType: "lead",
      details: {
        bulkImport: true,
        campaign: input.campaignName,
        created,
        skipped,
      },
    });

    revalidatePath("/leads");
    revalidatePath("/");
    return { created, skipped };
  });
}

// =============================================
// عمليات جماعية على السيرفر — يمنع Promise.all DoS في العميل
// =============================================

/**
 * تحديث جماعي (تعيين / نقل مرحلة) — UPDATE واحد في DB بدل N
 */
export async function bulkUpdateLeads(raw: unknown) {
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
  return { updated: input.ids.length };
}

/**
 * حذف جماعي (soft) — UPDATE واحد
 */
export async function bulkDeleteLeads(raw: unknown) {
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
  return { deleted: input.ids.length };
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
 * PROVIDER: forbidden
 */
export async function getAgingLeads(minDays: number = 3): Promise<AgingLead[]> {
  const { tenantId, userId, role } = await getTenantId();
  if (role === "PROVIDER") return [];
  if (!Number.isFinite(minDays) || minDays < 1 || minDays > 365) {
    throw new Error("minDays غير صالح");
  }

  const conditions = [
    eq(leads.tenantId, tenantId),
    eq(leads.isDeleted, false),
    sql`${leads.bookingStatus} IS NULL`,
    // المؤرشفون يخرجون من قائمة المُهمَلين — هم قرار قصدي
    sql`${leads.archivedAt} IS NULL`,
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
      lastActivityRaw: sql<string | null>`(
        SELECT MAX(created_at) FROM follow_ups
        WHERE follow_ups.lead_id = ${leads.id}
      )`.as("last_activity_raw"),
    })
    .from(leads)
    .leftJoin(users, eq(leads.assignedTo, users.id))
    .leftJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(and(...conditions))
    .orderBy(asc(leads.createdAt));

  const now = Date.now();
  const minMs = minDays * 86400_000;

  return rows
    .map((r) => {
      const lastActivityAt = r.lastActivityRaw ? new Date(r.lastActivityRaw) : new Date(r.createdAt);
      const silentMs = now - lastActivityAt.getTime();
      const daysSilent = Math.floor(silentMs / 86400_000);
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
    })
    .filter((l) => Date.now() - l.lastActivityAt.getTime() >= minMs)
    .sort((a, b) => b.daysSilent - a.daysSilent);
}

/**
 * عدد سريع للـ aging leads — للـ banner في dashboard
 * أرخص من جلب الكل (يستخدم COUNT)
 */
export async function getAgingLeadsCount(minDays: number = 3): Promise<{
  total: number;
  critical: number; // 7+ days
  byCoordinator: Array<{ userId: string; userName: string; count: number }>;
}> {
  const { tenantId, userId, role } = await getTenantId();
  if (role === "PROVIDER") return { total: 0, critical: 0, byCoordinator: [] };

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
    total: totalRow?.c ?? 0,
    critical: criticalRow?.c ?? 0,
    byCoordinator,
  };
}

