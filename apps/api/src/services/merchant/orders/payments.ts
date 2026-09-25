import { createHash, randomUUID } from 'node:crypto';
import { canVoidOrder, CreateCashTender, CreateClearTender, type Order, type Role, type Tender, type TenderEvent, tenderTransition } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { cancelCardTender, type TenderRow, toTender } from '../cards/cardTenders.js';
import type { CardConnectorProvider } from '../cards/connector.js';
import { DrawerError, lockOpenDrawer } from '../drawer/drawerService.js';
import { checkNewTender, PaymentError, type TenderOrderRow as OrderRow } from './tenderRules.js';
import { getOrder, type PinCheck } from './orderService.js';
import { settleOrder } from './settle.js';
import { audit } from '../security/audit.js';

/**
 * Cash and Clear tenders, splitting, and voiding an order (card-processing prompt, Phase 6). Card
 * tenders are in cards/cardTenders.ts; all three meet here in what an order still owes.
 *
 *   cash    handed over, change given, into the open drawer. Approved there and then.
 *   Clear   a Clear charge through the existing protocol flow; the member approves on their phone.
 *           Under the pay-over-time minimum it's pay-now only (enforced where the member approves).
 *   split   several tenders against what's left, if the shop allows it; a tender that fails
 *           leaves the others paid.
 *   void    same day, before any card is captured: cards cancelled, cash back out of the drawer,
 *           Clear charges not yet answered withdrawn, stock released. A manager's or owner's PIN.
 */

export { PaymentError };

/** The Clear charge flow, as tenders need it. The real one is `raiseChargeFromDevice` and `chargeStore`. */
export interface ClearCharges {
  raise(input: { merchant: string; amountCents: number; raisedBy: string }): Promise<{ ok: true; code: string } | { ok: false; reason: string }>;
  /** The charge as it stands: pending (or being approved), approved, declined, expired or cancelled. */
  status(code: string): Promise<'pending' | 'approved' | 'declined' | 'expired' | 'cancelled' | 'other' | null>;
  /** Withdraws a charge nobody has answered. False if it was answered first. */
  cancel(code: string, merchant: string): Promise<boolean>;
}

const hash = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

async function replay(tx: Queryable, merchant: string, key: string, requestHash: string): Promise<TenderRow | null> {
  const { rows } = await tx.query<TenderRow>('SELECT * FROM payments.tenders WHERE merchant = $1 AND idempotency_key = $2', [merchant, key]);
  if (!rows[0]) return null;
  if (rows[0].request_hash !== requestHash) throw new PaymentError('That retry key was used for a different payment', 'key_reused');
  return rows[0];
}

