/**
 * ui-wiring.test.ts — Verify design-system HTML pages actually invoke the API.
 *
 * Ensures AC4 (mock data replaced by fetch) cannot pass trivially — the UI
 * must contain actual calls to listProjects/listTasks/getTask/getEvidence/listTokens.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DS = resolve(__dirname, '../../design-system')

function read(file: string): string {
  return readFileSync(resolve(DS, file), 'utf8')
}

describe('AC4: UI wiring — pages invoke API methods', () => {
  it('api.js defines listProjects, listTasks, getTask, getEvidence, listTokens', () => {
    const src = read('api.js')
    expect(src).toContain('listProjects')
    expect(src).toContain('listTasks')
    expect(src).toContain('getTask')
    expect(src).toContain('getEvidence')
    expect(src).toContain('listTokens')
    // Must use fetch
    expect(src).toMatch(/fetch\(/)
    // Must use EventSource for SSE
    expect(src).toContain('EventSource')
  })

  it('index.html calls listProjects and listTasks to render the board', () => {
    const src = read('index.html')
    expect(src).toContain('listProjects')
    expect(src).toContain('listTasks')
    expect(src).toContain('getTask')
    expect(src).toContain('approveTask')
    // Must NOT have hardcoded task keys for approve
    expect(src).not.toMatch(/key\s*=\s*['"]TASK-\d+['"]/)
  })

  it('index.html includes api.js', () => {
    const src = read('index.html')
    expect(src).toContain('src="api.js"')
  })

  it('signin.html includes api.js and implements token gate', () => {
    const src = read('signin.html')
    expect(src).toContain('src="api.js"')
    expect(src).toContain('__kanban_setToken')
    expect(src).toContain('kanban_token')
  })

  it('projects.html includes api.js and calls listProjects', () => {
    const src = read('projects.html')
    expect(src).toContain('src="api.js"')
    expect(src).toContain('listProjects')
  })

  it('tokens.html includes api.js and calls listTokens', () => {
    const src = read('tokens.html')
    expect(src).toContain('src="api.js"')
    expect(src).toContain('listTokens')
  })

  it('evidence.html includes api.js and calls getEvidence', () => {
    const src = read('evidence.html')
    expect(src).toContain('src="api.js"')
    expect(src).toContain('getEvidence')
  })

  it('new-task.html includes api.js', () => {
    const src = read('new-task.html')
    expect(src).toContain('src="api.js"')
  })
})
