import { CATEGORY_LABEL, categoryForMcc } from './mccCategory';
import type { CycleSpend, MerchantSpend, SpendCategory } from './clearModel';
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
  name: string;
  ts: number;
  amount: number;
  internal: boolean;
  spendCategory?: string;
}

// No readable cycle means no window to measure against, so everything loaded counts: a member with
// no credit line still moves money, and the page is about what moved.
const inCycle = (ms: number, startMs: number) => startMs <= 0 || ms >= startMs;
const cardAt = (tx: CardTransaction) => Date.parse(tx.at);

/** The catch-all group, named once. */
export const REST = 'Everything else';

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
    add(groupOf(tx.mcc), tx.amountCents / 100);
  }
  for (const row of otherOutflow(rows, startMs)) add(REST, -row.amount);

  const named = [...totals.entries()]
    .filter(([label]) => label !== REST)
    .sort((a, b) => b[1] - a[1]);
  const rest = named.slice(keep).reduce((sum, [, amount]) => sum + amount, 0) + (totals.get(REST) ?? 0);

  const groups: SpendCategory[] = named.slice(0, keep).map(([label, amount]) => ({ label, amount }));
  if (rest > 0) groups.push({ label: REST, amount: rest });
  return groups;
}

/** The group a card purchase falls in, before any rule the member has set. */
function groupOf(mcc: string | null): string {
  const category = categoryForMcc(mcc);
  // "Other" is the catch-all under another name; one bucket for the leftovers, not two.
  // "Other" is the catch-all under another name; one bucket for the leftovers, not two.
  return category && category !== 'other' ? CATEGORY_LABEL[category] : REST;
}

/**
 * The merchants behind the groups: what each took, how many payments, and where it sits.
 *
 * Change groups works per merchant, not per group — nobody wants to rename Groceries, they want
 * Costco out of Everything else — so this is the list that sheet is built on.
 */
export function merchantsFrom(cards: CardTransaction[], rows: SpendRow[], startMs: number): MerchantSpend[] {
  const byName = new Map<string, MerchantSpend>();
  const add = (name: string, group: string, amount: number) => {
    const merchant = byName.get(name) ?? { name, group, payments: 0, amount: 0 };
    merchant.payments += 1;
    merchant.amount += amount;
    byName.set(name, merchant);
  };

  for (const tx of cards) {
    if (!inCycle(cardAt(tx), startMs)) continue;
    add(tx.name, groupOf(tx.mcc), tx.amountCents / 100);
  }
  for (const row of otherOutflow(rows, startMs)) add(row.name, REST, -row.amount);

  return [...byName.values()].sort((a, b) => b.amount - a.amount);
}

/**
 * The groups, rebuilt from the merchants and whatever rules the member has set.
 *
 * A move is retroactive on purpose: if it only applied to future payments the figures that sent the
 * member here would stay wrong.
 */
export function groupsFromMerchants(
  merchants: MerchantSpend[],
  moved: Record<string, string> = {},
  keep = 3,
): SpendCategory[] {
  const totals = new Map<string, number>();
  for (const merchant of merchants) {
    const group = groupOfMerchant(merchant, moved);
    totals.set(group, (totals.get(group) ?? 0) + merchant.amount);
  }
  // A group the member put something in stays on the list whatever its size: they made it, and
  // folding it back into Everything else would read as the move not having worked.
  const pinned = new Set(Object.values(moved));
  const named = [...totals.entries()].filter(([label]) => label !== REST).sort((a, b) => b[1] - a[1]);
  const shown = named.filter(([label], i) => i < keep || pinned.has(label));
  const rest =
    named.filter((entry) => !shown.includes(entry)).reduce((sum, [, amount]) => sum + amount, 0) +
    (totals.get(REST) ?? 0);
  const groups = shown.map(([label, amount]) => ({ label, amount }));
  if (rest > 0) groups.push({ label: REST, amount: rest });
  return groups;
}

/**
 * The key a rule is stored under: the merchant's name, normalized, so "COSTCO #221" and "Costco"
 * are one merchant. Matches the server's `merchantKey` in payLedgerStore.
 */
export function merchantKey(name: string): string {
  return String(name || '').toLowerCase().replace(/[^a-z0-9&]+/g, '');
}

/** Where a merchant sits now, with the member's rules applied. */
export function groupOfMerchant(merchant: MerchantSpend, moved: Record<string, string> = {}): string {
  return moved[merchantKey(merchant.name)] ?? merchant.group;
}