/** Cash handed over: approved there and then, into the open drawer. The change is the server's sum. */
export async function createCashTender(db: Db, input: { merchant: string; orderId: string; staffId: string; tender: unknown }): Promise<Tender> {
  const parsed = CreateCashTender.safeParse(input.tender);
  if (!parsed.success) throw new PaymentError(parsed.error.issues[0]?.message ?? 'That cash payment isn’t valid', 'invalid');
  const t = parsed.data;
  const requestHash = hash([input.orderId, 'cash', t.amountCents, t.tipCents, t.handedOverCents]);
  const change = t.handedOverCents - t.amountCents - t.tipCents;
  const row = await db.transaction(async (tx) => {
    const again = await replay(tx, input.merchant, t.idempotencyKey, requestHash);
    if (again) return again;
    if (change < 0) throw new PaymentError(`That’s ${-change} cents short`, 'short');
    const order = await checkNewTender(tx, { merchant: input.merchant, orderId: input.orderId, method: 'cash', amountCents: t.amountCents });
    const drawer = await lockOpenDrawer(tx, input.merchant).catch((error) => {
      if (error instanceof DrawerError) throw new PaymentError(error.message, 'drawer_closed');
      throw error;
    });
    const { rows } = await tx.query<TenderRow>(
      `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, tip_cents, status, idempotency_key, request_hash, tip_staff_id, created_by,
          drawer_session_id, handed_over_cents, change_cents)
       VALUES ($1,$2,$3,'cash',$4,$5,'approved',$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [`tnd_${randomUUID()}`, input.merchant, order.id, t.amountCents, t.tipCents, t.idempotencyKey, requestHash, order.raised_by, input.staffId, drawer.id, t.handedOverCents, change],
    );
    await audit(tx, {
      merchant: input.merchant,
      actor: input.staffId,
      action: 'tender.cash_taken',
      ref: { type: 'tender', id: rows[0]!.id },
      amountCents: t.amountCents + t.tipCents,
      detail: { orderId: order.id, tipCents: t.tipCents, handedOverCents: t.handedOverCents, changeCents: change, drawerSessionId: drawer.id },
    });
    await settleOrder(tx, { merchant: input.merchant, orderId: order.id, actor: input.staffId });
    return rows[0]!;
  });
  return toTender(row);
}

/**
 * Raises a Clear charge for part or all of what's owed; the member approves (or declines) on their
 * phone and the tender follows. The charge carries the tip: Clear takes it like the rest.
 */
export async function createClearTender(db: Db, clear: ClearCharges, input: { merchant: string; orderId: string; staffId: string; tender: unknown }): Promise<Tender> {
  const parsed = CreateClearTender.safeParse(input.tender);
  if (!parsed.success) throw new PaymentError(parsed.error.issues[0]?.message ?? 'That Clear payment isn’t valid', 'invalid');
  const t = parsed.data;
  const requestHash = hash([input.orderId, 'clear', t.amountCents, t.tipCents]);
  const pending = await db.transaction(async (tx) => {
    const again = await replay(tx, input.merchant, t.idempotencyKey, requestHash);
    if (again) return again;
    const order = await checkNewTender(tx, { merchant: input.merchant, orderId: input.orderId, method: 'clear', amountCents: t.amountCents });
    const { rows } = await tx.query<TenderRow>(
      `INSERT INTO payments.tenders (id, merchant, order_id, method, amount_cents, tip_cents, status, idempotency_key, request_hash, tip_staff_id, created_by)
       VALUES ($1,$2,$3,'clear',$4,$5,'pending',$6,$7,$8,$9) RETURNING *`,
      [`tnd_${randomUUID()}`, input.merchant, order.id, t.amountCents, t.tipCents, t.idempotencyKey, requestHash, order.raised_by, input.staffId],
    );
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'tender.clear_started', ref: { type: 'tender', id: rows[0]!.id }, amountCents: t.amountCents + t.tipCents, detail: { orderId: order.id, tipCents: t.tipCents } });
    await settleOrder(tx, { merchant: input.merchant, orderId: order.id, actor: input.staffId });
    return rows[0]!;
  });
  if (pending.clear_charge_code || pending.status !== 'pending') return toTender(pending);

  // The charge is raised outside the transaction (it reads the chain). If raising fails, the tender
  // is withdrawn so the order doesn't keep a payment that never started.
  const raised = await clear.raise({ merchant: input.merchant, amountCents: t.amountCents + t.tipCents, raisedBy: input.staffId });
  if (!raised.ok) {
    // Withdrawn and committed first, then refused: throwing inside the transaction would roll the
    // withdrawal back and leave the order owing on a payment that never started.
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE payments.tenders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'pending'`, [pending.id]);
      await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'tender.clear_refused', ref: { type: 'tender', id: pending.id }, amountCents: t.amountCents + t.tipCents, detail: { reason: raised.reason } });
      await settleOrder(tx, { merchant: input.merchant, orderId: pending.order_id, actor: input.staffId });
    });
    throw new PaymentError(`Clear couldn’t take this one: ${raised.reason}`, 'clear_refused');
  }
  const out = await db.transaction(async (tx) => {
    const { rows } = await tx.query<TenderRow>('UPDATE payments.tenders SET clear_charge_code = $2, updated_at = now() WHERE id = $1 RETURNING *', [pending.id, raised.code]);
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'tender.clear_raised', ref: { type: 'tender', id: pending.id }, amountCents: t.amountCents + t.tipCents, detail: { chargeCode: raised.code } });
    return rows;
  });
  return toTender(out[0]!);
}

/**
 * Catches a Clear tender up with its charge: approved, declined, expired or withdrawn. Called by
 * the app while it waits, by the charge store's "resolved" event, and by the sweep, whichever is
 * first; the others find nothing to do.
 */
