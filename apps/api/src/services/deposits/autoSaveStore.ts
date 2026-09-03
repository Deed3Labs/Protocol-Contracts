import { getPayPool } from '../../config/postgres.js';

/*
 * "Save some of every deposit" — the rule that makes auto-save a payday habit.
 *
 * `recordDeposit` has always accepted `autoSaveCents` and nothing ever supplied it, so auto-save
 * was reachable in code and unreachable in the product. This is what supplies it.
 *
 * Deliberately NOT a cadence. `autopay_rules` runs weekly or monthly against a clock, which is the
 * right shape for an on-chain mandate and the wrong one for this: people are not paid by the
 * calendar. A rule that fires on the 1st when payday moved to the 3rd tries to save from an account
 * that has not been funded yet. This fires when money actually arrives, which is the only moment
 * the member reliably has it.
 *
 * Two modes, both with obvious failure behaviour:
 *   fixed    save a set amount, capped at what is left after settlement
 *   percent  save a share of the deposit, which survives a raise or a short paycheck on its own
 */

const TABLE = 'auto_save_rules';

export type AutoSaveMode = 'fixed' | 'percent';

export interface AutoSaveRule {
  wallet: string;
  mode: AutoSaveMode;
  /** Cents when `fixed`; whole percentage points (1–100) when `percent`. */
  value: number;
  enabled: boolean;
  updatedAt: string;
}

let ensured = false;

async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      wallet TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('fixed', 'percent')),
      value BIGINT NOT NULL CHECK (value > 0),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  ensured = true;
}

/**
 * How much of this deposit to set aside.
 *
 * Pure, so the arithmetic is testable without a database — and the arithmetic is where the member's
 * money is at stake.
 *
 * Never more than what is actually left. Auto-save runs on the remainder after settlement, so a
 * member whose paycheck mostly repaid credit saves what is there rather than going negative chasing
 * a target. A rule that overdraws to hit its number is a rule that has forgotten what it is for.
 */
export function autoSaveCentsFor(
  rule: AutoSaveRule | null,
  remainingCents: number,
): number {
  if (!rule || !rule.enabled) return 0;
  const available = Math.max(0, Math.round(remainingCents));
  if (available === 0) return 0;

  const wanted =
    rule.mode === 'percent'
      ? Math.floor((available * Math.min(100, Math.max(0, rule.value))) / 100)
      : Math.round(rule.value);

  return Math.max(0, Math.min(wanted, available));
}

interface Row {
  wallet: string;
  mode: AutoSaveMode;
  value: string;
  enabled: boolean;
  updated_at: Date;
}

function toRule(row: Row): AutoSaveRule {
  return {
    wallet: row.wallet,
    mode: row.mode,
    value: parseInt(row.value, 10) || 0,
    enabled: row.enabled,
    updatedAt: row.updated_at.toISOString(),
  };
}

export const autoSaveStore = {
  isConfigured(): boolean {
    return Boolean(getPayPool());
  },

  async get(wallet: string): Promise<AutoSaveRule | null> {
    const pool = getPayPool();
    if (!pool) return null;
    try {
      await ensureTable();
      const { rows } = await pool.query<Row>(`SELECT * FROM ${TABLE} WHERE wallet = $1`, [
        wallet.trim().toLowerCase(),
      ]);
      return rows[0] ? toRule(rows[0]) : null;
    } catch (error) {
      // A rule we cannot read means no auto-save this time. Failing the deposit over it would be
      // worse — the money did arrive, and it belongs in the member's account either way.
      console.error('[auto-save] could not read rule for', wallet, error);
      return null;
    }
  },

  async put(input: {
    wallet: string;
    mode: AutoSaveMode;
    value: number;
    enabled?: boolean;
  }): Promise<AutoSaveRule | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();

    const value = Math.round(input.value);
    if (value <= 0) throw new Error('value must be greater than zero');
    if (input.mode === 'percent' && value > 100) throw new Error('percent cannot exceed 100');

    const { rows } = await pool.query<Row>(
      `INSERT INTO ${TABLE} (wallet, mode, value, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (wallet) DO UPDATE SET
         mode = EXCLUDED.mode,
         value = EXCLUDED.value,
         enabled = EXCLUDED.enabled,
         updated_at = now()
       RETURNING *`,
      [input.wallet.trim().toLowerCase(), input.mode, value, input.enabled ?? true],
    );
    return rows[0] ? toRule(rows[0]) : null;
  },

  async disable(wallet: string): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    await ensureTable();
    await pool.query(`UPDATE ${TABLE} SET enabled = FALSE, updated_at = now() WHERE wallet = $1`, [
      wallet.trim().toLowerCase(),
    ]);
  },
};
