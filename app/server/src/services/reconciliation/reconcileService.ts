import { getPayPool } from '../../config/postgres.js';
import { getLithic } from '../lithic/lithicClient.js';
import {
  buildReport,
  compare,
  compareAtLeast,
  type InvariantResult,
  type ReconciliationReport,
} from './invariants.js';

/*
 * Gathering the figures the four invariants compare — spec §3.
 *
 * Every reader here returns null rather than zero when it cannot establish a number. Zero is a
 * claim; null is the absence of one, and the difference decides whether an invariant reports a
 * clean pass or an honest "could not check". A reconciler that reads nothing and reports health is
 * worse than no reconciler.
 *
 * Nothing in this file writes. Not to Lithic, not to the chain, not to the ledger. Alert-only is
 * spec text and it is also the only safe posture: a process that corrects money without a human
 * having looked is a second unsupervised source of truth.
 */

async function scalar(sql: string, params: unknown[] = []): Promise<number | null> {
  const pool = getPayPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{ total: string | null }>(sql, params);
    const raw = rows[0]?.total;
    if (raw === undefined || raw === null) return 0;
    const parsed = Number.parseInt(String(raw), 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    console.error('[reconcile] query failed:', error);
    return null;
  }
}

/**
 * What our books say members hold in cash, summed across snapshots.
 *
 * The snapshot is our record of each member's spendable fiat, so it is the "should" side of vault
 * solvency.
 */
async function ledgerCashCents(): Promise<number | null> {
  return scalar(`SELECT COALESCE(SUM(cash_cents), 0) AS total FROM lithic_tier_snapshots`);
}

/**
 * What Lithic actually holds across the program's financial accounts.
 *
 * Returns null on any read failure — including the "program has no financial accounts" state this
 * sandbox is still in. That correctly reports the invariant as unavailable rather than comparing a
 * real ledger figure against a zero that means "we could not look".
 */
async function lithicHeldCents(): Promise<number | null> {
  const lithic = getLithic();
  if (!lithic) return null;

  try {
    let total = 0;
    let seen = 0;
    for await (const account of lithic.financialAccounts.list({})) {
      const balance = (account as { available_balance?: number; balance?: number }).available_balance;
      const fallback = (account as { balance?: number }).balance;
      total += Math.round(balance ?? fallback ?? 0);
      seen += 1;
    }
    // No accounts is not a balance of zero — it is a program without the product enabled.
    return seen === 0 ? null : total;
  } catch (error) {
    console.error('[reconcile] could not read Lithic balances:', error);
    return null;
  }
}

/** Fiat pushed out of Lithic for sweeps that went on to mint. */
async function sweptFiatCents(): Promise<number | null> {
  return scalar(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
     FROM savings_sweeps
     WHERE state IN ('clrusd_minted', 'complete')`,
  );
}

/**
 * CLRUSD minted by those same sweeps.
 *
 * Counted from sweeps carrying a mint transaction hash — evidence the mint happened, rather than a
 * state that merely says so.
 */
async function mintedCents(): Promise<number | null> {
  return scalar(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
     FROM savings_sweeps
     WHERE mint_tx_hash IS NOT NULL AND state IN ('clrusd_minted', 'complete')`,
  );
}

/**
 * Credit outstanding across every tier, from our double-entry ledger.
 *
 * Signed by direction rather than summed raw: every amount in the table is positive and `direction`
 * carries the sign, so a repayment only reduces the position if the query respects that. Tiers live
 * in the account name — `member_credit_savings` and friends — not in a column.
 */
async function ledgerCreditCents(): Promise<number | null> {
  return scalar(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE -amount_cents END), 0)
       AS total
     FROM lithic_ledger_entries
     WHERE account LIKE 'member_credit_%'`,
  );
}

/**
 * StableCredit outstanding on chain.
 *
 * Null until the contract is deployed, which correctly reports this invariant as unavailable. The
 * alternative — comparing our ledger against a hardcoded zero — would report drift equal to every
 * dollar of credit ever issued, and a check that always screams is a check nobody reads.
 */
async function chainCreditCents(): Promise<number | null> {
  return null;
}

/** Savings-backed credit drawn — what the settlement float has to be able to cover. */
async function savingsBackedDrawnCents(): Promise<number | null> {
  return scalar(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE -amount_cents END), 0)
       AS total
     FROM lithic_ledger_entries
     WHERE account = 'member_credit_savings'`,
  );
}

/**
 * What the co-op's settlement float actually holds.
 *
 * Null, and deliberately so. The only `coop_settlement_float` rows in the ledger are the credits
 * written by the draws themselves — there is no funding entry, because there is no funded float
 * account yet. Summing them would produce exactly the savings-backed drawn figure and compare it
 * against itself, so the invariant would pass every time by construction while proving nothing.
 *
 * A check that cannot fail is worse than a missing one: it reads as coverage. This reports
 * unavailable until a real float balance exists to read.
 */
async function settlementFloatCents(): Promise<number | null> {
  return null;
}

/**
 * Run all four invariants.
 *
 * Reads run in parallel — they are independent, and this is a scheduled job whose latency budget is
 * generous. Order in the report follows the spec's table so the two can be read side by side.
 */
export async function reconcile(): Promise<ReconciliationReport> {
  const [
    ledgerCash,
    lithicHeld,
    sweptFiat,
    minted,
    ledgerCredit,
    chainCredit,
    savingsDrawn,
    float,
  ] = await Promise.all([
    ledgerCashCents(),
    lithicHeldCents(),
    sweptFiatCents(),
    mintedCents(),
    ledgerCreditCents(),
    chainCreditCents(),
    savingsBackedDrawnCents(),
    settlementFloatCents(),
  ]);

  const results: InvariantResult[] = [
    compare(
      'vault_solvency',
      'Vault solvency',
      ledgerCash,
      lithicHeld,
      'Lithic cash held for members should equal the sum of member cash balances.',
    ),
    compare(
      'esa_backing',
      'ESA backing',
      sweptFiat,
      minted,
      'Fiat pushed out for completed sweeps should equal the CLRUSD those sweeps minted.' +
        ' Restated from the spec for the Bridge rail — no co-op fiat is received at any point.',
    ),
    compare(
      'credit_issuance',
      'Credit issuance',
      ledgerCredit,
      chainCredit,
      'On-chain StableCredit outstanding should equal the sum of tier draws in our ledger.',
    ),
    compareAtLeast(
      'float_adequacy',
      'Float adequacy',
      savingsDrawn,
      float,
      'Settlement float should cover savings-backed credit drawn but not yet reconciled.',
    ),
  ];

  return buildReport(results, new Date().toISOString());
}
