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
  // In-memory map of session-id → transport for stateful sessions.
  const transports = new Map<string, StreamableHTTPServerTransport>()

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

    // --- Build context + server -------------------------------------------
    const ctx: McpContext = { db, auth: resolved }
    const mcp = buildMcpServer(ctx)

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

        // Session routing: if the request carries an Mcp-Session-Id header,
        // look up the existing transport. Otherwise, if this is an
        // initialize request, create a new transport; else reject.
        const sessionId = req.headers['mcp-session-id']
        let transport: StreamableHTTPServerTransport | undefined

        if (typeof sessionId === 'string' && transports.has(sessionId)) {
          transport = transports.get(sessionId)!
        } else if (!sessionId && parsedBody && isInitializeRequest(parsedBody)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              transports.set(sid, transport!)
            },
          })
          transport.onclose = () => {
            const sid = transport?.sessionId
            if (sid) transports.delete(sid)
          }
          await mcp.connect(transport)
        } else {
          sendRpcError(res, 400, -32600, 'Missing or invalid Mcp-Session-Id header')
          return
        }

        await transport.handleRequest(req, res, parsedBody)
        return
      }

      if (method === 'GET') {
        // SSE stream for server-initiated notifications — requires session id.
        const sessionId = req.headers['mcp-session-id']
        if (typeof sessionId !== 'string' || !transports.has(sessionId)) {
          sendRpcError(res, 400, -32600, 'Missing or invalid Mcp-Session-Id for GET /mcp')
          return
        }
        const transport = transports.get(sessionId)!
        await transport.handleRequest(req, res)
        return
      }

      if (method === 'DELETE') {
        const sessionId = req.headers['mcp-session-id']
        if (typeof sessionId === 'string' && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!
          await transport.handleRequest(req, res)
          transports.delete(sessionId)
          return
        }
        sendRpcError(res, 400, -32600, 'Missing or invalid Mcp-Session-Id for DELETE /mcp')
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
