import type { PoolClient } from 'pg';
import { getPayPool } from '../../config/postgres.js';
import { refreshSnapshotsFor } from '../lithic/snapshotService.js';
import { autoSaveCentsFor, autoSaveStore } from './autoSaveStore.js';
import {
  allocate,
  planSettlement,
  SETTLEMENT_ORDER,
  type Outstanding,
  type SettlementPlan,
} from './settlement.js';

/*
 * Money arriving — spec step 4, for both rails.
 *
 * A deposit reaches a member two ways and they are genuinely different journeys:
 *
 *   lithic_ach   an employer's ACH lands in the member's Lithic financial account. Fiat, spendable
 *                by the card, and Lithic's ledger is authoritative for the balance.
 *   bridge_va    the member (or their employer) pushes into their Bridge virtual account; Bridge
 *                converts and delivers USDC to their smart account on chain. Same money, different
 *                rail, and it lands as a token balance rather than a bank balance.
 *
 * What happens next is identical, which is why this is one service rather than two handlers that
 * drift: record it double-entry, settle outstanding credit before anything else touches it, apply
 * the auto-save allocation to what's left, and rewrite the tier snapshot the card authorizes
 * against. The rail only decides which cash account is credited.
 *
 * Idempotent by (rail, external id). Both webhooks retry, and a deposit counted twice is a member
 * spending money that was never there.
 */

const ENTRIES = 'lithic_ledger_entries';
const RECEIPTS = 'deposit_receipts';

export type DepositRail = 'lithic_ach' | 'bridge_va';

export interface DepositReceipt {
  rail: DepositRail;
  /** The rail's own id for this movement. Idempotency key, scoped by rail. */
  externalId: string;
  wallet: string;
  amountCents: number;
  /**
   * Fixed auto-save for this deposit, in cents.
   *
   * Absent is not zero: absent means "use the member's own rule", which is the normal case. Pass a
   * number only to override that deliberately.
   */
  autoSaveCents?: number;
  metadata?: Record<string, unknown>;
}

export interface DepositOutcome {
  recorded: boolean;
  /** True when this receipt had already been processed and nothing was applied again. */
  duplicate: boolean;
  plan: SettlementPlan | null;
  toSavingsCents: number;
  toCashCents: number;
  /** Cards whose availability was rewritten as a result. Empty when the member has none yet. */
  snapshotsUpdated: number;
}

let ensured = false;

