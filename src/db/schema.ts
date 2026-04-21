import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ============================================
// Enums
// ============================================

export const userRoleEnum = pgEnum("user_role", [
  "SUPER_ADMIN",
  "OWNER",
  "ADMIN",
  "COORDINATOR",
  "PROVIDER",
]);

export const tenantStatusEnum = pgEnum("tenant_status", [
  "ACTIVE",
  "SUSPENDED",
  "TRIAL",
]);

export const tenantPlanEnum = pgEnum("tenant_plan", [
  "TRIAL",
  "STARTER",
  "PROFESSIONAL",
  "ENTERPRISE",
]);

export const leadPriorityEnum = pgEnum("lead_priority", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
]);

export const bookingStatusEnum = pgEnum("booking_status", [
  "PENDING",
  "COMPLETED",
  "ATTENDED_NOT_SUITABLE",
  "CANCELLED",
  "NO_RESPONSE",
  "POSTPONED",
]);

export const followUpTypeEnum = pgEnum("follow_up_type", [
  "CALL",
  "MESSAGE",
  "MEETING",
  "EMAIL",
  "WHATSAPP",
  "NOTE",
]);

export const activityActionEnum = pgEnum("activity_action", [
  "LEAD_CREATED",
  "LEAD_UPDATED",
  "LEAD_ASSIGNED",
  "LEAD_STAGE_CHANGED",
  "LEAD_DELETED",
  "FOLLOW_UP_CREATED",
  "USER_CREATED",
  "USER_UPDATED",
  "SETTINGS_UPDATED",
  "WEBHOOK_RECEIVED",
  "WHATSAPP_SENT",
  "WHATSAPP_FAILED",
  "DEPARTMENT_CREATED",
  "DEPARTMENT_UPDATED",
  "INTERNAL_MESSAGE",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "NEW_LEAD",
  "LEAD_ASSIGNED",
  "FOLLOW_UP_REMINDER",
  "SYSTEM",
]);

// ============================================
// 1. Tenants (الشركات)
// ============================================

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  logoUrl: text("logo_url"),
  plan: tenantPlanEnum("plan").default("TRIAL").notNull(),
  status: tenantStatusEnum("status").default("ACTIVE").notNull(),
  settings: jsonb("settings").default({}).$type<{
    timezone?: string;
    language?: string;
    currency?: string;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// 2. Users (المستخدمون)
// ============================================

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // tenantId يبقى nullable مؤقتاً — register flow ينشئ user ثم tenant
  // بعد إكمال signup يصبح notNull دائماً. Migration 0004 يضيف CHECK constraint.
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: userRoleEnum("role").default("COORDINATOR").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// Better Auth required tables
// ============================================

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// 3. Pipeline Stages (مراحل الأنابيب)
// ============================================

export const pipelineStages = pgTable("pipeline_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 20 }).notNull().default("#3B82F6"),
  position: integer("position").notNull().default(0),
  isDefault: boolean("is_default").default(false).notNull(),
  isExclusive: boolean("is_exclusive").default(false).notNull(),
  isBooking: boolean("is_booking").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantNameUnique: uniqueIndex("pipeline_stages_tenant_name_unique").on(t.tenantId, t.name),
}));

// ============================================
// 4. Lead Sources (مصادر العملاء)
// ============================================

export const leadSources = pgTable("lead_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  platform: varchar("platform", { length: 100 }),
  campaignId: varchar("campaign_id", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// 4b. Services (الخدمات المقدمة)
// ============================================

export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  defaultDurationMin: integer("default_duration_min").default(30),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// 4c. Departments (الأقسام)
// ============================================

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  color: varchar("color", { length: 20 }).notNull().default("#3B82F6"),
  defaultGapMinutes: integer("default_gap_minutes").notNull().default(15),
  position: integer("position").notNull().default(0),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantNameUnique: uniqueIndex("departments_tenant_name_unique").on(t.tenantId, t.name),
}));

// ============================================
// 4d. Department Providers (ربط الموارد بالأقسام)
// ============================================

