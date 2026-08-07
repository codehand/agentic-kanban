/**
 * mcp/server.ts — MCP server mounted on node:http at /mcp with bearer auth.
 *
 * Per TASK_HUB_DESIGN.md §2 and §6:
 *   - Transport: Streamable HTTP (no web framework, pure node:http).
 *   - Route: /mcp
 *   - Auth: Bearer token resolved via auth/resolve.ts.
 *   - Tools: registered via mcp/tools/*.ts — each handler validates input,
 *     authorizes the caller, and delegates to the domain layer.
 */

import { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { parseBearerHeader } from '../auth/parse.js'
import { resolveBearer, type ResolvedToken } from '../auth/resolve.js'
import type { Db } from '../db/connection.js'
import { registerReadTools, registerWriteTools } from './tools/index.js'
import type { McpContext } from './context.js'
import { logger } from '../logger.js'
import { logToolCall, resolveUsageLogDir, type UsageEvent } from './usagelog.js'

/** Minimal shape of a CallTool request we read identifying fields from. */
interface CallToolRequest {
  params?: { name?: unknown; arguments?: unknown }
}
/** Minimal shape of a CallTool result we inspect for success/failure. */
interface CallToolResult {
  isError?: boolean
  content?: unknown
}

/**
 * Classify a failed (isError) tool result: domain/authz/validation rejects are
 * 'rejected'; internal/system faults are 'error'. The MCP SDK turns thrown
 * errors into isError results, so the distinction is by message prefix.
 */
function classifyOutcome(text: string): UsageEvent['outcome'] {
  return /internal error|internal server error/i.test(text) ? 'error' : 'rejected'
}

/** Best-effort extraction of a tool result's text for logging. */
function errorTextOf(result: CallToolResult): string {
  const content = result.content
  if (Array.isArray(content)) {
    const text = content
      .map((c) => (c && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .filter(Boolean)
      .join(' ')
    if (text) return text
  }
  return 'tool error'
}

/**
 * Build a fully configured McpServer with all tools registered for the given
 * db + auth context. One McpServer per connection; tool handlers close over
 * the context.
 */
export function buildMcpServer(ctx: McpContext): McpServer {
  const mcp = new McpServer(
    { name: 'agentic-kanban', version: '0.1.0' },
    { capabilities: { logging: {} } },
  )

  // --- Single usage-log dispatch hook (TASK-028) -------------------------
  // The McpServer installs one CallTool request handler (lazily, on the first
  // registerTool) that does input validation + dispatch for EVERY tool. We
  // intercept setRequestHandler on the underlying low-level server so that, the
  // moment that handler is installed, it is wrapped with usage logging. This is
  // the single point that sees all tool calls — read and write, including those
  // rejected at input validation — without touching any individual handler.
  const lowServer = mcp.server as unknown as {
    setRequestHandler: (schema: unknown, handler: (req: unknown, extra: unknown) => unknown) => void
  }
  const originalSet = lowServer.setRequestHandler.bind(lowServer)
  lowServer.setRequestHandler = (schema, handler) => {
    const isCallTool =
      typeof (schema as { shape?: { method?: { value?: unknown } } })?.shape?.method?.value === 'string' &&
      (schema as { shape: { method: { value: string } } }).shape.method.value === 'tools/call'
    if (!isCallTool) {
      originalSet(schema, handler)
      return
    }
    originalSet(schema, async (req: unknown, extra: unknown) => {
      const start = Date.now()
      const params = (req as CallToolRequest).params ?? {}
      const tool = typeof params.name === 'string' ? params.name : 'unknown'
      // Only identifying fields are read from args; full args are never logged.
      const a = (params.arguments ?? {}) as Record<string, unknown>
      const project = typeof a.project === 'string' ? a.project : null
      const task_key = typeof a.key === 'string' ? a.key : null

      const emit = (outcome: UsageEvent['outcome'], error_message: string | null): void => {
        // Resolved per call so USAGE_LOG_DIR (incl. 'off') is honoured at runtime.
        const dir = resolveUsageLogDir(process.env['USAGE_LOG_DIR'])
        void logToolCall(dir, {
          ts: new Date().toISOString(),
          tool,
          role: ctx.auth.role,
          token_id: ctx.auth.token_id,
          project,
          task_key,
          outcome,
          error_message,
          duration_ms: Date.now() - start,
        })
      }

      try {
        const result = (await handler(req, extra)) as CallToolResult
        if (result && result.isError) {
          const msg = errorTextOf(result)
          emit(classifyOutcome(msg), msg)
        } else {
          emit('ok', null)
        }
        return result
      } catch (err) {
        // The SDK normally converts errors to isError results; a throw here is
        // a system-level fault.
        emit('error', err instanceof Error ? err.message : String(err))
        throw err
      }
    })
  }

  registerReadTools(mcp, ctx)
  registerWriteTools(mcp, ctx)
  return mcp
}

/**
 * Read the full request body as a string. Returns '' for requests with no
 * body (GET, DELETE).
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Send a JSON-RPC error response for /mcp when something fails before the
 * transport is set up (auth, body parse, etc.).
 */
function sendRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  })
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** A live Streamable HTTP session, bound to the token that opened it. */
interface Session {
  transport: StreamableHTTPServerTransport
  /** Token id from the InitializeRequest; later requests must present it. */
  token_id: string
}

/**
 * Reject a request that carries an Mcp-Session-Id this process does not know.
 *
 * This MUST be 404, not 400: the spec makes 404 the signal that a client's
 * session is gone and it has to open a new one with an InitializeRequest.
 * 400 reads as "malformed request", so a client can keep replaying a dead
 * session id forever — every tool call after a hub restart then fails until
 * the client process is restarted. The SDK's own transport draws the same
 * line (404/-32001 unknown id vs 400 missing header), so answering 400 here
 * also made this route disagree with the transport it wraps.
 */
function sendUnknownSession(res: ServerResponse): void {
  sendRpcError(res, 404, -32001, 'Session not found — reinitialize')
}

/**
 * Mount the /mcp route onto the existing node:http router.
 *
 * @param handle  The existing router function (req, res) => void.
 * @param db      Database connection.
 * @returns       A new router function that delegates to the original for
 *                non-/mcp routes.
 */
export function mountMcpRoute(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
  db: Db,
): (req: IncomingMessage, res: ServerResponse) => void {
  // In-memory map of session-id → session for stateful sessions.
  const sessions = new Map<string, Session>()

  /**
   * Resolve the transport for a session id presented by `token_id`.
   *
   * A session id belonging to a different token resolves to undefined — i.e.
   * it is treated exactly like an unknown one. Tool handlers close over the
   * auth context captured when the session was opened, so honouring another
   * token's session id would run the call with the opener's role.
   */
  function lookup(sessionId: unknown, token_id: string): StreamableHTTPServerTransport | undefined {
    if (typeof sessionId !== 'string') return undefined
    const session = sessions.get(sessionId)
    if (!session || session.token_id !== token_id) return undefined
    return session.transport
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/'
    const pathOnly = url.split('?')[0]

    if (pathOnly !== '/mcp' && pathOnly !== '/mcp/') {
      handle(req, res)
      return
    }

    // --- Bearer auth -------------------------------------------------------
    const secret = parseBearerHeader(req)
    if (!secret) {
      sendRpcError(res, 401, -32000, 'Missing or malformed Authorization: Bearer header')
      return
    }
    const resolved: ResolvedToken | undefined = resolveBearer(db, secret)
    if (!resolved) {
      sendRpcError(res, 401, -32001, 'Invalid or revoked bearer token')
      return
    }
    // SECURITY: do not log the bearer secret; log only the token id.
    logger.debug({ token_id: resolved.token_id, role: resolved.role }, 'mcp: authenticated')

    try {
      const method = (req.method ?? 'GET').toUpperCase()

      if (method === 'POST') {
        const rawBody = await readBody(req)
        let parsedBody: unknown = undefined
        if (rawBody.length > 0) {
          try {
            parsedBody = JSON.parse(rawBody)
          } catch {
            sendRpcError(res, 400, -32700, 'Invalid JSON body')
            return
          }
        }

        // Session routing: reuse this token's existing transport if the
        // request carries a live session id; otherwise open a new session for
        // an InitializeRequest; otherwise reject.
        const sessionId = req.headers['mcp-session-id']
        let transport = lookup(sessionId, resolved.token_id)

        if (!transport) {
          if (parsedBody && isInitializeRequest(parsedBody)) {
            // Deliberately permissive about a stale Mcp-Session-Id on an
            // initialize: the client is asking for a new session, and this is
            // the one recovery path that does not depend on the client acting
            // on the 404 above. Rejecting it would strand clients that replay
            // their dead id when reconnecting.
            const ctx: McpContext = { db, auth: resolved }
            const mcp = buildMcpServer(ctx)
            const created = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (sid) => {
                sessions.set(sid, { transport: created, token_id: resolved.token_id })
              },
            })
            created.onclose = () => {
              const sid = created.sessionId
              if (sid) sessions.delete(sid)
            }
            await mcp.connect(created)
            transport = created
          } else if (typeof sessionId === 'string') {
            sendUnknownSession(res)
            return
          } else {
            sendRpcError(res, 400, -32600, 'Missing Mcp-Session-Id header')
            return
          }
        }

        await transport.handleRequest(req, res, parsedBody)
        return
      }

      if (method === 'GET') {
        // SSE stream for server-initiated notifications — requires session id.
        const sessionId = req.headers['mcp-session-id']
        if (typeof sessionId !== 'string') {
          sendRpcError(res, 400, -32600, 'Missing Mcp-Session-Id for GET /mcp')
          return
        }
        const transport = lookup(sessionId, resolved.token_id)
        if (!transport) {
          sendUnknownSession(res)
          return
        }
        await transport.handleRequest(req, res)
        return
      }

      if (method === 'DELETE') {
        const sessionId = req.headers['mcp-session-id']
        if (typeof sessionId !== 'string') {
          sendRpcError(res, 400, -32600, 'Missing Mcp-Session-Id for DELETE /mcp')
          return
        }
        const transport = lookup(sessionId, resolved.token_id)
        if (!transport) {
          sendUnknownSession(res)
          return
        }
        await transport.handleRequest(req, res)
        sessions.delete(sessionId)
        return
      }

      sendRpcError(res, 405, -32600, `Method ${method} not allowed on /mcp`)
    } catch (err) {
      logger.error({ err }, 'mcp: unhandled error')
      if (!res.headersSent) {
        sendRpcError(res, 500, -32603, 'Internal server error')
      }
    }
  }
}

// Re-export for test use.
export { buildMcpServer as createMcpServer }
