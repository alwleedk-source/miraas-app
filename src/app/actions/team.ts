"use server";

import { db } from "@/db";
import { users, activityLog, leads, sessions, webhookCoordinators } from "@/db/schema";
import { eq, and, count, desc, isNull } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { inviteTeamMemberSchema, updateMemberRoleSchema } from "@/lib/schemas";

// =============================================
// Helper
// =============================================

async function requireOwnerOrAdmin() {
  const { tenantId, userId, role, session } = await requireTenant();

  if (!["OWNER", "ADMIN", "SUPER_ADMIN"].includes(role)) {
    throw new Error("ليس لديك صلاحية لهذا الإجراء");
  }

  return { tenantId, userId, role, session };
}

// =============================================
// جلب أعضاء الفريق
// =============================================

export async function getTeamMembers() {
  const { tenantId, role } = await requireTenant();
  if (!["OWNER", "ADMIN", "SUPER_ADMIN"].includes(role)) {
    throw new Error("ليس لديك صلاحية لعرض الفريق");
  }

  const members = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      image: users.image,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.tenantId, tenantId))
    .orderBy(desc(users.createdAt));

  // عدد العملاء لكل عضو — استعلام مُجمَّع واحد بدل N استعلام (كان N+1 على صفحة /team)
  const counts = await db
    .select({ assignedTo: leads.assignedTo, leadsCount: count() })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.isDeleted, false)))
    .groupBy(leads.assignedTo);
  const countMap = new Map(counts.map((c) => [c.assignedTo, c.leadsCount]));

  return members.map((member) => ({
    ...member,
    leadsCount: countMap.get(member.id) ?? 0,
  }));
}

// =============================================
// إضافة عضو جديد للفريق (دعوة)
// =============================================

export async function inviteTeamMember(raw: unknown) {
  const { tenantId, userId } = await requireOwnerOrAdmin();
  const parsedInput = inviteTeamMemberSchema.safeParse(raw);
  if (!parsedInput.success) {
    return { success: false as const, error: "بيانات غير صالحة — تحقق من المدخلات" };
  }
  const input = parsedInput.data;
  // ⚠️ mismatch معروف: الـ UI (team-actions.tsx) يفرض minLength=8 بينما السيرفر
  // يشترط 10 (inviteTeamMemberSchema في schemas.ts + minPasswordLength في auth.ts).
  // لا نغيّر الـ schema هنا — يُصحَّح الـ UI في مرحلة الواجهة (phase B).

  // إنشاء المستخدم عبر Better Auth (role/tenantId الآن input:false في auth config)
  const newUser = await auth.api.signUpEmail({
    body: {
      email: input.email,
      password: input.password,
      name: input.name,
    },
    headers: await headers(),
  });

  if (!newUser?.user?.id) {
    return { success: false as const, error: "حدث خطأ في إنشاء الحساب" };
  }

  // ربط المستخدم بالشركة + تعيين الدور في transaction.
  // 🔒 الشرط `tenantId IS NULL` يمنع الاستيلاء على حساب موجود في شركة أخرى:
  // نربط فقط الحسابات الجديدة (غير المنتمية لأي شركة بعد).
  const linkResult = await db.transaction(async (tx) => {
    const linked = await tx
      .update(users)
      .set({ tenantId, role: input.role })
      .where(and(eq(users.id, newUser.user.id), isNull(users.tenantId)))
      .returning({ id: users.id });

    if (linked.length === 0) {
      // لا كتابات حدثت داخل المعاملة — إرجاع فشل (commit هنا no-op)
      return { success: false as const, error: "هذا البريد مستخدم بالفعل في حساب آخر" };
    }

    await tx.insert(activityLog).values({
      tenantId,
      userId,
      action: "USER_CREATED",
      entityType: "user",
      entityId: newUser.user.id,
      details: { name: input.name, email: input.email, role: input.role },
    });
    return { success: true as const };
  });
  if (!linkResult.success) return linkResult;

  revalidatePath("/team");
  return { success: true as const, id: newUser.user.id, name: input.name, email: input.email };
}

