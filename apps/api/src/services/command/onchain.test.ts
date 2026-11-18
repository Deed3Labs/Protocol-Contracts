import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import chain from '@clear/command-types/src/chain/base-sepolia.json';
import { readFileSync } from 'node:fs';
import { getAddress, stringToHex } from 'viem';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { syncInventory } from './indexer.js';
import { ASSURANCE_POOL_VIEWS, assurancePoolLive, bondsLive, coopLive, deployedName, moneyAccountsLive, offersAddress, offersLive, readEach, type ChainCall, type ChainReader } from './onchain.js';
import { CL_OPERATING_BASE_SEPOLIA } from '../payoutFunding/topUp.js';
import contractsFx from '@clear/command-types/src/fixtures/contracts.json';
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
  // the Funding Rate now (annual WAD): r0, 2%, with nothing deployed
  fundingRate: '20000000000000000', decimals: '6',
  // what the YieldPoolLedger has accrued on the Deployed Balance (nothing deployed now: interest still unpaid)
  accruedInterest: usdc(1.25), deployedBalance: '0',
  cycleLength: '2592000', borrowedFromYield: '0', shortfall: usdc(140.6),
};
const held: Record<string, [number, number]> = { [getAddress(A)]: [800, 100], [getAddress(B)]: [400, 0], [getAddress(Cc)]: [200, 0] };
const asked: ChainCall[][] = [];
// the deployed rate model (annual WAD): r0 2%, s1 3% up to the kink at 80%, then s2 5% (10% at full utilization)
const WAD = 10n ** 18n;
const MODEL = [2n * 10n ** 16n, 3n * 10n ** 16n, 8n * 10n ** 17n, 5n * 10n ** 16n] as const;
/** The YieldPoolLedger's `_rate`: the contract's own, for the stand-in to answer `fundingRateAt(u)` with. */
const rateAt = (u: bigint) => {
  const [r0, s1, k, s2] = MODEL;
  if (u > WAD) u = WAD;
  return u <= k ? r0 + (s1 * u) / k : r0 + s1 + (s2 * (u - k)) / (WAD - k);
};
// Clear Lending's deployment account, and the CL Loss Reserve the AssurancePool pays draws to
const CL_DEPLOY = getAddress('0x00000000000000000000000000000000000000d1');
const LOSS_RESERVE = getAddress('0x00000000000000000000000000000000000000e1');
// the savings reserve: CLRUSD in issue, and the USDC the vault holds (50 cents short)
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