export async function syncClearTender(db: Db, clear: ClearCharges, input: { merchant: string; tenderId: string; actor: string | null }): Promise<Tender> {
  const { rows } = await db.query<TenderRow>(`SELECT * FROM payments.tenders WHERE id = $1 AND merchant = $2 AND method = 'clear'`, [input.tenderId, input.merchant]);
  const t = rows[0];
  if (!t) throw new PaymentError('No such Clear payment', 'not_found');
  if (t.status !== 'pending' || !t.clear_charge_code) return toTender(t);
  const status = await clear.status(t.clear_charge_code);
  const event: TenderEvent | null =
    status === 'approved' ? { type: 'approve' } : status === 'declined' ? { type: 'decline' } : status === 'expired' || status === 'cancelled' ? { type: 'cancel' } : null;
  if (!event) return toTender(t);
  const out = await db.transaction(async (tx) => {
    const { rows: locked } = await tx.query<TenderRow>('SELECT * FROM payments.tenders WHERE id = $1 FOR UPDATE', [t.id]);
    const row = locked[0]!;
    const next = tenderTransition({ method: 'clear', status: row.status, amountCents: Number(row.amount_cents), tipCents: Number(row.tip_cents), refundedCents: 0 }, event);
    if (!next.ok) return row;
    const { rows: updated } = await tx.query<TenderRow>('UPDATE payments.tenders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [row.id, next.state.status]);
    await audit(tx, { merchant: input.merchant, actor: input.actor, action: `tender.clear_${next.state.status}`, ref: { type: 'tender', id: row.id }, amountCents: Number(row.amount_cents) + Number(row.tip_cents), detail: { chargeStatus: status } });
    await settleOrder(tx, { merchant: input.merchant, orderId: row.order_id, actor: input.actor });
    return updated[0]!;
  });
  return toTender(out);
}

/** Withdraws a Clear charge nobody has answered yet. If the member got there first, the tender follows their answer instead. */
export async function cancelClearTender(db: Db, clear: ClearCharges, input: { merchant: string; tenderId: string; actor: string }): Promise<Tender> {
  const { rows } = await db.query<TenderRow>(`SELECT * FROM payments.tenders WHERE id = $1 AND merchant = $2 AND method = 'clear'`, [input.tenderId, input.merchant]);
  const t = rows[0];
  if (!t) throw new PaymentError('No such Clear payment', 'not_found');
  if (t.status !== 'pending') {
    if (t.status === 'cancelled') return toTender(t);
    throw new PaymentError(t.status === 'approved' ? 'They approved it already: a Clear refund goes through the Clear refund flow' : `A ${t.status} Clear payment can’t be withdrawn`, 'not_voidable');
  }
  if (t.clear_charge_code) await clear.cancel(t.clear_charge_code, input.merchant);
  const synced = await syncClearTender(db, clear, { merchant: input.merchant, tenderId: t.id, actor: input.actor });
  if (synced.status !== 'pending' || t.clear_charge_code) return synced;
  // Never raised (it failed on the way): withdraw the tender itself.
  return db.transaction(async (tx) => {
    const { rows: out } = await tx.query<TenderRow>(`UPDATE payments.tenders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING *`, [t.id]);
    if (out[0]) await audit(tx, { merchant: input.merchant, actor: input.actor, action: 'tender.clear_withdrawn', ref: { type: 'tender', id: t.id }, amountCents: Number(t.amount_cents) + Number(t.tip_cents) });
    await settleOrder(tx, { merchant: input.merchant, orderId: t.order_id, actor: input.actor });
    return toTender(out[0] ?? t);
  });
}

/**
 * Discards an order no money has touched: the customer walked away before paying, or every payment
 * on it was declined or withdrawn. Its held stock goes back on the shelf. No PIN: nothing was paid,
 * so there's nothing to undo but the hold; anything that took money is voided or refunded instead.
 */
export async function discardOrder(db: Db, input: { merchant: string; orderId: string; staffId: string }): Promise<Order> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<OrderRow>('SELECT id, status, voided_at, total_cents, business_date, raised_by FROM commerce.orders WHERE id = $1 AND merchant = $2 FOR UPDATE', [
      input.orderId,
      input.merchant,
    ]);
    const order = rows[0];
    if (!order) throw new PaymentError('No such order', 'not_found');
    if (order.voided_at) return;
    const { rows: tenders } = await tx.query<TenderRow>('SELECT * FROM payments.tenders WHERE order_id = $1 FOR UPDATE', [order.id]);
    if (tenders.some((t) => t.status !== 'declined' && t.status !== 'cancelled')) {
      throw new PaymentError('A payment has started on it, so it’s voided (with a manager’s PIN) or refunded instead', 'not_voidable');
    }
    await tx.query(`UPDATE commerce.orders SET status = 'voided', voided_at = now(), voided_by = $2, updated_at = now() WHERE id = $1`, [order.id, input.staffId]);
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'order.discarded', ref: { type: 'order', id: order.id }, amountCents: Number(order.total_cents) });
    await settleOrder(tx, { merchant: input.merchant, orderId: order.id, actor: input.staffId });
  });
  return getOrder(db, input.merchant, input.orderId);
}

/**
 * Voids an order: a same-day undo before any card is captured, approved with a manager's or owner's
 * PIN. Card holds are released, pending Clear charges withdrawn, cash goes back out of the drawer,
 * and stock is released. An approved Clear payment or a captured card can only be refunded.
 */
