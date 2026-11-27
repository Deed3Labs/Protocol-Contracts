import { randomUUID } from 'node:crypto';
import { getPayPool } from '../../config/postgres.js';

/*
 * Member disputes — something went wrong with a payment, and the member has said so.
 *
 * Three kinds, because who decides changes with what went wrong:
 *   card    — a shop charged the card wrong. Visa's rules decide, through Lithic.
 *   partner — a Clear Partner was paid through Clear. Clear mediates.
 *   member  — a send between two members. An independent third party decides; Clear does not judge
 *             between two of its own members, and is bound by the outcome like they are.
 *
 * Stored before anything else happens, the same rule as assurance claims: a form that looked like
 * it worked and went nowhere is the failure this exists to prevent. A card dispute is then opened
 * with Lithic, and if that call fails the dispute is still ours — it stays `open`, the error is kept,
 * and the member is told the network part did not go through rather than that nothing happened.
 *
 * What was disputed is copied in beside its reference (the name, the amount), deliberately
 * denormalised: the dispute has to keep saying what the member disputed, whatever the source row
 * says later.
 */

const TABLE = 'member_disputes';

export type DisputeKind = 'card' | 'partner' | 'member';

/** `with_network` only for card disputes Lithic accepted. Everything past `open` moves by hand or by Lithic. */
export type DisputeStatus = 'open' | 'with_network' | 'decided' | 'withdrawn';

export interface DisputeRecord {
  token: string;
  wallet: string;
  kind: DisputeKind;
  /** The transaction token, charge code or transfer id. */
  subjectRef: string;
  /** What the member saw it called when they disputed it. */
  subjectLabel: string;
  amountCents: number;
  /** Card disputes only: the network reason code sent to Lithic. */
  reason: string | null;
  detail: string;
  status: DisputeStatus;
  lithicDisputeToken: string | null;
  lithicStatus: string | null;
  /** Why the network filing failed, when it did. The dispute itself still stands. */
  lithicError: string | null;
  /**
   * What holding the disputed amount actually did. `held` when the amount was taken out of what the
   * member owes (card, partner) or the send was stopped from being claimed (member). `not_held` when
   * there was nothing that could be held -- a send the other member had already claimed.
   */
  /** `releasing`: decided, and the money is still moving (paid now); the sweep finishes it. */
  holdState: 'held' | 'not_held' | 'releasing' | 'released' | null;
  /** Exactly what was set aside, so it can be put back to the cent. */
  heldDetail: Record<string, unknown> | null;
  /** Who the decision went to, or `withdrawn`. */
  resolution: 'member' | 'merchant' | 'withdrawn' | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface Row {
  token: string;
  wallet: string;
  kind: string;
  subject_ref: string;
  subject_label: string;
  amount_cents: string;
  reason: string | null;
  detail: string;
  status: string;
  lithic_dispute_token: string | null;
  lithic_status: string | null;
  lithic_error: string | null;
  hold_state: string | null;
  held_detail: Record<string, unknown> | null;
  resolution: string | null;
  resolved_at: Date | null;
  created_at: Date;
}

let ensured = false;

async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      token TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      kind TEXT NOT NULL,
      subject_ref TEXT NOT NULL,
      subject_label TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      reason TEXT,
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      lithic_dispute_token TEXT,
      lithic_status TEXT,
      lithic_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS ${TABLE}_wallet_idx ON ${TABLE} (wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS ${TABLE}_subject_idx ON ${TABLE} (subject_ref);
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS hold_state TEXT;
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS held_detail JSONB;
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS resolution TEXT;
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS resolution_note TEXT;
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
  `);
  ensured = true;
}

function toRecord(row: Row): DisputeRecord {
  return {
    token: row.token,
    wallet: row.wallet,
    kind: row.kind as DisputeKind,
    subjectRef: row.subject_ref,
    subjectLabel: row.subject_label,
    amountCents: Number(row.amount_cents),
    reason: row.reason,
    detail: row.detail,
    status: row.status as DisputeStatus,
    lithicDisputeToken: row.lithic_dispute_token,
    lithicStatus: row.lithic_status,
    lithicError: row.lithic_error,
    holdState: (row.hold_state as DisputeRecord['holdState']) ?? null,
    heldDetail: row.held_detail ?? null,
    resolution: (row.resolution as DisputeRecord['resolution']) ?? null,
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export const disputeStore = {
  isConfigured(): boolean {
    return Boolean(getPayPool());
  },

  async file(input: {
    wallet: string;
    kind: DisputeKind;
    subjectRef: string;
    subjectLabel: string;
    amountCents: number;
    reason: string | null;
    detail: string;
  }): Promise<DisputeRecord | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `INSERT INTO ${TABLE} (token, wallet, kind, subject_ref, subject_label, amount_cents, reason, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        randomUUID(),
        input.wallet.trim().toLowerCase(),
        input.kind,
        input.subjectRef,
        input.subjectLabel,
        input.amountCents,
        input.reason,
        input.detail,
      ],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  /** Record what the network said. A failure is kept beside the dispute, never instead of it. */
  async recordNetwork(
    token: string,
    outcome: { disputeToken: string; status: string } | { error: string },
  ): Promise<DisputeRecord | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();
    const { rows } =
      'error' in outcome
        ? await pool.query<Row>(`UPDATE ${TABLE} SET lithic_error = $2 WHERE token = $1 RETURNING *`, [
            token,
            outcome.error.slice(0, 500),
          ])
        : await pool.query<Row>(
            `UPDATE ${TABLE}
                SET lithic_dispute_token = $2, lithic_status = $3, lithic_error = NULL, status = 'with_network'
              WHERE token = $1 RETURNING *`,
            [token, outcome.disputeToken, outcome.status],
          );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async listFor(wallet: string): Promise<DisputeRecord[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `SELECT * FROM ${TABLE} WHERE wallet = $1 ORDER BY created_at DESC LIMIT 50`,
      [wallet.trim().toLowerCase()],
    );
    return rows.map(toRecord);
  },

