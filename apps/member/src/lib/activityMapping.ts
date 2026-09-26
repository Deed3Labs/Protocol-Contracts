import type { ActivityItem } from '@/hooks/useClearTransactions';
import type { CardTransaction, ChargePayment, CreditRepaymentEntry } from '@/utils/apiClient';
import { categoryForMcc } from './mccCategory';
import type { ActivityRow, ActivityKind, ActivitySource } from '@/lib/clearModel';

/**
 * Turns a transaction into a row the Activity page can show.
 *
 * The two shapes answer different questions and neither is a subset of the other. `ActivityItem`
 * is provenance — which wallet, which Plaid category, was it a move between the member's own
 * accounts. `ActivityRow` is what the member sees: what kind of thing happened, and which pot it
 * came out of. The mapping is where one becomes the other, and it is deliberately one file so the
 * guesses are in a place somebody can argue with.
 *
 * Two of them are guesses today, and both are named rather than hidden:
 *
 * `source` cannot be read off a transaction. Which tier funded a card swipe is decided by the
 * credit waterfall, and lives in the issuer, not in the transfer. Everything here therefore reads
 * as cash or savings, never credit -- wrong in the safe direction, because showing "credit" for
 * something a member paid cash for would misstate what they owe. It is filled in properly when
 * the credit route lands (deployment plan, Phase D).
 *
 * `kind` drives the filter chips, so it has to be one of four. Internal moves into savings are
 * savings; money in is a deposit; money out is spending unless it went to a person, which is
 * sent. A bank transaction is never `sent` -- that word means a Clear transfer to another member.
 */
