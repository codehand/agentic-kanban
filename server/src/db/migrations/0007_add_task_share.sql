-- Migration 0007: read-only task share links (TASK-076)
-- A human mints a share link for ONE task; anyone holding the link can read
-- that task (no bearer) until expires_at. Only the SHA-256 hex of the token is
-- stored, never the raw token. No salt: the token carries >= 128 bits of
-- entropy and must be looked up by its hash.
--
-- expires_at NULL = never expires. Removing the task cascades, so its links die
-- with it.

CREATE TABLE IF NOT EXISTS task_share (
  token_hash TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_by TEXT NOT NULL REFERENCES token(id)
);

CREATE INDEX IF NOT EXISTS idx_task_share_task ON task_share(task_id);
