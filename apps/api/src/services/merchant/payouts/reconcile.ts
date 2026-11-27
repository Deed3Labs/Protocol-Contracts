import { randomUUID } from 'node:crypto';
import { ExplainFlag, type Reconciliation, type ReconciliationFlag } from '@clear/merchant-contracts';
import { audit } from '../security/audit.js';
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
 *   fee_bill_unconfirmed    a monthly fee bill sent for collection an hour ago or more, and not
 *                           seen to land: a person checks the chain before anything is sent again
 *   card_stranded           a card authorised on an account the shop then disconnected: Clear
 *                           can't capture it, and the shop must, in the processor's dashboard,
 *                           before the hold lapses. Found for a shop with no live connector too
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

  const { rows: stuck } = await q.query<{ id: string; period: string; amount_cents: string | number; last_error: string | null }>(
    `SELECT id, period, amount_cents, last_error FROM payments.clear_fee_bills
      WHERE merchant = $1 AND status = 'collecting' AND attempted_at < now() - interval '1 hour'`,
    [input.merchant],
  );
  flags.push(...(await strandedFlags(q, input.merchant)));

  for (const b of stuck) {
    flags.push({ kind: 'fee_bill_unconfirmed', ref: b.id, expectedCents: Number(b.amount_cents), actualCents: null, detail: `Clear's ${b.period} fee bill was sent for collection and not seen to land${b.last_error ? ` (${b.last_error})` : ''}. Check the chain before collecting it again` });
  }
  return flags;
}

/** Cards authorised on a connector the shop has since disconnected: needs no processor to find. */
export async function strandedFlags(q: Queryable, merchant: string): Promise<Flag[]> {
  const { rows } = await q.query<{ id: string; amount_cents: string | number; tip_cents: string | number; authorised_at: Date | string | null; provider: string }>(
    `SELECT t.id, t.amount_cents, t.tip_cents, t.authorised_at, c.provider FROM payments.tenders t
       JOIN merchant.card_connectors c ON c.id = t.connector_id
      WHERE t.merchant = $1 AND t.method = 'card' AND t.status = 'authorised' AND c.disconnected_at IS NOT NULL`,
    [merchant],
  );
  return rows.map((t) => ({
    kind: 'card_stranded',
    ref: t.id,
    expectedCents: Number(t.amount_cents) + Number(t.tip_cents),
    actualCents: null,
    detail: `Card payment ${t.id} was authorised${t.authorised_at ? ` at ${new Date(t.authorised_at).toISOString()}` : ''} and then card processing (${t.provider}) was disconnected. Clear can't capture it: the shop captures it in their dashboard before the hold lapses, or the sale goes unpaid`,
  }));
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
        // Explained at these same figures: it stays closed. Figures that have moved since are news.
        const { rows: explained } = await tx.query(
          `SELECT 1 FROM payments.reconciliation_flags
            WHERE merchant = $1 AND kind = $2 AND ref = $3 AND explained_at IS NOT NULL
              AND expected_cents IS NOT DISTINCT FROM $4 AND actual_cents IS NOT DISTINCT FROM $5 LIMIT 1`,
          [merchant, f.kind, f.ref, f.expectedCents, f.actualCents],
        );
        if (explained[0]) continue;
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
  // Shops with no live connector, but a card stranded on the one they disconnected: nothing to ask
  // the processor, so only that is checked.
  const { rows: stranded } = await db.query<{ merchant: string }>(
    `SELECT DISTINCT t.merchant FROM payments.tenders t JOIN merchant.card_connectors c ON c.id = t.connector_id
      WHERE t.method = 'card' AND t.status = 'authorised' AND c.disconnected_at IS NOT NULL AND c.provider = $1
        AND ($2::text IS NULL OR t.merchant = $2)
        AND NOT EXISTS (SELECT 1 FROM merchant.card_connectors l WHERE l.merchant = t.merchant AND l.disconnected_at IS NULL)`,
    [provider.provider, opts.merchant ?? null],
  );
  for (const { merchant } of stranded) {
    const flags = await strandedFlags(db, merchant);
    out.push({ merchant, flags: flags.length, ...(await recordFlags(db, merchant, flags)) });
  }
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

export class FlagError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'invalid',
  ) {
    super(message);
    this.name = 'FlagError';
  }
}

type FlagRow = {
  id: string;
  kind: string;
  ref: string;
  expected_cents: string | number | null;
  actual_cents: string | number | null;
  detail: string;
  found_at: Date | string;
  explanation: string | null;
  explained_at: Date | string | null;
  explained_name: string | null;
};
const toFlag = (r: FlagRow): ReconciliationFlag => ({
  id: r.id,
  kind: r.kind,
  ref: r.ref,
  expectedCents: r.expected_cents === null ? null : Number(r.expected_cents),
  actualCents: r.actual_cents === null ? null : Number(r.actual_cents),
  detail: r.detail,
  foundAt: new Date(r.found_at).toISOString(),
  explained: r.explained_at ? { by: r.explained_name ?? '—', note: r.explanation ?? '', at: new Date(r.explained_at).toISOString() } : null,
});
const FLAG_SELECT = `SELECT f.*, s.name AS explained_name FROM payments.reconciliation_flags f LEFT JOIN merchant.staff s ON s.id = f.explained_by`;

/** Reconciliation, as the Payouts page shows it: what's open, and the last explained. */
export async function reconciliationView(q: Queryable, merchant: string): Promise<Reconciliation> {
  const { rows: open } = await q.query<FlagRow>(`${FLAG_SELECT} WHERE f.merchant = $1 AND f.resolved_at IS NULL ORDER BY f.found_at DESC`, [merchant]);
  const { rows: explained } = await q.query<FlagRow>(`${FLAG_SELECT} WHERE f.merchant = $1 AND f.explained_at IS NOT NULL ORDER BY f.explained_at DESC LIMIT 20`, [merchant]);
  return { open: open.map(toFlag), explained: explained.map(toFlag) };
}

/**
 * An owner or manager has looked into it: the flag closes with what happened, and who said so. It
 * stays closed while the nightly run finds the same figures; if they move, it's opened again.
 */
export async function explainFlag(db: Db, input: { merchant: string; flagId: string; staffId: string; body: unknown }): Promise<ReconciliationFlag> {
  const parsed = ExplainFlag.safeParse(input.body);
  if (!parsed.success) throw new FlagError(parsed.error.issues[0]?.message ?? 'Say what happened', 'invalid');
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; expected_cents: string | number | null }>(
      `UPDATE payments.reconciliation_flags SET resolved_at = now(), explained_by = $3, explanation = $4, explained_at = now()
        WHERE id = $1 AND merchant = $2 AND resolved_at IS NULL RETURNING id, expected_cents`,
      [input.flagId, input.merchant, input.staffId, parsed.data.note],
    );
    if (!rows[0]) throw new FlagError('That flag is closed already, or isn’t this shop’s', 'not_found');
    await audit(tx, {
      merchant: input.merchant,
      actor: input.staffId,
      action: 'reconciliation.explained',
      ref: { type: 'reconciliation_flag', id: input.flagId },
      amountCents: rows[0].expected_cents === null ? null : Number(rows[0].expected_cents),
      detail: { note: parsed.data.note },
    });
    const { rows: out } = await tx.query<FlagRow>(`${FLAG_SELECT} WHERE f.id = $1`, [input.flagId]);
    return toFlag(out[0]!);
  });
}

