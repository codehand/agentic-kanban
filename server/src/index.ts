/**
 * index.ts — production entry point for the Agentic Kanban (aka-mcp) Task Hub.
 *
 * Boots the full process (DB → migrations → admin bootstrap → HTTP server) and
 * installs a graceful shutdown handler. This is the single source of bootstrap
 * logic; dev-server.mjs re-uses bootstrap()/runServer() from here.
 *
 * Env:
 *   PORT         HTTP port (default 3000)
 *   DB_PATH      SQLite database file (default tasks.db)
 *   ADMIN_TOKEN  bearer secret for the human/admin token (bootstrap; optional
 *                if a human token already exists from a previous run)
 *
 * Run:  ADMIN_TOKEN=secret PORT=3000 DB_PATH=tasks.db node dist/index.js
 *       (or: pnpm start)
 */
import type { Server } from 'node:http'
import { openDatabase, type Db } from './db/connection.js'
import { runMigrations } from './db/migrate.js'
import { bootstrapAdminToken } from './auth/bootstrap.js'
import { startServer } from './http/server.js'
import { closeAllClients } from './api/stream.js'
import { logger } from './logger.js'

export interface RunningServer {
  server: Server
  db: Db
  port: number
}

/**
 * Open + migrate + bootstrap the database, then start the HTTP server.
 * Returns the running handles so the caller (and tests) can shut it down.
 */
export async function runServer(opts: {
  port: number
  dbPath: string
  adminToken: string | undefined
}): Promise<RunningServer> {
  const db = openDatabase(opts.dbPath)
  runMigrations(db)
  bootstrapAdminToken(db, opts.adminToken) // idempotent: bearer = ADMIN_TOKEN value
  const server = await startServer(opts.port, db)
  return { server, db, port: opts.port }
}

/**
 * Graceful shutdown in resource-dependency order:
 *   1. close SSE clients   — release long-lived event-stream sockets first
 *   2. close HTTP server   — stop accepting new connections, drain in-flight
 *   3. close DB            — flush WAL + release the file handle last
 * Never tears down the DB while requests may still be touching it.
 */
export async function shutdown(running: RunningServer): Promise<void> {
  // 1. SSE clients — end every event stream so the HTTP server can close.
  closeAllClients()

  // 2. HTTP server — stop accepting requests and wait for in-flight to finish.
  await new Promise<void>((resolve) => {
    running.server.close(() => resolve())
  })

  // 3. DB — flush + release the file handle after no request can use it.
  try {
    running.db.close()
  } catch {
    // already closed — ignore
  }
}

/**
 * Wire SIGTERM/SIGINT to a single-shot graceful shutdown that exits 0.
 */
export function installSignalHandlers(running: RunningServer): void {
  let shuttingDown = false
  const handle = (sig: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ sig }, 'shutdown signal received — draining')
    shutdown(running)
      .then(() => {
        logger.info('graceful shutdown complete')
        process.exit(0)
      })
      .catch((err) => {
        logger.error({ err }, 'error during shutdown')
        process.exit(1)
      })
  }
  process.on('SIGTERM', () => handle('SIGTERM'))
  process.on('SIGINT', () => handle('SIGINT'))
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000)
  const dbPath = process.env.DB_PATH ?? 'tasks.db'
  const adminToken = process.env.ADMIN_TOKEN

  const running = await runServer({ port, dbPath, adminToken })
  installSignalHandlers(running)

  logger.info(
    { url: `http://127.0.0.1:${port}`, mcp: `http://127.0.0.1:${port}/mcp` },
    'aka-mcp up',
  )
}

// Run only when invoked directly (node dist/index.js), not when imported.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`
if (invokedDirectly) {
  main().catch((err) => {
    logger.error({ err }, 'fatal: failed to start server')
    process.exit(1)
  })
}
