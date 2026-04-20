"use server";

import { db } from "@/db";
import { followUps, activityLog, leads } from "@/db/schema";
import { eq, ne, and, lte, isNull, isNotNull, sql, count, desc } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";

const getContext = requireTenant;

// تعليم متابعة كمكتملة
export async function completeFollowUp(followUpId: string) {
  const { userId, tenantId } = await getContext();

  // جلب المتابعة أولاً لمعرفة الـ leadId
  const [existing] = await db
    .select({ leadId: followUps.leadId, type: followUps.type })
    .from(followUps)
    .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

  await db
    .update(followUps)
    .set({ completedAt: new Date() })
    .where(
      and(
        eq(followUps.id, followUpId),
        eq(followUps.tenantId, tenantId)
      )
    );

  // Fix #9: تسجيل في سجل النشاط
  if (existing) {
    await db.insert(activityLog).values({
      tenantId,
      userId,
      action: "FOLLOW_UP_CREATED",
      entityType: "follow_up",
      entityId: followUpId,
      details: { action: "completed", leadId: existing.leadId, type: existing.type },
    });
  }

  revalidatePath("/");
}

// تأجيل متابعة (تغيير scheduledAt)
export async function snoozeFollowUp(followUpId: string, days: number) {
  const { tenantId } = await getContext();

  const [existing] = await db
    .select({ scheduledAt: followUps.scheduledAt })
    .from(followUps)
    .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

  if (!existing?.scheduledAt) return;

  const newDate = new Date(existing.scheduledAt);
  newDate.setDate(newDate.getDate() + days);

  await db
    .update(followUps)
    .set({ scheduledAt: newDate })
    .where(
      and(
        eq(followUps.id, followUpId),
        eq(followUps.tenantId, tenantId)
      )
    );

  revalidatePath("/");
}

// تعديل موعد تذكير موجود (يقبل ISO كاملاً)
export async function updateFollowUpSchedule(followUpId: string, scheduledAtISO: string) {
  const { tenantId } = await getContext();

  const newDate = new Date(scheduledAtISO);
  if (isNaN(newDate.getTime())) {
    throw new Error("تاريخ/وقت غير صالح");
  }

  // جلب leadId لتنظيف بقية التذكيرات المعلّقة للعميل نفسه
  const [target] = await db
    .select({ leadId: followUps.leadId })
    .from(followUps)
    .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

  if (!target) throw new Error("التذكير غير موجود");

  // إلغاء أي تذكير آخر معلّق لنفس العميل (ضمان: تذكير واحد نشط)
  await db
    .update(followUps)
    .set({ completedAt: new Date() })
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        eq(followUps.leadId, target.leadId),
        isNull(followUps.completedAt),
        isNotNull(followUps.scheduledAt),
        ne(followUps.id, followUpId),
      )
    );

  await db
    .update(followUps)
    .set({ scheduledAt: newDate, completedAt: null })
    .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

  revalidatePath("/");
  revalidatePath("/leads");
  return { scheduledAt: newDate };
}

// إلغاء تذكير + أي تذكيرات معلّقة أخرى للعميل
export async function cancelFollowUp(followUpId: string) {
  const { tenantId, userId } = await getContext();

  const [existing] = await db
    .select({ notes: followUps.notes, leadId: followUps.leadId })
    .from(followUps)
    .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

  if (!existing) return;

  // إلغاء كل تذكير معلّق لهذا العميل (ليختفي البادج تماماً)
  await db
    .update(followUps)
    .set({ completedAt: new Date() })
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        eq(followUps.leadId, existing.leadId),
        isNull(followUps.completedAt),
        isNotNull(followUps.scheduledAt),
      )
    );

  // تمييز التذكير المستهدف بأنه ملغى صراحةً في الملاحظات
  await db
    .update(followUps)
    .set({ notes: `(ملغى) ${existing.notes ?? ""}`.trim() })
    .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "FOLLOW_UP_CREATED",
    entityType: "follow_up",
    entityId: followUpId,
    details: { action: "cancelled", leadId: existing.leadId },
  });

  revalidatePath("/");
  revalidatePath("/leads");
}

