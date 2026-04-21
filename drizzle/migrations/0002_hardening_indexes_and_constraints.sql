-- ============================================================
-- Hardening migration: فهارس + unique constraints
-- قبل التطبيق شغّل: npx tsx scripts/pre-migration-audit.ts
-- ============================================================
CREATE INDEX IF NOT EXISTS "leads_tenant_deleted_idx" ON "leads" ("tenant_id", "is_deleted");
CREATE INDEX IF NOT EXISTS "leads_tenant_assigned_idx" ON "leads" ("tenant_id", "assigned_to");
CREATE INDEX IF NOT EXISTS "leads_tenant_stage_idx" ON "leads" ("tenant_id", "stage_id");
CREATE INDEX IF NOT EXISTS "leads_tenant_booking_idx" ON "leads" ("tenant_id", "booking_date") WHERE booking_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS "leads_tenant_phone_idx" ON "leads" ("tenant_id", "phone");
CREATE INDEX IF NOT EXISTS "leads_tenant_created_idx" ON "leads" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "followups_lead_idx" ON "follow_ups" ("lead_id");
CREATE INDEX IF NOT EXISTS "followups_tenant_user_scheduled_idx" ON "follow_ups" ("tenant_id", "user_id", "scheduled_at") WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS "followups_tenant_scheduled_idx" ON "follow_ups" ("tenant_id", "scheduled_at") WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS "activity_log_tenant_created_idx" ON "activity_log" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "activity_log_tenant_entity_idx" ON "activity_log" ("tenant_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx" ON "notifications" ("user_id", "created_at") WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_stages_tenant_name_unique" ON "pipeline_stages" ("tenant_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "departments_tenant_name_unique" ON "departments" ("tenant_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "tags_tenant_name_unique" ON "tags" ("tenant_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "tag_assignments_lead_tag_unique" ON "tag_assignments" ("lead_id", "tag_id");
CREATE UNIQUE INDEX IF NOT EXISTS "dept_providers_dept_user_unique" ON "department_providers" ("department_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "provider_schedules_user_day_unique" ON "provider_schedules" ("user_id", "day_of_week");
