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

// ملاحظة: createNotification المحذوف — كان Server Action مكشوف على الإنترنت
// يقبل tenantId/userId من client = phishing vector. إذا احتجت إنشاء إشعار،
// استدع db.insert(notifications) مباشرة من داخل action آخر محمي.
