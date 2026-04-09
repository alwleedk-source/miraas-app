"use server";

import { db } from "@/db";
import { leads, followUps, tagAssignments, activityLog } from "@/db/schema";
import { eq, and, desc, like, sql, count } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * إنشاء عميل جديد
 */
export async function createLead(input: {
  tenantId: string;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  sourceId?: string;
  stageId?: string;
  assignedTo?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  customFields?: Record<string, string>;
  userId?: string; // من قام بالإنشاء
}) {
  const { userId, ...leadData } = input;

  const [lead] = await db
    .insert(leads)
    .values({
      ...leadData,
      priority: leadData.priority || "MEDIUM",
    })
    .returning();

  // تسجيل النشاط
  if (userId) {
    await db.insert(activityLog).values({
      tenantId: input.tenantId,
      userId,
      action: "LEAD_CREATED",
      entityType: "lead",
      entityId: lead.id,
      details: { leadName: input.name },
    });
  }

  revalidatePath("/leads");
  return lead;
}

/**
 * جلب العملاء مع الفلاتر
 */
export async function getLeads(input: {
  tenantId: string;
  search?: string;
  stageId?: string;
  assignedTo?: string;
  priority?: string;
  page?: number;
  limit?: number;
}) {
  const { tenantId, search, stageId, assignedTo, priority, page = 1, limit = 50 } = input;

  const conditions = [
    eq(leads.tenantId, tenantId),
    eq(leads.isDeleted, false),
  ];

  if (stageId) conditions.push(eq(leads.stageId, stageId));
  if (assignedTo) conditions.push(eq(leads.assignedTo, assignedTo));
  if (priority) conditions.push(eq(leads.priority, priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT"));
  if (search) {
    conditions.push(
      sql`(${leads.name} ILIKE ${"%" + search + "%"} OR ${leads.phone} ILIKE ${"%" + search + "%"} OR ${leads.company} ILIKE ${"%" + search + "%"})`
    );
  }

  const data = await db.query.leads.findMany({
    where: and(...conditions),
    with: {
      assignedUser: { columns: { id: true, name: true, image: true } },
      source: { columns: { id: true, name: true, platform: true } },
      stage: { columns: { id: true, name: true, color: true } },
      tagAssignments: {
        with: { tag: { columns: { id: true, name: true, color: true } } },
      },
    },
    orderBy: [desc(leads.createdAt)],
    limit,
    offset: (page - 1) * limit,
  });

  const [{ total }] = await db
    .select({ total: count() })
    .from(leads)
    .where(and(...conditions));

  return { data, total, page, limit };
}

/**
 * جلب عميل واحد مع كل التفاصيل
 */
export async function getLead(leadId: string, tenantId: string) {
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)),
    with: {
      assignedUser: true,
      source: true,
      stage: true,
      followUps: {
        with: { user: { columns: { id: true, name: true, image: true } } },
        orderBy: [desc(followUps.createdAt)],
      },
      tagAssignments: {
        with: { tag: true },
      },
    },
  });

  return lead;
}

/**
 * تحديث بيانات عميل
 */
export async function updateLead(
  leadId: string,
  tenantId: string,
  data: {
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
    stageId?: string;
    assignedTo?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    customFields?: Record<string, string>;
  },
  userId?: string
) {
  const [updated] = await db
    .update(leads)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
    .returning();

  // تسجيل النشاط
  if (userId) {
    const action = data.stageId ? "LEAD_STAGE_CHANGED" as const
      : data.assignedTo ? "LEAD_ASSIGNED" as const
      : "LEAD_UPDATED" as const;

    await db.insert(activityLog).values({
      tenantId,
      userId,
      action,
      entityType: "lead",
      entityId: leadId,
      details: data as Record<string, unknown>,
    });
  }

  revalidatePath("/leads");
  return updated;
}

/**
 * حذف عميل (soft delete)
 */
export async function deleteLead(leadId: string, tenantId: string, userId?: string) {
  const [deleted] = await db
    .update(leads)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
    .returning();

  if (userId) {
    await db.insert(activityLog).values({
      tenantId,
      userId,
      action: "LEAD_DELETED",
      entityType: "lead",
      entityId: leadId,
      details: { leadName: deleted?.name },
    });
  }

  revalidatePath("/leads");
  return deleted;
}

/**
 * نقل عميل لمرحلة جديدة (Pipeline)
 */
export async function moveLeadStage(
  leadId: string,
  tenantId: string,
  stageId: string,
  userId?: string
) {
  return updateLead(leadId, tenantId, { stageId }, userId);
}

/**
 * تعيين عميل لمنسق
 */
export async function assignLead(
  leadId: string,
  tenantId: string,
  assignedTo: string,
  userId?: string
) {
  return updateLead(leadId, tenantId, { assignedTo }, userId);
}
