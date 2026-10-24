import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import chain from '@clear/command-types/src/chain/base-sepolia.json';
import { getAddress } from 'viem';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { syncInventory } from './indexer.js';
import { deployedName, type ChainCall, type ChainReader } from './onchain.js';
import { contractsSection, moneySection } from './sections.js';
import { seedCommand } from './seed.js';
import { TOTALS } from './levels.js';

/*
 * Phase 5b: Money's yield pool and Contracts' releases, live from the chain. The indexer's events
 * (seeded here as it would store them) give the history and who holds the pool's shares; a stand-in
 * reader answers for the contracts' own views, the way the multicall does.
 */

const C = chain.contracts as Record<string, { address: string }>;
const at = (s: string) => new Date(`2026-10-${s}Z`).toISOString();
const usdc = (n: number) => String(BigInt(Math.round(n * 1e6)));
const A = '0x00000000000000000000000000000000000000a1',
  B = '0x00000000000000000000000000000000000000b2',
  Cc = '0x00000000000000000000000000000000000000c3',
  ZERO = '0x0000000000000000000000000000000000000000';
const pool = getAddress(C.LendingPool.address),
  payout = getAddress(C.PayoutPool.address);

let db: Db;
let n = 0;
const put = (contract: string, event: string, args: Record<string, string>, when: string, tx = `0x${(++n).toString(16).padStart(64, '0')}`) =>
  db.query(
    `INSERT INTO command.chain_events (chain_id, block_number, block_hash, block_time, tx_hash, log_index, address, contract, event, args, topics, data)
     VALUES (84532, $1, '0x', $2, $3, $8, $4, $5, $6, $7, '{}', '0x')`,
    [++n, at(when), tx, C[contract].address.toLowerCase(), contract, event, JSON.stringify(args), n],
  );
const mint = (to: string, shares: number, when: string) => put('LendingPool', 'Transfer', { from: ZERO, to, value: usdc(shares) }, when);

// what the contracts say now: the replay's own answer, plus 200 of A's shares sent to C
const views: Record<string, string> = {
  totalAssets: usdc(1406), totalSupply: usdc(1400), totalBorrowed: '0', availableCash: usdc(1406), queuedAssets: '0', utilizationBps: '0',
  borrowRatePerCycle: '25', supplyRatePerCycle: '0', baseRatePerCycle: '25', slope1PerCycle: '75', slope2PerCycle: '900', kinkBps: '8000', decimals: '6',
  cycleLength: '2592000', borrowedFromYield: '0', shortfall: usdc(140.6),
};
const held: Record<string, [number, number]> = { [getAddress(A)]: [800, 100], [getAddress(B)]: [400, 0], [getAddress(Cc)]: [200, 0] };
const asked: ChainCall[][] = [];
// the savings reserve: CLRUSD in issue, and the USDC the vault holds (50 cents short)
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const reserve = { clrusd: 900, vault: 899.5 };
const reader: ChainReader = {
  read: async (calls) => {
    asked.push(calls);
    return calls.map((c) => {
      if (c.contract === 'ClearUSDUpgradeable') return c.fn === 'decimals' ? 6n : BigInt(usdc(reserve.clrusd));
      if (c.contract === 'LendingPool' && c.fn === 'asset') return USDC;
      if (c.contract === 'ERC20') {
        expect([c.address, ...(c.fn === 'balanceOf' ? [c.args![0]] : [])]).toEqual([USDC, ...(c.fn === 'balanceOf' ? [getAddress(C.ESADepositVault.address)] : [])]);
        return c.fn === 'decimals' ? 6n : BigInt(usdc(reserve.vault));
      }
      if (c.fn === 'balanceOf') return BigInt(usdc(held[c.args![0] as string][0]));
      if (c.fn === 'encumberedOf') return BigInt(usdc(held[c.args![0] as string][1]));
      return BigInt(views[c.fn]);
    });
  },
};

