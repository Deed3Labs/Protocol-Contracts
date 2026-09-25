import { randomUUID } from 'node:crypto';
import type { Db, Queryable } from '../../../db/db.js';
import { post } from '../ledger/ledgerService.js';
import * as postings from '../ledger/postings.js';

/**
 * Clear's fee, billed monthly (card-processing prompt, Phase 9): the fallback for a card processor
 * that can't take a platform fee off each sale. Each such sale accrues Clear's fee at capture
 * (cardTenders.ts, `clear_fees_payable`); at month end the shop gets one bill, collected from its
 * cash account.
 *
 * **What a bill is for.** Clear's fees accrued up to the end of the month, in the shop's own time
 * zone (less fees given back with refunds), less everything already billed. Worked out from the
 * ledger rather than summed from sales, so a refund nets out, a month that nets to nothing raises
 * no bill (what it gave back comes off the next), and a bill is for its month alone however late
 * it's raised or the one before it collected. Not "owed less open bills": a bill collected after
 * the next month ends would then be counted in both.
 *
 * **Collecting it.** Through a FeeCollector (privyFeeCollector.ts: USDC from the shop's wallet, by
 * Clear's signer). A bill is marked `collecting` before anything is sent, so a crash mid-send can't
 * lead to a second send: a bill left `collecting` is never retried on its own. The nightly
 * reconciliation flags it, and a person checks the chain.
 */

export type BillStatus = 'due' | 'collecting' | 'short' | 'collected';

export interface FeeBill {
  id: string;
  merchant: string;
  period: string;
  amountCents: number;
  status: BillStatus;
  txHash: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  collectedAt: string | null;
}

/**
 * Takes a bill from the shop's cash account.
 *
 * Resolves `{ ok: false }` only when it's certain nothing moved: `short` when the account didn't
 * hold enough. Throws when the outcome isn't known (sent, but not seen to land), and the bill then
 * waits for a person.
 */
export interface FeeCollector {
  collect(input: { merchant: string; billId: string; amountCents: number }): Promise<{ ok: true; txHash: string } | { ok: false; short: boolean; reason: string }>;
}

interface BillRow {
  id: string;
  merchant: string;
  period: string;
  amount_cents: string | number;
  status: BillStatus;
  tx_hash: string | null;
  attempts: number;
  last_error: string | null;
  created_at: Date | string;
  collected_at: Date | string | null;
}

const toBill = (r: BillRow): FeeBill => ({
  id: r.id,
  merchant: r.merchant,
  period: r.period,
  amountCents: Number(r.amount_cents),
  status: r.status,
  txHash: r.tx_hash,
  attempts: r.attempts,
  lastError: r.last_error,
  createdAt: new Date(r.created_at).toISOString(),
  collectedAt: r.collected_at === null ? null : new Date(r.collected_at).toISOString(),
});

