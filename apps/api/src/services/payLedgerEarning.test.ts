import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';

/*
 * The earning rules: rent and bills earn 2% (at most 50 a bill) times the streak multiplier, and only
 * when paid on Clear Rails; a returned payment's credits are voided until minted; saving credits stop at
 * 54,000 and outside the member's first 36 months. Against PGlite, because the rules are sums and keys.
 */

const pg = new PGlite();
const pool = {
  query: async (text: string, params?: unknown[]) => {
    if (!params?.length && text.includes(';')) {
      await pg.exec(text);
      return { rows: [], rowCount: 0 };
    }
    const r = await pg.query(text, params as any[]);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
};
const joined = new Map<string, Date>();
mock.module('../config/postgres.js', () => ({ getPostgresPool: () => pool, getPayPool: () => pool, closePostgresPool: async () => {} }));
mock.module('./notificationStore.js', () => ({ notificationStore: { emit: async () => {} } }));
mock.module('./memberStore.js', () => ({
  memberStore: {
    getJoinedAtByWallet: async (w: string) => joined.get(w) ?? null,
    getMembershipPlanByWallet: async () => 'LIFETIME', // an Accelerated member: must change nothing
  },
}));
process.env.SEND_CONTACT_ENCRYPTION_KEY ||= `hex:${'33'.repeat(32)}`;

const { payLedgerStore, creditAmount, rewardMultiplier, inMatchPeriod } = await import('./payLedgerStore');

let w = 0;
const wallet = () => `0x${String(++w).padStart(40, 'e')}`;
let n = 0;
const tx = () => `ref${++n}`;
const today = () => new Date().toISOString().slice(0, 10);

function pay(who: string, amount: number, source: 'clear_rails' | 'manual' | 'detected', txRef = tx(), billerId: string | null = `b-${txRef}`) {
  return payLedgerStore.recordPayment({
    wallet: who,
    billerId,
    name: 'Power',
    type: 'utility',
    amount,
    dueDate: today(),
    period: new Date().toISOString().slice(0, 7),
    source,
    txRef,
    network: 'testnet',
  });
}

beforeAll(async () => {
  await payLedgerStore.getSummary(wallet(), 'testnet');
});

describe('rent and bill credits', () => {
  test('2% of the payment, rounded, at most 50 a bill before the multiplier', () => {
    expect(creditAmount(0, 120)).toBe(2); // 2.4
    expect(creditAmount(0, 1_400)).toBe(28);
    expect(creditAmount(0, 2_500)).toBe(50);
    expect(creditAmount(0, 9_000)).toBe(50);
    expect(creditAmount(12, 2_500)).toBe(75); // 1.5× at 12 months
  });

  test('the multiplier follows the streak alone', () => {
    expect(rewardMultiplier(0)).toBe(1);
    expect(rewardMultiplier(6)).toBe(1.25);
    expect(rewardMultiplier(12)).toBe(1.5);
    expect(rewardMultiplier(60)).toBe(1.5);
  });

  test('only a payment made on Clear Rails earns, whatever the member plan', async () => {
    const who = wallet();
    expect((await pay(who, 1_000, 'clear_rails')).creditAwarded).toBe(20);
    expect((await pay(who, 1_000, 'manual')).creditAwarded).toBe(0);
    expect((await pay(who, 1_000, 'detected')).creditAwarded).toBe(0);
  });

  test('a late payment earns nothing', async () => {
    const who = wallet();
    const r = await payLedgerStore.recordPayment({
      wallet: who, billerId: 'late', name: 'Rent', type: 'rent', amount: 2_000, dueDate: '2020-01-01',
      period: '2020-01', source: 'clear_rails', txRef: tx(), network: 'testnet',
    });
    expect(r).toMatchObject({ creditAwarded: 0, onTime: false });
  });

  test('a returned payment voids its credits until they are minted', async () => {
    const who = wallet();
    const ref = tx();
    await pay(who, 2_500, 'clear_rails', ref);
    expect(await payLedgerStore.voidPaymentCredits({ wallet: who, txRef: ref })).toBe(50);
    expect(await payLedgerStore.voidPaymentCredits({ wallet: who, txRef: ref })).toBe(0);

    const minted = tx();
    await pay(who, 2_500, 'clear_rails', minted);
    await pg.query(`UPDATE pay_credits SET status = 'minted' WHERE wallet = $1 AND status = 'pending'`, [who]);
    expect(await payLedgerStore.voidPaymentCredits({ wallet: who, txRef: minted })).toBe(0);
  });

  test('another wallet cannot void them', async () => {
    const who = wallet();
    const ref = tx();
    await pay(who, 1_000, 'clear_rails', ref);
    expect(await payLedgerStore.voidPaymentCredits({ wallet: wallet(), txRef: ref })).toBe(0);
  });
});

describe('saving credits', () => {
  const deposit = (who: string, dollars: number) =>
    payLedgerStore.recordDepositMatch({ wallet: who, amountMicros: String(BigInt(dollars) * 1_000_000n), txRef: tx(), network: 'testnet' });

  test('the Match Period is the first 36 months', () => {
    const start = new Date('2026-01-15T00:00:00Z');
    expect(inMatchPeriod(start, new Date('2028-12-31T00:00:00Z'))).toBe(true);
    expect(inMatchPeriod(start, new Date('2029-01-15T00:00:00Z'))).toBe(false);
    expect(inMatchPeriod(null)).toBe(true);
  });

  test('nothing is earned after it ends', async () => {
    const who = wallet();
    joined.set(who, new Date(Date.now() - 37 * 31 * 86_400_000));
    expect((await deposit(who, 500)).creditAwarded).toBe(0);
  });

  test('a member inside it earns', async () => {
    const who = wallet();
    joined.set(who, new Date(Date.now() - 30 * 86_400_000));
    expect((await deposit(who, 500)).creditAwarded).toBe(500);
  });

  test('saving credits stop at 54,000 in all', async () => {
    const who = wallet();
    // 53,900 earned in earlier months (the monthly cap counts this month only).
    await pg.query(
      `INSERT INTO pay_credits (id, wallet, payment_id, amount, reason, source, status, vest_until, network, created_at)
       VALUES ('old-${who}', $1, 'deposit:old-${who}', 53900, 'deposit_match', 'in_app', 'minted', now(), 'testnet', now() - interval '400 days')`,
      [who],
    );
    await pg.query(
      `INSERT INTO pay_esa_flows (id, wallet, network, kind, usd) VALUES ('seed-${who}', $1, 'testnet', 'seed', 53900)`,
      [who],
    );
    expect((await deposit(who, 1_000)).creditAwarded).toBe(100);
    expect((await deposit(who, 1_000)).creditAwarded).toBe(0);
  });
});
