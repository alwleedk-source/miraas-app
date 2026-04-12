"use server";

import { db } from "@/db";
import { users, activityLog, leads } from "@/db/schema";
import { eq, and, count, desc } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

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
  const { tenantId } = await requireTenant();

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

  // عدد العملاء لكل عضو
  const membersWithStats = await Promise.all(
    members.map(async (member) => {
      const [{ leadsCount }] = await db
        .select({ leadsCount: count() })
        .from(leads)
        .where(and(eq(leads.assignedTo, member.id), eq(leads.isDeleted, false)));
      return { ...member, leadsCount };
    })
  );

  return membersWithStats;
}

// =============================================
// إضافة عضو جديد للفريق (دعوة)
// =============================================

export async function inviteTeamMember(input: {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "COORDINATOR";
}) {
  const { tenantId, userId } = await requireOwnerOrAdmin();

  // إنشاء المستخدم عبر Better Auth
  const newUser = await auth.api.signUpEmail({
    body: {
      email: input.email,
      password: input.password,
      name: input.name,
    },
    headers: await headers(),
  });

  if (!newUser?.user?.id) {
    throw new Error("حدث خطأ في إنشاء الحساب");
  }

  // ربط المستخدم بالشركة
  await db
    .update(users)
    .set({ tenantId, role: input.role })
    .where(eq(users.id, newUser.user.id));

  // تسجيل النشاط
  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "USER_CREATED",
    entityType: "user",
    entityId: newUser.user.id,
    details: { name: input.name, email: input.email, role: input.role },
  });

  revalidatePath("/team");
  return { id: newUser.user.id, name: input.name, email: input.email };
}

// =============================================
// تعطيل/تفعيل عضو
// =============================================

export async function toggleTeamMember(memberId: string) {
  const { tenantId, userId } = await requireOwnerOrAdmin();

  // لا يمكن تعطيل نفسك
  if (memberId === userId) throw new Error("لا يمكنك تعطيل حسابك الخاص");

  const [member] = await db
    .select({ isActive: users.isActive, role: users.role })
    .from(users)
    .where(and(eq(users.id, memberId), eq(users.tenantId, tenantId)));

  if (!member) throw new Error("العضو غير موجود");

  // لا يمكن تعطيل المالك
  if (member.role === "OWNER") throw new Error("لا يمكن تعطيل حساب المالك");

  await db
    .update(users)
    .set({ isActive: !member.isActive, updatedAt: new Date() })
    .where(and(eq(users.id, memberId), eq(users.tenantId, tenantId)));

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "USER_UPDATED",
    entityType: "user",
    entityId: memberId,
    details: { isActive: !member.isActive },
  });

  revalidatePath("/team");
}

// =============================================
// تغيير صلاحية عضو
// =============================================

export async function updateMemberRole(
  memberId: string,
  newRole: "ADMIN" | "COORDINATOR"
) {
  const { tenantId, userId } = await requireOwnerOrAdmin();

  // لا يمكن تغيير صلاحية نفسك أو المالك
  if (memberId === userId) throw new Error("لا يمكنك تغيير صلاحيتك الخاصة");

  const [member] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, memberId), eq(users.tenantId, tenantId)));

  if (!member) throw new Error("العضو غير موجود");
  if (member.role === "OWNER") throw new Error("لا يمكن تغيير صلاحية المالك");

  await db
    .update(users)
    .set({ role: newRole, updatedAt: new Date() })
    .where(and(eq(users.id, memberId), eq(users.tenantId, tenantId)));

  await db.insert(activityLog).values({
    tenantId,
    userId,
    action: "USER_UPDATED",
    entityType: "user",
    entityId: memberId,
    details: { newRole },
  });

  revalidatePath("/team");
}