/** 'YYYY-MM' of the month before the one `now` falls in, in `timezone`. */
export function previousPeriod(timezone: string, now = new Date()): string {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit' })
    .format(now)
    .split('-')
    .map(Number) as [number, number];
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${prev.y}-${String(prev.m).padStart(2, '0')}`;
}

/** The first day of the month after `period`, as a date. */
function periodEnd(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * Raises one shop's bill for `period` if it owes anything that isn't already billed. Safe to repeat:
 * one bill per shop per month.
 */
export async function raiseBill(q: Queryable, input: { merchant: string; period: string }): Promise<{ bill: FeeBill | null; created: boolean }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw new Error(`Not a month: ${input.period}`);
  const { rows: existing } = await q.query<BillRow>('SELECT * FROM payments.clear_fee_bills WHERE merchant = $1 AND period = $2', [input.merchant, input.period]);
  if (existing[0]) return { bill: toBill(existing[0]), created: false };

  // Accrued by the end of the month, the shop's midnight, less fees given back. Collections are left
  // out: what's been billed is subtracted instead, whenever it was collected.
  const { rows: accrued } = await q.query<{ cents: string | number | null }>(
    `SELECT SUM(l.credit_cents - l.debit_cents) AS cents
       FROM ledger.journal_lines l
       JOIN ledger.journal_entries e ON e.id = l.entry_id
       JOIN ledger.accounts a ON a.id = l.account_id
       JOIN merchant.profiles p ON p.merchant = e.merchant
      WHERE e.merchant = $1 AND a.code = 'clear_fees_payable' AND e.kind <> 'clear_fee_collected'
        AND e.occurred_at < ($2::date)::timestamp AT TIME ZONE p.timezone`,
    [input.merchant, periodEnd(input.period)],
  );
  const { rows: billed } = await q.query<{ cents: string | number | null }>('SELECT SUM(amount_cents) AS cents FROM payments.clear_fee_bills WHERE merchant = $1', [input.merchant]);
  const amount = Number(accrued[0]?.cents ?? 0) - Number(billed[0]?.cents ?? 0);
  if (amount <= 0) return { bill: null, created: false };

  const { rows } = await q.query<BillRow>(
    `INSERT INTO payments.clear_fee_bills (id, merchant, period, amount_cents) VALUES ($1, $2, $3, $4)
     ON CONFLICT (merchant, period) DO NOTHING RETURNING *`,
    [`bill_${randomUUID()}`, input.merchant, input.period, amount],
  );
  return rows[0] ? { bill: toBill(rows[0]), created: true } : { bill: null, created: false };
}

/** Last month's bill for every shop with Clear's fee owed, each in its own transaction and time zone. */
export async function raiseBills(db: Db, opts: { now?: Date; merchant?: string } = {}): Promise<{ raised: FeeBill[]; failed: string[] }> {
  const { rows } = await db.query<{ merchant: string; timezone: string }>(
    `SELECT DISTINCT a.merchant, p.timezone FROM ledger.accounts a JOIN merchant.profiles p ON p.merchant = a.merchant
      WHERE a.code = 'clear_fees_payable' AND ($1::text IS NULL OR a.merchant = $1)`,
    [opts.merchant ?? null],
  );
  const out = { raised: [] as FeeBill[], failed: [] as string[] };
  for (const r of rows) {
    try {
      const { bill, created } = await db.transaction((tx) => raiseBill(tx, { merchant: r.merchant, period: previousPeriod(r.timezone, opts.now) }));
      if (bill && created) out.raised.push(bill);
    } catch (error) {
      out.failed.push(`${r.merchant}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}

/**
 * Collects every bill that's due, or was short last time. A bill is claimed (`collecting`) and that
 * committed before the collector is asked, so two runs can't both send it.
 */
export async function collectBills(db: Db, collector: FeeCollector, opts: { merchant?: string } = {}): Promise<{ collected: string[]; short: string[]; unconfirmed: string[] }> {
  const { rows } = await db.query<BillRow>(
    `SELECT * FROM payments.clear_fee_bills WHERE status IN ('due','short') AND ($1::text IS NULL OR merchant = $1) ORDER BY created_at`,
    [opts.merchant ?? null],
  );
  const out = { collected: [] as string[], short: [] as string[], unconfirmed: [] as string[] };
  for (const bill of rows) {
    const { rows: claimed } = await db.query<BillRow>(
      `UPDATE payments.clear_fee_bills SET status = 'collecting', attempts = attempts + 1, attempted_at = now(), last_error = NULL
        WHERE id = $1 AND status IN ('due','short') RETURNING *`,
      [bill.id],
    );
    if (!claimed[0]) continue;
    const amount = Number(bill.amount_cents);

    let result: Awaited<ReturnType<FeeCollector['collect']>>;
    try {
      result = await collector.collect({ merchant: bill.merchant, billId: bill.id, amountCents: amount });
    } catch (error) {
      // Maybe sent, maybe not: left `collecting` for a person. Retrying could take it twice.
      await db.query('UPDATE payments.clear_fee_bills SET last_error = $2 WHERE id = $1', [bill.id, error instanceof Error ? error.message : String(error)]);
      out.unconfirmed.push(bill.id);
      continue;
    }

    if (result.ok) {
      const txHash = result.txHash;
      await db.transaction(async (tx) => {
        await post(tx, postings.clearFeeCollected({ merchant: bill.merchant, billId: bill.id, amountCents: amount, txHash }));
        await tx.query(`UPDATE payments.clear_fee_bills SET status = 'collected', tx_hash = $2, collected_at = now() WHERE id = $1`, [bill.id, txHash]);
      });
      out.collected.push(bill.id);
    } else {
      await db.query('UPDATE payments.clear_fee_bills SET status = $2, last_error = $3 WHERE id = $1', [bill.id, result.short ? 'short' : 'due', result.reason]);
      if (result.short) out.short.push(bill.id);
    }
  }
  return out;
}

/** A shop's bills, newest first. */
export async function feeBills(q: Queryable, merchant: string): Promise<FeeBill[]> {
  const { rows } = await q.query<BillRow>('SELECT * FROM payments.clear_fee_bills WHERE merchant = $1 ORDER BY period DESC', [merchant]);
  return rows.map(toBill);
}
