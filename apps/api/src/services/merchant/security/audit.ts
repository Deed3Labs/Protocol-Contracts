import type { Queryable } from '../../../db/db.js';

/**
 * The audit log (card-processing prompt, Phase 10): who did what to the money, and when. Written in
 * the same transaction as the action it records, so an action and its audit row stand or fall
 * together, and append-only (a trigger refuses changes).
 *
 * Two kinds of row:
 *   - every ledger booking, written by the ledger service itself (`booked.<kind>`), so nothing that
 *     moves the books can skip it
 *   - money actions that book nothing themselves: a card hold, capture or void at the processor, a
 *     refund asked for or decided, a PIN override, a drawer count, a sign-off, a close, a fee bill
 *     collected. The service that takes the action writes the row.
 *
 * Never a PIN, a card number or a secret in `detail`: it's read by owners.
 */

export interface AuditInput {
  merchant: string;
  /** The staff member who acted; null for the system (a job or a processor webhook). */
  actor: string | null;
  /** Whoever approved it with their PIN, when it needed one. */
  approver?: string | null;
  action: string;
  ref?: { type: string; id: string } | null;
  amountCents?: number | null;
  detail?: Record<string, unknown>;
}

export async function audit(tx: Queryable, input: AuditInput): Promise<void> {
  await tx.query(
    `INSERT INTO payments.audit_log (merchant, actor, approver, action, ref_type, ref_id, amount_cents, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.merchant, input.actor, input.approver ?? null, input.action, input.ref?.type ?? null, input.ref?.id ?? null, input.amountCents ?? null, JSON.stringify(input.detail ?? {})],
  );
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string | null;
  approver: string | null;
  action: string;
  ref: { type: string; id: string } | null;
  amountCents: number | null;
  detail: Record<string, unknown>;
}

/** A shop's audit trail over a range of days (UTC dates, inclusive), newest first. */
export async function auditTrail(q: Queryable, input: { merchant: string; from: string; to: string; limit?: number }): Promise<AuditEntry[]> {
  const { rows } = await q.query<{
    id: string | number;
    at: Date | string;
    actor: string | null;
    approver: string | null;
    action: string;
    ref_type: string | null;
    ref_id: string | null;
    amount_cents: string | number | null;
    detail: Record<string, unknown> | string;
  }>(
    `SELECT * FROM payments.audit_log WHERE merchant = $1 AND at >= $2::date AND at < ($3::date + 1)
      ORDER BY at DESC, id DESC LIMIT $4`,
    [input.merchant, input.from, input.to, Math.min(input.limit ?? 500, 2000)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    at: new Date(r.at).toISOString(),
    actor: r.actor,
    approver: r.approver,
    action: r.action,
    ref: r.ref_type && r.ref_id ? { type: r.ref_type, id: r.ref_id } : null,
    amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
    detail: typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail,
  }));
}
