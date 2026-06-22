/**
 * static-mcp-route.test.ts — B1 (TASK-059).
 *
 * The static router must route the MCP endpoint (`/mcp`, `/mcp/...`) to the
 * downstream handle, while project slugs that merely START WITH "mcp"
 * (e.g. `/mcp-verify/index.html`) must be served as static pages, not handed to
 * the API/MCP handler (which would 404 "not found" and make the project
 * unreachable in the web UI).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IncomingMessage, ServerResponse } from 'node:http'
import { mountStatic } from '../src/http/static.js'

let staticDir: string

beforeAll(() => {
  staticDir = mkdtempSync(join(tmpdir(), 'static-mcp-'))
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>home</title>')
  writeFileSync(join(staticDir, 'tasks.html'), '<!doctype html><title>tasks</title>')
})

afterAll(() => {
  rmSync(staticDir, { recursive: true, force: true })
})

/**
 * Drive the mounted handler for one URL. Returns whether it fell through to the
 * downstream `handle` (MCP/API) and, if served by static, the status written.
 */
function run(url: string): { fellThrough: boolean; staticStatus?: number } {
  let fellThrough = false
  const handle = () => { fellThrough = true }
  const mounted = mountStatic(handle, staticDir)

  let staticStatus: number | undefined
  const req = { url } as IncomingMessage
  const res = {
    writeHead(status: number) { staticStatus = status; return this },
    end() { return this },
  } as unknown as ServerResponse

  mounted(req, res)
  return { fellThrough, staticStatus }
}

describe('B1: /mcp static routing over-match', () => {
  it('serves a /mcp-prefixed project path as static, not the MCP/API handler', () => {
    // The first segment ("mcp-verify") is not a real file -> falls back to the
    // bare file (index.html), which exists, so static serves it (200) and does
    // NOT route to the MCP/API handler.
    const r = run('/mcp-verify/index.html')
    expect(r.fellThrough).toBe(false)
    expect(r.staticStatus).toBe(200)
  })

  it('serves a project slug literally "mcp-foo" as static', () => {
    const r = run('/mcp-foo/tasks.html')
    expect(r.fellThrough).toBe(false)
    expect(r.staticStatus).toBe(200)
  })

  it('routes exact /mcp to the MCP/API handler', () => {
    const r = run('/mcp')
    expect(r.fellThrough).toBe(true)
  })

  it('routes /mcp/ to the MCP/API handler', () => {
    const r = run('/mcp/')
    expect(r.fellThrough).toBe(true)
  })

  it('routes /mcp/anything to the MCP/API handler', () => {
    const r = run('/mcp/messages')
    expect(r.fellThrough).toBe(true)
  })
})
