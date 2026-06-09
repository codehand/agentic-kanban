/**
 * stream.ts — SSE (Server-Sent Events) endpoint at /api/stream.
 *
 * Pushes task transition events to connected clients. The event bus is a
 * simple in-process EventEmitter; clients connect via EventSource.
 *
 * Event format:
 *   event: transition
 *   data: {"task_id":"...","from":"...","to":"...","actor_role":"human"}
 *
 * Also emits heartbeat pings to keep the connection alive.
 */
import { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'

export interface TransitionEvent {
  task_id: string
  from_state: string
  to_state: string
  actor_role: string
  at: string
}

/**
 * Singleton event bus for SSE broadcasts. Exported so routes.ts can emit
 * events after state changes.
 */
export const sseBus = new EventEmitter()
sseBus.setMaxListeners(100)

/** Set of currently connected SSE clients. */
const clients = new Set<ServerResponse>()

/**
 * Broadcast a transition event to all connected SSE clients.
 */
export function broadcastTransition(evt: TransitionEvent): void {
  const data = `event: transition\ndata: ${JSON.stringify(evt)}\n\n`
  for (const res of clients) {
    try {
      res.write(data)
    } catch {
      clients.delete(res)
    }
  }
  // Also emit on the bus for test listeners
  sseBus.emit('transition', evt)
}

/**
 * Read the full JSON body from a request.
 */
function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) { resolve(null); return }
      try { resolve(JSON.parse(raw)) } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

/**
 * Handle GET /api/stream — upgrade the response to SSE.
 * Sets headers, sends initial comment, registers client, sends heartbeats.
 */
export function handleSseStream(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  // Initial connection message
  res.write('event: connected\ndata: {}\n\n')

  clients.add(res)

  // Heartbeat every 30s to prevent proxy timeouts
  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n')
    } catch {
      clearInterval(heartbeat)
      clients.delete(res)
    }
  }, 30_000)

  _req.on('close', () => {
    clearInterval(heartbeat)
    clients.delete(res)
  })
}

/** Get the current number of connected SSE clients. */
export function getClientCount(): number {
  return clients.size
}

/** Clear all clients (for testing). */
export function _clearClients(): void {
  clients.clear()
}