export async function voidOrder(
  db: Db,
  deps: { card: CardConnectorProvider | null; clear: ClearCharges; pinCheck: PinCheck },
  input: { merchant: string; orderId: string; staffId: string; pin: string; today: string },
): Promise<Order> {
  const approver = await deps.pinCheck(input.merchant, input.pin);
  if (!approver || (approver.role as Role) === 'counter') throw new PaymentError('Voiding needs a manager’s or owner’s PIN', 'approver_invalid');

  const { rows } = await db.query<OrderRow>('SELECT id, status, voided_at, total_cents, business_date, raised_by FROM commerce.orders WHERE id = $1 AND merchant = $2', [
    input.orderId,
    input.merchant,
  ]);
  const order = rows[0];
  if (!order) throw new PaymentError('No such order', 'not_found');
  if (order.voided_at) return getOrder(db, input.merchant, order.id);
  const day = typeof order.business_date === 'string' ? order.business_date.slice(0, 10) : order.business_date.toISOString().slice(0, 10);
  if (day !== input.today) throw new PaymentError('Only today’s orders are voided; an earlier one is refunded', 'not_same_day');
  const { rows: tenders } = await db.query<TenderRow>('SELECT * FROM payments.tenders WHERE order_id = $1', [order.id]);
  const verdict = canVoidOrder(
    { totalCents: Number(order.total_cents), voided: false },
    tenders.map((t) => ({ method: t.method, status: t.status, amountCents: Number(t.amount_cents), tipCents: Number(t.tip_cents), refundedCents: Number(t.refunded_cents) })),
  );
  if (!verdict.ok) throw new PaymentError(verdict.reason, 'not_voidable');

  // The processors first, outside the transaction: card holds released, Clear charges withdrawn.
  for (const t of tenders) {
    if (t.method === 'card' && (t.status === 'pending' || t.status === 'authorised')) {
      if (!deps.card) throw new PaymentError('Card processing isn’t reachable to release the card; try again', 'not_voidable');
      await cancelCardTender(db, deps.card, { merchant: input.merchant, tenderId: t.id, actor: approver.id, canVoidAuthorised: true });
    }
    if (t.method === 'clear' && t.status === 'pending') {
      const withdrawn = await cancelClearTender(db, deps.clear, { merchant: input.merchant, tenderId: t.id, actor: approver.id });
      if (withdrawn.status === 'approved') throw new PaymentError('They approved the Clear charge just now: it goes through the Clear refund flow', 'not_voidable');
    }
  }

  await db.transaction(async (tx) => {
    const { rows: locked } = await tx.query<OrderRow>('SELECT id, status, voided_at FROM commerce.orders WHERE id = $1 FOR UPDATE', [order.id]);
    if (locked[0]!.voided_at) return;
    const { rows: now } = await tx.query<TenderRow>('SELECT * FROM payments.tenders WHERE order_id = $1 FOR UPDATE', [order.id]);
    for (const t of now) {
      if (t.method === 'cash' && t.status === 'approved') {
        // Handed back from the drawer. The order is voided, so its sale (if booked) is reversed by
        // settle, and with it the cash the sale put in the drawer.
        const next = tenderTransition(
          { method: 'cash', status: 'approved', amountCents: Number(t.amount_cents), tipCents: Number(t.tip_cents), refundedCents: 0 },
          { type: 'refund', cents: Number(t.amount_cents) + Number(t.tip_cents) },
        );
        if (next.ok) await tx.query('UPDATE payments.tenders SET status = $2, refunded_cents = $3, updated_at = now() WHERE id = $1', [t.id, next.state.status, next.state.refundedCents]);
      }
    }
    const still = now.filter((t) => ['pending', 'authorised'].includes(t.status));
    if (still.length) throw new PaymentError('A payment on it is still going through; try again in a moment', 'not_voidable');
    await tx.query(`UPDATE commerce.orders SET status = 'voided', voided_at = now(), voided_by = $2, updated_at = now() WHERE id = $1`, [order.id, approver.id]);
    await audit(tx, {
      merchant: input.merchant,
      actor: input.staffId,
      approver: approver.id,
      action: 'order.voided',
      ref: { type: 'order', id: order.id },
      amountCents: Number(order.total_cents),
      detail: { tenders: now.map((t) => ({ id: t.id, method: t.method, status: t.status })) },
    });
    await settleOrder(tx, { merchant: input.merchant, orderId: order.id, actor: approver.id });
  });
  return getOrder(db, input.merchant, order.id);
}
