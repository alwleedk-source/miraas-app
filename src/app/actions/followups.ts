"use server";

import { db } from "@/db";
import { followUps, activityLog, leads } from "@/db/schema";
import { eq, ne, and, lte, isNull, isNotNull, sql, count, desc } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { assertLeadInTenant, assertRole, ROLE } from "@/lib/tenant-guards";
import {
  quickScheduleFollowUpSchema,
  updateFollowUpScheduleSchema,
} from "@/lib/schemas";

const getContext = requireTenant;

// ownership helper: COORDINATOR/PROVIDER يتحكمون بـ follow-ups الخاصة بهم فقط
async function fetchFollowUpOrThrow(
  followUpId: string,
  tenantId: string,
  userId: string,
  role: string,
) {
  const [fu] = await db
    .select({
      id: followUps.id,
      leadId: followUps.leadId,
      ownerId: followUps.userId,
      notes: followUps.notes,
      type: followUps.type,
      scheduledAt: followUps.scheduledAt,
    })
    .from(followUps)
    .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)))
    .limit(1);
  if (!fu) throw new Error("التذكير غير موجود");
  if (role === "COORDINATOR" && fu.ownerId !== userId) {
    throw new Error("ليس لديك صلاحية على هذا التذكير");
  }
  return fu;
}

// تعليم متابعة كمكتملة
export async function completeFollowUp(followUpId: string) {
  const { userId, tenantId, role } = await getContext();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  const existing = await fetchFollowUpOrThrow(followUpId, tenantId, userId, role);

  await db.transaction(async (tx) => {
    await tx
      .update(followUps)
      .set({ completedAt: new Date() })
      .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

    await tx.insert(activityLog).values({
      tenantId,
      userId,
      action: "FOLLOW_UP_CREATED",
      entityType: "follow_up",
      entityId: followUpId,
      details: { action: "completed", leadId: existing.leadId, type: existing.type },
    });
  });

  revalidatePath("/");
}

// تأجيل متابعة (تغيير scheduledAt)
export async function snoozeFollowUp(followUpId: string, days: number) {
  const { tenantId, userId, role } = await getContext();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("عدد الأيام غير صالح");
  }
  const existing = await fetchFollowUpOrThrow(followUpId, tenantId, userId, role);
  if (!existing.scheduledAt) return;

  const newDate = new Date(existing.scheduledAt);
  newDate.setDate(newDate.getDate() + days);

  await db
    .update(followUps)
    .set({ scheduledAt: newDate })
    .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

  revalidatePath("/");
}

// تعديل تذكير موجود (يقبل ISO + نوع + ملاحظة اختيارية)
export async function updateFollowUpSchedule(
  followUpId: string,
  scheduledAtISO: string,
  input: { notes?: string; type?: "CALL" | "WHATSAPP" | "MESSAGE" } = {},
) {
  const { tenantId, userId, role } = await getContext();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

  const parsed = updateFollowUpScheduleSchema.parse({
    followUpId,
    scheduledAtISO,
    notes: input.notes,
    type: input.type,
  });

  const target = await fetchFollowUpOrThrow(followUpId, tenantId, userId, role);
  const newDate = new Date(parsed.scheduledAtISO);

  await db.transaction(async (tx) => {
    // إلغاء أي تذكير آخر معلّق لنفس العميل (خاصّ بنفس user فقط — لا تلمس عمل الآخرين)
    const otherConditions = [
      eq(followUps.tenantId, tenantId),
      eq(followUps.leadId, target.leadId),
      isNull(followUps.completedAt),
      isNotNull(followUps.scheduledAt),
      ne(followUps.id, followUpId),
    ];
    if (role === "COORDINATOR") {
      otherConditions.push(eq(followUps.userId, userId));
    }
    await tx
      .update(followUps)
      .set({ completedAt: new Date() })
      .where(and(...otherConditions));

    const patch: Partial<typeof followUps.$inferInsert> = {
      scheduledAt: newDate,
      completedAt: null,
    };
    if (parsed.type) patch.type = parsed.type;
    if (parsed.notes !== undefined) patch.notes = parsed.notes;

    await tx
      .update(followUps)
      .set(patch)
      .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));
  });

  revalidatePath("/");
  revalidatePath("/leads");
  return { scheduledAt: newDate };
}

