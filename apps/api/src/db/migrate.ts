import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

/**
 * Versioned SQL migrations for the merchant back office: the `commerce`, `payments` and `ledger`
 * schemas, and additions to `merchant`.
 *
 * The rest of the API keeps its lazy CREATE … IF NOT EXISTS stores; this runner covers only what
 * these files create (HARD STOP 1). Each file runs once, in its own transaction, under an advisory
 * lock so two API instances starting together can't both apply it. A file that changes after it
 * has run is refused: a migration is history, and editing it would make two databases disagree
 * about what they contain. Write a new one instead.
 */

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

/** Any fixed number: the lock only has to be the same one for every instance. */
const LOCK = 7_431_205_117;

export interface Migration {
  version: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  return Promise.all(
    files.map(async (f) => {
      const sql = await readFile(`${dir}/${f}`, 'utf8');
      return { version: f.replace(/\.sql$/, ''), sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

/** Applies what hasn't run. Returns the versions it applied. */
export async function migrate(db: Db, migrations?: Migration[]): Promise<string[]> {
  const all = migrations ?? (await loadMigrations());
  // Under the lock too: two instances booting against an empty database would otherwise race on
  // CREATE TABLE IF NOT EXISTS, which Postgres doesn't make safe under concurrency.
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    await tx.exec(`
      CREATE SCHEMA IF NOT EXISTS merchant;
      CREATE TABLE IF NOT EXISTS merchant.schema_migrations (
        version    TEXT PRIMARY KEY,
        checksum   TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  });
  const applied: string[] = [];
  for (const m of all) {
    const ran = await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
      const { rows } = await tx.query<{ checksum: string }>('SELECT checksum FROM merchant.schema_migrations WHERE version = $1', [m.version]);
      if (rows[0]) {
        if (rows[0].checksum !== m.checksum) throw new Error(`Migration ${m.version} has changed since it ran. Write a new migration instead.`);
        return false;
      }
      await tx.exec(m.sql);
      await tx.query('INSERT INTO merchant.schema_migrations (version, checksum) VALUES ($1, $2)', [m.version, m.checksum]);
      return true;
    });
    if (ran) applied.push(m.version);
  }
  return applied;
}
