import { randomUUID } from 'node:crypto';
import type { Db, Queryable } from '../../../db/db.js';
import type { BalanceItem, CardConnectorProvider } from '../cards/connector.js';
import { entriesFor } from '../ledger/ledgerService.js';

/**
 * The nightly reconciliation (card-processing prompt, Phase 8): our books against the processor's,
 * per shop, over the last few days. What disagrees is flagged for a person; nothing is changed.
 *
 *   charge_without_tender   money the processor took that no tender of ours accounts for
 *   tender_without_charge   a tender we captured that the processor has no charge for
 *   amount_mismatch         a charge for a different amount than its tender
 *   fee_mismatch            Clear's fee on a charge isn't the fee the tender set
 *   payout_unbooked         a paid payout with no ledger entry
 *   payout_mismatch         a booked payout whose amount isn't what the processor paid
 *   payout_breakdown        a payout whose items don't add up to it (or can't be broken down)
 *
 * A flag stays open while each run still finds it, and closes itself when one doesn't.
 */

export interface Flag {
  kind: string;
  ref: string;
  expectedCents: number | null;
  actualCents: number | null;
  detail: string;
}

interface TenderRow {
  id: string;
  payment_intent_id: string;
  amount_cents: string | number;
  tip_cents: string | number;
  application_fee_cents: string | number | null;
}

/** Compares one shop's charges, captured tenders and payouts since `since`. */
export async function findMismatches(q: Queryable, provider: CardConnectorProvider, input: { merchant: string; account: string; since: Date }): Promise<Flag[]> {
  const flags: Flag[] = [];
  const items: BalanceItem[] = await provider.balanceItems(input.account, input.since);
  const charges = items.filter((i) => i.type === 'charge' || i.type === 'payment');

  const { rows: tenders } = await q.query<TenderRow>(
    `SELECT id, payment_intent_id, amount_cents, tip_cents, application_fee_cents FROM payments.tenders
      WHERE merchant = $1 AND method = 'card' AND payment_intent_id IS NOT NULL AND status IN ('captured','partly_refunded','refunded')
        AND COALESCE(captured_at, updated_at) >= $2`,
    [input.merchant, input.since.toISOString()],
  );
  const byPayment = new Map(tenders.map((t) => [t.payment_intent_id, t]));

  for (const c of charges) {
    const t = c.paymentId ? byPayment.get(c.paymentId) : undefined;
    if (!t) {
      // A charge for a tender captured before the window is fine; one with no tender at all isn't.
      const { rows } = c.paymentId ? await q.query('SELECT 1 FROM payments.tenders WHERE merchant = $1 AND payment_intent_id = $2', [input.merchant, c.paymentId]) : { rows: [] };
      if (!rows[0]) flags.push({ kind: 'charge_without_tender', ref: c.id, expectedCents: null, actualCents: c.amountCents, detail: `The processor took ${c.amountCents} cents (${c.paymentId ?? 'no payment id'}) that no tender accounts for` });
      continue;
    }
    byPayment.delete(c.paymentId!);
    const expected = Number(t.amount_cents) + Number(t.tip_cents);
    if (c.amountCents !== expected) flags.push({ kind: 'amount_mismatch', ref: t.id, expectedCents: expected, actualCents: c.amountCents, detail: `Tender ${t.id} is ${expected} cents; its charge is ${c.amountCents}` });
    const fee = t.application_fee_cents === null ? 0 : Number(t.application_fee_cents);
    if (c.platformFeeCents !== fee) flags.push({ kind: 'fee_mismatch', ref: t.id, expectedCents: fee, actualCents: c.platformFeeCents, detail: `Clear's fee on tender ${t.id} should be ${fee} cents; the processor took ${c.platformFeeCents}` });
  }
  for (const t of byPayment.values()) {
    flags.push({ kind: 'tender_without_charge', ref: t.id, expectedCents: Number(t.amount_cents) + Number(t.tip_cents), actualCents: null, detail: `Tender ${t.id} was captured but the processor shows no charge for it` });
  }

  const { rows: payouts } = await q.query<{ id: string; status: string; amount_cents: string | number; breakdown_ok: boolean }>(
    `SELECT id, status, amount_cents, breakdown_ok FROM payments.card_payouts WHERE merchant = $1 AND synced_at >= $2`,
    [input.merchant, input.since.toISOString()],
  );
  for (const p of payouts) {
    if (!p.breakdown_ok) {
      flags.push({ kind: 'payout_breakdown', ref: p.id, expectedCents: Number(p.amount_cents), actualCents: null, detail: `Payout ${p.id}'s items don't add up to it, or it can't be broken down (manual or instant)` });
      continue;
    }
    if (p.status !== 'paid') continue;
    const entry = (await entriesFor(q, input.merchant, { type: 'payout', id: p.id })).find((e) => e.kind === 'card_payout');
    if (!entry) {
      flags.push({ kind: 'payout_unbooked', ref: p.id, expectedCents: Number(p.amount_cents), actualCents: null, detail: `Payout ${p.id} was paid but isn't in the books` });
      continue;
    }
    const banked = entry.lines.filter((l) => l.account === 'bank').reduce((s, l) => s + l.debitCents - l.creditCents, 0);
    if (banked !== Number(p.amount_cents)) flags.push({ kind: 'payout_mismatch', ref: p.id, expectedCents: Number(p.amount_cents), actualCents: banked, detail: `Payout ${p.id} paid ${p.amount_cents} cents; the books show ${banked}` });
  }
  return flags;
}

