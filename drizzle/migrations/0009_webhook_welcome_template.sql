-- =============================================
-- Migration: per-webhook welcome template override
-- Adds welcome_template_name to webhook_endpoints.
-- null = use tenant default whatsappConfigs.templateName
-- =============================================

ALTER TABLE webhook_endpoints
  ADD COLUMN IF NOT EXISTS welcome_template_name VARCHAR(255);
