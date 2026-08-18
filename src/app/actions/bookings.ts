"use server";

import { db } from "@/db";
import { leads, activityLog, leadSources, users, pipelineStages, followUps, departments } from "@/db/schema";
import { eq, and, isNull, isNotNull, gte, lt, lte, sql, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { normalizePhone, normalizePhoneStrict, parseRiyadhDateTime, isUuid } from "@/lib/utils";
import {
  assertLeadInTenant,
  assertDepartmentInTenant,
  assertProviderResourceInTenant,
  coordinatorLeadVisibilityCondition,
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

type Fail = { success: false; error: string };

/**
 * عقد الأخطاء الموحّد: Next.js في production يُخفي رسائل الأخطاء المرمية من
 * server actions فيرى المستخدم نصاً إنجليزياً عاماً. لذا كل خطأ متوقَّع
 * (تحقق/صلاحية/تعارض حجز/غير موجود) يُعاد كـ { success: false, error: "عربي" }.
 * غير المتوقَّع فقط (أعطال DB ونحوها) يبقى مرمياً.
 *
 * 23P01 = EXCLUDE constraint في Postgres — يمنع حجز نفس المورد في نفس الوقت.
 */
function expectedError(err: unknown): string | null {
  if ((err as { code?: string } | null)?.code === "23P01") {
    return "الموعد محجوز لهذا المقدم في نفس الوقت — اختر وقتاً آخر";
  }
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

/**
 * المنسق يُعدّل حجوزات عملائه المُسنَدين له فقط (مثل getBookings الذي يُصفّي
 * COORDINATOR بـ assignedTo، ومثل قيود المتابعات). OWNER/ADMIN بلا قيد.
 */
async function assertCoordinatorOwnsLead(
  leadId: string,
  tenantId: string,
  userId: string,
  role: string,
) {
  if (role !== "COORDINATOR") return;
  const [owned] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.id, leadId),
        eq(leads.tenantId, tenantId),
        eq(leads.assignedTo, userId),
      ),
    )
    .limit(1);
  if (!owned) throw new Error("هذا الحجز ليس ضمن عملائك المُسنَدين");
}

// =============================================
// إنشاء حجز (عند سحب عميل لعمود "حجز")
// =============================================

