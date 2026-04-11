"use server";

import { db } from "@/db";
import { leads, activityLog, leadSources } from "@/db/schema";
import { eq, and, isNotNull, gte, lte, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";

// =============================================
// إنشاء حجز (عند سحب عميل لعمود "حجز")
// =============================================

export async function createBooking(input: {
  leadId: string;
  bookingDate: string;
  bookingService: string;
  bookingNotes?: string;
}) {
  const session = await requireAuth();
  const tenantId = (session.user as Record<string, unknown>).tenantId as string;
  if (!tenantId) throw new Error("unauthorized");

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
    userId: session.user.id,
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
  const session = await requireAuth();
  const tenantId = (session.user as Record<string, unknown>).tenantId as string;
  if (!tenantId) throw new Error("unauthorized");

  const updateData: Record<string, unknown> = {
    bookingStatus: input.status,
    updatedAt: new Date(),
  };

  // إذا تم التأجيل — حفظ الموعد الجديد والسبب
  if (input.status === "POSTPONED" && input.postponeDate) {
    updateData.bookingDate = new Date(input.postponeDate);
    updateData.bookingNotes = input.postponeReason
      ? `تم التأجيل: ${input.postponeReason}`
      : "تم التأجيل";
  }

  const [lead] = await db
    .update(leads)
    .set(updateData)
    .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId)))
    .returning({ id: leads.id, name: leads.name });

  if (!lead) throw new Error("not_found");

  await db.insert(activityLog).values({
    tenantId,
    userId: session.user.id,
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

// الأعمدة المطلوبة للحجوزات — مع اسم الحملة
const bookingColumns = {
  id: leads.id,
  name: leads.name,
  phone: leads.phone,
  bookingStatus: leads.bookingStatus,
  bookingDate: leads.bookingDate,
  bookingService: leads.bookingService,
  bookingNotes: leads.bookingNotes,
  sourceName: leadSources.name,
};

export async function getBookings() {
  const session = await requireAuth();
  const tenantId = (session.user as Record<string, unknown>).tenantId as string;
  if (!tenantId) throw new Error("unauthorized");

  return db
    .select(bookingColumns)
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        isNotNull(leads.bookingStatus)
      )
    )
    .orderBy(leads.bookingDate);
}

// =============================================
// مواعيد اليوم والغد والمتأخرة
// =============================================

export async function getBookingsSummary() {
  const session = await requireAuth();
  const tenantId = (session.user as Record<string, unknown>).tenantId as string;
  if (!tenantId) throw new Error("unauthorized");

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const tomorrowEnd = new Date(todayStart.getTime() + 172800000);

  // مواعيد اليوم
  const todayBookings = await db
    .select(bookingColumns)
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

  // مواعيد الغد
  const tomorrowBookings = await db
    .select(bookingColumns)
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

  // المتأخرة (فات الموعد ولا زالت PENDING)
  const overdueBookings = await db
    .select(bookingColumns)
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

  // إحصائيات
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

  // إحصائيات حسب الحملة
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

  return {
    today: todayBookings,
    tomorrow: tomorrowBookings,
    overdue: overdueBookings,
    stats: stats || { total: 0, pending: 0, completed: 0, noShow: 0, cancelled: 0 },
    campaignStats,
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
  const session = await requireAuth();
  const tenantId = (session.user as Record<string, unknown>).tenantId as string;
  if (!tenantId) throw new Error("unauthorized");

  await db
    .update(leads)
    .set({
      bookingDate: new Date(input.bookingDate),
      ...(input.bookingService !== undefined && { bookingService: input.bookingService }),
      ...(input.bookingNotes !== undefined && { bookingNotes: input.bookingNotes }),
      updatedAt: new Date(),
    })
    .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId)));

  revalidatePath("/bookings");
}

