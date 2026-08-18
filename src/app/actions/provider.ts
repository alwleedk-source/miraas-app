"use server";

import { db } from "@/db";
import { leads, internalMessages, users, activityLog, notifications } from "@/db/schema";
import { eq, ne, and, gte, lt, lte, inArray, isNull, desc, asc } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/utils";

type Fail = { success: false; error: string };

/**
 * عقد الأخطاء الموحّد: Next.js في production يُخفي رسائل الأخطاء المرمية من
 * server actions فيرى المستخدم نصاً إنجليزياً عاماً. لذا كل خطأ متوقَّع
 * (تحقق/صلاحية/غير موجود) يُعاد كـ { success: false, error: "عربي" }.
 * غير المتوقَّع فقط (أعطال DB ونحوها) يبقى مرمياً.
 */
function expectedError(err: unknown): string | null {
  if (err instanceof Error) {
    // رسائل الحراسات والتحقق الداخلية عربية مقصودة للمستخدم
    if (/[؀-ۿ]/.test(err.message)) return err.message;
  }
  return null;
}

// حدود اليوم بتوقيت الرياض — السيرفر يعمل بـ UTC، فاستخدام setHours المحلي
// يصنّف المواعيد قرب منتصف الليل في اليوم الخطأ (فرق 3 ساعات).
const RIYADH_TZ = "Asia/Riyadh";
function getRiyadhDate(offsetDays = 0): { start: Date; end: Date } {
  const now = new Date();
  const riyadhStr = now.toLocaleDateString("en-CA", { timeZone: RIYADH_TZ });
  const [y, m, d] = riyadhStr.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d + offsetDays, -3, 0, 0));
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}
function riyadhDayBoundaries(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00+03:00`);
  const end = new Date(`${dateStr}T23:59:59.999+03:00`);
  return { start, end };
}

// =============================================
// جلب مواعيد مقدم الخدمة لتاريخ محدد
// =============================================

export async function getProviderBookings(date?: string) {
  try {
    const { tenantId, userId, role } = await requireTenant();

    if (role !== "PROVIDER") throw new Error("هذه الصلاحية لمقدم الخدمة فقط");

    // حدود اليوم بتوقيت الرياض (لا توقيت السيرفر)
    const { start: startOfDay, end: endOfDay } = date
      ? riyadhDayBoundaries(date.slice(0, 10))
      : getRiyadhDate(0);

    const bookings = await db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        bookingStatus: leads.bookingStatus,
        bookingDate: leads.bookingDate,
        bookingEndTime: leads.bookingEndTime,
        bookingService: leads.bookingService,
        bookingDurationMin: leads.bookingDurationMin,
        bookingNotes: leads.bookingNotes,
      })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.bookingResourceId, userId),
          eq(leads.isDeleted, false),
          isNull(leads.archivedAt), // لا تُظهر حجوزات عملاء مؤرشفين (اتّساق مع coordinator/owner)
          gte(leads.bookingDate, startOfDay),
          lte(leads.bookingDate, endOfDay)
        )
      )
      .orderBy(asc(leads.bookingDate));

    return { success: true as const, bookings };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// جلب ملخص مواعيد اليوم والغد
// =============================================

export async function getProviderDashboard() {
  try {
    const { tenantId, userId, role } = await requireTenant();

    if (role !== "PROVIDER") throw new Error("هذه الصلاحية لمقدم الخدمة فقط");

    // حدود اليوم/الغد بتوقيت الرياض (لا توقيت السيرفر)
    const { start: todayStart, end: todayEnd } = getRiyadhDate(0);
    const { start: tomorrowStart, end: tomorrowEnd } = getRiyadhDate(1);

    const [todayBookings, tomorrowBookings] = await Promise.all([
      db
        .select({
          id: leads.id,
          name: leads.name,
          phone: leads.phone,
          bookingStatus: leads.bookingStatus,
          bookingDate: leads.bookingDate,
          bookingEndTime: leads.bookingEndTime,
          bookingService: leads.bookingService,
          bookingDurationMin: leads.bookingDurationMin,
          bookingNotes: leads.bookingNotes,
        })
        .from(leads)
        .where(
          and(
            eq(leads.tenantId, tenantId),
            eq(leads.bookingResourceId, userId),
            eq(leads.isDeleted, false),
            isNull(leads.archivedAt),
            gte(leads.bookingDate, todayStart),
            lt(leads.bookingDate, todayEnd) // حصري: todayEnd=منتصف ليل الغد (يمنع التكرار مع قائمة الغد)
          )
        )
        .orderBy(asc(leads.bookingDate)),
      db
        .select({
          id: leads.id,
          name: leads.name,
          phone: leads.phone,
          bookingStatus: leads.bookingStatus,
          bookingDate: leads.bookingDate,
          bookingEndTime: leads.bookingEndTime,
          bookingService: leads.bookingService,
          bookingDurationMin: leads.bookingDurationMin,
        })
        .from(leads)
        .where(
          and(
            eq(leads.tenantId, tenantId),
            eq(leads.bookingResourceId, userId),
            eq(leads.isDeleted, false),
            isNull(leads.archivedAt),
            gte(leads.bookingDate, tomorrowStart),
            lt(leads.bookingDate, tomorrowEnd)
          )
        )
        .orderBy(asc(leads.bookingDate)),
    ]);

    // الرسائل الواردة لهذا المقدم: غير المقروءة وليست صادرة من مقدّمي خدمة.
    // (رسائل المقدّمين موجّهة للمنسقين — كان يجلب كل رسائل الشركة فيرى المقدم
    //  رسائله هو ورسائل زملائه الموجّهة للاستقبال.)
    const unreadMessages = await db
      .select({
        id: internalMessages.id,
        content: internalMessages.content,
        senderRole: internalMessages.senderRole,
        createdAt: internalMessages.createdAt,
      })
      .from(internalMessages)
      .where(
        and(
          eq(internalMessages.tenantId, tenantId),
          eq(internalMessages.isRead, false),
          ne(internalMessages.senderRole, "PROVIDER")
        )
      )
      .orderBy(desc(internalMessages.createdAt))
      .limit(10);

    // جلب اسم المقدم
    const [provider] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return {
      success: true as const,
      providerName: provider?.name || "",
      todayBookings,
      tomorrowBookings,
      todayCount: todayBookings.length,
      tomorrowCount: tomorrowBookings.length,
      pendingToday: todayBookings.filter((b) => b.bookingStatus === "PENDING").length,
      unreadMessages,
    };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// تحديث حالة موعد من قِبَل المقدم نفسه
// =============================================

const PROVIDER_ALLOWED_STATUSES = ["COMPLETED", "ATTENDED_NOT_SUITABLE", "NO_RESPONSE"] as const;
type ProviderStatus = (typeof PROVIDER_ALLOWED_STATUSES)[number];

/**
 * المقدم يحدّث حالة موعد بنفسه — يحدّ من friction والاحتياج للمنسق.
 *
 * قيود الأمان:
 *   - PROVIDER فقط
 *   - فقط مواعيد bookingResourceId === userId (موعده الشخصي) — يُفرض ذرّياً
 *     في WHERE الـ UPDATE نفسه (لا TOCTOU بين SELECT والتحديث)
 *   - فقط الحالات: COMPLETED / ATTENDED_NOT_SUITABLE / NO_RESPONSE
 *   - لا يستطيع تعديل تواريخ، إلغاء، تأجيل (يرسل رسالة للمنسق بدلاً)
 */
export async function updateProviderBookingStatus(
  leadId: string,
  status: ProviderStatus,
) {
  try {
    const { tenantId, userId, role } = await requireTenant();
    if (role !== "PROVIDER") throw new Error("هذه الصلاحية لمقدم الخدمة فقط");

    if (!isUuid(leadId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    if (!PROVIDER_ALLOWED_STATUSES.includes(status)) {
      return { success: false as const, error: "حالة غير مسموحة" } satisfies Fail;
    }

    // تحقّق أن الموعد موجود + مُسند للمقدم نفسه (لجلب بيانات الإشعار/السجل —
    // أما فرض الملكية فيتكرر ذرّياً في WHERE الـ UPDATE أدناه)
    const [booking] = await db
      .select({
        id: leads.id,
        name: leads.name,
        currentStatus: leads.bookingStatus,
        bookingDate: leads.bookingDate,
        assignedTo: leads.assignedTo,
      })
      .from(leads)
      .where(
        and(
          eq(leads.id, leadId),
          eq(leads.tenantId, tenantId),
          eq(leads.bookingResourceId, userId),
          eq(leads.isDeleted, false),
          isNull(leads.archivedAt), // المزوّد لا يتصرّف على حجز عميل مؤرشف
        ),
      )
      .limit(1);

    if (!booking) {
      return { success: false as const, error: "الموعد غير موجود أو ليس مُسنَداً لك" } satisfies Fail;
    }

    // لا "تم الإجراء" لموعد مستقبلي — المقارنة مطلقة (اللحظة نفسها بأي توقيت)
    if (status === "COMPLETED" && booking.bookingDate && booking.bookingDate > new Date()) {
      return {
        success: false as const,
        error: "لا يمكن تعليم موعد مستقبلي كمكتمل — موعده لم يحن بعد",
      } satisfies Fail;
    }

    // اسم المقدم — لاستخدامه في الإشعار
    const [provider] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const providerName = provider?.name ?? "مقدم الخدمة";

    await db.transaction(async (tx) => {
      // UPDATE ذرّي: الملكية والـ tenant في WHERE نفسه — لو تغيّرت الإسنادات بين
      // القراءة والكتابة لا تُكتب شيئاً (سابقاً كان WHERE على id فقط = TOCTOU)
      const updated = await tx
        .update(leads)
        .set({ bookingStatus: status, updatedAt: new Date() })
        .where(
          and(
            eq(leads.id, leadId),
            eq(leads.tenantId, tenantId),
            eq(leads.bookingResourceId, userId),
            eq(leads.isDeleted, false),
            isNull(leads.archivedAt),
          ),
        )
        .returning({ id: leads.id });
      if (updated.length === 0) {
        throw new Error("الموعد غير موجود أو ليس مُسنَداً لك");
      }

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_UPDATED",
        entityType: "lead",
        entityId: leadId,
        details: {
          change: "booking_status",
          from: booking.currentStatus,
          to: status,
          updatedBy: "provider",
          leadName: booking.name,
        },
      });

      // أبلغ المنسق المُسند له العميل (لو موجود) — يُغلق loop التواصل
      if (booking.assignedTo) {
        const statusMsg: Record<typeof status, string> = {
          COMPLETED: "حضر العميل ✅",
          ATTENDED_NOT_SUITABLE: "حضر — لكن لم يناسبه",
          NO_RESPONSE: "لم يحضر العميل 📵",
        };
        await tx.insert(notifications).values({
          tenantId,
          userId: booking.assignedTo,
          type: "SYSTEM",
          title: `${providerName}: ${statusMsg[status]}`,
          message: `${booking.name} — ${statusMsg[status]}`,
        });
      }
    });

    revalidatePath("/provider");
    revalidatePath("/bookings");
    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// المقدم يضيف ملاحظة جلسة على موعد
// =============================================

/**
 * يُلحق ملاحظة جلسة على bookingNotes مع توقيت + اسم المقدم.
 * المنسق يراها في تفاصيل الحجز لاحقاً.
 */
export async function addProviderSessionNote(leadId: string, note: string) {
  try {
    const { tenantId, userId, role } = await requireTenant();
    if (role !== "PROVIDER") throw new Error("هذه الصلاحية لمقدم الخدمة فقط");

    if (!isUuid(leadId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    const trimmed = (note ?? "").trim();
    if (!trimmed || trimmed.length > 1000) {
      return { success: false as const, error: "الملاحظة يجب أن تكون 1-1000 حرف" } satisfies Fail;
    }

    const [booking] = await db
      .select({
        id: leads.id,
        name: leads.name,
        currentNotes: leads.bookingNotes,
        assignedTo: leads.assignedTo,
      })
      .from(leads)
      .where(
        and(
          eq(leads.id, leadId),
          eq(leads.tenantId, tenantId),
          eq(leads.bookingResourceId, userId),
          eq(leads.isDeleted, false),
          isNull(leads.archivedAt), // المزوّد لا يتصرّف على حجز عميل مؤرشف
        ),
      )
      .limit(1);

    if (!booking) {
      return { success: false as const, error: "الموعد غير موجود أو ليس مُسنَداً لك" } satisfies Fail;
    }

    // اسم المقدم
    const [provider] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const providerName = provider?.name ?? "مقدم الخدمة";

    // الوقت بصيغة عربية مختصرة
    const ts = new Date().toLocaleString("ar-SA-u-ca-gregory", {
      timeZone: "Asia/Riyadh",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    // ملاحظة الجلسة بصيغة موحّدة قابلة للتمييز عند العرض
    const sessionLine = `\n📝 ${providerName} (${ts}): ${trimmed}`;
    const newNotes = booking.currentNotes
      ? booking.currentNotes + sessionLine
      : sessionLine.trim();

    await db.transaction(async (tx) => {
      // UPDATE ذرّي: الملكية والـ tenant في WHERE نفسه (لا TOCTOU)
      const updated = await tx
        .update(leads)
        .set({ bookingNotes: newNotes, updatedAt: new Date() })
        .where(
          and(
            eq(leads.id, leadId),
            eq(leads.tenantId, tenantId),
            eq(leads.bookingResourceId, userId),
            eq(leads.isDeleted, false),
            isNull(leads.archivedAt),
          ),
        )
        .returning({ id: leads.id });
      if (updated.length === 0) {
        throw new Error("الموعد غير موجود أو ليس مُسنَداً لك");
      }

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "LEAD_UPDATED",
        entityType: "lead",
        entityId: leadId,
        details: {
          change: "provider_session_note",
          leadName: booking.name,
          notePreview: trimmed.slice(0, 100),
          addedBy: providerName,
        },
      });

      // أبلغ المنسق بالملاحظة الجديدة
      if (booking.assignedTo) {
        await tx.insert(notifications).values({
          tenantId,
          userId: booking.assignedTo,
          type: "SYSTEM",
          title: `📝 ملاحظة جلسة من ${providerName}`,
          message: `${booking.name}: ${trimmed.slice(0, 200)}`,
        });
      }
    });

    revalidatePath("/provider");
    revalidatePath("/bookings");
    return { success: true as const, note: sessionLine.trim() };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// إرسال رسالة سريعة من المقدم للرسبشن
// =============================================

export async function sendQuickMessage(content: string, messageType: string = "CUSTOM") {
  try {
    const { tenantId, userId, role } = await requireTenant();

    const trimmed = (content ?? "").trim();
    if (!trimmed || trimmed.length > 1000) {
      return { success: false as const, error: "الرسالة غير صالحة (1-1000 حرف)" } satisfies Fail;
    }
    const allowedTypes = ["CUSTOM", "QUICK_STATUS"];
    const validType = allowedTypes.includes(messageType) ? messageType : "CUSTOM";

    // جلب القسم الافتراضي للمقدم
    const { departmentProviders } = await import("@/db/schema");
    const [link] = await db
      .select({ departmentId: departmentProviders.departmentId })
      .from(departmentProviders)
      .where(eq(departmentProviders.userId, userId))
      .limit(1);

    await db.insert(internalMessages).values({
      tenantId,
      senderId: userId,
      senderRole: role,
      departmentId: link?.departmentId || null,
      messageType: validType,
      content: trimmed,
    });

    revalidatePath("/provider");
    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// جلب الرسائل للمنسق (غير المقروءة)
// =============================================

export async function getUnreadMessagesForCoordinator() {
  try {
    const { tenantId, role } = await requireTenant();

    if (!["ADMIN", "OWNER", "COORDINATOR", "SUPER_ADMIN"].includes(role)) {
      return { success: true as const, messages: [] };
    }

    const messages = await db
      .select({
        id: internalMessages.id,
        content: internalMessages.content,
        senderRole: internalMessages.senderRole,
        senderId: internalMessages.senderId,
        messageType: internalMessages.messageType,
        createdAt: internalMessages.createdAt,
        isRead: internalMessages.isRead,
      })
      .from(internalMessages)
      .where(
        and(
          eq(internalMessages.tenantId, tenantId),
          eq(internalMessages.isRead, false),
          eq(internalMessages.senderRole, "PROVIDER")
        )
      )
      .orderBy(desc(internalMessages.createdAt))
      .limit(20);

    return { success: true as const, messages };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// وضع علامة مقروء على الرسائل
// =============================================

export async function markMessagesAsRead(messageIds: string[]) {
  try {
    const { tenantId } = await requireTenant();
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return { success: true as const };
    }
    if (messageIds.length > 100) {
      return { success: false as const, error: "الحد الأقصى 100" } satisfies Fail;
    }
    // تحقق شكلي — ids تذهب خام إلى IN(...) في PG
    if (!messageIds.every(isUuid)) {
      return { success: false as const, error: "معرّف غير صالح ضمن القائمة" } satisfies Fail;
    }

    // قيّد التحديث بـ tenantId — يمنع cross-tenant marking
    await db
      .update(internalMessages)
      .set({ isRead: true })
      .where(
        and(
          inArray(internalMessages.id, messageIds),
          eq(internalMessages.tenantId, tenantId),
        ),
      );

    revalidatePath("/bookings");
    revalidatePath("/provider");
    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}
