import type { TaxKind } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import type { OutboxHandler } from '../outbox/outbox.js';
import { CalculationUnusable, type TaxApi } from './taxApi.js';

/**
 * Recording tax at Stripe (card-processing prompt, Phase 6: "The tax is recorded as a Stripe tax
 * transaction after payment"). Only for sales taxed by the shop's own Stripe Tax; sales taxed at the
 * address rate are in Clear's books alone. Driven by the outbox, so Stripe being slow or down delays
 * the record and never the sale.
 *
 *   order.paid         the calculation becomes a transaction (a new calculation if it can't be used,
 *                      e.g. the order was paid, voided and paid again)
 *   order.unpaid       the recorded sale is reversed in full
 *   refund.succeeded   a partial reversal for the goods and tax given back (tips carry no tax)
 *
 * References are unique per fact, and each Stripe call carries the outbox event's key as its
 * idempotency key, so a retried event can't record twice.
 */

interface OrderTaxRow {
  id: string;
  merchant: string;
  tax_source: string;
  tax_calculation_id: string | null;
  tax_transaction_id: string | null;
  tax_included: boolean;
}

async function shopAccount(tx: Queryable, merchant: string): Promise<string | null> {
  const { rows } = await tx.query<{ external_account_id: string }>(
    `SELECT external_account_id FROM merchant.card_connectors WHERE merchant = $1 ORDER BY (disconnected_at IS NULL) DESC, created_at DESC LIMIT 1`,
    [merchant],
  );
  return rows[0]?.external_account_id ?? null;
}

async function orderTax(tx: Queryable, orderId: string): Promise<OrderTaxRow | null> {
  const { rows } = await tx.query<OrderTaxRow>('SELECT id, merchant, tax_source, tax_calculation_id, tax_transaction_id, tax_included FROM commerce.orders WHERE id = $1 FOR UPDATE', [orderId]);
  return rows[0] ?? null;
}

/** "order.paid:ord_1:0" → "ord_1", "order.paid:ord_1:2" → "ord_1-2": unique per time the order was paid. */
const referenceFor = (dedupe: string, orderId: string, suffix = '') => {
  const attempt = dedupe.split(':').pop();
  return `${orderId}${suffix}${attempt && attempt !== '0' ? `-${attempt}` : ''}`;
};

async function recalculate(tx: Queryable, api: TaxApi, account: string, order: OrderTaxRow): Promise<string> {
  const { rows: shop } = await tx.query<{ address_line1: string; address_city: string; address_region: string; address_postal_code: string; address_country: string }>(
    'SELECT address_line1, address_city, address_region, address_postal_code, address_country FROM merchant.profiles WHERE merchant = $1',
    [order.merchant],
  );
  const s = shop[0]!;
  const { rows: lines } = await tx.query<{ line_cents: string | number; discount_cents: string | number; tax_kind: TaxKind }>(
    'SELECT line_cents, discount_cents, tax_kind FROM commerce.order_lines WHERE order_id = $1 AND removed_at IS NULL ORDER BY position, id',
    [order.id],
  );
  const calc = await api.calculate(account, {
    address: { line1: s.address_line1, city: s.address_city, region: s.address_region, postalCode: s.address_postal_code, country: s.address_country },
    inclusive: order.tax_included,
    lines: lines.map((l, i) => ({ reference: `L${i + 1}`, amountCents: Number(l.line_cents) - Number(l.discount_cents), taxKind: l.tax_kind })),
  });
  return calc.calculationId;
}

