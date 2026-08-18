"use server";

import { db } from "@/db";
import { followUps, activityLog, leads } from "@/db/schema";
import { eq, ne, and, lte, isNull, isNotNull, sql, count, desc } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/utils";
import {
  assertLeadInTenant,
  assertCoordinatorCanAccessLead,
  assertRole,
  ROLE,
} from "@/lib/tenant-guards";
import {
  quickScheduleFollowUpSchema,
  updateFollowUpScheduleSchema,
} from "@/lib/schemas";

const getContext = requireTenant;

type Fail = { success: false; error: string };

/**
 * عقد الأخطاء الموحّد: Next.js في production يُخفي رسائل الأخطاء المرمية من
 * server actions فيرى المستخدم نصاً إنجليزياً عاماً. لذا كل خطأ متوقَّع
 * (تحقق/صلاحية/غير موجود) يُعاد كـ { success: false, error: "عربي" }.
 * غير المتوقَّع فقط (أعطال DB ونحوها) يبقى مرمياً.
 */
function expectedError(err: unknown): string | null {
  if (err instanceof z.ZodError) {
    const msg = err.issues[0]?.message;
    // رسائل zod المدمجة إنجليزية — لا تُعرض كما هي
    return msg && /[؀-ۿ]/.test(msg) ? msg : "بيانات غير صالحة — تحقق من المدخلات";
  }
  if (err instanceof Error) {
    // رسائل الحراسات والتحقق الداخلية عربية مقصودة للمستخدم
    if (/[؀-ۿ]/.test(err.message)) return err.message;
  }
  return null;
}

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
  try {
    const { userId, tenantId, role } = await getContext();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(followUpId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    const existing = await fetchFollowUpOrThrow(followUpId, tenantId, userId, role);

    await db.transaction(async (tx) => {
      await tx
        .update(followUps)
        .set({ completedAt: new Date() })
        .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "FOLLOW_UP_COMPLETED",
        entityType: "follow_up",
        entityId: followUpId,
        details: { leadId: existing.leadId, type: existing.type },
      });
    });

    revalidatePath("/");
    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// تأجيل متابعة (تغيير scheduledAt)
