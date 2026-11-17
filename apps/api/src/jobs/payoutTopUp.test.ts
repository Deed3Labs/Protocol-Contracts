import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { testDb } from '../db/testDb';
import type { Db } from '../db/db';
import {
  ALLOWANCE_MODULE_ABI,
  DEFAULT_TOPUP_CONFIG,
  ERC20_ABI,
  PAYOUT_POOL_TOPUP_ABI,
  SELECTORS,
  type Projection,
  type TopUpAddresses,
  type TopUpCall,
  type TopUpReads,
} from '../services/payoutFunding/topUp';
import { clearTopUpHalt, topUpOverview, topUpStore } from '../services/payoutFunding/topUpStore';
import { TopUpRevert, createPayoutTopUp, idempotencyKey, payoutTopUpEnabled, startPayoutTopUp, type TopUpChain } from './payoutTopUp';

const U = 1_000_000n;
const a: TopUpAddresses = {
  payoutPool: '0x1000000000000000000000000000000000000001',
  safe: '0x2000000000000000000000000000000000000002',
  module: '0x3000000000000000000000000000000000000003',
  usdc: '0x4000000000000000000000000000000000000004',
  wallet: '0x5000000000000000000000000000000000000005',
};
const iface = { module: new ethers.Interface(ALLOWANCE_MODULE_ABI), usdc: new ethers.Interface(ERC20_ABI), pool: new ethers.Interface(PAYOUT_POOL_TOPUP_ABI) };
const proj = (short: bigint): Projection => ({ horizon: 0, listed: short ? 1 : 0, amount: short, short, truncated: false });

/**
 * The chain and CDP, in memory: CL Operating's USDC, the allowance, the wallet, the PayoutPool. What
 * is due within the low and target horizons is fixed; the shortfall follows what the pool holds.
 * Each send takes effect when it is sent (or reverts); `crash` makes the next send of a step throw
 * after it took effect, as a process dying before it records the hash would.
 */
