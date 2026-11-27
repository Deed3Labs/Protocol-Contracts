import type { CardDeposit } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import type { BalanceItem, CardConnectorProvider } from '../cards/connector.js';
import { entriesFor, post, reverse } from '../ledger/ledgerService.js';
import * as postings from '../ledger/postings.js';

/**
 * Card deposits (card-processing prompt, Phase 8): the shop's processor payouts, each with what it
 * settled and what it cost, from the processor's own fee data (principle: never computed from our
 * fee rule). Kept current from `payout.*` webhooks and a nightly sweep.
 *
 * A payout is booked when it reaches the bank (`paid`): the receivable settled, the fees, anything
 * else, and the net in the bank. Only when its items add up to what the processor paid: a manual or
 * instant payout (which the processor can't break down) or one that doesn't add up is shown, not
 * booked, and the reconciliation flags it. A paid payout that later fails is reversed.
 */

export interface Breakdown {
  grossCents: number;
  processorFeeCents: number;
  clearFeeCents: number;
  otherCents: number;
  chargeCount: number;
  netCents: number;
}

const SETTLES = new Set(['charge', 'payment', 'refund', 'payment_refund']);

/** What a payout's items come to: charges less refunds, the two fees, and everything else (disputes, adjustments). */
export function breakdown(items: BalanceItem[]): Breakdown {
  const b: Breakdown = { grossCents: 0, processorFeeCents: 0, clearFeeCents: 0, otherCents: 0, chargeCount: 0, netCents: 0 };
  for (const i of items) {
    b.netCents += i.netCents;
    if (SETTLES.has(i.type)) {
      b.grossCents += i.amountCents;
      b.processorFeeCents += i.processorFeeCents;
      b.clearFeeCents += i.platformFeeCents;
      if (i.type === 'charge' || i.type === 'payment') b.chargeCount += 1;
    } else {
      // Whatever else moved the balance, net of its own fees (a dispute's $15 fee included).
      b.otherCents += i.netCents;
    }
  }
  return b;
}

/**
 * Brings one payout up to date: its row, and its ledger entry once it's paid. Safe to repeat.
 * Writes in the caller's transaction (the webhook's, or the sweep's).
 */
export async function syncPayout(tx: Queryable, provider: CardConnectorProvider, input: { merchant: string; connectorId: string; account: string; payoutId: string }): Promise<void> {
  const payout = await provider.getPayout(input.account, input.payoutId);
  const items = payout.automatic ? await provider.payoutItems(input.account, payout.id) : [];
  const b = breakdown(items);
  const ok = payout.automatic && items.length > 0 && b.netCents === payout.amountCents;

  {
    await tx.query(
      `INSERT INTO payments.card_payouts (id, merchant, connector_id, status, arrival_date, automatic, amount_cents, gross_cents, processor_fee_cents, clear_fee_cents, other_cents, charge_count, breakdown_ok, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, arrival_date = EXCLUDED.arrival_date, amount_cents = EXCLUDED.amount_cents,
         gross_cents = EXCLUDED.gross_cents, processor_fee_cents = EXCLUDED.processor_fee_cents, clear_fee_cents = EXCLUDED.clear_fee_cents,
         other_cents = EXCLUDED.other_cents, charge_count = EXCLUDED.charge_count, breakdown_ok = EXCLUDED.breakdown_ok, synced_at = now()`,
      [payout.id, input.merchant, input.connectorId, payout.status, payout.arrivalDate, payout.automatic, payout.amountCents, b.grossCents, b.processorFeeCents, b.clearFeeCents, b.otherCents, b.chargeCount, ok],
    );

    const booked = await liveEntry(tx, input.merchant, payout.id);
    if (payout.status === 'paid' && ok && !booked) {
      await post(
        tx,
        postings.cardPayout({
          merchant: input.merchant,
          payoutId: payout.id,
          grossCents: b.grossCents,
          processorFeeCents: b.processorFeeCents,
          clearFeeCents: b.clearFeeCents,
          otherCents: b.otherCents,
        }),
      );
    } else if ((payout.status === 'failed' || payout.status === 'canceled') && booked) {
      // The money never arrived after all: the deposit is undone, and the charges are owed again.
      await reverse(tx, { merchant: input.merchant, entryId: booked, memo: `Payout ${payout.status}` });
    }
  }
}

async function liveEntry(tx: Queryable, merchant: string, payoutId: string): Promise<string | null> {
  const entries = await entriesFor(tx, merchant, { type: 'payout', id: payoutId });
  const sale = entries.find((e) => e.kind === 'card_payout');
  if (!sale) return null;
  const { rows } = await tx.query('SELECT 1 FROM ledger.journal_entries WHERE reverses = $1', [sale.id]);
  return rows[0] ? null : sale.id;
}

/** Every recent payout for each shop that takes cards: the nightly sweep. One shop failing doesn't stop the rest. */
export async function syncRecentPayouts(db: Db, provider: CardConnectorProvider, opts: { since: Date; merchant?: string }): Promise<{ synced: number; failed: string[] }> {
  const { rows: connectors } = await db.query<{ id: string; merchant: string; external_account_id: string }>(
    `SELECT id, merchant, external_account_id FROM merchant.card_connectors WHERE provider = $1 AND disconnected_at IS NULL AND charges_enabled AND ($2::text IS NULL OR merchant = $2)`,
    [provider.provider, opts.merchant ?? null],
  );
  const out = { synced: 0, failed: [] as string[] };
  for (const c of connectors) {
    try {
      for (const p of await provider.listPayouts(c.external_account_id, opts.since)) {
        await db.transaction((tx) => syncPayout(tx, provider, { merchant: c.merchant, connectorId: c.id, account: c.external_account_id, payoutId: p.id }));
        out.synced += 1;
      }
    } catch (error) {
      out.failed.push(`${c.merchant}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}

/** The deposits screen: each payout with its card-processing figure split into the processor's fee and Clear's. */
export async function cardDeposits(q: Queryable, input: { merchant: string; from: string; to: string }): Promise<CardDeposit[]> {
  const { rows } = await q.query<{
    id: string;
    merchant: string;
    arrival_date: Date | string;
    gross_cents: string | number;
    processor_fee_cents: string | number;
    clear_fee_cents: string | number;
    amount_cents: string | number;
    charge_count: number;
    status: string;
  }>('SELECT * FROM payments.card_payouts WHERE merchant = $1 AND arrival_date BETWEEN $2 AND $3 ORDER BY arrival_date DESC, created_at DESC', [input.merchant, input.from, input.to]);
  return rows.map((r) => ({
    id: r.id,
    shop: r.merchant,
    externalPayoutId: r.id,
    arrivalDate: typeof r.arrival_date === 'string' ? r.arrival_date.slice(0, 10) : r.arrival_date.toISOString().slice(0, 10),
    grossCents: Number(r.gross_cents),
    processorFeeCents: Number(r.processor_fee_cents),
    clearFeeCents: Number(r.clear_fee_cents),
    netCents: Number(r.amount_cents),
    chargeCount: r.charge_count,
    status: r.status === 'canceled' ? 'failed' : (r.status as CardDeposit['status']),
  }));
}
