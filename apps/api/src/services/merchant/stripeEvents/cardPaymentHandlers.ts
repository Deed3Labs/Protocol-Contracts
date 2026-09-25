import type Stripe from 'stripe';
import { applyPaymentSnapshot, applyRefundSnapshot } from '../cards/cardTenders.js';
import type { CardConnectorProvider } from '../cards/connector.js';
import { refundSnapshot } from '../cards/stripeConnector.js';
import { syncPayout } from '../payouts/payoutSync.js';
import type { Handlers } from './inbox.js';

/**
 * Card payment events from shops' Stripe accounts (card-processing prompt, Phase 4). Every state
 * change goes through the same code as the app's own sync, and posts to the ledger through it.
 *
 * A payment event is a nudge, not the truth: the handler asks Stripe for the PaymentIntent as it
 * stands now and applies that. Events arrive out of order, and "authorised" arriving after
 * "captured" must not move anything backwards; the tender state machine refuses it anyway.
 */
const PAYMENT_EVENTS = [
  'payment_intent.amount_capturable_updated',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
] as const;

export function cardPaymentHandlers(provider: () => CardConnectorProvider | null): Handlers {
  const catchUp = async (tx: Parameters<NonNullable<Handlers[string]>>[0], event: Stripe.Event, paymentId: string | null) => {
    if (!paymentId) return;
    const pi = { id: paymentId };
    const { rows } = await tx.query<{ id: string; merchant: string }>('SELECT id, merchant FROM payments.tenders WHERE payment_intent_id = $1', [pi.id]);
    // Not one of ours: a payment the shop took some other way on its own account.
    if (!rows[0] || !event.account) return;
    const p = provider();
    if (!p) throw new Error('Card processing is not configured here; will retry');
    const snapshot = await p.getPayment(event.account, pi.id);
    const r = await applyPaymentSnapshot(tx, { merchant: rows[0].merchant, tenderId: rows[0].id, snapshot, actor: null });
    // A declined attempt is voided so it can't be confirmed later; the counter starts a new tender.
    if (r.declined) await p.cancel(event.account, pi.id).catch(() => undefined);
  };
  const onPayment: Handlers[string] = (tx, event) => catchUp(tx, event, (event.data.object as Stripe.PaymentIntent).id);
  /**
   * A smart reader finished (or failed) a payment it was sent. Often the first news, and the
   * failure codes (declined, customer cancelled, connection error) all come down to one question
   * answered the same way: where does the PaymentIntent stand now.
   */
  const onReader: Handlers[string] = (tx, event) => {
    const reader = event.data.object as Stripe.Terminal.Reader;
    const target = reader.action?.type === 'process_payment_intent' ? reader.action.process_payment_intent?.payment_intent : null;
    return catchUp(tx, event, typeof target === 'string' ? target : (target?.id ?? null));
  };

  const onRefund: Handlers[string] = async (tx, event) => {
    const refund = event.data.object as Stripe.Refund;
    const { rows } = await tx.query<{ id: string; merchant: string }>('SELECT id, merchant FROM payments.refunds WHERE external_refund_id = $1', [refund.id]);
    if (!rows[0]) return;
    await applyRefundSnapshot(tx, { merchant: rows[0].merchant, refundId: rows[0].id, snapshot: refundSnapshot(refund), actor: null });
  };

  return {
    ...Object.fromEntries(PAYMENT_EVENTS.map((type) => [type, onPayment])),
    'terminal.reader.action_succeeded': onReader,
    'terminal.reader.action_failed': onReader,
    'refund.updated': onRefund,
    'refund.failed': onRefund,
    'charge.refund.updated': onRefund,

    ...Object.fromEntries(
      ['payout.created', 'payout.updated', 'payout.paid', 'payout.failed', 'payout.canceled'].map((type) => [
        type,
        /**
         * A shop's payout moved. Synced from the processor (not the event body), in the event's own
         * transaction: the payout, its ledger entry and "event done" commit together.
         */
        (async (tx, event) => {
          const payout = event.data.object as Stripe.Payout;
          if (!event.account) return;
          const { rows } = await tx.query<{ id: string; merchant: string }>(
            'SELECT id, merchant FROM merchant.card_connectors WHERE external_account_id = $1 ORDER BY (disconnected_at IS NULL) DESC LIMIT 1',
            [event.account],
          );
          if (!rows[0]) return;
          const p = provider();
          if (!p) throw new Error('Card processing is not configured here; will retry');
          await syncPayout(tx, p, { merchant: rows[0].merchant, connectorId: rows[0].id, account: event.account, payoutId: payout.id });
        }) as NonNullable<Handlers[string]>,
      ]),
    ),

    /**
     * A customer disputed a card payment. Recorded for the owner (the outbox carries it to
     * notifications); the money side lands with the payout sync (Phase 8), from Stripe's figures.
     */
    'charge.dispute.created': async (tx, event) => {
      const dispute = event.data.object as Stripe.Dispute;
      const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : (dispute.payment_intent?.id ?? null);
      if (!pi) return;
      const { rows } = await tx.query<{ id: string; merchant: string; order_id: string }>('SELECT id, merchant, order_id FROM payments.tenders WHERE payment_intent_id = $1', [pi]);
      if (!rows[0]) return;
      await tx.query(
        `INSERT INTO payments.outbox (merchant, topic, dedupe_key, payload) VALUES ($1, 'card.dispute_opened', $2, $3)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [rows[0].merchant, `dispute:${dispute.id}`, JSON.stringify({ disputeId: dispute.id, tenderId: rows[0].id, orderId: rows[0].order_id, amountCents: dispute.amount, reason: dispute.reason })],
      );
    },
  };
}
