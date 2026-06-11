// Dev launcher for aka-mcp (Agentic Kanban).
//   ADMIN_TOKEN=<secret> PORT=3000 DB_PATH=tasks.db node dev-server.mjs
// The bearer token to use everywhere = the ADMIN_TOKEN value you pass.
//
// Bootstrap + graceful shutdown live in the production entry (dist/index.js);
// this launcher reuses them (no duplicated bootstrap logic) and just prints a
// friendly banner for local dev.
import { runServer, installSignalHandlers } from './dist/index.js'

const PORT = Number(process.env.PORT ?? 3000)
const DB_PATH = process.env.DB_PATH ?? 'tasks.db'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN

const running = await runServer({ port: PORT, dbPath: DB_PATH, adminToken: ADMIN_TOKEN })
installSignalHandlers(running)

console.log(`\naka-mcp up:  http://127.0.0.1:${PORT}`)
console.log(`MCP:         http://127.0.0.1:${PORT}/mcp`)
console.log(`UI sign-in:  http://127.0.0.1:${PORT}/signin.html`)
console.log(`Bearer:      ${ADMIN_TOKEN ? '(your ADMIN_TOKEN value)' : 'NOT SET — pass ADMIN_TOKEN=... to log in'}\n`)