export async function snoozeFollowUp(followUpId: string, days: number) {
  try {
    const { tenantId, userId, role } = await getContext();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(followUpId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return { success: false as const, error: "عدد الأيام غير صالح" } satisfies Fail;
    }
    const existing = await fetchFollowUpOrThrow(followUpId, tenantId, userId, role);
    if (!existing.scheduledAt) return { success: true as const };

    const newDate = new Date(existing.scheduledAt);
    newDate.setDate(newDate.getDate() + days);

    await db
      .update(followUps)
      .set({ scheduledAt: newDate })
      .where(and(eq(followUps.id, followUpId), eq(followUps.tenantId, tenantId)));

    revalidatePath("/");
    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// تعديل تذكير موجود (يقبل ISO + نوع + ملاحظة اختيارية)
export async function updateFollowUpSchedule(
  followUpId: string,
  scheduledAtISO: string,
  input: { notes?: string; type?: "CALL" | "WHATSAPP" | "MESSAGE" } = {},
) {
  try {
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
    return { success: true as const, scheduledAt: newDate };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// إلغاء تذكير + أي تذكيرات معلّقة أخرى للعميل (من نفس user فقط)
export async function cancelFollowUp(followUpId: string) {
  try {
    const { tenantId, userId, role } = await getContext();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(followUpId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
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
        action: "FOLLOW_UP_CANCELLED",
        entityType: "follow_up",
        entityId: followUpId,
        details: { leadId: existing.leadId },
      });
    });

    revalidatePath("/");
    revalidatePath("/leads");
    return { success: true as const };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// تأجيل بالدقائق — من داخل إشعار الاستحقاق
export async function snoozeFollowUpMinutes(followUpId: string, minutes: number) {
  try {
    const { tenantId, userId, role } = await getContext();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(followUpId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      return { success: false as const, error: "عدد الدقائق غير صالح (1-1440)" } satisfies Fail;
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
    return { success: true as const, scheduledAt: newDate };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// المتابعات التي حان موعدها للتو (للـ in-app toasts)
// =============================================

export async function getJustDueFollowUps(sinceISO: string) {
  try {
    const { tenantId, userId, role } = await getContext();
    // role check ضروري — الـ due-watcher يستدعيه كل 30 ثانية، وبلا حراسة كان
    // PROVIDER يحصد أسماء/جوالات كل العملاء المستحقين
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

    const since = new Date(sinceISO);
    const now = new Date();
    if (isNaN(since.getTime())) return { success: true as const, followUps: [] };

    // role متاح من getContext — لا حاجة لاستعلام DB إضافي (getUserRole)
    const conditions = [
      eq(followUps.tenantId, tenantId),
      isNull(followUps.completedAt),
      isNotNull(followUps.scheduledAt),
      sql`${followUps.scheduledAt} > ${since.toISOString()}`,
      sql`${followUps.scheduledAt} <= ${now.toISOString()}`,
      eq(leads.isDeleted, false),
    ];
    if (role === "COORDINATOR") {
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

    return { success: true as const, followUps: rows };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// متابعة سريعة بنقرة واحدة
// =============================================

export async function quickScheduleFollowUp(raw: unknown) {
  try {
    const { tenantId, userId, role } = await getContext();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    const input = quickScheduleFollowUpSchema.parse(raw);
    await assertLeadInTenant(input.leadId, tenantId);
    // المنسق يتابع عملاء ضمن نطاقه فقط (عملاءه + حملاته — منطق getLeads)
    await assertCoordinatorCanAccessLead(input.leadId, tenantId, userId, role);

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

    const followUp = await db.transaction(async (tx) => {
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

      const [fu] = await tx
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
        entityId: fu.id,
        details: {
          leadId: input.leadId,
          type: input.type || "CALL",
          quick: true,
          scheduledFor: scheduledAt.toISOString(),
        },
      });

      return fu;
    });

    revalidatePath("/");
    revalidatePath("/leads");
    return { success: true as const, scheduledAt, followUpId: followUp.id };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// "لم يرد" + إعادة محاولة تلقائية
// =============================================

export async function quickNoResponse(leadId: string, retryAfterDays: number = 1) {
  try {
    const { tenantId, userId, role } = await getContext();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(leadId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    if (!Number.isInteger(retryAfterDays) || retryAfterDays < 1 || retryAfterDays > 30) {
      return { success: false as const, error: "عدد أيام الإعادة غير صالح" } satisfies Fail;
    }
    await assertLeadInTenant(leadId, tenantId);
    // المنسق يتصرّف على عملاء ضمن نطاقه فقط (عملاءه + حملاته — منطق getLeads)
    await assertCoordinatorCanAccessLead(leadId, tenantId, userId, role);

    // 10 صباحاً بتوقيت الرياض في اليوم المستهدف. السيرفر يعمل UTC، فـ setHours
    // المحلي كان يجعل التذكير 1 ظهراً بتوقيت الرياض. نبني الوقت صراحةً بإزاحة +3.
    const riyadhToday = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
    const [ry, rm, rd] = riyadhToday.split("-").map(Number);
    const retryDate = new Date(Date.UTC(ry, rm - 1, rd + retryAfterDays, 10 - 3, 0, 0));

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
      return { success: true as const, retryDate, alreadyMarked: true };
    }

    await db.transaction(async (tx) => {
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
    });

    revalidatePath("/");
    revalidatePath("/leads");
    return { success: true as const, retryDate };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// تعليم عميل كـ "تم التواصل معه" (زر "تواصلت" في صفحة المُهمَلين)
// =============================================

/**
 * يسجّل متابعة مكتملة فوراً (completedAt = الآن) — يُحدِث "آخر نشاط" للعميل
 * فيخرج من قائمة المُهمَلين. لا ينشئ تذكيراً معلّقاً: الزر كان ينشئ follow-up
 * PENDING مستحقاً الآن فيطلق due-watcher إنذاراً كاذباً بعد ~30 ثانية.
 */
export async function markLeadContacted(leadId: string) {
  try {
    const { tenantId, userId, role } = await getContext();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(leadId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    await assertLeadInTenant(leadId, tenantId);
    // المنسق يتصرّف على عملاء ضمن نطاقه فقط (عملاءه + حملاته — منطق getLeads)
    await assertCoordinatorCanAccessLead(leadId, tenantId, userId, role);

    const followUp = await db.transaction(async (tx) => {
      const [fu] = await tx
        .insert(followUps)
        .values({
          tenantId,
          leadId,
          userId,
          type: "CALL",
          notes: "✅ تم التواصل مع العميل",
          completedAt: new Date(),
        })
        .returning({ id: followUps.id });

      await tx.insert(activityLog).values({
        tenantId,
        userId,
        action: "FOLLOW_UP_CREATED",
        entityType: "follow_up",
        entityId: fu.id,
        details: { leadId, action: "marked_contacted", type: "CALL" },
      });

      return fu;
    });

    revalidatePath("/leads");
    revalidatePath("/leads/aging");
    revalidatePath("/");
    return { success: true as const, followUpId: followUp.id };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// جلب عدد المتابعات المتأخرة (للإشعارات)
// =============================================

export async function getOverdueFollowUpsCount() {
  try {
    const { tenantId, userId, role } = await getContext();
    // role check ضروري — بلا حراسة كان PROVIDER يقرأ عدّادات متابعات الشركة
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);

    const now = new Date();
    const conditions = [
      eq(followUps.tenantId, tenantId),
      lte(followUps.scheduledAt, now),
      isNull(followUps.completedAt),
      isNotNull(followUps.scheduledAt),
    ];

    // المنسق يرى مهامه فقط — role من getContext (لا استعلام DB إضافي)
    if (role === "COORDINATOR") {
      conditions.push(eq(followUps.userId, userId));
    }

    const [result] = await db
      .select({ total: count() })
      .from(followUps)
      .innerJoin(leads, eq(followUps.leadId, leads.id))
      .where(and(...conditions, eq(leads.isDeleted, false)));

    return { success: true as const, count: result?.total || 0 };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// جلب عدد محاولات التواصل السابقة مع عميل
// محاولة = CALL أو WHATSAPP مكتمل وغير مُلغى (يمثّل اتصالاً فعلياً)
// =============================================

export async function getLeadFollowUpCount(leadId: string) {
  try {
    const { tenantId, userId, role } = await getContext();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(leadId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    await assertLeadInTenant(leadId, tenantId);
    // المنسق يرى بيانات عملاء ضمن نطاقه فقط
    await assertCoordinatorCanAccessLead(leadId, tenantId, userId, role);

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
          // ⚠️ يجب تقويس الـ OR: بدون الأقواس، أسبقية AND/OR تجعل الشرط
          // `(... AND notes NOT LIKE ...) OR notes IS NULL` فينفصل `notes IS NULL`
          // عن فلتر الشركة/العميل ويَعُدّ متابعات كل الشركات (تسريب + عدّ خاطئ).
          sql`(${followUps.notes} NOT LIKE '(ملغى)%' OR ${followUps.notes} IS NULL)`,
        ),
      );

    return { success: true as const, count: result?.total || 0 };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// جلب آخر الملاحظات لعميل (رحلة الإقناع)
// =============================================

export async function getLeadRecentNotes(leadId: string) {
  try {
    const { tenantId, userId, role } = await getContext();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(leadId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    await assertLeadInTenant(leadId, tenantId);
    // المنسق يرى بيانات عملاء ضمن نطاقه فقط
    await assertCoordinatorCanAccessLead(leadId, tenantId, userId, role);

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

    return { success: true as const, notes };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

// =============================================
// جلب المتابعات المجدولة المعلّقة لعميل
// =============================================

export async function getLeadPendingFollowUp(leadId: string) {
  try {
    const { tenantId, userId, role } = await getContext();
    assertRole(role, ROLE.OWNER_ADMIN_COORDINATOR);
    if (!isUuid(leadId)) {
      return { success: false as const, error: "معرّف غير صالح" } satisfies Fail;
    }
    await assertLeadInTenant(leadId, tenantId);
    // المنسق يرى بيانات عملاء ضمن نطاقه فقط
    await assertCoordinatorCanAccessLead(leadId, tenantId, userId, role);

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

    return { success: true as const, followUp: pending || null };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}
