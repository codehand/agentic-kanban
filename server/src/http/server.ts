import { createServer, IncomingMessage, ServerResponse } from 'node:http'
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

function router(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/'

  if (url === '/healthz' || url === '/healthz/') {
    handleHealthz(req, res)
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
}

export function createHttpServer() {
  return createServer(router)
}

export function startServer(port: number): Promise<void> {
  return new Promise((resolve) => {
    const server = createHttpServer()
    server.listen(port, () => {
      logger.info({ port }, 'HTTP server listening')
      resolve()
    })
  })
}
