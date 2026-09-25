import { createHash, randomUUID } from 'node:crypto';
import { type CardPlan, type CardTenderStart, clearCardFee, type Tender, type TenderEvent, tenderTransition } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { entriesFor, post } from '../ledger/ledgerService.js';
import * as postings from '../ledger/postings.js';
import { settleOrder } from '../orders/settle.js';
import { checkNewTender, PaymentError } from '../orders/tenderRules.js';
import { announceRefund, itemsOf, refundSplit, restock } from '../orders/refundBooks.js';
import { CardDeclined, type CardConnectorProvider, type PaymentSnapshot, ReaderUnavailable, type RefundSnapshot } from './connector.js';
import { takingCards } from './terminal.js';

/**
 * Card tenders (card-processing prompt, Phase 4). The server creates, captures, voids and refunds;
 * the app collects the card on the reader with the SDK in between. Card data never reaches us.
 *
 *   create     a tender row, then a PaymentIntent on the shop's own account for amount + tip, manual
 *              capture, Clear's fee as the application fee. The app gets the client secret.
 *   authorise  learnt from the processor: the app's sync after the tap, or the webhook, whichever
 *              lands first. The order settles, and once it's paid the sale is booked.
 *   tip        changed only while authorised. Raising it raises the hold on the card there and then,
 *              so the counter hears at once if the card won't take it.
 *   capture    at Close the day, or by the safety job well inside the processor's 2-day window. Clear's
 *              fee is recomputed on the final amount.
 *   void       cancels the hold. Free. Reverses the sale if the order had been paid.
 *   refund     after capture, against an approved refund row.
 *
 * Every state change goes through the contract's tenderTransition under a row lock, so a webhook
 * and the app's sync racing each other land once: the second finds nothing left to do.
 *
 * SEAM (offline): a payment stored on an M2 while offline is created by the device, not here, and
 * reaches Stripe when the device is back online. Recording it means matching the PaymentIntent's
 * metadata (set by the app) to an order when its webhook arrives. That waits for the app's offline
 * plugin (OFFLINE_BUILT is false in apps/merchant/src/reader/platform.ts).
 */

export class TenderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'order_closed'
      | 'over_remaining'
      | 'reader_unknown'
      | 'key_reused'
      | 'wrong_state'
      | 'needs_manager'
      | 'tip_not_raisable'
      | 'tip_declined'
      | 'changed'
      | 'stale'
      | 'not_smart_reader'
      | 'reader_busy'
      | 'reader_offline'
      | 'reader_timeout'
      | 'method_off',
  ) {
    super(message);
    this.name = 'TenderError';
  }
}

export interface TenderRow {
  id: string;
  merchant: string;
  order_id: string;
  method: Tender['method'];
  amount_cents: string | number;
  tip_cents: string | number;
  status: Tender['status'];
  refunded_cents: string | number;
  idempotency_key: string;
  request_hash: string;
  tip_staff_id: string | null;
  created_by: string;
  created_at: Date | string;
  connector_id: string | null;
  payment_intent_id: string | null;
  reader_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
  application_fee_cents: string | number | null;
  fee_billed: boolean;
  clear_fee_billed_cents: string | number;
  authorised_at: Date | string | null;
  captured_at: Date | string | null;
  clear_charge_code: string | null;
  handed_over_cents: string | number | null;
  change_cents: string | number | null;
}

const n = (v: string | number | null) => (v === null ? null : Number(v));
const iso = (v: Date | string) => new Date(v).toISOString();

export function toTender(r: TenderRow): Tender {
  return {
    id: r.id,
    orderId: r.order_id,
    method: r.method,
    amountCents: Number(r.amount_cents),
    tipCents: Number(r.tip_cents),
    status: r.status,
    refundedCents: Number(r.refunded_cents),
    cardBrand: r.card_brand,
    cardLast4: r.card_last4,
    readerId: r.reader_id,
    clearChargeCode: r.clear_charge_code,
    handedOverCents: n(r.handed_over_cents),
    changeCents: n(r.change_cents),
    createdAt: iso(r.created_at),
  };
}

