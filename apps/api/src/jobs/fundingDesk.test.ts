import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { testDb } from '../db/testDb';
import type { Db } from '../db/db';
import { DESK_SELECTORS, SETTLEMENT_DEPLOYED_TOPIC, erc20Interface, forwarderInterface, isSettlementDeployedFor, laneInterface } from '../services/settlementFunding/abi';
import { mockBank } from '../services/settlementFunding/bank';
import type { CardCredit } from '../services/settlementFunding/cardCredit';
import { DEFAULT_DESK_CONFIG, type DeskConfig } from '../services/settlementFunding/config';
import { settlementRef, type DeskAddresses } from '../services/settlementFunding/desk';
import { mockOffRamp } from '../services/settlementFunding/offRampMock';
import type { OffRamp } from '../services/settlementFunding/offRamp';
import { zonedInstant, type CutoffSchedule } from '../services/settlementFunding/schedule';
import { clearDeskHalt, deskStore, recordMarginAdvance } from '../services/settlementFunding/store';
import { settlementFundingStatus } from '../services/settlementFunding/api';
import { DeskRevert, createFundingDesk, deskIdempotencyKey, nextForcedRun, startFundingDesk, type DeskChain, type DeskChainReads, type DeskTx } from './fundingDesk';

const U = 1_000_000n;
const NY: CutoffSchedule = { timeZone: 'America/New_York', cutoffMinutes: 14 * 60, businessDays: [1, 2, 3, 4, 5], holidays: [], lagDays: 0 };
const ny = (date: string, hh: number, mm = 0) => zonedInstant(date, hh * 60 + mm, 'America/New_York');
const TUE = ny('2026-11-17', 11);

const a: DeskAddresses = {
  chainId: 84532,
  pool: '0x1000000000000000000000000000000000000001',
  forwarder: '0x2000000000000000000000000000000000000002',
  safe: '0x3000000000000000000000000000000000000003',
  module: '0x4000000000000000000000000000000000000004',
  usdc: '0x5000000000000000000000000000000000000005',
  wallet: '0x6000000000000000000000000000000000000006',
  offRamp: '0x7000000000000000000000000000000000000007',
};

const config: DeskConfig = { ...DEFAULT_DESK_CONFIG, enabled: true, schedule: NY, buffer: 500n * U, offRampLatencyMinutes: 120, marginMinutes: 30, windowMinutes: 180, minMove: 10n * U, returnIdleHours: 24 };

/**
 * The Yield Pool's lane, CL Operating, the forwarder's allowance, the off-ramp's address and the desk
 * wallet, in memory, with CDP's idempotency. Each send takes effect when sent (or reverts); `crash`
 * makes the next send of a step throw after it took effect, as a process dying before recording.
 */
