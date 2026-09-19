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

describe('surviving the public RPC rate limit', () => {
  const reader = require('node:fs').readFileSync(new URL('./creditReader.ts', import.meta.url), 'utf8');
  const provider = require('node:fs').readFileSync(new URL('./provider.ts', import.meta.url), 'utf8');
  test('an incomplete credit read is asked again before it becomes a 503', () => {
    expect(reader).toContain('() => readWithRetry(wallet, chainId)');
    expect(reader).toMatch(/for \(const delay of RETRY_DELAYS_MS\) \{\s*if \(result\.complete\) return result;/);
  });
  test('closed plans cost one call, not eight', () => {
    expect(reader).toMatch(/if \(closed\) \{\s*return \{[\s\S]{0,500}closed: true/);
  });
  test('plain reads in a batch travel as one multicall', () => {
    expect(provider).toContain('const pack = packCalls(packable, this.nextPackId++);');
    expect(provider).toContain("process.env.RPC_MULTICALL?.trim() !== 'off'");
  });
});

describe('the free node first, the paid one for its overflow', () => {
  const provider = require('node:fs').readFileSync(new URL('./provider.ts', import.meta.url), 'utf8');
  test('only rate-limited calls are re-sent, and only those', () => {
    expect(provider).toMatch(/\.filter\(\(r\) => isRateLimited\(/);
    expect(provider).toContain('this.backup._send(payloads.filter((p) => limited.has(p.id)))');
  });
  test('a whole-request 429 goes to the backup; any other error does not', () => {
    expect(provider).toMatch(/if \(this\.backup && isRateLimited\([^)]*\)\)\) \{[\s\S]{0,80}return this\.backup\._send\(payloads\);\s*\}\s*throw error;/);
  });
  test('no backup configured: the primary stands alone', () => {
    expect(provider).toMatch(/backupUrl && backupUrl !== primary \? new ethers\.JsonRpcProvider\(backupUrl, chainId, OPTIONS\) : null/);
    expect(provider).toContain('if (!this.backup) return results;');
  });
});

import { isRateLimited, backupRpcUrl } from './provider.js';
describe('what counts as a rate limit', () => {
  test('the public node\'s phrasing, and the common ones', () => {
    for (const m of ['over rate limit', 'Too Many Requests', 'HTTP 429', 'exceeded its compute units capacity']) expect(isRateLimited(m)).toBe(true);
  });
  test('a revert is an answer, not a limit', () => {
    expect(isRateLimited('execution reverted')).toBe(false);
    expect(isRateLimited('missing revert data')).toBe(false);
  });
  test('Alchemy is the backup when its key is set; an explicit URL wins', () => {
    const was = { ...process.env };
    process.env.ALCHEMY_API_KEY = 'k';
    delete process.env.RPC_FALLBACK_URL_84532;
    expect(backupRpcUrl(84532)).toBe('https://base-sepolia.g.alchemy.com/v2/k');
    process.env.RPC_FALLBACK_URL_84532 = 'https://other.example';
    expect(backupRpcUrl(84532)).toBe('https://other.example');
    process.env = was;
  });
});

import { ethers as E } from 'ethers';
import { isPackable, packCalls, unpackCalls, MULTICALL3 } from './provider.js';
describe('packing reads into one multicall', () => {
  const call = (id: number, tx: Record<string, string>, tag: unknown = 'latest') => ({ id, jsonrpc: '2.0' as const, method: 'eth_call', params: [tx, tag] });
  test('only plain reads at latest, with no sender, value or gas', () => {
    expect(isPackable(call(1, { to: '0x01', data: '0xab' }))).toBe(true);
    expect(isPackable(call(1, { to: '0x01', data: '0xab', from: '0x02' }))).toBe(false);
    expect(isPackable(call(1, { to: '0x01', data: '0xab' }, '0x10'))).toBe(false);
    expect(isPackable({ id: 1, jsonrpc: '2.0', method: 'eth_getTransactionReceipt', params: ['0x'] })).toBe(false);
  });
  test('packs to Multicall3 and gives each read its own answer, a revert as a revert', () => {
    const calls = [call(7, { to: '0x0000000000000000000000000000000000000001', data: '0xab' }), call(8, { to: '0x0000000000000000000000000000000000000002', data: '0xcd' })];
    const pack = packCalls(calls, 99);
    expect((pack.params as Array<{ to: string }>)[0].to).toBe(MULTICALL3);
    const iface = new E.Interface(['function aggregate3((address,bool,bytes)[]) returns ((bool success, bytes returnData)[])']);
    const result = iface.encodeFunctionResult('aggregate3', [[[true, '0x1234'], [false, '0x08c379a0']]]);
    expect(unpackCalls(calls, { id: 99, result })).toEqual([
      { id: 7, result: '0x1234' },
      { id: 8, error: { code: 3, message: 'execution reverted', data: '0x08c379a0' } },
    ]);
  });
  test('a failed multicall fails every read in it the same way, so a rate limit still overflows each', () => {
    const calls = [call(1, { to: '0x01', data: '0xab' }), call(2, { to: '0x02', data: '0xcd' })];
    const error = { code: -32016, message: 'over rate limit' };
    expect(unpackCalls(calls, { id: 99, error } as never)).toEqual([{ id: 1, error }, { id: 2, error }]);
  });
});

describe('the sweeps read as nobody and write as the settler', () => {
  const fs = require('node:fs');
  const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  test('reads go through the provider without a sender, so they pack', () => {
    expect(read('./provider.ts')).toContain('call: (tx) => provider.call({ to: tx.to, data: tx.data, blockTag: tx.blockTag }),');
  });
  test('writes are still signed and sent by the signer', () => {
    const p = read('./provider.ts');
    expect(p).toContain('sendTransaction: (tx) => signer.sendTransaction(tx),');
    expect(p).toContain('estimateGas: (tx) => signer.estimateGas(tx),');
  });
  test('every background pass that reads through the settler uses it', () => {
    expect(read('./cardSettlementService.ts').match(/issuerFor\(writesAs\(signer\)\)/g)?.length).toBe(3);
    for (const f of ['./poolFunding.ts', './termCollection.ts', './autoRepayService.ts', './termLifecycle.ts']) {
      expect(read(f)).toContain('writesAs(');
    }
  });
});