const NOW = new Date('2026-10-23T17:00:00Z');
const env = { money: process.env.PROVIDER_MONEY, contracts: process.env.PROVIDER_CONTRACTS };
beforeAll(async () => {
  ({ db } = await testDb());
  await seedCommand(db);
  await syncInventory(db);
  // the pool opens with two founding deposits
  await put('LendingPool', 'Deposit', { sender: A, owner: A, assets: usdc(1000), shares: usdc(1000) }, '15T10:00:00');
  await mint(A, 1000, '15T10:00:00');
  await put('LendingPool', 'Deposit', { sender: B, owner: B, assets: usdc(500), shares: usdc(500) }, '15T11:00:00');
  await mint(B, 500, '15T11:00:00');
  // B takes 100 out at once
  await put('LendingPool', 'Withdraw', { sender: B, receiver: B, owner: B, assets: usdc(100), shares: usdc(100) }, '18T09:00:00');
  await put('LendingPool', 'Transfer', { from: B, to: ZERO, value: usdc(100) }, '18T09:00:00');
  // a shop payout the PayoutPool couldn't cover, borrowed, then paid back with its carry
  await put('LendingPool', 'Borrowed', { borrower: payout, to: payout, amount: usdc(300) }, '20T12:00:00');
  await put('PayoutPool', 'DrewFromYieldPool', { amount: usdc(300) }, '20T12:00:00');
  await put('LendingPool', 'Repaid', { from: payout, amount: usdc(300) }, '22T08:00:00');
  const carry = `0x${'ca'.repeat(32)}`;
  await put('LendingPool', 'Repaid', { from: payout, amount: usdc(6) }, '22T08:00:00', carry);
  await put('PayoutPool', 'InterestPaid', { lender: pool, amount: usdc(6) }, '22T08:00:00', carry);
  // A sends 200 shares to C, who has never deposited
  await put('LendingPool', 'Transfer', { from: A, to: Cc, value: usdc(200) }, '22T15:00:00');
  // releases: two of RevolvingIssuer's, the second run again, and ClearUSD's (as ClearUSDUpgradeable)
  const impl = (k: string) => getAddress(`0x${k.repeat(40)}`);
  await put('LendingPool', 'Upgraded', { implementation: impl('1') }, '14T09:00:00');
  await put('RevolvingIssuer', 'Upgraded', { implementation: impl('2') }, '01T09:00:00');
  await put('RevolvingIssuer', 'Upgraded', { implementation: impl('3') }, '21T09:00:00');
  await put('RevolvingIssuer', 'Upgraded', { implementation: impl('3') }, '21T09:05:00');
  await put('ClearUSDUpgradeable', 'Upgraded', { implementation: impl('4') }, '02T09:00:00');
  // CLRUSD minted for savings, and some redeemed: 900 in issue
  await put('ClearUSDUpgradeable', 'Transfer', { from: ZERO, to: A, value: usdc(500) }, '10T12:00:00');
  await put('ClearUSDUpgradeable', 'Transfer', { from: ZERO, to: B, value: usdc(450) }, '20T12:00:00');
  await put('ClearUSDUpgradeable', 'Transfer', { from: B, to: ZERO, value: usdc(50) }, '21T12:00:00');
  process.env.PROVIDER_MONEY = 'live';
  process.env.PROVIDER_CONTRACTS = 'live';
});
afterAll(() => {
  for (const [k, v] of Object.entries(env)) v == null ? delete process.env[`PROVIDER_${k.toUpperCase()}`] : (process.env[`PROVIDER_${k.toUpperCase()}`] = v);
});

const read = () => ({ level: TOTALS, reveal: false, now: NOW, chain: reader }) as const;

