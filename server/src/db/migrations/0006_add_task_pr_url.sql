-- Migration 0006: add task.pr_url (TASK-051)
-- Nullable column holding the PR link recorded by the pr-bot when it moves a
-- task JUDGE_PASSED -> READY_TO_REVIEW. Existing rows keep NULL (no PR yet).

ALTER TABLE task ADD COLUMN pr_url TEXT;