// إلغاء تذكير + أي تذكيرات معلّقة أخرى للعميل (من نفس user فقط)
export async function cancelFollowUp(followUpId: string) {
  const { tenantId, userId, role } = await getContext();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  const existing = await fetchFollowUpOrThrow(followUpId, tenantId, userId, role);

  await db.transaction(async (tx) => {
    const pendingConditions = [
      eq(followUps.tenantId, tenantId),
      eq(followUps.leadId, existing.leadId),
      isNull(followUps.completedAt),
      isNotNull(followUps.scheduledAt),
    ];
    // COORDINATOR يُلغي فقط خاصّه — لا يمسح عمل زميل
    if (role === "COORDINATOR") {
      pendingConditions.push(eq(followUps.userId, userId));
    }
    await tx
      .update(followUps)
      .set({ completedAt: new Date() })
      .where(and(...pendingConditions));

    await tx
      .update(followUps)
      .set({ notes: `(ملغى) ${existing.notes ?? ""}`.trim() })
      .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

    await tx.insert(activityLog).values({
      tenantId,
      userId,
      action: "FOLLOW_UP_CREATED",
      entityType: "follow_up",
      entityId: followUpId,
      details: { action: "cancelled", leadId: existing.leadId },
    });
  });

  revalidatePath("/");
  revalidatePath("/leads");
}

// تأجيل بالدقائق — من داخل إشعار الاستحقاق
export async function snoozeFollowUpMinutes(followUpId: string, minutes: number) {
  const { tenantId, userId, role } = await getContext();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error("عدد الدقائق غير صالح (1-1440)");
  }
  await fetchFollowUpOrThrow(followUpId, tenantId, userId, role);

  const newDate = new Date();
  newDate.setMinutes(newDate.getMinutes() + minutes);

  await db
    .update(followUps)
    .set({ scheduledAt: newDate })
    .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

  revalidatePath("/");
  revalidatePath("/leads");
  return { scheduledAt: newDate };
}

// =============================================
// المتابعات التي حان موعدها للتو (للـ in-app toasts)
// =============================================

export async function getJustDueFollowUps(sinceISO: string) {
  const { tenantId, userId } = await getContext();
  const since = new Date(sinceISO);
  const now = new Date();
  if (isNaN(since.getTime())) return [];

  const userRole = await getUserRole(tenantId, userId);
  const conditions = [
    eq(followUps.tenantId, tenantId),
    isNull(followUps.completedAt),
    isNotNull(followUps.scheduledAt),
    sql`${followUps.scheduledAt} > ${since.toISOString()}`,
    sql`${followUps.scheduledAt} <= ${now.toISOString()}`,
    eq(leads.isDeleted, false),
  ];
  if (userRole === "COORDINATOR") {
    conditions.push(eq(followUps.userId, userId));
  }

  const rows = await db
    .select({
      id: followUps.id,
      leadId: followUps.leadId,
      leadName: leads.name,
      leadPhone: leads.phone,
      type: followUps.type,
      notes: followUps.notes,
      scheduledAt: followUps.scheduledAt,
    })
    .from(followUps)
    .innerJoin(leads, eq(followUps.leadId, leads.id))
    .where(and(...conditions))
    .orderBy(followUps.scheduledAt)
    .limit(20);

  return rows;
}

// =============================================
// متابعة سريعة بنقرة واحدة
// =============================================

