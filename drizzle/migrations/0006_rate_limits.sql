CREATE TABLE IF NOT EXISTS "rate_limits" (
  "key" VARCHAR(200) PRIMARY KEY,
  "count" INTEGER NOT NULL DEFAULT 0,
  "reset_at" TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS "rate_limits_reset_idx" ON "rate_limits" ("reset_at");
