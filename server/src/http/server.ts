import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http'
import { resolve } from 'node:path'
import type { Db } from '../db/connection.js'
import { mountMcpRoute } from '../mcp/server.js'
import { mountApiRoutes } from '../api/routes.js'
import { mountStatic } from './static.js'
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
  let router: (req: IncomingMessage, res: ServerResponse) => void = baseRouter
  if (db) {
    // Mount order (outermost = highest priority):
    //   1. /api/* routes (JSON API + SSE)
    //   2. /mcp (MCP transport)
    //   3. static files (design-system/)
    //   4. base router (healthz + 404)
    const withApi = mountApiRoutes(baseRouter, db)
    const withMcp = mountMcpRoute(withApi, db)
    const staticDir = resolve(process.cwd(), 'design-system')
    router = mountStatic(withMcp, staticDir)
  }
  return createServer(router)
}

export function startServer(port: number, db?: Db): Promise<Server> {
  return new Promise((resolve) => {
    const server = createHttpServer(db)
    server.listen(port, () => {
      logger.info({ port }, 'HTTP server listening')
      resolve(server)
    })
  })
}
