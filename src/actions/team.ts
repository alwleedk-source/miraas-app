"use server";

import { db } from "@/db";
import { users, activityLog } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * جلب أعضاء الفريق
 */
export async function getTeamMembers(tenantId: string) {
  const members = await db.query.users.findMany({
    where: eq(users.tenantId, tenantId),
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      image: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: [desc(users.createdAt)],
  });

  return members;
}

/**
 * إضافة عضو جديد للفريق (دعوة)
 */
export async function inviteTeamMember(input: {
  tenantId: string;
  name: string;
  email: string;
  role: "ADMIN" | "COORDINATOR";
  invitedBy: string;
}) {
  // التحقق من عدم وجود البريد مسبقاً
  const existing = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });

  if (existing) {
    throw new Error("هذا البريد الإلكتروني مسجل مسبقاً");
  }

  const [member] = await db
    .insert(users)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      email: input.email,
      role: input.role,
      isActive: true,
      emailVerified: false,
    })
    .returning();

  // تسجيل النشاط
  await db.insert(activityLog).values({
    tenantId: input.tenantId,
    userId: input.invitedBy,
    action: "USER_CREATED",
    entityType: "user",
    entityId: member.id,
    details: { memberName: input.name, role: input.role },
  });

  revalidatePath("/team");
  return member;
}

/**
 * تحديث بيانات عضو الفريق
 */
export async function updateTeamMember(
  memberId: string,
  tenantId: string,
  data: {
    name?: string;
    role?: "ADMIN" | "COORDINATOR";
    isActive?: boolean;
  },
  updatedBy?: string
) {
  const [updated] = await db
    .update(users)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, memberId), eq(users.tenantId, tenantId)))
    .returning();

  if (updatedBy) {
    await db.insert(activityLog).values({
      tenantId,
      userId: updatedBy,
      action: "USER_UPDATED",
      entityType: "user",
      entityId: memberId,
      details: data as Record<string, unknown>,
    });
  }

  revalidatePath("/team");
  return updated;
}

/**
 * تعطيل/تفعيل عضو
 */
export async function toggleMemberStatus(
  memberId: string,
  tenantId: string,
  updatedBy: string
) {
  const member = await db.query.users.findFirst({
    where: and(eq(users.id, memberId), eq(users.tenantId, tenantId)),
  });

  if (!member) throw new Error("العضو غير موجود");

  return updateTeamMember(
    memberId,
    tenantId,
    { isActive: !member.isActive },
    updatedBy
  );
}
