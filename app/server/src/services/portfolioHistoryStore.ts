import type { Pool } from 'pg';
import { getPostgresPool } from '../config/postgres.js';

/*
 * Durable portfolio-value history (Postgres). One row per wallet per day:
 *   onchain_usd (mainnet USDC + CLRUSD), bank_usd (Plaid), total_usd.
 * Written by the daily snapshot job + the reconstruction backfill; read by /api/portfolio/history.
 */

const TABLE = process.env.PORTFOLIO_SNAPSHOT_TABLE || 'portfolio_snapshots';
let ensured = false;

async function ensureTable(pool: Pool): Promise<void> {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      wallet_address TEXT NOT NULL,
      snapshot_date DATE NOT NULL,
      onchain_usd NUMERIC NOT NULL DEFAULT 0,
      bank_usd NUMERIC NOT NULL DEFAULT 0,
      total_usd NUMERIC NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (wallet_address, snapshot_date)
    )
  `);
  ensured = true;
}

export interface SnapshotRow {
  date: string; // YYYY-MM-DD
  onchainUsd: number;
  bankUsd: number;
  totalUsd: number;
}

export const portfolioHistoryStore = {
  isConfigured(): boolean {
    return Boolean(getPostgresPool());
  },

  async upsert(wallet: string, dateISO: string, onchainUsd: number, bankUsd: number): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTable(pool);
    const total = (onchainUsd || 0) + (bankUsd || 0);
    await pool.query(
      `INSERT INTO ${TABLE} (wallet_address, snapshot_date, onchain_usd, bank_usd, total_usd)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (wallet_address, snapshot_date)
       DO UPDATE SET onchain_usd = EXCLUDED.onchain_usd, bank_usd = EXCLUDED.bank_usd, total_usd = EXCLUDED.total_usd, updated_at = now()`,
      [wallet.toLowerCase(), dateISO, onchainUsd || 0, bankUsd || 0, total],
    );
  },

  async getRange(wallet: string, sinceISO: string): Promise<SnapshotRow[]> {
    const pool = getPostgresPool();
    if (!pool) return [];
    await ensureTable(pool);
    const r = await pool.query(
      `SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS date, onchain_usd, bank_usd, total_usd
       FROM ${TABLE} WHERE wallet_address = $1 AND snapshot_date >= $2 ORDER BY snapshot_date ASC`,
      [wallet.toLowerCase(), sinceISO],
    );
    return r.rows.map((row) => ({
      date: row.date,
      onchainUsd: Number(row.onchain_usd),
      bankUsd: Number(row.bank_usd),
      totalUsd: Number(row.total_usd),
    }));
  },

  async hasAny(wallet: string): Promise<boolean> {
    const pool = getPostgresPool();
    if (!pool) return false;
    await ensureTable(pool);
    const r = await pool.query(`SELECT 1 FROM ${TABLE} WHERE wallet_address = $1 LIMIT 1`, [wallet.toLowerCase()]);
    return (r.rowCount ?? 0) > 0;
  },

  async listWallets(): Promise<string[]> {
    const pool = getPostgresPool();
    if (!pool) return [];
    await ensureTable(pool);
    const r = await pool.query(`SELECT DISTINCT wallet_address FROM ${TABLE}`);
    return r.rows.map((row) => row.wallet_address as string);
  },
};
