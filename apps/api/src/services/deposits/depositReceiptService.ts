import type { PoolClient } from 'pg';
import { getPayPool } from '../../config/postgres.js';
import { refreshSnapshotsFor } from '../lithic/snapshotService.js';
import { syncCardRepayment } from '../chain/cardSettlementService.js';
import { allocateTermDue, bookTermPayments, readTermDue } from '../chain/termCollection.js';
import { autoSaveCentsFor, autoSaveStore } from './autoSaveStore.js';
import {
  allocate,
  planSettlement,
  totalOutstanding,
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

/**
 * Carry the member owes and has not paid, from the ledger's carry account.
 *
 * Carry accrues on chain, on the tiers, and is written into this account by the card settlement
 * service as it accrues, so a deposit can pay it like any other debt. Separate from `Outstanding`
 * because it is not a tier: nothing draws on it, it only accrues.
 */
async function readCarryOwed(client: PoolClient, wallet: string): Promise<number> {
  const { rows } = await client.query<{ net: string | null }>(
    `SELECT SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE -amount_cents END) AS net
       FROM ${ENTRIES}
      WHERE wallet = $1 AND account = 'member_credit_carry'`,
    [wallet],
  );
  return Math.max(0, parseInt(rows[0]?.net ?? '0', 10) || 0);
}

/**
 * Whether the member switched on automatic repayment from USDC deposits.
 *
 * Mirrors the on-chain mandate (`RevolvingIssuer.autoRepayEnabled`), which is the authority: this
 * row only decides whether to earmark, and the chain refuses a repayment the member did not allow.
 */
async function autoRepayEnabledFor(client: PoolClient, wallet: string): Promise<boolean> {
  await ensureAutoRepayTables(client);
  const { rows } = await client.query<{ enabled: boolean }>(`SELECT enabled FROM member_auto_repay WHERE wallet = $1`, [wallet]);
  return rows[0]?.enabled === true;
}

export async function ensureAutoRepayTables(client: { query: PoolClient['query'] }): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS member_auto_repay (
      wallet TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS auto_repay_due (
      wallet TEXT PRIMARY KEY,
      due_cents BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
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

  // What is due on term plans, read from chain before the DB transaction opens. Only a fiat deposit
  // pays it here; USDC in the member's own wallet cannot be taken without their mandate.
  const termDue = receipt.rail === 'lithic_ach' ? await readTermDue(wallet) : [];

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
    /*
     * Only FIAT pays card debt on arrival. An ACH deposit lands in the co-op's account, refills the
     * float that paid the merchant, and the chain is brought into line by netting. A Bridge deposit
     * lands as USDC in the member's OWN wallet: counting it as paying card debt made our books say
     * paid while the chain still said owed and the USDC had not moved. It stays the member's cash,
     * and card debt is repaid with it on chain (Repay), which the books then record from the chain.
     */
    /*
     * Term plans first: what is due on them (arrears, then carry a refunded plan left behind). A
     * plan falls into default by falling behind, so overdue installments outrank card debt even
     * where a card tier costs more. The co-op pays them on chain from its float (the sweep).
     */
    const term = allocateTermDue(amount, termDue);
    const termCents = await bookTermPayments(client, {
      wallet,
      group,
      externalId: `${receipt.rail}:${receipt.externalId}`,
      paid: term.paid,
    });

    const outstanding = await readOutstanding(client, wallet);
    const plan =
      receipt.rail === 'lithic_ach'
        ? planSettlement(term.remainingCents, outstanding, await readCarryOwed(client, wallet))
        : planSettlement(amount, { boost: 0, income: 0, asset: 0, savings: 0 });

    /*
     * A USDC deposit for a member who switched on automatic repayment: what they owe is set aside
     * for it before auto-save sees the rest -- debt first, the same rule as a fiat deposit. It is
     * not settled in the books here: it is repaid ON CHAIN from their wallet (the sweep), and the
     * books are written from that transaction. The earmark is what auto-save must not touch.
     */
    let earmarkCents = 0;
    if (receipt.rail !== 'lithic_ach' && (await autoRepayEnabledFor(client, wallet))) {
      const owed = totalOutstanding(outstanding) + (await readCarryOwed(client, wallet));
      earmarkCents = Math.min(amount, owed);
      if (earmarkCents > 0) {
        await client.query(
          `INSERT INTO auto_repay_due (wallet, due_cents) VALUES ($1, $2)
           ON CONFLICT (wallet) DO UPDATE SET due_cents = auto_repay_due.due_cents + EXCLUDED.due_cents, updated_at = now()`,
          [wallet, earmarkCents],
        );
      }
    }
    if (earmarkCents > 0) plan.remainingCents = Math.max(0, plan.remainingCents - earmarkCents);

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
        plan.settledCents + termCents,
        allocation.toSavingsCents,
        allocation.toCashCents,
      ],
    );

    await client.query('COMMIT');

    // The deposit changed both the cash balance and what's outstanding, so every card this member
    // holds is now authorizing against a stale snapshot. Rewriting it is the point of step 3's
    // "precomputed lookup" — a snapshot nothing maintains is just a slower wrong answer.
    const snapshotsUpdated = await refreshSnapshotsFor(wallet);

    // Fiat that paid down card debt here has to come off the chain too, or the member would still
    // owe it there. Not awaited: an on-chain write takes seconds; the sweep catches what this misses.
    if (plan && receipt.rail === 'lithic_ach') {
      void syncCardRepayment(wallet).catch((error) =>
        console.error(`[card-repayment] ${wallet} could not start:`, error),
      );
    }

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

/**
 * What the member owes for the purpose of SPENDING, per tier: what a deposit would pay, plus
 * anything set aside for an open dispute.
 *
 * A disputed amount is "held, not spent". It is moved out of the tier accounts so a deposit does not
 * pay it and the cycle does not count it -- but it is still money the member has used, so it keeps
 * using up the tier until the dispute is decided. Counting it here is what stops the card lending the
 * same room twice.
 */
export async function outstandingForSpend(wallet: string): Promise<Outstanding | null> {
  const pool = getPayPool();
  if (!pool) return null;
  await ensureTables();
  const client = await pool.connect();
  try {
    const w = wallet.trim().toLowerCase();
    const owed = await readOutstanding(client, w);
    const { rows } = await client.query<{ account: string; net: string }>(
      `SELECT account, SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE -amount_cents END) AS net
         FROM ${ENTRIES}
        WHERE wallet = $1 AND account LIKE 'member_credit_disputed_%'
        GROUP BY account`,
      [w],
    );
    for (const row of rows) {
      const tier = row.account.replace('member_credit_disputed_', '') as keyof Outstanding;
      if (tier in owed) owed[tier] += Math.max(0, parseInt(row.net, 10) || 0);
    }
    return owed;
  } finally {
    client.release();
  }
}

/**
 * A repayment the member made ON CHAIN, in USDC, recorded in our books from the chain's own figures.
 *
 * `revolvingCents` is what the card tiers absorbed (the issuer's TierRepaid events), not the whole
 * payment: an undirected repayment can also reach a term plan, which these books do not carry. It
 * is applied the way a deposit settles debt -- carry first, then the dearest tier -- so the books
 * and the chain agree on what is left.
 *
 * Idempotent by transaction: the same repayment reported twice is recorded once.
 */
export async function recordOnchainRepayment(input: {
  wallet: string;
  txHash: string;
  totalCents: number;
  revolvingCents: number;
  /**
   * A repayment made out of the member's own savings settles the SAVINGS tier on chain, not the
   * dearest one, so the books have to settle savings too. Absent for an ordinary repayment.
   */
  savingsCents?: number;
  /** How the member paid: a Repay tap, automatic repayment, or out of savings. Shown in Activity. */
  method?: 'manual' | 'auto' | 'savings';
}): Promise<{ recorded: boolean; duplicate: boolean; plan: SettlementPlan | null }> {
  const pool = getPayPool();
  if (!pool) return { recorded: false, duplicate: false, plan: null };
  await ensureTables();
  const wallet = input.wallet.trim().toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS card_onchain_repayments (
        tx_hash TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        total_cents BIGINT NOT NULL,
        revolving_cents BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await client.query(`ALTER TABLE card_onchain_repayments ADD COLUMN IF NOT EXISTS method TEXT`);
    const inserted = await client.query(
      `INSERT INTO card_onchain_repayments (tx_hash, wallet, total_cents, revolving_cents, method)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tx_hash) DO NOTHING`,
      [
        input.txHash.toLowerCase(),
        wallet,
        input.totalCents,
        input.revolvingCents,
        (input.savingsCents ?? 0) > 0 ? 'savings' : (input.method ?? 'manual'),
      ],
    );
    if (!inserted.rowCount) {
      await client.query('COMMIT');
      return { recorded: false, duplicate: true, plan: null };
    }

    const outstanding = await readOutstanding(client, wallet);
    // Out of savings: straight to the savings tier, as the chain did. Anything beyond it (there should
    // be none) falls through to the ordinary order.
    const toSavings = Math.min(Math.max(0, Math.round(input.savingsCents ?? 0)), outstanding.savings, input.revolvingCents);
    const fundedFromSavings = toSavings;
    const rest = planSettlement(
      input.revolvingCents - toSavings,
      { ...outstanding, savings: outstanding.savings - toSavings },
      toSavings > 0 ? 0 : await readCarryOwed(client, wallet),
    );
    const plan: SettlementPlan =
      toSavings > 0
        ? { ...rest, settlements: [{ tier: 'savings', amountCents: toSavings }, ...rest.settlements], settledCents: rest.settledCents + toSavings }
        : rest;
    const group = `onchain-repay:${input.txHash.toLowerCase()}`;
    for (const settlement of plan.settlements) {
      await client.query(
        `INSERT INTO ${ENTRIES} (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
         VALUES ($1, $2, $3, 'credit', $4, 'chain', 'onchain_repayment', $5, $6::jsonb),
                ($1, $2, $7, 'debit', $4, 'chain', 'onchain_repayment', $5, $6::jsonb)`,
        [
          group,
          wallet,
          `member_credit_${settlement.tier}`,
          settlement.amountCents,
          `${input.txHash.toLowerCase()}:${settlement.tier}`,
          JSON.stringify({ tier: settlement.tier, txHash: input.txHash }),
          // Where the money came from. Out of savings it was the member's CLRUSD, not their USDC
          // cash -- charging cash for it would show them $X less cash than they hold.
          fundedFromSavings > 0 && settlement.tier === 'savings' ? 'member_savings' : 'member_cash_usdc',
        ],
      );
    }
    await client.query('COMMIT');
    await refreshSnapshotsFor(wallet);
    return { recorded: true, duplicate: false, plan };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export { SETTLEMENT_ORDER };
