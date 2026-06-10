import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 60_000,
  retries: 0,
  use: {
    screenshot: 'off',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    // When E2E_BASE_URL is set, use it; otherwise fall back to a local stub.
    // For mocked mode, tests use relative URLs resolved against this baseURL.
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:0',
  },
});
