import type { Pool, PoolClient } from 'pg';

/**
 * The little the merchant services need from a database, so the same code runs on the production
 * pool and on PGlite in tests.
 *
 * `query` is one statement with parameters; `exec` is several statements with none (a migration
 * file); `transaction` runs a function inside BEGIN … COMMIT, rolling back if it throws.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

const fromClient = (client: PoolClient): Queryable => ({
  query: async <T>(text: string, params?: unknown[]) => {
    const r = await client.query(text, params as unknown[] | undefined);
    return { rows: r.rows as T[] };
  },
  exec: async (sql: string) => {
    await client.query(sql);
  },
});

export function poolDb(pool: Pool): Db {
  return {
    query: async <T>(text: string, params?: unknown[]) => {
      const r = await pool.query(text, params as unknown[] | undefined);
      return { rows: r.rows as T[] };
    },
    exec: async (sql: string) => {
      await pool.query(sql);
    },
    transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(fromClient(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
