import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sw = readFileSync(join(import.meta.dirname, '..', 'public', 'sw.js'), 'utf8');

describe('after an action, the screen shows the state after it', () => {
  test('API reads are network-first; the cache is only an offline fallback', () => {
    expect(sw).toContain('event.respondWith(networkFirst(request, API_CACHE));');
  });

  test('only slow-moving reference data answers from cache first', () => {
    expect(sw).toContain("return url.pathname.startsWith('/api/prices') || url.pathname.startsWith('/api/nfts');");
    expect(sw.match(/staleWhileRevalidate\(request, API_CACHE\)/g)).toHaveLength(1);
  });

  test('the cache version moved, so installed apps drop what the old strategy cached', () => {
    expect(sw).toContain("const CACHE_VERSION = 'v3';");
  });
});
