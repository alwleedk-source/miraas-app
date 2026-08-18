"use server";

import { db } from "@/db";
import { leads, leadSources, users, pipelineStages } from "@/db/schema";
import { eq, and, or, ilike, sql, isNotNull } from "drizzle-orm";
import { requireTenant } from "@/lib/auth-server";
import { assertRole, ROLE } from "@/lib/tenant-guards";
import { ARCHIVE_REASONS } from "@/lib/archive-reasons";

const PRIORITY_LABELS: Record<string, string> = {
  LOW: "منخفضة",
  MEDIUM: "متوسطة",
  HIGH: "عالية",
  URGENT: "عاجلة",
};

const BOOKING_STATUS_LABELS: Record<string, string> = {
  PENDING: "بانتظار",
  COMPLETED: "حضر",
  ATTENDED_NOT_SUITABLE: "لم يناسبه",
  CANCELLED: "ألغى",
  NO_RESPONSE: "لم يرد",
  POSTPONED: "مؤجّل",
};

type Fail = { success: false; error: string };

/**
 * عقد الأخطاء الموحّد: الأخطاء المتوقَّعة (صلاحية/تحقق) تُعاد كـ
 * { success: false, error: "عربي" } — Next.js يُخفي رسائل المرمية في production.
 */
function expectedError(err: unknown): string | null {
  if (err instanceof Error && /[؀-ۿ]/.test(err.message)) return err.message;
  return null;
}

