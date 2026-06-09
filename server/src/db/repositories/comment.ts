import type { Db } from '../connection.js'

export type CommentKind = 'narrative' | 'verdict' | 'review' | 'note'
export type Verdict = 'PASS' | 'REJECT'

export interface Comment {
  id: string
  task_id: string
  author_role: string
  author_token_id: string
  kind: CommentKind
  verdict: Verdict | null
  body_md: string
  created_at: string
}

export interface NewComment {
  id: string
  task_id: string
  author_role: string
  author_token_id: string
  kind: CommentKind
  verdict?: Verdict
  body_md?: string
}

export function insertComment(db: Db, c: NewComment): Comment {
  db.prepare(`
    INSERT INTO comment (id, task_id, author_role, author_token_id, kind, verdict, body_md)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    c.id,
    c.task_id,
    c.author_role,
    c.author_token_id,
    c.kind,
    c.verdict ?? null,
    c.body_md ?? '',
  )

  return getCommentById(db, c.id)!
}

export function getCommentById(db: Db, id: string): Comment | undefined {
  return db
    .prepare(`SELECT * FROM comment WHERE id = ?`)
    .get(id) as Comment | undefined
}

export function listCommentsByTask(db: Db, taskId: string): Comment[] {
  return db
    .prepare(`SELECT * FROM comment WHERE task_id = ? ORDER BY created_at ASC`)
    .all(taskId) as Comment[]
}
