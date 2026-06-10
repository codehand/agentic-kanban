-- Migration 0003: add task attributes (TASK-021)
-- Adds 5 new columns to the task table for richer task metadata.
-- All columns have safe defaults so existing rows are preserved.

ALTER TABLE task ADD COLUMN priority TEXT;
ALTER TABLE task ADD COLUMN complexity TEXT;
ALTER TABLE task ADD COLUMN estimate_hours REAL;
ALTER TABLE task ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE task ADD COLUMN link_document TEXT;
