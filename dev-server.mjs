// Dev launcher for aka-mcp (Agentic Kanban) — standalone, no package.json changes.
// Composes the public build output into one running process.
//   ADMIN_TOKEN=<secret> PORT=3000 DB_PATH=tasks.db node dev-server.mjs
// The bearer token to use everywhere = the ADMIN_TOKEN value you pass.
import { openDatabase } from './dist/db/connection.js'
import { runMigrations } from './dist/db/migrate.js'
import { bootstrapAdminToken } from './dist/auth/bootstrap.js'
import { startServer } from './dist/http/server.js'

const PORT = Number(process.env.PORT ?? 3000)
const DB_PATH = process.env.DB_PATH ?? 'tasks.db'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN

const db = openDatabase(DB_PATH)
runMigrations(db)
bootstrapAdminToken(db, ADMIN_TOKEN) // idempotent: bearer = ADMIN_TOKEN value

await startServer(PORT, db)
console.log(`\naka-mcp up:  http://127.0.0.1:${PORT}`)
console.log(`MCP:         http://127.0.0.1:${PORT}/mcp`)
console.log(`UI sign-in:  http://127.0.0.1:${PORT}/signin.html`)
console.log(`Bearer:      ${ADMIN_TOKEN ? '(your ADMIN_TOKEN value)' : 'NOT SET — pass ADMIN_TOKEN=... to log in'}\n`)

const shutdown = (sig) => { console.log(`\n${sig} — closing db`); try { db.close() } catch {} process.exit(0) }
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