export async function createBooking(raw: unknown) {
  try {
    const { tenantId, userId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    const input = createBookingSchema.parse(raw);
    await assertLeadInTenant(input.leadId, tenantId);
    await assertCoordinatorOwnsLead(input.leadId, tenantId, userId, role);
    if (input.bookingDepartmentId) {
      await assertDepartmentInTenant(input.bookingDepartmentId, tenantId);
    }
    if (input.bookingResourceId) {
      // المورد يجب أن يكون مقدم خدمة فعّالاً — لا أي مستخدم في الشركة
      await assertProviderResourceInTenant(input.bookingResourceId, tenantId);
    }

    // حساب bookingEndTime إذا توفّرت المدة + المقدم
    // (شرط ضروري لتفعيل EXCLUDE constraint الذي يمنع double-booking)
    const bookingStart = parseRiyadhDateTime(input.bookingDate);
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

    const lead = await db.transaction(async (tx) => {
      const [row] = await tx
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

      if (!row) throw new Error("not_found");

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_UPDATED",
        entityType: "lead",
        entityId: row.id,
        details: {
          action: "booking_created",
          bookingDate: input.bookingDate,
          bookingService: input.bookingService,
        },
      });

      return row;
    });

    revalidatePath("/bookings");
    revalidatePath("/pipeline");

    // 🔄 backup push — بعد انتهاء المعاملة كي لا تُدفَع حالة غير مُثبَتة
    void buildBackupPayload(input.leadId, tenantId, "lead.booked").then((p) => {
      if (p) void backupPush(tenantId, p);
    });

    return { success: true as const, id: lead.id, name: lead.name };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// تحديث حالة الحجز
// =============================================

export async function updateBookingStatus(raw: unknown) {
  try {
    const { tenantId, userId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    const input = updateBookingStatusSchema.parse(raw);
    await assertLeadInTenant(input.leadId, tenantId);
    await assertCoordinatorOwnsLead(input.leadId, tenantId, userId, role);

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
        const newStart = parseRiyadhDateTime(input.postponeDate);
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

    // التأجيل بموعد جديد قد يتعارض مع حجز آخر لنفس المقدم (قيد EXCLUDE يشمل
    // POSTPONED) — خطأ 23P01 يُلتقط في expectedError ويُعاد برسالة عربية.
    const lead = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(leads)
        .set(updateData)
        .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, tenantId)))
        .returning({ id: leads.id, name: leads.name });

      if (!row) throw new Error("not_found");

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_UPDATED",
        entityType: "lead",
        entityId: row.id,
        details: {
          action: "booking_status_changed",
          newStatus: input.status,
          ...(input.postponeDate && { postponeDate: input.postponeDate }),
          ...(input.postponeReason && { postponeReason: input.postponeReason }),
        },
      });
      return row;
    });

    revalidatePath("/bookings");
    revalidatePath("/leads");

    // 🔄 backup push
    void buildBackupPayload(input.leadId, tenantId, "lead.booking_status_changed", {
      newValue: input.status,
    }).then((p) => {
      if (p) void backupPush(tenantId, p);
    });

    return { success: true as const, id: lead.id, name: lead.name };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
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
  try {
    const { tenantId, userId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

    const conditions = [
      eq(leads.tenantId, tenantId),
      eq(leads.isDeleted, false),
      isNull(leads.archivedAt), // لا تُظهر حجوزات عملاء مؤرشفين (اتّساق مع بقية التطبيق)
      isNotNull(leads.bookingStatus),
    ];

    // المنسق يرى حجوزاته فقط
    if (role === "COORDINATOR") {
      conditions.push(eq(leads.assignedTo, userId));
    }

    const bookings = await db
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
      .orderBy(leads.bookingDate)
      // سقف حماية — بلا LIMIT كانت الصفحة تجلب كل سجل الحجوزات
      .limit(500);

    return { success: true as const, bookings };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// مواعيد اليوم والغد والمتأخرة
// =============================================

export async function getBookingsSummary() {
  try {
    const { tenantId, userId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

    const { start: todayStart, end: todayEnd } = getRiyadhDate(0);
    const { end: tomorrowEnd } = getRiyadhDate(1);

    // المنسق يُصفَّى بـ assignedTo في كل لوحات الملخص (مثل getBookings) —
    // بلا هذا كان يرى أسماء/جوالات حجوزات زملائه في اليوم/الغد/المتأخرة.
    const coordinatorScope =
      role === "COORDINATOR" ? eq(leads.assignedTo, userId) : undefined;

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
          isNull(leads.archivedAt),
          isNotNull(leads.bookingStatus),
          coordinatorScope,
          gte(leads.bookingDate, todayStart),
          // حدّ علوي حصري: todayEnd = منتصف ليل الغد. lt يمنع ظهور حجز منتصف
          // الليل في قائمتَي اليوم والغد معاً (كان lte يكرّره).
          lt(leads.bookingDate, todayEnd)
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
          isNull(leads.archivedAt),
          isNotNull(leads.bookingStatus),
          coordinatorScope,
          gte(leads.bookingDate, todayEnd),
          lt(leads.bookingDate, tomorrowEnd)
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
          isNull(leads.archivedAt),
          eq(leads.bookingStatus, "PENDING"),
          coordinatorScope,
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
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.isDeleted, false),
          isNull(leads.archivedAt),
          isNotNull(leads.bookingStatus),
          coordinatorScope
        )
      );

    const campaignStats = await db
      .select({
        sourceName: sql<string>`COALESCE(${leadSources.name}, 'بدون حملة')`,
        count: sql<number>`count(*)::int`,
      })
      .from(leads)
      .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.isDeleted, false),
          isNull(leads.archivedAt),
          isNotNull(leads.bookingStatus),
          coordinatorScope
        )
      )
      .groupBy(leadSources.name)
      .orderBy(sql`count(*) desc`);

    // حالة التذكيرات المُرسَلة اليوم — من مصدرين معاً:
    //   (أ) الكرون التلقائي: يكتب في activityLog (WHATSAPP_SENT, details.type=booking_reminder_*)
    //   (ب) التذكير اليدوي (markBookingReminded): يكتب follow-up بنوع WHATSAPP
    // كان يُقرأ من (ب) فقط → المنسقون لا يرون تذكيرات الكرون فيكرّرون رسائل العملاء.
    const [autoReminders, manualReminders] = await Promise.all([
      db
        .select({ leadId: activityLog.entityId })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.tenantId, tenantId),
            eq(activityLog.action, "WHATSAPP_SENT"),
            gte(activityLog.createdAt, todayStart),
            sql`${activityLog.details}->>'type' LIKE 'booking_reminder_%'`
          )
        ),
      db
        .select({ leadId: followUps.leadId })
        .from(followUps)
        .where(
          and(
            eq(followUps.tenantId, tenantId),
            eq(followUps.type, "WHATSAPP"),
            gte(followUps.createdAt, todayStart),
            sql`${followUps.notes} LIKE '%تذكير%'`
          )
        ),
    ]);

    const remindedLeadIds = [
      ...new Set([
        ...autoReminders.map((r) => r.leadId).filter((id): id is string => !!id),
        ...manualReminders.map((r) => r.leadId),
      ]),
    ];

    return {
      success: true as const,
      today: todayBookings,
      tomorrow: tomorrowBookings,
      overdue: overdueBookings,
      stats: stats || { total: 0, pending: 0, completed: 0, noShow: 0, cancelled: 0 },
      campaignStats,
      remindedLeadIds,
    };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// تعديل تاريخ الحجز
