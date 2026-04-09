"use server";

import { db } from "@/db";
import { leads, followUps, pipelineStages, users, activityLog } from "@/db/schema";
import { eq, and, desc, sql, count, gte } from "drizzle-orm";

/**
 * إحصائيات لوحة التحكم الرئيسية
 */
export async function getDashboardStats(tenantId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // إجمالي العملاء
  const [{ total: totalLeads }] = await db
    .select({ total: count() })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.isDeleted, false)));

  // عملاء اليوم
  const [{ total: todayLeads }] = await db
    .select({ total: count() })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        gte(leads.createdAt, today)
      )
    );

  // عملاء الأمس
  const [{ total: yesterdayLeads }] = await db
    .select({ total: count() })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        gte(leads.createdAt, yesterday),
        sql`${leads.createdAt} < ${today}`
      )
    );

  // متابعات اليوم
  const [{ total: todayFollowUps }] = await db
    .select({ total: count() })
    .from(followUps)
    .where(
      and(eq(followUps.tenantId, tenantId), gte(followUps.createdAt, today))
    );

  // توزيع الأنابيب
  const pipelineData = await db
    .select({
      stageId: leads.stageId,
      stageName: pipelineStages.name,
      stageColor: pipelineStages.color,
      stagePosition: pipelineStages.position,
      count: count(),
    })
    .from(leads)
    .leftJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
    .where(and(eq(leads.tenantId, tenantId), eq(leads.isDeleted, false)))
    .groupBy(leads.stageId, pipelineStages.name, pipelineStages.color, pipelineStages.position);

  // آخر النشاطات
  const recentActivity = await db.query.activityLog.findMany({
    where: eq(activityLog.tenantId, tenantId),
    with: {
      user: { columns: { id: true, name: true, image: true } },
    },
    orderBy: [desc(activityLog.createdAt)],
    limit: 10,
  });

  // أفضل المنسقين
  const topCoordinators = await db
    .select({
      userId: leads.assignedTo,
      userName: users.name,
      leadCount: count(),
    })
    .from(leads)
    .innerJoin(users, eq(leads.assignedTo, users.id))
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        sql`${leads.assignedTo} IS NOT NULL`
      )
    )
    .groupBy(leads.assignedTo, users.name)
    .orderBy(sql`count(*) DESC`)
    .limit(5);

  return {
    totalLeads,
    todayLeads,
    yesterdayLeads,
    todayFollowUps,
    pipeline: pipelineData.sort((a, b) => (a.stagePosition || 0) - (b.stagePosition || 0)),
    recentActivity,
    topCoordinators,
  };
}
