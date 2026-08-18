"use server";

import { db } from "@/db";
import { tags, tagAssignments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import {
  assertLeadInTenant,
  assertRole,
  ROLE,
} from "@/lib/tenant-guards";

// =============================================
// إنشاء تصنيف جديد
// =============================================

export async function createTag(input: { name: string; color?: string }) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  const name = input.name.trim();
  if (!name || name.length > 100) return { success: false as const, error: "اسم التصنيف غير صالح" };
  if (input.color && !/^#[0-9A-Fa-f]{6}$/.test(input.color)) {
    return { success: false as const, error: "لون غير صالح" };
  }

  const [tag] = await db
    .insert(tags)
    .values({ tenantId, name, color: input.color || "#6B7280" })
    .returning();
  revalidatePath("/leads");
  return { success: true as const, ...tag };
}

// =============================================
// جلب تصنيفات الشركة
// =============================================

export async function getTags() {
  const { tenantId } = await requireTenant();
  return db.select().from(tags).where(eq(tags.tenantId, tenantId));
}

// =============================================
// تعيين تصنيف لعميل
// =============================================

export async function assignTag(leadId: string, tagId: string) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

  // تحقق cross-tenant: lead + tag كلاهما يجب أن يكون في نفس الـ tenant
  await assertLeadInTenant(leadId, tenantId);
  const [tag] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.tenantId, tenantId)))
    .limit(1);
  if (!tag) return { success: false as const, error: "التصنيف غير موجود" };

  // منع التكرار
  const existing = await db
    .select({ id: tagAssignments.id })
    .from(tagAssignments)
    .where(and(eq(tagAssignments.leadId, leadId), eq(tagAssignments.tagId, tagId)))
    .limit(1);
  if (existing.length > 0) return { success: true as const, ...existing[0] };

  const [assignment] = await db
    .insert(tagAssignments)
    .values({ leadId, tagId })
    .returning();
  revalidatePath("/leads");
  return { success: true as const, ...assignment };
}

// =============================================
// إزالة تصنيف من عميل
// =============================================

export async function removeTag(leadId: string, tagId: string) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  // تحقق من تبعية الـ lead للـ tenant — يمنع حذف tag من lead شركة أخرى
  await assertLeadInTenant(leadId, tenantId);
  // تحقق من تبعية الـ tag للـ tenant
  const [tag] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.tenantId, tenantId)))
    .limit(1);
  if (!tag) return { success: false as const, error: "التصنيف غير موجود" };

  await db
    .delete(tagAssignments)
    .where(and(eq(tagAssignments.leadId, leadId), eq(tagAssignments.tagId, tagId)));
  revalidatePath("/leads");
  return { success: true as const };
}

// =============================================
// جلب تصنيفات عميل معين
// =============================================

export async function getLeadTags(leadId: string) {
  const { tenantId } = await requireTenant();
  // تحقق أن الـ lead يخص الـ tenant قبل كشف تصنيفاته
  await assertLeadInTenant(leadId, tenantId);

  return await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tagAssignments)
    .innerJoin(tags, eq(tagAssignments.tagId, tags.id))
    .where(and(eq(tagAssignments.leadId, leadId), eq(tags.tenantId, tenantId)));
}

// =============================================
// حذف تصنيف
// =============================================

export async function deleteTag(tagId: string) {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);
  await db
    .delete(tags)
    .where(and(eq(tags.id, tagId), eq(tags.tenantId, tenantId)));
  revalidatePath("/leads");
}
