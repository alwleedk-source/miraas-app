import { NextResponse } from "next/server";
import postgres from "postgres";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (token !== "meras_migrate_2026") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }

  const client = postgres(connectionString, { max: 1 });
  const results: string[] = [];

  try {
    // Run each statement individually to handle errors gracefully

    // 1. Add PROVIDER role
    try {
      await client.unsafe(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'PROVIDER'`);
      results.push("✅ Added PROVIDER role");
    } catch (e: unknown) {
      results.push(`⏭️ PROVIDER role: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Add activity actions
    try {
      await client.unsafe(`ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'DEPARTMENT_CREATED'`);
      await client.unsafe(`ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'DEPARTMENT_UPDATED'`);
      await client.unsafe(`ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'INTERNAL_MESSAGE'`);
      results.push("✅ Added activity actions");
    } catch (e: unknown) {
      results.push(`⏭️ Activity actions: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 3. Create departments table
    try {
      await client.unsafe(`
        CREATE TABLE IF NOT EXISTS departments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          color VARCHAR(20) NOT NULL DEFAULT '#3B82F6',
          default_gap_minutes INTEGER NOT NULL DEFAULT 15,
          position INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      results.push("✅ Created departments table");
    } catch (e: unknown) {
      results.push(`❌ departments: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 4. Create department_providers table
    try {
      await client.unsafe(`
        CREATE TABLE IF NOT EXISTS department_providers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      results.push("✅ Created department_providers table");
    } catch (e: unknown) {
      results.push(`❌ department_providers: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 5. Create provider_schedules table
    try {
      await client.unsafe(`
        CREATE TABLE IF NOT EXISTS provider_schedules (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          day_of_week INTEGER NOT NULL,
          start_time VARCHAR(5) NOT NULL,
          end_time VARCHAR(5) NOT NULL,
          break_start VARCHAR(5),
          break_end VARCHAR(5),
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      results.push("✅ Created provider_schedules table");
    } catch (e: unknown) {
      results.push(`❌ provider_schedules: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 6. Create provider_day_offs table
    try {
      await client.unsafe(`
        CREATE TABLE IF NOT EXISTS provider_day_offs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          date TIMESTAMPTZ NOT NULL,
          reason VARCHAR(255),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      results.push("✅ Created provider_day_offs table");
    } catch (e: unknown) {
      results.push(`❌ provider_day_offs: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 7. Create internal_messages table
    try {
      await client.unsafe(`
        CREATE TABLE IF NOT EXISTS internal_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          sender_role VARCHAR(20) NOT NULL,
          department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
          message_type VARCHAR(20) NOT NULL DEFAULT 'CUSTOM',
          content TEXT NOT NULL,
          is_read BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      results.push("✅ Created internal_messages table");
    } catch (e: unknown) {
      results.push(`❌ internal_messages: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 8. Add columns to services
    try {
      await client.unsafe(`ALTER TABLE services ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL`);
      await client.unsafe(`ALTER TABLE services ADD COLUMN IF NOT EXISTS default_duration_min INTEGER DEFAULT 30`);
      results.push("✅ Updated services table");
    } catch (e: unknown) {
      results.push(`⏭️ services columns: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 9. Add columns to leads
    try {
      await client.unsafe(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_department_id UUID REFERENCES departments(id) ON DELETE SET NULL`);
      await client.unsafe(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_resource_id UUID REFERENCES users(id) ON DELETE SET NULL`);
      await client.unsafe(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_duration_min INTEGER`);
      await client.unsafe(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_end_time TIMESTAMPTZ`);
      results.push("✅ Updated leads table");
    } catch (e: unknown) {
      results.push(`⏭️ leads columns: ${e instanceof Error ? e.message : String(e)}`);
    }

    await client.end();
    return NextResponse.json({ success: true, results });
  } catch (err) {
    await client.end();
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Migration failed",
    }, { status: 500 });
  }
}
