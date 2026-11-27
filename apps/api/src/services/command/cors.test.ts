import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * Every header the Command Center sends must be in the API's CORS allowlist, or the browser stops the
 * request at the preflight and the whole app shows "Couldn't reach the protocol" (it did: the session
 * header wasn't listed). Read from the app's own API client, so a header added there fails here first.
 */

const index = readFileSync(resolve(import.meta.dir, '../../index.ts'), 'utf8');
const client = readFileSync(resolve(import.meta.dir, '../../../../command/src/live/api.ts'), 'utf8');
const allowed = index.slice(index.indexOf('allowedHeaders'), index.indexOf('exposedHeaders'));

describe('the Command Center survives CORS', () => {
  test('every header its API client sets is in the preflight allowlist', () => {
    const sent = [...new Set([...client.matchAll(/headers\[['"]([A-Za-z-]+)['"]\]/g)].map((m) => m[1]))];
    expect(sent).toContain('X-Command-Session');
    for (const h of sent) expect(allowed).toContain(`'${h}'`);
  });
});
