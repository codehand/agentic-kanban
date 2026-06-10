/**
 * mint-token.spec.ts — Playwright UI test for the token mint flow (TASK-024).
 *
 * Asserts:
 *   - The mint CTA opens the form.
 *   - Submitting the form with valid fields reveals the banner.
 *   - Banner contains the real secret + usage guidance (Bearer / /mcp / snippet).
 *   - Copy buttons use navigator.clipboard and change label to "copied".
 *
 * NOTE: requires a running server + a human token in KANBAN_HUMAN_TOKEN.
 *       Skipped automatically if the env var is not set.
 */
import { test, expect } from '@playwright/test'

const BASE = process.env.KANBAN_BASE_URL || 'http://127.0.0.1:3000'
const HUMAN_TOKEN = process.env.KANBAN_HUMAN_TOKEN || ''

test.describe('Mint token flow', () => {
  test.skip(!HUMAN_TOKEN, 'KANBAN_HUMAN_TOKEN not set — skipping live UI test')

  test.beforeEach(async ({ context }) => {
    // Seed the sign-in token so the page loads as authenticated human.
    await context.addCookies([
      { name: 'kanban_token', value: HUMAN_TOKEN, url: BASE },
    ])
  })

  test('mint CTA → form → banner with secret + guidance + copy', async ({ page }) => {
    await page.goto(`${BASE}/tokens.html`)

    // The banner must be hidden before any mint.
    const banner = page.locator('#minted-banner')
    await expect(banner).toBeHidden()

    // Open the mint panel via the header CTA.
    await page.getByRole('button', { name: /mint token/i }).click()
    const mintPanel = page.locator('#mint')
    await expect(mintPanel).toBeVisible()

    // Fill the form.
    const label = `pw-${Date.now()}`
    await page.locator('#mint-role').selectOption('judge')
    await page.locator('#mint-label').fill(label)

    // Stub the API response so the test is hermetic.
    await page.route('**/api/tokens', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'tk_test',
            role: 'judge',
            label,
            project: null,
            secret: 'akb_live_judge_test_secret_deadbeef',
          }),
        })
      } else {
        await route.continue()
      }
    })

    // Submit — wait for banner to reveal.
    await page.locator('#mint-submit').click()
    await expect(banner).toBeVisible({ timeout: 5000 })

    // Banner shows the real secret.
    await expect(page.locator('#minted-secret')).toHaveText('akb_live_judge_test_secret_deadbeef')

    // Guidance includes Bearer, /mcp endpoint, and a CONNECT_MCP link.
    await expect(page.locator('#guidance-bearer')).toContainText('Bearer akb_live_judge_test_secret_deadbeef')
    await expect(page.locator('#guidance-endpoint')).toContainText('/mcp')
    await expect(page.locator('a[href*="CONNECT_MCP"]')).toBeVisible()

    // Copy the secret — button label flips to "copied".
    const copyBtn = page.locator('#copy-secret-btn')
    // Grant clipboard permissions.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await copyBtn.click()
    await expect(copyBtn).toContainText(/copied/i)
  })
})
