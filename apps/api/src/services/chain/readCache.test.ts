import { describe, expect, test, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coalesce, invalidate, resetReadCache } from './readCache.js';

const code = (p: string) =>
  readFileSync(join(import.meta.dir, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/*
 * One savings move set off up to twenty identical credit reads: five listeners each re-reading, on a
 * 3s/8s/15s retry backoff, each fanning out to roughly thirty contract calls. They arrived in
 * synchronised bursts, the provider rate-limited them, and a failed read showed an empty credit line.
 */
describe('coalesce', () => {
  beforeEach(() => resetReadCache());

  test('concurrent callers share one read', async () => {
    let runs = 0;
    const read = () => { runs += 1; return new Promise<number>((r) => setTimeout(() => r(42), 10)); };
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => coalesce('k', read)));
    expect(runs).toBe(1);
    expect(all).toEqual([42, 42, 42, 42, 42]);
  });

  test('a later caller past the window reads again', async () => {
    let runs = 0;
    const read = async () => { runs += 1; return runs; };
    await coalesce('k', read, 1);
    await new Promise((r) => setTimeout(r, 5));
    await coalesce('k', read, 1);
    expect(runs).toBe(2);
  });

  test('a failure is never cached', async () => {
    /*
     * The opposite of the point otherwise: the next caller would inherit an error it could have
     * avoided by asking again, and under rate limiting that is exactly the caller most likely to
     * succeed.
     */
    let runs = 0;
    const read = async () => { runs += 1; if (runs === 1) throw new Error('rate limited'); return 'ok'; };
    await expect(coalesce('k', read)).rejects.toThrow('rate limited');
    expect(await coalesce('k', read)).toBe('ok');
    expect(runs).toBe(2);
  });

  test('invalidate drops one member without touching another', async () => {
    let a = 0;
    let b = 0;
    await coalesce('credit:0xaaa:1', async () => { a += 1; return a; }, 60_000);
    await coalesce('credit:0xbbb:1', async () => { b += 1; return b; }, 60_000);
    invalidate('credit:0xaaa:');
    await coalesce('credit:0xaaa:1', async () => { a += 1; return a; }, 60_000);
    await coalesce('credit:0xbbb:1', async () => { b += 1; return b; }, 60_000);
    expect(a).toBe(2); // re-read
    expect(b).toBe(1); // untouched
  });
});

describe('the write path drops the cache before it announces', () => {
  test('invalidate runs ahead of the broadcast, not after', () => {
    /*
     * Ordering is the whole safety argument for having a TTL at all. The broadcast triggers the read
     * that must see the new figures; a cache entry from just before the pledge is precisely the
     * wrong answer to it.
     */
    const src = code('savingsCollateralService.ts');
    const fn = src.slice(src.indexOf('async function announceChainChanged'));
    const dropAt = fn.indexOf('invalidate(');
    const sendAt = fn.indexOf('broadcastToAddress(');
    expect(dropAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(-1);
    expect(dropAt).toBeLessThan(sendAt);
  });

  test('it clears the earn scope too, not only credit', () => {
    // Pool and bond figures are coalesced under their own key and go stale the same way.
    const src = code('savingsCollateralService.ts');
    expect(src).toContain("'credit', 'earn'");
  });
});

describe('one provider per chain', () => {
  test('no chain service builds its own', () => {
    /*
     * Ten construction sites for one connection. Each instance re-detects the chain id before it
     * will send anything, and those `eth_chainId` calls were the requests being rate-limited.
     */
    for (const f of ['creditReader.ts', 'earnReader.ts', 'collateralReader.ts', 'savingsCollateralService.ts', 'creditLineService.ts']) {
      expect(code(f)).not.toContain('new ethers.JsonRpcProvider');
    }
  });

  test('the shared one skips network detection', () => {
    expect(code('provider.ts')).toContain('staticNetwork: true');
  });
});
