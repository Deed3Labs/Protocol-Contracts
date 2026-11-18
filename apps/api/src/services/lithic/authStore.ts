import type { PoolClient } from 'pg';
import { getPayPool } from '../../config/postgres.js';
import {
  applyDraws,
  decide,
  drawUpTo,
  mergeDraws,
  releaseDraws,
  restoreDraws,
  type AuthDecision,
  type CreditFeeInput,
  type Draw,
  type TierAvailability,
} from './authDecision.js';
import { currentCreditFee, type CreditFeeStatus } from './cardCreditFee.js';

/*
 * The authorization side of the ledger — spec step 3.
 *
 * Three tables, each earning its place:
 *
 *  lithic_tier_snapshots   what is spendable, per card, precomputed. The authorization path reads
 *                          exactly one indexed row. It never derives availability, never reads the
 *                          chain, never calls out — that is the whole point of keeping a snapshot.
 *
 *  lithic_auth_decisions   every decision with the inputs that produced it. Primary-keyed on
 *                          Lithic's transaction token, which is what makes a replayed request
 *                          return its original verdict instead of drawing twice. We will have to
 *                          explain individual authorizations to members; this is that record.
 *
 *  lithic_ledger_entries   double entry. Every credit issuance writes a balanced pair, grouped by
 *                          the decision that caused it, so the sum over a member is the position
 *                          and the sum over everyone is zero.
 *
 * Postgres alone, no Redis in the read path. The budget is 6 seconds and one primary-key lookup on
 * a local pool is under a millisecond; a cache in front of it would buy nothing measurable and
 * introduce the one failure this must not have — approving against a stale balance.
 */

const SNAPSHOTS = 'lithic_tier_snapshots';
const DECISIONS = 'lithic_auth_decisions';
const ENTRIES = 'lithic_ledger_entries';
const COVERED = 'lithic_covered_borrowers';

let ensured = false;

