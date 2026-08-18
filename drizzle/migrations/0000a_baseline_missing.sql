-- =============================================
-- Migration: Baseline gap-fill (0000a — يعمل بعد 0000 وقبل 0001)
--
-- السبب: قاعدة الإنتاج الأصلية أُنشئت عبر `drizzle-kit push` للـ schema الكامل،
-- ثم كُتبت ملفات .sql التراكمية فوقها. النتيجة أن عناصر يفترضها 0001/0002/0004
-- والـ schema الحالي لم تُنشأ في أي ملف هجرة، فأي نشر على قاعدة بيانات نظيفة
-- كان يفشل في الإقلاع (`relation "services" does not exist` /
-- `type "booking_status" does not exist`).
--
-- هذا الملف يسدّ تلك الفجوة. كل العبارات idempotent (IF NOT EXISTS) أو يتجاهلها
-- المهاجر عبر مطابقة "already exists" — فهو no-op كامل على القاعدة الحالية،
-- ويبني العناصر الناقصة على قاعدة جديدة. مرتّب 0000a ليعمل قبل 0001 الذي يفترض
-- وجود `services` و `booking_status`.
-- =============================================

-- 1. enum حالة الحجز (يفترضه فهرس 0002 وقيد 0004).
--    لا يوجد CREATE TYPE IF NOT EXISTS في Postgres — نعتمد على تجاهل المهاجر
--    لخطأ "already exists" عند إعادة التشغيل (نفس نمط enums في 0000).
CREATE TYPE "public"."booking_status" AS ENUM('PENDING', 'COMPLETED', 'ATTENDED_NOT_SUITABLE', 'CANCELLED', 'NO_RESPONSE', 'POSTPONED');

-- 2. جدول services الأساسي (0001 يضيف لاحقاً department_id + default_duration_min).
--    لا نضع department_id هنا لأن جدول departments يُنشأ في 0001 (بعد هذا الملف).
CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. أعمدة الحجز الناقصة على leads (0001 يضيف البقية: department/resource/duration/end_time).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_status booking_status;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_date TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_service VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_notes TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS welcome_sent_at TIMESTAMPTZ;

-- 4. عمود pipeline_stages.is_booking (المرحلة التي تمثّل "حجز").
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS is_booking BOOLEAN NOT NULL DEFAULT false;

-- 5. أعمدة whatsapp_configs الناقصة (موجودة في الـ schema، غير منشأة في 0000).
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS template_name VARCHAR(255);
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS template_language VARCHAR(10) DEFAULT 'ar';
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS template_params JSONB DEFAULT '["customer_name"]'::jsonb;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS reminder_template_name VARCHAR(255);
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS reminder_evening BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS reminder_morning BOOLEAN NOT NULL DEFAULT true;
