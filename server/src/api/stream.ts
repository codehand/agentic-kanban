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
 *     data: {"task_id":"...","key":"...","from_state":"...","to_state":"...","actor_role":"...","at":"..."}
 *   event: removed    — a task was deleted
 *     data: {"task_id":"...","project":"...","key":"...","at":"..."}
 *
 * Also emits heartbeat pings to keep the connection alive.
 */
import { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'

export interface TransitionEvent {
  task_id: string
  project: string
  key: string
  from_state: string
  to_state: string
  actor_role: string
  at: string
}

export interface RemovedEvent {
  task_id: string
  project: string
  key: string
  at: string
}

export interface CreatedEvent {
  task_id: string
  project_id: string
  project: string
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
 * Shared broadcast: write one SSE frame (`event: <name>` + JSON data) to every
 * connected client, dropping clients whose socket write throws, then emit the
 * same payload on sseBus so test listeners (and any in-process subscribers)
 * can observe it.
 */
function broadcast(name: 'created' | 'transition' | 'removed', evt: CreatedEvent | TransitionEvent | RemovedEvent): void {
  const data = `event: ${name}\ndata: ${JSON.stringify(evt)}\n\n`
  for (const res of clients) {
    try {
      res.write(data)
    } catch {
      clients.delete(res)
    }
  }
  sseBus.emit(name, evt)
}

/** Broadcast a created-task event to all connected SSE clients. */
export function broadcastCreated(evt: CreatedEvent): void {
  broadcast('created', evt)
}

/** Broadcast a transition event to all connected SSE clients. */
export function broadcastTransition(evt: TransitionEvent): void {
  broadcast('transition', evt)
}

/**
 * Broadcast a removed-task event to all connected SSE clients so live UIs
 * drop the card without a reload.
 */
export function broadcastRemoved(project: string, task_id: string, key: string): void {
  const evt: RemovedEvent = { task_id, project, key, at: new Date().toISOString() }
  broadcast('removed', evt)
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