describe('the yield pool, live', () => {
  test('stands where the contract says, its rates the contract’s own', async () => {
    const m: any = await moneySection(db, read());
    expect(m.Y).toMatchObject({ assets: 1406, principal: 1400, lent: 0, cash: 1406, queued: 0, earned: 6, util: 0, borrowBps: 25, supplyBps: 0, apy: 0, cycleDays: 30, opened: '15 Oct', depositors: 3 });
    expect(m.Y.curve).toEqual({ base: 25, s1: 75, s2: 900, kink: 0.8 });
    expect(m.Y.price).toBeCloseTo(1406 / 1400, 10);
    // every read in one request: the pool's views, the cycle, the payout draw, and each holder's shares and pledge
    expect([...asked].reverse().find((a) => a.some((c) => c.fn === 'totalAssets'))!.length).toBe(16 + 3 * 2);
    // the payout gap is the PayoutPool's: a tenth of the pool, so a tenth lent after
    expect(m.Y.toPayout).toBe(140.6);
    expect(m.Y.utilAfter).toBeCloseTo(0.1, 10);
  });

  test('depositors are whoever holds shares now, worth the share price, masked', async () => {
    const m: any = await moneySection(db, read());
    expect(m.Y_DEP).toEqual([
      ['00a1', 803.43, '15 Oct', 100.43],
      ['00b2', 401.71, '15 Oct', 0],
      // C never deposited: since the shares came
      ['00c3', 200.86, '22 Oct', 0],
    ]);
  });

  test('a day at a time from the opening, today being the contract’s reads', async () => {
    const m: any = await moneySection(db, read());
    expect(m.YD).toEqual(['15 Oct', '16 Oct', '17 Oct', '18 Oct', '19 Oct', '20 Oct', '21 Oct', '22 Oct', '23 Oct']);
    expect(m.Y_ASSETS).toEqual([1500, 1500, 1500, 1400, 1400, 1400, 1400, 1406, 1406]);
    expect(m.Y_LENT).toEqual([0, 0, 0, 0, 0, 300, 300, 0, 0]);
  });

  test('the pool’s account: cash not lent, weekly, and its lines from the events', async () => {
    const m: any = await moneySection(db, read());
    const yld = m.ACCTS.find((a: any[]) => a[0] === 'yld');
    expect(yld[5]).toBe(1406);
    expect(yld[6]).toEqual([0, 0, 0, 0, 0, 1500, 1406]);
    expect(m.ENTRIES.yld.map((e: any) => [new Date(e.at).toISOString().slice(5, 10), e.what, e.detail, e.amount])).toEqual([
      ['10-22', 'Repaid', 'PayoutPool', 300],
      ['10-22', 'Interest from credit', 'Shop payouts · carry', 6],
      ['10-20', 'Lent to shop payouts', 'PayoutPool', -300],
      ['10-18', 'Withdrawals', '1 member · paid at once', -100],
      ['10-15', 'Opened', 'Founding deposits · 2 members', 1500],
    ]);
  });

  test('what the pane lists since the opening, and who joined this week, are the pool’s', async () => {
    const m: any = await moneySection(db, read());
    expect(m.figures['money.yield.since_opened'].map((r: any[]) => r.slice(1))).toEqual([
      ['Opened', 'Founding deposits · 2 members', 1500],
      ['Withdrawals', '1 member · paid at once', -100],
    ]);
    // C's shares came on 22 Oct
    expect(m.figures['money.yield.joined_this_week']).toBe(1);
  });

  test('a pool nobody has deposited in yet: zeros, not NaN', async () => {
    const empty: ChainReader = {
      read: async (calls) => calls.map((c) => (c.fn === 'asset' ? USDC : c.fn === 'decimals' ? 6n : c.fn === 'borrowRatePerCycle' || c.fn === 'baseRatePerCycle' ? 25n : 0n)),
    };
    const fresh = (await testDb()).db;
    await seedCommand(fresh);
    const m: any = await moneySection(fresh, { ...read(), chain: empty });
    expect(m.Y).toMatchObject({ assets: 0, util: 0, utilAfter: 0, price: 1, depositors: 0, opened: '—', cycleDays: 30 });
    expect([m.YD, m.Y_ASSETS, m.Y_DEP]).toEqual([['23 Oct'], [0], []]);
  });

  test('live with no reader says so', async () => {
    await expect(moneySection(db, { level: TOTALS, reveal: false, now: NOW })).rejects.toThrow(/PROVIDER_MONEY=live reads the chain/);
  });
});

describe('releases, live', () => {
  test('each proxy’s Upgraded events, counted, a run of the same implementation once', async () => {
    const c: any = await contractsSection(db, read());
    expect(c.RELEASES.ri.map((r: any[]) => [r[0], new Date(r[1]).toISOString().slice(5, 10), r[2]])).toEqual([
      ['v1.0', '10-01', getAddress(`0x${'2'.repeat(40)}`)],
      ['v1.1', '10-21', getAddress(`0x${'3'.repeat(40)}`)],
    ]);
    expect(c.RELEASES.lp.map((r: any[]) => r[0])).toEqual(['v1.0']);
    // ClearUSD on the map is the upgradeable one
    expect(c.RELEASES.cu.map((r: any[]) => r[0])).toEqual(['v1.0']);
    // nothing Command proposes upgrades anything yet
    expect(c.PENDING).toEqual({});
  });

  test('the map’s versions and addresses are the chain’s', async () => {
    const c: any = await contractsSection(db, read());
    const row = (id: string) => c.CTR.find((r: any[]) => r[0] === id);
    const sh = (a: string) => `${getAddress(a).slice(0, 6)}…${getAddress(a).slice(-4)}`;
    expect(row('ri').slice(2, 6)).toEqual(['v1.1', 1, 'live', sh(C.RevolvingIssuer.address)]);
    expect(row('cu')[5]).toBe(sh(C.ClearUSDUpgradeable.address));
    // a contract with no proxy: deployed once, so v1.0
    expect(row('am').slice(2, 6)).toEqual(['v1.0', 0, 'live', sh(C.AccessManager.address)]);
    // not deployed: as the map has it
    expect(row('cp').slice(2, 6)).toEqual(['—', 3, 'later', '—']);
  });

  test('a map name finds its deployed contract', () => {
    const d = new Set(['ClearUSD', 'ClearUSDUpgradeable', 'SavingsIntentFactory', 'RevolvingIssuer', 'RevolvingIssuerV1']);
    expect(['ClearUSD', 'SavingsIntent', 'RevolvingIssuer', 'CreditPool'].map((x) => deployedName(x, d))).toEqual(['ClearUSDUpgradeable', 'SavingsIntentFactory', 'RevolvingIssuer', null]);
  });
});

