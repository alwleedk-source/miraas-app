-- Backfill: مرحلة "حجز" (is_booking=true) للـ tenants الموجودين قبل هذه الميزة.
-- tenants الجدد يحصلون عليها تلقائياً من createTenantForUser (src/app/actions/tenant.ts).
-- idempotent: NOT EXISTS يمنع الإدراج المكرر عند إعادة التشغيل، وON CONFLICT يتجاوز
-- tenant لديه مرحلة باسم "حجز" مسبقاً (unique على tenant_id+name) بدل إسقاط الدفعة كلها.
-- ملاحظة للمُشغّل: الـ migrator المخصّص يقسم على الفاصلة المنقوطة — هذا الملف جملة واحدة فقط.

INSERT INTO pipeline_stages (tenant_id, name, color, position, is_default, is_booking)
SELECT ps.tenant_id, 'حجز', '#06B6D4', MAX(ps.position) + 1, false, true
FROM pipeline_stages ps
GROUP BY ps.tenant_id
HAVING NOT EXISTS (
  SELECT 1 FROM pipeline_stages b
  WHERE b.tenant_id = ps.tenant_id
    AND b.is_booking = true
)
ON CONFLICT (tenant_id, name) DO NOTHING;
