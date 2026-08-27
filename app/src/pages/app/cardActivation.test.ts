import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', '..', p), 'utf8');

/*
 * Pressing Activate card did nothing at all.
 *
 * The server was answering `503 Cards unavailable` — LITHIC_API_KEY is not set — and the client
 * turned that into `null`, which the route treated as "no card yet". A failure and a no-op were
 * the same value, so the spinner stopped and the page did not change.
 */
describe('a failed activation says so', () => {
  const client = read('utils/apiClient.ts');
  const route = read('pages/app/CardRoute.tsx');
  const page = read('pages/app/CardPage.tsx');

  test('createCard returns the reason instead of collapsing to null', () => {
    const fn = client.slice(client.indexOf('export async function createCard'), client.indexOf('export async function setCardFrozen'));
    expect(fn).toContain('error?: string');
    expect(fn).not.toMatch(/return r\.error \? null/);
  });

  test('and separates "not switched on" from "that failed"', () => {
    // A member cannot retry their way out of an unconfigured integration, so telling them to try
    // again would send them round a loop with no exit.
    const fn = client.slice(client.indexOf('export async function createCard'), client.indexOf('export async function setCardFrozen'));
    expect(fn).toContain('unavailable');
  });

  test('the route shows the outcome rather than discarding it', () => {
    expect(route).toContain('setNotice(');
    // The old shape: a failure fell off the end of the function.
    expect(route).not.toMatch(/const created = await createCard\('Clear card'\);\s*if \(created\) setCard\(created\);/);
  });

  test('and the page has somewhere to put it', () => {
    expect(page).toContain('notice?: string | null');
    expect(page).toContain('role="status"');
  });
});

/*
 * The other half of that console paste: the service worker rejecting on /card.
 */
describe('the service worker can open a route offline', () => {
  const sw = readFileSync(join(import.meta.dirname, '..', '..', '..', 'public', 'sw.js'), 'utf8');

  test('navigations are matched by request mode, not by path', () => {
    // isHTML only ever matched `/` and `*.html`, so /card, /savings, /earn and the rest fell
    // through to a bare fetch with no fallback and no catch.
    expect(sw).toContain("request.mode === 'navigate'");
  });

  test('a failed navigation serves the app shell', () => {
    const nav = sw.slice(sw.indexOf('async function navigation'));
    expect(nav).toContain("cache.match('/index.html')");
  });

  test('and never a JSON body, which the browser would render as the page', () => {
    const nav = sw.slice(sw.indexOf('async function navigation'), sw.indexOf('// Cache First Strategy'));
    expect(nav).not.toContain('JSON.stringify');
    expect(nav).toContain('text/html');
  });

  test('the default branch cannot reject unhandled any more', () => {
    const fetchHandler = sw.slice(sw.indexOf("self.addEventListener('fetch'"), sw.indexOf('async function navigation'));
    expect(fetchHandler).toMatch(/fetch\(request\)\.catch\(/);
  });
});
