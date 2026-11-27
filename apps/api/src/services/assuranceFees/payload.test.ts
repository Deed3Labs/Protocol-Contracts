import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { Db } from '../../db/db';
import { testDb } from '../../db/testDb';
import type { FeeChain } from './chain';
import type { AssuranceFeeConfig } from './config';
import { assuranceFeesDemo, assuranceFeesLive } from './payload';
import { accrueFees, recordSnapshot } from './store';

const USDC = 1_000_000n;
const POOL = '0x00000000000000000000000000000000000a55a1';
const cfg: AssuranceFeeConfig = {
  chainId: 84532,
  pool: POOL,
  clFees: '0xB9ed7ea800c3a32a8F2cf7d2aB50AE2d4831cDFd',
  clOperating: '0xfAFf1081F77bF528bA21eea590f251a755bCdf65',
  clearLendingSafe: '0xAE8FF4Fa84d786Ece2C7Ab87886A2CD6086c419d',
  treasurySafe: '0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50',
  payerEnabled: false,
  payerMode: 'cdp_server_wallet',
  cdpAccountName: 'cl-fees-base-sepolia',
  feeBps: 800n,
  interchangeBps: 2500n,
};
const now = new Date('2026-11-10T12:00:00Z');
const chain = (floorAt: bigint): FeeChain =>
  ({
    readPool: async () => ({ availableCoverage: 3_650n * USDC, backstopBalance: 5_000n * USDC, backstopFloor: 1_000n * USDC, coverageCap: 3_650n * USDC, block: 1 }),
    floorInputsAt: async () => floorAt,
    releasedDraws: async () => ({ total: 120n * USDC, count: 2 }),
    asset: async () => '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    balanceOf: async () => 7n * USDC,
  }) as unknown as FeeChain;

let db: Db;
let pg: PGlite;
beforeAll(async () => {
  ({ db, pg } = await testDb());
  for (let d = 1; d <= 31; d++) await recordSnapshot(db, { chainId: 84532, pool: POOL, today: `2026-10-${String(d).padStart(2, '0')}`, reading: { availableCoverage: 3_650n * USDC, backstopBalance: 0n, backstopFloor: 0n, coverageCap: 0n, block: d } });
  await recordSnapshot(db, { chainId: 84532, pool: POOL, today: '2026-11-10', reading: { availableCoverage: 3_650n * USDC, backstopBalance: 0n, backstopFloor: 0n, coverageCap: 0n, block: 40 } });
  await accrueFees(db, { chainId: 84532, today: '2026-11-10', bps: 800n });
});
afterAll(async () => {
  await pg.close();
});

describe('the Assurance fees card', () => {
  test('live: last month’s fee with its basis, this month so far, the advances and the wallet', async () => {
    const p = await assuranceFeesLive(db, now, { config: cfg, chain: chain(BigInt(Math.floor(now.getTime() / 1000) - 5 * 86_400)) });
    expect(p.configured).toBe(true);
    // 3,650 × 31 × 0.08 / 365 = 24.80
    expect(p.lastMonth).toMatchObject({ month: '2026-10', fee: 24.8, status: 'due', days: 31, read: 31, average: 3650 });
    // November so far: the 10th read, and the 1st to the 9th filled by that run
    expect(p.thisMonth).toMatchObject({ month: '2026-11', days: 30, read: 10 });
    expect(p.advances).toEqual({ released: 120, repaidPaid: 0, entered: 0, outstanding: 120, room: 120, draws: 2 });
    expect(p.wallet.balance).toBe(7);
    expect(p.floor).toMatchObject({ stale: false, days: 5 });
    expect(p.items[0]).toMatchObject({ kind: 'fee', month: '2026-10', amount: 24.8, status: 'due' });
  });

  test('the floor figures are due when posted more than 31 days ago, or never', async () => {
    const old = await assuranceFeesLive(db, now, { config: cfg, chain: chain(BigInt(Math.floor(now.getTime() / 1000) - 40 * 86_400)) });
    expect(old.floor).toMatchObject({ stale: true, days: 40 });
    const never = await assuranceFeesLive(db, now, { config: cfg, chain: chain(0n) });
    expect(never.floor).toMatchObject({ stale: true, at: null });
  });

  test('not configured: says why, and reads nothing', async () => {
    const p = await assuranceFeesLive(db, now, { config: { ...cfg, pool: null } });
    expect(p.configured).toBe(false);
    expect(p.why).toContain('ASSURANCE_POOL_V2_84532');
  });

  test('the prototype’s card has the same shape', () => {
    const d = assuranceFeesDemo();
    expect(d.demo).toBe(true);
    expect(Object.keys(d).sort()).toEqual(expect.arrayContaining(['items', 'advances', 'thisMonth', 'lastMonth', 'interchange', 'floor', 'wallet']));
  });
});
