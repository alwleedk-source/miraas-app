"use server";

import { db } from "@/db";
import { leads, activityLog, leadSources, users, pipelineStages, followUps, departments } from "@/db/schema";
import { eq, and, isNotNull, gte, lte, sql, ilike, or } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { normalizePhone, normalizePhoneStrict } from "@/lib/utils";
import {
  assertLeadInTenant,
  assertUserInTenant,
  assertDepartmentInTenant,
  assertRole,
  ROLE,
} from "@/lib/tenant-guards";
import {
  createBookingSchema,
  updateBookingStatusSchema,
  updateBookingDateSchema,
  quickBookingSchema,
} from "@/lib/schemas";
import { backupPush } from "@/lib/backup-push";
import { buildBackupPayload } from "@/lib/backup-payload";

/**
 * يحوّل خطأ Postgres 23P01 (EXCLUDE constraint) إلى رسالة عربية واضحة.
 * EXCLUDE يمنع حجز نفس المورد في نفس الوقت.
 */
function throwIfDoubleBooking(err: unknown): never {
  const code = (err as { code?: string })?.code;
  if (code === "23P01") {
    throw new Error("الموعد محجوز لهذا المقدم في نفس الوقت — اختر وقتاً آخر");
  }
  throw err;
}

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

export async function createBooking(raw: unknown) {
  const { tenantId, userId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  const input = createBookingSchema.parse(raw);
  await assertLeadInTenant(input.leadId, tenantId);
  if (input.bookingDepartmentId) {
    await assertDepartmentInTenant(input.bookingDepartmentId, tenantId);
  }
  if (input.bookingResourceId) {
    await assertUserInTenant(input.bookingResourceId, tenantId);
  }

  // حساب bookingEndTime إذا توفّرت المدة + المقدم
  // (شرط ضروري لتفعيل EXCLUDE constraint الذي يمنع double-booking)
  const bookingStart = new Date(input.bookingDate);
  let bookingEndTime: Date | null = null;
  if (input.bookingResourceId && input.bookingDurationMin) {
    // gap من إعدادات القسم — للتباعد بين المواعيد
    let gapMinutes = 15;
    if (input.bookingDepartmentId) {
      const [dept] = await db
        .select({ defaultGapMinutes: departments.defaultGapMinutes })
        .from(departments)
        .where(eq(departments.id, input.bookingDepartmentId))
        .limit(1);
      if (dept) gapMinutes = dept.defaultGapMinutes;
    }
    bookingEndTime = new Date(bookingStart.getTime() + (input.bookingDurationMin + gapMinutes) * 60000);
  }

  try {
  return await db.transaction(async (tx) => {
    const [lead] = await tx
      .update(leads)
      .set({
        bookingStatus: "PENDING",
        bookingDate: bookingStart,
        bookingService: input.bookingService,
        bookingNotes: input.bookingNotes || null,
        bookingDepartmentId: input.bookingDepartmentId || null,
        bookingResourceId: input.bookingResourceId || null,
        bookingDurationMin: input.bookingDurationMin ?? null,
        bookingEndTime,
        updatedAt: new Date(),
      })
      .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId)))
      .returning({ id: leads.id, name: leads.name });

    if (!lead) throw new Error("not_found");

    await tx.insert(activityLog).values({
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

    // 🔄 backup push
    void buildBackupPayload(input.leadId, tenantId, "lead.booked").then((p) => {
      if (p) void backupPush(tenantId, p);
    });

    return lead;
  });
  } catch (err) {
    throwIfDoubleBooking(err);
  }
}

// =============================================
// تحديث حالة الحجز
// =============================================