export const departmentProviders = pgTable("department_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  deptUserUnique: uniqueIndex("dept_providers_dept_user_unique").on(t.departmentId, t.userId),
}));

// ============================================
// 4e. Provider Schedules (ساعات العمل الأسبوعية)
// ============================================

export const providerSchedules = pgTable("provider_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(), // 0=الأحد ... 6=السبت
  startTime: varchar("start_time", { length: 5 }).notNull(), // "09:00"
  endTime: varchar("end_time", { length: 5 }).notNull(), // "17:00"
  breakStart: varchar("break_start", { length: 5 }), // "12:30" nullable
  breakEnd: varchar("break_end", { length: 5 }), // "13:30" nullable
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  // مستخدم واحد، يوم واحد، سجل واحد — يمنع تكرار الجدول لنفس اليوم
  userDayUnique: uniqueIndex("provider_schedules_user_day_unique").on(t.userId, t.dayOfWeek),
}));

// ============================================
// 4f. Provider Day Offs (الإجازات والاستثناءات)
// ============================================

export const providerDayOffs = pgTable("provider_day_offs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: timestamp("date", { withTimezone: true }).notNull(),
  reason: varchar("reason", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// 4g. Internal Messages (الرسائل الداخلية السريعة)
// ============================================

export const internalMessages = pgTable("internal_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  senderRole: varchar("sender_role", { length: 20 }).notNull(), // PROVIDER | COORDINATOR
  departmentId: uuid("department_id").references(() => departments.id, { onDelete: "cascade" }),
  messageType: varchar("message_type", { length: 20 }).notNull().default("CUSTOM"), // QUICK_STATUS | CUSTOM
  content: text("content").notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// 5. Leads (العملاء المحتملون)
// ============================================

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  sourceId: uuid("source_id").references(() => leadSources.id, { onDelete: "set null" }),
  stageId: uuid("stage_id").references(() => pipelineStages.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 255 }),
  company: varchar("company", { length: 255 }),
  priority: leadPriorityEnum("priority").default("MEDIUM").notNull(),
  customFields: jsonb("custom_fields").default({}).$type<Record<string, string>>(),
  isDeleted: boolean("is_deleted").default(false).notNull(),
  welcomeSentAt: timestamp("welcome_sent_at", { withTimezone: true }),
  // حقول الحجز
  bookingStatus: bookingStatusEnum("booking_status"),
  bookingDate: timestamp("booking_date", { withTimezone: true }),
  bookingService: varchar("booking_service", { length: 255 }),
  bookingNotes: text("booking_notes"),
  bookingDepartmentId: uuid("booking_department_id").references(() => departments.id, { onDelete: "set null" }),
  bookingResourceId: uuid("booking_resource_id").references(() => users.id, { onDelete: "set null" }),
  bookingDurationMin: integer("booking_duration_min"),
  bookingEndTime: timestamp("booking_end_time", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantDeletedIdx: index("leads_tenant_deleted_idx").on(t.tenantId, t.isDeleted),
  tenantAssignedIdx: index("leads_tenant_assigned_idx").on(t.tenantId, t.assignedTo),
  tenantStageIdx: index("leads_tenant_stage_idx").on(t.tenantId, t.stageId),
  tenantBookingIdx: index("leads_tenant_booking_idx")
    .on(t.tenantId, t.bookingDate)
    .where(sql`${t.bookingStatus} IS NOT NULL`),
  tenantPhoneIdx: index("leads_tenant_phone_idx").on(t.tenantId, t.phone),
  tenantCreatedIdx: index("leads_tenant_created_idx").on(t.tenantId, t.createdAt),
}));

// ============================================
// 6. Follow-ups (المتابعات)
// ============================================

export const followUps = pgTable("follow_ups", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: followUpTypeEnum("type").default("NOTE").notNull(),
  notes: text("notes"),
  attachments: jsonb("attachments").default([]).$type<
    Array<{ name: string; url: string; type: string }>
  >(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  leadIdx: index("followups_lead_idx").on(t.leadId),
  tenantUserScheduledIdx: index("followups_tenant_user_scheduled_idx")
    .on(t.tenantId, t.userId, t.scheduledAt)
    .where(sql`${t.completedAt} IS NULL`),
  tenantScheduledIdx: index("followups_tenant_scheduled_idx")
    .on(t.tenantId, t.scheduledAt)
    .where(sql`${t.completedAt} IS NULL`),
}));

