import { describe, expect, test } from 'bun:test';
import { testDb } from '../../db/testDb';
import { deskStore, recordMarginAdvance } from '../settlementFunding/store';
import type { Queryable } from '../../db/db';
import { autoJobs } from './autoJobs';
import { settlementFundingLive, settlementFundingSeed, type SettlementCard } from './settlementFunding';

/*
 * Money's "Card settlement funding" card and Build → Security's automatic jobs (decision 54): read
 * from what the funding desk recorded (migration 0081), never from the chain; seeded, a sample.
 */

const POOL = '0x1000000000000000000000000000000000000001';
const WALLET = '0x2000000000000000000000000000000000000002';
const FORWARDER = '0x3000000000000000000000000000000000000003';
const OFFRAMP = '0x4000000000000000000000000000000000000004';
const SAFE = '0x5000000000000000000000000000000000000005';
const USDC = '0x6000000000000000000000000000000000000006';
const U = 1_000_000n;
const s = (x: bigint) => x.toString();
const CUTOFF = 1_795_100_000;

/** A check's snapshot as fundingDesk.ts records it (bigints as strings). */
function snapshot(over: { lane?: Record<string, unknown>; forwarder?: Record<string, unknown>; decision?: Record<string, unknown>; laneMissing?: boolean; csa?: string | null; dryRun?: boolean; outcome?: string } = {}) {
  const figures = {
    due: s(2_000n * U), dueSettled: s(2_000n * U), duePending: '0', buffer: s(1_000n * U), velocityBuffer: '0', target: s(3_000n * U),
    csa: over.csa === undefined ? s(500n * U) : over.csa, inFlight: s(300n * U), need: s(2_200n * U), surplus: '0',
    latencyMinutes: 240, forcedAt: CUTOFF - 5 * 3600, windowOpensAt: CUTOFF - 8 * 3600, capLeft: s(1_500n * U), forwardLeft: s(1_500n * U), poolRoom: s(4_000n * U), headroomUsed: '0',
  };
  return {
    enabled: true, dryRun: !!over.dryRun, returnsEnabled: false, forced: false, now: CUTOFF - 6 * 3600,
    addresses: { chainId: 84532, pool: POOL, forwarder: FORWARDER, safe: SAFE, module: '0x7', usdc: USDC, wallet: WALLET, offRamp: OFFRAMP },
    offRamp: { name: 'mock', rail: 'same-day ACH', address: OFFRAMP }, bank: 'lithic',
    coverage: { next: CUTOFF, through: CUTOFF, cutoffs: [CUTOFF], rollover: false, previous: CUTOFF - 86_400 },
    ref: '0x' + 'ab'.repeat(32),
    figures,
    byCutoff: { [CUTOFF]: s(2_000n * U) },
    pendingCredit: s(700n * U),
    collection: s(250n * U),
    inFlight: { book: s(300n * U), offRamp: '0' },
    marginOutstanding: '0',
    measuredLatencyMinutes: 200,
    lane: {
      upgraded: !over.laneMissing, funder: WALLET, capPerPeriod: s(5_000n * U), periodSeconds: 604_800, periodStart: CUTOFF - 3 * 86_400, periodUsed: s(3_500n * U), stopped: false, epoch: 0,
      headroom: s(1_000n * U), principal: s(9_000n * U), principalPosted: true, deployedBalance: s(9_400n * U), availableCash: s(4_000n * U), vaultCash: s(20_000n * U), queuedShares: '0', suspended: false, chargePending: false,
      ...over.lane,
    },
    laneMissing: !!over.laneMissing,
    forwarder: { moduleEnabled: true, allowance: { amount: s(5_000n * U), spent: s(3_500n * U), resetTimeMin: 10_080, lastResetMin: 0, nonce: 1 }, offRamp: OFFRAMP, desk: WALLET, ...over.forwarder },
    operatingBalance: '0',
    decision: { kind: 'fund', book: s(250n * U), deploy: s(1_950n * U), capShort: '0', poolShort: '0', setup: [], blocked: [], late: { book: false, deploy: false }, ...over.decision },
    halted: null,
    outcome: over.outcome ?? 'funded',
  };
}

