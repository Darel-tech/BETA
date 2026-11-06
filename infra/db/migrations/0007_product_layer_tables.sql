-- 0007_product_layer_tables.sql
-- New schema additions for BETA product layer (Auth, Chat Sessions, Check Runs, Usage, Audit, Rate Counters)
-- Strictly additive; does NOT modify or drop existing tables.

-- 1. app_profiles: Application profile extending auth users (role, status, consent, daily limit)
CREATE TABLE IF NOT EXISTS app_profiles (
  user_id              TEXT PRIMARY KEY,
  role                 TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'invited')),
  consent_at           TIMESTAMPTZ,
  consent_version      TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  daily_check_limit    INT NOT NULL DEFAULT 100,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. auth_config: Dynamic server-side auth configuration (signup mode, allowed domains, providers)
CREATE TABLE IF NOT EXISTS auth_config (
  key                  TEXT PRIMARY KEY,
  value                JSONB NOT NULL,
  updated_by           TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed initial auth_config keys if not present
INSERT INTO auth_config (key, value)
VALUES 
  ('signup_mode', '"open"'::jsonb),
  ('allowed_domains', 'null'::jsonb),
  ('providers', '{"google": true, "password": true}'::jsonb),
  ('landing_route.user', '"/chat"'::jsonb),
  ('landing_route.admin', '"/admin"'::jsonb),
  ('session_ttl_hours', '168'::jsonb),
  ('checks_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3. chat_sessions: User chat sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              TEXT NOT NULL,
  title                TEXT,
  source               TEXT NOT NULL DEFAULT 'local-gemma',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions (user_id, created_at DESC);

-- 4. chat_messages: User & assistant messages with verdict attribution
CREATE TABLE IF NOT EXISTS chat_messages (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role                 TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content              TEXT NOT NULL,
  verdict              TEXT,
  confidence           REAL,
  evidence             JSONB,
  check_run_id         UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, created_at ASC);

-- 5. check_runs: Detailed trace of live pipeline executions for judges & inspectors
CREATE TABLE IF NOT EXISTS check_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              TEXT,
  source               TEXT NOT NULL,
  verdict              TEXT,
  confidence           REAL,
  latency_ms           INT,
  stages               JSONB NOT NULL DEFAULT '[]'::jsonb,
  est_cost_usd         NUMERIC(10, 6) DEFAULT 0.0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_check_runs_created ON check_runs (created_at DESC);

-- 6. usage_events: Anonymized / aggregate audit stream for admin usage analytics
CREATE TABLE IF NOT EXISTS usage_events (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              TEXT,
  event                TEXT NOT NULL,
  meta                 JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_time ON usage_events (user_id, created_at DESC);

-- 7. audit_log: Immutable audit log for administrative actions & content reviews
CREATE TABLE IF NOT EXISTS audit_log (
  id                   BIGSERIAL PRIMARY KEY,
  actor_id             TEXT NOT NULL,
  action               TEXT NOT NULL,
  target               TEXT,
  meta                 JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);

-- 8. rate_counters: Database-backed distributed rate limiter
CREATE TABLE IF NOT EXISTS rate_counters (
  bucket               TEXT NOT NULL,
  window_start         TIMESTAMPTZ NOT NULL,
  count                INT NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