describe('the savings reserve, live (6b)', () => {
  test('CLRUSD in issue against the USDC the vault holds, as the vault itself compares them', async () => {
    const m: any = await moneySection(db, read());
    expect([m.M.clrusd, m.M.savings, m.M.reserveDiff]).toEqual([900, 899.5, -0.5]);
    expect(m.figures['money.reserve']).toEqual({ ratio: '0.9994 : 1', checked: 'just now' });
    const sav = m.ACCTS.find((a: any[]) => a[0] === 'sav');
    // the USDC is in the vault on chain, not at Bridge
    expect([sav[2], sav[4], sav[5]]).toEqual(['CLRUSD, backed 1:1 by USDC in the savings vault', 'protocol', 899.5]);
    // the weeks are CLRUSD's mints and burns; now is the vault's USDC
    expect(sav[6]).toEqual([0, 0, 0, 0, 0, 500, 899.5]);
  });
});

describe('the feeds in Money, live (6b)', () => {
  beforeAll(async () => {
    await db.query(`INSERT INTO command.plaid_items (id, item_id, access_token) VALUES ('coop', 'item-1', '{}')`);
    const t = (id: string, on: string, name: string, amount: number, pending = false) =>
      db.query(`INSERT INTO command.bank_transactions (id, item, account_id, posted_on, name, amount, pending) VALUES ($1, 'coop', $2, $3, $4, $5, $6)`, [id, 'chk', on, name, amount, pending]);
    await t('t1', '2026-10-15', 'Stripe transfer', -500);
    await t('t2', '2026-10-22', 'Poster printing', 200);
    await t('t3', '2026-10-23', 'Pending card', 30, true);
    // a credit card at the same bank isn't the operating account
    await db.query(`INSERT INTO command.bank_transactions (id, item, account_id, posted_on, name, amount) VALUES ('c1', 'coop', 'card', '2026-10-22', 'Card', 99)`);
    const set = (id: string, figures: unknown) => db.query(`UPDATE command.feeds SET state = 'ok', synced_at = now(), as_of = now(), figures = $2 WHERE id = $1`, [id, JSON.stringify(figures)]);
    await set('plaid', { balance: 1000, accounts: [{ id: 'chk', type: 'depository' }, { id: 'card', type: 'credit' }] });
    await set('stripe', { available: 0, pending: 0, payouts: [{ id: 'po_2', amount: 75, arrival: Date.parse('2026-10-25T00:00:00Z'), status: 'in_transit' }, { id: 'po_1', amount: 500, arrival: Date.parse('2026-10-15T00:00:00Z'), status: 'paid' }] });
    await set('lithic', { month: '2026-10', spent: 40, count: 3, declined: 0, merchants: [{ name: 'Rosa’s Tacos', amount: 20, count: 2 }] });
    await set('bridge', { wallets: [], usdc: 0, inFlight: { count: 2, amount: 60 }, transfers: 3 });
  });

  test('operating cash is the bank’s: its balance, its weeks worked back, its lines, Stripe’s payouts on their way first', async () => {
    const m: any = await moneySection(db, read());
    expect(m.M.cash).toBe(1000);
    const ops = m.ACCTS.find((a: any[]) => a[0] === 'ops');
    expect([ops[5], ops[6]]).toEqual([1000, [700, 700, 700, 700, 700, 1200, 1000]]);
    expect(m.ENTRIES.ops.map((e: any) => [e.what, e.detail, e.amount])).toEqual([
      ['Card sales', 'Stripe payout · on its way', 75],
      ['Pending card', 'Plaid · pending', -30],
      ['Poster printing', 'Plaid', -200],
      ['Stripe transfer', 'Plaid', 500],
    ]);
  });

  test('Lithic’s card spend and Bridge’s deposits in flight ride along', async () => {
    const m: any = await moneySection(db, read());
    expect(m.CARD_SPEND).toEqual({ month: '2026-10', spent: 40, count: 3, merchants: [{ name: 'Rosa’s Tacos', amount: 20, count: 2 }] });
    expect(m.DEPOSIT_RAIL).toEqual({ count: 2, amount: 60 });
  });
});
