ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS archive_note TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS reactivate_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS can_recontact BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS leads_tenant_archived_idx ON leads (tenant_id, archived_at DESC) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_tenant_reason_idx ON leads (tenant_id, archive_reason, archived_at DESC) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_reactivate_idx ON leads (reactivate_at) WHERE reactivate_at IS NOT NULL AND archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_dnc_idx ON leads (tenant_id, can_recontact) WHERE can_recontact = false;
