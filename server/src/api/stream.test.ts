/**
 * stream.test.ts — tests for SSE event emissions (TASK-017, TASK-025).
 *
 * Verifies:
 *   - broadcastCreated emits 'created' on sseBus and writes to SSE clients.
 *   - broadcastTransition emits 'transition' on sseBus and writes to SSE clients.
 *   - broadcastRemoved emits 'removed' on sseBus and writes 'event: removed' frames.
 *   - All events carry the expected payload shape (including `key` on transitions).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  sseBus,
  broadcastCreated,
  broadcastTransition,
  broadcastRemoved,
  handleSseStream,
  _clearClients,
  type CreatedEvent,
  type TransitionEvent,
  type RemovedEvent,
} from './stream.js'

function makeFakeRes(): { res: ServerResponse; writes: () => string[] } {
  const written: string[] = []
  const res = {
    writeHead: vi.fn(),
    write: vi.fn((chunk: string) => {
      written.push(chunk)
      return true
    }),
    on: vi.fn(),
    addListener: vi.fn(),
  } as unknown as ServerResponse
  return { res, writes: () => written }
}

function makeFakeReq(): IncomingMessage {
  return { on: vi.fn() } as unknown as IncomingMessage
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
      project: 'test-project',
      key: 'T-1',
      title: 'New Task',
      at: '2026-06-10T00:00:00Z',
    }
    broadcastCreated(evt)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(evt)
  })

  it('writes SSE "event: created" frame to connected clients', () => {
    const { res, writes } = makeFakeRes()
    // Register client via handleSseStream
    handleSseStream(makeFakeReq(), res)

    broadcastCreated({
      task_id: 'task_x',
      project_id: 'proj_x',
      project: 'test-project',
      key: 'X-1',
      title: 'Hello',
      at: '2026-06-10T00:00:00Z',
    })

    // First write is the initial 'connected' event; second is our 'created'.
    const createdFrame = writes().find((w) => w.startsWith('event: created'))
    expect(createdFrame).toBeDefined()
    expect(createdFrame).toContain('"task_id":"task_x"')
    expect(createdFrame).toContain('"key":"X-1"')
  })

  it('includes project slug in SSE frame for UI project-scoping (AC11)', () => {
    const { res, writes } = makeFakeRes()
    handleSseStream(makeFakeReq(), res)

    broadcastCreated({
      task_id: 'task_z',
      project_id: 'proj_z',
      project: 'opf-hub',
      key: 'Z-1',
      title: 'Scoped',
      at: '2026-06-10T00:00:00Z',
    })

    const createdFrame = writes().find((w) => w.startsWith('event: created'))
    expect(createdFrame).toContain('"project":"opf-hub"')
  })
})

describe('broadcastTransition', () => {
  it('emits "transition" on sseBus with the event payload', () => {
    const listener = vi.fn()
    sseBus.on('transition', listener)
    const evt: TransitionEvent = {
      task_id: 'task_t2',
      project: 'test-project',
      key: 'T-2',
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
    const { res, writes } = makeFakeRes()
    handleSseStream(makeFakeReq(), res)

    broadcastTransition({
      task_id: 'task_y',
      project: 'test-project',
      key: 'Y-1',
      from_state: 'TODO',
      to_state: 'DONE',
      actor_role: 'human',
      at: '2026-06-10T00:00:00Z',
    })

    const transitionFrame = writes().find((w) => w.startsWith('event: transition'))
    expect(transitionFrame).toBeDefined()
    expect(transitionFrame).toContain('"task_id":"task_y"')
    expect(transitionFrame).toContain('"to_state":"DONE"')
  })

  it('includes the task key in the transition payload (TASK-025 AC5)', () => {
    const listener = vi.fn()
    sseBus.on('transition', listener)
    const { res, writes } = makeFakeRes()
    handleSseStream(makeFakeReq(), res)

    broadcastTransition({
      task_id: 'task_BE-002_abc',
      project: 'test-project',
      key: 'BE-002',
      from_state: 'TODO',
      to_state: 'IN_PROGRESS',
      actor_role: 'implementer',
      at: '2026-06-10T00:00:00Z',
    })

    const transitionFrame = writes().find((w) => w.startsWith('event: transition'))
    expect(transitionFrame).toContain('"key":"BE-002"')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]![0]).toMatchObject({ key: 'BE-002' })
  })

  it('includes project slug in transition SSE frame for UI project-scoping (AC11)', () => {
    const { res, writes } = makeFakeRes()
    handleSseStream(makeFakeReq(), res)

    broadcastTransition({
      task_id: 'task_w',
      project: 'other-proj',
      key: 'W-1',
      from_state: 'TODO',
      to_state: 'IN_PROGRESS',
      actor_role: 'implementer',
      at: '2026-06-10T00:00:00Z',
    })

    const transitionFrame = writes().find((w) => w.startsWith('event: transition'))
    expect(transitionFrame).toContain('"project":"other-proj"')
  })
})

describe('broadcastRemoved', () => {
  it('emits "removed" on sseBus with task_id, project, key and timestamp', () => {
    const listener = vi.fn()
    sseBus.on('removed', listener)

    broadcastRemoved('test-project', 'task_r1', 'R-1')

    expect(listener).toHaveBeenCalledTimes(1)
    const evt = listener.mock.calls[0]![0] as RemovedEvent
    expect(evt.task_id).toBe('task_r1')
    expect(evt.project).toBe('test-project')
    expect(evt.key).toBe('R-1')
    expect(typeof evt.at).toBe('string')
    expect(new Date(evt.at).toString()).not.toBe('Invalid Date')
  })

  it('writes SSE "event: removed" frame with the full payload to connected clients', () => {
    const { res, writes } = makeFakeRes()
    handleSseStream(makeFakeReq(), res)

    broadcastRemoved('opf-hub', 'task_r2', 'R-2')

    const removedFrame = writes().find((w) => w.startsWith('event: removed'))
    expect(removedFrame).toBeDefined()
    expect(removedFrame).toContain('"task_id":"task_r2"')
    expect(removedFrame).toContain('"project":"opf-hub"')
    expect(removedFrame).toContain('"key":"R-2"')
    // SSE frame must be terminated by a blank line
    expect(removedFrame!.endsWith('\n\n')).toBe(true)
  })
})
