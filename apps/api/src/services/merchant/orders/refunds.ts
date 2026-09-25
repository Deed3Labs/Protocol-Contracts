import { createHash, randomUUID } from 'node:crypto';
import { type Refund, RequestRefund, type Role, tenderTransition } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { type RefundRow, refundCardTender, type TenderRow } from '../cards/cardTenders.js';
import type { CardConnectorProvider } from '../cards/connector.js';
import { DrawerError, lockOpenDrawer } from '../drawer/drawerService.js';
import { post } from '../ledger/ledgerService.js';
import * as postings from '../ledger/postings.js';
import type { PinCheck } from './orderService.js';
import { announceRefund, itemsOf, refundSplit, restock } from './refundBooks.js';
import { settleOrder } from './settle.js';
import { audit } from '../security/audit.js';

/**
 * Card and cash refunds (card-processing prompt, Phase 6; the Charges reference). Two steps, as with
 * Clear refunds: anyone on shift asks, a manager or owner approves (in their own session, or with
 * their PIN at the counter), and only then does money move: back to the card through the processor,
 * or out of the open drawer. A manager or owner asking approves their own request.
 *
 * A Clear payment is refunded through the existing Clear refund flow: unwinding a member's plan is
 * the protocol's (the seam), so it's refused here with that pointer.
 */

export class RefundError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'invalid'
      | 'not_refundable'
      | 'over_amount'
      | 'items_invalid'
      | 'key_reused'
      | 'clear_flow'
      | 'approver_invalid'
      | 'wrong_state'
      | 'drawer_closed',
  ) {
    super(message);
    this.name = 'RefundError';
  }
}

export interface RefundDeps {
  card: CardConnectorProvider | null;
  pinCheck: PinCheck;
}

