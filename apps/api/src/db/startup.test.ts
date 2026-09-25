import { expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { runMerchantMigrations } from '../config/merchantDb.js';

/**
 * The startup path, end to end: the real lazy `merchant` tables from src/config/merchantDb.ts, then
 * the migrations on top, on a Postgres with nothing in it. testDb.ts stands in for the lazy tables
 * to keep the other tests fast; this is what checks the stand-in hasn't drifted from the real ones.
 */
const pg = new PGlite();
// Just enough of a pg Pool: parameterless text may hold several statements, as ensureMerchantSchema's do.
const fakePool = {
  query: async (text: string, params?: unknown[]): Promise<{ rows: unknown[] }> => {
    if (params?.length) return pg.query(text, params as any[]);
    const results = await pg.exec(text);
    return results[results.length - 1] ?? { rows: [] };
  },
  connect: async () => ({ query: fakePool.query, release: () => undefined }),
} as unknown as Pool;

test('a fresh database gets the lazy merchant tables, then every migration', async () => {
  const applied = await runMerchantMigrations(fakePool);
  expect(applied).toEqual(['0001_merchant_shop', '0002_commerce', '0003_payments', '0004_ledger']);
  const { rows } = await pg.query<{ table_schema: string; n: number }>(
    `SELECT table_schema, count(*)::int AS n FROM information_schema.tables
      WHERE table_schema IN ('merchant','commerce','payments','ledger') GROUP BY table_schema ORDER BY table_schema`,
  );
  expect(Object.fromEntries(rows.map((r) => [r.table_schema, r.n]))).toEqual({
    commerce: 10, // 9 tables and the stock_levels view
    ledger: 3,
    merchant: 11,
    payments: 9,
  });
  // A restart applies nothing.
  expect(await runMerchantMigrations(fakePool)).toEqual([]);
});
