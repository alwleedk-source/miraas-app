import { db } from "@/db";
import { leads, users, pipelineStages, leadSources, departments } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * تحقق أن lead ينتمي للـ tenant المعطى.
 * يحمي من IDOR عند تمرير leadId من client.
 */
export async function assertLeadInTenant(leadId: string, tenantId: string) {
  const [l] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
    .limit(1);
  if (!l) throw new Error("العميل غير موجود أو ليس ضمن صلاحياتك");
}

/**
 * تحقق أن user ينتمي للـ tenant (قبل إسناد lead أو حجز له).
 * يمنع cross-tenant corruption.
 */
export async function assertUserInTenant(userId: string, tenantId: string) {
  const [u] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
    .limit(1);
  if (!u) throw new Error("المستخدم غير موجود في الشركة");
  if (!u.isActive) throw new Error("المستخدم معطَّل");
}

export async function assertStageInTenant(
  stageId: string,
  tenantId: string,
  options: { allowArchived?: boolean } = {},
) {
  const [s] = await db
    .select({ id: pipelineStages.id, archivedAt: pipelineStages.archivedAt })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.tenantId, tenantId)))
    .limit(1);
  if (!s) throw new Error("المرحلة غير موجودة");
  if (s.archivedAt && !options.allowArchived) {
    throw new Error("لا يمكن استخدام مرحلة مؤرشفة — استرجعها أولاً");
  }
}

export async function assertSourceInTenant(sourceId: string, tenantId: string) {
  const [s] = await db
    .select({ id: leadSources.id })
    .from(leadSources)
    .where(and(eq(leadSources.id, sourceId), eq(leadSources.tenantId, tenantId)))
    .limit(1);
  if (!s) throw new Error("المصدر غير موجود");
}

export async function assertDepartmentInTenant(departmentId: string, tenantId: string) {
  const [d] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)))
    .limit(1);
  if (!d) throw new Error("القسم غير موجود");
}

// =============================================
// Role matrix helpers
// =============================================

export const ROLE = {
  OWNER_ADMIN: ["OWNER", "ADMIN"] as const,
  OWNER_ADMIN_COORDINATOR: ["OWNER", "ADMIN", "COORDINATOR"] as const,
  ALL_AUTHED: ["OWNER", "ADMIN", "COORDINATOR", "PROVIDER"] as const,
};

export function assertRole(role: string, allowed: readonly string[]) {
  if (!allowed.includes(role)) {
    throw new Error("ليس لديك صلاحية لهذا الإجراء");
  }
}
