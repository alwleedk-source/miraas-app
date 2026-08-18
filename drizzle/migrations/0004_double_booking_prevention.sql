CREATE EXTENSION IF NOT EXISTS btree_gist;
-- لا DROP CONSTRAINT هنا: المُهاجر يعتبر خطأ "already exists" حميداً، فالإضافة
-- المباشرة idempotent بدون قفل ACCESS EXCLUSIVE على جدول leads في كل إقلاع.
-- نص خطأ Postgres الفعلي: constraint "leads_booking_no_overlap" for relation "leads" already exists
ALTER TABLE "leads" ADD CONSTRAINT "leads_booking_no_overlap" EXCLUDE USING gist (booking_resource_id WITH =, tenant_id WITH =, tstzrange(booking_date, booking_end_time, '[)') WITH &&) WHERE (booking_resource_id IS NOT NULL AND booking_date IS NOT NULL AND booking_end_time IS NOT NULL AND booking_status NOT IN ('CANCELLED', 'NO_RESPONSE'));