/** Records a shop's findings: new flags opened, ones still found touched, ones no longer found closed. */
export async function recordFlags(db: Db, merchant: string, flags: Flag[]): Promise<{ opened: number; resolved: number }> {
  return db.transaction(async (tx) => {
    let opened = 0;
    for (const f of flags) {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE payments.reconciliation_flags SET last_seen_at = now(), expected_cents = $4, actual_cents = $5, detail = $6
          WHERE merchant = $1 AND kind = $2 AND ref = $3 AND resolved_at IS NULL RETURNING id`,
        [merchant, f.kind, f.ref, f.expectedCents, f.actualCents, f.detail],
      );
      if (!rows[0]) {
        await tx.query(
          `INSERT INTO payments.reconciliation_flags (id, merchant, kind, ref, expected_cents, actual_cents, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [`flag_${randomUUID()}`, merchant, f.kind, f.ref, f.expectedCents, f.actualCents, f.detail],
        );
        opened += 1;
      }
    }
    const keys = flags.map((f) => `${f.kind}|${f.ref}`);
    const { rows: closed } = await tx.query<{ id: string }>(
      `UPDATE payments.reconciliation_flags SET resolved_at = now() WHERE merchant = $1 AND resolved_at IS NULL AND NOT (kind || '|' || ref = ANY($2::text[])) RETURNING id`,
      [merchant, keys],
    );
    return { opened, resolved: closed.length };
  });
}

/** The nightly run: every shop taking cards, one at a time; one failing doesn't stop the rest. */
export async function reconcileAll(db: Db, provider: CardConnectorProvider, opts: { since: Date; merchant?: string }) {
  const { rows } = await db.query<{ merchant: string; external_account_id: string }>(
    `SELECT merchant, external_account_id FROM merchant.card_connectors WHERE provider = $1 AND disconnected_at IS NULL AND charges_enabled AND ($2::text IS NULL OR merchant = $2)`,
    [provider.provider, opts.merchant ?? null],
  );
  const out: Array<{ merchant: string; flags: number; opened: number; resolved: number } | { merchant: string; error: string }> = [];
  for (const c of rows) {
    try {
      const flags = await findMismatches(db, provider, { merchant: c.merchant, account: c.external_account_id, since: opts.since });
      const r = await recordFlags(db, c.merchant, flags);
      out.push({ merchant: c.merchant, flags: flags.length, ...r });
    } catch (error) {
      out.push({ merchant: c.merchant, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}

export async function openFlags(q: Queryable, merchant: string) {
  const { rows } = await q.query<{ id: string; kind: string; ref: string; expected_cents: string | number | null; actual_cents: string | number | null; detail: string; found_at: Date | string }>(
    'SELECT * FROM payments.reconciliation_flags WHERE merchant = $1 AND resolved_at IS NULL ORDER BY found_at DESC',
    [merchant],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    ref: r.ref,
    expectedCents: r.expected_cents === null ? null : Number(r.expected_cents),
    actualCents: r.actual_cents === null ? null : Number(r.actual_cents),
    detail: r.detail,
    foundAt: new Date(r.found_at).toISOString(),
  }));
}
