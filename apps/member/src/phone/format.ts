import type { PointView } from './types';

/** Figures on these pages are drawn as the reference draws them: "18.00" on a line, "$48.20" as a total. */

export const money = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dollars = (cents: number) => `$${money(cents)}`;

/** "7:46pm", in the phone's own time: the customer is at the shop. */
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP])M$/, (_, x: string) => `${x.toLowerCase()}m`);
}

/** "Oct 15". */
export function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "0142". */
export const orderNo = (n: number) => String(n).padStart(4, '0');

/** `/p/A7K2` → the Point page, `/r/K7Q2M9XH4P` → the receipt. Anything else is neither. */
export function phoneRoute(pathname: string): { page: 'point' | 'receipt'; code: string } | null {
  const m = /^\/([pr])\/([0-9A-Za-z]{4,16})\/?$/.exec(pathname);
  if (!m) return null;
  return { page: m[1] === 'p' ? 'point' : 'receipt', code: m[2]!.toUpperCase() };
}

/**
 * How soon the page looks again. A bill: every 4 seconds, so paying at the table (or a card coming
 * back from Stripe) shows Paid at once. Otherwise every 15, so a bill the server sends turns up
 * while the menu is open. A paid page stops: the receipt stays put even after the Point goes back to
 * its number. A whole dining room on the guest Wi-Fi shares one address and one allowance (120 a
 * minute), so the slow rate is the common one.
 */
export function pollMs(view: PointView | null): number | null {
  if (view === 'paid') return null;
  return view === 'bill' ? 4_000 : 15_000;
}