// ============================================
// 7. WhatsApp Config (إعدادات واتساب)
// ============================================

export const whatsappConfigs = pgTable("whatsapp_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }).unique(),
  apiKeyEncrypted: text("api_key_encrypted"),
  phoneNumber: varchar("phone_number", { length: 50 }),
  provider: varchar("provider", { length: 50 }).default("meta"),
  // Template Message fields (Meta-approved)
  templateName: varchar("template_name", { length: 255 }),
  templateLanguage: varchar("template_language", { length: 10 }).default("ar"),
  templateParams: jsonb("template_params").default(["name"]).$type<string[]>(),
  // قالب تذكير الحجوزات
  reminderTemplateName: varchar("reminder_template_name", { length: 255 }),
  // استراتيجية التذكير — مبنية على دراسات: التذكير المزدوج يقلل عدم الحضور 39%
  reminderEvening: boolean("reminder_evening").default(true).notNull(),  // 8 مساءً — اليوم السابق
  reminderMorning: boolean("reminder_morning").default(true).notNull(),  // 8 صباحاً — يوم الموعد
  isActive: boolean("is_active").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// 8. Webhook Endpoints (نقاط الاستقبال)
// ============================================

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  // secretKey مهجور — يبقى لدعم البيانات القديمة حتى rotation كامل
  secretKey: varchar("secret_key", { length: 64 }),
  // النهج الجديد: hash + prefix (أول 12 حرفاً للبحث السريع)
  secretHash: text("secret_hash"),
  secretPrefix: varchar("secret_prefix", { length: 12 }),
  label: varchar("label", { length: 255 }).default("Google Sheets"),
  isActive: boolean("is_active").default(true).notNull(),
  sendWelcome: boolean("send_welcome").default(true).notNull(),
  lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  prefixIdx: index("webhook_endpoints_prefix_idx").on(t.secretPrefix),
}));

// ============================================
// 9. Tags (التصنيفات)
// ============================================

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 20 }).notNull().default("#6B7280"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantNameUnique: uniqueIndex("tags_tenant_name_unique").on(t.tenantId, t.name),
}));

// ============================================
// 10. Tag Assignments (ربط التصنيفات)
// ============================================

export const tagAssignments = pgTable("tag_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (t) => ({
  leadTagUnique: uniqueIndex("tag_assignments_lead_tag_unique").on(t.leadId, t.tagId),
}));

// ============================================
// 11. Activity Log (سجل النشاطات)
// ============================================

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: activityActionEnum("action").notNull(),
  entityType: varchar("entity_type", { length: 50 }),
  entityId: uuid("entity_id"),
  details: jsonb("details").default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantCreatedIdx: index("activity_log_tenant_created_idx").on(t.tenantId, t.createdAt),
  tenantEntityIdx: index("activity_log_tenant_entity_idx").on(t.tenantId, t.entityType, t.entityId),
}));

// ============================================
// 13. Error Log (سجل أخطاء السيرفر — بديل Sentry)
// ============================================

export const errorLog = pgTable("error_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  // tenantId اختياري — أخطاء cron/webhook قد تكون قبل حل tenant
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  level: varchar("level", { length: 10 }).notNull(), // "error" | "warn"
  message: text("message").notNull(),
  errorName: varchar("error_name", { length: 100 }),
  errorStack: text("error_stack"),
  context: jsonb("context").default({}).$type<Record<string, unknown>>(),
  url: text("url"),
  // "fingerprint" للتجميع: hash من message+name — يساعد في العد والفرز
  fingerprint: varchar("fingerprint", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  tenantCreatedIdx: index("error_log_tenant_created_idx").on(t.tenantId, t.createdAt),
  fingerprintIdx: index("error_log_fingerprint_idx").on(t.fingerprint, t.createdAt),
}));

