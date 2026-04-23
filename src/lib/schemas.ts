import { z } from "zod";

// =============================================
// Webhooks
// =============================================

/** اسم الحملة/الـ webhook — قصير ومنظّم للعرض في القوائم والكود */
export const webhookLabelSchema = z.string().trim().min(1).max(60);

/** ربط منسقين بحملة معيّنة — array فارغ = إزالة كل التخصيصات */
export const setWebhookCoordinatorsSchema = z.object({
  webhookId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).max(50),
});

// =============================================
// Leads
// =============================================

export const createLeadSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(255).optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  sourceId: z.string().uuid().optional(),
  sourceName: z.string().max(255).optional(),
  stageId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
});

export const updateLeadSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(255).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(255).optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  sourceId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
});

export const bulkImportSchema = z.object({
  campaignName: z.string().trim().max(255),
  leads: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(255),
        phone: z.string().min(4).max(50),
      }),
    )
    .max(5000),
});

export const bulkUpdateLeadsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  patch: z.object({
    assignedTo: z.string().uuid().nullable().optional(),
    stageId: z.string().uuid().nullable().optional(),
  }),
});

export const bulkDeleteLeadsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
});

// =============================================
// Bookings
// =============================================

const reasonableDate = z
  .string()
  .refine((s) => !isNaN(new Date(s).getTime()), "تاريخ غير صالح")
  .refine((s) => {
    const d = new Date(s);
    const now = Date.now();
    const twoYears = 1000 * 60 * 60 * 24 * 365 * 2;
    return d.getTime() < now + twoYears && d.getTime() > now - twoYears;
  }, "التاريخ خارج النطاق المعقول");

export const createBookingSchema = z.object({
  leadId: z.string().uuid(),
  bookingDate: reasonableDate,
  bookingService: z.string().trim().min(1).max(500),
  bookingNotes: z.string().max(2000).optional(),
  bookingDepartmentId: z.string().uuid().optional().nullable(),
  // اختياري لكن لو مُمرّر يفعّل EXCLUDE constraint لمنع double-booking
  bookingResourceId: z.string().uuid().optional().nullable(),
  bookingDurationMin: z.number().int().min(5).max(480).optional(),
});

export const updateBookingStatusSchema = z.object({
  leadId: z.string().uuid(),
  status: z.enum([
    "PENDING",
    "COMPLETED",
    "ATTENDED_NOT_SUITABLE",
    "CANCELLED",
    "NO_RESPONSE",
    "POSTPONED",
  ]),
  postponeDate: reasonableDate.optional(),
  postponeReason: z.string().max(500).optional(),
});

export const updateBookingDateSchema = z.object({
  leadId: z.string().uuid(),
  bookingDate: reasonableDate,
  bookingService: z.string().max(500).optional(),
  bookingNotes: z.string().max(2000).optional(),
  departmentId: z.string().uuid().optional(),
  resourceId: z.string().uuid().optional(),
  duration: z.number().int().min(5).max(480).optional(),
});

export const quickBookingSchema = z.object({
  existingLeadId: z.string().uuid().optional(),
  name: z.string().trim().max(255).optional(),
  phone: z.string().min(4).max(50),
  bookingDate: reasonableDate,
  bookingService: z.string().trim().min(1).max(500),
  bookingNotes: z.string().max(2000).optional(),
  bookingDepartmentId: z.string().uuid().optional(),
  bookingResourceId: z.string().uuid().optional(),
  bookingDurationMin: z.number().int().min(5).max(480).optional(),
});

// =============================================
// Follow-ups
// =============================================

export const quickScheduleFollowUpSchema = z.object({
  leadId: z.string().uuid(),
  scheduledAt: reasonableDate,
  notes: z.string().max(2000).optional(),
  type: z.enum(["CALL", "WHATSAPP", "MESSAGE"]).optional(),
});

export const updateFollowUpScheduleSchema = z.object({
  followUpId: z.string().uuid(),
  scheduledAtISO: reasonableDate,
  notes: z.string().max(2000).optional(),
  type: z.enum(["CALL", "WHATSAPP", "MESSAGE"]).optional(),
});

// =============================================
// Team
// =============================================

const MEMBER_ROLES = z.enum(["ADMIN", "COORDINATOR", "PROVIDER"]);

export const inviteTeamMemberSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().email().max(255).toLowerCase(),
  password: z.string().min(10).max(200),
  role: MEMBER_ROLES,
});

export const updateMemberRoleSchema = z.object({
  memberId: z.string().uuid(),
  newRole: MEMBER_ROLES,
});

// =============================================
// Archive
// =============================================

export const archiveLeadSchema = z.object({
  leadId: z.string().uuid(),
  reason: z.enum([
    "PRICE",
    "NO_RESPONSE",
    "COMPETITOR",
    "BAD_TIMING",
    "NOT_INTERESTED",
    "WRONG_NUMBER",
    "DO_NOT_CONTACT",
    "OTHER",
  ]),
  note: z.string().max(2000).optional(),
  reactivateAt: z
    .string()
    .refine((s) => !isNaN(new Date(s).getTime()), "تاريخ غير صالح")
    .refine((s) => {
      const d = new Date(s);
      const now = Date.now();
      const max = now + 1000 * 60 * 60 * 24 * 365 * 2; // أقصى سنتين
      return d.getTime() > now && d.getTime() < max;
    }, "تاريخ خارج النطاق")
    .optional(),
  isDoNotContact: z.boolean().optional(),
});

// =============================================
// Webhook
// =============================================

export const webhookEntrySchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().min(4).max(50),
  email: z.string().email().max(255).optional().nullable(),
  campaign: z.string().max(255).optional(),
  // ملاحظة: لا joinedAt — السيرفر يحدد الوقت دائماً
});
