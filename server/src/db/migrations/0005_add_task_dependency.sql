-- Migration 0005: task dependency edges (TASK-044)
-- A task may declare it depends on other tasks in the SAME project. State
-- transitions on the dependent task are blocked until every dependency is DONE.
--
-- (task_id, depends_on_task_id) is the dependency edge: task_id depends on
-- depends_on_task_id. Both FKs cascade on delete so removing a task drops its
-- edges (in both directions). Self-reference is forbidden by a CHECK.

CREATE TABLE IF NOT EXISTS task_dependency (
  task_id            TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_dependency_depends_on ON task_dependency(depends_on_task_id);
