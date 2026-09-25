import type { TaxApi, TaxLine } from './taxApi.js';
import { CalculationUnusable } from './taxApi.js';
import { taxAtRate } from './taxService.js';

/**
 * Stripe Tax for tests: 7.75% on goods and prepared food, labour untaxed, in California. Records
 * transactions like Stripe does: a calculation is used once, and a reversal can't take back more
 * than was recorded. Tests only.
 */
export function fakeTax(opts: { collecting?: boolean; shopStatus?: 'active' | 'setup_needed' } = {}) {
  const calls: Array<{ account: string | null; lines: TaxLine[]; inclusive: boolean }> = [];
  const RATE: Record<string, number> = { goods: 77500, food: 77500, labour: 0, exempt: 0 };
  const calcTotals = new Map<string, number>();
  const used = new Set<string>();
  const transactions = new Map<string, { account: string; reference: string; totalCents: number; reversedCents: number; reverses: string | null }>();
  let n = 0;
  const api: TaxApi = {
    async status() {
      return opts.shopStatus ?? 'setup_needed';
    },
    async calculate(account, { lines, inclusive }) {
      calls.push({ account, lines, inclusive });
      const collecting = opts.collecting ?? true;
      const id = `taxcalc_${++n}`;
      const taxByLine = new Map(lines.map((l) => [l.reference, collecting ? taxAtRate(l.amountCents, RATE[l.taxKind]!, inclusive) : 0]));
      calcTotals.set(id, lines.reduce((s, l) => s + l.amountCents + (inclusive ? 0 : taxByLine.get(l.reference)!), 0));
      return { calculationId: id, taxByLine, rateByLine: new Map(lines.map((l) => [l.reference, collecting ? RATE[l.taxKind]! : null])) };
    },
    async record(account, { calculationId, reference }) {
      if (used.has(calculationId) || !calcTotals.has(calculationId)) throw new CalculationUnusable('calculation already used or unknown');
      if ([...transactions.values()].some((t) => t.account === account && t.reference === reference)) throw new Error(`reference ${reference} already used`);
      used.add(calculationId);
      const id = `tax_${++n}`;
      transactions.set(id, { account, reference, totalCents: calcTotals.get(calculationId)!, reversedCents: 0, reverses: null });
      return { transactionId: id };
    },
    async reverse(account, { transactionId, reference, flatAmountCents }) {
      const original = transactions.get(transactionId);
      if (!original) throw new Error('no such transaction');
      // Stripe's rule: no full reversal of a sale while partial reversals of it stand.
      if (flatAmountCents === undefined && original.totalCents > 0) {
        const standing = [...transactions.entries()].filter(([, t]) => t.reverses === transactionId && t.totalCents < 0 && t.reversedCents < -t.totalCents);
        if (standing.length) throw new Error('has partial reversals which have not been fully reversed');
      }
      const amount = flatAmountCents ?? (original.totalCents > 0 ? original.totalCents - original.reversedCents : -original.totalCents - original.reversedCents);
      if (original.reversedCents + amount > Math.abs(original.totalCents)) throw new Error('reversing more than was recorded');
      original.reversedCents += amount;
      // Undoing a refund's reversal makes that much of the sale reversible again, as at Stripe.
      if (original.totalCents < 0 && original.reverses) transactions.get(original.reverses)!.reversedCents -= amount;
      const id = `tax_${++n}`;
      transactions.set(id, { account, reference, totalCents: original.totalCents > 0 ? -amount : amount, reversedCents: 0, reverses: transactionId });
      return { transactionId: id };
    },
  };
  return { api, calls, transactions };
}
