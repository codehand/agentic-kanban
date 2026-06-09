-- Migration 0001: initial schema
-- Creates all 7 tables per TASK_HUB_DESIGN.md §4

CREATE TABLE IF NOT EXISTS project (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          INTEGER NOT NULL REFERENCES project(id),
  key                 TEXT    NOT NULL,
  title               TEXT    NOT NULL,
  body_md             TEXT    NOT NULL DEFAULT '',
  state               TEXT    NOT NULL DEFAULT 'TODO',
  allow_no_code_change INTEGER NOT NULL DEFAULT 0,
  assignee_token_id   INTEGER REFERENCES token(id),
  lease_until         TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, key)
);

CREATE TABLE IF NOT EXISTS transition (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES task(id),
  from_state     TEXT,
  to_state       TEXT    NOT NULL,
  actor_role     TEXT    NOT NULL,
  actor_token_id INTEGER REFERENCES token(id),
  note           TEXT,
  evidence_id    INTEGER REFERENCES evidence(id),
  at             TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comment (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES task(id),
  author_role    TEXT    NOT NULL,
  author_token_id INTEGER REFERENCES token(id),
  kind           TEXT    NOT NULL CHECK(kind IN ('narrative','verdict','review','note')),
  verdict        TEXT    CHECK(verdict IN ('PASS','REJECT') OR verdict IS NULL),
  body_md        TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evidence (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id              INTEGER NOT NULL REFERENCES task(id),
  submitted_by_token_id INTEGER NOT NULL REFERENCES token(id),
  build_exit           INTEGER NOT NULL,
  test_exit            INTEGER NOT NULL,
  lint_exit            INTEGER,
  ac_exit              INTEGER,
  coverage_pct         REAL,
  manifest_json        TEXT    NOT NULL DEFAULT '{}',
  logs_json            TEXT    NOT NULL DEFAULT '{}',
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gitref (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES task(id),
  repo       TEXT    NOT NULL,
  branch     TEXT    NOT NULL,
  base_sha   TEXT    NOT NULL,
  head_sha   TEXT,
  mr_url     TEXT,
  mr_state   TEXT,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS token (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  role        TEXT    NOT NULL,
  project_id  INTEGER REFERENCES project(id),
  label       TEXT    NOT NULL,
  secret_hash TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_task_project_id ON task(project_id);
CREATE INDEX IF NOT EXISTS idx_task_state       ON task(state);

-- Append-only triggers: block UPDATE and DELETE on evidence and transition
CREATE TRIGGER IF NOT EXISTS prevent_update_evidence
BEFORE UPDATE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'evidence rows are append-only: UPDATE not allowed');
END;

CREATE TRIGGER IF NOT EXISTS prevent_delete_evidence
BEFORE DELETE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'evidence rows are append-only: DELETE not allowed');
END;

CREATE TRIGGER IF NOT EXISTS prevent_update_transition
BEFORE UPDATE ON transition
BEGIN
  SELECT RAISE(ABORT, 'transition rows are append-only: UPDATE not allowed');
END;

CREATE TRIGGER IF NOT EXISTS prevent_delete_transition
BEFORE DELETE ON transition
BEGIN
  SELECT RAISE(ABORT, 'transition rows are append-only: DELETE not allowed');
END;
