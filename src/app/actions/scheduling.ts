"use server";

import { db } from "@/db";
import { leads, providerSchedules, providerDayOffs, departments } from "@/db/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { assertUserInTenant, assertDepartmentInTenant, assertRole, ROLE } from "@/lib/tenant-guards";

const RIYADH_TZ = "Asia/Riyadh";

/**
 * يُرجع عدد الدقائق منذ منتصف الليل **بتوقيت الرياض** من Date (UTC في DB).
 * على Coolify السيرفر يعمل بـ UTC — استخدام getHours() البسيط يعطي UTC hours
 * ويسبّب تعارض حسابات الجدولة بـ 3 ساعات.
 */
function riyadhMinutesFromDate(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RIYADH_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // 24:XX → 00:XX (Intl قد ترجع 24 لمنتصف الليل)
  return (h % 24) * 60 + m;
}

/** يُرجع رقم اليوم في الأسبوع (0=الأحد) **بتوقيت الرياض** */
function riyadhDayOfWeek(date: Date): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: RIYADH_TZ,
    weekday: "short",
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

/**
 * يحوّل "YYYY-MM-DD" + توقيت الرياض → Date (UTC) لبداية اليوم في الرياض.
 * مثال: "2026-04-20" → 2026-04-19T21:00:00Z (= 2026-04-20 00:00 الرياض)
 */
function riyadhDayBoundaries(dateStr: string): { start: Date; end: Date } {
  // ضع +03:00 صراحةً لتجاوز اعتمادات timezone السيرفر
  const start = new Date(`${dateStr}T00:00:00+03:00`);
  const end = new Date(`${dateStr}T23:59:59.999+03:00`);
  return { start, end };
}

// =============================================
// أنواع البيانات
// =============================================

type TimeSlot = {
  time: string; // "09:00", "09:30", etc.
  available: boolean;
  conflictWith?: string; // اسم العميل المتعارض
};

type GenerateSlotsInput = {
  providerId: string;
  departmentId: string;
  date: string; // "2026-04-20"
  durationMin: number; // 30
};

// =============================================
// المحرك الأساسي: توليد الأوقات المتاحة
// =============================================

export async function generateAvailableSlots(
  input: GenerateSlotsInput
): Promise<{ slots: TimeSlot[]; providerName?: string }> {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

  await assertUserInTenant(input.providerId, tenantId);
  await assertDepartmentInTenant(input.departmentId, tenantId);
  if (!Number.isInteger(input.durationMin) || input.durationMin < 5 || input.durationMin > 480) {
    throw new Error("مدة غير صالحة");
  }

  const targetDate = new Date(input.date);
  if (isNaN(targetDate.getTime())) throw new Error("تاريخ غير صالح");
  // يوم الأسبوع بتوقيت الرياض — ليس local timezone للسيرفر
  const dayOfWeek = riyadhDayOfWeek(new Date(`${input.date}T12:00:00+03:00`));

  // 1. جلب جدول عمل المورد لهذا اليوم
  const [schedule] = await db
    .select()
    .from(providerSchedules)
    .where(
      and(
        eq(providerSchedules.tenantId, tenantId),
        eq(providerSchedules.userId, input.providerId),
        eq(providerSchedules.dayOfWeek, dayOfWeek),
        eq(providerSchedules.isActive, true)
      )
    )
    .limit(1);

  if (!schedule) {
    return { slots: [] }; // لا يعمل هذا اليوم
  }

  // 2. تحقق من الإجازات (حدود اليوم بتوقيت الرياض)
  const { start: startOfDay, end: endOfDay } = riyadhDayBoundaries(input.date);

  const dayOffs = await db
    .select()
    .from(providerDayOffs)
    .where(
      and(
        eq(providerDayOffs.tenantId, tenantId),
        eq(providerDayOffs.userId, input.providerId),
        gte(providerDayOffs.date, startOfDay),
        lte(providerDayOffs.date, endOfDay)
      )
    );

  if (dayOffs.length > 0) {
    return { slots: [] }; // في إجازة
  }

  // 3. جلب الفجوة الزمنية للقسم (مع فحص tenant)
  const [dept] = await db
    .select({ defaultGapMinutes: departments.defaultGapMinutes })
    .from(departments)
    .where(and(eq(departments.id, input.departmentId), eq(departments.tenantId, tenantId)))
    .limit(1);

  const gapMinutes = dept?.defaultGapMinutes ?? 15;

  // 4. جلب الحجوزات القائمة لهذا المورد في هذا اليوم
  const existingBookings = await db
    .select({
      id: leads.id,
      name: leads.name,
      bookingDate: leads.bookingDate,
      bookingEndTime: leads.bookingEndTime,
      bookingDurationMin: leads.bookingDurationMin,
    })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.bookingResourceId, input.providerId),
        eq(leads.isDeleted, false),
        inArray(leads.bookingStatus, ["PENDING", "POSTPONED"]),
        gte(leads.bookingDate, startOfDay),
        lte(leads.bookingDate, endOfDay)
      )
    );

  // 5. بناء قائمة الأوقات المحجوزة (مع حساب الفجوة)
  type BookedRange = { start: number; end: number; name: string };
  const bookedRanges: BookedRange[] = existingBookings
    .filter((b) => b.bookingDate)
    .map((b) => {
      // الدقائق بتوقيت الرياض — ليس UTC السيرفر
      const startMin = riyadhMinutesFromDate(b.bookingDate!);
      const duration = b.bookingDurationMin || 30;
      const endMin = startMin + duration + gapMinutes;
      return { start: startMin, end: endMin, name: b.name };
    });

  // 6. توليد الأوقات المتاحة
  const workStart = timeToMinutes(schedule.startTime);
  const workEnd = timeToMinutes(schedule.endTime);
  const breakStart = schedule.breakStart ? timeToMinutes(schedule.breakStart) : null;
  const breakEnd = schedule.breakEnd ? timeToMinutes(schedule.breakEnd) : null;
  const totalNeeded = input.durationMin + gapMinutes;

  const slots: TimeSlot[] = [];
  const step = 15; // كل 15 دقيقة عرض slot

  for (let min = workStart; min + input.durationMin <= workEnd; min += step) {
    const slotEnd = min + totalNeeded;
    const timeStr = minutesToTime(min);

    // تحقق: هل الوقت يقع في الاستراحة؟
    if (breakStart !== null && breakEnd !== null) {
      if (min < breakEnd && (min + input.durationMin) > breakStart) {
        // يتداخل مع الاستراحة — تخطي
        continue;
      }
    }

    // تحقق: هل يتعارض مع حجز قائم؟
    const conflict = bookedRanges.find(
      (r) => min < r.end && slotEnd > r.start
    );

    slots.push({
      time: timeStr,
      available: !conflict,
      conflictWith: conflict?.name,
    });
  }

  return { slots };
}

