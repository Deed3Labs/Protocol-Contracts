import { beforeAll, describe, expect, test } from 'bun:test';
import chain from '@clear/command-types/src/chain/base-sepolia.json';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { creditLive, memberLabel, payoutsLive } from './credit.js';
import type { ChainCall, ChainReader } from './onchain.js';

/*
 * Money's on-chain book: the PayoutPool's unpaid claims as payments out, the members' plan
 * installments and revolving balances as payments in, the month from the events, how late
 * balances are, and what was written off.
 */

const C = chain.contracts as Record<string, { address: string }>;
const DAY = 86400e3;
const NOW = Date.parse('2026-10-23T17:00:00Z');
const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const sec = (t: number) => BigInt(Math.floor(t / 1000));
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const SHOP = '0x00000000000000000000000000000000000000d4',
  OTHER = '0x00000000000000000000000000000000000000e5',
  A = '0x00000000000000000000000000000000000000a1',
  B = '0x00000000000000000000000000000000000000b2';

let db: Db;
let n = 0;
const put = (contract: string, event: string, args: Record<string, string>, t: number) =>
  db.query(
    `INSERT INTO command.chain_events (chain_id, block_number, block_hash, block_time, tx_hash, log_index, address, contract, event, args, topics, data)
     VALUES (84532, $1, '0x', $2, $3, $8, $4, $5, $6, $7, '{}', '0x')`,
    [++n, new Date(t).toISOString(), `0x${n.toString(16).padStart(64, '0')}`, C[contract].address.toLowerCase(), contract, event, JSON.stringify(args), n],
  );

// three claims: one paid, one due in five days (NET-14), one past due (NET-30)
const claims: Array<[string, bigint, bigint, bigint, boolean]> = [
  [SHOP, usdc(40), sec(NOW - 40 * DAY), sec(NOW - 26 * DAY), true],
  [SHOP, usdc(120.5), sec(NOW - 9 * DAY), sec(NOW + 5 * DAY), false],
  [OTHER, usdc(60), sec(NOW - 31 * DAY), sec(NOW - DAY), false],
];
// A has a plan (100 every 30 days, three of them, ten days in) and nothing revolving; B owes 50 on a card period that ended 40 days ago
const members: Record<string, { balance: number; limit: number; periodEnd: number; autopay: boolean; plans: bigint[] }> = {
  [A]: { balance: 300, limit: 500, periodEnd: NOW + 60 * DAY, autopay: false, plans: [7n] },
  [B]: { balance: 50, limit: 500, periodEnd: NOW - 40 * DAY, autopay: true, plans: [] },
};
const plan = { member: A, principal: usdc(300), outstanding: usdc(300), repaid: 0n, openedAt: sec(NOW - 10 * DAY), installments: 3, length: BigInt(30 * 86400), rate: 0n, closed: false };

const asked: ChainCall[] = [];
const reader: ChainReader = {
  read: async (calls) => {
    asked.push(...calls);
    return calls.map((c) => {
      const a = String(c.args?.[0] ?? '').toLowerCase();
      if (c.contract === 'ERC20') return 6n;
      if (c.contract === 'PayoutPool')
        return { claimCount: 3n, nextUnpaid: 1n, held: usdc(100), queuedTotal: usdc(180.5), shortfall: usdc(80.5), reserveToken: USDC, redeemableOf: a === SHOP ? usdc(25) : 0n, claimAt: c.args ? claims[Number(c.args[0])] : undefined }[c.fn];
      if (c.contract === 'MerchantRegistry') return c.fn === 'merchantCount' ? 2n : [SHOP, OTHER][Number(c.args![0])];
      if (c.contract === 'ClearCredit')
        return c.fn === 'decimals' ? 6n : c.fn === 'creditBalanceOf' ? usdc(members[a].balance) : usdc(members[a].limit);
      if (c.contract === 'RevolvingIssuer') return c.fn === 'periodExpirationOf' ? sec(members[a].periodEnd) : members[a].autopay;
      if (c.contract === 'TermIssuer') {
        if (c.fn === 'plansOf') return members[a].plans;
        if (c.fn === 'planAt') return [plan.member, plan.principal, plan.outstanding, plan.repaid, plan.openedAt, plan.installments, plan.length, plan.rate, plan.closed];
        if (c.fn === 'scheduleOf') return [usdc(100), usdc(300), 3, sec(NOW - 10 * DAY)];
        if (c.fn === 'delinquentSince') return 0n;
      }
      throw new Error(`no answer for ${c.contract}.${c.fn}`);
    });
  },
};