async function ensureTables(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SNAPSHOTS} (
      card_token TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      cash_cents BIGINT NOT NULL DEFAULT 0,
      savings_cents BIGINT NOT NULL DEFAULT 0,
      asset_cents BIGINT NOT NULL DEFAULT 0,
      income_cents BIGINT NOT NULL DEFAULT 0,
      boost_cents BIGINT NOT NULL DEFAULT 0,
      card_paused BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ${SNAPSHOTS}_wallet_idx ON ${SNAPSHOTS} (wallet);

    CREATE TABLE IF NOT EXISTS ${DECISIONS} (
      transaction_token TEXT PRIMARY KEY,
      card_token TEXT NOT NULL,
      wallet TEXT,
      amount_cents BIGINT NOT NULL,
      request_status TEXT,
      result TEXT NOT NULL,
      draws JSONB NOT NULL DEFAULT '[]'::jsonb,
      credit_cents BIGINT NOT NULL DEFAULT 0,
      availability JSONB,
      merchant JSONB,
      latency_ms INTEGER,
      decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ${DECISIONS}_wallet_idx ON ${DECISIONS} (wallet, decided_at DESC);

    /*
     * What is *currently* drawn against this transaction, which is not what was authorized.
     * An authorization is an opening position: it gets reversed, voided, or cleared for a different
     * figure, and every one of those has to move the member's availability back. net_cents is the
     * running answer and the draws column is rewritten alongside it, so the two always describe the
     * same held amount. Null means never reconciled — the authorization amount still stands.
     */
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS net_cents BIGINT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS status TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS unfunded_cents BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;
    /*
     * When Lithic first reported the transaction SETTLED. Set once and never moved by a later
     * event, unlike reconciled_at: the settlement funding desk (jobs/fundingDesk.ts) reads it to
     * know which bank cut-off a credit portion is due at.
     */
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
    /*
     * The card credit fee (decision 55; migration 0084 adds the same columns where this table shares
     * the migrated database). Beside the purchase, never inside it: draws and credit_cents keep
     * meaning the purchase, which settlement funding (fiat owed to the merchant) relies on. The
     * fee is Clear Lending's, on the member's line, and is never paid to anyone in fiat.
     *   fee_cents    what was decided at the swipe; fee_draws, the tiers it came from.
     *   fee_status   held | charged | released | waived | returned (cardCreditFee.ts). Null: none.
     */
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_cents BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_draws JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_status TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_at TIMESTAMPTZ;
    /*
     * Credited back by returnCardCreditFee (MB-04 §5.4(f)), apart from the full-refund return:
     *   fee_return_target_cents  what should have been credited back, in total;
     *   fee_returned_cents       what the chain says has been (cardCreditFeeOf's returned);
     *   fee_return_*             the last attempt's outcome, like every other chain call here.
     */
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_return_target_cents BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_returned_cents BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_return_status TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_return_tx TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_return_error TEXT;
    ALTER TABLE ${DECISIONS} ADD COLUMN IF NOT EXISTS fee_return_attempts INTEGER NOT NULL DEFAULT 0;

    /*
     * Covered borrowers under the Military Lending Act (MB-04 §5.10): no card credit fee while a
     * member is one. Kept per member and copied onto each card's snapshot when it is written, so
     * the Auth Stream reads it from the one row it already reads. No row, or NULL: not covered.
     * Nothing sets it yet: the covered-borrower check is still to be built (authStore.setCoveredBorrower).
     */
    CREATE TABLE IF NOT EXISTS ${COVERED} (
      wallet TEXT PRIMARY KEY,
      covered BOOLEAN,
      source TEXT,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE ${SNAPSHOTS} ADD COLUMN IF NOT EXISTS covered_borrower BOOLEAN;

    CREATE TABLE IF NOT EXISTS ${ENTRIES} (
      id BIGSERIAL PRIMARY KEY,
      entry_group TEXT NOT NULL,
      wallet TEXT NOT NULL,
      account TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
      amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
      rail TEXT NOT NULL,
      event_type TEXT NOT NULL,
      external_id TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ${ENTRIES}_group_idx ON ${ENTRIES} (entry_group);
    CREATE INDEX IF NOT EXISTS ${ENTRIES}_wallet_idx ON ${ENTRIES} (wallet, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS ${ENTRIES}_event_idx
      ON ${ENTRIES} (event_type, external_id, account) WHERE external_id IS NOT NULL;
  `);
  ensured = true;
}

export interface SnapshotRow extends TierAvailability {
  cardToken: string;
  wallet: string;
  cardPaused: boolean;
}

export interface AuthorizeInput {
  transactionToken: string;
  cardToken: string;
  amountCents: number;
  requestStatus: string;
  merchant?: unknown;
  /** The card credit fee in force. Omitted: the cached settings (the Auth Stream's case). */
  creditFee?: CreditFeeInput;
}

export interface AuthorizeOutcome {
  decision: AuthDecision;
  /** True when this token had already been decided and we replayed the stored verdict. */
  replayed: boolean;
  /** False when the card is unknown to us — fail closed, and say so in the log. */
  known: boolean;
  wallet: string | null;
}

function toAvailability(row: {
  cash_cents: string | number;
  savings_cents: string | number;
  asset_cents: string | number;
  income_cents: string | number;
  boost_cents: string | number;
}): TierAvailability {
  const n = (v: string | number) => (typeof v === 'string' ? parseInt(v, 10) : v) || 0;
  return {
    cashCents: n(row.cash_cents),
    savingsCents: n(row.savings_cents),
    assetCents: n(row.asset_cents),
    incomeCents: n(row.income_cents),
    boostCents: n(row.boost_cents),
  };
}

/**
 * Decide an authorization and commit its consequences in one transaction.
 *
 * The order inside matters. The decision row is inserted first with ON CONFLICT DO NOTHING, so a
 * replayed request is detected before anything is decremented — Lithic retries, and a retry that
 * draws a second time is money invented from nothing. Then the snapshot is locked FOR UPDATE, which
 * serialises two authorizations racing on one card; without it, two swipes at the same instant
 * could each see the same balance and both approve.
 */
export async function authorize(input: AuthorizeInput): Promise<AuthorizeOutcome> {
  const pool = getPayPool();
  if (!pool) {
    // No ledger, no approval. Fail closed.
    return {
      decision: {
        result: 'INSUFFICIENT_FUNDS',
        draws: [],
        creditCents: 0,
        availableCents: 0,
        feeCents: 0,
        feeDraws: [],
      },
      replayed: false,
      known: false,
      wallet: null,
    };
  }
  await ensureTables();

  const started = Date.now();
  const client: PoolClient = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Idempotency. If this token was already decided, replay that verdict untouched.
    const existing = await client.query<{
      result: string;
      draws: unknown;
      credit_cents: string;
      availability: unknown;
      wallet: string | null;
      fee_cents: string | number | null;
      fee_draws: unknown;
    }>(
      `SELECT result, draws, credit_cents, availability, wallet, fee_cents, fee_draws FROM ${DECISIONS} WHERE transaction_token = $1`,
      [input.transactionToken],
    );

    if (existing.rows[0]) {
      await client.query('COMMIT');
      const row = existing.rows[0];
      return {
        decision: {
          result: row.result as AuthDecision['result'],
          draws: (row.draws as AuthDecision['draws']) ?? [],
          creditCents: parseInt(String(row.credit_cents), 10) || 0,
          availableCents: 0,
          feeCents: Number(row.fee_cents ?? 0) || 0,
          feeDraws: Array.isArray(row.fee_draws) ? (row.fee_draws as Draw[]) : [],
        },
        replayed: true,
        known: true,
        wallet: row.wallet,
      };
    }

    // 2. Lock the card's snapshot. This is the serialisation point for concurrent swipes.
    const snapshot = await client.query(
      `SELECT * FROM ${SNAPSHOTS} WHERE card_token = $1 FOR UPDATE`,
      [input.cardToken],
    );

    if (!snapshot.rows[0]) {
      // A card we have no snapshot for cannot be funded. Record the decline so the gap is visible.
      const decision: AuthDecision = {
        result: 'INSUFFICIENT_FUNDS',
        draws: [],
        creditCents: 0,
        availableCents: 0,
        feeCents: 0,
        feeDraws: [],
      };
      await recordDecision(client, input, decision, null, Date.now() - started);
      await client.query('COMMIT');
      return { decision, replayed: false, known: false, wallet: null };
    }

    const row = snapshot.rows[0];
    const availability = toAvailability(row);
    const decision = decide({
      amountCents: input.amountCents,
      availability,
      cardPaused: Boolean(row.card_paused),
      // No fee for a covered borrower (MB-04 §5.10). Null, as for every member today, is not covered.
      coveredBorrower: row.covered_borrower === true,
      // The card credit fee: settings and a cached chain bound, no I/O (cardCreditFee.ts).
      creditFee: input.creditFee ?? currentCreditFee(),
    });

    // 3. Decrement and write the issuance, only on an approval that actually drew something. The fee
    //    comes off the snapshot with the purchase: it uses the same room.
    if (decision.result === 'APPROVED' && decision.draws.length > 0) {
      const next = applyDraws(availability, [...decision.draws, ...decision.feeDraws]);
      await client.query(
        `UPDATE ${SNAPSHOTS}
         SET cash_cents = $2, savings_cents = $3, asset_cents = $4, income_cents = $5,
             boost_cents = $6, updated_at = now()
         WHERE card_token = $1`,
        [
          input.cardToken,
          next.cashCents,
          next.savingsCents,
          next.assetCents,
          next.incomeCents,
          next.boostCents,
        ],
      );

      if (decision.creditCents > 0) {
        await recordCreditIssuance(client, row.wallet, input, decision);
      }
      if (decision.feeCents > 0) {
        await recordCreditFee(client, row.wallet, input.transactionToken, input.cardToken, decision.feeDraws);
      }
    }

    await recordDecision(client, input, decision, row.wallet, Date.now() - started);
    await client.query('COMMIT');

    return { decision, replayed: false, known: true, wallet: row.wallet };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function recordDecision(
  client: PoolClient,
  input: AuthorizeInput,
  decision: AuthDecision,
  wallet: string | null,
  latencyMs: number,
): Promise<void> {
  await client.query(
    `INSERT INTO ${DECISIONS} (
       transaction_token, card_token, wallet, amount_cents, request_status,
       result, draws, credit_cents, availability, merchant, latency_ms, net_cents,
       fee_cents, fee_draws, fee_status, fee_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb, $11, $12,
             $13, $14::jsonb, $15, CASE WHEN $15::text IS NULL THEN NULL ELSE now() END)
     ON CONFLICT (transaction_token) DO NOTHING`,
    [
      input.transactionToken,
      input.cardToken,
      wallet,
      input.amountCents,
      input.requestStatus,
      decision.result,
      JSON.stringify(decision.draws),
      decision.creditCents,
      JSON.stringify({ availableCents: decision.availableCents }),
      JSON.stringify(input.merchant ?? null),
      latencyMs,
      // A decline holds nothing, so there is nothing for a later reversal to give back.
      decision.result === 'APPROVED' ? Math.max(0, input.amountCents) : 0,
      decision.result === 'APPROVED' ? decision.feeCents : 0,
      JSON.stringify(decision.result === 'APPROVED' ? decision.feeDraws : []),
      decision.result === 'APPROVED' && decision.feeCents > 0 ? ('held' satisfies CreditFeeStatus) : null,
    ],
  );
}

export interface ReconcileInput {
  transactionToken: string;
  /** What Lithic now holds against this transaction, in cents. Zero for a void. */
  targetCents: number;
  /** Lithic's transaction status, for the record. */
  status?: string;
}

export interface ReconcileOutcome {
  /** `unknown` means we never decided this authorization — there is nothing of ours to adjust. */
  outcome: 'no-ledger' | 'unknown' | 'unchanged' | 'released' | 'drawn';
  /** Negative when money came back to the member, positive when more was drawn. */
  deltaCents: number;
  /** Part of an increase that no tier could cover. Recorded, never silently dropped. */
  unfundedCents: number;
  wallet: string | null;
}

/**
 * Bring our ledger back in line with what the transaction actually holds.
 *
 * The authorization path is one-directional by design: it decides, decrements, and writes the
 * issuance. Everything that happens to a card transaction *after* the swipe — a void, a partial
 * reversal, a clearing for a different figure — moves the real amount, and nothing was moving ours.
 * A member who was refused at a till because $5 of a voided charge never came back would be right to
 * be furious, and they would be right about the balance too.
 *
 * Reconciling to a target rather than applying each event's delta is what makes this safe to run on
 * a webhook. Lithic redelivers, events arrive out of order, and the same transaction can be reported
 * many times; comparing against what we currently hold means a repeat is a no-op instead of a second
 * refund. The comparison happens under a row lock, so two deliveries racing cannot both see the old
 * figure.
 */
export async function reconcile(input: ReconcileInput): Promise<ReconcileOutcome> {
  const pool = getPayPool();
  if (!pool) return { outcome: 'no-ledger', deltaCents: 0, unfundedCents: 0, wallet: null };
  await ensureTables();

  const client: PoolClient = await pool.connect();

  try {
    await client.query('BEGIN');

    const decided = await client.query<{
      card_token: string;
      wallet: string | null;
      amount_cents: string;
      result: string;
      draws: unknown;
      net_cents: string | null;
      unfunded_cents: string | null;
      fee_cents: string | number | null;
      fee_draws: unknown;
      fee_status: string | null;
    }>(
      `SELECT card_token, wallet, amount_cents, result, draws, net_cents, unfunded_cents,
              fee_cents, fee_draws, fee_status
         FROM ${DECISIONS} WHERE transaction_token = $1 FOR UPDATE`,
      [input.transactionToken],
    );

    const row = decided.rows[0];

    /*
     * A transaction we never decided. Either it predates the auth stream reaching us, or Lithic
     * approved it without asking — which is exactly what happens when Auth Stream Access is not
     * pointed at this deployment. Either way there is no draw of ours to adjust, and inventing one
     * from a webhook would put a charge on a member the waterfall never approved.
     */
    if (!row || row.result !== 'APPROVED') {
      await client.query('COMMIT');
      return { outcome: 'unknown', deltaCents: 0, unfundedCents: 0, wallet: row?.wallet ?? null };
    }

    const held = row.net_cents === null ? parseInt(row.amount_cents, 10) || 0 : parseInt(row.net_cents, 10) || 0;
    const target = Math.max(0, Math.round(input.targetCents));
    const delta = target - held;

    if (delta === 0) {
      await client.query(
        `UPDATE ${DECISIONS} SET status = COALESCE($2, status), reconciled_at = now(),
              settled_at = CASE WHEN $2 = 'SETTLED' THEN COALESCE(settled_at, now()) ELSE settled_at END
          WHERE transaction_token = $1`,
        [input.transactionToken, input.status ?? null],
      );
      await client.query('COMMIT');
      return { outcome: 'unchanged', deltaCents: 0, unfundedCents: 0, wallet: row.wallet };
    }

    // The snapshot is locked for the same reason the authorization path locks it: this writes a new
    // availability derived from the one it read.
    const snapshot = await client.query(
      `SELECT * FROM ${SNAPSHOTS} WHERE card_token = $1 FOR UPDATE`,
      [row.card_token],
    );

    if (!snapshot.rows[0]) {
      // Nothing to put it back on. Record the intent so the gap is visible rather than silent.
      await client.query(
        `UPDATE ${DECISIONS} SET status = COALESCE($2, status), reconciled_at = now(),
              settled_at = CASE WHEN $2 = 'SETTLED' THEN COALESCE(settled_at, now()) ELSE settled_at END
          WHERE transaction_token = $1`,
        [input.transactionToken, input.status ?? null],
      );
      await client.query('COMMIT');
      console.error(
        `[lithic:reconcile] no snapshot for card ${row.card_token} — ${delta}c not applied`,
      );
      return { outcome: 'unknown', deltaCents: 0, unfundedCents: 0, wallet: row.wallet };
    }

    const availability = toAvailability(snapshot.rows[0]);
    const current = (Array.isArray(row.draws) ? row.draws : []) as Draw[];
    const wallet = row.wallet ?? String(snapshot.rows[0].wallet ?? '');

    let next: TierAvailability;
    let draws: Draw[];
    let unfunded = parseInt(row.unfunded_cents ?? '0', 10) || 0;
    let moved: Draw[];
    let outcome: ReconcileOutcome['outcome'];

    if (delta < 0) {
      // Money coming back. Give it to the dearest tier first and take it off what we hold.
      moved = releaseDraws(current, -delta);
      next = restoreDraws(availability, moved);
      draws = mergeDraws(current, moved.map((d) => ({ ...d, amountCents: -d.amountCents })));
      outcome = 'released';
    } else {
      // The charge grew after the swipe. It has already happened, so it is placed, not judged.
      const more = drawUpTo(availability, delta);
      moved = more.draws;
      next = applyDraws(availability, moved);
      draws = mergeDraws(current, moved);
      unfunded += more.shortfallCents;
      outcome = 'drawn';
      if (more.shortfallCents > 0) {
        console.error(
          `[lithic:reconcile] ${more.shortfallCents}c of ${input.transactionToken} unfunded —` +
            ` no tier had room for a clearing above its authorization`,
        );
      }
    }

    const creditCents = draws
      .filter((d) => d.source !== 'cash')
      .reduce((sum, d) => sum + d.amountCents, 0);

    /*
     * The card credit fee rides on the purchase's credit part (decision 55). While that part stands,
     * the fee stands too: a partial refund keeps it, and a clearing above the authorization keeps
     * the same fee rather than adding another. When it falls to zero (a void, a full refund, or a
     * clearing that ended up paid from cash), the fee goes with it. Before settlement it was never
     * charged, so it is released here: its draws go back on the snapshot and its ledger entries are
     * reversed. After settlement (charged) it is the chain's to give back: the contract returns
     * it on the reversal that brings the purchase to zero, and the settlement sync records that from
     * the chain, ledger included (cardSettlementService), so the books never say it is back while
     * the chain still carries it.
     */
    const feeDrawn = (Array.isArray(row.fee_draws) ? row.fee_draws : []) as Draw[];
    const feeGoes = creditCents <= 0 && row.fee_status === 'held';
    if (feeGoes) next = restoreDraws(next, feeDrawn);

    await client.query(
      `UPDATE ${SNAPSHOTS}
       SET cash_cents = $2, savings_cents = $3, asset_cents = $4, income_cents = $5,
           boost_cents = $6, updated_at = now()
       WHERE card_token = $1`,
      [row.card_token, next.cashCents, next.savingsCents, next.assetCents, next.incomeCents, next.boostCents],
    );

    if (feeGoes) {
      await client.query(
        `UPDATE ${DECISIONS} SET fee_status = 'released', fee_at = now() WHERE transaction_token = $1`,
        [input.transactionToken],
      );
      if (wallet) {
        await recordCreditFeeReversal(client, wallet, input.transactionToken, row.card_token, feeDrawn, 'card_credit_fee_released');
      }
    }

    await client.query(
      `UPDATE ${DECISIONS}
       SET net_cents = $2, draws = $3::jsonb, credit_cents = $4, unfunded_cents = $5,
           status = COALESCE($6, status), reconciled_at = now(),
           settled_at = CASE WHEN $6 = 'SETTLED' THEN COALESCE(settled_at, now()) ELSE settled_at END
       WHERE transaction_token = $1`,
      [
        input.transactionToken,
        target,
        JSON.stringify(draws),
        creditCents,
        unfunded,
        input.status ?? null,
      ],
    );

    if (wallet) {
      await recordAdjustment(client, wallet, row.card_token, input.transactionToken, target, moved, delta < 0);
    }

    await client.query('COMMIT');

    return { outcome, deltaCents: delta, unfundedCents: unfunded, wallet: row.wallet };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The double entry for an adjustment after the swipe.
 *
 * A release is the issuance run backwards: the member stops owing the tier, and the co-op's float
 * stops carrying it. An increase is a further issuance. Cash is left out of both for the same reason
 * it is left out of the original — spending your own money issues no credit, so there is nothing to
 * reverse.
 *
 * The external id carries the resulting net, which makes a redelivery collide with itself on the
 * unique index rather than posting a second pair.
 */
async function recordAdjustment(
  client: PoolClient,
  wallet: string,
  cardToken: string,
  transactionToken: string,
  netCents: number,
  moved: Draw[],
  released: boolean,
): Promise<void> {
  const creditMoves = moved.filter((d) => d.source !== 'cash' && d.amountCents > 0);

  for (const draw of creditMoves) {
    const memberDirection = released ? 'credit' : 'debit';
    const floatDirection = released ? 'debit' : 'credit';
    await client.query(
      `INSERT INTO ${ENTRIES} (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
       VALUES ($1, $2, $3, $7, $4, 'fiat', 'card_auth_adjustment', $5, $6::jsonb),
              ($1, $2, 'coop_settlement_float', $8, $4, 'fiat', 'card_auth_adjustment', $5, $6::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        transactionToken,
        wallet,
        `member_credit_${draw.source}`,
        draw.amountCents,
        `${transactionToken}:${draw.source}:${netCents}`,
        JSON.stringify({ cardToken, tier: draw.source, netCents, released }),
        memberDirection,
        floatDirection,
      ],
    );
  }
}

/**
 * The double entry for credit drawn at a swipe.
 *
 * The co-op's settlement float funds the fiat side of the authorization now; the member owes that
 * amount against the tier they drew. Two rows, equal and opposite, sharing the decision's token as
 * their group — so the ledger balances by construction rather than by a later sweep.
 */
async function recordCreditIssuance(
  client: PoolClient,
  wallet: string,
  input: AuthorizeInput,
  decision: AuthDecision,
): Promise<void> {
  const creditDraws = decision.draws.filter((d) => d.source !== 'cash');

  for (const draw of creditDraws) {
    await client.query(
      `INSERT INTO ${ENTRIES} (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
       VALUES ($1, $2, $3, 'debit', $4, 'fiat', 'card_auth', $5, $6::jsonb),
              ($1, $2, 'coop_settlement_float', 'credit', $4, 'fiat', 'card_auth', $5, $6::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        input.transactionToken,
        wallet,
        `member_credit_${draw.source}`,
        draw.amountCents,
        `${input.transactionToken}:${draw.source}`,
        JSON.stringify({ cardToken: input.cardToken, tier: draw.source }),
      ],
    );
  }
}

/*
 * The card credit fee's double entry (decision 55), its own lines rather than part of the purchase's.
 *
 * At the swipe the member owes the fee against the tier it was drawn from, like the purchase, so it
 * counts in what they owe and in each tier's outstanding; the other side is Clear Lending's fee
 * income (the contract mints the fee's claim to the card settlement account, CL Operating), not the
 * settlement float: no fiat leaves for it. A fee that is released (a void before settlement), waived
 * (the chain refused it at settlement) or returned (a full refund after settlement) is reversed with
 * the same pair the other way, under its own event type, so the history says which it was.
 *
 * Keyed by the purchase and the tier, so a redelivery collides with itself on the unique index.
 */
export const CARD_CREDIT_FEE_ACCOUNT = 'coop_card_credit_fees';
/**
 * Released, waived and returned give back the whole of what is left. A credit
 * (`card_credit_fee_credit`, returnCardCreditFee: the CFL cap of MB-04 §5.4(f)) gives back part of it,
 * and is keyed by the running total credited so each one is booked once.
 */
export type CreditFeeReversal =
  | 'card_credit_fee_released'
  | 'card_credit_fee_waived'
  | 'card_credit_fee_returned'
  | 'card_credit_fee_credit';

type Queryable = Pick<PoolClient, 'query'>;

async function recordCreditFee(
  client: Queryable,
  wallet: string,
  transactionToken: string,
  cardToken: string,
  feeDraws: Draw[],
): Promise<void> {
  for (const draw of feeDraws) {
    if (draw.source === 'cash' || !(draw.amountCents > 0)) continue;
    await client.query(
      `INSERT INTO ${ENTRIES} (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
       VALUES ($1, $2, $3, 'debit', $4, 'fiat', 'card_credit_fee', $5, $6::jsonb),
              ($1, $2, '${CARD_CREDIT_FEE_ACCOUNT}', 'credit', $4, 'fiat', 'card_credit_fee', $5, $6::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        transactionToken,
        wallet,
        `member_credit_${draw.source}`,
        draw.amountCents,
        `${transactionToken}:fee:${draw.source}`,
        JSON.stringify({ cardToken, tier: draw.source, fee: true }),
      ],
    );
  }
}

/** Give the fee back in the books: released, waived or returned. Exported for the settlement sync. */
export async function recordCreditFeeReversal(
  client: Queryable,
  wallet: string,
  transactionToken: string,
  cardToken: string | null,
  feeDraws: Draw[],
  eventType: CreditFeeReversal,
  /** For a partial credit: the running total credited back after this one, which keys it. */
  creditedTotalCents?: number,
): Promise<void> {
  for (const draw of feeDraws) {
    if (draw.source === 'cash' || !(draw.amountCents > 0)) continue;
    const key =
      creditedTotalCents === undefined
        ? `${transactionToken}:fee:${draw.source}`
        : `${transactionToken}:fee:${draw.source}:${creditedTotalCents}`;
    await client.query(
      `INSERT INTO ${ENTRIES} (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
       VALUES ($1, $2, $3, 'credit', $4, 'fiat', $7, $5, $6::jsonb),
              ($1, $2, '${CARD_CREDIT_FEE_ACCOUNT}', 'debit', $4, 'fiat', $7, $5, $6::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        transactionToken,
        wallet,
        `member_credit_${draw.source}`,
        draw.amountCents,
        key,
        JSON.stringify({ cardToken, tier: draw.source, fee: true }),
        eventType,
      ],
    );
  }
}

/** Whether a member is a covered borrower (MB-04 §5.10). Null: never checked, which is not covered. */
export async function coveredBorrowerOf(wallet: string): Promise<boolean | null> {
  const pool = getPayPool();
  if (!pool) return null;
  await ensureTables();
  const { rows } = await pool.query<{ covered: boolean | null }>(`SELECT covered FROM ${COVERED} WHERE wallet = $1`, [
    wallet.trim().toLowerCase(),
  ]);
  return rows[0]?.covered ?? null;
}

/**
 * Record a member's covered-borrower status and put it on every card snapshot they have, so the next
 * authorization sees it. For the covered-borrower check, which does not exist yet: nothing calls this
 * outside tests today, and every member reads as not covered.
 */
export async function setCoveredBorrower(wallet: string, covered: boolean | null, source: string): Promise<void> {
  const pool = getPayPool();
  if (!pool) return;
  await ensureTables();
  const w = wallet.trim().toLowerCase();
  await pool.query(
    `INSERT INTO ${COVERED} (wallet, covered, source, checked_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (wallet) DO UPDATE SET covered = EXCLUDED.covered, source = EXCLUDED.source, checked_at = now()`,
    [w, covered, source],
  );
  await pool.query(`UPDATE ${SNAPSHOTS} SET covered_borrower = $2 WHERE wallet = $1`, [w, covered]);
}

/** For the settlement sync: make sure the ledger table exists before it writes a fee reversal. */
export async function ensureAuthTables(): Promise<void> {
  await ensureTables();
}

export const authStore = {
  isConfigured(): boolean {
    return Boolean(getPayPool());
  },

  /** Write or replace a card's availability. Called by whatever changes a balance. */
  async putSnapshot(snapshot: SnapshotRow): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(
      `INSERT INTO ${SNAPSHOTS} (card_token, wallet, cash_cents, savings_cents, asset_cents, income_cents, boost_cents, card_paused,
                                 covered_borrower)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT covered FROM ${COVERED} WHERE wallet = $2))
       ON CONFLICT (card_token) DO UPDATE SET
         covered_borrower = EXCLUDED.covered_borrower,
         wallet = EXCLUDED.wallet,
         cash_cents = EXCLUDED.cash_cents,
         savings_cents = EXCLUDED.savings_cents,
         asset_cents = EXCLUDED.asset_cents,
         income_cents = EXCLUDED.income_cents,
         boost_cents = EXCLUDED.boost_cents,
         card_paused = EXCLUDED.card_paused,
         updated_at = now()`,
      [
        snapshot.cardToken,
        snapshot.wallet.toLowerCase(),
        snapshot.cashCents,
        snapshot.savingsCents,
        snapshot.assetCents,
        snapshot.incomeCents,
        snapshot.boostCents,
        snapshot.cardPaused,
      ],
    );
  },

  async getSnapshot(cardToken: string): Promise<SnapshotRow | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTables();
    const { rows } = await pool.query(`SELECT * FROM ${SNAPSHOTS} WHERE card_token = $1`, [
      cardToken,
    ]);
    if (!rows[0]) return null;
    return {
      cardToken: rows[0].card_token,
      wallet: rows[0].wallet,
      cardPaused: Boolean(rows[0].card_paused),
      ...toAvailability(rows[0]),
    };
  },

  authorize,
  reconcile,
  coveredBorrowerOf,
  setCoveredBorrower,
};
