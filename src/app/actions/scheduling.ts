"use server";

import { db } from "@/db";
import { leads, providerSchedules, providerDayOffs, departments } from "@/db/schema";
import { eq, and, gte, gt, lt, lte, notInArray, isNotNull } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { assertUserInTenant, assertDepartmentInTenant, assertRole, ROLE } from "@/lib/tenant-guards";
import { parseRiyadhDateTime } from "@/lib/utils";

const RIYADH_TZ = "Asia/Riyadh";

type Fail = { success: false; error: string };

/**
 * عقد الأخطاء الموحّد: الأخطاء المتوقَّعة (صلاحية/تحقق) تُعاد كـ
 * { success: false, error: "عربي" } — Next.js يُخفي رسائل المرمية في production.
 */
function expectedError(err: unknown): string | null {
  if (err instanceof Error && /[؀-ۿ]/.test(err.message)) return err.message;
  return null;
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
): Promise<{ success: true; slots: TimeSlot[]; providerName?: string } | Fail> {
  try {
    const { tenantId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

    await assertUserInTenant(input.providerId, tenantId);
    await assertDepartmentInTenant(input.departmentId, tenantId);
    if (!Number.isInteger(input.durationMin) || input.durationMin < 5 || input.durationMin > 480) {
      return { success: false as const, error: "مدة غير صالحة" } satisfies Fail;
    }

    const targetDate = new Date(input.date);
    if (isNaN(targetDate.getTime())) {
      return { success: false as const, error: "تاريخ غير صالح" } satisfies Fail;
    }
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
      return { success: true as const, slots: [] }; // لا يعمل هذا اليوم
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
      return { success: true as const, slots: [] }; // في إجازة
    }

    // 3. جلب الفجوة الزمنية للقسم (مع فحص tenant)
    const [dept] = await db
      .select({ defaultGapMinutes: departments.defaultGapMinutes })
      .from(departments)
      .where(and(eq(departments.id, input.departmentId), eq(departments.tenantId, tenantId)))
      .limit(1);

    const gapMinutes = dept?.defaultGapMinutes ?? 15;

    // 4. جلب الحجوزات القائمة لهذا المورد التي تتقاطع مع هذا اليوم.
    //    نطابق قيد قاعدة البيانات (migration 0004): أي حجز بحالة غير
    //    CANCELLED/NO_RESPONSE وله bookingEndTime يحجز الموعد فعلياً.
    //    استخدام bookingEndTime (بدل إعادة حساب المدة+الفجوة) يجعله متّسقاً
    //    مع القيد تماماً، ويلتقط المواعيد العابرة لمنتصف الليل.
    const existingBookings = await db
      .select({
        id: leads.id,
        name: leads.name,
        bookingDate: leads.bookingDate,
        bookingEndTime: leads.bookingEndTime,
      })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.bookingResourceId, input.providerId),
          eq(leads.isDeleted, false),
          isNotNull(leads.bookingStatus),
          notInArray(leads.bookingStatus, ["CANCELLED", "NO_RESPONSE"]),
          isNotNull(leads.bookingEndTime),
          gt(leads.bookingEndTime, startOfDay),
          lt(leads.bookingDate, endOfDay)
        )
      );

    // 5. بناء قائمة الأوقات المحجوزة بدقائق من منتصف ليل الرياض.
    //    نحسب من الفرق المطلق بين الوقت وبداية اليوم → يطابق workStart/workEnd
    //    (دقائق من منتصف الليل) ويتعامل مع العابر لمنتصف الليل (قيمة سالبة).
    type BookedRange = { start: number; end: number; name: string };
    const dayStartMs = startOfDay.getTime();
    const bookedRanges: BookedRange[] = existingBookings
      .filter((b) => b.bookingDate && b.bookingEndTime)
      .map((b) => {
        const startMin = Math.round((b.bookingDate!.getTime() - dayStartMs) / 60000);
        const endMin = Math.round((b.bookingEndTime!.getTime() - dayStartMs) / 60000);
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

    return { success: true as const, slots };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
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
  success: true;
  hasConflict: boolean;
  conflictingBookings: { name: string; time: string }[];
} | Fail> {
  try {
    const { tenantId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

    await assertUserInTenant(input.providerId, tenantId);
    await assertDepartmentInTenant(input.departmentId, tenantId);
    if (!Number.isInteger(input.durationMin) || input.durationMin < 5 || input.durationMin > 480) {
      return { success: false as const, error: "مدة غير صالحة" } satisfies Fail;
    }

    // وقت جدار بتوقيت الرياض (متّسق مع التخزين والعرض وتوليد الشرائح)
    const startTime = parseRiyadhDateTime(input.date);
    if (isNaN(startTime.getTime())) {
      return { success: false as const, error: "تاريخ غير صالح" } satisfies Fail;
    }

    const [dept] = await db
      .select({ defaultGapMinutes: departments.defaultGapMinutes })
      .from(departments)
      .where(and(eq(departments.id, input.departmentId), eq(departments.tenantId, tenantId)))
      .limit(1);

    const gapMinutes = dept?.defaultGapMinutes ?? 15;
    const endTime = new Date(startTime.getTime() + (input.durationMin + gapMinutes) * 60000);

    // تداخل دقيق مع الفترة المطلوبة [startTime, endTime) محسوب في SQL — يطابق
    // قيد قاعدة البيانات (0004) بالضبط: overlap = bookingEndTime > startTime
    // و bookingDate < endTime. لا حاجة لنافذة "اليوم" (التي كانت تفوّت المواعيد
    // العابرة لمنتصف الليل). bookingEndTime المخزّن هو مصدر الحقيقة (يشمل المدة+الفجوة).
    const existingBookings = await db
      .select({
        id: leads.id,
        name: leads.name,
        bookingDate: leads.bookingDate,
      })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.bookingResourceId, input.providerId),
          eq(leads.isDeleted, false),
          isNotNull(leads.bookingStatus),
          notInArray(leads.bookingStatus, ["CANCELLED", "NO_RESPONSE"]),
          isNotNull(leads.bookingEndTime),
          gt(leads.bookingEndTime, startTime),
          lt(leads.bookingDate, endTime)
        )
      );

    const conflicting = existingBookings
      .filter((b) => {
        if (!b.bookingDate) return false;
        // استثناء الحجز نفسه عند التعديل
        return !(input.excludeLeadId && b.id === input.excludeLeadId);
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
      success: true as const,
      hasConflict: conflicting.length > 0,
      conflictingBookings: conflicting,
    };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
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
