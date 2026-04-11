import { getLeads } from "@/app/actions/leads";
import { requireAuth } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { pipelineStages, users, tags } from "@/db/schema";
import { eq, asc, and } from "drizzle-orm";
import LeadsClient from "./leads-client";

export default async function LeadsPage() {
  const session = await requireAuth();
  const user = session.user as Record<string, unknown>;
  const tenantId = user.tenantId as string;
  const userRole = user.role as string;
  const userId = session.user.id;

  if (!tenantId) {
    redirect("/register");
  }

  // جلب العملاء
  // المنسق: يرى كل العملاء ما عدا المعيّنين لغيره في مراحل حصرية
  let leadsData;
  try {
    leadsData = await getLeads(
      userRole === "COORDINATOR"
        ? { excludeExclusiveForUser: userId }
        : undefined
    );
  } catch {
    leadsData = { data: [], total: 0 };
  }

  // جلب المراحل
  let stagesData: { id: string; name: string; color: string; isBooking?: boolean }[] = [];
  try {
    stagesData = await db
      .select({
        id: pipelineStages.id,
        name: pipelineStages.name,
        color: pipelineStages.color,
      })
      .from(pipelineStages)
      .where(eq(pipelineStages.tenantId, tenantId))
      .orderBy(asc(pipelineStages.position));

    // محاولة جلب isBooking بشكل آمن (العمود قد لا يكون موجوداً بعد)
    try {
      const stagesWithBooking = await db
        .select({
          id: pipelineStages.id,
          isBooking: pipelineStages.isBooking,
        })
        .from(pipelineStages)
        .where(eq(pipelineStages.tenantId, tenantId));

      const bookingMap = new Map(stagesWithBooking.map((s) => [s.id, s.isBooking]));
      stagesData = stagesData.map((s) => ({ ...s, isBooking: bookingMap.get(s.id) || false }));
    } catch {
      // is_booking column doesn't exist yet — ignore
    }
  } catch {
    // ignore
  }

  // جلب أعضاء الفريق (للتعيين)
  let teamMembers: { id: string; name: string }[] = [];
  try {
    teamMembers = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
  } catch {
    // ignore
  }

  // جلب التصنيفات
  let tagsData: { id: string; name: string; color: string }[] = [];
  try {
    tagsData = await db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(tags)
      .where(eq(tags.tenantId, tenantId))
      .orderBy(asc(tags.name));
  } catch {
    // ignore
  }

  return (
    <LeadsClient
      initialLeads={leadsData.data as Parameters<typeof LeadsClient>[0]["initialLeads"]}
      stages={stagesData}
      total={leadsData.total}
      teamMembers={teamMembers}
      tags={tagsData}
      currentUserRole={userRole}
    />
  );
}
