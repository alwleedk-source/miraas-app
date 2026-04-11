"use server";

import { db } from "@/db";
import { tags, tagAssignments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";

const getTenantId = requireTenant;

// إنشاء تصنيف جديد
export async function createTag(input: { name: string; color?: string }) {
  const { tenantId } = await getTenantId();
  const [tag] = await db
    .insert(tags)
    .values({ tenantId, name: input.name, color: input.color || "#6B7280" })
    .returning();
  revalidatePath("/leads");
  return tag;
}

// جلب تصنيفات الشركة
export async function getTags() {
  const { tenantId } = await getTenantId();
  return db.select().from(tags).where(eq(tags.tenantId, tenantId));
}

// تعيين تصنيف لعميل
export async function assignTag(leadId: string, tagId: string) {
  const { tenantId } = await getTenantId();
  // تحقق من أن التصنيف يخص الشركة
  const [tag] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.tenantId, tenantId)));
  if (!tag) throw new Error("التصنيف غير موجود");

  // تحقق من عدم التكرار
  const existing = await db
    .select()
    .from(tagAssignments)
    .where(and(eq(tagAssignments.leadId, leadId), eq(tagAssignments.tagId, tagId)));
  if (existing.length > 0) return existing[0];

  const [assignment] = await db
    .insert(tagAssignments)
    .values({ leadId, tagId })
    .returning();
  revalidatePath("/leads");
  return assignment;
}

// إزالة تصنيف من عميل
export async function removeTag(leadId: string, tagId: string) {
  await db
    .delete(tagAssignments)
    .where(and(eq(tagAssignments.leadId, leadId), eq(tagAssignments.tagId, tagId)));
  revalidatePath("/leads");
}

// جلب تصنيفات عميل معين
export async function getLeadTags(leadId: string) {
  const result = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tagAssignments)
    .innerJoin(tags, eq(tagAssignments.tagId, tags.id))
    .where(eq(tagAssignments.leadId, leadId));
  return result;
}

// حذف تصنيف
export async function deleteTag(tagId: string) {
  const { tenantId } = await getTenantId();
  await db.delete(tags).where(and(eq(tags.id, tagId), eq(tags.tenantId, tenantId)));
  revalidatePath("/leads");
}
