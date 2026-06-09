import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import type { Db } from '../db/connection.js'
import { mountMcpRoute } from '../mcp/server.js'
import { logger } from '../logger.js'

function handleHealthz(_req: IncomingMessage, res: ServerResponse): void {
  // Response body: {"status":"ok"}
  const body = '{"status":"ok"}'
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function baseRouter(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/'

  if (url === '/healthz' || url === '/healthz/') {
    handleHealthz(req, res)
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
}

export function createHttpServer(db?: Db) {
  // If a db is provided, mount the MCP route at /mcp on top of the base router.
  const router = db ? mountMcpRoute(baseRouter, db) : baseRouter
  return createServer(router)
}

export function startServer(port: number, db?: Db): Promise<void> {
  return new Promise((resolve) => {
    const server = createHttpServer(db)
    server.listen(port, () => {
      logger.info({ port }, 'HTTP server listening')
      resolve()
    })
  })
}
