"use server";

import { db } from "@/db";
import { leads, providerSchedules, providerDayOffs, departments } from "@/db/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";

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
  const { tenantId } = await requireTenant();

  const targetDate = new Date(input.date);
  const dayOfWeek = targetDate.getDay(); // 0=الأحد ... 6=السبت

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

  // 2. تحقق من الإجازات
  const startOfDay = new Date(input.date + "T00:00:00Z");
  const endOfDay = new Date(input.date + "T23:59:59Z");

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

  // 3. جلب الفجوة الزمنية للقسم
  const [dept] = await db
    .select({ defaultGapMinutes: departments.defaultGapMinutes })
    .from(departments)
    .where(eq(departments.id, input.departmentId))
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
      const startMin = getMinutesFromDate(b.bookingDate!);
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
  const { tenantId } = await requireTenant();

  const startTime = new Date(input.date);
  
  // جلب الفجوة الزمنية
  const [dept] = await db
    .select({ defaultGapMinutes: departments.defaultGapMinutes })
    .from(departments)
    .where(eq(departments.id, input.departmentId))
    .limit(1);

  const gapMinutes = dept?.defaultGapMinutes ?? 15;
  const endTime = new Date(startTime.getTime() + (input.durationMin + gapMinutes) * 60000);

  // بداية ونهاية اليوم للبحث
  const dayStart = new Date(startTime);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(startTime);
  dayEnd.setHours(23, 59, 59, 999);

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

function getMinutesFromDate(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}
