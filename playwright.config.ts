import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 60_000,
  retries: 0,
  use: {
    screenshot: 'off',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
  },
});
