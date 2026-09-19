import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readsMustBeFresh, wantFreshReads } from './lib/freshReads';

const sw = readFileSync(join(import.meta.dirname, '..', 'public', 'sw.js'), 'utf8');
const api = readFileSync(join(import.meta.dirname, 'utils', 'apiClient.ts'), 'utf8');
const stale = readFileSync(join(import.meta.dirname, 'lib', 'chainStale.ts'), 'utf8');

describe('a page switch draws the last answer at once', () => {
  test('API reads answer from cache and refresh behind, unless the app asks for the network', () => {
    expect(sw).toMatch(
      /if \(request\.cache === 'no-cache' \|\| request\.cache === 'no-store' \|\| request\.cache === 'reload'\) \{\s*event\.respondWith\(networkFirst\(request, API_CACHE\)\);\s*return;\s*\}\s*event\.respondWith\(staleWhileRevalidate\(request, API_CACHE\)\);/,
    );
  });

  test('the cache version moved, so installed apps pick up the new strategy', () => {
    expect(sw).toContain("const CACHE_VERSION = 'v5';");
  });
});

describe('after an action, the screen shows the state after it', () => {
  test('reads ask for the network while the window is open', () => {
    expect(api).toContain("...(method === 'GET' && readsMustBeFresh() ? { cache: 'no-cache' as RequestCache } : {}),");
  });

  test('any request that is not a read opens the window, and so does every chain move', () => {
    expect(api).toContain("if (method !== 'GET') wantFreshReads();");
    expect(stale.match(/wantFreshReads\(\);/g)).toHaveLength(2);
  });

  test('the window opens, and a later shorter call never shortens it', () => {
    expect(readsMustBeFresh()).toBe(false);
    wantFreshReads();
    expect(readsMustBeFresh()).toBe(true);
    wantFreshReads(-1);
    expect(readsMustBeFresh()).toBe(true);
  });
});

describe('the service worker stays installed, and forgets what it should', () => {
  const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
  const logout = readFileSync(join(import.meta.dirname, 'hooks', 'useLogout.ts'), 'utf8');

  test('no AppKit check unregisters it -- there has been no appkit-button since Privy', () => {
    expect(html).toContain("navigator.serviceWorker.register('/sw.js')");
    expect(html).not.toContain('registration.unregister()');
  });

  test('only our own hashed files are cached forever, never another origin\'s scripts', () => {
    expect(sw).toContain('if (url.origin === self.location.origin && isStaticAsset(url)) {');
    expect(sw).toContain('if (url.origin === self.location.origin && isImage(url)) {');
  });

  test('signing out drops the cached API answers', () => {
    expect(logout).toMatch(/forgetRemembered\(\);[\s\S]{0,260}await clearApiCache\(\);/);
    expect(logout).toContain("n.startsWith('protocol-api-')");
  });

  test('activating deletes our old cache versions, and leaves other caches alone', () => {
    expect(sw).toMatch(/cacheName\.startsWith\('protocol-'\) &&\s*cacheName !== STATIC_CACHE &&\s*cacheName !== API_CACHE &&\s*cacheName !== IMAGE_CACHE/);
  });

  test('no AppKit leftovers: nothing preloads Reown icons, which answer 403 without a project id', () => {
    expect(html).not.toContain('api.web3modal.com');
    expect(html).not.toContain('appKitModal');
  });
});