export async function quickScheduleFollowUp(raw: unknown) {
  const { tenantId, userId, role } = await getContext();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  const input = quickScheduleFollowUpSchema.parse(raw);
  await assertLeadInTenant(input.leadId, tenantId);

  const scheduledAt = new Date(input.scheduledAt);
  const diffMs = scheduledAt.getTime() - Date.now();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const defaultNotes =
    diffMs < 0
      ? "متابعة مجدولة"
      : diffHours <= 12
      ? `تذكير — التواصل بعد ${Math.max(1, diffHours)} ساعة`
      : diffDays <= 1
      ? "تذكير — العميل طلب التواصل غداً"
      : `تذكير — متابعة بعد ${diffDays} أيام`;

  return await db.transaction(async (tx) => {
    // إلغاء أي موعد معلّق سابق — خاصّ بنفس user لـ COORDINATOR
    const cancelConditions = [
      eq(followUps.tenantId, tenantId),
      eq(followUps.leadId, input.leadId),
      isNull(followUps.completedAt),
      isNotNull(followUps.scheduledAt),
    ];
    if (role === "COORDINATOR") {
      cancelConditions.push(eq(followUps.userId, userId));
    }
    await tx
      .update(followUps)
      .set({ completedAt: new Date() })
      .where(and(...cancelConditions));

    const [followUp] = await tx
      .insert(followUps)
      .values({
        tenantId,
        leadId: input.leadId,
        userId,
        type: input.type || "CALL",
        notes: input.notes || defaultNotes,
        scheduledAt,
      })
      .returning({ id: followUps.id });

    await tx.insert(activityLog).values({
      tenantId,
      userId,
      action: "FOLLOW_UP_CREATED",
      entityType: "follow_up",
      entityId: followUp.id,
      details: {
        leadId: input.leadId,
        type: input.type || "CALL",
        quick: true,
        scheduledFor: scheduledAt.toISOString(),
      },
    });

    revalidatePath("/");
    revalidatePath("/leads");
    return { success: true, scheduledAt, followUpId: followUp.id };
  });
}

// =============================================
// "لم يرد" + إعادة محاولة تلقائية
// =============================================

export async function quickNoResponse(leadId: string, retryAfterDays: number = 1) {
  const { tenantId, userId, role } = await getContext();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  if (!Number.isInteger(retryAfterDays) || retryAfterDays < 1 || retryAfterDays > 30) {
    throw new Error("عدد أيام الإعادة غير صالح");
  }
  await assertLeadInTenant(leadId, tenantId);

  const retryDate = new Date();
  retryDate.setDate(retryDate.getDate() + retryAfterDays);
  retryDate.setHours(10, 0, 0, 0);

  // idempotency: لو مرّت أقل من 30 ثانية على آخر "لم يرد"، تجاهل (الضغط المكرر)
  const thirtySecondsAgo = new Date(Date.now() - 30_000);
  const [recent] = await db
    .select({ id: followUps.id })
    .from(followUps)
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        eq(followUps.leadId, leadId),
        eq(followUps.userId, userId),
        eq(followUps.type, "CALL"),
        sql`${followUps.notes} LIKE '%لم يرد%'`,
        sql`${followUps.completedAt} >= ${thirtySecondsAgo.toISOString()}`,
      ),
    )
    .limit(1);
  if (recent) {
    return { success: true, retryDate, alreadyMarked: true };
  }

  return await db.transaction(async (tx) => {
    // 1. سجّل المحاولة الحالية كمكتملة
    await tx.insert(followUps).values({
      tenantId,
      leadId,
      userId,
      type: "CALL",
      notes: "📵 لم يرد",
      completedAt: new Date(),
    });

    // 2. إلغاء أي موعد معلّق — خاصّ نفس user لـ COORDINATOR
    const cancelConditions = [
      eq(followUps.tenantId, tenantId),
      eq(followUps.leadId, leadId),
      isNull(followUps.completedAt),
      isNotNull(followUps.scheduledAt),
    ];
    if (role === "COORDINATOR") {
      cancelConditions.push(eq(followUps.userId, userId));
    }
    await tx
      .update(followUps)
      .set({ completedAt: new Date() })
      .where(and(...cancelConditions));

    // 3. أنشئ متابعة مجدولة جديدة للإعادة
    const [retry] = await tx
      .insert(followUps)
      .values({
        tenantId,
        leadId,
        userId,
        type: "CALL",
        notes: `📞 إعادة محاولة — لم يرد المرة السابقة`,
        scheduledAt: retryDate,
      })
      .returning({ id: followUps.id });

    await tx.insert(activityLog).values({
      tenantId,
      userId,
      action: "FOLLOW_UP_CREATED",
      entityType: "follow_up",
      entityId: retry.id,
      details: {
        leadId,
        action: "no_response_auto_retry",
        retryDate: retryDate.toISOString(),
      },
    });

    revalidatePath("/");
    revalidatePath("/leads");
    return { success: true, retryDate };
  });
}