// تأجيل بالدقائق — من داخل إشعار الاستحقاق
export async function snoozeFollowUpMinutes(followUpId: string, minutes: number) {
  const { tenantId } = await getContext();

  const newDate = new Date();
  newDate.setMinutes(newDate.getMinutes() + minutes);

  await db
    .update(followUps)
    .set({ scheduledAt: newDate })
    .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

  revalidatePath("/");
  revalidatePath("/leads");
  return { scheduledAt: newDate };
}

// =============================================
// المتابعات التي حان موعدها للتو (للـ in-app toasts)
// =============================================

export async function getJustDueFollowUps(sinceISO: string) {
  const { tenantId, userId } = await getContext();
  const since = new Date(sinceISO);
  const now = new Date();
  if (isNaN(since.getTime())) return [];

  const userRole = await getUserRole(tenantId, userId);
  const conditions = [
    eq(followUps.tenantId, tenantId),
    isNull(followUps.completedAt),
    isNotNull(followUps.scheduledAt),
    sql`${followUps.scheduledAt} > ${since.toISOString()}`,
    sql`${followUps.scheduledAt} <= ${now.toISOString()}`,
    eq(leads.isDeleted, false),
  ];
  if (userRole === "COORDINATOR") {
    conditions.push(eq(followUps.userId, userId));
  }

  const rows = await db
    .select({
      id: followUps.id,
      leadId: followUps.leadId,
      leadName: leads.name,
      leadPhone: leads.phone,
      type: followUps.type,
      notes: followUps.notes,
      scheduledAt: followUps.scheduledAt,
    })
    .from(followUps)
    .innerJoin(leads, eq(followUps.leadId, leads.id))
    .where(and(...conditions))
    .orderBy(followUps.scheduledAt)
    .limit(20);

  return rows;
}

// =============================================
// متابعة سريعة بنقرة واحدة
// =============================================

export async function quickScheduleFollowUp(input: {
  leadId: string;
  scheduledAt: string; // ISO datetime
  notes?: string;
  type?: "CALL" | "WHATSAPP" | "MESSAGE";
}) {
  const { tenantId, userId } = await getContext();

  const scheduledAt = new Date(input.scheduledAt);
  if (isNaN(scheduledAt.getTime())) {
    throw new Error("تاريخ/وقت غير صالح");
  }

  const diffMs = scheduledAt.getTime() - Date.now();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const defaultNotes =
    diffMs < 0
      ? "متابعة مجدولة"
      : diffHours <= 12
      ? `تذكير — التواصل بعد ${Math.max(1, diffHours)} ساعة`
      : diffDays <= 1
      ? "تذكير — العميل طلب التواصل غداً"
      : `تذكير — متابعة بعد ${diffDays} أيام`;

  // إلغاء أي موعد معلّق سابق لنفس العميل (موعد واحد نشط فقط)
  await db
    .update(followUps)
    .set({ completedAt: new Date() })
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        eq(followUps.leadId, input.leadId),
        isNull(followUps.completedAt),
        isNotNull(followUps.scheduledAt),
      )
    );

  const [followUp] = await db
    .insert(followUps)
    .values({
      tenantId,
      leadId: input.leadId,
      userId,
      type: input.type || "CALL",
      notes: input.notes || defaultNotes,
      scheduledAt,
    })
    .returning({ id: followUps.id });

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "FOLLOW_UP_CREATED",
    entityType: "follow_up",
    entityId: followUp.id,
    details: {
      leadId: input.leadId,
      type: input.type || "CALL",
      quick: true,
      scheduledFor: scheduledAt.toISOString(),
    },
  });

  revalidatePath("/");
  revalidatePath("/leads");
  return { success: true, scheduledAt };
}

// =============================================
// "لم يرد" + إعادة محاولة تلقائية
// =============================================

