import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { pipelineStages, leads } from "@/db/schema";
import { eq, and, asc, count } from "drizzle-orm";
import { PipelineManager } from "@/components/pipeline/pipeline-manager";

export default async function PipelinePage() {
  const { tenantId, role } = await requireTenant();
  if (!tenantId) redirect("/register");
  if (role === "PROVIDER") redirect("/provider");
  // Pipeline settings — OWNER/ADMIN فقط
  if (!["OWNER", "ADMIN", "SUPER_ADMIN"].includes(role)) redirect("/");

  // جلب المراحل مع عدد العملاء لكل مرحلة
  const stages = await db
    .select({
      id: pipelineStages.id,
      name: pipelineStages.name,
      color: pipelineStages.color,
      position: pipelineStages.position,
      isDefault: pipelineStages.isDefault,
      isExclusive: pipelineStages.isExclusive,
    })
    .from(pipelineStages)
    .where(eq(pipelineStages.tenantId, tenantId))
    .orderBy(asc(pipelineStages.position));

  const stagesWithCounts = await Promise.all(
    stages.map(async (stage) => {
      const [{ leadsCount }] = await db
        .select({ leadsCount: count() })
        .from(leads)
        .where(
          and(
            eq(leads.stageId, stage.id),
            eq(leads.tenantId, tenantId),
            eq(leads.isDeleted, false)
          )
        );
      return { ...stage, count: leadsCount };
    })
  );

  const totalLeads = stagesWithCounts.reduce((s, st) => s + st.count, 0);

  return (
    <PipelineManager
      stages={stagesWithCounts}
      totalLeads={totalLeads}
    />
  );
}