export function toActivityRow(item: ActivityItem): ActivityRow {
  return {
    id: item.id,
    name: item.name,
    date: item.date,
    source: sourceOf(item),
    kind: kindOf(item),
    amount: item.amount,
    pending: item.status === 'pending',
    datetime: new Date(item.ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
  };
}

/**
 * A card purchase as an activity row — the same mapping the Card page uses.
 *
 * Card spending reached the Activity page's totals, its category bar and its merchant list, and
 * never its actual list of rows: `rows` was built from on-chain items alone. So a member saw $200
 * spent this cycle and no purchase anywhere underneath it, which reads as the page having lost
 * something. It had.
 *
 * Unlike the chain mapping above, the funding here is not a guess: a card authorization carries its
 * draws, and the waterfall already decided which tiers paid. That is why this is the one path
 * allowed to say `credit`.
 */
/** Whether the credit this purchase drew has been repaid, in full or in part. Undefined when it has not, or never drew any. */
function repaidState(tx: CardTransaction): 'full' | 'partial' | undefined {
  const credit = tx.creditCents ?? 0;
  const repaid = tx.creditRepaidCents ?? 0;
  if (credit <= 0 || repaid <= 0) return undefined;
  return repaid >= credit ? 'full' : 'partial';
}

export function cardTransactionRow(tx: CardTransaction, cardLast4?: string): ActivityRow {
  const credited = tx.draws.filter((draw) => draw.source !== 'cash');
  const at = new Date(tx.at);
  return {
    id: tx.id,
    name: tx.name,
    date: at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    datetime: at.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
    source: credited.length === 0 ? 'cash' : 'credit',
    kind: 'spending',
    // What the merchant asked for. A reversed charge keeps its figure and is marked instead, so the
    // member can reconcile it against what they remember; totals count `heldCents`.
    amount: -tx.amountCents / 100,
    reversed: tx.reversed ?? false,
    category: categoryForMcc(tx.mcc),
    location: [tx.city, tx.state].filter(Boolean).join(', ') || undefined,
    paidFromLabel:
      credited.length === 0 ? 'Cash' : repaidState(tx) === 'full' ? 'Credit · repaid' : repaidState(tx) === 'partial' ? 'Credit · part repaid' : 'Credit',
    ...(repaidState(tx) ? { creditRepaid: repaidState(tx) } : {}),
    cardLast4,
    // A reversed charge has nothing held, so there is nothing to dispute at the network.
    ...(tx.reversed ? {} : { dispute: { kind: 'card' as const, ref: tx.id } }),
  };
}

/**
 * Everything the member spent, from both halves, newest first.
 *
 * Card purchases and on-chain movements are two feeds of one story, and every list that shows only
 * one of them is lying by omission — Activity did it, then Home did it after Activity was fixed.
 * Three copies of this merge would have been three chances to forget the next one, so it lives here.
 *
 * Sorted on real timestamps rather than the formatted `date`, which is a display string two rows on
 * the same day cannot be ordered by.
 */
/** How a repayment was made, in the member's words. */
export const REPAYMENT_METHOD_LABEL: Record<CreditRepaymentEntry['method'], string> = {
  manual: 'USDC',
  auto: 'USDC · automatic',
  savings: 'Savings',
  bank: 'Bank deposit',
};

const when = (ts: number) => {
  const at = new Date(ts);
  return {
    date: at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    datetime: at.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
  };
};

/** A shop paid now, from Ready to allocate: one row, named for the shop, for the whole amount. */
export function chargePaymentRow(p: ChargePayment, ts: number): ActivityRow {
  return {
    id: `charge:${p.code}`,
    name: p.merchantName,
    ...when(ts),
    kind: 'spending',
    source: 'cash',
    amount: -p.amountCents / 100,
    paidFromLabel: 'Ready to allocate',
    status: p.status === 'refunded' ? 'Refunded' : p.status === 'disputed' ? 'In dispute' : 'Paid now',
  };
}

/** The same payment given back. */
export function chargeRefundRow(p: ChargePayment, ts: number): ActivityRow {
  return {
    id: `charge-refund:${p.code}`,
    name: `Refund from ${p.merchantName}`,
    ...when(ts),
    kind: 'deposit',
    source: 'cash',
    amount: p.amountCents / 100,
    status: 'Refunded',
  };
}

/**
 * A repayment as an Activity row.
 *
 * Money put against the credit balance: out of the member's cash, their savings, or a bank deposit
 * that paid it down on arrival. Negative, because it left whatever it was paid from.
 */
export function repaymentRow(entry: CreditRepaymentEntry): ActivityRow {
  const at = new Date(entry.at);
  return {
    id: entry.id,
    // A plan payment is named for the plan and tagged with how far through it the member is.
    name: entry.plan ? `${entry.plan.name ?? 'Term plan'} payment` : 'Credit repayment',
    ...(entry.plan ? { termPayment: { index: entry.plan.index, count: entry.plan.count } } : {}),
    date: at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    datetime: at.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
    kind: 'repayment',
    source: entry.method === 'savings' ? 'savings' : entry.method === 'bank' ? 'cash account' : 'cash',
    amount: -entry.amountCents / 100,
    paidFromLabel: REPAYMENT_METHOD_LABEL[entry.method],
    repaymentMethod: REPAYMENT_METHOD_LABEL[entry.method],
  };
}

export function mergedActivityRows(
  items: ActivityItem[],
  cards: CardTransaction[],
  cardLast4?: string,
  repayments: CreditRepaymentEntry[] = [],
  chargePayments: ChargePayment[] = [],
): ActivityRow[] {
  /*
   * An on-chain repayment is also a token transfer, and the chain feed shows it as one. The
   * repayment row says what it actually was, so the transfer with the same hash is folded into it
   * rather than listed twice.
   */
  const repaidTx = repayments.map((r) => r.txHash?.toLowerCase()).filter((h): h is string => Boolean(h));
  const isRepaymentTransfer = (item: ActivityItem) => repaidTx.some((hash) => item.id.toLowerCase().includes(hash));
  /*
   * Paying a shop now is two transfers in one transaction (the shop's share and Clear's fee), and a
   * refund of it is two more coming back. The chain feed lists each as "Sent USDC" / "Received USDC";
   * the member paid Mike's Tire $940, once. Those transfers are folded into one row a payment, and one
   * a refund, dated by the transfers themselves.
   */
  const inTx = (item: ActivityItem, hashes: string[]) => hashes.some((hash) => item.id.toLowerCase().includes(hash));
  const shopRows: { ts: number; row: ActivityRow }[] = [];
  const folded = new Set<ActivityItem>();
  for (const p of chargePayments) {
    const paidTx = p.txHash ? [p.txHash.toLowerCase()] : [];
    const refundTx = p.refundTxHashes.map((h) => h.toLowerCase());
    const paidItems = items.filter((item) => inTx(item, paidTx));
    const refundItems = items.filter((item) => inTx(item, refundTx));
    [...paidItems, ...refundItems].forEach((item) => folded.add(item));
    const paidTs = p.paidAt ? Date.parse(p.paidAt) : Math.min(...paidItems.map((i) => i.ts), Date.now());
    shopRows.push({ ts: paidTs, row: chargePaymentRow(p, paidTs) });
    // A refund shows once its money is seen arriving: that is when it happened for the member.
    if (refundItems.length) {
      const ts = Math.max(...refundItems.map((i) => i.ts));
      shopRows.push({ ts, row: chargeRefundRow(p, ts) });
    }
  }
  return [
    ...items.filter((item) => !isRepaymentTransfer(item) && !folded.has(item)).map((item) => ({ ts: item.ts, row: toActivityRow(item) })),
    ...cards.map((tx) => ({ ts: Date.parse(tx.at), row: cardTransactionRow(tx, cardLast4) })),
    ...repayments.map((entry) => ({ ts: Date.parse(entry.at), row: repaymentRow(entry) })),
    ...shopRows,
  ]
    .sort((a, b) => b.ts - a.ts)
    .map((entry) => entry.row);
}

function sourceOf(item: ActivityItem): ActivitySource {
  if (item.category === 'Deposit' && item.internal) return 'savings';
  if (item.source === 'bank') return 'cash account';
  // Money in from another wallet that is not the member's own is money from a member.
  if (item.amount > 0 && !item.internal) return 'received';
  return 'cash';
}

function kindOf(item: ActivityItem): ActivityKind {
  if (item.internal && item.category === 'Deposit') return 'savings';
  if (item.amount > 0) return 'deposit';
  if (item.category === 'Transfer' && item.source !== 'bank') return 'sent';
  return 'spending';
}