function fakeChain() {
  const m = {
    operating: 50_000n * U,
    wallet: 0n,
    approved: 0n,
    held: 1_000n * U,
    cap: 5_000n * U,
    spent: 0n,
    nonce: 1,
    dueOverdue: 0n,
    dueLow: 0n,
    dueTarget: 0n,
    moduleEnabled: true,
    isFunder: true,
  };
  const sent: Array<{ step: string; to: string; data: string; key: string; hash: string }> = [];
  const byKey = new Map<string, string>();
  const receipts = new Map<string, number>();
  const pending = new Set<string>();
  const opts = { crash: null as string | null, revert: null as string | null, revertOnDryRun: null as string | null, holdReceipt: null as string | null };
  let n = 0;

  const short = (due: bigint) => (due > m.held ? due - m.held : 0n);
  const stepOf = (data: string) =>
    ({ [SELECTORS.executeAllowanceTransfer]: 'pull', [SELECTORS.approve]: 'approve', [SELECTORS.fund]: 'fund', [SELECTORS.withdrawCapital]: 'withdrawCapital' })[data.slice(0, 10)] ?? 'other';

  /** Applies a call as the contracts would; throws as a revert would. `dry` checks without applying. */
  function apply(tx: { to: string; data: string }, dry: boolean) {
    const step = stepOf(tx.data);
    if (step === 'pull') {
      const p = iface.module.decodeFunctionData('executeAllowanceTransfer', tx.data);
      const amount = BigInt(p[3]);
      if (!m.moduleEnabled) throw new TopUpRevert('GS104 module not enabled');
      if (m.spent + amount > m.cap) throw new TopUpRevert('newSpent > allowance.spent && newSpent <= allowance.amount');
      if (m.operating < amount) throw new TopUpRevert('Could not execute token transfer');
      if (dry) return;
      m.spent += amount;
      m.nonce += 1;
      m.operating -= amount;
      m.wallet += amount;
    } else if (step === 'approve') {
      const p = iface.usdc.decodeFunctionData('approve', tx.data);
      if (!dry) m.approved = BigInt(p[1]);
    } else if (step === 'fund') {
      const amount = BigInt(iface.pool.decodeFunctionData('fund', tx.data)[0]);
      if (!m.isFunder) throw new TopUpRevert('AccessControl: missing role');
      if (m.approved < amount || m.wallet < amount) throw new TopUpRevert('ERC20: insufficient allowance');
      if (dry) return;
      m.approved -= amount;
      m.wallet -= amount;
      m.held += amount;
    } else throw new Error(`the fake chain was sent ${step}`);
  }

  const chain: TopUpChain = {
    read: async (): Promise<TopUpReads> => ({
      now: 1_795_000_000,
      held: m.held,
      payable: m.held,
      queuedTotal: m.dueTarget,
      overdue: proj(short(m.dueOverdue)),
      low: proj(short(m.dueLow)),
      target: proj(short(m.dueTarget)),
      allowance: { amount: m.cap, spent: m.spent, resetTimeMin: 10_080, lastResetMin: 29_913_120, nonce: m.nonce },
      moduleEnabled: m.moduleEnabled,
      isFunder: m.isFunder,
      otherRoles: [],
      operatingBalance: m.operating,
      walletBalance: m.wallet,
      walletPoolAllowance: m.approved,
    }),
    state: async () => ({ walletBalance: m.wallet, walletPoolAllowance: m.approved, nonce: m.nonce }),
    encode: (c: TopUpCall) => (c.fn === 'executeAllowanceTransfer' ? iface.module : c.fn === 'approve' ? iface.usdc : iface.pool).encodeFunctionData(c.fn, c.args),
    encodeTransfer: (to, amount) => iface.usdc.encodeFunctionData('transfer', [to, amount]),
    dryRun: async (tx) => {
      if (opts.revertOnDryRun === stepOf(tx.data)) throw new TopUpRevert('dry run says no');
      apply(tx, true);
    },
    send: async (tx, key) => {
      // CDP's idempotency: the same key is the same transaction, sent once.
      const seen = byKey.get(key);
      if (seen) return seen;
      const step = stepOf(tx.data);
      const hash = '0x' + (++n).toString(16).padStart(64, '0');
      byKey.set(key, hash);
      sent.push({ step, to: tx.to, data: tx.data, key, hash });
      if (opts.revert === step) receipts.set(hash, 0);
      else {
        apply(tx, false);
        receipts.set(hash, 1);
      }
      if (opts.holdReceipt === step) pending.add(hash);
      if (opts.crash === step) {
        opts.crash = null;
        throw new Error('the process died after sending');
      }
      return hash;
    },
    receipt: async (hash) => (pending.has(hash) || !receipts.has(hash) ? null : { status: receipts.get(hash)! }),
  };
  return { m, sent, opts, chain, release: (hash: string) => pending.delete(hash) };
}

let db: Db;
beforeEach(async () => {
  ({ db } = await testDb());
});

function job(chain: TopUpChain, over: Partial<Parameters<typeof createPayoutTopUp>[0]> = {}) {
  const alerts: Array<{ key: string; subject: string; body: string }> = [];
  const keys = new Set<string>();
  const store = topUpStore(db, 84532, a.payoutPool);
  const j = createPayoutTopUp({
    chainId: 84532,
    addresses: a,
    config: DEFAULT_TOPUP_CONFIG,
    chain,
    store,
    // opsAlert sends a key once: the same here.
    alert: async (x) => {
      if (keys.has(x.key)) return;
      keys.add(x.key);
      alerts.push(x);
    },
    receiptTimeoutMs: 0,
    pollMs: 0,
    sleep: async () => undefined,
    log: () => undefined,
    debug: () => undefined,
    warn: () => undefined,
    ...over,
  });
  return { j, alerts, store };
}

