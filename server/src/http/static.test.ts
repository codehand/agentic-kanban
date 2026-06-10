/**
 * static.test.ts — AC3 tests for path-based project routing (TASK-022).
 *
 * Verifies:
 *   - '/' and '/index.html' serve index.html directly.
 *   - '/<project>/index.html' serves index.html (project prefix stripped).
 *   - '/<project>' and '/<project>/' serve index.html.
 *   - '/<project>/theme.css' serves the asset with the right Content-Type.
 *   - /api/*, /mcp and /healthz fall through to the next handler.
 *   - Unknown deep paths and path traversal fall through (no file leak).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mountStatic } from './static.js'

const INDEX_BODY = '<!doctype html><title>board</title>INDEX_MARKER'
const TASKS_BODY = '<!doctype html><title>tasks</title>TASKS_MARKER'
const CSS_BODY = ':root { --x: 1; }'

let server: Server
let baseUrl: string
let staticDir: string

function fallthrough(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'fell-through' }))
}

beforeAll(async () => {
  staticDir = mkdtempSync(join(tmpdir(), 'static-test-'))
  writeFileSync(join(staticDir, 'index.html'), INDEX_BODY)
  writeFileSync(join(staticDir, 'tasks.html'), TASKS_BODY)
  writeFileSync(join(staticDir, 'theme.css'), CSS_BODY)

  server = createServer(mountStatic(fallthrough, staticDir))
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve())
  })
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
  rmSync(staticDir, { recursive: true, force: true })
})

describe('AC3: path-based project routing', () => {
  it('serves index.html at /', async () => {
    const res = await fetch(`${baseUrl}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(INDEX_BODY)
  })

  it('serves index.html at /index.html', async () => {
    const res = await fetch(`${baseUrl}/index.html`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(INDEX_BODY)
  })

  it('serves index.html at /<project>/index.html (prefix stripped)', async () => {
    const res = await fetch(`${baseUrl}/opf-hub/index.html`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toBe(INDEX_BODY)
  })

  it('serves index.html at /<project> and /<project>/', async () => {
    const bare = await fetch(`${baseUrl}/my-project`)
    expect(bare.status).toBe(200)
    expect(await bare.text()).toBe(INDEX_BODY)

    const slash = await fetch(`${baseUrl}/my-project/`)
    expect(slash.status).toBe(200)
    expect(await slash.text()).toBe(INDEX_BODY)
  })

  it('serves other pages under a project prefix', async () => {
    const res = await fetch(`${baseUrl}/opf-hub/tasks.html`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(TASKS_BODY)
  })

  it('serves assets under a project prefix with the right Content-Type', async () => {
    const res = await fetch(`${baseUrl}/opf-hub/theme.css`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/css')
    expect(await res.text()).toBe(CSS_BODY)
  })

  it('still serves assets at the root (absolute links)', async () => {
    const res = await fetch(`${baseUrl}/theme.css`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/css')
  })

  it('lets /api/*, /mcp and /healthz fall through', async () => {
    for (const path of ['/api/projects', '/mcp', '/healthz']) {
      const res = await fetch(`${baseUrl}${path}`)
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('fell-through')
    }
  })

  it('falls through for unknown deep paths', async () => {
    const res = await fetch(`${baseUrl}/a/b/c.html`)
    expect(res.status).toBe(404)
  })

  it('blocks path traversal', async () => {
    // fetch() normalizes "..", so issue the raw request over http.
    const { request } = await import('node:http')
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${baseUrl}`, { path: '/opf-hub/..%2F..%2Fetc%2Fpasswd' }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(404)
  })
})
