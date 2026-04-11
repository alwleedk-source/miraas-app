"use server";

import { db } from "@/db";
import { notifications } from "@/db/schema";
import { eq, and, isNull, desc, count } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";

const getContext = requireTenant;

// جلب إشعارات المستخدم
export async function getNotifications(limit = 20) {
  const { userId } = await getContext();
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

// عدد الإشعارات غير المقروءة
export async function getUnreadCount() {
  const { userId } = await getContext();
  const [result] = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return result.count;
}

// تعليم إشعار كمقروء
export async function markAsRead(notificationId: string) {
  const { userId } = await getContext();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
  revalidatePath("/");
}

// تعليم الكل كمقروء
export async function markAllAsRead() {
  const { userId } = await getContext();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  revalidatePath("/");
}

// إنشاء إشعار (يُستخدم داخلياً من Server Actions أخرى)
export async function createNotification(input: {
  tenantId: string;
  userId: string;
  type: "NEW_LEAD" | "LEAD_ASSIGNED" | "FOLLOW_UP_REMINDER" | "SYSTEM";
  title: string;
  message?: string;
}) {
  await db.insert(notifications).values({
    tenantId: input.tenantId,
    userId: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
  });
}