describe('a top-up, end to end', () => {
  test('low short: pulls, approves and funds the exact refill, once, and records it', async () => {
    const f = fakeChain();
    f.m.dueLow = 1_300n * U; // $300 short within 14 days
    f.m.dueTarget = 2_200n * U; // $1,200 short within 30 days
    const { j, alerts, store } = job(f.chain);
    expect(await j.tick()).toBe('funded');
    const amount = 1_300n * U; // the 30-day shortfall plus the $100 margin
    expect(f.sent.map((s) => s.step)).toEqual(['pull', 'approve', 'fund']);
    const [pull, approve, fund] = f.sent;
    expect(pull.to).toBe(a.module);
    expect([...iface.module.decodeFunctionData('executeAllowanceTransfer', pull.data)]).toEqual([a.safe, a.usdc, a.wallet, amount, ethers.ZeroAddress, 0n, a.wallet, '0x']);
    expect(approve.to).toBe(a.usdc);
    expect([...iface.usdc.decodeFunctionData('approve', approve.data)]).toEqual([a.payoutPool, amount]);
    expect(fund.to).toBe(a.payoutPool);
    expect(iface.pool.decodeFunctionData('fund', fund.data)[0]).toBe(amount);
    expect(f.m.held).toBe(2_300n * U);
    expect(f.m.wallet).toBe(0n);
    expect(f.m.approved).toBe(0n);
    expect(f.m.operating).toBe(50_000n * U - amount);
    expect(alerts).toEqual([]);

    const [row] = await store.recent(5);
    expect(row).toMatchObject({ trigger: 'low-water', status: 'funded', amount, need: amount, remainder: 0n, lowShort: 300n * U, targetShort: 1_200n * U, nonceBefore: 1 });
    expect([row.pullTx, row.approveTx, row.fundTx]).toEqual([pull.hash, approve.hash, fund.hash]);
    expect(f.sent.map((s) => s.key)).toEqual(['pull', 'approve', 'fund'].map((st) => idempotencyKey(84532, a.payoutPool, row.id, st)));

    // Refilled to 30 days: the next checks move nothing.
    expect(await j.tick()).toBe('idle');
    expect(await j.tick()).toBe('idle');
    expect(f.sent).toHaveLength(3);
    const check = (await store.lastCheck())!.snapshot as { low: { short: string }; outcome: string; allowance: { spent: string; remaining: string } };
    expect(check.outcome).toBe('idle');
    expect(check.allowance).toMatchObject({ spent: amount.toString(), remaining: (5_000n * U - amount).toString() });
  });

  test('nothing short, or short only beyond 14 days: no transaction at all', async () => {
    const f = fakeChain();
    const { j } = job(f.chain);
    expect(await j.tick()).toBe('idle');
    f.m.dueTarget = 3_000n * U;
    expect(await j.tick()).toBe('idle');
    expect(f.sent).toEqual([]);
  });

  test('never withdrawCapital: the guard refuses it before anything is sent', async () => {
    const f = fakeChain();
    f.m.dueLow = f.m.dueTarget = 1_500n * U;
    const evil = { ...f.chain, encode: (c: TopUpCall) => (c.fn === 'fund' ? new ethers.Interface(['function withdrawCapital(uint256,address)']).encodeFunctionData('withdrawCapital', [c.args[0], a.wallet]) : f.chain.encode(c)) };
    const { j, alerts, store } = job(evil);
    expect(await j.tick()).toBe('failed');
    expect(f.sent.map((s) => s.step)).toEqual(['pull', 'approve']);
    expect(alerts[0].subject).toContain('never calls PayoutPool.withdrawCapital');
    expect(await j.tick()).toBe('halted');
    expect((await store.halted())!.status).toBe('failed');
  });
});

describe('a restart in the middle never funds twice', () => {
  for (const step of ['pull', 'approve', 'fund']) {
    test(`the process dies right after sending ${step}`, async () => {
      const f = fakeChain();
      f.m.dueLow = f.m.dueTarget = 1_500n * U;
      f.opts.crash = step;
      const first = job(f.chain);
      expect(await first.j.tick()).toBe('failed');
      // A new process, the same database and chain.
      const second = job(f.chain);
      expect(await second.j.tick()).toBe('funded');
      expect(await second.j.tick()).toBe('idle');
      expect(f.sent.filter((s) => s.step === 'pull')).toHaveLength(1);
      expect(f.sent.filter((s) => s.step === 'fund')).toHaveLength(1);
      expect(f.m.held).toBe(1_000n * U + 600n * U);
      expect(f.m.spent).toBe(600n * U);
      const rows = await second.store.recent(5);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('funded');
    });
  }

  test('a pull still unmined: the next check waits for it, then carries on', async () => {
    const f = fakeChain();
    f.m.dueLow = f.m.dueTarget = 1_500n * U;
    f.opts.holdReceipt = 'pull';
    const { j } = job(f.chain);
    expect(await j.tick()).toBe('pending');
    expect(await j.tick()).toBe('pending');
    f.release(f.sent[0].hash);
    f.opts.holdReceipt = null;
    expect(await job(f.chain).j.tick()).toBe('funded');
    expect(f.sent.map((s) => s.step)).toEqual(['pull', 'approve', 'fund']);
  });

  test('a send that failed before reaching CDP is resent with the same key: still one transaction', async () => {
    const f = fakeChain();
    f.m.dueLow = f.m.dueTarget = 1_500n * U;
    let fails = 1;
    const flaky = { ...f.chain, send: async (tx: { to: string; data: string }, key: string) => (fails-- > 0 ? Promise.reject(new Error('CDP 503')) : f.chain.send(tx, key)) };
    const { j } = job(flaky);
    expect(await j.tick()).toBe('failed');
    expect(await j.tick()).toBe('funded');
    expect(f.sent.map((s) => s.step)).toEqual(['pull', 'approve', 'fund']);
  });
});

