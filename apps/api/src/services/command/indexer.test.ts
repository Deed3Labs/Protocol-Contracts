import { beforeAll, describe, expect, test } from 'bun:test';
import chain from '@clear/command-types/src/chain/base-sepolia.json';
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, toHex, type Abi, type Address, type Hex } from 'viem';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { CONFIRMATIONS, HISTORY_GAP, findDeployBlocks, indexOnce, indexStatus, syncInventory, type ChainSource, type RawLog } from './indexer.js';

/*
 * The indexer against a stand-in chain: deploy blocks found by halving, every contract read in one
 * request per page, only to CONFIRMATIONS behind the head, nothing read twice, a reorg reconciled,
 * and a range the RPC refuses asked again smaller.
 */

const C = chain.contracts as Record<string, { address: string; events: Abi }>;
const registry = getAddress(C.MerchantRegistry.address);
const pool = getAddress(C.PayoutPool.address);
const deployedAt: Record<string, number> = { [registry]: 1_000, [pool]: 1_500 };

let head = 5_000;
let logs: RawLog[] = [];
let cap = Infinity;
const requests: Array<[number, number, number]> = [];
const src: ChainSource = {
  chainId: 84532,
  head: async () => head,
  blockTime: async (n) => 1_790_000_000 + n * 2,
  hasCode: async (a, n) => (deployedAt[getAddress(a)] ?? Infinity) <= n,
  logs: async (addresses, from, to) => {
    if (to - from + 1 > cap) throw new Error(`eth_getLogs is limited to a ${cap} block range`);
    requests.push([addresses.length, from, to]);
    const set = new Set(addresses.map((a) => a.toLowerCase()));
    return logs.filter((l) => set.has(l.address.toLowerCase()) && l.blockNumber >= from && l.blockNumber <= to);
  },
};

const tx = (s: string) => keccak256(toHex(s));
const windowLog = (block: number, seconds: number, id: string, logIndex = 0): RawLog => ({
  address: registry,
  blockNumber: block,
  blockHash: tx(`block ${block}`),
  transactionHash: tx(id),
  logIndex,
  topics: encodeEventTopics({ abi: C.MerchantRegistry.events, eventName: 'DefaultPayoutWindowUpdated' }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint32' }], [seconds]),
});

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
  await syncInventory(db);
  // only these two have code on the stand-in chain
  await db.query(`DELETE FROM command.chain_contracts WHERE address NOT IN ($1, $2)`, [registry.toLowerCase(), pool.toLowerCase()]);
});

