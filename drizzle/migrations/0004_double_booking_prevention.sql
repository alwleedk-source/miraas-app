CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_booking_no_overlap";
ALTER TABLE "leads" ADD CONSTRAINT "leads_booking_no_overlap" EXCLUDE USING gist (booking_resource_id WITH =, tenant_id WITH =, tstzrange(booking_date, booking_end_time, '[)') WITH &&) WHERE (booking_resource_id IS NOT NULL AND booking_date IS NOT NULL AND booking_end_time IS NOT NULL AND booking_status NOT IN ('CANCELLED', 'NO_RESPONSE'));