export function taxRecordHandlers(api: () => TaxApi | null): Record<string, OutboxHandler> {
  const need = () => {
    const a = api();
    if (!a) throw new Error('Stripe Tax isn’t configured here; will retry');
    return a;
  };
  return {
    'order.paid': async (tx, e) => {
      const order = await orderTax(tx, String(e.payload.orderId));
      if (!order || order.tax_source !== 'stripe' || order.tax_transaction_id || !order.tax_calculation_id) return;
      const a = need();
      const account = await shopAccount(tx, order.merchant);
      if (!account) return;
      const reference = referenceFor(e.dedupe_key, order.id);
      let recorded: { transactionId: string };
      try {
        recorded = await a.record(account, { calculationId: order.tax_calculation_id, reference, idempotencyKey: e.dedupe_key });
      } catch (error) {
        if (!(error instanceof CalculationUnusable)) throw error;
        const fresh = await recalculate(tx, a, account, order);
        recorded = await a.record(account, { calculationId: fresh, reference, idempotencyKey: `${e.dedupe_key}:recalculated` });
      }
      await tx.query('UPDATE commerce.orders SET tax_transaction_id = $2 WHERE id = $1', [order.id, recorded.transactionId]);
    },

    'order.unpaid': async (tx, e) => {
      const order = await orderTax(tx, String(e.payload.orderId));
      if (!order?.tax_transaction_id) return;
      const account = await shopAccount(tx, order.merchant);
      if (!account) return;
      const a = need();
      // Stripe won't fully reverse a sale while partial reversals of it stand (checked in test mode):
      // undo the refunds' reversals first, then the sale.
      const { rows: partials } = await tx.query<{ id: string; tax_transaction_id: string }>(
        `SELECT f.id, f.tax_transaction_id FROM payments.refunds f JOIN payments.tenders t ON t.id = f.tender_id
          WHERE t.order_id = $1 AND f.tax_transaction_id IS NOT NULL ORDER BY f.created_at FOR UPDATE OF f`,
        [order.id],
      );
      for (const p of partials) {
        await a.reverse(account, { transactionId: p.tax_transaction_id, reference: referenceFor(e.dedupe_key, order.id, `-void-${p.id}`), idempotencyKey: `${e.dedupe_key}:${p.id}` });
        await tx.query('UPDATE payments.refunds SET tax_transaction_id = NULL WHERE id = $1', [p.id]);
      }
      await a.reverse(account, { transactionId: order.tax_transaction_id, reference: referenceFor(e.dedupe_key, order.id, '-void'), idempotencyKey: e.dedupe_key });
      await tx.query('UPDATE commerce.orders SET tax_transaction_id = NULL WHERE id = $1', [order.id]);
    },

    'refund.succeeded': async (tx, e) => {
      const { rows } = await tx.query<{ id: string; amount_cents: string | number; tax_transaction_id: string | null; order_id: string; tender_amount: string | number; tender_refunded: string | number }>(
        `SELECT f.id, f.amount_cents, f.tax_transaction_id, t.order_id, t.amount_cents AS tender_amount, t.refunded_cents AS tender_refunded
           FROM payments.refunds f JOIN payments.tenders t ON t.id = f.tender_id WHERE f.id = $1 FOR UPDATE OF f`,
        [String(e.payload.refundId)],
      );
      const r = rows[0];
      if (!r || r.tax_transaction_id) return;
      const order = await orderTax(tx, r.order_id);
      if (!order?.tax_transaction_id) return;
      const account = await shopAccount(tx, order.merchant);
      if (!account) return;
      // The goods and tax given back; any tip in the refund carries no tax.
      const amount = Number(r.amount_cents);
      const before = Number(r.tender_refunded) - amount;
      const goodsAndTax = Math.min(amount, Number(r.tender_amount) - Math.min(Math.max(before, 0), Number(r.tender_amount)));
      if (goodsAndTax <= 0) return;
      const reversed = await need().reverse(account, { transactionId: order.tax_transaction_id, reference: `${order.id}-refund-${r.id}`, flatAmountCents: goodsAndTax, idempotencyKey: e.dedupe_key });
      await tx.query('UPDATE payments.refunds SET tax_transaction_id = $2 WHERE id = $1', [r.id, reversed.transactionId]);
    },
  };
}