export async function updateBookingStatus(raw: unknown) {
  const { tenantId, userId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  const input = updateBookingStatusSchema.parse(raw);
  await assertLeadInTenant(input.leadId, tenantId);

  const [currentLead] = await db
    .select({
      bookingNotes: leads.bookingNotes,
      bookingDurationMin: leads.bookingDurationMin,
      bookingResourceId: leads.bookingResourceId,
      bookingDepartmentId: leads.bookingDepartmentId,
    })
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId)));

  const updateData: Record<string, unknown> = {
    bookingStatus: input.status,
    updatedAt: new Date(),
  };

  // التأجيل: التاريخ اختياري (قائمة انتظار إذا لم يُحدد)
  if (input.status === "POSTPONED") {
    if (input.postponeDate) {
      const newStart = new Date(input.postponeDate);
      updateData.bookingDate = newStart;
      // أعد حساب bookingEndTime بناءً على duration الحالي + gap القسم
      // (ضروري لـ EXCLUDE constraint — وإلا تتناقض البيانات)
      if (currentLead?.bookingResourceId && currentLead?.bookingDurationMin) {
        let gapMinutes = 15;
        if (currentLead.bookingDepartmentId) {
          const [dept] = await db
            .select({ defaultGapMinutes: departments.defaultGapMinutes })
            .from(departments)
            .where(eq(departments.id, currentLead.bookingDepartmentId))
            .limit(1);
          if (dept) gapMinutes = dept.defaultGapMinutes;
        }
        updateData.bookingEndTime = new Date(
          newStart.getTime() + (currentLead.bookingDurationMin + gapMinutes) * 60000,
        );
      } else {
        updateData.bookingEndTime = null;
      }
    } else {
      // قائمة انتظار — بدون موعد محدد، نظّف endTime أيضاً
      updateData.bookingDate = null;
      updateData.bookingEndTime = null;
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

  // 🔄 backup push
  void buildBackupPayload(input.leadId, tenantId, "lead.booking_status_changed", {
    newValue: input.status,
  }).then((p) => {
    if (p) void backupPush(tenantId, p);
  });

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
  bookingDepartmentId: leads.bookingDepartmentId,
  bookingResourceId: leads.bookingResourceId,
  bookingDurationMin: leads.bookingDurationMin,
};

export async function getBookings() {
  const { tenantId, userId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

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
      departmentName: departments.name,
      departmentColor: departments.color,
      pendingFollowUps: sql<number>`(
        SELECT COUNT(*) FROM follow_ups
        WHERE follow_ups.lead_id = ${leads.id}
          AND follow_ups.completed_at IS NULL
          AND follow_ups.scheduled_at IS NOT NULL
      )`.as("pending_follow_ups"),
    })
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .leftJoin(users, eq(leads.assignedTo, users.id))
    .leftJoin(departments, eq(leads.bookingDepartmentId, departments.id))
    .where(and(...conditions))
    .orderBy(leads.bookingDate);
}

// =============================================
// مواعيد اليوم والغد والمتأخرة
// =============================================

export async function getBookingsSummary() {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

  const { start: todayStart, end: todayEnd } = getRiyadhDate(0);
  const { end: tomorrowEnd } = getRiyadhDate(1);

  const selectCols = {
    ...baseBookingCols,
    sourceName: leadSources.name,
    departmentName: departments.name,
    departmentColor: departments.color,
  };

  const todayBookings = await db
    .select(selectCols)
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .leftJoin(departments, eq(leads.bookingDepartmentId, departments.id))
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
    .leftJoin(departments, eq(leads.bookingDepartmentId, departments.id))
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

  // المتأخرة = أي PENDING موعده فات (الآن، لا بداية اليوم)
  // قبل: lte(bookingDate, todayStart) — يستثني حجوزات اليوم نفسه التي فاتت
  const overdueBookings = await db
    .select(selectCols)
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .leftJoin(departments, eq(leads.bookingDepartmentId, departments.id))
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        eq(leads.bookingStatus, "PENDING"),
        isNotNull(leads.bookingDate),
        lte(leads.bookingDate, new Date())
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

export async function updateBookingDate(raw: unknown) {
  const { tenantId, userId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  const input = updateBookingDateSchema.parse(raw);
  await assertLeadInTenant(input.leadId, tenantId);
  if (input.departmentId) await assertDepartmentInTenant(input.departmentId, tenantId);
  if (input.resourceId) await assertUserInTenant(input.resourceId, tenantId);

  // اقرأ الحالة الحالية لإعادة حساب bookingEndTime باستخدام duration الحالي إذا لم يُرسَل
  const [current] = await db
    .select({
      bookingDurationMin: leads.bookingDurationMin,
      bookingResourceId: leads.bookingResourceId,
      bookingDepartmentId: leads.bookingDepartmentId,
    })
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId)))
    .limit(1);
  if (!current) throw new Error("not_found");

  const newStart = new Date(input.bookingDate);
  const effectiveDuration = input.duration ?? current.bookingDurationMin ?? null;
  const effectiveResource = input.resourceId !== undefined ? input.resourceId : current.bookingResourceId;
  const effectiveDept = input.departmentId !== undefined ? input.departmentId : current.bookingDepartmentId;

  // حساب gap من القسم
  let gapMinutes = 15;
  if (effectiveDept) {
    const [dept] = await db
      .select({ defaultGapMinutes: departments.defaultGapMinutes })
      .from(departments)
      .where(eq(departments.id, effectiveDept))
      .limit(1);
    if (dept) gapMinutes = dept.defaultGapMinutes;
  }

  // bookingEndTime ضروري لتفعيل EXCLUDE — نُحدّثه دائماً عند تغيير التاريخ
  const newEndTime =
    effectiveResource && effectiveDuration
      ? new Date(newStart.getTime() + (effectiveDuration + gapMinutes) * 60000)
      : null;

  const updateData: Record<string, unknown> = {
    bookingDate: newStart,
    bookingEndTime: newEndTime,
    updatedAt: new Date(),
  };
  if (input.bookingService !== undefined) updateData.bookingService = input.bookingService;
  if (input.bookingNotes !== undefined) updateData.bookingNotes = input.bookingNotes;
  if (input.departmentId !== undefined) updateData.bookingDepartmentId = input.departmentId || null;
  if (input.resourceId !== undefined) updateData.bookingResourceId = input.resourceId || null;
  if (input.duration !== undefined) updateData.bookingDurationMin = input.duration;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(leads)
        .set(updateData)
        .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId)));

      await tx.insert(activityLog).values({
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
    });
  } catch (err) {
    throwIfDoubleBooking(err);
  }

  revalidatePath("/bookings");
}