describe('when it stops, and who is told', () => {
  test('a revert stops it, alerts, and nothing moves until a person clears it', async () => {
    const f = fakeChain();
    f.m.dueLow = f.m.dueTarget = 1_500n * U;
    f.opts.revert = 'fund';
    const { j, alerts, store } = job(f.chain);
    expect(await j.tick()).toBe('failed');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].subject).toContain('Automatic payout top-up stopped');
    expect(alerts[0].body).toContain('clearPayoutTopUpHalt.ts');
    const failed = (await store.halted())!;
    expect(failed.status).toBe('failed');

    // Still short, and the money sits in the wallet: halted, nothing sent.
    f.opts.revert = null;
    const before = f.sent.length;
    expect(await j.tick()).toBe('halted');
    expect(await j.tick()).toBe('halted');
    expect(f.sent).toHaveLength(before);
    expect(((await store.lastCheck())!.snapshot as { halted: { id: number } }).halted.id).toBe(failed.id);

    expect(await clearTopUpHalt(db, failed.id, 'ops')).toBe(true);
    expect(await clearTopUpHalt(db, failed.id, 'ops')).toBe(false);
    // Cleared: the wallet's USDC is funded exactly, without a second pull.
    expect(await j.tick()).toBe('funded');
    expect(f.sent.filter((s) => s.step === 'pull')).toHaveLength(1);
    expect(f.m.wallet).toBe(0n);
    expect(f.m.held).toBe(1_600n * U);
  });

  test('a dry run that reverts stops it before anything is sent', async () => {
    const f = fakeChain();
    f.m.dueLow = f.m.dueTarget = 1_500n * U;
    f.opts.revertOnDryRun = 'pull';
    const { j, alerts } = job(f.chain);
    expect(await j.tick()).toBe('failed');
    expect(f.sent).toEqual([]);
    expect(alerts[0].subject).toContain('the pull dry run reverts');
  });

  test('need over the cap: moves the cap, alerts once with the Safe batch for the rest; the rest is funded when it arrives', async () => {
    const f = fakeChain();
    f.m.dueLow = 2_000n * U;
    f.m.dueTarget = 8_000n * U; // $7,000 short + $100
    const { j, alerts, store } = job(f.chain);
    expect(await j.tick()).toBe('funded');
    expect(f.m.spent).toBe(5_000n * U);
    expect(f.m.held).toBe(6_000n * U);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].subject).toBe('Payout top-up needs CL Operating\'s owners: $2,100.00');
    const batch = JSON.parse(alerts[0].body.slice(alerts[0].body.indexOf('{')));
    expect(batch.chainId).toBe('84532');
    expect(batch.transactions).toEqual([{ to: a.usdc, value: '0', data: iface.usdc.encodeFunctionData('transfer', [a.wallet, 2_100n * U]) }]);
    const [row] = await store.recent(1);
    expect(row.remainder).toBe(2_100n * U);
    expect(row.safeBatch).toEqual(batch);

    // Low still short ($0 now? held 6,000 vs low 2,000: fine) and the cap is spent: no more moves.
    expect(await j.tick()).toBe('idle');
    // CL Operating's owners sign the batch: the USDC lands in the wallet, which funds exactly it.
    f.m.operating -= 2_100n * U;
    f.m.wallet += 2_100n * U;
    expect(await j.tick()).toBe('funded');
    expect(f.m.held).toBe(8_100n * U);
    expect(f.m.wallet).toBe(0n);
    expect(f.sent.map((s) => s.step)).toEqual(['pull', 'approve', 'fund', 'approve', 'fund']);
    expect((await store.recent(1))[0]).toMatchObject({ trigger: 'wallet-balance', amount: 2_100n * U, status: 'funded' });
  });

  test('cap spent this period and short: no move, the whole need prepared for people', async () => {
    const f = fakeChain();
    f.m.spent = 5_000n * U;
    f.m.dueLow = f.m.dueTarget = 1_200n * U;
    const { j, alerts, store } = job(f.chain);
    expect(await j.tick()).toBe('needs-human');
    expect(f.sent).toEqual([]);
    expect(alerts[0].subject).toContain('$300.00');
    const snap = (await store.lastCheck())!.snapshot as { needsHuman: { why: string; remainder: string; batch: { transactions: unknown[] } } };
    expect(snap.needsHuman.why).toBe('cap-exhausted');
    expect(snap.needsHuman.remainder).toBe((300n * U).toString());
    expect(snap.needsHuman.batch.transactions).toHaveLength(1);
  });

  test('CL Operating lacks the money: alert, no move', async () => {
    const f = fakeChain();
    f.m.operating = 100n * U;
    f.m.dueLow = f.m.dueTarget = 1_500n * U;
    const { j, alerts } = job(f.chain);
    expect(await j.tick()).toBe('operating-short');
    expect(await j.tick()).toBe('operating-short');
    expect(f.sent).toEqual([]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toContain('Clear Lending needs to move money into CL Operating: a Yield Pool Deployment, BondVault excess, or the treasury');
  });

  test('the 30-day need beyond the cap with 14 days fine: one early alert, no move', async () => {
    const f = fakeChain();
    f.m.dueTarget = 9_000n * U;
    const { j, alerts } = job(f.chain);
    for (let i = 0; i < 4; i++) expect(await j.tick()).toBe('idle');
    expect(f.sent).toEqual([]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].subject).toContain('need more than the spending limit has left');
  });

  test('overdue: acts at once, recorded as overdue', async () => {
    const f = fakeChain();
    f.m.dueOverdue = f.m.dueLow = f.m.dueTarget = 1_050n * U;
    const { j, store } = job(f.chain);
    expect(await j.tick()).toBe('funded');
    expect((await store.recent(1))[0]).toMatchObject({ trigger: 'overdue', amount: 150n * U });
  });

  test('not set up: alerts what is missing, sends nothing', async () => {
    const f = fakeChain();
    f.m.isFunder = false;
    f.m.dueLow = f.m.dueTarget = 1_500n * U;
    const { j, alerts } = job(f.chain);
    expect(await j.tick()).toBe('setup');
    expect(f.sent).toEqual([]);
    expect(alerts[0].body).toContain('FUNDER_ROLE');
  });

  test('the Command Center reads the latest check and recent top-ups from the database', async () => {
    const f = fakeChain();
    f.m.dueLow = f.m.dueTarget = 1_500n * U;
    await job(f.chain).j.tick();
    const [o] = await topUpOverview(db);
    expect(o.payoutPool).toBe(a.payoutPool.toLowerCase());
    expect(o.recent).toHaveLength(1);
    expect(o.halted).toBe(null);
    expect((o.snapshot as { outcome: string }).outcome).toBe('funded');
  });
});

