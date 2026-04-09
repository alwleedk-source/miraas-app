"use server";

import { db } from "@/db";
import {
  pipelineStages,
  tags,
  tagAssignments,
  webhookEndpoints,
  whatsappConfigs,
  activityLog,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { generateSecretKey } from "@/lib/utils";
import { revalidatePath } from "next/cache";

// ==========================================
// مراحل الأنابيب
// ==========================================

export async function getPipelineStages(tenantId: string) {
  return db.query.pipelineStages.findMany({
    where: eq(pipelineStages.tenantId, tenantId),
    orderBy: [asc(pipelineStages.position)],
  });
}

export async function createPipelineStage(input: {
  tenantId: string;
  name: string;
  color: string;
  position: number;
}) {
  const [stage] = await db
    .insert(pipelineStages)
    .values(input)
    .returning();
  revalidatePath("/pipeline");
  return stage;
}

export async function updatePipelineStage(
  stageId: string,
  tenantId: string,
  data: { name?: string; color?: string; position?: number }
) {
  const [updated] = await db
    .update(pipelineStages)
    .set(data)
    .where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.tenantId, tenantId)))
    .returning();
  revalidatePath("/pipeline");
  return updated;
}

export async function deletePipelineStage(stageId: string, tenantId: string) {
  await db
    .delete(pipelineStages)
    .where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.tenantId, tenantId)));
  revalidatePath("/pipeline");
}

export async function reorderPipelineStages(
  tenantId: string,
  orderedIds: string[]
) {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(pipelineStages)
      .set({ position: i })
      .where(
        and(
          eq(pipelineStages.id, orderedIds[i]),
          eq(pipelineStages.tenantId, tenantId)
        )
      );
  }
  revalidatePath("/pipeline");
}

// ==========================================
// التصنيفات (Tags)
// ==========================================

export async function getTags(tenantId: string) {
  return db.query.tags.findMany({
    where: eq(tags.tenantId, tenantId),
  });
}

export async function createTag(input: {
  tenantId: string;
  name: string;
  color: string;
}) {
  const [tag] = await db.insert(tags).values(input).returning();
  return tag;
}

export async function deleteTag(tagId: string, tenantId: string) {
  // حذف الروابط أولاً
  await db.delete(tagAssignments).where(eq(tagAssignments.tagId, tagId));
  await db
    .delete(tags)
    .where(and(eq(tags.id, tagId), eq(tags.tenantId, tenantId)));
}

export async function assignTagToLead(leadId: string, tagId: string) {
  await db.insert(tagAssignments).values({ leadId, tagId });
  revalidatePath("/leads");
}

export async function removeTagFromLead(leadId: string, tagId: string) {
  await db
    .delete(tagAssignments)
    .where(and(eq(tagAssignments.leadId, leadId), eq(tagAssignments.tagId, tagId)));
  revalidatePath("/leads");
}

// ==========================================
// Webhook Endpoints
// ==========================================

export async function getWebhookEndpoints(tenantId: string) {
  return db.query.webhookEndpoints.findMany({
    where: eq(webhookEndpoints.tenantId, tenantId),
  });
}

export async function createWebhookEndpoint(tenantId: string, label: string) {
  const [endpoint] = await db
    .insert(webhookEndpoints)
    .values({
      tenantId,
      secretKey: generateSecretKey(),
      label,
      isActive: true,
    })
    .returning();
  revalidatePath("/settings/webhooks");
  return endpoint;
}

export async function regenerateWebhookSecret(endpointId: string, tenantId: string) {
  const [updated] = await db
    .update(webhookEndpoints)
    .set({ secretKey: generateSecretKey() })
    .where(
      and(
        eq(webhookEndpoints.id, endpointId),
        eq(webhookEndpoints.tenantId, tenantId)
      )
    )
    .returning();
  revalidatePath("/settings/webhooks");
  return updated;
}

export async function toggleWebhookEndpoint(endpointId: string, tenantId: string) {
  const endpoint = await db.query.webhookEndpoints.findFirst({
    where: and(
      eq(webhookEndpoints.id, endpointId),
      eq(webhookEndpoints.tenantId, tenantId)
    ),
  });
  if (!endpoint) throw new Error("النقطة غير موجودة");

  const [updated] = await db
    .update(webhookEndpoints)
    .set({ isActive: !endpoint.isActive })
    .where(eq(webhookEndpoints.id, endpointId))
    .returning();
  revalidatePath("/settings/webhooks");
  return updated;
}

// ==========================================
// إعدادات واتساب
// ==========================================

export async function getWhatsAppConfig(tenantId: string) {
  return db.query.whatsappConfigs.findFirst({
    where: eq(whatsappConfigs.tenantId, tenantId),
  });
}

export async function saveWhatsAppConfig(input: {
  tenantId: string;
  apiKeyEncrypted: string;
  phoneNumber: string;
  provider: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
}) {
  const existing = await db.query.whatsappConfigs.findFirst({
    where: eq(whatsappConfigs.tenantId, input.tenantId),
  });

  if (existing) {
    const [updated] = await db
      .update(whatsappConfigs)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(whatsappConfigs.tenantId, input.tenantId))
      .returning();
    revalidatePath("/settings/whatsapp");
    return updated;
  }

  const [created] = await db
    .insert(whatsappConfigs)
    .values(input)
    .returning();
  revalidatePath("/settings/whatsapp");
  return created;
}

export async function toggleWhatsApp(tenantId: string) {
  const config = await getWhatsAppConfig(tenantId);
  if (!config) throw new Error("الإعدادات غير موجودة");

  const [updated] = await db
    .update(whatsappConfigs)
    .set({ isActive: !config.isActive, updatedAt: new Date() })
    .where(eq(whatsappConfigs.tenantId, tenantId))
    .returning();
  revalidatePath("/settings/whatsapp");
  return updated;
}

// ==========================================
// سجل النشاطات
// ==========================================

export async function getActivityLog(
  tenantId: string,
  limit: number = 20
) {
  return db.query.activityLog.findMany({
    where: eq(activityLog.tenantId, tenantId),
    with: {
      user: { columns: { id: true, name: true, image: true } },
    },
    orderBy: [activityLog.createdAt],
    limit,
  });
}
