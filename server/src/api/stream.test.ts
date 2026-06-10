/**
 * stream.test.ts — AC6 tests for SSE event emissions (TASK-017).
 *
 * Verifies:
 *   - broadcastCreated emits 'created' on sseBus and writes to SSE clients.
 *   - broadcastTransition emits 'transition' on sseBus and writes to SSE clients.
 *   - Both events carry the expected payload shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServerResponse } from 'node:http'
import {
  sseBus,
  broadcastCreated,
  broadcastTransition,
  handleSseStream,
  _clearClients,
  type CreatedEvent,
  type TransitionEvent,
} from './stream.js'

function makeFakeRes(): ServerResponse {
  const res = new ServerResponse({} as any)
  res.writeHead = vi.fn(() => res) as any
  res.write = vi.fn(() => true) as any
  res.on = vi.fn(() => res) as any
  res.addListener = vi.fn(() => res) as any
  return res
}

beforeEach(() => {
  _clearClients()
  sseBus.removeAllListeners()
})

describe('broadcastCreated', () => {
  it('emits "created" on sseBus with the event payload', () => {
    const listener = vi.fn()
    sseBus.on('created', listener)
    const evt: CreatedEvent = {
      task_id: 'task_t1',
      project_id: 'proj_p1',
      key: 'T-1',
      title: 'New Task',
      at: '2026-06-10T00:00:00Z',
    }
    broadcastCreated(evt)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(evt)
  })

  it('writes SSE "event: created" frame to connected clients', () => {
    const res = makeFakeRes()
    // Register client via handleSseStream
    const fakeReq: any = { on: vi.fn() }
    handleSseStream(fakeReq, res)

    broadcastCreated({
      task_id: 'task_x',
      project_id: 'proj_x',
      key: 'X-1',
      title: 'Hello',
      at: '2026-06-10T00:00:00Z',
    })

    // First write is the initial 'connected' event; second is our 'created'.
    const writes = (res.write as any).mock.calls.map((c: any[]) => c[0] as string)
    const createdFrame = writes.find((w: string) => w.startsWith('event: created'))
    expect(createdFrame).toBeDefined()
    expect(createdFrame).toContain('"task_id":"task_x"')
    expect(createdFrame).toContain('"key":"X-1"')
  })
})

describe('broadcastTransition', () => {
  it('emits "transition" on sseBus with the event payload', () => {
    const listener = vi.fn()
    sseBus.on('transition', listener)
    const evt: TransitionEvent = {
      task_id: 'task_t2',
      from_state: 'TODO',
      to_state: 'IN_PROGRESS',
      actor_role: 'implementer',
      at: '2026-06-10T00:00:00Z',
    }
    broadcastTransition(evt)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(evt)
  })

  it('writes SSE "event: transition" frame to connected clients', () => {
    const res = makeFakeRes()
    const fakeReq: any = { on: vi.fn() }
    handleSseStream(fakeReq, res)

    broadcastTransition({
      task_id: 'task_y',
      from_state: 'TODO',
      to_state: 'DONE',
      actor_role: 'human',
      at: '2026-06-10T00:00:00Z',
    })

    const writes = (res.write as any).mock.calls.map((c: any[]) => c[0] as string)
    const transitionFrame = writes.find((w: string) => w.startsWith('event: transition'))
    expect(transitionFrame).toBeDefined()
    expect(transitionFrame).toContain('"task_id":"task_y"')
    expect(transitionFrame).toContain('"to_state":"DONE"')
  })
})
