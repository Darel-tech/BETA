-- Auth database schema for BETA
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT    NOT NULL,
  role            TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  email_verified  INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Email verification tokens ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Password reset tokens ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Rate limiting ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 1,
  window_start TEXT   NOT NULL DEFAULT (datetime('now')),
  UNIQUE(key, action)
);

-- ── Rate Limit Settings (Admin Configurable) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_configs (
  action         TEXT PRIMARY KEY,
  max_attempts   INTEGER NOT NULL,
  window_seconds INTEGER NOT NULL,
  description    TEXT
);

-- ── Sessions (refresh token store) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT    NOT NULL UNIQUE,
  remember_me     INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── System Audit Logs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  level       TEXT NOT NULL DEFAULT 'info',     -- info, warn, error, security
  category    TEXT NOT NULL,                    -- auth, rate_limit, admin, api
  message     TEXT NOT NULL,
  user_id     INTEGER,
  ip_address  TEXT,
  metadata    TEXT,                             -- JSON string
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Hallucination & Query Audit Logs ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS query_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER,
  question         TEXT NOT NULL,
  source_model     TEXT NOT NULL,
  verdict          TEXT NOT NULL,               -- trustworthy, uncertain, needs_correction
  confidence       REAL,
  evidence_count   INTEGER DEFAULT 0,
  latency_ms       INTEGER,
  was_corrected    INTEGER DEFAULT 0,
  corrected_answer TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default Rate Limit Settings
INSERT OR IGNORE INTO rate_limit_configs (action, max_attempts, window_seconds, description) VALUES
  ('login', 5, 300, 'User and admin login attempts per 5 minutes'),
  ('otp_send', 3, 600, 'Email verification OTP requests per 10 minutes'),
  ('otp_verify', 10, 300, 'OTP submission validation checks per 5 minutes'),
  ('reset_send', 3, 600, 'Password reset email requests per 10 minutes'),
  ('reset_verify', 10, 300, 'Password reset OTP verification checks per 5 minutes');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email       ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username    ON users(username);
CREATE INDEX IF NOT EXISTS idx_ev_user           ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_pr_user           ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_hash     ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_rl_key            ON rate_limits(key, action);
CREATE INDEX IF NOT EXISTS idx_sys_logs_cat      ON system_logs(category, created_at);
CREATE INDEX IF NOT EXISTS idx_query_logs_verdict ON query_logs(verdict, created_at);
