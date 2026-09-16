import { CATEGORY_LABEL, categoryForMcc } from './mccCategory';
import type { CycleSpend, SpendCategory } from './clearModel';
import type { CardTransaction } from '@/utils/apiClient';

/*
 * What the cycle was made of, from what the member actually spent.
 *
 * Two sources, because they answer different halves. Card authorizations carry their draws, which is
 * the only place the cash-or-credit split is recorded: a card spends the cheapest money first and
 * the waterfall says which tiers paid. Everything else that left the account — a send, a withdrawal,
 * a bill paid from the balance — came out of cash by definition, because nothing but a card can
 * draw on the credit line.
 *
 * Internal moves are excluded: money going from the member's cash to their own savings has not been
 * spent, and counting it would make saving look like spending.
 */

/** The bit of an activity row this needs. Deliberately narrow, so a test does not need the hook. */
export interface SpendRow {
  ts: number;
  amount: number;
  internal: boolean;
  spendCategory?: string;
}

// No readable cycle means no window to measure against, so everything loaded counts: a member with
// no credit line still moves money, and the page is about what moved.
const inCycle = (ms: number, startMs: number) => startMs <= 0 || ms >= startMs;
const cardAt = (tx: CardTransaction) => Date.parse(tx.at);

/** Outflows that did not come from a card, which are cash by definition. */
function otherOutflow(rows: SpendRow[], startMs: number): SpendRow[] {
  return rows.filter((row) => !row.internal && row.amount < 0 && inCycle(row.ts, startMs));
}

/**
 * The hero: spent this cycle, split by what paid for it, with the carry alongside.
 *
 * Money out of every kind, not card spending alone — a card purchase, a send and a withdrawal are
 * all money that left, and consolidating them is the point of this page. Zero is a real answer and
 * is shown as one.
 */
export function cycleSpendFrom(
  cards: CardTransaction[],
  rows: SpendRow[],
  { startMs, daysLeft, carryCost }: { startMs: number; daysLeft: number; carryCost: number },
): CycleSpend {
  let fromCash = 0;
  let fromCredit = 0;
  for (const tx of cards) {
    if (!inCycle(cardAt(tx), startMs)) continue;
    for (const draw of tx.draws) {
      const amount = draw.amountCents / 100;
      if (draw.source === 'cash') fromCash += amount;
      else fromCredit += amount;
    }
  }
  for (const row of otherOutflow(rows, startMs)) fromCash += -row.amount;

  return { spent: fromCash + fromCredit, daysLeft, fromCash, fromCredit, carryCost };
}

/**
 * Where it went — the groups, largest first, with everything small folded into one.
 *
 * A card purchase is grouped by the merchant category code the network sent; anything else has no
 * merchant and lands in the catch-all rather than being given a category it does not have.
 */
export function categoriesFrom(cards: CardTransaction[], rows: SpendRow[], startMs: number, keep = 3): SpendCategory[] {
  const totals = new Map<string, number>();
  const add = (label: string, amount: number) => totals.set(label, (totals.get(label) ?? 0) + amount);

  for (const tx of cards) {
    if (!inCycle(cardAt(tx), startMs)) continue;
    const category = categoryForMcc(tx.mcc);
    // "Other" is the catch-all under another name; one bucket for the leftovers, not two.
    add(category && category !== 'other' ? CATEGORY_LABEL[category] : 'Everything else', tx.amountCents / 100);
  }
  for (const row of otherOutflow(rows, startMs)) add('Everything else', -row.amount);

  const named = [...totals.entries()]
    .filter(([label]) => label !== 'Everything else')
    .sort((a, b) => b[1] - a[1]);
  const rest = named.slice(keep).reduce((sum, [, amount]) => sum + amount, 0) + (totals.get('Everything else') ?? 0);

  const groups: SpendCategory[] = named.slice(0, keep).map(([label, amount]) => ({ label, amount }));
  if (rest > 0) groups.push({ label: 'Everything else', amount: rest });
  return groups;
}