describe('off by default', () => {
  const saved = process.env.PAYOUT_TOPUP_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.PAYOUT_TOPUP_ENABLED;
    else process.env.PAYOUT_TOPUP_ENABLED = saved;
  });

  test('without PAYOUT_TOPUP_ENABLED nothing starts and nothing is read; the keeper is its own job', async () => {
    expect(payoutTopUpEnabled({})).toBe(false);
    expect(payoutTopUpEnabled({ PAYOUT_TOPUP_ENABLED: '0' })).toBe(false);
    expect(payoutTopUpEnabled({ PAYOUT_TOPUP_ENABLED: '1' })).toBe(true);
    delete process.env.PAYOUT_TOPUP_ENABLED;
    const lines: string[] = [];
    const log = console.log;
    console.log = (l: string) => lines.push(l);
    try {
      startPayoutTopUp();
    } finally {
      console.log = log;
    }
    expect(lines).toEqual(['[payout-topup] disabled (set PAYOUT_TOPUP_ENABLED=1 for bounded automatic PayoutPool top-ups)']);
    // The read-only keeper does not depend on the top-up job at all.
    const keeper = await Bun.file(new URL('./payoutFundingKeeper.ts', import.meta.url)).text();
    expect(keeper).not.toContain('payoutTopUp');
  });
});
