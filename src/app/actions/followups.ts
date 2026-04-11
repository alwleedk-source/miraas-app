"use server";

import { db } from "@/db";
import { followUps, activityLog } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";

const getContext = requireTenant;

// تعليم متابعة كمكتملة
export async function completeFollowUp(followUpId: string) {
  const { userId, tenantId } = await getContext();

  // جلب المتابعة أولاً لمعرفة الـ leadId
  const [existing] = await db
    .select({ leadId: followUps.leadId, type: followUps.type })
    .from(followUps)
    .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

  await db
    .update(followUps)
    .set({ completedAt: new Date() })
    .where(
      and(
        eq(followUps.id, followUpId),
        eq(followUps.tenantId, tenantId)
      )
    );

  // Fix #9: تسجيل في سجل النشاط
  if (existing) {
    await db.insert(activityLog).values({
      tenantId,
      userId,
      action: "FOLLOW_UP_CREATED",
      entityType: "follow_up",
      entityId: followUpId,
      details: { action: "completed", leadId: existing.leadId, type: existing.type },
    });
  }

  revalidatePath("/");
}

// تأجيل متابعة (تغيير scheduledAt)
export async function snoozeFollowUp(followUpId: string, days: number) {
  const { tenantId } = await getContext();

  const [existing] = await db
    .select({ scheduledAt: followUps.scheduledAt })
    .from(followUps)
    .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

  if (!existing?.scheduledAt) return;

  const newDate = new Date(existing.scheduledAt);
  newDate.setDate(newDate.getDate() + days);

  await db
    .update(followUps)
    .set({ scheduledAt: newDate })
    .where(
      and(
        eq(followUps.id, followUpId),
        eq(followUps.tenantId, tenantId)
      )
    );

  revalidatePath("/");
}
