import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts', 'server/src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['server/src/**/*.ts'],
    },
  },
})
