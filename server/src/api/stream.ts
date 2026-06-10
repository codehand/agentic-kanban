/**
 * stream.ts — SSE (Server-Sent Events) endpoint at /api/stream.
 *
 * Pushes task events to connected clients. The event bus is a simple
 * in-process EventEmitter; clients connect via EventSource.
 *
 * Event types:
 *   event: created    — a new task was inserted
 *     data: {"task_id":"...","project_id":"...","key":"...","title":"...","at":"..."}
 *   event: transition — a task changed state
 *     data: {"task_id":"...","from_state":"...","to_state":"...","actor_role":"...","at":"..."}
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

export interface CreatedEvent {
  task_id: string
  project_id: string
  key: string
  title: string
  at: string
}

/**
 * Singleton event bus for SSE broadcasts. Exported so routes.ts and the MCP
 * write path can emit events after state changes. Tests can subscribe to
 * 'created' and 'transition' to verify emissions.
 */
export const sseBus = new EventEmitter()
sseBus.setMaxListeners(100)

/** Set of currently connected SSE clients. */
const clients = new Set<ServerResponse>()

/**
 * Broadcast a created-task event to all connected SSE clients and emit on
 * the bus so test listeners (and any in-process subscribers) can observe it.
 */
export function broadcastCreated(evt: CreatedEvent): void {
  const data = `event: created\ndata: ${JSON.stringify(evt)}\n\n`
  for (const res of clients) {
    try {
      res.write(data)
    } catch {
      clients.delete(res)
    }
  }
  sseBus.emit('created', evt)
}

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
