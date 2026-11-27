import type { CatalogItem, DiscountCode, LineInput, Order, Tender } from '@clear/merchant-contracts';
import type { CodeCheck } from './checkout';
import type { Leg } from './cash';
import type { CartLine, Item, Totals } from './model';

/**
 * New charge against the API (UI Phase 6, step 4): what the page sends and what it draws from what
 * comes back. The server works out tax, discounts and totals; these only translate.
 */

/** The cart as the order's lines: catalogue lines with their options, quick sales with their tax kind. A typed amount is one untaxed line. */
export function toLineInputs(lines: CartLine[], typedCents: number): LineInput[] {
  if (!lines.length) return typedCents > 0 ? [{ itemId: null, name: 'Amount', note: null, amountCents: typedCents, taxKind: 'exempt' }] : [];
  return lines.map((l) =>
    l.itemId
      ? { itemId: l.itemId, quantity: l.qty, optionIds: l.optionIds ?? [] }
      : { itemId: null, name: l.name.slice(0, 80) || 'Quick sale', note: null, amountCents: l.unitCents * l.qty, taxKind: l.tax },
  );
}

/** The checkout's breakdown from the server's order: each kind after the discount, the tax, the total. */
export function totalsFromOrder(o: Order): Totals {
  const by = (k: Order['lines'][number]['taxKind']) => o.lines.filter((l) => l.taxKind === k).reduce((s, l) => s + l.lineCents - l.discountCents, 0);
  return {
    count: o.lines.reduce((s, l) => s + l.quantity, 0),
    goodsCents: by('goods'),
    labourCents: by('labour'),
    foodCents: by('food'),
    exemptCents: by('exempt'),
    discountCents: o.discountCents,
    taxCents: o.taxCents,
    totalCents: o.totalCents,
  };
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** A code typed at checkout, looked up in the shop's codes: what it does, or why it doesn't. */
export function codeCheck(codes: DiscountCode[], typed: string, now = new Date()): CodeCheck | null {
  const c = codes.find((x) => x.code.toUpperCase() === typed.trim().toUpperCase());
  if (!c) return typed.trim().length >= 2 ? { code: typed.trim().toUpperCase(), ok: false, says: 'That isn’t one of this shop’s codes. Nothing has been taken off.' } : null;
  if (c.endsAt && new Date(c.endsAt) < now) return { code: c.code, ok: false, says: `This code ended on ${day(c.endsAt)}. Nothing has been taken off.` };
  if (c.startsAt && new Date(c.startsAt) > now) return { code: c.code, ok: false, says: `This code starts on ${day(c.startsAt)}. Nothing has been taken off.` };
  const what = c.percent ? `${c.percent}% off` : `$${((c.amountCents ?? 0) / 100).toFixed(2)} off`;
  const on = 'all' in c.appliesTo ? 'the whole charge' : c.appliesTo.categories.join(', ');
  const until = c.endsAt ? ` Until ${day(c.endsAt)}.` : '';
  return { code: c.code, ok: true, ...(c.percent ? { percent: c.percent } : {}), says: `${what} ${on}, before tax.${until}${c.oncePerCustomer ? ' Once per customer.' : ''}` };
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');

/** The split's parts, from the order's tenders: what's paid, and a declined card as the reference draws it. */
export function legsFromTenders(tenders: Tender[]): Leg[] {
  return tenders
    .filter((t) => t.status !== 'cancelled' && t.status !== 'pending')
    .map((t) => ({
      method: t.method,
      amountCents: t.amountCents,
      state: t.status === 'declined' ? 'declined' : 'paid',
      det:
        t.status === 'declined'
          ? `${t.cardLast4 ? `${cardName(t)} · ` : ''}the bank declined it`
          : t.method === 'cash'
            ? `${clock(t.createdAt)} · ${t.changeCents ? `$${(t.changeCents / 100).toFixed(2)} change` : 'no change'}`
            : t.method === 'card'
              ? `${clock(t.createdAt)} · ${cardName(t)}`
              : `${clock(t.createdAt)} · approved`,
    }));
}

/** "Visa ending 4242" */
export const cardName = (t: Pick<Tender, 'cardBrand' | 'cardLast4'>) =>
  t.cardLast4 ? `${t.cardBrand ? t.cardBrand[0]!.toUpperCase() + t.cardBrand.slice(1) : 'Card'} ending ${t.cardLast4}` : 'Card';

/** Nothing on it took money: it can be discarded (its hold released) rather than voided. */
export const nothingTaken = (tenders: Tender[]) => tenders.every((t) => t.status === 'declined' || t.status === 'cancelled');

/** A retry key for one attempt at one payment. */
export const payKey = () => `tender-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** A catalogue item as New Charge's lists, tiles and options sheet draw it. */
export function chargeItemFrom(c: CatalogItem): Item {
  const free = c.stock ? Math.max(0, c.stock.free) : null;
  return {
    id: c.id,
    name: c.name,
    detail: c.detail ?? '',
    category: c.category,
    thumb: !c.stockTracked ? 'service' : c.category === 'Tires' ? 'tire' : 'part',
    priceCents: c.priceCents,
    tax: c.taxKind,
    ...(c.stock && free !== null ? { stock: { free, ...(c.stock.held ? { held: c.stock.held } : {}), ...(c.reorderAt !== null && c.stock.onHand <= c.reorderAt ? { low: true } : {}) } } : {}),
    ...(c.optionGroups.length
      ? { options: c.optionGroups.map((g) => ({ id: g.id, name: g.name, rule: g.rule, required: g.required, choices: g.options.map((o) => ({ id: o.id, name: o.name, deltaCents: o.deltaCents })) })) }
      : {}),
  };
}

/** The options picked on a line, as ids for the order; a "None" choice is no option at all. */
export function pickedOptionIds(item: Item, picked: Record<string, string[]>): string[] {
  return (item.options ?? []).flatMap((g) => (picked[g.id] ?? []).filter((id) => {
    const c = g.choices.find((x) => x.id === id);
    return c && !(c.deltaCents === 0 && /^none$/i.test(c.name)) && id !== 'none';
  }));
}