/** يُهرب قيمة CSV: لو فيها , أو " أو newline → اقتباس مزدوج */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // CSV formula injection: Excel/Sheets تنفّذ الخلايا التي تبدأ بـ = + - @ أو tab
  // كصيغ — بادئة ' تجبرها كنص (أسماء العملاء تأتي من webhook عام).
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatDateRiyadh(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toLocaleString("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * تصدير العملاء كـ CSV (يدعم نفس فلاتر getLeads).
 *
 * - OWNER/ADMIN فقط (يحوي بيانات شخصية كاملة)
 * - يرجع string مع UTF-8 BOM لكي Excel يفتحها بعربي صحيح
 * - بدون pagination — كل المطابق
 * - أقصى 10,000 صف protective cap
 */
export async function exportLeadsCSV(options?: {
  search?: string;
  stageId?: string;
  priority?: string;
  assignedTo?: string;
  includeArchived?: boolean;
}): Promise<{ success: true; filename: string; csv: string; count: number } | Fail> {
  try {
    const { tenantId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN);

  const conditions = [
    eq(leads.tenantId, tenantId),
    eq(leads.isDeleted, false),
  ];

  if (!options?.includeArchived) {
    conditions.push(sql`${leads.archivedAt} IS NULL`);
  }
  if (options?.stageId) {
    conditions.push(eq(leads.stageId, options.stageId));
  }
  if (options?.priority) {
    conditions.push(
      eq(leads.priority, options.priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT"),
    );
  }
  if (options?.assignedTo) {
    conditions.push(eq(leads.assignedTo, options.assignedTo));
  }

  const whereClause = options?.search
    ? and(
        and(...conditions),
        or(
          ilike(leads.name, `%${options.search}%`),
          ilike(leads.phone, `%${options.search}%`),
        ),
      )
    : and(...conditions);

  const rows = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      company: leads.company,
      priority: leads.priority,
      createdAt: leads.createdAt,
      bookingStatus: leads.bookingStatus,
      bookingDate: leads.bookingDate,
      bookingService: leads.bookingService,
      bookingNotes: leads.bookingNotes,
      stageName: pipelineStages.name,
      assignedUserName: users.name,
      sourceName: leadSources.name,
    })
    .from(leads)
    .leftJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
    .leftJoin(users, eq(leads.assignedTo, users.id))
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(whereClause)
    .orderBy(leads.createdAt)
    .limit(10_000);

  const headers = [
    "الاسم",
    "الهاتف",
    "الإيميل",
    "الشركة",
    "الأولوية",
    "المرحلة",
    "المنسق",
    "المصدر",
    "موعد الحجز",
    "حالة الحجز",
    "الخدمة",
    "ملاحظات الحجز",
    "تاريخ الإضافة",
  ];

  const lines: string[] = [headers.map(csvCell).join(",")];

  for (const r of rows) {
    lines.push(
      [
        csvCell(r.name),
        csvCell(r.phone),
        csvCell(r.email),
        csvCell(r.company),
        csvCell(PRIORITY_LABELS[r.priority] ?? r.priority),
        csvCell(r.stageName),
        csvCell(r.assignedUserName),
        csvCell(r.sourceName),
        csvCell(formatDateRiyadh(r.bookingDate)),
        csvCell(BOOKING_STATUS_LABELS[r.bookingStatus ?? ""] ?? r.bookingStatus),
        csvCell(r.bookingService),
        csvCell(r.bookingNotes),
        csvCell(formatDateRiyadh(r.createdAt)),
      ].join(","),
    );
  }

  const csv = "﻿" + lines.join("\n"); // BOM لـ Excel-Arabic
  const today = new Date().toISOString().slice(0, 10);
  const suffix = options?.includeArchived ? "-with-archive" : "";

  return {
    success: true as const,
    filename: `meras-leads-${today}${suffix}.csv`,
    csv,
    count: rows.length,
  };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}

/**
 * تصدير العملاء المؤرشفين كـ CSV — مع أعمدة خاصة بالأرشيف.
 *
 * - OWNER/ADMIN فقط
 * - يدعم فلترة بالسبب أو البحث
 * - أعمدة إضافية: سبب الأرشفة، ملاحظة، تاريخ الأرشفة، تاريخ إعادة التفعيل،
 *   هل DNC (Do Not Contact)
 */
export async function exportArchivedLeadsCSV(options?: {
  reason?: string;
  search?: string;
}): Promise<{ success: true; filename: string; csv: string; count: number } | Fail> {
  try {
    const { tenantId, role } = await requireTenant();
    assertRole(role, ROLE.OWNER_ADMIN);

  const conditions = [
    eq(leads.tenantId, tenantId),
    eq(leads.isDeleted, false),
    isNotNull(leads.archivedAt),
  ];

  if (options?.reason) {
    conditions.push(eq(leads.archiveReason, options.reason));
  }

  const whereClause = options?.search
    ? and(
        and(...conditions),
        or(
          ilike(leads.name, `%${options.search}%`),
          ilike(leads.phone, `%${options.search}%`),
        ),
      )
    : and(...conditions);

  const rows = await db
    .select({
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      archivedAt: leads.archivedAt,
      archiveReason: leads.archiveReason,
      archiveNote: leads.archiveNote,
      reactivateAt: leads.reactivateAt,
      canRecontact: leads.canRecontact,
      stageName: pipelineStages.name,
      assignedUserName: users.name,
      sourceName: leadSources.name,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .leftJoin(pipelineStages, eq(leads.stageId, pipelineStages.id))
    .leftJoin(users, eq(leads.assignedTo, users.id))
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(whereClause)
    .orderBy(leads.archivedAt)
    .limit(10_000);

  const headers = [
    "الاسم",
    "الهاتف",
    "الإيميل",
    "سبب الأرشفة",
    "ملاحظة",
    "تاريخ الأرشفة",
    "موعد إعادة التفعيل",
    "DNC (لا تواصل)",
    "المرحلة قبل الأرشفة",
    "المنسق",
    "المصدر",
    "تاريخ الإضافة",
  ];

  const lines: string[] = [headers.map(csvCell).join(",")];

  for (const r of rows) {
    const reasonInfo = r.archiveReason
      ? ARCHIVE_REASONS[r.archiveReason as keyof typeof ARCHIVE_REASONS]
      : null;
    lines.push(
      [
        csvCell(r.name),
        csvCell(r.phone),
        csvCell(r.email),
        csvCell(reasonInfo?.label ?? r.archiveReason),
        csvCell(r.archiveNote),
        csvCell(formatDateRiyadh(r.archivedAt)),
        csvCell(formatDateRiyadh(r.reactivateAt)),
        csvCell(r.canRecontact ? "" : "نعم"),
        csvCell(r.stageName),
        csvCell(r.assignedUserName),
        csvCell(r.sourceName),
        csvCell(formatDateRiyadh(r.createdAt)),
      ].join(","),
    );
  }

  const csv = "﻿" + lines.join("\n");
  const today = new Date().toISOString().slice(0, 10);
  const reasonSuffix = options?.reason ? `-${options.reason.toLowerCase()}` : "";

  return {
    success: true as const,
    filename: `meras-archive-${today}${reasonSuffix}.csv`,
    csv,
    count: rows.length,
  };
  } catch (err) {
    const msg = expectedError(err);
    if (msg) return { success: false as const, error: msg } satisfies Fail;
    throw err;
  }
}
