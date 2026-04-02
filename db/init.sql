-- Clashero PostgreSQL schema
-- Runs automatically on first docker-compose up

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Clashes ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clashes (
  guid          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  id            TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open',
  priority      TEXT NOT NULL DEFAULT 'none',
  rule_id       TEXT NOT NULL DEFAULT '',
  ifc_guid_a    TEXT NOT NULL DEFAULT '',
  ifc_guid_b    TEXT NOT NULL DEFAULT '',
  file_a        TEXT NOT NULL DEFAULT '',
  file_b        TEXT NOT NULL DEFAULT '',
  midpoint      JSONB NOT NULL DEFAULT '[0,0,0]',
  viewpoint     JSONB NOT NULL DEFAULT '{}',
  assignee      TEXT,
  labels        JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at   TIMESTAMPTZ,
  creation_author TEXT,
  linear_issue_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_clashes_status ON clashes(status);
CREATE INDEX IF NOT EXISTS idx_clashes_priority ON clashes(priority);
CREATE INDEX IF NOT EXISTS idx_clashes_rule_id ON clashes(rule_id);

-- ── Activity ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  clash_guid  TEXT NOT NULL REFERENCES clashes(guid) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  field       TEXT,
  from_value  TEXT,
  to_value    TEXT,
  body        TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_clash ON activity(clash_guid);

-- ── Comments ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  clash_guid  TEXT NOT NULL REFERENCES clashes(guid) ON DELETE CASCADE,
  actor       TEXT NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  body        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_clash ON comments(clash_guid);

-- ── Snapshots ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS snapshots (
  clash_guid    TEXT PRIMARY KEY REFERENCES clashes(guid) ON DELETE CASCADE,
  snapshot_path TEXT NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── IFC Models ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ifc_models (
  filename      TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  element_count INTEGER NOT NULL DEFAULT 0,
  parsed_at     TIMESTAMPTZ
);

-- ── IFC Elements ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ifc_elements (
  id              SERIAL PRIMARY KEY,
  model_filename  TEXT NOT NULL REFERENCES ifc_models(filename) ON DELETE CASCADE,
  express_id      INTEGER NOT NULL,
  global_id       TEXT NOT NULL,
  ifc_type        TEXT NOT NULL,
  name            TEXT,
  description     TEXT,
  properties      JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_elements_model ON ifc_elements(model_filename);
CREATE INDEX IF NOT EXISTS idx_elements_global_id ON ifc_elements(global_id);

-- ── Linear Settings ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS linear_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1) DEFAULT 1,
  access_token  TEXT NOT NULL,
  workspace_id  TEXT NOT NULL DEFAULT '',
  team_id       TEXT NOT NULL DEFAULT '',
  project_id    TEXT NOT NULL DEFAULT ''
);

-- ── Auth.js ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  name           TEXT,
  email          TEXT UNIQUE,
  email_verified TIMESTAMPTZ,
  image          TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                 TEXT NOT NULL,
  provider             TEXT NOT NULL,
  provider_account_id  TEXT NOT NULL,
  refresh_token        TEXT,
  access_token         TEXT,
  expires_at           BIGINT,
  token_type           TEXT,
  scope                TEXT,
  id_token             TEXT,
  session_state        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(provider, provider_account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  session_token TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT NOT NULL,
  token      TEXT NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- ── Organizations + Integrations ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  auth0_org_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_auth0_org_id_key
  ON organizations(auth0_org_id)
  WHERE auth0_org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_memberships (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_memberships_unique ON organization_memberships(organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON organization_memberships(user_id);

CREATE TABLE IF NOT EXISTS integration_connections (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'disconnected',
  secret          TEXT,
  data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_integrations_org ON integration_connections(organization_id);