function fakeChain() {
  const m = {
    now: TUE,
    block: 100,
    funder: a.wallet,
    cap: 5_000n * U,
    used: 0n,
    headroom: 1_000n * U,
    principal: 50_000n * U,
    deployed: 20_000n * U,
    cash: 100_000n * U,
    operating: 0n,
    offRampHeld: 0n,
    allowanceCap: 5_000n * U,
    allowanceSpent: 0n,
    nonce: 1,
    wallet: 0n,
    approved: 0n,
    returned: 0n,
  };
  const sent: Array<{ step: string; to: string; data: string; key: string; hash: string; at: number }> = [];
  const events: Array<{ topics: string[]; data: string; hash: string; block: number }> = [];
  const byKey = new Map<string, string>();
  const receipts = new Map<string, number>();
  const opts = { crash: null as string | null, revert: null as string | null, revertOnDryRun: null as string | null, failBeforeSend: 0, beforeSend: null as null | ((step: string) => Promise<void>) };
  let n = 0;
  const stepOf = (data: string) =>
    ({ [DESK_SELECTORS.deploySettlement]: 'deploy', [DESK_SELECTORS.forward]: 'forward', [DESK_SELECTORS.approve]: 'approve', [DESK_SELECTORS.returnFunds]: 'return' })[data.slice(0, 10)] ?? 'other';

  function apply(tx: DeskTx, dry: boolean, hash = '') {
    const step = stepOf(tx.data);
    if (step === 'deploy') {
      const [amount, ref] = laneInterface.decodeFunctionData('deploySettlement', tx.data);
      if (m.funder !== a.wallet) throw new DeskRevert('SettlementNotFunder');
      if (m.used + amount > m.cap) throw new DeskRevert('SettlementCap');
      if (dry) return;
      m.used += amount;
      m.deployed += amount;
      m.cash -= amount;
      m.operating += amount;
      events.push({ topics: [SETTLEMENT_DEPLOYED_TOPIC], data: ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256', 'bytes32', 'uint256'], [BigInt(events.length), amount, ref, m.used]), hash, block: m.block });
    } else if (step === 'forward') {
      const amount = BigInt(forwarderInterface.decodeFunctionData('forward', tx.data)[0]);
      if (m.allowanceSpent + amount > m.allowanceCap) throw new DeskRevert('allowance');
      if (m.operating < amount) throw new DeskRevert('Could not execute token transfer');
      if (dry) return;
      m.allowanceSpent += amount;
      m.nonce += 1;
      m.operating -= amount;
      m.offRampHeld += amount;
    } else if (step === 'approve') {
      if (!dry) m.approved = BigInt(erc20Interface.decodeFunctionData('approve', tx.data)[1]);
    } else if (step === 'return') {
      const amount = BigInt(laneInterface.decodeFunctionData('returnFunds', tx.data)[0]);
      if (m.approved < amount || m.wallet < amount) throw new DeskRevert('ERC20: insufficient allowance');
      if (dry) return;
      m.approved -= amount;
      m.wallet -= amount;
      m.deployed -= amount;
      m.cash += amount;
      m.returned += amount;
    } else throw new Error(`the fake chain was sent ${step}`);
  }

  const chain: DeskChain = {
    read: async (): Promise<DeskChainReads> => ({
      now: m.now,
      block: m.block,
      laneMissing: false,
      lane: {
        funder: m.funder,
        capPerPeriod: m.cap,
        periodSeconds: 604_800,
        periodUsed: m.used,
        headroom: m.headroom,
        principal: m.principal,
        principalPosted: true,
        deployedBalance: m.deployed,
        availableCash: m.cash,
        vaultCash: m.cash,
        queuedShares: 0n,
        suspended: false,
      },
      forwarder: { moduleEnabled: true, allowance: { amount: m.allowanceCap, spent: m.allowanceSpent, resetTimeMin: 10_080, lastResetMin: 0, nonce: m.nonce }, offRamp: a.offRamp, desk: a.wallet },
      operatingBalance: m.operating,
      walletBalance: m.wallet,
    }),
    state: async () => ({ nonce: m.nonce, walletBalance: m.wallet, walletPoolAllowance: m.approved }),
    findDeployed: async (ref, fromBlock) => events.find((e) => e.block >= fromBlock && isSettlementDeployedFor(e, ref))?.hash ?? null,
    dryRun: async (tx) => {
      if (opts.revertOnDryRun === stepOf(tx.data)) throw new DeskRevert('dry run says no');
      apply(tx, true);
    },
    send: async (tx, key) => {
      const step = stepOf(tx.data);
      if (opts.beforeSend) await opts.beforeSend(step);
      if (opts.failBeforeSend > 0) {
        opts.failBeforeSend -= 1;
        throw new Error('CDP 503');
      }
      const seen = byKey.get(key);
      if (seen) return seen;
      const hash = '0x' + (++n).toString(16).padStart(64, '0');
      byKey.set(key, hash);
      sent.push({ step, to: tx.to, data: tx.data, key, hash, at: m.now });
      if (opts.revert === step) receipts.set(hash, 0);
      else {
        apply(tx, false, hash);
        receipts.set(hash, 1);
      }
      if (opts.crash === step) {
        opts.crash = null;
        throw new Error('the process died after sending');
      }
      return hash;
    },
    receipt: async (hash) => (receipts.has(hash) ? { status: receipts.get(hash)! } : null),
  };
  return { m, sent, opts, chain };
}

let db: Db;
beforeEach(async () => {
  ({ db } = await testDb());
});

function desk(f: ReturnType<typeof fakeChain>, over: { config?: Partial<DeskConfig>; bank?: ReturnType<typeof mockBank>; offRamp?: OffRamp; card?: Partial<CardCredit> } = {}) {
  const alerts: Array<{ key: string; subject: string; body: string }> = [];
  const keys = new Set<string>();
  const store = deskStore(db, 84532, a.pool);
  const bank = over.bank ?? mockBank({ balances: { 'mock-csa': 1_000n * U, 'mock-collection': 0n, 'mock-margin': 0n } });
  const card: CardCredit = { dueSettled: 3_000n * U, byCutoff: {}, pendingCredit: 0n, recentSettled: 0n, ...over.card };
  const offRamp =
    over.offRamp ??
    mockOffRamp({
      address: a.offRamp,
      latencyMinutes: 120,
      now: () => f.m.now,
      deposits: async () => f.sent.filter((s) => s.step === 'forward').map((s) => ({ forwardTx: s.hash, amount: BigInt(forwarderInterface.decodeFunctionData('forward', s.data)[0]), forwardedAt: s.at })),
    });
  const j = createFundingDesk({
    chainId: 84532,
    addresses: a,
    config: { ...config, ...over.config },
    chain: f.chain,
    store,
    bank,
    offRamp,
    card: async () => card,
    cardDay: async () => ({ authorized: 4_000n * U, settled: 3_000n * U }),
    alert: async (x) => {
      if (keys.has(x.key)) return;
      keys.add(x.key);
      alerts.push(x);
    },
    settleGraceMinutes: 30,
    receiptTimeoutMs: 0,
    pollMs: 0,
    sleep: async () => undefined,
    log: () => undefined,
    debug: () => undefined,
    warn: () => undefined,
  });
  return { j, alerts, store, bank, card };
}

describe('funding a cut-off, end to end', () => {
  test('the Collection Account first, then deploySettlement and forward for exactly the rest, recorded before each send', async () => {
    const f = fakeChain();
    const bank = mockBank({ balances: { 'mock-csa': 1_000n * U, 'mock-collection': 1_200n * U } });
    const { j, alerts, store } = desk(f, { bank, config: { bookSameDay: true } });
    // Recorded before sent: when each transaction leaves, its move is already in the database.
    const seenAtSend: string[] = [];
    f.opts.beforeSend = async () => {
      const acting = await store.acting();
      seenAtSend.push(`${acting?.kind}:${acting?.status}`);
    };
    expect(await j.tick()).toBe('funded');
    expect(seenAtSend).toEqual(['deploy:deploying', 'deploy:forwarding']);
    expect(bank.moves).toEqual([{ kind: 'book', token: expect.any(String), amount: 1_200n * U }]);
    expect(bank.balances.get('mock-csa')).toBe(2_200n * U);

    const ref = settlementRef(zonedInstant('2026-11-17', 14 * 60, 'America/New_York'), 3_000n * U);
    expect(f.sent.map((s) => s.step)).toEqual(['deploy', 'forward']);
    expect([...laneInterface.decodeFunctionData('deploySettlement', f.sent[0].data)]).toEqual([1_300n * U, ref]);
    expect(f.sent[0].to).toBe(a.pool);
    expect(f.sent[1].to).toBe(a.forwarder);
    expect(forwarderInterface.decodeFunctionData('forward', f.sent[1].data)[0]).toBe(1_300n * U);
    expect(f.m.offRampHeld).toBe(1_300n * U);
    expect(f.m.operating).toBe(0n);
    expect(alerts).toEqual([]);

    const [deploy, book] = await store.recent(5);
    expect(book).toMatchObject({ kind: 'book', status: 'done', amount: 1_200n * U, ref });
    expect(deploy).toMatchObject({ kind: 'deploy', status: 'forwarded', amount: 1_300n * U, ref, need: 2_500n * U, nonceBefore: 1, fromBlock: 100 });
    expect([deploy.deployTx, deploy.forwardTx]).toEqual([f.sent[0].hash, f.sent[1].hash]);
    expect(f.sent.map((s) => s.key)).toEqual(['deploy', 'forward'].map((st) => deskIdempotencyKey(84532, a.pool, deploy.id, st)));

    // In flight counts: the next checks move nothing.
    expect(await j.tick()).toBe('idle');
    expect(f.sent).toHaveLength(2);

    // The off-ramp pays the CSA after its latency; the move is done once the grace has passed.
    f.m.now += 130 * 60;
    expect(await j.tick()).toBe('idle');
    expect((await store.recent(1))[0].status).toBe('forwarded');
    f.m.now += 30 * 60;
    bank.balances.set('mock-csa', 3_500n * U);
    expect(await j.tick()).toBe('idle');
    const done = (await store.recent(2)).find((r) => r.kind === 'deploy')!;
    expect(done.status).toBe('done');
    expect(done.offrampRef).toBe(`mock-${f.sent[1].hash}`);
    expect(await store.measuredLatencyMinutes()).toBe(120);
    expect(f.sent).toHaveLength(2);
  });

  test('before the funding window nothing moves; the forced run moves', async () => {
    const f = fakeChain();
    f.m.now = ny('2026-11-17', 7);
    const { j } = desk(f);
    expect(await j.tick()).toBe('waiting');
    expect(f.sent).toEqual([]);
    expect(await j.tick({ forced: true })).toBe('funded');
    expect(f.sent.map((s) => s.step)).toEqual(['deploy', 'forward']);
  });

  test('the forced run is at cut-off minus (latency + margin); after it, the next cut-off\'s', () => {
    expect(nextForcedRun(ny('2026-11-17', 9), config, null)).toBe(ny('2026-11-17', 11, 30));
    expect(nextForcedRun(ny('2026-11-17', 12), config, null)).toBe(ny('2026-11-18', 11, 30));
    expect(nextForcedRun(ny('2026-11-17', 9), config, 240)).toBe(ny('2026-11-17', 9, 30));
  });
});

describe('a restart never funds twice', () => {
  for (const step of ['deploy', 'forward']) {
    test(`the process dies right after sending ${step}`, async () => {
      const f = fakeChain();
      f.opts.crash = step;
      expect(await desk(f).j.tick()).toBe('failed');
      const second = desk(f);
      expect(await second.j.tick()).toBe('funded');
      expect(await second.j.tick()).toBe('idle');
      expect(f.sent.filter((s) => s.step === 'deploy')).toHaveLength(1);
      expect(f.sent.filter((s) => s.step === 'forward')).toHaveLength(1);
      expect(f.m.used).toBe(2_500n * U);
      expect(f.m.offRampHeld).toBe(2_500n * U);
      const rows = await second.store.recent(5);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('forwarded');
    });
  }

  test('a send that failed before reaching CDP is resent with the same key: one transaction', async () => {
    const f = fakeChain();
    f.opts.failBeforeSend = 1;
    const { j } = desk(f);
    expect(await j.tick()).toBe('failed');
    expect(await j.tick()).toBe('funded');
    expect(f.sent.map((s) => s.step)).toEqual(['deploy', 'forward']);
  });
});

describe('when it stops, and who is told', () => {
  test('a revert stops it, alerts once, and nothing moves until a person clears it', async () => {
    const f = fakeChain();
    f.opts.revert = 'forward';
    const { j, alerts, store } = desk(f);
    expect(await j.tick()).toBe('failed');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].subject).toContain('Settlement funding stopped: the forward transaction');
    expect(alerts[0].body).toContain('clearSettlementFundingHalt.ts');
    const failed = (await store.halted())!;
    f.opts.revert = null;
    expect(await j.tick()).toBe('halted');
    expect(await j.tick()).toBe('halted');
    expect(f.sent).toHaveLength(2);
    expect(alerts).toHaveLength(1);
    expect(((await store.lastCheck())!.snapshot as { halted: { id: number } }).halted.id).toBe(failed.id);
    expect(await clearDeskHalt(db, failed.id, 'ops')).toBe(true);
    expect(await clearDeskHalt(db, failed.id, 'ops')).toBe(false);
    // Cleared: it decides again from the chain. The deployed USDC sits in CL Operating; the forward is redone as a new move.
    expect(await j.tick()).toBe('funded');
  });

  test('a dry run that reverts stops it before anything is sent', async () => {
    const f = fakeChain();
    f.opts.revertOnDryRun = 'deploy';
    const { j, alerts } = desk(f);
    expect(await j.tick()).toBe('failed');
    expect(f.sent).toEqual([]);
    expect(alerts[0].subject).toContain('the deploy dry run reverts');
  });

  test('the cap short: deploys the cap, alerts once with both Transaction Builder batches, recorded on the move', async () => {
    const f = fakeChain();
    f.m.used = 4_000n * U;
    const { j, alerts, store } = desk(f);
    expect(await j.tick()).toBe('needs-human');
    expect(f.sent.map((s) => s.step)).toEqual(['deploy', 'forward']);
    expect(f.m.used).toBe(5_000n * U);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].subject).toBe('Settlement funding needs two deployers and CL Operating\'s owners: $1,500.00');
    const batches = JSON.parse(alerts[0].body.slice(alerts[0].body.indexOf('{')));
    expect(batches.deployers.transactions[0].to).toBe(a.pool);
    expect(batches.clOperating.transactions[0].data).toBe(erc20Interface.encodeFunctionData('transfer', [a.offRamp, 1_500n * U]));
    expect((await store.recent(1))[0]).toMatchObject({ capShort: 1_500n * U, safeBatch: batches });
  });

  test('the pool cannot cover it: the alert names the Margin and the manual options', async () => {
    const f = fakeChain();
    f.m.deployed = 51_000n * U; // at the principal plus the headroom
    const { j, alerts } = desk(f);
    expect(await j.tick()).toBe('needs-human');
    expect(f.sent).toEqual([]);
    expect(alerts[0].subject).toContain('$2,500.00 short');
    expect(alerts[0].body).toContain('Savings-Backed Margin');
    expect(alerts[0].body).toContain('recordSettlementMarginAdvance.ts');
    expect(alerts[0].body).toContain('The ESA vault is never a source');
  });

  test('the lane not set up: a setup alert, nothing sent', async () => {
    const f = fakeChain();
    f.m.funder = ethers.ZeroAddress;
    const { j, alerts } = desk(f);
    expect(await j.tick()).toBe('setup');
    expect(f.sent).toEqual([]);
    expect(alerts.map((x) => x.subject).join(' | ')).toContain('the settlement lane is not set up');
  });

  test('an off-ramp payout that fails stops the desk', async () => {
    const f = fakeChain();
    const ramp: OffRamp = {
      name: 'bridge',
      address: a.offRamp,
      rail: 'wire',
      payouts: async () => f.sent.filter((s) => s.step === 'forward').map((s) => ({ id: 'drain_1', amount: 2_500n * U, state: 'failed' as const, depositTx: s.hash, createdAt: s.at, arrivedAt: null, detail: 'returned' })),
    };
    const { j, alerts, store } = desk(f, { offRamp: ramp });
    expect(await j.tick()).toBe('funded');
    expect(await j.tick()).toBe('failed');
    expect(alerts[0].subject).toContain('the off-ramp payout drain_1 failed (returned)');
    expect((await store.halted())!.kind).toBe('deploy');
  });

  test('the CSA unreadable: nothing moves, one alert a day', async () => {
    const f = fakeChain();
    const bank = mockBank({ csa: 'not-there', balances: {} });
    bank.balances.delete('not-there');
    const { j, alerts } = desk(f, { bank });
    expect(await j.tick()).toBe('unknown');
    expect(await j.tick()).toBe('unknown');
    expect(f.sent).toEqual([]);
    expect(alerts).toHaveLength(1);
  });
});

