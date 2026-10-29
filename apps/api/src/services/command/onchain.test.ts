import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import chain from '@clear/command-types/src/chain/base-sepolia.json';
import { getAddress } from 'viem';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { syncInventory } from './indexer.js';
import { assurancePoolLive, bondsLive, coopLive, deployedName, type ChainCall, type ChainReader } from './onchain.js';
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
// the co-op's fee recipient (the Ops Safe) and the ClearCredit it holds
const SAFE = getAddress('0x52e6102b7c22eec7a68b11dd71fac7d6d9aecf50');
let feeTo = SAFE;
const reader: ChainReader = {
  read: async (calls) => {
    asked.push(calls);
    return calls.map((c) => {
      if (c.contract === 'ClearUSDUpgradeable') return c.fn === 'decimals' ? 6n : BigInt(usdc(reserve.clrusd));
      if ((c.contract === 'LendingPool' && c.fn === 'asset') || (c.contract === 'BurnerBond' && c.fn === 'underlyingToken')) return USDC;
      // BondVault: the bond buyers' money it holds, in the same token
      if (c.contract === 'BondVault')
        return c.fn === 'reserveToken' ? USDC : c.fn === 'requiredReserve' ? BigInt(usdc(90)) : c.fn === 'deployableExcess' ? BigInt(usdc(200.38)) : c.fn === 'minReserveBps' ? 3000n : c.fn === 'reserveWindow' ? BigInt(90 * 86400) : BigInt(usdc(290.38));
      // the AssurancePool: all of it in the buffer reserve, as on Base Sepolia
      if (c.contract === 'AssurancePool')
        return c.fn === 'reserveToken' ? USDC : c.fn === 'bufferBalance' ? BigInt(usdc(125.03)) : c.fn === 'targetRTD' ? 800_000_000_000_000_000n : c.fn === 'hasValidRTD' ? true : 0n;
      // the PayoutPool's claims, the registry's shops and the credit book: none here (credit.test.ts reads them)
      if (c.contract === 'PayoutPool' && !(c.fn in views)) return c.fn === 'reserveToken' ? USDC : 0n;
      if (c.contract === 'MerchantRegistry') return 0n;
      if (c.contract === 'ClearCredit' && c.fn === 'decimals') return 6n;
      if (c.contract === 'TermIssuer') return c.fn === 'feeRecipient' ? feeTo : c.fn === 'carryTreasury' ? payout : 0n;
      if (c.contract === 'ClearCredit' && c.fn === 'balanceOf') return BigInt(usdc(c.args![0] === SAFE ? 3.25 : c.args![0] === payout ? 9 : 0));
      if (c.contract === 'ERC20') {
        expect(c.address).toBe(USDC);
        if (c.fn === 'decimals') return 6n;
        // the savings vault's USDC, and the Ops Safe's
        expect([getAddress(C.ESADepositVault.address), SAFE]).toContain(c.args![0]);
        return BigInt(usdc(c.args![0] === SAFE ? 20 : reserve.vault));
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

describe('the AssurancePool, live', () => {
  // a pool reading what it's told: its reserves, target, exposure (credit decimals 18, reserve 6)
  const pool = (v: { primary: number; buffer?: number; target: number; exposure: number }): ChainReader => ({
    read: async (calls) =>
      calls.map((c) => {
        if (c.fn === 'reserveToken') return USDC;
        if (c.fn === 'decimals') return 6n;
        if (c.fn === 'primaryBalance') return BigInt(usdc(v.primary));
        if (c.fn === 'bufferBalance') return BigInt(usdc(v.buffer ?? 0));
        if (c.fn === 'targetRTD') return BigInt(Math.round(v.target * 1e6)) * 10n ** 12n;
        if (c.fn === 'poolExposure') return BigInt(Math.round(v.exposure * 1e6)) * 10n ** 12n;
        if (c.fn === 'convertStableCreditToReserveToken') return (c.args![0] as bigint) / 10n ** 12n;
        if (c.fn === 'RTD') return v.exposure ? (BigInt(usdc(v.primary)) * 10n ** 18n) / BigInt(usdc(v.exposure)) : 0n;
        if (c.fn === 'hasValidRTD') return !v.exposure || v.primary / v.exposure >= v.target;
        return 0n;
      }),
  });

  test('with nothing out, RTD is undefined and the pool is at its target, whatever it holds', async () => {
    const a = await assurancePoolLive(pool({ primary: 0, buffer: 125.03, target: 0.8, exposure: 0 }));
    expect(a).toMatchObject({ total: 125.03, primary: 0, buffer: 125.03, target: 0.8, exposure: 0, rtd: null, valid: true, gap: 0, room: 0 });
  });

  test('with credit out: RTD on the primary reserve alone, how far above or below target in dollars, and the room left', async () => {
    const above = await assurancePoolLive(pool({ primary: 200, buffer: 50, target: 0.8, exposure: 100 }));
    expect(above).toMatchObject({ rtd: 2, valid: true, gap: 120, room: 150 });
    const below = await assurancePoolLive(pool({ primary: 40, target: 0.8, exposure: 100 }));
    expect(below).toMatchObject({ rtd: 0.4, valid: false, gap: -40, room: 0 });
  });

  test('what it holds is the contract’s: primary, buffer and excess reserves together', async () => {
    const m: any = await moneySection(db, read());
    expect(m.M.assurance).toBe(125.03);
    expect(m.ACCTS.find((a: any[]) => a[0] === 'ap')[5]).toBe(125.03);
    // the weekly series ends on it, and RTD has no unsecured credit to divide by
    expect(m.AP_BAL.at(-1)).toBe(125.03);
    expect(Number.isFinite(m.M.rtd)).toBe(true);
  });
});

describe('the co-op’s balance, live', () => {
  test('is the ClearCredit its fee recipient holds, the Ops Safe, with its weeks from the transfers', async () => {
    await put('ClearCredit', 'Transfer', { from: ZERO, to: SAFE, value: usdc(1) }, '05T10:00:00');
    await put('ClearCredit', 'Transfer', { from: ZERO, to: SAFE, value: usdc(2.25) }, '20T10:00:00');
    const c = await coopLive(db, reader, NOW.getTime());
    expect(c).toMatchObject({ recipient: SAFE, holder: SAFE, clrusd: 3.25, usdc: 0, balance: 3.25 });
    // weeks end on the 3rd, 10th and 17th: nothing, then the 1.00, then still 1.00; the 2.25 of the 20th shows now
    expect(c.weeks.slice(-4)).toEqual([0, 1, 1, 3.25]);
  });

  test('with the Ops Safe set, its USDC counts too, held flat through the weeks (USDC isn’t indexed)', async () => {
    const c = await coopLive(db, reader, NOW.getTime(), SAFE.toLowerCase());
    expect(c).toMatchObject({ holder: SAFE, usdc: 20, clrusd: 3.25, balance: 23.25 });
    expect(c.weeks.slice(-4)).toEqual([20, 21, 21, 23.25]);
  });

  test('the Ops Safe is whose holdings count, even when the fee goes somewhere else', async () => {
    feeTo = getAddress(ZERO);
    try {
      const c = await coopLive(db, reader, NOW.getTime(), SAFE);
      expect(c).toMatchObject({ recipient: payout, holder: SAFE, balance: 23.25 });
    } finally {
      feeTo = SAFE;
    }
  });

  test('with no fee recipient set, the fee goes to the carry treasury, as the contract pays it', async () => {
    feeTo = getAddress(ZERO);
    try {
      expect((await coopLive(db, reader, NOW.getTime())).recipient).toBe(payout);
    } finally {
      feeTo = SAFE;
    }
  });

  test('Money reads it: the account, its purpose, and that the Ops Safe holds it', async () => {
    const was = process.env.COMMAND_SAFE_ADDRESS;
    process.env.COMMAND_SAFE_ADDRESS = SAFE;
    try {
      const m: any = await moneySection(db, read());
      expect(m.M.coop).toBe(23.25);
      const row = m.ACCTS.find((a: any[]) => a[0] === 'coop');
      expect([row[2], row[4], row[5], row[6].at(-1)]).toEqual(['USDC and fees in the Ops Safe, spent by a member vote', 'protocol', 23.25, 23.25]);
      expect(m.COOP).toEqual({ recipient: SAFE, holder: SAFE, safe: true, usdc: 20, clrusd: 3.25 });
    } finally {
      if (was == null) delete process.env.COMMAND_SAFE_ADDRESS;
      else process.env.COMMAND_SAFE_ADDRESS = was;
    }
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
});
