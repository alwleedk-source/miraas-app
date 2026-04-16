"use server";

import { db } from "@/db";
import { leads, activityLog, leadSources, users, pipelineStages, followUps } from "@/db/schema";
import { eq, and, isNotNull, gte, lte, sql, ilike, or } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { normalizePhone } from "@/lib/utils";

const RIYADH_TZ = "Asia/Riyadh";

function getRiyadhDate(offsetDays: number = 0): { start: Date; end: Date } {
  const now = new Date();
  const riyadhStr = now.toLocaleDateString("en-CA", { timeZone: RIYADH_TZ });
  const [y, m, d] = riyadhStr.split("-").map(Number);
  // بداية اليوم بتوقيت الرياض (UTC+3) = 21:00 UTC اليوم السابق
  const start = new Date(Date.UTC(y, m - 1, d + offsetDays, -3, 0, 0));
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

// =============================================
// إنشاء حجز (عند سحب عميل لعمود "حجز")
// =============================================

export async function createBooking(input: {
  leadId: string;
  bookingDate: string;
  bookingService: string;
  bookingNotes?: string;
}) {
  const { tenantId, userId } = await requireTenant();

  const [lead] = await db
    .update(leads)
    .set({
      bookingStatus: "PENDING",
      bookingDate: new Date(input.bookingDate),
      bookingService: input.bookingService,
      bookingNotes: input.bookingNotes || null,
      updatedAt: new Date(),
    })
    .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId)))
    .returning({ id: leads.id, name: leads.name });

  if (!lead) throw new Error("not_found");

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "LEAD_UPDATED",
    entityType: "lead",
    entityId: lead.id,
    details: {
      action: "booking_created",
      bookingDate: input.bookingDate,
      bookingService: input.bookingService,
    },
  });

  revalidatePath("/bookings");
  revalidatePath("/pipeline");
  return lead;
}

// =============================================
// تحديث حالة الحجز
// =============================================

export async function updateBookingStatus(input: {
  leadId: string;
  status: string;
  postponeDate?: string;
  postponeReason?: string;
}) {
  const { tenantId, userId } = await requireTenant();

  // Fix #4: جلب الملاحظات الحالية قبل التحديث
  const [currentLead] = await db
    .select({ bookingNotes: leads.bookingNotes })
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId)));

  const updateData: Record<string, unknown> = {
    bookingStatus: input.status,
    updatedAt: new Date(),
  };

  // التأجيل: التاريخ اختياري (قائمة انتظار إذا لم يُحدد)
  if (input.status === "POSTPONED") {
    if (input.postponeDate) {
      updateData.bookingDate = new Date(input.postponeDate);
    } else {
      // قائمة انتظار — بدون موعد محدد
      updateData.bookingDate = null;
    }
    const originalNote = currentLead?.bookingNotes || "";
    const postponeNote = input.postponeReason
      ? `[تأجيل: ${input.postponeReason}]`
      : input.postponeDate ? "[تأجيل]" : "[قائمة انتظار]";
    updateData.bookingNotes = originalNote
      ? `${originalNote}\n${postponeNote}`
      : postponeNote;
  }

  const [lead] = await db
    .update(leads)
    .set(updateData)
    .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId)))
    .returning({ id: leads.id, name: leads.name });

  if (!lead) throw new Error("not_found");

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "LEAD_UPDATED",
    entityType: "lead",
    entityId: lead.id,
    details: {
      action: "booking_status_changed",
      newStatus: input.status,
      ...(input.postponeDate && { postponeDate: input.postponeDate }),
      ...(input.postponeReason && { postponeReason: input.postponeReason }),
    },
  });

  revalidatePath("/bookings");
  return lead;
}

// =============================================
// جلب الحجوزات
// =============================================

const baseBookingCols = {
  id: leads.id,
  name: leads.name,
  phone: leads.phone,
  bookingStatus: leads.bookingStatus,
  bookingDate: leads.bookingDate,
  bookingService: leads.bookingService,
  bookingNotes: leads.bookingNotes,
};

