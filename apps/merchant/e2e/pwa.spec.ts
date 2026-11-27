import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { E2E } from './capture';

/**
 * The PWA, UI Phase 7: it installs, it updates, and it works as the Capacitor app's web layer.
 *
 * Against a production build (the service worker only registers there), served from a copy this
 * spec can change, the way a deploy changes what the origin serves.
 */

const APP = path.resolve(E2E, '..');
const OUT = path.join(E2E, '.pwa');
const DIST = path.join(OUT, 'dist');

let server: http.Server;
let base = '';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one build, one browser'));

test.beforeAll(async ({}, worker) => {
  if (worker.project.name !== 'landscape') return;
  test.setTimeout(240_000);
  fs.rmSync(OUT, { recursive: true, force: true });
  execFileSync(process.execPath, [path.resolve(APP, '../../node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'error'], { cwd: APP, stdio: 'inherit' });
  fs.cpSync(path.join(APP, 'dist'), DIST, { recursive: true });
  // A static host with the SPA fallback Vercel gives the app (vercel.json).
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(503).end();
      return;
    }
    let file = path.join(DIST, url.pathname);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(fs.readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  server?.close();
});

test('installs: Chrome finds nothing in the way, and every icon is there', async ({ page }) => {
  await page.goto(`${base}/`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  // Playwright's contexts are incognito, where Chrome never offers to install; that one is the
  // test's, not the app's. Anything else would be.
  expect(installabilityErrors.filter((e) => e.errorId !== 'in-incognito')).toEqual([]);

  const manifest = await (await page.request.get(`${base}/manifest.webmanifest`)).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBeTruthy();
  const sizes: string[] = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  const hrefs = [...manifest.icons.map((i: { src: string }) => i.src), await page.locator('link[rel=apple-touch-icon]').getAttribute('href')];
  for (const href of hrefs) {
    const r = await page.request.get(`${base}${href}`);
    expect(r.status(), href).toBe(200);
  }
});

test('opens offline, and never answers the API from a cache', async ({ page, context }) => {
  await page.goto(`${base}/`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  // The shell draws (a signed-out tablet shows the owner's sign-in), with no network at all.
  await expect(page.locator('#root > *').first()).toBeVisible();
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)))).flat());
  expect(cached).toContain('/index.html');
  expect(cached.filter((p) => p.startsWith('/api/'))).toEqual([]);
  await context.setOffline(false);
});

test('updates: a deploy is picked up on the next load, and the old build is cleared', async ({ page }) => {
  await page.goto(`${base}/`);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const before = await page.evaluate(() => caches.keys());
  expect(before).toHaveLength(1);

  // The build stamped its own id into the worker (vite.config.ts), which is what makes a deploy a
  // new worker at all.
  const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  expect(sw).toMatch(/clear-merchant-shell-[0-9a-f]{12}'/);
  expect(before[0]).toMatch(/^clear-merchant-shell-[0-9a-f]{12}$/);

  // Deploy: a changed page and a worker stamped with a new build id, as `vite build` writes them.
  const index = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(DIST, 'index.html'), index.replace('<head>', '<head><meta name="clear-build" content="next">'));
  fs.writeFileSync(path.join(DIST, 'sw.js'), sw.replace(/clear-merchant-shell-[a-z0-9]+/, 'clear-merchant-shell-next'));

  await page.reload();
  // The page is network-first, so the new build shows on this load.
  await expect(page.locator('meta[name=clear-build]')).toHaveAttribute('content', 'next');
  // The new worker takes over and clears the old build's cache.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
  });
  await expect.poll(() => page.evaluate(() => caches.keys()), { timeout: 10_000 }).toEqual(['clear-merchant-shell-next']);
});

test("works as the Capacitor app's web layer", async ({ browser }) => {
  // Inside the installed app Capacitor's bridge is on the window before the bundle runs; this is
  // the Android one. The app then skips the service worker (its pages come from the app bundle)
  // and otherwise starts as it does on the web.
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(() => {
    (window as unknown as { androidBridge: { postMessage: () => void } }).androidBridge = { postMessage: () => undefined };
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#root > *').first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { Capacitor?: { isNativePlatform(): boolean } }).Capacitor?.isNativePlatform?.() ?? null)).toBe(true);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});