async function lockTender(tx: Queryable, merchant: string, tenderId: string): Promise<TenderRow> {
  const { rows } = await tx.query<TenderRow>('SELECT * FROM payments.tenders WHERE id = $1 AND merchant = $2 FOR UPDATE', [tenderId, merchant]);
  if (!rows[0]) throw new TenderError('No such payment', 'not_found');
  return rows[0];
}

/**
 * A card tender with the processor account it was taken on. Refused when `provider` isn't the
 * processor that took it: a shop that moved processors still voids and refunds its old payments
 * through the old one, never by sending the old payment's id to the new one.
 */
async function cardTender(q: Queryable, provider: CardConnectorProvider, merchant: string, tenderId: string): Promise<TenderRow & { account: string }> {
  const { rows } = await q.query<TenderRow & { account: string; connector_provider: string }>(
    `SELECT t.*, c.external_account_id AS account, c.provider AS connector_provider FROM payments.tenders t
       JOIN merchant.card_connectors c ON c.id = t.connector_id
      WHERE t.id = $1 AND t.merchant = $2 AND t.method = 'card'`,
    [tenderId, merchant],
  );
  if (!rows[0]) throw new TenderError('No such card payment', 'not_found');
  if (rows[0].connector_provider !== provider.provider) throw new TenderError(`This card payment was taken through ${rows[0].connector_provider}, which isn’t available here`, 'wrong_state');
  return rows[0];
}

/**
 * What the processor is asked to take for Clear on `cents`: Clear's fee, or nothing when the
 * processor can't take a platform fee. Then the fee is accrued at capture and billed monthly
 * (fees/feeBilling.ts).
 */
const processorFee = (provider: CardConnectorProvider, cents: number, plan: CardPlan) => (provider.supportsPlatformFee ? clearCardFee(cents, plan) : 0);

async function cardPlan(q: Queryable, merchant: string): Promise<{ plan: CardPlan; refundApplicationFee: boolean }> {
  const { rows } = await q.query<{ card_plan: 'payg' | 'paid'; card_plan_fee_cents: number | null; refund_application_fee: boolean }>(
    'SELECT card_plan, card_plan_fee_cents, refund_application_fee FROM merchant.profiles WHERE merchant = $1',
    [merchant],
  );
  const r = rows[0];
  if (!r) throw new TenderError('No such shop', 'not_found');
  return {
    plan: r.card_plan === 'paid' ? { kind: 'paid', feeCents: Number(r.card_plan_fee_cents) } : { kind: 'payg' },
    refundApplicationFee: r.refund_application_fee,
  };
}

async function offlineLimit(q: Queryable, merchant: string): Promise<number | null> {
  const { rows } = await q.query<{ offline_cards_enabled: boolean; offline_cards_limit_cents: string | number }>(
    'SELECT offline_cards_enabled, offline_cards_limit_cents FROM merchant.shop_settings WHERE merchant = $1',
    [merchant],
  );
  const s = rows[0];
  return s?.offline_cards_enabled ? Number(s.offline_cards_limit_cents) : null;
}

/** A tender older than this can't be resumed: the processor keeps idempotent replies for a day. */
const RESUME_WINDOW_MS = 20 * 60 * 60 * 1000;

/**
 * Starts a card payment for part or all of what an order still owes. Idempotent on the app's key:
 * the same key and request returns the same tender and PaymentIntent; the same key with a
 * different request is refused.
 */
