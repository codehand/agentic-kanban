/**
 * static.ts — serve design-system/ static assets over node:http.
 *
 * Mounts the design-system/ directory at /. Maps common extensions to
 * Content-Type. Falls through to next router for non-matching paths.
 *
 * Path-based project routing: '/<project-id>/<file>' serves
 * 'design-system/<file>' when the first segment is not a real file
 * (the segment is the project id; pages read it from the URL path).
 * '/<project-id>' and '/<project-id>/' map to index.html.
 * '/<project-id>/t/<KEY>' and '/t/<KEY>' map to task.html (TASK-073).
 * '/s/<token>' maps to share.html, the read-only share viewer (TASK-076).
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

const TASK_PAGE_RE = /^(?:\/[^/.]+)?\/t\/[^/.]+$/
const SHARE_PAGE_RE = /^\/s\/[^/.]+$/

function serveFile(abs: string, res: ServerResponse): boolean {
  if (!existsSync(abs)) return false
  try {
    const stat = statSync(abs)
    if (!stat.isFile()) return false
    const ext = extname(abs)
    const contentType = MIME[ext] ?? 'application/octet-stream'
    const data = readFileSync(abs)
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
    })
    res.end(data)
    return true
  } catch {
    return false
  }
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

    // Skip API, MCP and health routes — let them be handled by other mounts.
    // The MCP endpoint is exactly `/mcp` (and `/mcp/...`); match that segment
    // precisely so project slugs that merely start with "mcp" (e.g.
    // `/mcp-verify/index.html`) still serve their static pages.
    if (url.startsWith('/api/') || url === '/mcp' || url.startsWith('/mcp/') || url === '/healthz' || url.startsWith('/healthz/')) {
      handle(req, res)
      return
    }

    // Map "/" -> "/index.html"
    const relPath = url === '/' ? '/index.html' : url
    // Prevent path traversal
    if (relPath.includes('..')) {
      handle(req, res)
      return
    }

    // 1. Direct file match (e.g. /index.html, /theme.css).
    if (serveFile(join(staticDir, relPath), res)) return

    // 2. Full-screen task detail page (TASK-073): '/<project>/t/<KEY>' and
    //    bare '/t/<KEY>' serve task.html. <KEY> (and <project>) is exactly one
    //    segment with no '.', so '/<p>/t/<KEY>/extra', '/<p>/t/' and
    //    '/<p>/t/x.js' keep their old behaviour.
    if (TASK_PAGE_RE.test(relPath) && serveFile(join(staticDir, 'task.html'), res)) return

    // 2b. Read-only share viewer (TASK-076): '/s/<token>' (exactly one segment,
    //     no '.') serves share.html; the page itself validates the link via
    //     GET /api/share/<token>.
    if (SHARE_PAGE_RE.test(relPath) && serveFile(join(staticDir, 'share.html'), res)) return

    // 3. Project-prefixed path: strip the first segment when it is not a
    //    real file and has no extension (project ids never contain dots).
    //    '/<project>/index.html' -> 'index.html', '/<project>/' -> 'index.html'.
    const segments = relPath.split('/').filter(Boolean)
    if (segments.length >= 1 && !extname(segments[0]!)) {
      const rest = segments.slice(1).join('/') || 'index.html'
      if (serveFile(join(staticDir, rest), res)) return
    }

    handle(req, res)
  }
}
