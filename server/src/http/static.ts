/**
 * static.ts — serve design-system/ static assets over node:http.
 *
 * Mounts the design-system/ directory at /. Maps common extensions to
 * Content-Type. Falls through to next router for non-matching paths.
 */
import { readFileSync, statSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { IncomingMessage, ServerResponse } from 'node:http'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
}

/**
 * Mount static file serving for design-system/ onto the existing router.
 * Requests that don't resolve to a file fall through to the original handle.
 */
export function mountStatic(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
  staticDir: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url ?? '/').split('?')[0]

    // Skip API and MCP routes — let them be handled by other mounts.
    if (url.startsWith('/api/') || url.startsWith('/mcp')) {
      handle(req, res)
      return
    }

    // Map "/" -> "/index.html"
    let relPath = url === '/' ? '/index.html' : url
    // Prevent path traversal
    if (relPath.includes('..')) {
      handle(req, res)
      return
    }
    const abs = join(staticDir, relPath)

    if (existsSync(abs)) {
      try {
        const stat = statSync(abs)
        if (stat.isFile()) {
          const ext = extname(abs)
          const contentType = MIME[ext] ?? 'application/octet-stream'
          const data = readFileSync(abs)
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': data.length,
          })
          res.end(data)
          return
        }
      } catch {
        // Fall through to next handler
      }
    }

    handle(req, res)
  }
}