describe('dry run', () => {
  test('decides, records and logs; no move, no transaction, no bank call', async () => {
    const f = fakeChain();
    const bank = mockBank({ balances: { 'mock-csa': 1_000n * U, 'mock-collection': 1_200n * U } });
    const { j, store } = desk(f, { bank, config: { dryRun: true } });
    expect(await j.tick()).toBe('dry-run');
    expect(f.sent).toEqual([]);
    expect(bank.moves).toEqual([]);
    expect(await store.recent(5)).toEqual([]);
    const check = (await store.lastCheck())!;
    expect(check.outcome).toBe('dry-run');
    expect((check.snapshot as { decision: { kind: string; book: string; deploy: string } }).decision).toMatchObject({ kind: 'fund', book: (1_200n * U).toString(), deploy: (1_300n * U).toString() });
  });

  test('its alerts say they are a dry run', async () => {
    const f = fakeChain();
    f.m.used = 4_000n * U;
    const { j, alerts } = desk(f, { config: { dryRun: true } });
    expect(await j.tick()).toBe('dry-run');
    expect(f.sent).toEqual([]);
    expect(alerts.map((x) => x.subject)).toEqual(['[dry run] Settlement funding needs two deployers and CL Operating\'s owners: $1,500.00']);
  });
});

describe('returns', () => {
  async function idleSurplusSetup(over: Parameters<typeof desk>[1] = {}) {
    const f = fakeChain();
    const bank = mockBank({ balances: { 'mock-csa': 10_000n * U, 'mock-collection': 0n, 'mock-margin': 0n } });
    const d = desk(f, { bank, ...over });
    await recordMarginAdvance(db, 84532, a.pool, 1_000n * U, 'ops', 'covered the 16 Nov settlement');
    expect(await d.j.tick()).toBe('idle'); // surplus seen, not yet idle for the window
    f.m.now += 25 * 3_600;
    return { f, ...d };
  }

  test('off unless SETTLEMENT_RETURNS_ENABLED: one alert, nothing moves', async () => {
    const { f, j, alerts, bank } = await idleSurplusSetup();
    expect(await j.tick()).toBe('returns-off');
    expect(f.sent).toEqual([]);
    expect(bank.moves).toEqual([]);
    expect(alerts[0].subject).toContain('automatic Returns are off');
  });

  test('on: the Margin first by book transfer, then the pool by ACH, and the on-ramp USDC is Returned exactly', async () => {
    const { f, j, bank, store, alerts } = await idleSurplusSetup({ config: { returnsEnabled: true } });
    // CSA 10,000; due 3,000 + buffer 500: surplus 6,500. Margin 1,000; the pool's Deployed Balance 20,000.
    expect(await j.tick()).toBe('returned');
    expect(bank.balances.get('mock-margin')).toBe(1_000n * U);
    expect(bank.moves.map((x) => [x.kind, x.amount])).toEqual([['book', 1_000n * U], ['payment', 5_500n * U]]);
    expect(await store.marginOutstanding()).toBe(0n);
    expect(alerts).toEqual([]);
    const pool = (await store.recent(5)).find((r) => r.kind === 'return-pool')!;
    expect(pool.status).toBe('sent');
    // The on-ramp delivers USDC to the desk wallet: approve and returnFunds, exactly.
    f.m.wallet = 5_500n * U;
    expect(await j.tick()).toBe('returned');
    expect(f.sent.map((s) => s.step)).toEqual(['approve', 'return']);
    expect(f.m.returned).toBe(5_500n * U);
    expect(f.m.wallet).toBe(0n);
    expect((await store.recent(5)).find((r) => r.kind === 'return-pool')!.status).toBe('done');
  });
});

