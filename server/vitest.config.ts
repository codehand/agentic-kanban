import { defineConfig } from 'vitest/config'

/**
 * server-local vitest config (TASK-051).
 *
 * The root vitest.config.ts globs are root-relative (`server/test/**`), so a
 * targeted run from inside `server/` (e.g. `cd server && npx vitest run
 * test/foo.test.ts`, as TASK-051.ac.sh does) matches nothing. This config
 * makes such cwd-local runs resolve test files relative to `server/`.
 *
 * `pnpm test` still runs from the repo root and uses the root config — this
 * file only applies when vitest is invoked with cwd = server/.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
