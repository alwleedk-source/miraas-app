ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS pipeline_stages_tenant_archived_idx ON pipeline_stages (tenant_id, archived_at);