// =============================================
// جلب عدد المتابعات المتأخرة (للإشعارات)
// =============================================

export async function getOverdueFollowUpsCount() {
  const { tenantId, userId } = await getContext();
  const userRole = await getUserRole(tenantId, userId);

  const now = new Date();
  const conditions = [
    eq(followUps.tenantId, tenantId),
    lte(followUps.scheduledAt, now),
    isNull(followUps.completedAt),
    isNotNull(followUps.scheduledAt),
  ];

  // المنسق يرى مهامه فقط
  if (userRole === "COORDINATOR") {
    conditions.push(eq(followUps.userId, userId));
  }

  const [result] = await db
    .select({ total: count() })
    .from(followUps)
    .innerJoin(leads, eq(followUps.leadId, leads.id))
    .where(and(...conditions, eq(leads.isDeleted, false)));

  return result?.total || 0;
}

// =============================================
// جلب عدد محاولات التواصل السابقة مع عميل
// محاولة = CALL أو WHATSAPP مكتمل وغير مُلغى (يمثّل اتصالاً فعلياً)
// =============================================

export async function getLeadFollowUpCount(leadId: string) {
  const { tenantId, role } = await getContext();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  await assertLeadInTenant(leadId, tenantId);

  const [result] = await db
    .select({ total: count() })
    .from(followUps)
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        eq(followUps.leadId, leadId),
        // محاولة فعلية فقط (لا ملاحظات ولا مُلغاة)
        sql`${followUps.type} IN ('CALL', 'WHATSAPP', 'MESSAGE')`,
        isNotNull(followUps.completedAt),
        sql`${followUps.notes} NOT LIKE '(ملغى)%' OR ${followUps.notes} IS NULL`,
      ),
    );

  return result?.total || 0;
}

// =============================================
// جلب آخر الملاحظات لعميل (رحلة الإقناع)
// =============================================

export async function getLeadRecentNotes(leadId: string) {
  const { tenantId, role } = await getContext();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  await assertLeadInTenant(leadId, tenantId);

  const notes = await db
    .select({
      id: followUps.id,
      type: followUps.type,
      notes: followUps.notes,
      createdAt: followUps.createdAt,
      scheduledAt: followUps.scheduledAt,
    })
    .from(followUps)
    .where(and(eq(followUps.tenantId, tenantId), eq(followUps.leadId, leadId)))
    .orderBy(desc(followUps.createdAt))
    .limit(5);

  return notes;
}

// =============================================
// جلب المتابعات المجدولة المعلّقة لعميل
// =============================================

export async function getLeadPendingFollowUp(leadId: string) {
  const { tenantId, role } = await getContext();
  assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
  await assertLeadInTenant(leadId, tenantId);

  const [pending] = await db
    .select({
      id: followUps.id,
      scheduledAt: followUps.scheduledAt,
      notes: followUps.notes,
      type: followUps.type,
    })
    .from(followUps)
    .where(
      and(
        eq(followUps.tenantId, tenantId),
        eq(followUps.leadId, leadId),
        isNull(followUps.completedAt),
        isNotNull(followUps.scheduledAt)
      )
    )
    .orderBy(followUps.scheduledAt)
    .limit(1);

  return pending || null;
}

// Helper: جلب دور المستخدم
async function getUserRole(tenantId: string, userId: string): Promise<string> {
  const { users } = await import("@/db/schema");
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
    .limit(1);
  return user?.role || "COORDINATOR";
}

