/**
 * Helper يجلب lead كامل من DB ويبني payload كاملة للـ backup
 * يُستخدم بعد كل DB write لـ lead.
 */

import { db } from "@/db";
import { leads, users, leadSources, pipelineStages, departments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { BackupPayload, BackupEventType } from "./backup-push";
import { backupPush } from "./backup-push";

export async function buildBackupPayload(
  leadId: string,
  tenantId: string,
  event: BackupEventType,
  meta?: BackupPayload["meta"],
): Promise<BackupPayload | null> {
  // لا نرمي أبداً — المستدعون يطلقونها fire-and-forget (void ...then(...)) بلا catch،
  // فأي خطأ DB عابر هنا كان سيصبح unhandled rejection. النسخ ثانوي: نرجع null عند الفشل.
  try {
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
      bookingDepartmentName: departments.name,
    })
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .leftJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
    .leftJoin(users, eq(leads.assignedTo, users.id))
    .leftJoin(departments, eq(leads.bookingDepartmentId, departments.id))
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
      bookingDepartmentName: row.bookingDepartmentName ?? null,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      archiveReason: row.archiveReason ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    meta,
  };
  } catch {
    return null;
  }
}

/**
 * يدفع batch من leads للـ Sheet — استخدم بعد bulk operations.
 * fire-and-forget لكل lead على حدة (Apps Script يقبل request واحد في كل مرة).
 * نستخدم setTimeout لتقطيع الدفعات حتى لا نُغرق Apps Script.
 */
export async function backupPushBatch(
  leadIds: string[],
  tenantId: string,
  event: BackupEventType,
  meta?: BackupPayload["meta"],
): Promise<void> {
  if (leadIds.length === 0) return;
  // قطّع لمجموعات من 10 لتجنّب إرهاق Apps Script
  const CHUNK = 10;
  for (let i = 0; i < leadIds.length; i += CHUNK) {
    const chunk = leadIds.slice(i, i + CHUNK);
    // ادفع المجموعة بالتوازي، انتظر بسيط بين المجموعات
    await Promise.allSettled(
      chunk.map(async (id) => {
        const p = await buildBackupPayload(id, tenantId, event, meta);
        if (p) await backupPush(tenantId, p);
      }),
    );
    if (i + CHUNK < leadIds.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
