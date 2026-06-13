/**
 * dependency.ts — persistence for task_dependency edges (TASK-044).
 *
 * An edge (task_id, depends_on_task_id) means `task_id` depends on
 * `depends_on_task_id`: the dependent task cannot transition state until the
 * dependency reaches DONE. Edges live in the same project only (enforced by the
 * write layer, not the schema).
 */
import type { Db } from '../connection.js'

export interface DependencyRow {
  task_id: string
  depends_on_task_id: string
}

/** Return the task ids that `taskId` depends on. */
export function listDependencyIds(db: Db, taskId: string): string[] {
  return (
    db
      .prepare(`SELECT depends_on_task_id FROM task_dependency WHERE task_id = ? ORDER BY depends_on_task_id`)
      .all(taskId) as { depends_on_task_id: string }[]
  ).map((r) => r.depends_on_task_id)
}

/** Replace the full set of dependency edges for `taskId`. */
export function setDependencies(db: Db, taskId: string, dependsOn: string[]): void {
  const tx = db.transaction((ids: string[]) => {
    db.prepare(`DELETE FROM task_dependency WHERE task_id = ?`).run(taskId)
    const ins = db.prepare(
      `INSERT INTO task_dependency (task_id, depends_on_task_id) VALUES (?, ?)`,
    )
    for (const dep of ids) ins.run(taskId, dep)
  })
  tx(dependsOn)
}
