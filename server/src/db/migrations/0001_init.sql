-- Migration 0001: initial schema
-- 7 tables per TASK_HUB_DESIGN.md §4.
-- evidence + transition are append-only (triggers block UPDATE/DELETE).
-- gitref is updatable (head_sha, mr_url).

-- --------------------------------------------------------------------------
-- project
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- task
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  key                   TEXT NOT NULL,              -- e.g. TASK-001, unique within project
  title                 TEXT NOT NULL,
  body_md               TEXT NOT NULL DEFAULT '',   -- spec: Purpose/Scope/AC/DoD
  state                 TEXT NOT NULL DEFAULT 'TODO',
  allow_no_code_change  INTEGER NOT NULL DEFAULT 0, -- boolean
  assignee_token_id     TEXT,                       -- NULL when unclaimed
  lease_until           TEXT,                       -- ISO8601, NULL when unclaimed
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_task_project_id ON task(project_id);
CREATE INDEX IF NOT EXISTS idx_task_state      ON task(state);

-- --------------------------------------------------------------------------
-- transition  (append-only audit log)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transition (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  from_state      TEXT NOT NULL,
  to_state        TEXT NOT NULL,
  actor_role      TEXT NOT NULL,
  actor_token_id  TEXT NOT NULL,
  note            TEXT,
  evidence_id     TEXT,           -- FK to evidence, nullable
  at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Block UPDATE on transition (append-only)
CREATE TRIGGER IF NOT EXISTS trg_transition_no_update
BEFORE UPDATE ON transition
BEGIN
  SELECT RAISE(ABORT, 'transition is append-only: UPDATE not allowed');
END;

-- Block DELETE on transition (append-only)
CREATE TRIGGER IF NOT EXISTS trg_transition_no_delete
BEFORE DELETE ON transition
BEGIN
  SELECT RAISE(ABORT, 'transition is append-only: DELETE not allowed');
END;

-- --------------------------------------------------------------------------
-- comment
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comment (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  author_role     TEXT NOT NULL,
  author_token_id TEXT NOT NULL,
  kind            TEXT NOT NULL,    -- 'narrative' | 'verdict' | 'review' | 'note'
  verdict         TEXT,             -- 'PASS' | 'REJECT' | NULL (only when kind='verdict')
  body_md         TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- --------------------------------------------------------------------------
-- evidence  (append-only; each row = one run; gate uses most recent)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence (
  id                    TEXT PRIMARY KEY,
  task_id               TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  submitted_by_token_id TEXT NOT NULL,   -- token MUST have role=runner
  build_exit            INTEGER NOT NULL,
  test_exit             INTEGER NOT NULL,
  lint_exit             INTEGER,         -- NULL when lint not run
  ac_exit               INTEGER NOT NULL,
  coverage_pct          REAL,            -- NULL when not measured
  -- TEXT JSON: {file: sha256} + log digests, immutable after insert.
  -- Sized for P4 checksum verify: contains hashes only, NOT raw log content.
  manifest_json         TEXT NOT NULL DEFAULT '{}',
  -- TEXT JSON: digest/path references for logs. NOT full log content.
  logs_json             TEXT NOT NULL DEFAULT '{}',
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Block UPDATE on evidence (append-only)
CREATE TRIGGER IF NOT EXISTS trg_evidence_no_update
BEFORE UPDATE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'evidence is append-only: UPDATE not allowed');
END;

-- Block DELETE on evidence (append-only)
CREATE TRIGGER IF NOT EXISTS trg_evidence_no_delete
BEFORE DELETE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'evidence is append-only: DELETE not allowed');
END;

-- --------------------------------------------------------------------------
-- gitref  (multi-row per task; updatable head_sha + mr_url)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gitref (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  repo       TEXT NOT NULL,    -- relative repo path, e.g. '.'
  branch     TEXT NOT NULL,
  base_sha   TEXT NOT NULL,
  head_sha   TEXT NOT NULL,
  mr_url     TEXT,             -- Draft MR URL, nullable until created
  mr_state   TEXT,             -- e.g. 'draft' | 'open' | 'merged' | NULL
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (task_id, repo)
);

-- --------------------------------------------------------------------------
-- token
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS token (
  id          TEXT PRIMARY KEY,
  role        TEXT NOT NULL,   -- 'human' | 'implementer' | 'self-check' | 'judge' | 'runner'
  project_id  TEXT,            -- NULL = all projects; scoped = only this project
  label       TEXT NOT NULL DEFAULT '',
  secret_hash TEXT NOT NULL,   -- bcrypt or sha256 hash of the bearer secret
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  revoked_at  TEXT             -- NULL = active
);
