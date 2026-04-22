import { getLeads } from "@/app/actions/leads";
import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { pipelineStages, users, tags, services, departments } from "@/db/schema";
import { eq, asc, and, isNull } from "drizzle-orm";
import LeadsClient from "./leads-client";

export default async function LeadsPage() {
  const { tenantId, role: userRole, userId } = await requireTenant();

  if (!tenantId) {
    redirect("/register");
  }
  if (userRole === "PROVIDER") {
    redirect("/provider");
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
      .where(and(eq(pipelineStages.tenantId, tenantId), isNull(pipelineStages.archivedAt)))
      .orderBy(asc(pipelineStages.position));

    // محاولة جلب isBooking بشكل آمن (العمود قد لا يكون موجوداً بعد)
    try {
      const stagesWithBooking = await db
        .select({
          id: pipelineStages.id,
          isBooking: pipelineStages.isBooking,
        })
        .from(pipelineStages)
        .where(and(eq(pipelineStages.tenantId, tenantId), isNull(pipelineStages.archivedAt)));

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

  // جلب الخدمات النشطة (مع departmentId للفلترة)
  let servicesData: { id: string; name: string; departmentId: string | null }[] = [];
  try {
    servicesData = await db
      .select({ id: services.id, name: services.name, departmentId: services.departmentId })
      .from(services)
      .where(and(eq(services.tenantId, tenantId), eq(services.isActive, true)))
      .orderBy(asc(services.name));
  } catch {
    // ignore
  }

  // جلب الأقسام النشطة
  let departmentsData: { id: string; name: string; color: string }[] = [];
  try {
    departmentsData = await db
      .select({ id: departments.id, name: departments.name, color: departments.color })
      .from(departments)
      .where(and(eq(departments.tenantId, tenantId), eq(departments.isActive, true)))
      .orderBy(asc(departments.name));
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
      availableServices={servicesData}
      availableDepartments={departmentsData}
    />
  );
}
