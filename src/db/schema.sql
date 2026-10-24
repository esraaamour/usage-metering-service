-- =============================================================================
-- @file schema.sql
-- @description Database Schema for the Metering Service.
-- Defines all PostgreSQL tables, constraints, indexes and seed data:
--   - plans:                quota templates (monthly allowance + max per request)
--   - accounts / users:     tenants and their end-users, each linked to a plan
--   - account_usage / user_usage: monthly consumption counters
--   - requests:             audit log and idempotency store for every decision
-- The script is idempotent (IF NOT EXISTS / ON CONFLICT), so it can safely run on every startup.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. PLANS TABLE
-- Defines service quotas and limits for both accounts and individual users.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid,
  scope text NOT NULL CHECK (scope IN ('account', 'user')),
  name text NOT NULL,
  monthly_allowance bigint NOT NULL CHECK (monthly_allowance >= 0),
  max_per_request bigint NOT NULL CHECK (max_per_request > 0),
  is_predefined boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, scope, name)
);

-- Ensures unique names for global predefined plans
-- (the UNIQUE constraint above does not catch duplicates when account_id is NULL)
CREATE UNIQUE INDEX IF NOT EXISTS plans_predefined_name
  ON plans (scope, name) WHERE account_id IS NULL;


-- -----------------------------------------------------------------------------
-- 2. ACCOUNTS TABLE
-- Represents the tenant/client organizations consuming the metering service.
-- API keys are securely stored as cryptographic hashes (SHA-256).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  api_key_hash text NOT NULL UNIQUE,
  plan_id uuid NOT NULL REFERENCES plans(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Safely add the foreign key constraint from plans to accounts if not already present
-- (added after accounts exists, because plans and accounts reference each other)
DO $$ BEGIN
  ALTER TABLE plans ADD CONSTRAINT plans_account_fk
    FOREIGN KEY (account_id) REFERENCES accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- -----------------------------------------------------------------------------
-- 3. USERS TABLE
-- Represents individual end-users belonging to a specific tenant account.
-- external_id is the identifier used by the client's own system.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  external_id text NOT NULL,
  plan_id uuid NOT NULL REFERENCES plans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_id)
);


-- -----------------------------------------------------------------------------
-- 4. USAGE COUNTERS (Account & User Level)
-- Tracks aggregated unit consumption per calendar month (UTC).
-- Separated from plans so that updating/switching plans never affects usage data.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_usage (
  account_id uuid NOT NULL REFERENCES accounts(id),
  month date NOT NULL,
  used bigint NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (account_id, month)
);

CREATE TABLE IF NOT EXISTS user_usage (
  user_id uuid NOT NULL REFERENCES users(id),
  month date NOT NULL,
  used bigint NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (user_id, month)
);


-- -----------------------------------------------------------------------------
-- 5. REQUESTS AUDIT & IDEMPOTENCY TABLE
-- Logs every decision (accepted or rejected) for auditing and retry safety.
-- Uses request_id to ensure idempotency and prevent double-charging on retries.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS requests (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  user_id uuid NOT NULL REFERENCES users(id),
  request_id text NOT NULL,
  units bigint NOT NULL CHECK (units > 0),
  month date NOT NULL,
  accepted boolean NOT NULL,
  reject_level text,
  reject_rule text,
  decision jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, request_id)
);

-- Indexes for fast historical queries and reporting
CREATE INDEX IF NOT EXISTS requests_history
  ON requests (account_id, month, id DESC);
CREATE INDEX IF NOT EXISTS requests_user_history
  ON requests (user_id, id DESC);


-- -----------------------------------------------------------------------------
-- 6. SEED DATA (Predefined Default Plans)
-- Inserts standard global starter and pro plans for accounts and users.
-- -----------------------------------------------------------------------------
INSERT INTO plans (scope, name, monthly_allowance, max_per_request, is_predefined)
VALUES
  ('account', 'Starter', 10000, 100, true),
  ('account', 'Pro', 1000000, 1000, true),
  ('user', 'Basic', 500, 20, true),
  ('user', 'Premium', 5000, 200, true)
ON CONFLICT DO NOTHING;