export async function getBookings() {
  const { tenantId, userId, role } = await requireTenant();

  const conditions = [
    eq(leads.tenantId, tenantId),
    eq(leads.isDeleted, false),
    isNotNull(leads.bookingStatus),
  ];

  // المنسق يرى حجوزاته فقط
  if (role === "COORDINATOR") {
    conditions.push(eq(leads.assignedTo, userId));
  }

  return db
    .select({
      ...baseBookingCols,
      sourceName: leadSources.name,
      assignedUserName: users.name,
    })
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .leftJoin(users, eq(leads.assignedTo, users.id))
    .where(and(...conditions))
    .orderBy(leads.bookingDate);
}

// =============================================
// مواعيد اليوم والغد والمتأخرة
// =============================================

export async function getBookingsSummary() {
  const { tenantId } = await requireTenant();

  const { start: todayStart, end: todayEnd } = getRiyadhDate(0);
  const { end: tomorrowEnd } = getRiyadhDate(1);

  const selectCols = { ...baseBookingCols, sourceName: leadSources.name };

  const todayBookings = await db
    .select(selectCols)
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        isNotNull(leads.bookingStatus),
        gte(leads.bookingDate, todayStart),
        lte(leads.bookingDate, todayEnd)
      )
    )
    .orderBy(leads.bookingDate);

  const tomorrowBookings = await db
    .select(selectCols)
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        isNotNull(leads.bookingStatus),
        gte(leads.bookingDate, todayEnd),
        lte(leads.bookingDate, tomorrowEnd)
      )
    )
    .orderBy(leads.bookingDate);

  const overdueBookings = await db
    .select(selectCols)
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        eq(leads.bookingStatus, "PENDING"),
        lte(leads.bookingDate, todayStart)
      )
    )
    .orderBy(leads.bookingDate);

  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where booking_status = 'PENDING')::int`,
      completed: sql<number>`count(*) filter (where booking_status = 'COMPLETED')::int`,
      noShow: sql<number>`count(*) filter (where booking_status = 'NO_RESPONSE')::int`,
      cancelled: sql<number>`count(*) filter (where booking_status = 'CANCELLED')::int`,
    })
    .from(leads)
    .where(
      and(eq(leads.tenantId, tenantId), eq(leads.isDeleted, false), isNotNull(leads.bookingStatus))
    );

  const campaignStats = await db
    .select({
      sourceName: sql<string>`COALESCE(${leadSources.name}, 'بدون حملة')`,
      count: sql<number>`count(*)::int`,
    })
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(
      and(eq(leads.tenantId, tenantId), eq(leads.isDeleted, false), isNotNull(leads.bookingStatus))
    )
    .groupBy(leadSources.name)
    .orderBy(sql`count(*) desc`);

  // جلب حالة التذكيرات المرسلة اليوم
  const todayReminders = await db
    .select({ leadId: followUps.leadId })
    .from(followUps)
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        eq(followUps.type, "WHATSAPP"),
        gte(followUps.createdAt, todayStart),
        sql`${followUps.notes} LIKE '%تذكير بالموعد%'`
      )
    );

  const remindedLeadIds = todayReminders.map((r) => r.leadId);

  return {
    today: todayBookings,
    tomorrow: tomorrowBookings,
    overdue: overdueBookings,
    stats: stats || { total: 0, pending: 0, completed: 0, noShow: 0, cancelled: 0 },
    campaignStats,
    remindedLeadIds,
  };
}

// =============================================
// تعديل تاريخ الحجز
// =============================================

export async function updateBookingDate(input: {
  leadId: string;
  bookingDate: string;
  bookingService?: string;
  bookingNotes?: string;
}) {
  const { tenantId, userId } = await requireTenant();

  await db
    .update(leads)
    .set({
      bookingDate: new Date(input.bookingDate),
      ...(input.bookingService !== undefined && { bookingService: input.bookingService }),
      ...(input.bookingNotes !== undefined && { bookingNotes: input.bookingNotes }),
      updatedAt: new Date(),
    })
    .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId)));

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "LEAD_UPDATED",
    entityType: "lead",
    entityId: input.leadId,
    details: {
      action: "booking_date_updated",
      newDate: input.bookingDate,
      ...(input.bookingService && { newService: input.bookingService }),
    },
  });

  revalidatePath("/bookings");
}

// =============================================
// تسجيل تذكير بالموعد
// =============================================

export async function markBookingReminded(leadId: string) {
  const { tenantId, userId } = await requireTenant();

  // إنشاء متابعة مكتملة من نوع واتساب
  const [followUp] = await db
    .insert(followUps)
    .values({
      tenantId,
      leadId,
      userId,
      type: "WHATSAPP",
      notes: "تذكير بالموعد",
      completedAt: new Date(),
    })
    .returning({ id: followUps.id });

  // تسجيل في سجل النشاطات
  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "FOLLOW_UP_CREATED",
    entityType: "follow_up",
    entityId: followUp.id,
    details: { action: "booking_reminder_sent", leadId },
  });

  revalidatePath("/bookings");
  revalidatePath("/");
  return { success: true };
}

// =============================================
// بحث عميل بالجوال (للحجز السريع)
// =============================================

export async function searchLeadByPhone(phone: string) {
  const { tenantId } = await requireTenant();
  if (!phone || phone.trim().length < 4) return null;

  const normalized = normalizePhone(phone.trim());
  const searchTerm = normalized || phone.trim();

  const results = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      bookingStatus: leads.bookingStatus,
      bookingDate: leads.bookingDate,
      bookingService: leads.bookingService,
      sourceName: leadSources.name,
    })
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        or(
          ilike(leads.phone, `%${searchTerm}%`),
          ilike(leads.phone, `%${phone.trim()}%`)
        )
      )
    )
    .limit(5);

  return results;
}

// =============================================
// حجز سريع: إنشاء/استرداد عميل + إنشاء حجز
// =============================================

export async function quickCreateBooking(input: {
  existingLeadId?: string;
  name?: string;
  phone: string;
  bookingDate: string;
  bookingService: string;
  bookingNotes?: string;
}) {
  const { tenantId, userId, role } = await requireTenant();

  let leadId = input.existingLeadId;

  // إذا لم يكن هناك عميل موجود، أنشئ واحداً جديداً
  if (!leadId) {
    if (!input.name?.trim()) throw new Error("اسم العميل مطلوب");

    // إيجاد المرحلة الافتراضية للحجز (isBooking = true)
    const [bookingStage] = await db
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.tenantId, tenantId),
          eq(pipelineStages.isBooking, true)
        )
      )
      .limit(1);

    // fallback: المرحلة الافتراضية
    let stageId = bookingStage?.id;
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

    const assignedTo = role === "COORDINATOR" ? userId : null;

    const [newLead] = await db
      .insert(leads)
      .values({
        tenantId,
        name: input.name.trim(),
        phone: normalizePhone(input.phone),
        priority: "MEDIUM",
        stageId: stageId || null,
        assignedTo,
      })
      .returning({ id: leads.id });

    leadId = newLead.id;

    await db.insert(activityLog).values({
      tenantId,
      userId,
      action: "LEAD_CREATED",
      entityType: "lead",
      entityId: leadId,
      details: { leadName: input.name, source: "quick_booking" },
    });
  } else {
    // إذا كان موجوداً، نقل المرحلة إلى الحجز إن أمكن
    const [bookingStage] = await db
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.tenantId, tenantId),
          eq(pipelineStages.isBooking, true)
        )
      )
      .limit(1);

    if (bookingStage) {
      await db
        .update(leads)
        .set({ stageId: bookingStage.id })
        .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)));
    }
  }

  // إنشاء الحجز
  const [lead] = await db
    .update(leads)
    .set({
      bookingStatus: "PENDING",
      bookingDate: new Date(input.bookingDate),
      bookingService: input.bookingService,
      bookingNotes: input.bookingNotes || null,
      updatedAt: new Date(),
    })
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
    .returning({ id: leads.id, name: leads.name });

  if (!lead) throw new Error("not_found");

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "LEAD_UPDATED",
    entityType: "lead",
    entityId: lead.id,
    details: {
      action: "quick_booking_created",
      bookingDate: input.bookingDate,
      bookingService: input.bookingService,
    },
  });

  revalidatePath("/bookings");
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  return lead;
}