async function ensureTables(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${RECEIPTS} (
      rail TEXT NOT NULL,
      external_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      settled_cents BIGINT NOT NULL DEFAULT 0,
      to_savings_cents BIGINT NOT NULL DEFAULT 0,
      to_cash_cents BIGINT NOT NULL DEFAULT 0,
      metadata JSONB,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (rail, external_id)
    );
    CREATE INDEX IF NOT EXISTS ${RECEIPTS}_wallet_idx ON ${RECEIPTS} (wallet, received_at DESC);
  `);
  ensured = true;
}

/**
 * What the member currently owes, per tier, read from the ledger.
 *
 * Derived rather than stored: the ledger is the record, and a cached "outstanding" column is a
 * second source of truth that can disagree with it. This runs on the deposit path, not the
 * authorization path, so it can afford to be a sum.
 */
async function readOutstanding(client: PoolClient, wallet: string): Promise<Outstanding> {
  const { rows } = await client.query<{ account: string; net: string }>(
    `SELECT account,
            SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE -amount_cents END) AS net
     FROM ${ENTRIES}
     WHERE wallet = $1 AND account LIKE 'member_credit_%'
     GROUP BY account`,
    [wallet],
  );

  const outstanding: Outstanding = { boost: 0, income: 0, asset: 0, savings: 0 };
  for (const row of rows) {
    const tier = row.account.replace('member_credit_', '') as keyof Outstanding;
    if (tier in outstanding) {
      outstanding[tier] = Math.max(0, parseInt(row.net, 10) || 0);
    }
  }
  return outstanding;
}

/** The cash account this rail credits. Both are the member's money; they sit in different places. */
function cashAccountFor(rail: DepositRail): string {
  return rail === 'lithic_ach' ? 'member_cash_fiat' : 'member_cash_usdc';
}

/**
 * Record an arriving deposit and apply it.
 *
 * Order is the spec's: credit the cash balance, settle outstanding credit first, then the auto-save
 * allocation. All inside one transaction — a deposit that half-applied would leave a member owing
 * money the ledger says they paid.
 */
export async function recordDeposit(receipt: DepositReceipt): Promise<DepositOutcome> {
  const pool = getPayPool();
  if (!pool) {
    return { recorded: false, duplicate: false, plan: null, toSavingsCents: 0, toCashCents: 0, snapshotsUpdated: 0 };
  }
  await ensureTables();

  const wallet = receipt.wallet.trim().toLowerCase();
  const amount = Math.max(0, Math.round(receipt.amountCents));
  if (!wallet || amount <= 0) {
    return { recorded: false, duplicate: false, plan: null, toSavingsCents: 0, toCashCents: 0, snapshotsUpdated: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency first, before anything is applied. Both rails retry.
    const claim = await client.query(
      `INSERT INTO ${RECEIPTS} (rail, external_id, wallet, amount_cents, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (rail, external_id) DO NOTHING
       RETURNING rail`,
      [receipt.rail, receipt.externalId, wallet, amount, JSON.stringify(receipt.metadata ?? {})],
    );

    if (claim.rowCount === 0) {
      await client.query('COMMIT');
      return { recorded: false, duplicate: true, plan: null, toSavingsCents: 0, toCashCents: 0, snapshotsUpdated: 0 };
    }

    const group = `deposit:${receipt.rail}:${receipt.externalId}`;

    // 1. The money arrived. Debit the member's cash, credit the rail it came from.
    await client.query(
      `INSERT INTO ${ENTRIES} (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
       VALUES ($1, $2, $3, 'debit', $4, $5, 'deposit', $6, $7::jsonb),
              ($1, $2, $8, 'credit', $4, $5, 'deposit', $6, $7::jsonb)`,
      [
        group,
        wallet,
        cashAccountFor(receipt.rail),
        amount,
        receipt.rail === 'lithic_ach' ? 'fiat' : 'chain',
        `${receipt.rail}:${receipt.externalId}`,
        JSON.stringify(receipt.metadata ?? {}),
        receipt.rail === 'lithic_ach' ? 'external_ach' : 'external_bridge',
      ],
    );

    // 2. Settle what's owed, most expensive first. No pay button; this is the mechanism.
    const outstanding = await readOutstanding(client, wallet);
    const plan = planSettlement(amount, outstanding);

    for (const settlement of plan.settlements) {
      await client.query(
        `INSERT INTO ${ENTRIES} (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
         VALUES ($1, $2, $3, 'credit', $4, $5, 'credit_settlement', $6, $7::jsonb),
                ($1, $2, $8, 'debit', $4, $5, 'credit_settlement', $6, $7::jsonb)`,
        [
          group,
          wallet,
          `member_credit_${settlement.tier}`,
          settlement.amountCents,
          receipt.rail === 'lithic_ach' ? 'fiat' : 'chain',
          `${receipt.rail}:${receipt.externalId}:${settlement.tier}`,
          JSON.stringify({ tier: settlement.tier }),
          cashAccountFor(receipt.rail),
        ],
      );
    }

    // 3. Auto-save on the remainder, never on the gross.
    //
    // An explicit figure from the caller wins; otherwise the member's own rule decides. This is
    // what makes auto-save a payday habit rather than a parameter nothing ever passed: it fires
    // when money actually arrives, which is the only moment the member reliably has it.
    const autoSaveCents =
      receipt.autoSaveCents ?? autoSaveCentsFor(await autoSaveStore.get(wallet), plan.remainingCents);

    const allocation = allocate({
      remainingCents: plan.remainingCents,
      autoSaveCents,
    });

    if (allocation.toSavingsCents > 0) {
      // Recorded as an intent, not a movement: the actual sweep is the two-rail saga in step 7, and
      // claiming the money reached the ESA before CLRUSD is minted would be a lie the ledger tells.
      await client.query(
        `INSERT INTO ${ENTRIES} (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
         VALUES ($1, $2, 'member_savings_pending', 'debit', $3, 'fiat', 'auto_save_intent', $4, $5::jsonb),
                ($1, $2, $6, 'credit', $3, 'fiat', 'auto_save_intent', $4, $5::jsonb)`,
        [
          group,
          wallet,
          allocation.toSavingsCents,
          `${receipt.rail}:${receipt.externalId}:autosave`,
          JSON.stringify({ source: receipt.rail }),
          cashAccountFor(receipt.rail),
        ],
      );
    }

    await client.query(
      `UPDATE ${RECEIPTS}
       SET settled_cents = $3, to_savings_cents = $4, to_cash_cents = $5
       WHERE rail = $1 AND external_id = $2`,
      [
        receipt.rail,
        receipt.externalId,
        plan.settledCents,
        allocation.toSavingsCents,
        allocation.toCashCents,
      ],
    );

    await client.query('COMMIT');

    // The deposit changed both the cash balance and what's outstanding, so every card this member
    // holds is now authorizing against a stale snapshot. Rewriting it is the point of step 3's
    // "precomputed lookup" — a snapshot nothing maintains is just a slower wrong answer.
    const snapshotsUpdated = await refreshSnapshotsFor(wallet);

    return {
      recorded: true,
      duplicate: false,
      plan,
      toSavingsCents: allocation.toSavingsCents,
      toCashCents: allocation.toCashCents,
      snapshotsUpdated,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * What the member owes right now, per tier — the figure the Home page's credit card shows and the
 * number reconciliation checks against the chain.
 */
export async function outstandingFor(wallet: string): Promise<Outstanding | null> {
  const pool = getPayPool();
  if (!pool) return null;
  await ensureTables();
  const client = await pool.connect();
  try {
    return await readOutstanding(client, wallet.trim().toLowerCase());
  } finally {
    client.release();
  }
}

export { SETTLEMENT_ORDER };
