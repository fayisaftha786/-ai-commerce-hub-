CREATE TABLE IF NOT EXISTS discovery_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_tokens (
  session_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('youtube', 'meta')),
  encrypted_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_hash, provider)
);

CREATE INDEX IF NOT EXISTS social_tokens_provider_updated
  ON social_tokens (provider, updated_at);

CREATE TABLE IF NOT EXISTS oauth_pending_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('youtube', 'meta')),
  encrypted_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_pending_states_expiry
  ON oauth_pending_states (expires_at);