// ============================================
// 12. Notifications (الإشعارات)
// ============================================

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userUnreadIdx: index("notifications_user_unread_idx")
    .on(t.userId, t.createdAt)
    .where(sql`${t.readAt} IS NULL`),
}));

// ============================================
// 14. Rate Limits — Postgres-backed (صفر dependencies)
// ============================================

export const rateLimits = pgTable("rate_limits", {
  key: varchar("key", { length: 200 }).primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
}, (t) => ({
  resetIdx: index("rate_limits_reset_idx").on(t.resetAt),
}));

// ============================================
// Relations
// ============================================

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  leads: many(leads),
  pipelineStages: many(pipelineStages),
  leadSources: many(leadSources),
  tags: many(tags),
  webhookEndpoints: many(webhookEndpoints),
  activityLog: many(activityLog),
  notifications: many(notifications),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  assignedLeads: many(leads),
  followUps: many(followUps),
  sessions: many(sessions),
  accounts: many(accounts),
  activityLog: many(activityLog),
  notifications: many(notifications),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  tenant: one(tenants, { fields: [leads.tenantId], references: [tenants.id] }),
  assignedUser: one(users, { fields: [leads.assignedTo], references: [users.id] }),
  source: one(leadSources, { fields: [leads.sourceId], references: [leadSources.id] }),
  stage: one(pipelineStages, { fields: [leads.stageId], references: [pipelineStages.id] }),
  followUps: many(followUps),
  tagAssignments: many(tagAssignments),
}));

export const followUpsRelations = relations(followUps, ({ one }) => ({
  tenant: one(tenants, { fields: [followUps.tenantId], references: [tenants.id] }),
  lead: one(leads, { fields: [followUps.leadId], references: [leads.id] }),
  user: one(users, { fields: [followUps.userId], references: [users.id] }),
}));

export const pipelineStagesRelations = relations(pipelineStages, ({ one, many }) => ({
  tenant: one(tenants, { fields: [pipelineStages.tenantId], references: [tenants.id] }),
  leads: many(leads),
}));

export const leadSourcesRelations = relations(leadSources, ({ one, many }) => ({
  tenant: one(tenants, { fields: [leadSources.tenantId], references: [tenants.id] }),
  leads: many(leads),
}));

export const servicesRelations = relations(services, ({ one }) => ({
  tenant: one(tenants, { fields: [services.tenantId], references: [tenants.id] }),
  department: one(departments, { fields: [services.departmentId], references: [departments.id] }),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [departments.tenantId], references: [tenants.id] }),
  providers: many(departmentProviders),
  services: many(services),
  messages: many(internalMessages),
}));

export const departmentProvidersRelations = relations(departmentProviders, ({ one }) => ({
  department: one(departments, { fields: [departmentProviders.departmentId], references: [departments.id] }),
  user: one(users, { fields: [departmentProviders.userId], references: [users.id] }),
}));

export const providerSchedulesRelations = relations(providerSchedules, ({ one }) => ({
  tenant: one(tenants, { fields: [providerSchedules.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [providerSchedules.userId], references: [users.id] }),
}));

export const providerDayOffsRelations = relations(providerDayOffs, ({ one }) => ({
  tenant: one(tenants, { fields: [providerDayOffs.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [providerDayOffs.userId], references: [users.id] }),
}));

export const internalMessagesRelations = relations(internalMessages, ({ one }) => ({
  tenant: one(tenants, { fields: [internalMessages.tenantId], references: [tenants.id] }),
  sender: one(users, { fields: [internalMessages.senderId], references: [users.id] }),
  department: one(departments, { fields: [internalMessages.departmentId], references: [departments.id] }),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  tenant: one(tenants, { fields: [tags.tenantId], references: [tenants.id] }),
  assignments: many(tagAssignments),
}));

export const tagAssignmentsRelations = relations(tagAssignments, ({ one }) => ({
  lead: one(leads, { fields: [tagAssignments.leadId], references: [leads.id] }),
  tag: one(tags, { fields: [tagAssignments.tagId], references: [tags.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  tenant: one(tenants, { fields: [activityLog.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [activityLog.userId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  tenant: one(tenants, { fields: [notifications.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));
