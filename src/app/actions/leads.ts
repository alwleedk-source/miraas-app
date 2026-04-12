"use server";

import { db } from "@/db";
import { leads, followUps, activityLog, pipelineStages, notifications, leadSources, users } from "@/db/schema";
import { eq, and, desc, asc, ilike, or, count, sql } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { normalizePhone } from "@/lib/utils";

// =============================================
// Types
// =============================================

type CreateLeadInput = {
  name: string;
  phone?: string;
  email?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  sourceId?: string;
  sourceName?: string; // Fix #6: اسم المصدر/الحملة
  stageId?: string;
  assignedTo?: string;
};

type UpdateLeadInput = Partial<CreateLeadInput> & { id: string };

const getTenantId = requireTenant;

// =============================================
// إنشاء عميل جديد
// =============================================

export async function createLead(input: CreateLeadInput) {
  const { tenantId, userId, role } = await getTenantId();

  // إذا لم يُحدد مرحلة، استخدم المرحلة الافتراضية
  let stageId = input.stageId;
  if (!stageId) {
    const [defaultStage] = await db
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.tenantId, tenantId),
          eq(pipelineStages.isDefault, true)
        )
      )
      .limit(1);
    stageId = defaultStage?.id;
  }

  // Fix #10: المنسق يُعيّن نفسه تلقائياً
  const assignedTo = input.assignedTo || (role === "COORDINATOR" ? userId : null);

  // Fix #6: إنشاء/إيجاد المصدر بالاسم
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

  const [lead] = await db
    .insert(leads)
    .values({
      tenantId,
      name: input.name,
      phone: input.phone ? normalizePhone(input.phone) : undefined,
      email: input.email,
      priority: input.priority || "MEDIUM",
      sourceId: resolvedSourceId,
      stageId: stageId || null,
      assignedTo,
    })
    .returning({ id: leads.id, name: leads.name, phone: leads.phone, priority: leads.priority });

  // تسجيل النشاط
  await db.insert(activityLog).values({
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
}

// =============================================
// تحديث عميل
// =============================================

export async function updateLead(input: UpdateLeadInput) {
  const { tenantId, userId } = await getTenantId();

  const [updated] = await db
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

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "LEAD_UPDATED",
    entityType: "lead",
    entityId: input.id,
    details: { changes: input },
  });

  // إشعار المنسق عند تعيينه
  if (input.assignedTo && input.assignedTo !== userId) {
    await db.insert(notifications).values({
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
}

// =============================================
// تغيير مرحلة العميل
// =============================================

export async function changeLeadStage(leadId: string, stageId: string) {
  const { tenantId, userId } = await getTenantId();

  const [updated] = await db
    .update(leads)
    .set({ stageId, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
    .returning({ id: leads.id, name: leads.name });

  if (!updated) throw new Error("العميل غير موجود");

  await db.insert(activityLog).values({
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
}

// =============================================
// حذف عميل (soft delete)
// =============================================

export async function deleteLead(leadId: string) {
  const { tenantId, userId, role } = await getTenantId();

  if (role === "COORDINATOR") {
    throw new Error("ليس لديك صلاحية الحذف");
  }

  // جلب اسم العميل قبل الحذف للتسجيل
  const [target] = await db
    .select({ name: leads.name })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
    .limit(1);

  await db
    .update(leads)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)));

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "LEAD_DELETED",
    entityType: "lead",
    entityId: leadId,
    details: { leadName: target?.name || "غير معروف" },
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
  const { tenantId } = await getTenantId();
  const page = options?.page || 1;
  const limit = options?.limit || 50;
  const offset = (page - 1) * limit;

  const conditions = [
    eq(leads.tenantId, tenantId),
    eq(leads.isDeleted, false),
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

  // فلتر الحصرية: لا تعرض عملاء مراحل حصرية مُعيّنين لمنسق آخر
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
      )`
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
  const { tenantId, userId } = await getTenantId();

  const [followUp] = await db
    .insert(followUps)
    .values({
      tenantId,
      leadId: input.leadId,
      userId,
      type: input.type,
      notes: input.notes,
      scheduledAt: input.scheduledAt,
    })
    .returning();

  await db.insert(activityLog).values({
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

export async function bulkImportLeads(input: {
  campaignName: string;
  leads: { name: string; phone: string }[];
}) {
  const { tenantId, userId } = await getTenantId();

  // 1. إنشاء أو إيجاد المصدر (الحملة)
  let sourceId: string | null = null;
  if (input.campaignName.trim()) {
    const [existingSource] = await db
      .select({ id: leadSources.id })
      .from(leadSources)
      .where(
        and(
          eq(leadSources.tenantId, tenantId),
          eq(leadSources.name, input.campaignName.trim())
        )
      )
      .limit(1);

    if (existingSource) {
      sourceId = existingSource.id;
    } else {
      const [newSource] = await db
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
  const [defaultStage] = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.tenantId, tenantId),
        eq(pipelineStages.isDefault, true)
      )
    )
    .limit(1);

  // 3. إدخال العملاء مع تخطي المكررات
  let created = 0;
  let skipped = 0;

  for (const entry of input.leads) {
    const phone = normalizePhone(entry.phone);

    // فحص التكرار
    if (phone) {
      const [existing] = await db
          .select({ id: leads.id })
          .from(leads)
          .where(and(
            eq(leads.tenantId, tenantId),
            eq(leads.phone, phone)
          ))
          .limit(1);

      if (existing) {
        skipped++;
        continue;
      }
    }

    await db.insert(leads).values({
      tenantId,
      name: entry.name,
      phone: phone || null,
      priority: "MEDIUM",
      stageId: defaultStage?.id || null,
      sourceId,
    });

    created++;
  }

  // 4. تسجيل النشاط
  await db.insert(activityLog).values({
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
}