  /** Subjects this member already has a live dispute on — one dispute per payment at a time. */
  async openSubjects(wallet: string): Promise<Set<string>> {
    const pool = getPayPool();
    if (!pool) return new Set();
    await ensureTable();
    const { rows } = await pool.query<{ subject_ref: string }>(
      `SELECT subject_ref FROM ${TABLE} WHERE wallet = $1 AND status IN ('open', 'with_network')`,
      [wallet.trim().toLowerCase()],
    );
    return new Set(rows.map((r) => r.subject_ref));
  },

  async get(token: string): Promise<DisputeRecord | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(`SELECT * FROM ${TABLE} WHERE token = $1`, [token]);
    return rows[0] ? toRecord(rows[0]) : null;
  },

  /** The live dispute on a payment, if there is one. */
  async openFor(subjectRef: string): Promise<DisputeRecord | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `SELECT * FROM ${TABLE} WHERE subject_ref = $1 AND status IN ('open', 'with_network') ORDER BY created_at DESC LIMIT 1`,
      [subjectRef],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async setHold(token: string, state: 'held' | 'not_held' | 'releasing' | 'released', detail: Record<string, unknown> | null): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    await ensureTable();
    await pool.query(`UPDATE ${TABLE} SET hold_state = $2, held_detail = COALESCE($3::jsonb, held_detail) WHERE token = $1`, [
      token,
      state,
      detail ? JSON.stringify(detail) : null,
    ]);
  },

  /**
   * Close a live dispute. Only from a live state, and only once: two decisions racing -- a person
   * and the card network, say -- must not both unwind the hold.
   */
  async resolve(
    token: string,
    resolution: 'member' | 'merchant' | 'withdrawn',
    note: string | null,
  ): Promise<DisputeRecord | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `UPDATE ${TABLE}
          SET status = $2, resolution = $3, resolution_note = $4, resolved_at = now(), decided_at = now()
        WHERE token = $1 AND status IN ('open', 'with_network')
        RETURNING *`,
      [token, resolution === 'withdrawn' ? 'withdrawn' : 'decided', resolution, note],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  },

  /** Card disputes Lithic is deciding, for the sweep to ask about. */
  async openAtNetwork(): Promise<DisputeRecord[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureTable();
    const { rows } = await pool.query<Row>(
      `SELECT * FROM ${TABLE} WHERE status = 'with_network' AND lithic_dispute_token IS NOT NULL ORDER BY created_at LIMIT 50`,
    );
    return rows.map(toRecord);
  },
};
