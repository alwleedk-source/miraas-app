"use server";

import { db } from "@/db";
import { leads, activityLog, leadSources } from "@/db/schema";
import { eq, and, isNotNull, gte, lte, sql } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";

const RIYADH_TZ = "Asia/Riyadh";

function getRiyadhDate(offsetDays: number = 0): { start: Date; end: Date } {
  const now = new Date();
  const riyadhStr = now.toLocaleDateString("en-CA", { timeZone: RIYADH_TZ });
  const [y, m, d] = riyadhStr.split("-").map(Number);
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

  // Fix #4: التأجيل يحفظ الملاحظات الأصلية
  if (input.status === "POSTPONED" && input.postponeDate) {
    updateData.bookingDate = new Date(input.postponeDate);
    const originalNote = currentLead?.bookingNotes || "";
    const postponeNote = input.postponeReason
      ? `[تأجيل: ${input.postponeReason}]`
      : "[تأجيل]";
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
  const { tenantId } = await requireTenant();

  return db
    .select({ ...baseBookingCols, sourceName: leadSources.name })
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
