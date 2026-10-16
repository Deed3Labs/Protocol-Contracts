import type { ContactSent, MemberQuote, PaidView } from '@clear/merchant-contracts';

/**
 * The Clear steps' words and figures (pay spec §2–§4; pay DECISIONS, Phase 1 and 5), shared by the
 * modal and the link page. Pure, so the copy is tested.
 */

export const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The approved one screen for everyone, by channel. */
export const checkTitle = (channel: ContactSent['channel']) => (channel === 'email' ? 'Check your email' : 'Check your phone');
export const checkBody = (channel: ContactSent['channel']) =>
  channel === 'email' ? 'We emailed you a link and a code. Tap the link, or enter the code here.' : 'We texted you a link and a code. Tap the link, or enter the code here.';

/** "In full", "In 2", "In 4", "In 12". */
export const splitLabel = (n: number) => (n === 1 ? 'In full' : `In ${n}`);

/** "Approve $185.32 in 4"; "Approve $185.32" to pay now or in full. */
export const approveLabel = (totalCents: number, installments: number | null) =>
  installments && installments > 1 ? `Approve ${money(totalCents)} in ${installments}` : `Approve ${money(totalCents)}`;

/** "Carry, whole plan · 2% a cycle". */
export const carryLabel = (bps: number) => `Carry, whole plan · ${bps % 100 ? (bps / 100).toFixed(2) : bps / 100}% a cycle`;

/** "Earns 256 points at Mi Casa · 1.5× for paying with Clear". */
export function pointsNote(p: MemberQuote['points']): string | null {
  if (!p || p.earns <= 0) return null;
  return [`Earns ${p.earns} points at ${p.shopName}`, p.multiplierLabel].filter(Boolean).join(' · ');
}

/** "Nov 1", from a business date. */
export const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Mi Casa Tacos has your order. The first of 4 cycles, $48.65, clears Nov 1." */
export function doneLine(shopName: string, paid: PaidView): string {
  const first = paid.firstCycle && paid.installments && paid.installments > 1 ? ` The first of ${paid.installments} cycles, ${money(paid.firstCycle.amountCents)}, clears ${dayLabel(paid.firstCycle.on)}.` : '';
  return `${shopName} has your order.${first}`;
}

/** "Clear · in 4", "Clear", "Card". */
export const paidWith = (paid: PaidView) => (paid.method === 'card' ? 'Card' : paid.installments && paid.installments > 1 ? `Clear · in ${paid.installments}` : 'Clear');

/** "+256 · now 384". */
export const pointsRow = (p: NonNullable<PaidView['points']>) => `+${p.earned} · now ${p.now}`;

/** A shop's everyday name: "Mi Casa Tacos" is "Mi Casa" (as rewards derives it). */
export function everydayName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length >= 3 ? words.slice(0, -1) : words).join(' ');
}

/** Only digits, at most six: what the code boxes hold. */
export const codeDigits = (typed: string) => typed.replace(/\D/g, '').slice(0, 6);
