import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable } from './db.js';
import { migrate } from './migrate.js';

/**
 * A real Postgres for tests, in-process (PGlite, test-only: HARD STOP 1, decision 6). Runs the
 * actual migrations, so the triggers and CHECKs under test are the ones production gets.
 *
 * The lazy `merchant` tables that src/config/merchantDb.ts creates are stood in for here with only
 * the columns the migrations touch.
 */

const wrap = (pg: Pick<PGlite, 'query' | 'exec'>): Queryable => ({
  query: async <T>(text: string, params?: unknown[]) => {
    const r = await pg.query<T>(text, params as any[]);
    return { rows: r.rows };
  },
  exec: async (sql: string) => {
    await pg.exec(sql);
  },
});

export function pgliteDb(pg: PGlite): Db {
  return { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))) };
}

export const LAZY_MERCHANT_TABLES = `
  CREATE SCHEMA IF NOT EXISTS merchant;
  CREATE TABLE merchant.staff (
    id TEXT PRIMARY KEY, merchant TEXT NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('counter','manager','owner')),
    secret TEXT NOT NULL DEFAULT 'x', active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE merchant.devices (id TEXT PRIMARY KEY, merchant TEXT NOT NULL, label TEXT NOT NULL);
  CREATE TABLE merchant.profiles (
    merchant TEXT PRIMARY KEY, name TEXT NOT NULL,
    founding BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

export async function testDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite();
  await pg.exec(LAZY_MERCHANT_TABLES);
  const db = pgliteDb(pg);
  await migrate(db);
  return { db, pg };
}

let n = 0;
/** A shop with an owner, a manager and two counter staff, under a fresh address. */
export async function seedShop(db: Queryable, opts: { founding?: boolean } = {}) {
  n += 1;
  const merchant = `0x${n.toString(16).padStart(40, '0')}`;
  const staff = { owner: `stf_owner_${n}`, manager: `stf_manager_${n}`, jen: `stf_jen_${n}`, luis: `stf_luis_${n}` };
  await db.query('INSERT INTO merchant.profiles (merchant, name, founding) VALUES ($1, $2, $3)', [merchant, `Shop ${n}`, opts.founding ?? false]);
  await db.query(
    `INSERT INTO merchant.staff (id, merchant, name, role) VALUES
       ($1, $5, 'Marcus', 'owner'), ($2, $5, 'Ana', 'manager'), ($3, $5, 'Jen', 'counter'), ($4, $5, 'Luis', 'counter')`,
    [staff.owner, staff.manager, staff.jen, staff.luis, merchant],
  );
  return { merchant, staff };
}
