CREATE TABLE IF NOT EXISTS "error_log" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "level" VARCHAR(10) NOT NULL,
  "message" TEXT NOT NULL,
  "error_name" VARCHAR(100),
  "error_stack" TEXT,
  "context" JSONB DEFAULT '{}'::jsonb,
  "url" TEXT,
  "fingerprint" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "error_log_tenant_created_idx" ON "error_log" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "error_log_fingerprint_idx" ON "error_log" ("fingerprint", "created_at");