/** Build → Security's row for the desk (autoJobs.ts), switched on, from this card. */
const job = async (db: Queryable, c: SettlementCard | null) =>
  (await autoJobs(db, { env: { SETTLEMENT_FUNDING_ENABLED: '1', SETTLEMENT_DESK_WALLET: WALLET }, topUps: async () => null, keeper: () => null, settlement: async () => c })).find((j) => j.id === 'settlement')!;

const check = (snap: ReturnType<typeof snapshot>, at = new Date((CUTOFF - 6 * 3600) * 1000)) => ({ checkedAt: at, cutoffAt: new Date(CUTOFF * 1000), need: 2_200n * U, surplus: 0n, csa: 500n * U, outcome: snap.outcome, snapshot: snap });

describe('Money’s card settlement funding card', () => {
  test('live: nothing until the desk has checked; then the cut-off, the CSA, the netting, the lane and the moves', async () => {
    const { db } = await testDb();
    expect(await settlementFundingLive(db)).toBe(null);
    const store = deskStore(db, 84532, POOL);
    const book = await store.create({ kind: 'book', cutoffAt: new Date(CUTOFF * 1000), ref: null, due: 2_000n * U, need: 2_200n * U, amount: 250n * U, status: 'booked' });
    await store.update(book.id, { status: 'done' });
    const dep = await store.create({ kind: 'deploy', cutoffAt: new Date(CUTOFF * 1000), ref: '0xab', due: 2_000n * U, need: 2_200n * U, amount: 1_950n * U, status: 'forwarded' });
    await store.update(dep.id, { deployTx: '0x' + 'a'.repeat(64), forwardTx: '0x' + 'b'.repeat(64) });
    await store.saveDay({ day: '2026-11-16', authorized: 0n, settled: 0n, fundedBook: 100n * U, fundedPool: 800n * U, returnedMargin: 0n, returnedPool: 40n * U, marginAdvanced: 0n, csaClose: 900n * U, snapshot: {} });
    await store.saveCheck(check(snapshot()));

    const c = (await settlementFundingLive(db, {}, Date.now()))!;
    expect(c.lastCheck).toBe((CUTOFF - 6 * 3600) * 1000);
    expect(c.cutoff).toMatchObject({ next: CUTOFF * 1000, rollover: false, forcedAt: (CUTOFF - 5 * 3600) * 1000, latencyMinutes: 240, measuredMinutes: 200 });
    expect([c.due, c.buffer, c.csa, c.inFlight, c.need]).toEqual([2_000, 1_000, 500, 300, 2_200]);
    expect(c.byCutoff).toEqual([[CUTOFF * 1000, 2_000]]);
    // the netting that exists: the Collection Account and today's book transfers, against the draws due
    expect(c.netting).toEqual({ collection: 250, bookedToday: 250, drawsDue: 2_000 });
    expect(c.today).toMatchObject({ booked: 250, sent: 0 });
    expect(c.week).toEqual({ days: 1, sent: 800, booked: 100, returnedPool: 40, returnedMargin: 0 });
    expect(c.lane).toMatchObject({ upgraded: true, stopped: false, cap: 5_000, used: 3_500, left: 1_500, periodSeconds: 604_800, periodStart: (CUTOFF - 3 * 86_400) * 1000, headroom: 1_000, headroomUsed: 400 });
    expect(c.allowance).toEqual({ cap: 5_000, spent: 3_500, remaining: 1_500, resetMinutes: 10_080 });
    expect(c.setup).toEqual([]);
    expect(c.needsHuman).toBe(null);
    expect(c.halted).toBe(null);
    expect(c.recent.map((r) => [r.kind, r.status])).toEqual([['deploy', 'forwarded'], ['book', 'done']]);
    expect(c.recent[0].txs.map(([k]) => k)).toEqual(['deploySettlement', 'forward']);
    expect(c.explorer).toBe('https://sepolia.basescan.org/tx/');
    expect(await job(db, c)).toMatchObject({ t: 'Settlement funding', st: 'ok', w: 'settlement-desk-base-sepolia', a: '0x2000…0002', lim: ['$5,000 a week', 'The lane’s limit, set on chain by two deployers · $3,500 used this period'] });
    expect((await job(db, c)).run[1]).toBe('Funded the Credit Settlement Account');
  });

  test('short: the cap’s remainder as the two Transaction Builder batches, and the pool’s shortfall', async () => {
    const { db } = await testDb();
    await deskStore(db, 84532, POOL).saveCheck(check(snapshot({ decision: { capShort: s(400n * U), poolShort: s(150n * U), blocked: ['a redemption request is open in the queue'] }, outcome: 'needs-human' })));
    const c = (await settlementFundingLive(db))!;
    expect(c.needsHuman).toMatchObject({ capShort: 400, poolShort: 150, blocked: ['a redemption request is open in the queue'] });
    const b = c.needsHuman!.batches as { deployers: { transactions: Array<{ to: string }> }; clOperating: { transactions: Array<{ to: string }> } };
    expect(b.deployers.transactions[0].to).toBe(POOL);
    expect(b.clOperating.transactions[0].to).toBe(USDC);
    expect(c.outcome).toBe('needs-human');
  });

  test('lane not set up: before the SL upgrade, stopped, and with no funder or allowance', async () => {
    const { db } = await testDb();
    const store = deskStore(db, 84532, POOL);
    await store.saveCheck(check(snapshot({ laneMissing: true, outcome: 'setup' })));
    let c = (await settlementFundingLive(db))!;
    expect(c.lane.upgraded).toBe(false);
    expect(c.lane.periodStart).toBe(null);
    expect(c.setup[0]).toContain('the settlement lane is not set up: the Yield Pool has no settlementLane() yet');
    expect(await job(db, c)).toMatchObject({ st: 'wait', lim: ['The lane’s limit set on chain', 'By two DEPLOYER_ROLE signers · SL-funder-1/2'] });

    await store.saveCheck(check(snapshot({ lane: { stopped: true, epoch: 1 }, outcome: 'setup' }), new Date((CUTOFF - 5.5 * 3600) * 1000)));
    c = (await settlementFundingLive(db))!;
    expect(c.lane.stopped).toBe(true);
    expect(c.setup).toEqual(['the settlement lane is stopped (stopSettlementFunder); two DEPLOYER_ROLE signers restart it (SL-funder-1/2)']);
    expect(await job(db, c)).toMatchObject({ st: 'bad', run: ['Stopped on chain', 'stopSettlementFunder was called · two deployers restart it (SL-funder-1/2)'] });

    await store.saveCheck(check(snapshot({ lane: { funder: '0x0000000000000000000000000000000000000000', capPerPeriod: '0' }, forwarder: { allowance: { amount: '0', spent: '0', resetTimeMin: 0, lastResetMin: 0, nonce: 0 } }, outcome: 'setup' }), new Date((CUTOFF - 5 * 3600) * 1000)));
    c = (await settlementFundingLive(db))!;
    expect(c.lane.upgraded).toBe(true);
    expect(c.setup.join('; ')).toContain('no funder');
    expect(c.setup.join('; ')).toContain('no allowance');
  });

  test('halted: the failed move until it is cleared; dry run says so', async () => {
    const { db } = await testDb();
    const store = deskStore(db, 84532, POOL);
    const row = await store.create({ kind: 'deploy', cutoffAt: new Date(CUTOFF * 1000), ref: '0xab', due: 0n, need: 0n, amount: 100n * U, status: 'forwarded' });
    await store.update(row.id, { status: 'failed', error: 'deploySettlement reverted' });
    await store.saveCheck(check(snapshot({ dryRun: true, outcome: 'halted' })));
    const c = (await settlementFundingLive(db))!;
    expect(c.halted).toMatchObject({ id: row.id, error: 'deploySettlement reverted' });
    expect(c.dryRun).toBe(true);
    expect(await job(db, c)).toMatchObject({ st: 'bad', run: ['Stopped', `Move ${row.id} failed: deploySettlement reverted`] });
  });

  test('the Margin outstanding shows until it is restored', async () => {
    const { db } = await testDb();
    await recordMarginAdvance(db, 84532, POOL, 35n * U, 'ops', 'covered a settlement');
    await deskStore(db, 84532, POOL).saveCheck(check(snapshot()));
    expect((await settlementFundingLive(db))!.marginOutstanding).toBe(35);
  });

  test('seeded: a sample, like the other cards; the job waits until the desk has checked', async () => {
    const c = settlementFundingSeed(1_795_000_000_000);
    expect(c.lane.cap).toBe(5_000);
    expect(c.lane.headroom).toBe(1_000);
    expect(c.recent[0].kind).toBe('deploy');
    const { db } = await testDb();
    expect((await job(db, null)).run).toEqual(['Not run yet', 'Checks every 15 minutes once started']);
  });
});
