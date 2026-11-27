import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';

/*
 * What auto-save has saved this year: one row per run, counted once per transaction.
 *
 * Against a real Postgres (PGlite standing in for the pool), because the total is a WHERE clause and
 * the once-only guarantee is a primary key.
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
process.env.SEND_CONTACT_ENCRYPTION_KEY ||= `hex:${'22'.repeat(32)}`;

const { autopayStore } = await import('./autopayStore');

const MEMBER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

async function rule(wallet = MEMBER, amountUsdc = 250) {
  return autopayStore.create({ wallet, chainId: 84532, amountUsdc, cadence: 'monthly', approval: '{}', runsLeft: 12 });
}

beforeAll(async () => {
  // Creates the tables, as the first read after a deploy does.
  await autopayStore.savedThisYear(MEMBER);
});

describe('saved so far this year', () => {
  test('nothing run is nothing saved', async () => {
    expect(await autopayStore.savedThisYear(MEMBER)).toBe(0);
  });

  test('every run counts, once per transaction', async () => {
    const r = await rule();
    await autopayStore.recordSuccess(r, '0xaaa');
    await autopayStore.recordSuccess(r, '0xaaa'); // the same run recorded twice
    await autopayStore.recordSuccess(r, '0xbbb');
    expect(await autopayStore.savedThisYear(MEMBER)).toBe(500);
  });

  test('a cancelled rule still saved what it saved', async () => {
    const r = await rule(MEMBER, 100);
    await autopayStore.recordSuccess(r, '0xccc');
    await autopayStore.cancel(MEMBER, r.id);
    expect(await autopayStore.savedThisYear(MEMBER)).toBe(600);
  });

  test('last year does not count', async () => {
    await pool.query(
      `INSERT INTO autopay_runs (tx_hash, rule_id, wallet, amount_usdc, ran_at) VALUES ('0xold', 'ap_old', $1, 999, $2)`,
      [MEMBER, new Date(Date.UTC(new Date().getUTCFullYear() - 1, 11, 31)).toISOString()],
    );
    expect(await autopayStore.savedThisYear(MEMBER)).toBe(600);
  });

  test('another member’s runs are theirs', async () => {
    const r = await rule(OTHER, 40);
    await autopayStore.recordSuccess(r, '0xddd');
    expect(await autopayStore.savedThisYear(OTHER)).toBe(40);
    expect(await autopayStore.savedThisYear(MEMBER)).toBe(600);
  });

  test('a run still advances the schedule', async () => {
    const r = await rule();
    await autopayStore.recordSuccess(r, '0xeee');
    const [after] = (await autopayStore.listForWallet(MEMBER)).filter((x) => x.id === r.id);
    expect(after.runsLeft).toBe(11);
    expect(new Date(after.nextRunAt).getTime()).toBeGreaterThan(new Date(r.nextRunAt).getTime());
  });
});
