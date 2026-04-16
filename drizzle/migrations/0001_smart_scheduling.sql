-- =============================================
-- Migration: Smart Scheduling Engine
-- Run this on production database via Coolify
-- =============================================

-- 1. Add PROVIDER to user_role enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'PROVIDER';

-- 2. Add new activity actions
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'DEPARTMENT_CREATED';
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'DEPARTMENT_UPDATED';
ALTER TYPE activity_action ADD VALUE IF NOT EXISTS 'INTERNAL_MESSAGE';

-- 3. Create departments table
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#3B82F6',
  default_gap_minutes INTEGER NOT NULL DEFAULT 15,
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Create department_providers table (linking)
CREATE TABLE IF NOT EXISTS department_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Create provider_schedules table (weekly hours)
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
);

-- 6. Create provider_day_offs table
CREATE TABLE IF NOT EXISTS provider_day_offs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL,
  reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Create internal_messages table
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
);

-- 8. Add new columns to services table
ALTER TABLE services ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS default_duration_min INTEGER DEFAULT 30;

-- 9. Add new columns to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_resource_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_duration_min INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS booking_end_time TIMESTAMPTZ;
