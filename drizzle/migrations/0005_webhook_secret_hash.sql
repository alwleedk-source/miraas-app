ALTER TABLE "webhook_endpoints" ADD COLUMN IF NOT EXISTS "secret_hash" TEXT;
ALTER TABLE "webhook_endpoints" ADD COLUMN IF NOT EXISTS "secret_prefix" VARCHAR(12);
ALTER TABLE "webhook_endpoints" ALTER COLUMN "secret_key" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "webhook_endpoints_prefix_idx" ON "webhook_endpoints" ("secret_prefix");
