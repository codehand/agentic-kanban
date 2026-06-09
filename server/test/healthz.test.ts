import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, Server, IncomingMessage } from 'node:http'
import { createHttpServer } from '../src/http/server.js'

describe('GET /healthz', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    server = createHttpServer()
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
  })

  it('returns 200 with status ok', async () => {
    const res = await fetch(`${baseUrl}/healthz`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toEqual({ status: 'ok' })
  })

  it('returns JSON content-type', async () => {
    const res = await fetch(`${baseUrl}/healthz`)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
  })

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`${baseUrl}/unknown-route`)
    expect(res.status).toBe(404)
  })
})
