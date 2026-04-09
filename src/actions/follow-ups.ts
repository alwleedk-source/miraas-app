"use server";

import { db } from "@/db";
import { followUps, activityLog } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * إنشاء متابعة جديدة
 */
export async function createFollowUp(input: {
  tenantId: string;
  leadId: string;
  userId: string;
  type: "CALL" | "MESSAGE" | "MEETING" | "EMAIL" | "WHATSAPP" | "NOTE";
  notes?: string;
  scheduledAt?: Date;
}) {
  const [followUp] = await db
    .insert(followUps)
    .values(input)
    .returning();

  // تسجيل النشاط
  await db.insert(activityLog).values({
    tenantId: input.tenantId,
    userId: input.userId,
    action: "FOLLOW_UP_CREATED",
    entityType: "follow_up",
    entityId: followUp.id,
    details: {
      leadId: input.leadId,
      type: input.type,
    },
  });

  revalidatePath("/leads");
  return followUp;
}

/**
 * جلب متابعات عميل معين
 */
export async function getFollowUps(leadId: string, tenantId: string) {
  const data = await db.query.followUps.findMany({
    where: and(eq(followUps.leadId, leadId), eq(followUps.tenantId, tenantId)),
    with: {
      user: { columns: { id: true, name: true, image: true } },
    },
    orderBy: [desc(followUps.createdAt)],
  });

  return data;
}

/**
 * جلب المتابعات المجدولة لليوم
 */
export async function getTodayScheduledFollowUps(tenantId: string, userId?: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const conditions = [
    eq(followUps.tenantId, tenantId),
  ];
  if (userId) conditions.push(eq(followUps.userId, userId));

  const data = await db.query.followUps.findMany({
    where: and(...conditions),
    with: {
      user: { columns: { id: true, name: true } },
      lead: { columns: { id: true, name: true, phone: true } },
    },
    orderBy: [desc(followUps.scheduledAt)],
  });

  // فلتر الـ scheduledAt يدوياً لأن Drizzle تحتاج between
  return data.filter((f) => {
    if (!f.scheduledAt) return false;
    const d = new Date(f.scheduledAt);
    return d >= today && d < tomorrow;
  });
}
