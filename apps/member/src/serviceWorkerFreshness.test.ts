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
    expect(sw).toContain("const CACHE_VERSION = 'v4';");
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
