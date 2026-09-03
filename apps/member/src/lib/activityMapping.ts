import type { ActivityItem } from '@/hooks/useClearTransactions';
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
    datetime: new Date(item.ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
  };
}

function sourceOf(item: ActivityItem): ActivitySource {
  if (item.status === 'pending') return 'pending';
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