export async function createCardTender(
  db: Db,
  provider: CardConnectorProvider,
  input: { merchant: string; orderId: string; staffId: string; amountCents: number; tipCents: number; readerId: string; idempotencyKey: string },
): Promise<CardTenderStart> {
  const requestHash = createHash('sha256')
    .update(JSON.stringify([input.orderId, input.amountCents, input.tipCents, input.readerId]))
    .digest('hex');

  const tender = await db.transaction(async (tx) => {
    const { rows: orders } = await tx.query<{ id: string; raised_by: string; status: string; voided_at: unknown; total_cents: string | number }>(
      'SELECT id, raised_by, status, voided_at, total_cents FROM commerce.orders WHERE id = $1 AND merchant = $2 FOR UPDATE',
      [input.orderId, input.merchant],
    );
    const order = orders[0];
    if (!order) throw new TenderError('No such order', 'not_found');

    const { rows: existing } = await tx.query<TenderRow>('SELECT * FROM payments.tenders WHERE merchant = $1 AND idempotency_key = $2', [
      input.merchant,
      input.idempotencyKey,
    ]);
    if (existing[0]) {
      if (existing[0].request_hash !== requestHash) throw new TenderError('That retry key was used for a different payment', 'key_reused');
      if (Date.now() - new Date(existing[0].created_at).getTime() > RESUME_WINDOW_MS) throw new TenderError('That payment is too old to resume; start a new one', 'stale');
      return existing[0];
    }

    // The same rules as every tender: taking payments, card on, splitting allowed, no more than owed.
    await checkNewTender(tx, { merchant: input.merchant, orderId: order.id, method: 'card', amountCents: input.amountCents }).catch((error) => {
      if (error instanceof PaymentError) {
        const code = error.code === 'method_off' ? 'method_off' : error.code === 'over_remaining' || error.code === 'split_off' ? 'over_remaining' : 'order_closed';
        throw new TenderError(error.message, code);
      }
      throw error;
    });
    const connector = await takingCards(tx, input.merchant);
    const { rows: readers } = await tx.query('SELECT 1 FROM merchant.readers WHERE id = $1 AND merchant = $2 AND removed_at IS NULL', [input.readerId, input.merchant]);
    if (!readers[0]) throw new TenderError('That reader isn’t one of this shop’s', 'reader_unknown');

    if (connector.provider !== provider.provider) throw new Error(`This shop takes cards through ${connector.provider}, not ${provider.provider}`);
    const { plan } = await cardPlan(tx, input.merchant);
    const fee = processorFee(provider, input.amountCents + input.tipCents, plan);
    const { rows } = await tx.query<TenderRow>(
      `INSERT INTO payments.tenders
         (id, merchant, order_id, method, amount_cents, tip_cents, status, idempotency_key, request_hash, tip_staff_id, created_by,
          connector_id, reader_id, application_fee_cents, fee_billed)
       VALUES ($1, $2, $3, 'card', $4, $5, 'pending', $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [`tnd_${randomUUID()}`, input.merchant, order.id, input.amountCents, input.tipCents, input.idempotencyKey, requestHash, order.raised_by, input.staffId, connector.id, input.readerId, fee, !provider.supportsPlatformFee],
    );
    await settleOrder(tx, { merchant: input.merchant, orderId: order.id, actor: input.staffId });
    return rows[0]!;
  });

  const withAccount = await cardTender(db, provider, input.merchant, tender.id);
  // Same key every time for this tender, so a retry after a timeout gets the same PaymentIntent back.
  const { snapshot, clientSecret } = await provider.createPayment(withAccount.account, {
    amountCents: Number(tender.amount_cents) + Number(tender.tip_cents),
    applicationFeeCents: Number(tender.application_fee_cents ?? 0),
    metadata: { clear_merchant: input.merchant, clear_order_id: tender.order_id, clear_tender_id: tender.id },
    idempotencyKey: `clear-tender:${tender.id}`,
  });
  await db.query('UPDATE payments.tenders SET payment_intent_id = $2, updated_at = now() WHERE id = $1 AND payment_intent_id IS NULL', [tender.id, snapshot.paymentId]);
  return { tenderId: tender.id, clientSecret, offlineLimitCents: await offlineLimit(db, input.merchant) };
}

/**
 * Moves a tender to match what the processor says, inside the caller's transaction. Returns the
 * tender after, and whether it was newly declined (the caller then voids the PaymentIntent so the
 * declined attempt can't be confirmed later).
 */
export async function applyPaymentSnapshot(
  tx: Queryable,
  input: { merchant: string; tenderId: string; snapshot: PaymentSnapshot; actor: string | null },
): Promise<{ tender: TenderRow; changed: boolean; declined: boolean }> {
  const row = await lockTender(tx, input.merchant, input.tenderId);
  if (row.payment_intent_id && row.payment_intent_id !== input.snapshot.paymentId) throw new Error(`Tender ${row.id} is not payment ${input.snapshot.paymentId}`);

  const s = input.snapshot;
  const events: TenderEvent[] =
    s.state === 'authorised'
      ? [{ type: 'authorise' }]
      : s.state === 'captured'
        ? [{ type: 'authorise' }, { type: 'capture' }]
        : s.state === 'cancelled'
          ? [{ type: 'cancel' }]
          : s.state === 'waiting' && s.declineCode
            ? [{ type: 'decline' }]
            : [];

  let state = { method: row.method, status: row.status, amountCents: Number(row.amount_cents), tipCents: Number(row.tip_cents), refundedCents: Number(row.refunded_cents) };
  for (const e of events) {
    const r = tenderTransition(state, e);
    // Refused means we're already past it (a late or repeated event): nothing to do.
    if (r.ok) state = r.state;
  }
  if (state.status === row.status) return { tender: row, changed: false, declined: false };

  const { rows } = await tx.query<TenderRow>(
    `UPDATE payments.tenders
        SET status = $2,
            payment_intent_id = COALESCE(payment_intent_id, $3),
            card_brand = COALESCE($4, card_brand),
            card_last4 = COALESCE($5, card_last4),
            authorised_at = CASE WHEN $2 IN ('authorised','captured') THEN COALESCE(authorised_at, now()) ELSE authorised_at END,
            captured_at = CASE WHEN $2 = 'captured' THEN COALESCE(captured_at, now()) ELSE captured_at END,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [row.id, state.status, s.paymentId, s.card?.brand ?? null, s.card?.last4 ?? null],
  );
  let tender = rows[0]!;
  if (tender.fee_billed && state.status === 'captured') tender = await accrueClearFee(tx, tender, input.actor);
  await settleOrder(tx, { merchant: input.merchant, orderId: row.order_id, actor: input.actor });
  return { tender, changed: true, declined: state.status === 'declined' };
}

/**
 * Clear's fee on a captured card whose processor couldn't take it: worked out on what was captured,
 * kept on the tender, and owed to Clear until the month's bill (fees/feeBilling.ts). However the
 * capture reached us, once: the posting is keyed on the tender.
 */
async function accrueClearFee(tx: Queryable, tender: TenderRow, actor: string | null): Promise<TenderRow> {
  const { plan } = await cardPlan(tx, tender.merchant);
  const fee = clearCardFee(Number(tender.amount_cents) + Number(tender.tip_cents), plan);
  const accrual = postings.clearFeeAccrued({ merchant: tender.merchant, tenderId: tender.id, feeCents: fee, createdBy: actor });
  if (accrual) await post(tx, accrual);
  const { rows } = await tx.query<TenderRow>('UPDATE payments.tenders SET clear_fee_billed_cents = $2 WHERE id = $1 RETURNING *', [tender.id, fee]);
  return rows[0]!;
}

/** Asks the processor where a card payment stands and catches the tender up. The app calls it after the tap. */
export async function syncCardTender(db: Db, provider: CardConnectorProvider, input: { merchant: string; tenderId: string; actor: string | null }): Promise<Tender> {
  const t = await cardTender(db, provider, input.merchant, input.tenderId);
  if (!t.payment_intent_id) return toTender(t);
  const snapshot = await provider.getPayment(t.account, t.payment_intent_id);
  const result = await db.transaction((tx) => applyPaymentSnapshot(tx, { merchant: input.merchant, tenderId: t.id, snapshot, actor: input.actor }));
  if (result.declined) await provider.cancel(t.account, t.payment_intent_id).catch(() => undefined);
  return toTender(result.tender);
}

/** A tender's reader, when it's a smart reader the server drives. */
async function smartReaderOf(q: Queryable, merchant: string, readerId: string | null): Promise<{ external_reader_id: string } | null> {
  if (!readerId) return null;
  const { rows } = await q.query<{ external_reader_id: string; type: string }>(
    'SELECT external_reader_id, type FROM merchant.readers WHERE id = $1 AND merchant = $2 AND removed_at IS NULL',
    [readerId, merchant],
  );
  return rows[0]?.type === 'smart' ? rows[0] : null;
}

function readerRefusal(error: unknown): never {
  if (error instanceof ReaderUnavailable) {
    throw new TenderError(error.message, error.reason === 'busy' ? 'reader_busy' : error.reason === 'offline' ? 'reader_offline' : 'reader_timeout');
  }
  throw error;
}

/**
 * Sends a card payment to the shop's smart reader (server-driven; Stripe's recommendation for smart
 * readers, and no need for the counter device and reader to share a network). The reader asks for
 * the card and authorises on its own; the outcome reaches the tender through the reader's webhook,
 * the payment's webhook or the app's sync, whichever is first.
 *
 * Presenting again is how the counter retries after the customer cancelled on the reader or the
 * reader timed out. A declined card ends its tender (declined, voided) and the counter starts
 * another, so a retry can't be confirmed onto the declined attempt.
 */
export async function presentCardTender(db: Db, provider: CardConnectorProvider, input: { merchant: string; tenderId: string }): Promise<Tender> {
  const t = await cardTender(db, provider, input.merchant, input.tenderId);
  if (t.status !== 'pending' || !t.payment_intent_id) throw new TenderError(`A ${t.status} card payment can’t be sent to the reader`, 'wrong_state');
  const reader = await smartReaderOf(db, input.merchant, t.reader_id);
  if (!reader) throw new TenderError('Only a smart reader takes a payment from here; the M2 and Tap to Pay take it on the device', 'not_smart_reader');
  await provider.presentOnReader(t.account, reader.external_reader_id, t.payment_intent_id).catch(readerRefusal);
  return toTender(t);
}

/**
 * Void: cancels a card payment before capture. Free, because nothing was taken. Voiding one the
 * card already authorised needs a manager or owner, the same as voiding an order.
 */
export async function cancelCardTender(
  db: Db,
  provider: CardConnectorProvider,
  input: { merchant: string; tenderId: string; actor: string; canVoidAuthorised: boolean },
): Promise<Tender> {
  const t = await cardTender(db, provider, input.merchant, input.tenderId);
  if (t.status === 'authorised' && !input.canVoidAuthorised) throw new TenderError('Voiding a paid card needs a manager or owner', 'needs_manager');
  if (!['pending', 'authorised'].includes(t.status)) {
    if (t.status === 'cancelled') return toTender(t);
    throw new TenderError(`A ${t.status} card payment can’t be voided`, 'wrong_state');
  }
  if (!t.payment_intent_id) {
    // Never reached the processor: nothing to cancel there.
    const r = await db.transaction(async (tx) => {
      const row = await lockTender(tx, input.merchant, t.id);
      const next = tenderTransition({ method: row.method, status: row.status, amountCents: 0, tipCents: 0, refundedCents: 0 }, { type: 'cancel' });
      if (!next.ok) return row;
      const { rows } = await tx.query<TenderRow>(`UPDATE payments.tenders SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`, [row.id]);
      await settleOrder(tx, { merchant: input.merchant, orderId: row.order_id, actor: input.actor });
      return rows[0]!;
    });
    return toTender(r);
  }
  // A smart reader still asking for this card is cleared first, so it stops showing the amount. It
  // refuses while a card is mid-authorisation, and then so does the void: wait for the outcome.
  if (t.status === 'pending') {
    const reader = await smartReaderOf(db, input.merchant, t.reader_id);
    if (reader) {
      await provider.clearReader(t.account, reader.external_reader_id).catch((error) => {
        if (error instanceof ReaderUnavailable && error.reason === 'busy') readerRefusal(error);
        // Offline or timed out: the reader will fail the payment when it can't confirm a cancelled one.
      });
    }
  }
  const snapshot = await provider.cancel(t.account, t.payment_intent_id);
  const r = await db.transaction((tx) => applyPaymentSnapshot(tx, { merchant: input.merchant, tenderId: t.id, snapshot, actor: input.actor }));
  return toTender(r.tender);
}

/**
 * Changes the tip on an authorised card, before capture. Lowering it just captures less later.
 * Raising it asks the card for the higher hold now; if the card can't be raised or refuses, the tip
 * stays as it was and the counter is told.
 */
export async function adjustCardTip(
  db: Db,
  provider: CardConnectorProvider,
  input: { merchant: string; tenderId: string; tipCents: number; actor: string },
): Promise<Tender> {
  if (!Number.isInteger(input.tipCents) || input.tipCents < 0) throw new TenderError('A tip is a whole number of cents', 'wrong_state');
  const t = await cardTender(db, provider, input.merchant, input.tenderId);
  if (t.status !== 'authorised' || !t.payment_intent_id) throw new TenderError('A tip changes only on an authorised card, before the day is closed', 'wrong_state');
  const oldTip = Number(t.tip_cents);
  if (input.tipCents === oldTip) return toTender(t);

  const amount = Number(t.amount_cents);
  const newTotal = amount + input.tipCents;
  if (input.tipCents > oldTip) {
    const { plan } = await cardPlan(db, input.merchant);
    const current = await provider.getPayment(t.account, t.payment_intent_id);
    if (newTotal > current.capturableCents) {
      if (!current.incrementalSupported) throw new TenderError('This card can’t have its tip raised. Take the extra another way.', 'tip_not_raisable');
      try {
        await provider.raiseAuthorisation(t.account, t.payment_intent_id, { amountCents: newTotal, applicationFeeCents: t.fee_billed ? 0 : clearCardFee(newTotal, plan) });
      } catch (error) {
        if (error instanceof CardDeclined) throw new TenderError('The card wouldn’t take the higher tip. The first tip stands.', 'tip_declined');
        throw error;
      }
    }
  }

  const r = await db.transaction(async (tx) => {
    const row = await lockTender(tx, input.merchant, t.id);
    // Something else moved it while the card was being asked (a capture, a void, another tip change).
    if (row.status !== 'authorised' || Number(row.tip_cents) !== oldTip) throw new TenderError('That payment changed while the tip was being updated. Look again.', 'changed');
    const next = tenderTransition(
      { method: row.method, status: row.status, amountCents: amount, tipCents: oldTip, refundedCents: Number(row.refunded_cents) },
      { type: 'adjust_tip', tipCents: input.tipCents },
    );
    if (!next.ok) throw new TenderError(next.reason, 'wrong_state');
    const { rows } = await tx.query<TenderRow>('UPDATE payments.tenders SET tip_cents = $2, updated_at = now() WHERE id = $1 RETURNING *', [row.id, input.tipCents]);

    // If the sale is already booked, book the difference; if not, the sale will use the new tip.
    const sale = (await entriesFor(tx, input.merchant, { type: 'order', id: row.order_id })).filter((e) => e.kind.endsWith('_sale'));
    const { rows: reversed } = await tx.query<{ reverses: string }>('SELECT reverses FROM ledger.journal_entries WHERE reverses = ANY($1::text[])', [sale.map((e) => e.id)]);
    const liveSale = sale.some((e) => !reversed.some((x) => x.reverses === e.id));
    if (liveSale) {
      const { rows: count } = await tx.query<{ n: string | number }>(
        `SELECT count(*) AS n FROM ledger.journal_entries WHERE merchant = $1 AND ref_type = 'tender' AND ref_id = $2 AND kind = 'card_tip_adjusted'`,
        [input.merchant, row.id],
      );
      const adjustment = postings.cardTipAdjusted({
        merchant: input.merchant,
        tenderId: row.id,
        adjustmentId: `${row.id}:${Number(count[0]!.n)}`,
        staffId: row.tip_staff_id ?? row.created_by,
        fromCents: oldTip,
        toCents: input.tipCents,
        createdBy: input.actor,
      });
      if (adjustment) await post(tx, adjustment);
    }
    await settleOrder(tx, { merchant: input.merchant, orderId: row.order_id, actor: input.actor });
    return rows[0]!;
  });
  return toTender(r);
}

/**
 * Takes an authorised card payment for its final amount, tip included, with Clear's fee on that
 * amount: taken by the processor, or (a processor without a platform fee) accrued as the tender is
 * marked captured, in applyPaymentSnapshot.
 */
export async function captureCardTender(db: Db, provider: CardConnectorProvider, input: { merchant: string; tenderId: string; actor: string | null }): Promise<Tender> {
  const t = await cardTender(db, provider, input.merchant, input.tenderId);
  if (t.status === 'captured') return toTender(t);
  if (t.status !== 'authorised' || !t.payment_intent_id) throw new TenderError(`A ${t.status} card payment can’t be captured`, 'wrong_state');
  const total = Number(t.amount_cents) + Number(t.tip_cents);
  const { plan } = await cardPlan(db, input.merchant);
  const fee = t.fee_billed ? 0 : clearCardFee(total, plan);
  const snapshot = await provider.capture(t.account, t.payment_intent_id, { amountCents: total, applicationFeeCents: fee, idempotencyKey: `clear-capture:${t.id}:${total}` });
  const r = await db.transaction(async (tx) => {
    await tx.query('UPDATE payments.tenders SET application_fee_cents = $2 WHERE id = $1', [t.id, fee]);
    return applyPaymentSnapshot(tx, { merchant: input.merchant, tenderId: t.id, snapshot, actor: input.actor });
  });
  return toTender(r.tender);
}

/**
 * Captures a shop's authorised cards (Close the day), or everybody's authorised before a moment
 * (the safety job). One failure doesn't stop the rest; each is reported.
 */
export async function captureDue(
  db: Db,
  provider: CardConnectorProvider,
  input: { merchant?: string; authorisedBefore?: Date; actor?: string | null },
): Promise<{ captured: string[]; failed: Array<{ tenderId: string; error: string }> }> {
  // Only this processor's cards: a shop that moved processors still has the old one's holds, and
  // they're captured through the connector that made them.
  const { rows } = await db.query<{ id: string; merchant: string }>(
    `SELECT t.id, t.merchant FROM payments.tenders t
       JOIN merchant.card_connectors c ON c.id = t.connector_id
      WHERE t.method = 'card' AND t.status = 'authorised' AND c.provider = $3
        AND ($1::text IS NULL OR t.merchant = $1)
        AND ($2::timestamptz IS NULL OR t.authorised_at < $2)
      ORDER BY t.authorised_at`,
    [input.merchant ?? null, input.authorisedBefore?.toISOString() ?? null, provider.provider],
  );
  const out = { captured: [] as string[], failed: [] as Array<{ tenderId: string; error: string }> };
  for (const r of rows) {
    try {
      await captureCardTender(db, provider, { merchant: r.merchant, tenderId: r.id, actor: input.actor ?? null });
      out.captured.push(r.id);
    } catch (error) {
      out.failed.push({ tenderId: r.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}

// ---- Refunds -----------------------------------------------------------------------------------

export interface RefundRow {
  id: string;
  merchant: string;
  tender_id: string;
  amount_cents: string | number;
  items: unknown;
  reason: string | null;
  created_at: Date | string;
  decided_at: Date | string | null;
  drawer_session_id: string | null;
  request_hash: string;
  status: 'requested' | 'approved' | 'declined' | 'succeeded' | 'failed';
  requested_by: string;
  approved_by: string | null;
  external_refund_id: string | null;
}

/**
 * What a processor refund result means for the refund row, the tender and the ledger, inside the
 * caller's transaction. Succeeded: the tender's refunded total rises (never past what was taken)
 * and the refund is booked. Failed: nothing moves. Pending: wait for the webhook.
 */
export async function applyRefundSnapshot(tx: Queryable, input: { merchant: string; refundId: string; snapshot: RefundSnapshot; actor: string | null }): Promise<RefundRow> {
  const { rows } = await tx.query<RefundRow>('SELECT * FROM payments.refunds WHERE id = $1 AND merchant = $2 FOR UPDATE', [input.refundId, input.merchant]);
  const refund = rows[0];
  if (!refund) throw new TenderError('No such refund', 'not_found');
  await tx.query('UPDATE payments.refunds SET external_refund_id = COALESCE(external_refund_id, $2), updated_at = now() WHERE id = $1', [refund.id, input.snapshot.refundId]);
  if (refund.status === 'succeeded' || refund.status === 'failed' || input.snapshot.state === 'pending') return refund;

  if (input.snapshot.state === 'failed') {
    const { rows: out } = await tx.query<RefundRow>(`UPDATE payments.refunds SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1 RETURNING *`, [refund.id, input.snapshot.failureReason]);
    return out[0]!;
  }

  const tender = await lockTender(tx, input.merchant, refund.tender_id);
  const amount = Number(refund.amount_cents);
  const next = tenderTransition(
    { method: tender.method, status: tender.status, amountCents: Number(tender.amount_cents), tipCents: Number(tender.tip_cents), refundedCents: Number(tender.refunded_cents) },
    { type: 'refund', cents: amount },
  );
  if (!next.ok) throw new Error(`Refund ${refund.id} can’t apply to tender ${tender.id}: ${next.reason}`);
  await tx.query('UPDATE payments.tenders SET status = $2, refunded_cents = $3, updated_at = now() WHERE id = $1', [tender.id, next.state.status, next.state.refundedCents]);

  // Tax from the lines that came back (or the order's share when none were named), and any tip.
  const items = itemsOf(refund.items);
  const split = await refundSplit(tx, {
    orderId: tender.order_id,
    amountCents: amount,
    tenderAmountCents: Number(tender.amount_cents),
    alreadyRefundedCents: Number(tender.refunded_cents),
    items,
  });
  await post(
    tx,
    postings.refund({
      merchant: input.merchant,
      refundId: refund.id,
      method: 'card',
      amountCents: amount,
      taxCents: split.taxCents,
      tip: split.tipCents > 0 ? { staffId: tender.tip_staff_id ?? tender.created_by, cents: split.tipCents } : null,
      createdBy: input.actor,
    }),
  );
  // A billed fee comes back the way a processor gives back its platform fee: in proportion, when the
  // shop's refund setting says so.
  const billed = Number(tender.clear_fee_billed_cents);
  if (billed > 0 && (await cardPlan(tx, input.merchant)).refundApplicationFee) {
    const total = Number(tender.amount_cents) + Number(tender.tip_cents);
    const returned = postings.clearFeeReturned({ merchant: input.merchant, refundId: refund.id, feeCents: Math.round((billed * amount) / total), createdBy: input.actor });
    if (returned) await post(tx, returned);
  }
  await restock(tx, { merchant: input.merchant, refundId: refund.id, items, actor: input.actor });
  await announceRefund(tx, { merchant: input.merchant, refundId: refund.id, orderId: tender.order_id });
  const { rows: out } = await tx.query<RefundRow>(`UPDATE payments.refunds SET status = 'succeeded', updated_at = now() WHERE id = $1 RETURNING *`, [refund.id]);
  await settleOrder(tx, { merchant: input.merchant, orderId: tender.order_id, actor: input.actor });
  return out[0]!;
}

/** Sends an approved card refund to the processor. Safe to repeat: the processor call is keyed on the refund. */
export async function refundCardTender(db: Db, provider: CardConnectorProvider, input: { merchant: string; refundId: string; actor: string | null }): Promise<RefundRow> {
  const { rows } = await db.query<RefundRow>('SELECT * FROM payments.refunds WHERE id = $1 AND merchant = $2', [input.refundId, input.merchant]);
  const refund = rows[0];
  if (!refund) throw new TenderError('No such refund', 'not_found');
  if (refund.status === 'succeeded' || refund.status === 'failed') return refund;
  if (refund.status !== 'approved') throw new TenderError('A refund goes to the card once it’s approved', 'wrong_state');
  const t = await cardTender(db, provider, input.merchant, refund.tender_id);
  if (!t.payment_intent_id || !['captured', 'partly_refunded'].includes(t.status)) {
    throw new TenderError(t.status === 'authorised' ? 'An uncaptured card is voided, not refunded' : `A ${t.status} card payment can’t be refunded`, 'wrong_state');
  }
  const { refundApplicationFee } = await cardPlan(db, input.merchant);
  const snapshot = await provider.refund(t.account, t.payment_intent_id, {
    amountCents: Number(refund.amount_cents),
    refundApplicationFee,
    idempotencyKey: `clear-refund:${refund.id}`,
    metadata: { clear_merchant: input.merchant, clear_refund_id: refund.id, clear_tender_id: t.id },
  });
  return db.transaction((tx) => applyRefundSnapshot(tx, { merchant: input.merchant, refundId: refund.id, snapshot, actor: input.actor }));
}
