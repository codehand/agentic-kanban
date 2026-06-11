/**
 * shell-redirect.test.ts — Execute the real design-system/shell.js with a
 * stubbed DOM and assert redirectToProject preserves location.search when
 * redirecting to /<project>/<page> (TASK-030: ?created= toast bug).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, '../../design-system/shell.js'), 'utf8')

const g = globalThis as Record<string, unknown>

function runRedirect(search: string, projects: Array<{ slug: string }>): string | null {
  let replaced: string | null = null
  g.location = { pathname: '/index.html', search, replace: (u: string) => { replaced = u } }
  g.document = {
    body: { dataset: {} },
    getElementById: () => null,
    addEventListener: () => {},
    createElement: () => ({ textContent: '', innerHTML: '' }),
  }
  g.window = g
  // eslint-disable-next-line no-eval
  ;(0, eval)(src)
  ;(g as { redirectToProject: (page: string, projects: unknown[]) => boolean })
    .redirectToProject('index.html', projects)
  return replaced
}

afterEach(() => {
  delete g.location
  delete g.document
  delete g.window
  delete g.redirectToProject
  delete g.projectFromPath
  delete g.populateProjectSelect
})

describe('redirectToProject query preservation', () => {
  it('preserves ?created=<KEY> when redirecting to the first project', () => {
    const target = runRedirect('?created=TASK-X', [{ slug: 'demo' }])
    expect(target).toBe('/demo/index.html?created=TASK-X')
  })

  it('redirects to exactly /<project>/<page> when there is no query (no stray ?)', () => {
    const target = runRedirect('', [{ slug: 'demo' }])
    expect(target).toBe('/demo/index.html')
  })

  it('still sends users with no projects to first-run onboarding', () => {
    const target = runRedirect('', [])
    expect(target).toBe('/first-run.html')
  })
})
