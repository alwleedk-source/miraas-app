/**
 * Helper يجلب lead كامل من DB ويبني payload كاملة للـ backup
 * يُستخدم بعد كل DB write لـ lead.
 */

import { db } from "@/db";
import { leads, users, leadSources, pipelineStages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { BackupPayload, BackupEventType } from "./backup-push";

export async function buildBackupPayload(
  leadId: string,
  tenantId: string,
  event: BackupEventType,
  meta?: BackupPayload["meta"],
): Promise<BackupPayload | null> {
  const [row] = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      priority: leads.priority,
      bookingStatus: leads.bookingStatus,
      bookingDate: leads.bookingDate,
      bookingService: leads.bookingService,
      bookingNotes: leads.bookingNotes,
      archivedAt: leads.archivedAt,
      archiveReason: leads.archiveReason,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
      sourceName: leadSources.name,
      stageName: pipelineStages.name,
      assignedToName: users.name,
    })
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .leftJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
    .leftJoin(users, eq(leads.assignedTo, users.id))
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
    .limit(1);

  if (!row) return null;

  return {
    event,
    timestamp: new Date().toISOString(),
    lead: {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email ?? null,
      priority: row.priority,
      sourceName: row.sourceName ?? null,
      stageName: row.stageName ?? null,
      assignedToName: row.assignedToName ?? null,
      bookingStatus: row.bookingStatus ?? null,
      bookingDate: row.bookingDate ? row.bookingDate.toISOString() : null,
      bookingService: row.bookingService ?? null,
      bookingNotes: row.bookingNotes ?? null,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      archiveReason: row.archiveReason ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    meta,
  };
}