// =============================================

export async function updateBookingDate(raw: unknown) {
  try {
    const { tenantId, userId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    const input = updateBookingDateSchema.parse(raw);
    await assertLeadInTenant(input.leadId, tenantId);
    await assertCoordinatorOwnsLead(input.leadId, tenantId, userId, role);
    if (input.departmentId) await assertDepartmentInTenant(input.departmentId, tenantId);
    if (input.resourceId) await assertProviderResourceInTenant(input.resourceId, tenantId);

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

    const newStart = parseRiyadhDateTime(input.bookingDate);
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

    revalidatePath("/bookings");
    revalidatePath("/leads");
    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// تسجيل تذكير بالموعد
// =============================================

export async function markBookingReminded(leadId: string) {
  try {
    const { tenantId, userId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(leadId)) return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    await assertLeadInTenant(leadId, tenantId);
    await assertCoordinatorOwnsLead(leadId, tenantId, userId, role);

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
    if (recent) return { success: true as const, alreadyMarked: true };

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
    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// بحث عميل بالجوال (للحجز السريع)
// =============================================

export async function searchLeadByPhone(phone: string) {
  try {
    const { tenantId, userId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!phone || phone.trim().length < 4) {
      return { success: true as const, results: [] };
    }

    const normalized = normalizePhone(phone.trim());
    const searchTerm = normalized || phone.trim();

    const conditions = [
      eq(leads.tenantId, tenantId),
      eq(leads.isDeleted, false),
      or(
        ilike(leads.phone, `%${searchTerm}%`),
        ilike(leads.phone, `%${phone.trim()}%`)
      ),
    ];

    // المنسق يبحث ضمن نطاقه فقط (عملاءه + حملاته — منطق getLeads نفسه) —
    // سابقاً كان يستطيع تعداد عملاء الشركة كلهم بمقاطع أرقام الجوال.
    if (role === "COORDINATOR") {
      conditions.push(await coordinatorLeadVisibilityCondition(tenantId, userId));
    }

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
      .where(and(...conditions))
      .limit(5);

    return { success: true as const, results };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// حجز سريع: إنشاء/استرداد عميل + إنشاء حجز
// =============================================

export async function quickCreateBooking(raw: unknown) {
  try {
    const { tenantId, userId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    const input = quickBookingSchema.parse(raw);
    if (input.existingLeadId) {
      await assertLeadInTenant(input.existingLeadId, tenantId);
      // المنسق يحجز لعملائه المُسنَدين فقط — مثل بقية عمليات الحجز
      await assertCoordinatorOwnsLead(input.existingLeadId, tenantId, userId, role);
    }
    if (input.bookingDepartmentId) await assertDepartmentInTenant(input.bookingDepartmentId, tenantId);
    if (input.bookingResourceId) await assertProviderResourceInTenant(input.bookingResourceId, tenantId);

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
    const bookingStart = parseRiyadhDateTime(input.bookingDate);
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
    return { success: true as const, id: lead.id, name: lead.name };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}
