-- =============================================
-- Migration: per-user WhatsApp credentials
--
-- 1. جدول جديد لاعتماد كل منسق لرقم Meta خاص به
-- 2. عمود على leads يخزّن "أيّ منسق أُرسل الترحيب من رقمه"
-- 3. عمود على webhook_endpoints لـ round-robin pointer
-- =============================================

-- 1. user_whatsapp_credentials — one-to-one مع users
CREATE TABLE IF NOT EXISTS user_whatsapp_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  api_key_encrypted TEXT,
  phone_number_id VARCHAR(50),
  template_language VARCHAR(10) DEFAULT 'ar',
  is_active BOOLEAN NOT NULL DEFAULT false,
  last_tested_at TIMESTAMPTZ,
  last_test_success BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- يسرّع البحث "كم منسق نشط في tenant؟" — للتقارير
CREATE INDEX IF NOT EXISTS user_wa_creds_tenant_active_idx
  ON user_whatsapp_credentials(tenant_id, is_active)
  WHERE is_active = true;

-- 2. leads.welcome_sent_by_user_id — اتّساق رقم الإرسال عبر دورة حياة العميل
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS welcome_sent_by_user_id UUID
  REFERENCES users(id) ON DELETE SET NULL;

-- 3. webhook_endpoints.last_assigned_to_user_id — round-robin
ALTER TABLE webhook_endpoints
  ADD COLUMN IF NOT EXISTS last_assigned_to_user_id UUID
  REFERENCES users(id) ON DELETE SET NULL;