// =============================================
// تسجيل تذكير بالموعد
// =============================================

export async function markBookingReminded(leadId: string) {
  const { tenantId, userId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  await assertLeadInTenant(leadId, tenantId);

  // idempotency — لا تكرار خلال ساعتين
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const [recent] = await db
    .select({ id: followUps.id })
    .from(followUps)
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        eq(followUps.leadId, leadId),
        eq(followUps.type, "WHATSAPP"),
        sql`${followUps.notes} LIKE '%تذكير%'`,
        gte(followUps.completedAt, twoHoursAgo),
      ),
    )
    .limit(1);
  if (recent) return { success: true, alreadyMarked: true };

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
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
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

export async function quickCreateBooking(raw: unknown) {
  const { tenantId, userId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  const input = quickBookingSchema.parse(raw);
  if (input.existingLeadId) await assertLeadInTenant(input.existingLeadId, tenantId);
  if (input.bookingDepartmentId) await assertDepartmentInTenant(input.bookingDepartmentId, tenantId);
  if (input.bookingResourceId) await assertUserInTenant(input.bookingResourceId, tenantId);

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

    // تحقق صارم من الرقم — لا نقبل أرقاماً تالفة
    const phoneCheck = normalizePhoneStrict(input.phone);
    if (!phoneCheck.ok) {
      throw new Error(`رقم العميل غير صالح: ${phoneCheck.error}`);
    }

    const [newLead] = await db
      .insert(leads)
      .values({
        tenantId,
        name: input.name.trim(),
        phone: phoneCheck.phone,
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

  // حساب وقت الانتهاء (bookingEndTime)
  const bookingStart = new Date(input.bookingDate);
  const durationMin = input.bookingDurationMin || 30;
  let gapMinutes = 15;
  if (input.bookingDepartmentId) {
    const [dept] = await db
      .select({ defaultGapMinutes: departments.defaultGapMinutes })
      .from(departments)
      .where(eq(departments.id, input.bookingDepartmentId))
      .limit(1);
    if (dept) gapMinutes = dept.defaultGapMinutes;
  }
  const bookingEndTime = new Date(bookingStart.getTime() + (durationMin + gapMinutes) * 60000);

  try {
    const lead = await db.transaction(async (tx) => {
      const [l] = await tx
        .update(leads)
        .set({
          bookingStatus: "PENDING",
          bookingDate: bookingStart,
          bookingService: input.bookingService,
          bookingNotes: input.bookingNotes || null,
          bookingDepartmentId: input.bookingDepartmentId || null,
          bookingResourceId: input.bookingResourceId || null,
          bookingDurationMin: durationMin,
          bookingEndTime,
          updatedAt: new Date(),
        })
        .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
        .returning({ id: leads.id, name: leads.name });

      if (!l) throw new Error("not_found");

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_UPDATED",
        entityType: "lead",
        entityId: l.id,
        details: {
          action: "quick_booking_created",
          bookingDate: input.bookingDate,
          bookingService: input.bookingService,
        },
      });

      return l;
    });

    revalidatePath("/bookings");
    revalidatePath("/leads");
    revalidatePath("/pipeline");
    return lead;
  } catch (err) {
    throwIfDoubleBooking(err);
  }
}
