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
  type Draw,
  type TierAvailability,
} from './authDecision.js';

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
    }>(`SELECT result, draws, credit_cents, availability, wallet FROM ${DECISIONS} WHERE transaction_token = $1`, [
      input.transactionToken,
    ]);

    if (existing.rows[0]) {
      await client.query('COMMIT');
      const row = existing.rows[0];
      return {
        decision: {
          result: row.result as AuthDecision['result'],
          draws: (row.draws as AuthDecision['draws']) ?? [],
          creditCents: parseInt(row.credit_cents, 10) || 0,
          availableCents: 0,
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
    });

    // 3. Decrement and write the issuance, only on an approval that actually drew something.
    if (decision.result === 'APPROVED' && decision.draws.length > 0) {
      const next = applyDraws(availability, decision.draws);
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
       result, draws, credit_cents, availability, merchant, latency_ms, net_cents
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb, $11, $12)
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
    }>(
      `SELECT card_token, wallet, amount_cents, result, draws, net_cents, unfunded_cents
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
        `UPDATE ${DECISIONS} SET status = COALESCE($2, status), reconciled_at = now()
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
        `UPDATE ${DECISIONS} SET status = COALESCE($2, status), reconciled_at = now()
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

    await client.query(
      `UPDATE ${SNAPSHOTS}
       SET cash_cents = $2, savings_cents = $3, asset_cents = $4, income_cents = $5,
           boost_cents = $6, updated_at = now()
       WHERE card_token = $1`,
      [row.card_token, next.cashCents, next.savingsCents, next.assetCents, next.incomeCents, next.boostCents],
    );

    const creditCents = draws
      .filter((d) => d.source !== 'cash')
      .reduce((sum, d) => sum + d.amountCents, 0);

    await client.query(
      `UPDATE ${DECISIONS}
       SET net_cents = $2, draws = $3::jsonb, credit_cents = $4, unfunded_cents = $5,
           status = COALESCE($6, status), reconciled_at = now()
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
      `INSERT INTO ${SNAPSHOTS} (card_token, wallet, cash_cents, savings_cents, asset_cents, income_cents, boost_cents, card_paused)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (card_token) DO UPDATE SET
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
};