// =============================================
// تعطيل/تفعيل عضو
// =============================================

export async function toggleTeamMember(memberId: string) {
  const { tenantId, userId } = await requireOwnerOrAdmin();

  // لا يمكن تعطيل نفسك
  if (memberId === userId) return { success: false as const, error: "لا يمكنك تعطيل حسابك الخاص" };

  const [member] = await db
    .select({ isActive: users.isActive, role: users.role })
    .from(users)
    .where(and(eq(users.id, memberId), eq(users.tenantId, tenantId)));

  if (!member) return { success: false as const, error: "العضو غير موجود" };

  // لا يمكن تعطيل المالك
  if (member.role === "OWNER") return { success: false as const, error: "لا يمكن تعطيل حساب المالك" };

  // TODO(مرحلة لاحقة): تعطيل منسق لديه leads نشطة يتركها "يتيمة" — assignedTo
  // يظل يشير لمنسق معطَّل فلا يتابعها أحد عملياً (round-robin للـ webhooks محمي
  // هنا بالحذف من webhook_coordinators، لكن الـ leads القائمة لا تُعاد إسنادها).
  // الأفضل: تحذير المالك بعدد الـ leads النشطة + عرض إعادة إسنادها قبل التعطيل.
  // لا تغيير سلوك الآن حتى يُصمَّم ذلك.
  const newIsActive = !member.isActive;
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isActive: newIsActive, updatedAt: new Date() })
      .where(and(eq(users.id, memberId), eq(users.tenantId, tenantId)));

    // عند التعطيل: أبطل كل الجلسات النشطة + أزله من توزيع الـ webhooks
    // (وإلا يستمرّ round-robin في إسناد leads جديدة لمنسق لا يستطيع الدخول).
    if (!newIsActive) {
      await tx.delete(sessions).where(eq(sessions.userId, memberId));
      await tx.delete(webhookCoordinators).where(eq(webhookCoordinators.userId, memberId));
    }

    await tx.insert(activityLog).values({
      tenantId,
      userId,
      action: "USER_UPDATED",
      entityType: "user",
      entityId: memberId,
      details: { isActive: newIsActive },
    });
  });

  revalidatePath("/team");
  return { success: true as const };
}

// =============================================
// تغيير صلاحية عضو
// =============================================

export async function updateMemberRole(memberId: string, newRole: string) {
  const { tenantId, userId } = await requireOwnerOrAdmin();
  const parsedInput = updateMemberRoleSchema.safeParse({ memberId, newRole });
  if (!parsedInput.success) {
    return { success: false as const, error: "بيانات غير صالحة — تحقق من المدخلات" };
  }
  const input = parsedInput.data;

  if (input.memberId === userId) return { success: false as const, error: "لا يمكنك تغيير صلاحيتك الخاصة" };

  const [member] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, input.memberId), eq(users.tenantId, tenantId)));

  if (!member) return { success: false as const, error: "العضو غير موجود" };
  if (member.role === "OWNER") return { success: false as const, error: "لا يمكن تغيير صلاحية المالك" };

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ role: input.newRole, updatedAt: new Date() })
      .where(and(eq(users.id, input.memberId), eq(users.tenantId, tenantId)));

    // أبطل الجلسات ليسري الدور الجديد فوراً (يتجاوز cookieCache)
    await tx.delete(sessions).where(eq(sessions.userId, input.memberId));

    // إن تحوّل لمقدّم خدمة فلم يعد يستقبل leads — أزله من توزيع الـ webhooks
    if (input.newRole === "PROVIDER") {
      await tx.delete(webhookCoordinators).where(eq(webhookCoordinators.userId, input.memberId));
    }

    await tx.insert(activityLog).values({
      tenantId,
      userId,
      action: "USER_UPDATED",
      entityType: "user",
      entityId: input.memberId,
      details: { newRole: input.newRole },
    });
  });

  revalidatePath("/team");
  return { success: true as const };
}
