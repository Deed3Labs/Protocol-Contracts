import { describe, expect, test, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanLogs, logStartBlock, resetLogScan } from './logScan.js';
import { resetReadCache } from './readCache.js';

const code = (p: string) =>
  readFileSync(join(import.meta.dir, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/*
 * The Earn page asked for `fromBlock: 0, toBlock: 'latest'` in three places. The provider caps
 * eth_getLogs at 10,000 blocks, so all three failed on every read and the catch returned zero. Pool
 * and bond realised gains have been reporting zero since they were written -- not stale, fabricated,
 * and silent because a swallowed error is indistinguishable from having earned nothing.
 */
type Call = { from: number; to: number };

function fakeContract(head: number, calls: Call[], logs: Record<number, unknown[]> = {}) {
  return {
    runner: { getBlockNumber: async () => head },
    queryFilter: async (_f: unknown, from: number, to: number) => {
      calls.push({ from, to });
      return logs[from] ?? [];
    },
    getAddress: async () => '0xpool',
  } as never;
}

describe('scanLogs', () => {
  beforeEach(() => { resetLogScan(); resetReadCache(); });

  test('never asks for more than the provider allows', async () => {
    const calls: Call[] = [];
    const head = 45_799_000 + 30_000;
    await scanLogs('k', fakeContract(head, calls), 'Ev' as never, 84532);
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) expect(c.to - c.from + 1).toBeLessThanOrEqual(10_000);
    // And it covers the whole span rather than stopping at the first page.
    expect(calls[0].from).toBe(45_799_000);
    expect(calls[calls.length - 1].to).toBe(head);
  });

  test('a second read only asks for the new blocks', async () => {
    /*
     * The reason caching is sound here: a mined log cannot change. Without this, paging would cost
     * ~58 requests per read per query -- worse than the volume problem it sits next to.
     */
    const calls: Call[] = [];
    const head = 45_799_000 + 20_000;
    await scanLogs('k', fakeContract(head, calls), 'Ev' as never, 84532);
    const first = calls.length;
    calls.length = 0;
    // The head block is coalesced for a second, which is deliberate -- clear it so this reads a
    // genuinely later chain rather than the same one twice.
    resetReadCache();
    await scanLogs('k', fakeContract(head + 50, calls), 'Ev' as never, 84532);
    expect(first).toBeGreaterThan(1);
    expect(calls).toEqual([{ from: head + 1, to: head + 50 }]);
  });

  test('previously found logs survive the incremental read', async () => {
    const calls: Call[] = [];
    const head = 45_799_000 + 5_000;
    const c1 = fakeContract(head, calls, { 45_799_000: ['a', 'b'] });
    expect((await scanLogs('k', c1, 'Ev' as never, 84532)).length).toBe(2);
    resetReadCache();
    const again = await scanLogs('k', fakeContract(head + 10, calls), 'Ev' as never, 84532);
    expect(again.length).toBe(2);
  });

  test('a failed page is not cached as a complete scan', async () => {
    /*
     * Caching a partial scan would under-report gains permanently, and silently -- the exact failure
     * mode being fixed, just with a different cause.
     */
    const boom = {
      runner: { getBlockNumber: async () => 45_799_000 + 20_000 },
      queryFilter: async () => { throw new Error('rpc down'); },
    } as never;
    await expect(scanLogs('k', boom, 'Ev' as never, 84532)).rejects.toThrow('rpc down');
    const calls: Call[] = [];
    await scanLogs('k', fakeContract(45_799_000 + 20_000, calls), 'Ev' as never, 84532);
    expect(calls[0].from).toBe(45_799_000); // started over, not resumed from a partial cursor
  });

  test('an unknown chain says so rather than silently missing history', () => {
    const start = logStartBlock(999_999, 1_000_000);
    expect(start).toBe(500_000);
  });
});

describe('the earn reader no longer asks for the whole chain', () => {
  test('no unbounded queryFilter remains', () => {
    const src = code('earnReader.ts');
    expect(/queryFilter\([^)]*0,\s*'latest'/.test(src)).toBe(false);
  });

  test('a failed gains read reports unknown, not zero earnings', () => {
    // Zero reads to a member as "you earned nothing", which is a claim, not an absence of one.
    const src = code('earnReader.ts');
    expect(src).toContain('redeemedGains !== null');
  });
});
