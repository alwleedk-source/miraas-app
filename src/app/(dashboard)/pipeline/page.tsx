import { requireTenant } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { pipelineStages, leads } from "@/db/schema";
import { eq, and, asc, count, isNull } from "drizzle-orm";
import { PipelineManager } from "@/components/pipeline/pipeline-manager";
import { getArchivedStages } from "@/actions/pipeline";

export default async function PipelinePage() {
  const { tenantId, role } = await requireTenant();
  if (!tenantId) redirect("/register");
  if (role === "PROVIDER") redirect("/provider");
  if (!["OWNER", "ADMIN", "SUPER_ADMIN"].includes(role)) redirect("/");

  // المراحل النشطة فقط — المؤرشفة في قسم منفصل
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
    .where(
      and(
        eq(pipelineStages.tenantId, tenantId),
        isNull(pipelineStages.archivedAt),
      ),
    )
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
            eq(leads.isDeleted, false),
            // استثنِ المؤرشفين — يطابق عدّادات الـ dashboard (stageBreakdown هناك)
            isNull(leads.archivedAt),
          ),
        );
      return { ...stage, count: leadsCount };
    }),
  );

  // العقد الجديد: { success: true, stages } | { success: false } — الفشل = لا أرشيف
  const archivedResult = await getArchivedStages().catch(() => null);
  const archivedStages = archivedResult?.success ? archivedResult.stages : [];
  const totalLeads = stagesWithCounts.reduce((s, st) => s + st.count, 0);

  return (
    <PipelineManager
      stages={stagesWithCounts}
      totalLeads={totalLeads}
      archivedStages={archivedStages}
    />
  );
}
