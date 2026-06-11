/**
 * ds-server.ts — shared Playwright helper: serve design-system/ over HTTP.
 *
 * The design-system pages reference shared assets with absolute paths
 * (`/theme.js`, `/shell.js`, `/api.js`), which resolve to the filesystem root
 * under file:// and never load. This helper starts a tiny node:http server
 * that reuses the production static routing (server/src/http/static.ts), so
 * specs load pages exactly the way production serves them — including the
 * '/<project>/index.html' project-prefix routing used by shell.js redirects.
 *
 * Unmatched paths (notably /api/*) return 404, so pages that auto-call the
 * API show their error states instead of hanging; specs that need data mock
 * fetch in the page (see tasks-view.spec.ts) or seed it via a real server.
 *
 * Each spec file starts its own server on an ephemeral port (listen(0)), so
 * parallel Playwright workers never collide.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import { mountStatic } from '../../server/src/http/static';

const __filename = fileURLToPath(import.meta.url);
const DS_DIR = path.resolve(path.dirname(__filename), '../../design-system');

export interface DsServer {
  baseUrl: string;
  /** URL for a design-system page, e.g. url('index.html'). */
  url(file: string): string;
  close(): Promise<void>;
}

/** Start a static HTTP server for design-system/ on an ephemeral port. */
export async function startDsServer(): Promise<DsServer> {
  const handler = mountStatic((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }, DS_DIR);
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    url: (file: string) => `${baseUrl}/${file}`,
    close: () =>
      new Promise<void>((resolve) => {
        // Drop keep-alive/SSE-retry connections so close() doesn't hang.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Seed a fake bearer token so api.js does not redirect to signin.html.
 * (Under HTTP the shared scripts actually load; pages that auto-call /api/*
 * bounce to the sign-in screen when no token is stored.)
 */
export async function seedToken(
  target: Page | BrowserContext,
  token = 'e2e-ds-token',
): Promise<void> {
  await target.addInitScript((tok: string) => {
    localStorage.setItem('kanban_token', tok);
  }, token);
}
