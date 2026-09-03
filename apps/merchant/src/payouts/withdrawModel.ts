import { dollars, fromCents } from '@clear/domain';

/**
 * Where money can come from, and where it can go — reference section 07b.
 *
 * Two sources and three destinations, and the cash account is deliberately on both sides: it is a
 * destination when money is being released and a source when it is being sent on. The one
 * combination that makes no sense — cash account to cash account — drops out of the destination
 * list once cash is picked as the source, rather than being offered and then refused.
 */
export type Source = 'owed' | 'cash';
export type Destination = 'cash' | 'bank' | 'debit';

/** Instant costs money. The reference is explicit that it says so twice: as a rate, then in dollars. */
export const INSTANT_FEE_RATE = 0.015;

export function feeCents(destination: Destination, amountCents: number): number {
  return destination === 'debit' ? Math.round(amountCents * INSTANT_FEE_RATE) : 0;
}

/**
 * The Route line.
 *
 * Owed money must pass through the cash account — that hop is on-chain and happens regardless —
 * while money already there goes straight out. One line, so the hop never becomes a step the
 * merchant has to think about.
 */
export function routeLabel(source: Source, destination: Destination, bankName: string): string {
  const end = destination === 'cash' ? 'your cash account' : destination === 'bank' ? bankName : 'your card';
  if (destination === 'cash') return 'Released to your cash account';
  return source === 'owed' ? `Cash account, then ${end}` : `Straight to ${end}`;
}

/** What the shop is told to expect. Timing belongs to the destination, not the source. */
export function arrivalLabel(destination: Destination): string {
  if (destination === 'cash') return 'Instant';
  if (destination === 'debit') return 'Minutes';
  return '1–3 days';
}

export function feeLabel(destination: Destination, amountCents: number): string {
  if (destination !== 'debit') return 'None';
  return `1.5% · ${dollars(fromCents(feeCents(destination, amountCents)))}`;
}

/**
 * Three steps when it starts as owed, two when it starts in the cash account.
 *
 * The shorter flow is finished rather than truncated — it shows two steps rather than three with
 * one greyed out, because a step that never applies is not progress a merchant is waiting on.
 */
export function steps(source: Source, destination: Destination, bankName: string): string[] {
  if (destination === 'cash') return ['Released from what you are owed', 'In your cash account'];
  const end = destination === 'bank' ? bankName : 'your card';
  return source === 'owed'
    ? ['Released from what you are owed', 'In your cash account', `On its way to ${end}`]
    : ['Leaving your cash account', `On its way to ${end}`];
}