export function toRefund(r: RefundRow): Refund {
  return {
    id: r.id,
    tenderId: r.tender_id,
    amountCents: Number(r.amount_cents),
    items: itemsOf(r.items),
    reason: r.reason,
    requestedBy: r.requested_by,
    approvedBy: r.approved_by,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const isManager = (role: Role) => role === 'manager' || role === 'owner';

async function lockRefund(tx: Queryable, merchant: string, refundId: string): Promise<RefundRow> {
  const { rows } = await tx.query<RefundRow>('SELECT * FROM payments.refunds WHERE id = $1 AND merchant = $2 FOR UPDATE', [refundId, merchant]);
  if (!rows[0]) throw new RefundError('No such refund', 'not_found');
  return rows[0];
}

/**
 * Asks for a refund of part or all of a tender, optionally naming the lines coming back. Checked
 * against what the tender took less what's been refunded or is waiting to be, and against how many
 * of each line have come back already.
 */
export async function requestRefund(db: Db, deps: RefundDeps, input: { merchant: string; staff: { id: string; role: Role }; request: unknown }): Promise<Refund> {
  const parsed = RequestRefund.safeParse(input.request);
  if (!parsed.success) throw new RefundError(parsed.error.issues[0]?.message ?? 'That refund isn’t valid', 'invalid');
  const r = parsed.data;
  const requestHash = createHash('sha256').update(JSON.stringify([r.tenderId, r.amountCents, r.items])).digest('hex');

  const row = await db.transaction(async (tx) => {
    const { rows: existing } = await tx.query<RefundRow>('SELECT * FROM payments.refunds WHERE merchant = $1 AND idempotency_key = $2', [input.merchant, r.idempotencyKey]);
    if (existing[0]) {
      if (existing[0].request_hash !== requestHash) throw new RefundError('That retry key was used for a different refund', 'key_reused');
      return existing[0];
    }
    const { rows: tenders } = await tx.query<TenderRow>('SELECT * FROM payments.tenders WHERE id = $1 AND merchant = $2 FOR UPDATE', [r.tenderId, input.merchant]);
    const t = tenders[0];
    if (!t) throw new RefundError('No such payment', 'not_found');
    if (t.method === 'clear') throw new RefundError('A Clear payment is refunded through the Clear refund flow', 'clear_flow');
    const refundable = t.method === 'card' ? ['captured', 'partly_refunded'] : ['approved', 'partly_refunded'];
    if (!refundable.includes(t.status)) {
      throw new RefundError(t.status === 'authorised' ? 'A card not yet captured is voided, not refunded' : `A ${t.status} payment can’t be refunded`, 'not_refundable');
    }
    const { rows: waiting } = await tx.query<{ cents: string | number }>(
      `SELECT COALESCE(sum(amount_cents), 0) AS cents FROM payments.refunds WHERE tender_id = $1 AND status IN ('requested','approved')`,
      [t.id],
    );
    const left = Number(t.amount_cents) + Number(t.tip_cents) - Number(t.refunded_cents) - Number(waiting[0]!.cents);
    if (r.amountCents > left) throw new RefundError(`Only ${left} cents can still be refunded on this payment`, 'over_amount');

    if (r.items.length) {
      const { rows: lines } = await tx.query<{ id: string; quantity: number; returned: string | number }>(
        `SELECT l.id, l.quantity,
                COALESCE((SELECT sum((i->>'quantity')::int) FROM payments.refunds f, jsonb_array_elements(f.items) i
                           WHERE f.tender_id IN (SELECT id FROM payments.tenders WHERE order_id = l.order_id)
                             AND f.status IN ('requested','approved','succeeded') AND i->>'orderLineId' = l.id), 0) AS returned
           FROM commerce.order_lines l WHERE l.order_id = $1 AND l.removed_at IS NULL`,
        [t.order_id],
      );
      for (const i of r.items) {
        const line = lines.find((l) => l.id === i.orderLineId);
        if (!line) throw new RefundError('A line named isn’t on this order', 'items_invalid');
        if (i.quantity > line.quantity - Number(line.returned)) throw new RefundError(`Only ${line.quantity - Number(line.returned)} of that line can still come back`, 'items_invalid');
      }
    }

    const { rows: out } = await tx.query<RefundRow>(
      `INSERT INTO payments.refunds (id, merchant, tender_id, amount_cents, items, reason, status, idempotency_key, request_hash, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,'requested',$7,$8,$9) RETURNING *`,
      [`rfd_${randomUUID()}`, input.merchant, t.id, r.amountCents, JSON.stringify(r.items), r.reason, r.idempotencyKey, requestHash, input.staff.id],
    );
    await audit(tx, {
      merchant: input.merchant,
      actor: input.staff.id,
      action: 'refund.requested',
      ref: { type: 'refund', id: out[0]!.id },
      amountCents: r.amountCents,
      detail: { tenderId: t.id, method: t.method, items: r.items, reason: r.reason },
    });
    return out[0]!;
  });

  // A manager or owner asking is also the one who'd approve it.
  if (row.status === 'requested' && isManager(input.staff.role)) {
    return decideRefund(db, deps, { merchant: input.merchant, refundId: row.id, decision: 'approve', pin: null, staff: input.staff });
  }
  return toRefund(row);
}

/**
 * Approve or decline. A manager or owner in their own session decides as themselves; counter staff
 * need a manager's or owner's PIN, and it can't be the requester's own. Approving sends the money
 * back at once.
 */
export async function decideRefund(
  db: Db,
  deps: RefundDeps,
  input: { merchant: string; refundId: string; decision: 'approve' | 'decline'; pin: string | null; staff: { id: string; role: Role } },
): Promise<Refund> {
  let approver: { id: string; role: Role };
  if (isManager(input.staff.role)) approver = input.staff;
  else {
    const p = input.pin ? await deps.pinCheck(input.merchant, input.pin) : null;
    if (!p || !isManager(p.role)) throw new RefundError('A refund is approved by a manager or owner, or with their PIN', 'approver_invalid');
    approver = p;
  }

  const decided = await db.transaction(async (tx) => {
    const r = await lockRefund(tx, input.merchant, input.refundId);
    if (r.status !== 'requested') return r;
    if (r.requested_by === approver.id && !isManager(input.staff.role)) {
      throw new RefundError('Someone other than whoever asked approves it', 'approver_invalid');
    }
    const status = input.decision === 'approve' ? 'approved' : 'declined';
    const { rows } = await tx.query<RefundRow>('UPDATE payments.refunds SET status = $2, approved_by = $3, decided_at = now(), updated_at = now() WHERE id = $1 RETURNING *', [
      r.id,
      status,
      approver.id,
    ]);
    // Who decided, and whether they did it in their own session or by PIN at someone else's.
    await audit(tx, {
      merchant: input.merchant,
      actor: input.staff.id,
      approver: approver.id,
      action: `refund.${status}`,
      ref: { type: 'refund', id: r.id },
      amountCents: Number(r.amount_cents),
      detail: { byPin: approver.id !== input.staff.id },
    });
    return rows[0]!;
  });
  if (decided.status !== 'approved') return toRefund(decided);
  return executeRefund(db, deps, { merchant: input.merchant, refundId: decided.id, actor: approver.id });
}

/** Sends an approved refund: to the card through the processor, or out of the open drawer. Safe to repeat. */
export async function executeRefund(db: Db, deps: RefundDeps, input: { merchant: string; refundId: string; actor: string | null }): Promise<Refund> {
  const { rows } = await db.query<RefundRow & { method: 'card' | 'cash' | 'clear' }>(
    'SELECT f.*, t.method FROM payments.refunds f JOIN payments.tenders t ON t.id = f.tender_id WHERE f.id = $1 AND f.merchant = $2',
    [input.refundId, input.merchant],
  );
  const r = rows[0];
  if (!r) throw new RefundError('No such refund', 'not_found');
  if (r.method === 'card') {
    if (!deps.card) throw new RefundError('Card processing isn’t set up here', 'not_refundable');
    const out = await refundCardTender(db, deps.card, { merchant: input.merchant, refundId: r.id, actor: input.actor });
    return toRefund(out);
  }
  const out = await cashRefund(db, { merchant: input.merchant, refundId: r.id, actor: input.actor });
  return toRefund(out);
}

/** Cash back out of the open drawer: the tender, the books and the shelf, in one transaction. */
async function cashRefund(db: Db, input: { merchant: string; refundId: string; actor: string | null }): Promise<RefundRow> {
  return db.transaction(async (tx) => {
    const r = await lockRefund(tx, input.merchant, input.refundId);
    if (r.status === 'succeeded') return r;
    if (r.status !== 'approved') throw new RefundError('A refund goes out once it’s approved', 'wrong_state');
    const drawer = await lockOpenDrawer(tx, input.merchant).catch((error) => {
      if (error instanceof DrawerError) throw new RefundError('Open the drawer to give cash back', 'drawer_closed');
      throw error;
    });
    const { rows: tenders } = await tx.query<TenderRow>('SELECT * FROM payments.tenders WHERE id = $1 FOR UPDATE', [r.tender_id]);
    const t = tenders[0]!;
    const amount = Number(r.amount_cents);
    const next = tenderTransition(
      { method: 'cash', status: t.status, amountCents: Number(t.amount_cents), tipCents: Number(t.tip_cents), refundedCents: Number(t.refunded_cents) },
      { type: 'refund', cents: amount },
    );
    if (!next.ok) throw new RefundError(next.reason, 'not_refundable');
    const items = itemsOf(r.items);
    const split = await refundSplit(tx, { orderId: t.order_id, amountCents: amount, tenderAmountCents: Number(t.amount_cents), alreadyRefundedCents: Number(t.refunded_cents), items });
    await tx.query('UPDATE payments.tenders SET status = $2, refunded_cents = $3, updated_at = now() WHERE id = $1', [t.id, next.state.status, next.state.refundedCents]);
    await post(
      tx,
      postings.refund({
        merchant: input.merchant,
        refundId: r.id,
        method: 'cash',
        amountCents: amount,
        taxCents: split.taxCents,
        tip: split.tipCents > 0 ? { staffId: t.tip_staff_id ?? t.created_by, cents: split.tipCents } : null,
        createdBy: input.actor,
      }),
    );
    await restock(tx, { merchant: input.merchant, refundId: r.id, items, actor: input.actor });
    await announceRefund(tx, { merchant: input.merchant, refundId: r.id, orderId: t.order_id });
    const { rows } = await tx.query<RefundRow>(`UPDATE payments.refunds SET status = 'succeeded', drawer_session_id = $2, updated_at = now() WHERE id = $1 RETURNING *`, [r.id, drawer.id]);
    await audit(tx, { merchant: input.merchant, actor: input.actor, action: 'refund.cash_given', ref: { type: 'refund', id: r.id }, amountCents: amount, detail: { tenderId: t.id, drawerSessionId: drawer.id } });
    await settleOrder(tx, { merchant: input.merchant, orderId: t.order_id, actor: input.actor });
    return rows[0]!;
  });
}
