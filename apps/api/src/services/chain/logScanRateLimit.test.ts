import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { chainProvider, isRateLimited, overflowCallCount, resetChainProviders } from './provider.js';
import { resetLogScan, scanLogs, setLogScanRateLimitDelays } from './logScan.js';
import { resetReadCache } from './readCache.js';

/*
 * The Earn page lost its pool cost basis and redeemed gains on Railway dev (Nov 18): the public Base
 * Sepolia node refused eth_getLogs with
 *
 *   { "code": -32007, "message": "25/second request limit reached" }
 *
 * which the shared provider did not recognise as a rate limit, so it was never sent to the backup.
 *
 * Both RPCs here are local fake nodes. Nothing in this file reaches Alchemy or any real RPC: the
 * backup is an explicit RPC_FALLBACK_URL pointing at localhost, and ALCHEMY_API_KEY is removed for
 * the duration.
 */

const CHAIN = 84532;
const START = 45_799_000; // logScan's configured start block for Base Sepolia
const HEAD = START + 50;
const POOL = '0x00000000000000000000000000000000000000aa';
const WALLET = '0x00000000000000000000000000000000000000bb';
const LIMIT = { code: -32007, message: '25/second request limit reached' };

const POOL_ABI = ['event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)'];
const iface = new ethers.Interface(POOL_ABI);

/** A Deposit log, as a node would return it. */
function depositLog(assets: bigint) {
  const { data, topics } = iface.encodeEventLog('Deposit', [WALLET, WALLET, assets, assets]);
  return {
    address: POOL,
    topics,
    data,
    blockNumber: ethers.toQuantity(START + 5),
    blockHash: ethers.zeroPadValue('0x01', 32),
    transactionHash: ethers.zeroPadValue('0x02', 32),
    transactionIndex: '0x0',
    logIndex: '0x0',
    removed: false,
  };
}

type Rpc = { id: number; method: string; params: unknown[] };
type Answer = (rpc: Rpc) => { result?: unknown; error?: { code: number; message: string } };

/** A JSON-RPC node on localhost that answers each call (batched or not) with `answer`. */
function fakeNode(answer: Answer) {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as Rpc | Rpc[];
      const reply = (rpc: Rpc) => {
        seen.push(rpc.method);
        if (rpc.method === 'eth_chainId') return { jsonrpc: '2.0', id: rpc.id, result: ethers.toQuantity(CHAIN) };
        if (rpc.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: rpc.id, result: ethers.toQuantity(HEAD) };
        return { jsonrpc: '2.0', id: rpc.id, ...answer(rpc) };
      };
      return Response.json(Array.isArray(body) ? body.map(reply) : reply(body));
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, seen, stop: () => server.stop(true) };
}

const ENV_KEYS = ['SAVINGS_RPC_URL_84532', 'RPC_FALLBACK_URL_84532', 'ALCHEMY_API_KEY', 'RPC_MULTICALL'];
let savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetChainProviders();
});

const nodes: Array<{ stop: () => void }> = [];
beforeEach(() => {
  delete process.env.ALCHEMY_API_KEY; // never the real backup in a test
  delete process.env.RPC_FALLBACK_URL_84532;
  resetChainProviders();
  resetLogScan();
  resetReadCache();
  // Just over ethers' 250 ms cache of an identical request, which would otherwise hand the retry
  // the same refusal without asking the node.
  setLogScanRateLimitDelays([300, 300]);
});
afterEach(() => {
  while (nodes.length) nodes.pop()!.stop();
  resetChainProviders();
  resetLogScan();
});

function poolOn(provider: ethers.Provider) {
  const pool = new ethers.Contract(POOL, POOL_ABI, provider);
  return { pool, filter: pool.filters.Deposit(null, WALLET) };
}

describe('the public node\'s 25/second limit', () => {
  test('is recognised as a rate limit, by its code and by its words', () => {
    expect(isRateLimited(LIMIT.message)).toBe(true);
    expect(isRateLimited('anything', -32007)).toBe(true);
    // As ethers reports it once it has given up on the error.
    expect(isRateLimited(`could not coalesce error (error={ "code": -32007, "message": "25/second request limit reached" }, payload={ "method": "eth_getLogs" })`)).toBe(true);
    // And still not a revert, or a range refusal that the scan shrinks for instead.
    expect(isRateLimited('execution reverted', 3)).toBe(false);
    expect(isRateLimited('eth_getLogs is limited to a 1,000 range', -32614)).toBe(false);
  });

  test('an eth_getLogs refused with -32007 by the first provider is answered by the backup', async () => {
    const primary = fakeNode((rpc) => (rpc.method === 'eth_getLogs' ? { error: LIMIT } : { result: null }));
    const backup = fakeNode((rpc) => (rpc.method === 'eth_getLogs' ? { result: [depositLog(1_000_000n)] } : { result: null }));
    nodes.push(primary, backup);
    process.env.SAVINGS_RPC_URL_84532 = primary.url;
    process.env.RPC_FALLBACK_URL_84532 = backup.url;

    const overflowBefore = overflowCallCount();
    const { pool, filter } = poolOn(chainProvider(CHAIN));
    const events = await scanLogs(`t:${WALLET}`, pool, filter, CHAIN);

    expect(events.length).toBe(1);
    expect(((events[0] as ethers.EventLog).args.assets as bigint)).toBe(1_000_000n);
    // The free node was asked first; only the refused call went to the backup.
    expect(primary.seen).toContain('eth_getLogs');
    expect(backup.seen).toEqual(['eth_getLogs']);
    expect(overflowCallCount() - overflowBefore).toBe(1);
  });

  test('with no backup, the refused page is asked again after a pause and nothing is skipped', async () => {
    let refusals = 1;
    const primary = fakeNode((rpc) => {
      if (rpc.method !== 'eth_getLogs') return { result: null };
      if (refusals-- > 0) return { error: LIMIT };
      return { result: [depositLog(2_000_000n)] };
    });
    nodes.push(primary);
    process.env.SAVINGS_RPC_URL_84532 = primary.url;

    const { pool, filter } = poolOn(chainProvider(CHAIN));
    const events = await scanLogs(`t:${WALLET}`, pool, filter, CHAIN);

    expect(events.length).toBe(1);
    expect(primary.seen.filter((m) => m === 'eth_getLogs').length).toBe(2);
  });

  test('a node that keeps refusing ends the scan with an error rather than a partial answer', async () => {
    const primary = fakeNode((rpc) => (rpc.method === 'eth_getLogs' ? { error: LIMIT } : { result: null }));
    nodes.push(primary);
    process.env.SAVINGS_RPC_URL_84532 = primary.url;

    const { pool, filter } = poolOn(chainProvider(CHAIN));
    await expect(scanLogs(`t:${WALLET}`, pool, filter, CHAIN)).rejects.toThrow();
    // The first ask and two retries -- bounded, so a read never stalls on it.
    expect(primary.seen.filter((m) => m === 'eth_getLogs').length).toBe(3);
  });

  test('any other refusal is not retried', async () => {
    const primary = fakeNode((rpc) => (rpc.method === 'eth_getLogs' ? { error: { code: -32000, message: 'header not found' } } : { result: null }));
    nodes.push(primary);
    process.env.SAVINGS_RPC_URL_84532 = primary.url;

    const { pool, filter } = poolOn(chainProvider(CHAIN));
    await expect(scanLogs(`t:${WALLET}`, pool, filter, CHAIN)).rejects.toThrow();
    expect(primary.seen.filter((m) => m === 'eth_getLogs').length).toBe(1);
  });
});
