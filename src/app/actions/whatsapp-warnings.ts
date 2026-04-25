"use server";

import { db } from "@/db";
import { leads, users, userWhatsappCredentials, webhookCoordinators } from "@/db/schema";
import { and, eq, isNotNull, isNull, count } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { assertRole, ROLE } from "@/lib/tenant-guards";

/**
 * تنبيهات WhatsApp للمالك — منسقون ربطوا بحملات لكن لم يربطوا أرقام Meta.
 * عملاؤهم لن يستلموا ترحيباً (السلوك بعد قرار "لا fallback").
 *
 * يُستخدَم في dashboard لإظهار banner تحذيري للمالك.
 */
export async function getCoordinatorsMissingWhatsapp() {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  // المنسقون المربوطون بحملات + بدون creds نشطة
  const rows = await db
    .select({
      userId: users.id,
      userName: users.name,
      assignedWebhooks: count(webhookCoordinators.webhookId),
    })
    .from(users)
    .innerJoin(webhookCoordinators, eq(webhookCoordinators.userId, users.id))
    .leftJoin(
      userWhatsappCredentials,
      and(
        eq(userWhatsappCredentials.userId, users.id),
        eq(userWhatsappCredentials.isActive, true),
      ),
    )
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.isActive, true),
        isNull(userWhatsappCredentials.id), // لا creds نشطة
      ),
    )
    .groupBy(users.id, users.name);

  return rows;
}

/**
 * تنبيه للمنسق نفسه — هل عندي حملات بدون رقم؟
 * يُظهر في dashboard المنسق.
 */
export async function getMyWhatsappStatus() {
  const { tenantId, userId, role } = await requireTenant();
  if (role === "PROVIDER") return null;

  // كم حملة مرتبط بها هذا المنسق؟
  const [{ webhookCount }] = await db
    .select({ webhookCount: count() })
    .from(webhookCoordinators)
    .where(eq(webhookCoordinators.userId, userId));

  // هل عنده creds نشطة؟
  const [creds] = await db
    .select({ isActive: userWhatsappCredentials.isActive })
    .from(userWhatsappCredentials)
    .where(
      and(
        eq(userWhatsappCredentials.userId, userId),
        eq(userWhatsappCredentials.tenantId, tenantId),
      ),
    )
    .limit(1);

  // كم lead مُسنَد له بدون ترحيب (بسبب نقص creds)
  const [{ pendingCount }] = await db
    .select({ pendingCount: count() })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.assignedTo, userId),
        eq(leads.isDeleted, false),
        isNotNull(leads.phone),
        isNull(leads.welcomeSentAt),
      ),
    );

  return {
    webhookCount: Number(webhookCount),
    hasActiveCreds: !!creds?.isActive,
    pendingWelcomesCount: Number(pendingCount),
    needsAction: Number(webhookCount) > 0 && !creds?.isActive,
  };
}

/**
 * تنبيه عام للمالك — leads انتظرت ترحيباً بسبب coordinator_no_creds
 * (يحدث عندما lead.assignedTo موجود لكن المنسق لم يربط رقمه).
 */
export async function getStuckLeadsCount() {
  const { tenantId, role } = await requireTenant();
  assertRole(role, ROLE.OWNER_ADMIN);

  // leads مُسنَدة لمنسق + بدون welcomeSentAt + المنسق ليس له creds
  const stuck = await db
    .select({
      leadId: leads.id,
      coordinatorId: leads.assignedTo,
      coordinatorName: users.name,
    })
    .from(leads)
    .innerJoin(users, eq(users.id, leads.assignedTo))
    .leftJoin(
      userWhatsappCredentials,
      and(
        eq(userWhatsappCredentials.userId, users.id),
        eq(userWhatsappCredentials.isActive, true),
      ),
    )
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.isDeleted, false),
        isNotNull(leads.assignedTo),
        isNull(leads.welcomeSentAt),
        isNotNull(leads.phone),
        isNull(userWhatsappCredentials.id),
      ),
    );

  // group by coordinator
  const byCoordinator = stuck.reduce((acc, s) => {
    if (!s.coordinatorId) return acc;
    const existing = acc.get(s.coordinatorId);
    if (existing) {
      existing.count++;
    } else {
      acc.set(s.coordinatorId, {
        coordinatorId: s.coordinatorId,
        coordinatorName: s.coordinatorName ?? "غير معروف",
        count: 1,
      });
    }
    return acc;
  }, new Map<string, { coordinatorId: string; coordinatorName: string; count: number }>());

  return {
    totalStuck: stuck.length,
    byCoordinator: Array.from(byCoordinator.values()),
  };
}

