import { db } from "@/db";
import { leads, users, pipelineStages, leadSources, departments, webhookCoordinators } from "@/db/schema";
import { eq, and, or, inArray, sql, type SQL } from "drizzle-orm";

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

/**
 * تحقق أن user فعّال وبدور PROVIDER — bookingResourceId يجب أن يكون مقدم خدمة.
 * (assertUserInTenant يقبل أي دور، فيمكن إسناد موعد لمنسق كـ "مورد" حجز.)
 */
export async function assertProviderResourceInTenant(userId: string, tenantId: string) {
  const [u] = await db
    .select({ id: users.id, isActive: users.isActive, role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
    .limit(1);
  if (!u) throw new Error("المستخدم غير موجود في الشركة");
  if (!u.isActive) throw new Error("المستخدم معطَّل");
  if (u.role !== "PROVIDER") throw new Error("المُحدَّد كمورد للحجز ليس مقدم خدمة");
}

// =============================================
// Coordinator visibility (نطاق عمل المنسق)
// =============================================

/**
 * شرط رؤية المنسق للعملاء — مطابق تماماً لمنطق getLeads:
 *   - لا تخصيص حملات له: عملاء مُسنَدون له + عملاء المراحل غير الحصرية
 *   - مع تخصيص حملات (webhookCoordinators): المُسنَدون له + عملاء حملاته فقط
 * يُستخدم كـ WHERE condition في استعلامات القوائم (getLeads, searchLeadByPhone).
 */
export async function coordinatorLeadVisibilityCondition(
  tenantId: string,
  userId: string,
): Promise<SQL | undefined> {
  const assignedWebhooks = await db
    .select({ webhookId: webhookCoordinators.webhookId })
    .from(webhookCoordinators)
    .where(eq(webhookCoordinators.userId, userId));
  const webhookIds = assignedWebhooks.map((r) => r.webhookId);

  if (webhookIds.length === 0) {
    // لا تخصيص → السلوك القديم: assigned-to-me + non-exclusive stages
    return or(
      eq(leads.assignedTo, userId),
      sql`${leads.stageId} NOT IN (
        SELECT id FROM pipeline_stages
        WHERE tenant_id = ${tenantId} AND is_exclusive = true
      )`,
    );
  }
  // مع تخصيص → assigned-to-me OR من حملاته فقط
  return or(
    eq(leads.assignedTo, userId),
    inArray(leads.webhookEndpointId, webhookIds),
  );
}

/**
 * يمنع المنسق من الوصول لعميل خارج نطاقه (عرض/تحديث/نقل/متابعة/أرشفة).
 * يعيد استخدام منطق getLeads نفسه عبر coordinatorLeadVisibilityCondition.
 * لا-op لغير COORDINATOR.
 */
export async function assertCoordinatorCanAccessLead(
  leadId: string,
  tenantId: string,
  userId: string,
  role: string,
) {
  if (role !== "COORDINATOR") return;
  const visibility = await coordinatorLeadVisibilityCondition(tenantId, userId);
  const [row] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId), visibility))
    .limit(1);
  if (!row) throw new Error("هذا العميل ليس ضمن نطاق عملك");
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
