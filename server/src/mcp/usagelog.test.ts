/**
 * usagelog.test.ts — unit tests for the MCP usage-log module (TASK-028).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logToolCall, resolveUsageLogDir, type UsageEvent } from './usagelog.js'
import { readJsonl } from './jsonl-test-helpers.js'

function makeEvent(over: Partial<UsageEvent> = {}): UsageEvent {
  return {
    ts: '2026-06-11T08:09:10.123Z',
    tool: 'project.list',
    role: 'implementer',
    token_id: 'tok_123',
    project: 'demo',
    task_key: null,
    outcome: 'ok',
    error_message: null,
    duration_ms: 4,
    ...over,
  }
}

describe('resolveUsageLogDir', () => {
  it('defaults to logs/usage', () => {
    expect(resolveUsageLogDir(undefined)).toBe('logs/usage')
  })
  it('returns null when off (case-insensitive) or empty', () => {
    expect(resolveUsageLogDir('off')).toBeNull()
    expect(resolveUsageLogDir('OFF')).toBeNull()
    expect(resolveUsageLogDir('  ')).toBeNull()
  })
  it('returns the configured path otherwise', () => {
    expect(resolveUsageLogDir('/var/log/aka')).toBe('/var/log/aka')
  })
})

describe('logToolCall', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const mkdir = () => {
    const d = mkdtempSync(join(tmpdir(), 'usagelog-'))
    dirs.push(d)
    return d
  }

  it('appends one JSON line to usage-<UTC date>.jsonl and auto-creates the dir', async () => {
    const base = mkdir()
    const dir = join(base, 'nested', 'usage') // does not exist yet
    await logToolCall(dir, makeEvent({ tool: 'task.get', task_key: 'TASK-1' }))
    const file = join(dir, 'usage-2026-06-11.jsonl')
    const evs = readJsonl(file) as unknown as UsageEvent[]
    expect(evs).toHaveLength(1)
    const ev = evs[0]
    expect(ev.tool).toBe('task.get')
    expect(ev.task_key).toBe('TASK-1')
    expect(ev.outcome).toBe('ok')
    for (const k of ['ts', 'tool', 'role', 'token_id', 'outcome', 'duration_ms']) {
      expect(k in ev).toBe(true)
    }
  })

  it('appends (does not overwrite) on repeated calls into the same day file', async () => {
    const dir = mkdir()
    await logToolCall(dir, makeEvent({ outcome: 'ok' }))
    await logToolCall(dir, makeEvent({ outcome: 'rejected', error_message: 'Forbidden' }))
    const file = join(dir, 'usage-2026-06-11.jsonl')
    const evs = readJsonl(file) as unknown as UsageEvent[]
    expect(evs).toHaveLength(2)
    expect(evs[1].outcome).toBe('rejected')
  })

  it('is a no-op when dir is null (disabled)', async () => {
    await expect(logToolCall(null, makeEvent())).resolves.toBeUndefined()
  })

  it('swallows write errors (fire-and-forget) when the path is unwritable', async () => {
    const base = mkdir()
    const blocker = join(base, 'blocker')
    writeFileSync(blocker, 'x') // a regular file — mkdir under it must fail
    // Must not throw even though the directory cannot be created.
    await expect(logToolCall(join(blocker, 'sub'), makeEvent())).resolves.toBeUndefined()
  })
})
