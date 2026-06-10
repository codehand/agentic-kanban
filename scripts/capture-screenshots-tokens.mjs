#!/usr/bin/env node
/**
 * capture-screenshots.mjs — take REAL screenshots of tokens.html for TASK-024.
 * Drives a real dev server, mints a real token via the UI, captures distinct PNGs.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const HUMAN_TOKEN = process.env.HUMAN_TOKEN ?? 'akb_human_researcher_9f3e7d2c1b4a';
const OUT_DIR = process.env.OUT_DIR ?? '/Users/mofy/ws/src/github.com/mofy-eco/agentic-kanban/.claude/worktree/fix/TASK-024-mint-token/docs/ui/TASK-024';

mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-web-security'] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();

  // Set auth token in localStorage so api.js can call the backend
  await page.goto(`${BASE}/signin.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((tok) => {
    localStorage.setItem('kanban_token', tok);
  }, HUMAN_TOKEN);

  // 1. Open tokens.html — initial state with mint CTA button visible
  await page.goto(`${BASE}/tokens.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT_DIR}/01-mint-cta-button.png`, fullPage: false });
  console.log('Captured 01-mint-cta-button.png');

  // 2. Click "Mint token" button to reveal the form
  const mintCta = page.locator('button:has-text("Mint token")').first();
  await mintCta.click();
  await page.waitForTimeout(400);

  // Fill the mint form
  await page.locator('#mint-role').selectOption('judge');
  await page.locator('#mint-label').fill('real-judge-screenshot');
  // project scope: leave as (none)
  await page.waitForTimeout(300);

  await page.screenshot({ path: `${OUT_DIR}/02-mint-cta-form-filled.png`, fullPage: false });
  console.log('Captured 02-mint-cta-form-filled.png');

  // 3. Submit the form — the UI will call api.mintToken and reveal the banner
  // Intercept the mint response so we can log the real values
  const mintResponse = page.waitForResponse(r => r.url().includes('/api/tokens') && r.request().method() === 'POST');

  await page.locator('#mint-submit').click();
  const resp = await mintResponse;
  const minted = await resp.json();
  console.log('MINTED token real values:');
  console.log(JSON.stringify(minted, null, 2));

  // Wait for banner to render and scroll into view
  await page.waitForTimeout(1200);

  // 4. Capture the minted banner showing the real secret
  await page.screenshot({ path: `${OUT_DIR}/03-minted-banner-secret.png`, fullPage: false });
  console.log('Captured 03-minted-banner-secret.png');

  // Scroll down a bit to show more of the guidance
  await page.evaluate(() => window.scrollBy(0, 250));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/04-minted-banner-guidance.png`, fullPage: false });
  console.log('Captured 04-minted-banner-guidance.png');

  // 5. Click the copy-secret button to show "copied" feedback
  const copyBtn = page.locator('#copy-secret-btn');
  await copyBtn.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/05-copy-cta-feedback.png`, fullPage: false });
  console.log('Captured 05-copy-cta-feedback.png');

  await browser.close();
  console.log('All screenshots captured. Minted token id:', minted.id);
})().catch(async (err) => {
  console.error('Screenshot script failed:', err);
  process.exit(1);
});