beforeAll(async () => {
  ({ db } = await testDb());
  for (const m of [A, B]) await put('ClearCredit', 'CreditLineCreated', { member: m, creditLimit: String(usdc(500)), balance: '0' }, NOW - 60 * DAY);
  // this month: a sale at the shop and part of it reversed, a card spend settled, carry, a repayment
  await put('ClearCredit', 'PurchaseOriginated', { member: A, merchant: SHOP, purchase: String(usdc(200)), payout: String(usdc(195)), discount: String(usdc(5)) }, NOW - 5 * DAY);
  await put('ClearCredit', 'PurchaseReversed', { member: A, merchant: SHOP, purchase: String(usdc(20)), payout: String(usdc(19.5)), discount: String(usdc(0.5)) }, NOW - 4 * DAY);
  await put('RevolvingIssuer', 'CardSpendSettled', { ref: '0x01', member: B, amount: String(usdc(50)) }, NOW - 3 * DAY);
  await put('ClearCredit', 'CarryAccrued', { member: A, recipient: OTHER, amount: String(usdc(3)) }, NOW - 2 * DAY);
  await put('ClearCredit', 'CreditBalanceRepaid', { member: B, amount: String(usdc(25)) }, NOW - DAY);
  // last month: a sale (not this month's) and a line written off, the AssurancePool paying for it
  await put('ClearCredit', 'PurchaseOriginated', { member: B, merchant: OTHER, purchase: String(usdc(999)), payout: '0', discount: '0' }, Date.parse('2026-09-20T10:00:00Z'));
  await put('ClearCredit', 'CreditLineWrittenOff', { member: B, amount: String(usdc(80)) }, Date.parse('2026-09-30T10:00:00Z'));
  await put('AssurancePool', 'AccountReimbursed', { account: B, amount: String(usdc(80)) }, Date.parse('2026-09-30T10:00:00Z'));
  // the $10 offers' own line, and an unspent offer of A's taken back: neither is members' credit
  const offers = String(C.OffersIssuer.address);
  await put('ClearCredit', 'CreditLineCreated', { member: offers, creditLimit: String(usdc(1000)), balance: '0' }, NOW - 30 * DAY);
  await put('ClearCredit', 'PurchaseReversed', { member: offers, merchant: A, purchase: String(usdc(6)), payout: String(usdc(6)), discount: '0' }, NOW - 2 * DAY);
});

describe('what the PayoutPool owes shops', () => {
  test('the unpaid claims from the first unpaid one, as payments out by when they’re due; a past-due one is due today', async () => {
    const p = await payoutsLive(db, reader, NOW);
    // the paid claim before nextUnpaid isn't read
    expect(asked.filter((c) => c.fn === 'claimAt').map((c) => c.args![0])).toEqual([1n, 2n]);
    expect(p.claims.map((c) => [c.id, c.amount, c.paid])).toEqual([[1, 120.5, false], [2, 60, false]]);
    expect(p.out).toEqual([
      [5, 'out', 120.5, `Shop 0x0000…00d4`, 'NET-14 payout · claim #1'],
      [0, 'out', 60, `Shop 0x0000…00e5`, 'NET-30 payout · claim #2'],
    ]);
    expect([p.held, p.queued, p.shortfall, p.owed14, p.unredeemed]).toEqual([100, 180.5, 80.5, 180.5, 25]);
  });
});

describe('what members owe', () => {
  test('the month from the events: owed on the 1st + spent + carry − repaid is owed now', async () => {
    const c = await creditLive(db, reader, NOW);
    expect([c.members, c.credit, c.limits, c.month]).toEqual([2, 350, 1000, 'October']);
    // a sale less its reversal, and card spend; last month's sale isn't this month's
    expect([c.spent, c.carry, c.repaid]).toEqual([230, 3, 25]);
    expect(c.start).toBe(142);
    expect(c.start + c.spent + c.carry - c.repaid).toBe(c.credit);
    expect(c.shops).toEqual([['Shop 0x0000…', 180, 0]]);
    expect(c.autopay).toBe(1);
    expect(c.owing).toBe(2);
    expect(c.limitSizes).toEqual([['$500', 2]]);
  });

  test('how late: a plan on time is current; a card period ended 40 days ago unpaid is 31–60', async () => {
    const c = await creditLive(db, reader, NOW);
    expect(c.aging).toEqual([['Current', 300], ['1–30 days', 0], ['31–60 days', 50], ['Over 60', 0]]);
    expect(c.late).toBe(1);
  });

  test('due in 30 days: the plan’s next installment, and the card balance already due today, on autopay', async () => {
    const c = await creditLive(db, reader, NOW);
    expect(c.in).toEqual([
      [0, 'in', 50, 'Member repayments', '1 card balance · 1 on autopay'],
      [20, 'in', 100, 'Member repayments', '1 plan installment'],
    ]);
    expect(c.due14).toBe(50);
  });

  test('losses, all time, named only by the last of their address; what the AssurancePool paid', async () => {
    const c = await creditLive(db, reader, NOW);
    expect(c.losses).toEqual([[-23, memberLabel(B), expect.any(String), 80]]);
    expect(memberLabel(B)).toBe('Member M•••00b2');
    expect([c.lost, c.poolPaid]).toEqual([80, 80]);
  });
});
