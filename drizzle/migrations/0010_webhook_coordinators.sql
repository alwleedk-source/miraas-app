-- =============================================
-- Migration: per-webhook coordinator visibility
--
-- 1. ربط leads مباشرة بالـ webhook الذي جلبهم (للفلترة الدقيقة)
-- 2. junction للمنسقين المخوّلين برؤية كل webhook
-- 3. تخفيض حدّ label لتنظيم التصميم
-- =============================================

-- 1. عمود leads.webhook_endpoint_id (FK إلى webhook_endpoints)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS webhook_endpoint_id UUID
  REFERENCES webhook_endpoints(id) ON DELETE SET NULL;

-- index جزئي — partial: لا نهرّ السجلات المُضافة يدوياً (NULL)
CREATE INDEX IF NOT EXISTS leads_tenant_webhook_idx
  ON leads(tenant_id, webhook_endpoint_id)
  WHERE webhook_endpoint_id IS NOT NULL;

-- 2. junction table — منسق ↔ webhook (many-to-many)
CREATE TABLE IF NOT EXISTS webhook_coordinators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- يمنع تكرار نفس الزوج
CREATE UNIQUE INDEX IF NOT EXISTS webhook_coordinators_webhook_user_unique
  ON webhook_coordinators(webhook_id, user_id);

-- يسرّع البحث "ما الـ webhooks الخاصة بالمنسق X؟" — يُستخدَم في getLeads
CREATE INDEX IF NOT EXISTS webhook_coordinators_user_idx
  ON webhook_coordinators(user_id);

-- 3. تخفيض حدّ label لتصميم منظّم (آمن: UI يحدّه بـ 50 حالياً)
-- ⚠️ المهاجر يعيد تشغيل هذا الملف في كل إقلاع. لو وُجدت أي تسمية أطول من 60 حرفاً
-- (بيانات قديمة)، فإن ALTER TYPE يفشل بخطأ "value too long" غير المُتسامَح معه →
-- يمنع التطبيق من البدء. لذا نقصّ البيانات الطويلة أولاً (idempotent — بعد القصّ يصبح no-op).
UPDATE webhook_endpoints SET label = left(label, 60) WHERE length(label) > 60;
ALTER TABLE webhook_endpoints ALTER COLUMN label TYPE VARCHAR(60);