// =============================================
// فحص التعارض لحجز محدد (Conflict Check)
// =============================================

export async function checkBookingConflict(input: {
  providerId: string;
  departmentId: string;
  date: string; // ISO datetime "2026-04-20T10:00"
  durationMin: number;
  excludeLeadId?: string; // استثناء عند التعديل
}): Promise<{
  hasConflict: boolean;
  conflictingBookings: { name: string; time: string }[];
}> {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

  await assertUserInTenant(input.providerId, tenantId);
  await assertDepartmentInTenant(input.departmentId, tenantId);
  if (!Number.isInteger(input.durationMin) || input.durationMin < 5 || input.durationMin > 480) {
    throw new Error("مدة غير صالحة");
  }

  const startTime = new Date(input.date);
  if (isNaN(startTime.getTime())) throw new Error("تاريخ غير صالح");

  const [dept] = await db
    .select({ defaultGapMinutes: departments.defaultGapMinutes })
    .from(departments)
    .where(and(eq(departments.id, input.departmentId), eq(departments.tenantId, tenantId)))
    .limit(1);

  const gapMinutes = dept?.defaultGapMinutes ?? 15;
  const endTime = new Date(startTime.getTime() + (input.durationMin + gapMinutes) * 60000);

  // حدود اليوم بتوقيت الرياض (input.date "2026-04-20T10:00" → نأخذ التاريخ فقط)
  const dateOnly = input.date.slice(0, 10); // "2026-04-20"
  const { start: dayStart, end: dayEnd } = riyadhDayBoundaries(dateOnly);

  const existingBookings = await db
    .select({
      id: leads.id,
      name: leads.name,
      bookingDate: leads.bookingDate,
      bookingEndTime: leads.bookingEndTime,
      bookingDurationMin: leads.bookingDurationMin,
    })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.bookingResourceId, input.providerId),
        eq(leads.isDeleted, false),
        inArray(leads.bookingStatus, ["PENDING", "POSTPONED"]),
        gte(leads.bookingDate, dayStart),
        lte(leads.bookingDate, dayEnd)
      )
    );

  const conflicting = existingBookings
    .filter((b) => {
      if (!b.bookingDate) return false;
      if (input.excludeLeadId && b.id === input.excludeLeadId) return false;

      const bStart = b.bookingDate.getTime();
      const bDuration = b.bookingDurationMin || 30;
      const bEnd = bStart + (bDuration + gapMinutes) * 60000;

      // تعارض = تداخل الفترتين
      return startTime.getTime() < bEnd && endTime.getTime() > bStart;
    })
    .map((b) => ({
      name: b.name,
      time: b.bookingDate
        ? b.bookingDate.toLocaleTimeString("ar-SA-u-ca-gregory", {
            timeZone: RIYADH_TZ,
            hour: "2-digit",
            minute: "2-digit",
          })
        : "",
    }));

  return {
    hasConflict: conflicting.length > 0,
    conflictingBookings: conflicting,
  };
}

// =============================================
// أدوات مساعدة
// =============================================

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}
