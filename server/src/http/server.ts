/**
 * Minimal node:http server. No web framework.
 * Serves GET /healthz -> 200 {"status":"ok"}.
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config/index.js';
import { logger } from '../logger.js';

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

export function startServer(): void {
  const server = createServer(handleRequest);
  server.listen(config.port, () => {
    logger.info({ msg: 'Server started', port: config.port });
  });
}