describe('the indexer', () => {
  test('finds each contract’s deploy block by halving, once', async () => {
    expect(await findDeployBlocks(db, src)).toBe(2);
    const { rows } = await db.query<{ name: string; deploy_block: string }>('SELECT name, deploy_block FROM command.chain_contracts ORDER BY name');
    expect(rows.map((r) => [r.name, Number(r.deploy_block)])).toEqual([
      ['MerchantRegistry', 1_000],
      ['PayoutPool', 1_500],
    ]);
    expect(await findDeployBlocks(db, src)).toBe(0);
  });

  test('backfills from the earliest deploy block, every contract in one request a page, decoded', async () => {
    logs = [windowLog(1_200, 1209600, 'a'), windowLog(4_990, 86400, 'b'), windowLog(4_999, 3600, 'c')];
    const r = await indexOnce(db, src, { span: 1_000 });
    expect([r.from, r.to, r.caughtUp]).toEqual([1_000, head - CONFIRMATIONS, true]);
    expect(requests.every(([n]) => n === 2)).toBe(true);
    const { rows } = await db.query<{ block_number: string; event: string; args: any; block_time: Date }>('SELECT block_number, event, args, block_time FROM command.chain_events ORDER BY block_number');
    // block 4,999 is inside the 5 confirmations: not yet
    expect(rows.map((e) => [Number(e.block_number), e.event, e.args.payoutWindow ?? Object.values(e.args)[0]])).toEqual([
      [1_200, 'DefaultPayoutWindowUpdated', 1209600],
      [4_990, 'DefaultPayoutWindowUpdated', 86400],
    ]);
    // Base's blocks are steady: the time is worked out from the head's
    expect(new Date(rows[0].block_time).getTime()).toBe((1_790_000_000 + 1_200 * 2) * 1000);
  });

  test('a run with nothing new reads only the recheck window and adds nothing', async () => {
    requests.length = 0;
    const r = await indexOnce(db, src, { span: 1_000 });
    expect(r.added).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0][2] - requests[0][1]).toBeLessThan(40);
  });

  test('once the head moves on, the confirmed block is indexed', async () => {
    head = 5_010;
    expect((await indexOnce(db, src, { span: 1_000 })).added).toBe(1);
    expect((await indexStatus(db)).events).toBe(3);
  });

  test('a reorg in the recheck window: the lost log goes, the new one comes', async () => {
    logs = logs.filter((l) => l.transactionHash !== tx('c')).concat(windowLog(4_999, 7200, 'c2'));
    const r = await indexOnce(db, src, { span: 1_000 });
    expect([r.added, r.removed]).toEqual([1, 1]);
    const { rows } = await db.query<{ tx_hash: string }>('SELECT tx_hash FROM command.chain_events WHERE block_number = 4999');
    expect(rows.map((x) => x.tx_hash)).toEqual([tx('c2')]);
  });

  test('a range the RPC refuses is asked again, smaller, and nothing is skipped', async () => {
    await db.query('DELETE FROM command.chain_events');
    await db.query('DELETE FROM command.chain_cursor');
    cap = 300;
    requests.length = 0;
    const r = await indexOnce(db, src, { span: 1_000, maxPages: 1_000 });
    expect(r.caughtUp).toBe(true);
    expect((await indexStatus(db)).events).toBe(3);
    // the cap the RPC states is used as it is, not guessed at
    expect(Math.max(...requests.map(([, a, b]) => b - a + 1))).toBe(300);
    cap = Infinity;
  });

  test('an event the ABI doesn’t know is kept raw', async () => {
    logs.push({ ...windowLog(4_000, 1, 'raw'), topics: [tx('Unknown(uint256)')], address: pool });
    await db.query('DELETE FROM command.chain_cursor');
    await indexOnce(db, src, { span: 5_000 });
    const { rows } = await db.query<{ contract: string; event: string | null }>(`SELECT contract, event FROM command.chain_events WHERE tx_hash = $1`, [tx('raw')]);
    expect(rows).toEqual([{ contract: 'PayoutPool', event: null }]);
  });
});

describe('history from the explorer', () => {
  test('a gap wider than HISTORY_GAP is read a contract at a time from the explorer, then the RPC carries on', async () => {
    await db.query('DELETE FROM command.chain_events');
    await db.query('DELETE FROM command.chain_cursor');
    const asked: Array<[string, number, number]> = [];
    head = 1_000 + HISTORY_GAP * 3;
    const far = windowLog(30_000, 60, 'far');
    logs = [...logs, far, windowLog(head - 200, 120, 'near')];
    const wide: ChainSource = {
      ...src,
      history: async (a, from, to) => {
        asked.push([a, from, to]);
        return logs.filter((l) => l.address === a && l.blockNumber >= from && l.blockNumber <= to).map((l) => ({ ...l, blockHash: '0x' as const, time: 1_790_000_000 }));
      },
    };
    requests.length = 0;
    const first = await indexOnce(db, wide, { span: 1_000 });
    expect(asked.map(([a]) => a).sort()).toEqual([registry, pool].sort());
    expect(requests).toHaveLength(0);
    expect(first.to).toBe(head - CONFIRMATIONS - 1_000);
    // the explorer's history is in, and the last stretch comes by RPC on the next run
    const second = await indexOnce(db, wide, { span: 1_000 });
    expect(second.caughtUp).toBe(true);
    expect(requests.length).toBeGreaterThan(0);
    const { rows } = await db.query<{ tx_hash: string }>('SELECT tx_hash FROM command.chain_events WHERE tx_hash = ANY($1)', [[tx('far'), tx('near')]]);
    expect(rows).toHaveLength(2);
  });
});