describe('the daily reconciliation and what Command reads', () => {
  test('one row a day: authorized, settled, funded, returned, the CSA at the close', async () => {
    const f = fakeChain();
    const { j, store } = desk(f);
    expect(await j.tick()).toBe('funded');
    await j.tick();
    const [day] = await store.days(5);
    expect(day).toMatchObject({ day: '2026-11-16', authorized: 4_000n * U, settled: 3_000n * U, csaClose: 1_000n * U });
    expect(await store.days(5)).toHaveLength(1);

    const status = (await settlementFundingStatus(db))!;
    expect(status.pool).toBe(a.pool.toLowerCase());
    expect(status.recent[0]).toMatchObject({ kind: 'deploy', status: 'forwarded', amount: 2_500, txs: [['deploySettlement', f.sent[0].hash], ['forward', f.sent[1].hash]] });
    expect(status.halted).toBe(null);
    expect(status.days[0]).toMatchObject({ day: '2026-11-16', authorized: 4_000, settled: 3_000, csaClose: 1_000 });
    expect(status.lastCheck!.outcome).toBe('idle');
  });
});

describe('off by default', () => {
  const saved = process.env.SETTLEMENT_FUNDING_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.SETTLEMENT_FUNDING_ENABLED;
    else process.env.SETTLEMENT_FUNDING_ENABLED = saved;
  });

  test('without SETTLEMENT_FUNDING_ENABLED nothing starts and nothing is read', () => {
    delete process.env.SETTLEMENT_FUNDING_ENABLED;
    const lines: string[] = [];
    const log = console.log;
    console.log = (l: string) => lines.push(l);
    try {
      startFundingDesk();
    } finally {
      console.log = log;
    }
    expect(lines).toEqual(['[settlement-funding] disabled (set SETTLEMENT_FUNDING_ENABLED=1, with SETTLEMENT_FUNDING_DRY_RUN=1 first, for automatic Settlement Funding)']);
  });

  test('idempotency keys are stable, UUID-shaped, and differ by move and step', () => {
    const k = deskIdempotencyKey(84532, a.pool, 1, 'deploy');
    expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deskIdempotencyKey(84532, a.pool.toUpperCase().replace('0X', '0x'), 1, 'deploy')).toBe(k);
    expect(deskIdempotencyKey(84532, a.pool, 1, 'forward')).not.toBe(k);
    expect(deskIdempotencyKey(84532, a.pool, 2, 'deploy')).not.toBe(k);
  });
});
