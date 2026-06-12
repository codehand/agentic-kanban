-- Migration 0004: token.last_used_at (TASK-041)
-- Presence telemetry on the token row: set (throttled) on every successfully
-- authenticated request. NULL = the token was minted but never used.
-- This is NOT an audit log — the append-only usage JSONL (TASK-028) stays as is.
ALTER TABLE token ADD COLUMN last_used_at TEXT;
