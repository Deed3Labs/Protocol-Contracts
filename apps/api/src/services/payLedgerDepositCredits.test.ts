import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';

/*
 * Deposit credits: one per dollar, and a dollar earns one only once (ESA Terms 6.2). A dollar withdrawn
 * after it earned its credit and added back earns nothing new; a dollar withdrawn while its credit is
 * still pending loses that credit and can earn again when it comes back.
 *
 * Against a real Postgres (PGlite standing in for the pool), because the rules are sums and unique keys.
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
mock.module('../config/postgres.js', () => ({ getPostgresPool: () => pool, getPayPool: () => pool, closePostgresPool: async () => {} }));
mock.module('./notificationStore.js', () => ({ notificationStore: { emit: async () => {} } }));
process.env.SEND_CONTACT_ENCRYPTION_KEY ||= `hex:${'22'.repeat(32)}`;

const { payLedgerStore } = await import('./payLedgerStore');

const usdc = (dollars: number) => String(BigInt(dollars) * 1_000_000n);
let n = 0;
const tx = () => `0xtx${++n}`;
let w = 0;
const wallet = () => `0x${String(++w).padStart(40, '0')}`;

async function deposit(who: string, dollars: number, txRef = tx(), network: 'mainnet' | 'testnet' = 'testnet') {
  return payLedgerStore.recordDepositMatch({ wallet: who, amountMicros: usdc(dollars), txRef, network });
}
async function redeem(who: string, dollars: number, txRef = tx(), network: 'mainnet' | 'testnet' = 'testnet') {
  return payLedgerStore.clawbackDepositMatch({ wallet: who, amountMicros: usdc(dollars), txRef, network });
}
/** Ages every credit past its vesting window. */
async function vestAll(who: string) {
  await pg.query(`UPDATE pay_credits SET vest_until = now() - interval '1 day' WHERE wallet = $1`, [who]);
  await pg.query(`UPDATE pay_credits SET status = 'vested' WHERE wallet = $1 AND status = 'pending'`, [who]);
}
async function standing(who: string, network = 'testnet') {
  const r = await pg.query<{ s: string }>(
    `SELECT COALESCE(SUM(amount),0)::text AS s FROM pay_credits WHERE wallet = $1 AND reason = 'deposit_match' AND status <> 'void' AND network = $2`,
    [who, network],
  );
  return Number(r.rows[0].s);
}

beforeAll(async () => {
  // Creates the tables, as the first read after a deploy does.
  await payLedgerStore.getSummary(wallet(), 'testnet');
});

describe('a dollar earns a deposit credit once', () => {
  test('a first deposit earns one credit per dollar', async () => {
    const m = wallet();
    expect((await deposit(m, 400)).creditAwarded).toBe(400);
  });

  test('withdrawn after vesting and added back, it earns nothing new', async () => {
    const m = wallet();
    await deposit(m, 1000);
    await vestAll(m);
    await redeem(m, 1000);
    expect(await standing(m)).toBe(1000); // vested credits are kept
    expect((await deposit(m, 1000)).creditAwarded).toBe(0);
    // Only dollars beyond what already earned a credit earn one.
    expect((await deposit(m, 300)).creditAwarded).toBe(300);
    expect(await standing(m)).toBe(1300);
  });

  test('withdrawn while still pending, the credit is lost and the dollar can earn again', async () => {
    const m = wallet();
    await deposit(m, 500);
    expect(await redeem(m, 500)).toBe(500);
    expect(await standing(m)).toBe(0);
    expect((await deposit(m, 500)).creditAwarded).toBe(500);
  });

  test('a mixed withdrawal takes the pending credits first and blocks only the vested dollars it took', async () => {
    const m = wallet();
    await deposit(m, 1000);
    await vestAll(m);
    await deposit(m, 500); // pending
    expect(await redeem(m, 700)).toBe(500); // the 500 pending go; 200 vested dollars leave
    expect(await standing(m)).toBe(1000);
    expect((await deposit(m, 200)).creditAwarded).toBe(0);
    expect((await deposit(m, 100)).creditAwarded).toBe(100);
  });

  test('the same deposit reported twice is counted once', async () => {
    const m = wallet();
    const ref = tx();
    expect((await deposit(m, 250, ref)).creditAwarded).toBe(250);
    expect(await deposit(m, 250, ref)).toEqual({ creditAwarded: 0, duplicate: true });
    expect(await standing(m)).toBe(250);
  });

  test('the same redemption reported twice is clawed back once', async () => {
    const m = wallet();
    await deposit(m, 600);
    const ref = tx();
    expect(await redeem(m, 200, ref)).toBe(200);
    expect(await redeem(m, 200, ref)).toBe(0);
    expect(await standing(m)).toBe(400);
  });

  test('a partial clawback keeps the remainder on the same network', async () => {
    const m = wallet();
    await deposit(m, 300, tx(), 'testnet');
    await redeem(m, 100, tx(), 'testnet');
    expect(await standing(m, 'testnet')).toBe(200);
    expect(await standing(m, 'mainnet')).toBe(0);
  });

  test('a wallet with credits from before this ledger keeps them as savings in', async () => {
    const m = wallet();
    // A credit row written before deposits were tracked: 800 dollars still in savings, credited.
    await pg.query(
      `INSERT INTO pay_credits (id, wallet, payment_id, amount, reason, source, streak_at_award, status, vest_until, network)
       VALUES ($1,$2,$3,800,'deposit_match','in_app',0,'vested',now(),'testnet')`,
      [crypto.randomUUID(), m, `deposit:legacy-${m}`],
    );
    expect((await deposit(m, 50)).creditAwarded).toBe(50);
    await redeem(m, 850); // the 50 pending are clawed back; the 800 credited dollars leave
    expect((await deposit(m, 850)).creditAwarded).toBe(50);
  });

  test('the monthly cap still applies', async () => {
    const m = wallet();
    expect((await deposit(m, 1400)).creditAwarded).toBe(1400);
    expect((await deposit(m, 300)).creditAwarded).toBe(100);
  });
});