export async function quickNoResponse(leadId: string, retryAfterDays: number = 1) {
  const { tenantId, userId } = await getContext();

  // 1. سجّل المحاولة الحالية كمكتملة
  await db.insert(followUps).values({
    tenantId,
    leadId,
    userId,
    type: "CALL",
    notes: "📵 لم يرد",
    completedAt: new Date(),
  });

  // 2. إلغاء أي موعد معلّق سابق لنفس العميل (موعد واحد نشط فقط)
  await db
    .update(followUps)
    .set({ completedAt: new Date() })
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        eq(followUps.leadId, leadId),
        isNull(followUps.completedAt),
        isNotNull(followUps.scheduledAt),
      )
    );

  // 3. أنشئ متابعة مجدولة جديدة للإعادة
  const retryDate = new Date();
  retryDate.setDate(retryDate.getDate() + retryAfterDays);
  retryDate.setHours(10, 0, 0, 0);

  const [retry] = await db
    .insert(followUps)
    .values({
      tenantId,
      leadId,
      userId,
      type: "CALL",
      notes: `📞 إعادة محاولة — لم يرد المرة السابقة`,
      scheduledAt: retryDate,
    })
    .returning({ id: followUps.id });

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "FOLLOW_UP_CREATED",
    entityType: "follow_up",
    entityId: retry.id,
    details: {
      leadId,
      action: "no_response_auto_retry",
      retryDate: retryDate.toISOString(),
    },
  });

  revalidatePath("/");
  revalidatePath("/leads");
  return { success: true, retryDate };
}

// =============================================
// جلب عدد المتابعات المتأخرة (للإشعارات)
// =============================================

export async function getOverdueFollowUpsCount() {
  const { tenantId, userId } = await getContext();
  const userRole = await getUserRole(tenantId, userId);

  const now = new Date();
  const conditions = [
    eq(followUps.tenantId, tenantId),
    lte(followUps.scheduledAt, now),
    isNull(followUps.completedAt),
    isNotNull(followUps.scheduledAt),
  ];

  // المنسق يرى مهامه فقط
  if (userRole === "COORDINATOR") {
    conditions.push(eq(followUps.userId, userId));
  }

  const [result] = await db
    .select({ total: count() })
    .from(followUps)
    .innerJoin(leads, eq(followUps.leadId, leads.id))
    .where(and(...conditions, eq(leads.isDeleted, false)));

  return result?.total || 0;
}

// =============================================
// جلب عدد محاولات التواصل السابقة مع عميل
// =============================================

export async function getLeadFollowUpCount(leadId: string) {
  const { tenantId } = await getContext();

  const [result] = await db
    .select({ total: count() })
    .from(followUps)
    .where(and(eq(followUps.tenantId, tenantId), eq(followUps.leadId, leadId)));

  return result?.total || 0;
}

// =============================================
// جلب آخر الملاحظات لعميل (رحلة الإقناع)
// =============================================

export async function getLeadRecentNotes(leadId: string) {
  const { tenantId } = await getContext();

  const notes = await db
    .select({
      id: followUps.id,
      type: followUps.type,
      notes: followUps.notes,
      createdAt: followUps.createdAt,
      scheduledAt: followUps.scheduledAt,
    })
    .from(followUps)
    .where(and(eq(followUps.tenantId, tenantId), eq(followUps.leadId, leadId)))
    .orderBy(desc(followUps.createdAt))
    .limit(5);

  return notes;
}

// =============================================
// جلب المتابعات المجدولة المعلّقة لعميل
// =============================================

export async function getLeadPendingFollowUp(leadId: string) {
  const { tenantId } = await getContext();

  const [pending] = await db
    .select({
      id: followUps.id,
      scheduledAt: followUps.scheduledAt,
      notes: followUps.notes,
      type: followUps.type,
    })
    .from(followUps)
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        eq(followUps.leadId, leadId),
        isNull(followUps.completedAt),
        isNotNull(followUps.scheduledAt)
      )
    )
    .orderBy(followUps.scheduledAt)
    .limit(1);

  return pending || null;
}

// Helper: جلب دور المستخدم
async function getUserRole(tenantId: string, userId: string): Promise<string> {
  const { users } = await import("@/db/schema");
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
    .limit(1);
  return user?.role || "COORDINATOR";
}