/** The Phase 2c AssurancePool's views, answered from a few figures (USDC, 6 decimals). */
function poolAnswer(
  c: ChainCall,
  v: { backstop: number; assurance: number; floor: number; coverage: number; pending?: number; draws?: [number, number, number][]; cap?: number; approvedUnpaid?: number },
): unknown {
  const keys = [stringToHex('CREDIT_BACKSTOP', { size: 32 }), stringToHex('MEMBER_ASSURANCE', { size: 32 })];
  switch (c.fn) {
    case 'asset':
      return USDC;
    case 'compartments':
      return keys;
    case 'balanceOf':
      return BigInt(usdc(c.args![0] === keys[0] ? v.backstop : v.assurance));
    case 'allocationOf':
      return 5000n;
    case 'backstopFloor':
      return BigInt(usdc(v.floor));
    case 'backstopBalance':
      return BigInt(usdc(v.backstop));
    case 'availableCoverage':
      return BigInt(usdc(v.coverage));
    case 'pendingDrawRequests':
      return BigInt(usdc(v.pending ?? 0));
    case 'drawCount':
      return BigInt(v.draws?.length ?? 0);
    case 'drawAt': {
      const [status, requested, approved] = v.draws![Number(c.args![0])];
      return { periodId: 1n, status, approver: USDC, requested: BigInt(usdc(requested)), approved: BigInt(usdc(approved)), evidenceHash: '0x' };
    }
    case 'paused':
      return false;
    case 'coverageCap':
      return BigInt(usdc(v.cap ?? 0));
    case 'approvedUnpaidDraws':
      return BigInt(usdc(v.approvedUnpaid ?? 0));
    case 'lossReserveAddress':
      return LOSS_RESERVE;
    default:
      return 0n;
  }
}
const reserve = { clrusd: 900, vault: 899.5 };
// the co-op's fee recipient (the Ops Safe) and the ClearCredit it holds
const SAFE = getAddress('0x52e6102b7c22eec7a68b11dd71fac7d6d9aecf50');
const feeTo = SAFE;
const reader: ChainReader = {
  read: async (calls) => {
    asked.push(calls);
    return calls.map((c) => {
      if (c.contract === 'ClearUSDUpgradeable') return c.fn === 'decimals' ? 6n : BigInt(usdc(reserve.clrusd));
      if ((c.contract === 'LendingPool' && c.fn === 'asset') || (c.contract === 'BurnerBond' && c.fn === 'underlyingToken')) return USDC;
      // BondVault: the bond buyers' money it holds, in the same token
      if (c.contract === 'BondVault')
        return c.fn === 'reserveToken' ? USDC : c.fn === 'requiredReserve' ? BigInt(usdc(90)) : c.fn === 'deployableExcess' ? BigInt(usdc(200.38)) : c.fn === 'minReserveBps' ? 3000n : c.fn === 'RESERVE_WINDOW' ? BigInt(90 * 86400) : BigInt(usdc(290.38));
      // the AssurancePool (Phase 2c): 125.03 in the Credit Backstop, nothing in Member Assurance
      if (c.contract === 'AssurancePool') return poolAnswer(c, { backstop: 125.03, assurance: 0, floor: 20, coverage: 105.03, cap: 500, approvedUnpaid: 12.5 });
      // the PayoutPool's claims due within 30 days: two, 80.25 together, 69.75 of it short
      if (c.contract === 'PayoutPool' && c.fn === 'dueWithin') return [[1n, 2n], BigInt(usdc(80.25)), BigInt(usdc(69.75))];
      // the PayoutPool's claims, the registry's shops and the credit book: none here (credit.test.ts reads them)
      // what the PayoutPool holds to pay them: the September half-dollar and the $10 the offers line settled
      if (c.contract === 'PayoutPool' && c.fn === 'held') return BigInt(usdc(10.5));
      if (c.contract === 'PayoutPool' && !(c.fn in views)) return c.fn === 'reserveToken' ? USDC : 0n;
      if (c.contract === 'MerchantRegistry') return 0n;
      // the $10 offers' line: 40 owed of a 1,000 cap, 20 of it not yet spent
      if (c.contract === 'OffersIssuer')
        return BigInt(usdc(({ owed: 40, cap: 1000, totalUnspent: 20, totalGranted: 50, totalExpired: 10, totalSettled: 0 } as Record<string, number>)[c.fn]));
      if (c.contract === 'ClearCredit' && c.fn === 'decimals') return 6n;
      if (c.contract === 'TermIssuer') return c.fn === 'feeRecipient' ? feeTo : c.fn === 'carryTreasury' ? payout : 0n;
      if (c.contract === 'ClearCredit' && c.fn === 'balanceOf') return BigInt(usdc(c.args![0] === SAFE ? 3.25 : c.args![0] === payout ? 9 : 0));
      if (c.contract === 'ERC20') {
        expect(c.address).toBe(USDC);
        if (c.fn === 'decimals') return 6n;
        // the savings vault's USDC, the Ops Safe's, the CL Loss Reserve's and CL Operating's
        const usdcOf: Record<string, number> = { [getAddress(C.ESADepositVault.address)]: reserve.vault, [SAFE]: 20, [LOSS_RESERVE]: 33.5, [getAddress(CL_OPERATING_BASE_SEPOLIA)]: 410 };
        expect(Object.keys(usdcOf)).toContain(c.args![0] as string);
        return BigInt(usdc(usdcOf[c.args![0] as string]));
      }
      if (c.fn === 'balanceOf') return BigInt(usdc(held[c.args![0] as string][0]));
      if (c.fn === 'encumberedOf') return BigInt(usdc(held[c.args![0] as string][1]));
      if (c.contract === 'LendingPool' && c.fn === 'rateModel') return [...MODEL];
      if (c.contract === 'LendingPool' && c.fn === 'fundingRateAt') return rateAt(c.args![0] as bigint);
      if (c.contract === 'LendingPool' && c.fn === 'deploymentAccount') return CL_DEPLOY;
      // no rate change waiting
      if (c.contract === 'LendingPool' && c.fn === 'pendingRate') return [0n, 0n, 0n, 0n, 0n, false];
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
  test('stands where the contract says; its rate is the Funding Rate the pool charges, annual', async () => {
    const m: any = await moneySection(db, read());
    // nothing deployed: the Funding Rate is r0, 2% a year, and holders earn that times a utilization of 0
    expect(m.Y).toMatchObject({ assets: 1406, principal: 1400, lent: 0, cash: 1406, queued: 0, earned: 6, util: 0, borrowBps: 200, supplyBps: 0, apy: 0, apr: 0.02, cycleDays: 30, opened: '15 Oct', depositors: 3 });
    // the carry members pay stays apart, for "Where member payments go"; no credit is out here
    expect(m.Y.rates?.bookBps ?? null).toBeNull();
    // the deployed model, annual fractions
    expect(m.Y.curve).toEqual({ r0: 0.02, s1: 0.03, k: 0.8, s2: 0.05 });
    // fundingRateAt at 50, 80, 90 and 100%, now (0) and after the next Deployment (10%): the contract's, not a formula here
    expect(m.Y.rateAt).toEqual({ 5000: 387.5, 8000: 500, 9000: 750, 10000: 1000, 0: 200, 1000: 237.5 });
    expect(m.Y.apyAfter).toBeCloseTo(0.002375, 12);
    expect([m.Y.pending, m.Y.accrued, m.Y.deployed]).toEqual([null, 1.25, 0]);
    expect(m.Y.price).toBeCloseTo(1406 / 1400, 10);
    // every read in one request: the pool's views, the cycle, the payout draw, and each holder's shares and pledge
    expect([...asked].reverse().find((a) => a.some((c) => c.fn === 'totalAssets'))!.length).toBe(12 + 3 * 2);
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
      read: async (calls) =>
        calls.map((c) =>
          c.fn === 'asset' ? USDC : c.fn === 'decimals' ? 6n : c.fn === 'fundingRate' ? 30416666666666667n : c.fn === 'rateModel' ? [30416666666666667n, 0n, 0n, 0n] : 0n,
        ),
    };
    const fresh = (await testDb()).db;
    await seedCommand(fresh);
    const m: any = await moneySection(fresh, { ...read(), chain: empty });
    expect(m.Y).toMatchObject({ assets: 0, util: 0, utilAfter: 0, price: 1, depositors: 0, opened: '—', cycleDays: 30 });
    expect([m.YD, m.Y_ASSETS, m.Y_DEP]).toEqual([['23 Oct'], [0], []]);
  });

  test('a rate change waiting out its notice comes with when it applies and whether it lowers the rate', async () => {
    // r0 down to 1.5% from 1 Dec: a lowering, so 30 days' notice
    const effective = Date.parse('2026-12-01T00:00:00Z') / 1000;
    const waiting: ChainReader = {
      read: async (calls) => {
        const r = await reader.read(calls);
        return calls.map((c, i) => (c.fn === 'pendingRate' ? [15n * 10n ** 15n, MODEL[1], MODEL[2], MODEL[3], BigInt(effective), true] : r[i]));
      },
    };
    const m: any = await moneySection(db, { ...read(), chain: waiting });
    expect(m.Y.pending).toEqual({ r0: 0.015, s1: 0.03, k: 0.8, s2: 0.05, effectiveAt: effective * 1000, lowers: true });
  });

  test('a rate read that fails is null, never worked out from a formula', async () => {
    const broken: ChainReader = {
      read: async (calls) => {
        if (calls.some((c) => ['fundingRateAt', 'accruedInterest', 'pendingRate'].includes(c.fn))) throw new Error('execution reverted');
        return reader.read(calls);
      },
    };
    const m: any = await moneySection(db, { ...read(), chain: broken });
    // the Funding Rate itself is the pool's required read; what's missing is null, the rest still read one by one
    expect(m.Y).toMatchObject({ borrowBps: 200, rateAt: null, apyAfter: null, pending: null, accrued: null, deployed: 0 });
  });

  test('live with no reader says so', async () => {
    await expect(moneySection(db, { level: TOTALS, reveal: false, now: NOW })).rejects.toThrow(/PROVIDER_MONEY=live reads the chain/);
  });
});

describe('bonds, live', () => {
  test('every BurnerBond from its events: open ones with their holder, closed ones marked', async () => {
    const fresh = (await testDb()).db;
    const dbWas = db;
    db = fresh;
    try {
      await syncInventory(db);
      const mat = (iso: string) => String(Date.parse(iso) / 1000);
      // a mint's transfer lands before its BondMinted, as the contract emits them
      await put('BurnerBond', 'TransferSingle', { operator: A, from: ZERO, to: A, id: '1', value: '1' }, '01T10:00:00');
      await put('BurnerBond', 'BondMinted', { bondId: '1', creator: A, faceValue: usdc(100), maturityDate: mat('2027-04-01T00:00:00Z'), discountPercentage: '322', purchasePrice: usdc(96.78) }, '01T10:00:00');
      await put('BurnerBond', 'TransferSingle', { operator: B, from: ZERO, to: B, id: '2', value: '1' }, '02T10:00:00');
      await put('BurnerBond', 'BondMinted', { bondId: '2', creator: B, faceValue: usdc(250), maturityDate: mat('2026-12-01T00:00:00Z'), discountPercentage: '200', purchasePrice: usdc(245) }, '02T10:00:00');
      // bond 1 changes hands; bond 2 is redeemed
      await put('BurnerBond', 'TransferSingle', { operator: A, from: A, to: Cc, id: '1', value: '1' }, '10T10:00:00');
      await put('BurnerBond', 'BondRedeemed', { bondId: '2', redeemer: B, faceValue: usdc(250) }, '20T10:00:00');
      const bonds = await bondsLive(db, reader);
      expect(bonds.map((b) => [b.id, b.face, b.price, b.holder, b.closed])).toEqual([
        ['1', 100, 96.78, getAddress(Cc), false],
        ['2', 250, 245, getAddress(B), true],
      ]);
      expect(new Date(bonds[0].maturesAt).toISOString().slice(0, 10)).toBe('2027-04-01');
      // Money lists the open one: its term, the yearly rate its discount works out to, and who holds it
      const m: any = await moneySection(db, { level: 2 as any, reveal: false, now: NOW, chain: reader });
      expect(m.BONDS).toHaveLength(1);
      const [id, face, issued, matures, term, rate, holder] = m.BONDS[0];
      expect([id, face, issued, matures, term, holder]).toEqual(['BB-0001', 100, '1 Oct', '1 Apr 2027', 6, `${getAddress(Cc).slice(0, 6)}…${getAddress(Cc).slice(-4)}`]);
      expect(rate).toBe(6.7);
      expect(m.M.bonds).toBe(100);
      // at Totals, no holder leaves the server
      const t: any = await moneySection(db, { level: TOTALS, reveal: false, now: NOW, chain: reader });
      expect(t.BONDS[0][6]).toBe('');
    } finally {
      db = dbWas;
    }
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
    // which map contracts the indexer found: CreditPool isn't one
    expect(c.DEPLOYED).toContain('am');
    expect(c.DEPLOYED).toContain('cu');
    expect(c.DEPLOYED).not.toContain('cp');
  });

  test('a map name finds its deployed contract', () => {
    const d = new Set(['ClearUSD', 'ClearUSDUpgradeable', 'SavingsIntentFactory', 'RevolvingIssuer', 'RevolvingIssuerV1', 'AssurancePool', 'AssurancePoolV2', 'OffersIssuerPreAudit']);
    expect(['ClearUSD', 'SavingsIntent', 'RevolvingIssuer', 'CreditPool', 'AssurancePool', 'OffersIssuer'].map((x) => deployedName(x, d))).toEqual([
      'ClearUSDUpgradeable',
      'SavingsIntentFactory',
      'RevolvingIssuer',
      null,
      'AssurancePoolV2',
      // the old (PreAudit) record never stands for the map's OffersIssuer
      null,
    ]);
  });

  test('every name on the map resolves to its own deployment record', () => {
    const names = new Set(Object.keys(C));
    const map = (contractsFx as unknown as { contracts: string[][] }).contracts.map((c) => c[1]);
    expect(Object.fromEntries(map.map((n) => [n, deployedName(n, names)]).filter(([n, r]) => r !== n))).toEqual({
      ClearUSD: 'ClearUSDUpgradeable',
      AssurancePool: 'AssurancePoolV2',
      SavingsIntent: 'SavingsIntentFactory',
      FractionToken: 'FractionTokenFactory',
      // not deployed, or (SettlementForwarder) its record isn't on dev yet
      LegacyContactModule: null,
      CreditPool: null,
      FunctionalContractRegistry: null,
      CoopTransferAgent: null,
      SettlementForwarder: null,
    });
    // a retired copy never stands for a map name
    for (const n of map) expect(deployedName(n, names) ?? '').not.toMatch(/(PreAudit|Pre2f|Pre2d|Legacy|V1)$/);
  });
});

describe('Build’s map, its cards and Signing, live (brief update 2)', () => {
  const sh = (a: string) => `${getAddress(a).slice(0, 6)}…${getAddress(a).slice(-4)}`;
  const quiet = { env: {} };

  test('each contract carries who controls it, the AssurancePool is v2, and 37 of the 42 on the map are deployed: the fresh OffersIssuer among them, SettlementForwarder not until its record is on dev', async () => {
    const c: any = await contractsSection(db, { ...read(), jobs: quiet });
    const row = (id: string) => c.CTR.find((r: any[]) => r[0] === id);
    expect(c.CTR).toHaveLength(43);
    expect([row('am')[10], row('ca')[10], row('hd')[10], row('pc')[10], row('cp')[10]]).toEqual(['OPS', 'AG', 'H', 'R', '']);
    expect(row('ap')[5]).toBe(sh(C.AssurancePoolV2.address));
    expect(c.DEPLOYED).toContain('oi');
    const onMap = c.CTR.filter((r: any[]) => r[9] !== 'x').map((r: any[]) => r[0]);
    expect([c.DEPLOYED.filter((id: string) => onMap.includes(id)).length, onMap.length]).toEqual([37, 42]);
  });

  test('Timelocks and helpers, Retired and the timelocks, from the records by name', async () => {
    const c: any = await contractsSection(db, { ...read(), jobs: quiet });
    expect(c.TIMELOCKS).toEqual(['CreditTimelock', 'AssuranceTimelock', 'VaultTimelock', 'EarnTimelock']);
    // BurnerBondDeposit's record is the same contract as BurnerBondDepositPre2f's (one address): the inventory keeps
    // one name an address, the retired one, so it's counted among the earlier copies, not shown as a helper
    expect(C.BurnerBondDeposit.address).toBe(C.BurnerBondDepositPre2f.address);
    expect(c.CTR_AUX.map((r: string[]) => [r[0], r[1]])).toEqual(
      ['CreditTimelock', 'AssuranceTimelock', 'VaultTimelock', 'EarnTimelock', 'BurnerBondFactory', 'Create2Deployer'].map((n) => [n, sh(C[n].address)]),
    );
    expect(c.CTR_AUX[0].slice(2)).toEqual(['Holds the credit contracts’ upgrades and settings for 7 days', 'Clear Treasury Safe, as the Ops Safe']);
    expect(c.CTR_OLD).toEqual([
      ['OffersIssuer (old)', sh(C.OffersIssuerPreAudit.address), 'Replaced by the 17 Nov deploy'],
      ['AssurancePool v1', sh(C.AssurancePool.address), 'Replaced by AssurancePool v2'],
      ['ClearUSD v1', sh(C.ClearUSD.address), 'Replaced by the upgradeable ClearUSD'],
      ['AssuranceOracle', sh(C.AssuranceOracle.address), 'Off the money path since section 13'],
    ]);
    // ten PreAudit (less the old OffersIssuer, listed), four Pre2f, one Pre2d, five Legacy and RevolvingIssuerV1
    expect(c.CTR_OLD_N).toBe(21);
  });

  test('Security’s automatic jobs wait, each "Not on yet", until its switch is set', async () => {
    const c: any = await contractsSection(db, { ...read(), jobs: quiet });
    expect(c.AUTO.map((j: any) => [j.t, j.run[0], j.st, j.off[0]])).toEqual([
      ['Payout top-ups', 'Not on yet', 'wait', 'PAYOUT_TOPUP_ENABLED'],
      ['Assurance fee payer', 'Not on yet', 'wait', 'ASSURANCE_FEE_PAYER_ENABLED'],
      ['Payout funding keeper', 'Not on yet', 'wait', 'PAYOUT_KEEPER_ENABLED'],
      ['Settlement funding', 'Not on yet', 'wait', 'SETTLEMENT_FUNDING_ENABLED'],
    ]);
  });

  test('Signing is what the reader gives, untouched; a reader that fails says why without failing the section', async () => {
    const plan = { format: 'clear-signing-plan/1', steps: [{ id: 'C1d-1', b: 1, a: 2 }] };
    const c: any = await contractsSection(db, { ...read(), jobs: quiet, signing: async () => ({ source: 'plan', file: 'deployments/base-sepolia/signing-plan.json', plan: plan as any, readAt: 1 }) });
    expect(JSON.stringify(c.SIGNING.plan.steps)).toBe(JSON.stringify(plan.steps));
    const bad: any = await contractsSection(db, { ...read(), jobs: quiet, signing: async () => Promise.reject(new Error('GitHub 503')) });
    expect([bad.SIGNING.source, bad.SIGNING.plan, bad.SIGNING.problem]).toEqual(['none', null, 'GitHub 503']);
    // no reader, no Signing: the client keeps the reference's
    expect((await contractsSection(db, { ...read(), jobs: quiet }) as any).SIGNING).toBeUndefined();
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

describe('the AssurancePool, live (Phase 2c)', () => {
  const pool = (v: Parameters<typeof poolAnswer>[1]): ChainReader => ({
    read: async (calls) => calls.map((c) => (c.fn === 'decimals' ? 6n : poolAnswer(c, v))),
  });

  test('two compartments, the backstop’s floor and the coverage it leaves, from the contract', async () => {
    const a = await assurancePoolLive(pool({ backstop: 300, assurance: 120.5, floor: 250, coverage: 40, pending: 10, draws: [[1, 30, 20]] }));
    expect(a).toMatchObject({
      total: 420.5,
      compartments: [
        { key: 'CREDIT_BACKSTOP', balance: 300, allocationBps: 5000 },
        { key: 'MEMBER_ASSURANCE', balance: 120.5, allocationBps: 5000 },
      ],
      floor: 250,
      backstop: 300,
      coverage: 40,
      pendingDraws: 10,
      paused: false,
    });
    expect(a.draws).toEqual([{ id: 0, status: 'Requested', requested: 30, approved: 20 }]);
  });

  test('read with the inline views, never the retired pool’s RTD or buffer', async () => {
    const seen: ChainCall[] = [];
    await assurancePoolLive({ read: async (calls) => (seen.push(...calls), calls.map((c) => (c.fn === 'decimals' ? 6n : poolAnswer(c, { backstop: 1, assurance: 1, floor: 0, coverage: 1 })))) });
    const fns = seen.filter((c) => c.contract === 'AssurancePool').map((c) => c.fn);
    expect(fns).toContain('backstopFloor');
    expect(fns).toContain('availableCoverage');
    expect(fns).not.toContain('RTD');
    expect(fns).not.toContain('bufferBalance');
    expect(seen.filter((c) => c.contract === 'AssurancePool').every((c) => Array.isArray(c.abi))).toBe(true);
  });

  test('every inline view is in AssurancePool.sol, argument for argument', () => {
    let solidity = '';
    try {
      solidity = readFileSync(new URL('../../../../../contracts/peripherals/AssurancePool.sol', import.meta.url), 'utf8');
    } catch {
      return;
    }
    for (const f of ASSURANCE_POOL_VIEWS) {
      const name = (f as { name: string }).name;
      // a public getter, or a function of that name
      expect(solidity).toMatch(new RegExp(`(function ${name}\\(|public ${name};| public ${name}\\b)`));
    }
    expect(solidity).toContain('function balanceOf(bytes32 compartment) public view');
    expect(solidity).toContain('function drawAt(uint256 drawId) external view returns (Draw memory)');
  });

  test('the Payout pool account is what the PayoutPool holds, as the cash flow chart reads it', async () => {
    const m: any = await moneySection(db, read());
    expect(m.M.payout).toBe(10.5);
    expect(m.ACCTS.find((a: any[]) => a[0] === 'pay')[5]).toBe(10.5);
  });

  test('what it holds is the contract’s: its compartments together, with the backstop’s floor and coverage', async () => {
    const m: any = await moneySection(db, read());
    expect(m.M.assurance).toBe(125.03);
    expect(m.ACCTS.find((a: any[]) => a[0] === 'ap')[5]).toBe(125.03);
    expect(m.AP_BAL.at(-1)).toBe(125.03);
    expect(m.M).toMatchObject({ backstop: 125.03, backstopFloor: 20, coverage: 105.03 });
    expect(m.figures['money.assurance'].compartments.map((c: any) => c.key)).toEqual(['CREDIT_BACKSTOP', 'MEMBER_ASSURANCE']);
    expect(m.figures['money.rtd']).toBeUndefined();
  });
});

describe('Money’s accounts beyond the pools, live (brief update 2)', () => {
  test('the AssurancePool’s compartments, cap, cover and unpaid draws; the CL Loss Reserve, CL Operating, the Treasury Safe and what’s due in 30 days', async () => {
    const was = process.env.COMMAND_SAFE_ADDRESS;
    process.env.COMMAND_SAFE_ADDRESS = SAFE;
    try {
      const m: any = await moneySection(db, read());
      expect(m.M).toMatchObject({ apBack: 125.03, apMem: 0, cap: 500, cover: 105.03, drawn: 12.5, lr: 33.5, clOp: 410, due30: 80.25, treasury: 20 });
      // not wired yet: Lithic's member cash, the Credit Settlement Account, and the book's monthly Spread and residual
      expect([m.M.memberCash, m.M.clSettle, m.M.spread, m.M.resid]).toEqual([null, null, null, null]);
    } finally {
      if (was == null) delete process.env.COMMAND_SAFE_ADDRESS;
      else process.env.COMMAND_SAFE_ADDRESS = was;
    }
  });

  test('CL Operating is PAYOUT_TOPUP_SAFE when it is set', async () => {
    const other = getAddress('0x00000000000000000000000000000000000000f9');
    const seen: string[] = [];
    const r: ChainReader = {
      read: async (calls) => calls.map((c) => (c.fn === 'decimals' ? 6n : c.fn === 'asset' ? USDC : c.fn === 'balanceOf' ? (seen.push(c.args![0] as string), BigInt(usdc(7))) : 0n)),
    };
    const a = await moneyAccountsLive(r, { clOperating: other, horizonSeconds: 30 * 86_400, maxClaims: 200 });
    expect(seen).toEqual([other]);
    // no AssurancePool to ask: its figures are null, not zero
    expect(a).toEqual({ cap: null, lossReserve: null, lr: null, clOp: 7, due30: null });
  });

  test('each read that fails is null; the rest still show', async () => {
    const was = process.env.COMMAND_SAFE_ADDRESS;
    delete process.env.COMMAND_SAFE_ADDRESS;
    const broken: ChainReader = {
      read: async (calls) => {
        if (calls.some((c) => ['coverageCap', 'dueWithin'].includes(c.fn) || (c.contract === 'ERC20' && c.fn === 'balanceOf' && c.args![0] === LOSS_RESERVE))) throw new Error('execution reverted');
        return reader.read(calls);
      },
    };
    try {
      const m: any = await moneySection(db, { ...read(), chain: broken });
      expect(m.M).toMatchObject({ apBack: 125.03, cap: null, due30: null, lr: null, clOp: 410, treasury: null });
    } finally {
      if (was != null) process.env.COMMAND_SAFE_ADDRESS = was;
    }
  });

  test('with the AssurancePool unreadable, its figures are null', async () => {
    const broken: ChainReader = { read: async (calls) => (calls.some((c) => c.contract === 'AssurancePool') ? Promise.reject(new Error('execution reverted')) : reader.read(calls)) };
    const m: any = await moneySection(db, { ...read(), chain: broken });
    expect([m.M.apBack, m.M.apMem, m.M.cap, m.M.cover, m.M.drawn, m.M.lr]).toEqual([null, null, null, null, null, null]);
    expect(m.M.due30).toBe(80.25);
  });

  test('readEach: one request when it goes through; one by one, a failure null, when it doesn’t', async () => {
    let requests = 0;
    const r: ChainReader = {
      read: async (calls) => {
        requests++;
        if (calls.some((c) => c.fn === 'bad')) throw new Error('execution reverted');
        return calls.map((c) => c.fn);
      },
    };
    expect(await readEach(r, [{ contract: 'X', fn: 'a' }, { contract: 'X', fn: 'b' }])).toEqual(['a', 'b']);
    expect(requests).toBe(1);
    expect(await readEach(r, [{ contract: 'X', fn: 'a' }, { contract: 'X', fn: 'bad' }])).toEqual(['a', null]);
    expect(requests).toBe(4);
  });
});

describe('the co-op’s balance, live', () => {
  test('is the USDC the Ops Safe holds; its ClearCredit is read but not counted', async () => {
    const c = await coopLive(reader, SAFE.toLowerCase());
    expect(c).toEqual({ holder: SAFE, usdc: 20, credit: 3.25, balance: 20, weeks: [20, 20, 20, 20, 20, 20, 20] });
  });

  test('Money reads it from the Ops Safe: the account, its purpose, and the claim apart', async () => {
    const was = process.env.COMMAND_SAFE_ADDRESS;
    process.env.COMMAND_SAFE_ADDRESS = SAFE;
    try {
      const m: any = await moneySection(db, read());
      expect(m.M.coop).toBe(20);
      const row = m.ACCTS.find((a: any[]) => a[0] === 'coop');
      expect([row[2], row[4], row[5], row[6].at(-1)]).toEqual(['USDC in the Ops Safe, spent by a member vote', 'protocol', 20, 20]);
      expect(m.COOP).toEqual({ holder: SAFE, safe: true, usdc: 20, credit: 3.25 });
    } finally {
      if (was == null) delete process.env.COMMAND_SAFE_ADDRESS;
      else process.env.COMMAND_SAFE_ADDRESS = was;
    }
  });

  test('without an Ops Safe there’s no treasury to read', async () => {
    const was = process.env.COMMAND_SAFE_ADDRESS;
    delete process.env.COMMAND_SAFE_ADDRESS;
    try {
      const m: any = await moneySection(db, read());
      expect(m.COOP).toBeNull();
    } finally {
      if (was != null) process.env.COMMAND_SAFE_ADDRESS = was;
    }
  });
});

describe('the $10 offers’ line, live', () => {
  // The pre-audit OffersIssuer is retired and none was deployed with the fresh credit stack (decision 47),
  // so the chain record has no OffersIssuer: the line reads as not there, never as the retired one's.
  test('reads what the co-op owes on the deployed OffersIssuer, and Money sends it; nothing while none is deployed', async () => {
    if (!C.OffersIssuer) {
      expect(offersAddress()).toBeNull();
      expect(await offersLive(reader)).toBeNull();
      const m: any = await moneySection(db, read());
      expect(m.OFFERS ?? null).toBeNull();
      return;
    }
    expect(offersAddress()).toBe(C.OffersIssuer.address.toLowerCase());
    expect(await offersLive(reader)).toEqual({ owed: 40, cap: 1000, unspent: 20, granted: 50, expired: 10, settled: 0 });
    const m: any = await moneySection(db, read());
    expect(m.OFFERS).toEqual({ owed: 40, cap: 1000, unspent: 20, granted: 50, expired: 10, settled: 0 });
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

describe('who can do what, live', () => {
  test('replayed from the grants and revokes: admins and owners, pausers, issuers, shop-terms operators and the AssurancePool’s callers', async () => {
    const SAFE = '0x00000000000000000000000000000000000005af',
      EOA = '0x00000000000000000000000000000000000000ee';
    const { keccak256, toHex } = await import('viem');
    const ADMIN = `0x${'0'.repeat(64)}`;
    await put('ClearCredit', 'RoleGranted', { role: ADMIN, account: SAFE, sender: EOA }, '01T09:00:00');
    await put('RevolvingIssuer', 'OwnershipTransferred', { previousOwner: ZERO, newOwner: SAFE }, '01T09:00:00');
    // an operator granted and then revoked holds nothing
    await put('MerchantRegistry', 'RoleGranted', { role: keccak256(toHex('OPERATOR_ROLE')), account: EOA, sender: SAFE }, '02T09:00:00');
    await put('MerchantRegistry', 'RoleGranted', { role: keccak256(toHex('OPERATOR_ROLE')), account: SAFE, sender: SAFE }, '02T09:00:00');
    await put('MerchantRegistry', 'RoleRevoked', { role: keccak256(toHex('OPERATOR_ROLE')), account: EOA, sender: SAFE }, '03T09:00:00');
    await put('NetworkRegistry', 'IssuerRegistered', { issuer: C.RevolvingIssuer.address, stableCredit: C.ClearCredit.address, assurancePool: ZERO, assuranceOracle: ZERO }, '03T09:00:00');
    await put('AssurancePool', 'WithdrawalCallerUpdated', { caller: C.ClearCredit.address, allowed: 'true' }, '04T09:00:00');
    const { keyRolesLive } = await import('./onchain.js');
    const r = await keyRolesLive(db, SAFE);
    expect(r.holders).toEqual(['Ops Safe', 'ClearCredit', 'RevolvingIssuer']);
    expect(Object.fromEntries(r.roles)).toEqual({
      'Upgrade and admin': [1, 0, 0],
      // the Safe owns RevolvingIssuer, so it can pause it
      Pause: [1, 0, 0],
      'Mint credit': [0, 0, 1],
      'Run credit operations': [0, 0, 0],
      'Set shop terms': [1, 0, 0],
      'Claim from AssurancePool': [0, 1, 0],
    });
  });

  test('past six holders, the ones with fewest powers share a column', async () => {
    const { keyRolesLive } = await import('./onchain.js');
    const ADMIN = `0x${'0'.repeat(64)}`;
    for (let i = 1; i <= 7; i++) await put('BondVault', 'RoleGranted', { role: ADMIN, account: `0x${String(i).padStart(40, '7')}`, sender: ZERO }, '05T09:00:00');
    const r = await keyRolesLive(db, null);
    expect(r.holders).toHaveLength(6);
    expect(r.holders.at(-1)).toMatch(/^\d+ others$/);
    expect(r.roles.every(([, h]) => h.length === 6)).toBe(true);
  });
});

describe('is it what dev compiles', () => {
  test('a fingerprint masks the immutables and cuts the metadata off, so two deployments of one source match', async () => {
    const { codeFingerprint } = await import('./onchain.js');
    // 6080 | 2 immutable bytes | 60 00 | metadata a1 b2 (2 bytes long: 0002)
    const one = '0x6080' + 'aaaa' + '6000' + 'a1b2' + '0002';
    const two = '0x6080' + 'bbbb' + '6000' + 'c3d4' + '0002';
    expect(codeFingerprint(one, [[2, 2]])).toBe(codeFingerprint(two, [[2, 2]]));
    // a change anywhere else is a different fingerprint
    expect(codeFingerprint('0x6080aaaa6001a1b20002', [[2, 2]])).not.toBe(codeFingerprint(one, [[2, 2]]));
  });

  test('each deployed contract’s code against its fingerprint: same, different, or left out when it can’t be read', async () => {
    const { codeMatchLive, codeFingerprint, forgetCodeMatch } = await import('./onchain.js');
    const deployed = '0x6080aaaa6000a1b20002';
    const fingerprints = {
      LendingPool: { sha256: codeFingerprint('0x6080bbbb6000c3d40002', [[2, 2]]), immutables: [[2, 2]] as Array<[number, number]> },
      PayoutPool: { sha256: codeFingerprint('0x6080bbbb6001c3d40002', [[2, 2]]), immutables: [[2, 2]] as Array<[number, number]> },
      ClearCredit: { sha256: 'x', immutables: [] },
    };
    forgetCodeMatch();
    const asked: string[] = [];
    const reader = {
      read: async () => [],
      codeOf: async (address: string) => {
        asked.push(address);
        if (address === C.ClearCredit.address) throw new Error('unreadable');
        return { implementation: address, code: deployed };
      },
    };
    const same = await codeMatchLive(reader as any, NOW.getTime(), fingerprints);
    expect(Object.fromEntries(same)).toEqual({ LendingPool: true, PayoutPool: false });
    // read once, then kept for ten minutes
    await codeMatchLive(reader as any, NOW.getTime() + 60e3, fingerprints);
    expect(asked).toHaveLength(3);
    forgetCodeMatch();
  });

  test('a clone (EIP-1167) is compared by what it forwards to, not its own 45 bytes', async () => {
    const { codeMatchLive, codeFingerprint, cloneTarget, forgetCodeMatch } = await import('./onchain.js');
    const impl = getAddress('0xe7f9884e921372bb5161c2adf5ca95c8e4b4488b');
    const clone = `0x363d3d373d3d3d363d73${impl.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
    expect(cloneTarget(clone)).toBe(impl);
    expect(cloneTarget('0x6080aaaa6000a1b20002')).toBeNull();
    const compiled = '0x6080bbbb6000c3d40002';
    const fingerprints = {
      BurnerBond: { sha256: codeFingerprint(compiled, [[2, 2]]), immutables: [[2, 2]] as Array<[number, number]> },
      BurnerBondDeposit: { sha256: codeFingerprint(compiled, [[2, 2]]), immutables: [[2, 2]] as Array<[number, number]> },
    };
    forgetCodeMatch();
    const reader = {
      read: async () => [],
      // BurnerBond's clone forwards to code dev compiles; BurnerBondDeposit's to something else
      codeOf: async (address: string) =>
        address === impl ? { implementation: address, code: '0x6080aaaa6000a1b20002' }
        : address === C.BurnerBond.address ? { implementation: address, code: clone }
        : { implementation: address, code: `0x363d3d373d3d3d363d73${'11'.repeat(20)}5af43d82803e903d91602b57fd5bf3` },
    };
    const same = await codeMatchLive(reader as any, NOW.getTime(), fingerprints);
    expect(Object.fromEntries(same)).toEqual({ BurnerBond: true, BurnerBondDeposit: false });
    forgetCodeMatch();
  });
});
