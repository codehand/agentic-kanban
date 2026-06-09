import type { Db } from '../connection.js'

export interface Project {
  id: string
  slug: string
  name: string
  created_at: string
}

export interface NewProject {
  id: string
  slug: string
  name: string
}

export function insertProject(db: Db, p: NewProject): Project {
  db.prepare(
    `INSERT INTO project (id, slug, name) VALUES (?, ?, ?)`,
  ).run(p.id, p.slug, p.name)

  return getProjectById(db, p.id)!
}

export function getProjectById(db: Db, id: string): Project | undefined {
  return db
    .prepare(`SELECT id, slug, name, created_at FROM project WHERE id = ?`)
    .get(id) as Project | undefined
}

export function getProjectBySlug(db: Db, slug: string): Project | undefined {
  return db
    .prepare(`SELECT id, slug, name, created_at FROM project WHERE slug = ?`)
    .get(slug) as Project | undefined
}

export function listProjects(db: Db): Project[] {
  return db
    .prepare(`SELECT id, slug, name, created_at FROM project ORDER BY created_at ASC`)
    .all() as Project[]
}
