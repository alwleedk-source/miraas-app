"use server";

import { db } from "@/db";
import { leads, internalMessages, users } from "@/db/schema";
import { eq, and, gte, lte, inArray, desc, asc } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";

// =============================================
// جلب مواعيد مقدم الخدمة لتاريخ محدد
// =============================================

export async function getProviderBookings(date?: string) {
  const { tenantId, userId, role } = await requireTenant();

  if (role !== "PROVIDER") throw new Error("unauthorized");

  const targetDate = date ? new Date(date) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

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
        gte(leads.bookingDate, startOfDay),
        lte(leads.bookingDate, endOfDay)
      )
    )
    .orderBy(asc(leads.bookingDate));

  return bookings;
}

// =============================================
// جلب ملخص مواعيد اليوم والغد
// =============================================

export async function getProviderDashboard() {
  const { tenantId, userId, role } = await requireTenant();

  if (role !== "PROVIDER") throw new Error("unauthorized");

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const tomorrowStart = new Date(todayEnd);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  tomorrowStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setHours(23, 59, 59, 999);

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
          gte(leads.bookingDate, todayStart),
          lte(leads.bookingDate, todayEnd)
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
        bookingService: leads.bookingService,
        bookingDurationMin: leads.bookingDurationMin,
      })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.bookingResourceId, userId),
          eq(leads.isDeleted, false),
          gte(leads.bookingDate, tomorrowStart),
          lte(leads.bookingDate, tomorrowEnd)
        )
      )
      .orderBy(asc(leads.bookingDate)),
  ]);

  // جلب الرسائل غير المقروءة
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
        eq(internalMessages.isRead, false)
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
    providerName: provider?.name || "",
    todayBookings,
    tomorrowBookings,
    todayCount: todayBookings.length,
    tomorrowCount: tomorrowBookings.length,
    pendingToday: todayBookings.filter((b) => b.bookingStatus === "PENDING").length,
    unreadMessages,
  };
}

// =============================================
// إرسال رسالة سريعة من المقدم للرسبشن
// =============================================

export async function sendQuickMessage(content: string, messageType: string = "CUSTOM") {
  const { tenantId, userId, role } = await requireTenant();

  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 1000) throw new Error("الرسالة غير صالحة (1-1000 حرف)");
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
}

// =============================================
// جلب الرسائل للمنسق (غير المقروءة)
// =============================================

export async function getUnreadMessagesForCoordinator() {
  const { tenantId, role } = await requireTenant();

  if (!["ADMIN", "OWNER", "COORDINATOR", "SUPER_ADMIN"].includes(role)) {
    return [];
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

  return messages;
}

// =============================================
// وضع علامة مقروء على الرسائل
// =============================================

export async function markMessagesAsRead(messageIds: string[]) {
  const { tenantId } = await requireTenant();
  if (messageIds.length === 0) return;
  if (messageIds.length > 100) throw new Error("الحد الأقصى 100");

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
}
