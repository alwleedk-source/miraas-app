import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, connect_timeout: 10 });

async function migrate() {
  console.log("🔄 Running database migrations...");

  // Create enums
  await sql.unsafe(`
    DO $$ BEGIN
      CREATE TYPE user_role AS ENUM ('SUPER_ADMIN','OWNER','ADMIN','COORDINATOR');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE tenant_status AS ENUM ('ACTIVE','SUSPENDED','TRIAL');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE tenant_plan AS ENUM ('TRIAL','STARTER','PROFESSIONAL','ENTERPRISE');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE lead_priority AS ENUM ('LOW','MEDIUM','HIGH','URGENT');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE follow_up_type AS ENUM ('CALL','MESSAGE','MEETING','EMAIL','WHATSAPP','NOTE');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE activity_action AS ENUM ('LEAD_CREATED','LEAD_UPDATED','LEAD_ASSIGNED','LEAD_STAGE_CHANGED','LEAD_DELETED','FOLLOW_UP_CREATED','USER_CREATED','USER_UPDATED','SETTINGS_UPDATED','WEBHOOK_RECEIVED','WHATSAPP_SENT','WHATSAPP_FAILED');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE notification_type AS ENUM ('NEW_LEAD','LEAD_ASSIGNED','FOLLOW_UP_REMINDER','SYSTEM');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE booking_status AS ENUM ('PENDING','COMPLETED','ATTENDED_NOT_SUITABLE','CANCELLED','NO_RESPONSE','POSTPONED');
    EXCEPTION WHEN duplicate_object THEN null; END $$;
  `);

  // Create tables
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      logo_url TEXT,
      plan tenant_plan NOT NULL DEFAULT 'TRIAL',
      status tenant_status NOT NULL DEFAULT 'ACTIVE',
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      email_verified BOOLEAN NOT NULL DEFAULT false,
      image TEXT,
      role user_role NOT NULL DEFAULT 'COORDINATOR',
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      access_token_expires_at TIMESTAMPTZ,
      refresh_token_expires_at TIMESTAMPTZ,
      scope TEXT,
      id_token TEXT,
      password TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS verifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      color VARCHAR(20) NOT NULL DEFAULT '#3B82F6',
      position INTEGER NOT NULL DEFAULT 0,
      is_default BOOLEAN NOT NULL DEFAULT false,
      is_exclusive BOOLEAN NOT NULL DEFAULT false,
      is_booking BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS lead_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      platform VARCHAR(100),
      campaign_id VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
      source_id UUID REFERENCES lead_sources(id) ON DELETE SET NULL,
      stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(50),
      email VARCHAR(255),
      company VARCHAR(255),
      priority lead_priority NOT NULL DEFAULT 'MEDIUM',
      custom_fields JSONB DEFAULT '{}',
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      welcome_sent_at TIMESTAMPTZ,
      booking_status booking_status,
      booking_date TIMESTAMPTZ,
      booking_service VARCHAR(255),
      booking_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type follow_up_type NOT NULL DEFAULT 'NOTE',
      notes TEXT,
      attachments JSONB DEFAULT '[]',
      scheduled_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS whatsapp_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
      api_key_encrypted TEXT,
      phone_number VARCHAR(50),
      provider VARCHAR(50) DEFAULT 'meta',
      template_name VARCHAR(255),
      template_language VARCHAR(10) DEFAULT 'ar',
      template_params JSONB DEFAULT '["name"]',
      is_active BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      secret_key VARCHAR(64) NOT NULL,
      label VARCHAR(255) DEFAULT 'Google Sheets',
      is_active BOOLEAN NOT NULL DEFAULT true,
      send_welcome BOOLEAN NOT NULL DEFAULT true,
      last_received_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      color VARCHAR(20) NOT NULL DEFAULT '#6B7280',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tag_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action activity_action NOT NULL,
      entity_type VARCHAR(50),
      entity_id UUID,
      details JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type notification_type NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  console.log("✅ All tables created successfully!");

  // Safe ALTER for existing databases — run each separately
  const alters = [
    "ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS is_booking BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_status booking_status",
    "ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_date TIMESTAMPTZ",
    "ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_service VARCHAR(255)",
    "ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_notes TEXT",
  ];

  for (const alter of alters) {
    try {
      await sql.unsafe(alter);
      console.log("  ✅", alter.split("ADD COLUMN")[1]?.trim() || alter);
    } catch (e) {
      console.warn("  ⚠️ ALTER skipped:", e.message);
    }
  }

  console.log("✅ Migration complete!");
  await sql.end();
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err.message);
  process.exit(0); // Don't crash the app
});
