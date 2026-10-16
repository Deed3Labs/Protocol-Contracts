import type { CatalogItem } from '@clear/merchant-contracts';

/** New charge › Send a link: what the sheet holds and what it sends (pay spec §5). */

export type LinkFor = 'amount' | 'item';
export type LinkExpiry = 'never' | '7d' | '30d';

export interface LinkDraft {
  for: LinkFor;
  /** Dollars as typed: "25.00". */
  amount: string;
  itemId: string | null;
  quantity: number;
  note: string;
  expires: LinkExpiry;
  allowOverTime: boolean;
}

export const BLANK_LINK: LinkDraft = { for: 'item', amount: '', itemId: null, quantity: 1, note: '', expires: '7d', allowOverTime: true };

export const EXPIRES_DET: Record<LinkExpiry, string> = { never: 'Never', '7d': 'In 7 days', '30d': 'In 30 days' };

/** "25", "25.5", "$25.00" → 2500; anything else is null. */
export function centsOf(typed: string): number | null {
  const t = typed.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

/** What the sheet sends, or why it can't yet. */
export function linkRequest(d: LinkDraft):
  | { ok: true; request: { for: 'amount'; amountCents: number; note: string | null; expires: LinkExpiry; allowOverTime: boolean } | { for: 'item'; itemId: string; quantity: number; note: string | null; expires: LinkExpiry; allowOverTime: boolean } }
  | { ok: false } {
  const note = d.note.trim() || null;
  const common = { note, expires: d.expires, allowOverTime: d.allowOverTime };
  if (d.for === 'item') return d.itemId && d.quantity >= 1 && d.quantity <= 99 ? { ok: true, request: { for: 'item', itemId: d.itemId, quantity: d.quantity, ...common } } : { ok: false };
  const cents = centsOf(d.amount);
  return cents !== null && cents >= 50 ? { ok: true, request: { for: 'amount', amountCents: cents, ...common } } : { ok: false };
}

/** The address as the drawing shows it: no scheme. */
export const linkLabel = (url: string) => url.replace(/^https?:\/\//, '');

/** Items a link can be: on sale, with no options to choose. */
export const linkable = (items: CatalogItem[]) => items.filter((i) => !i.archivedAt && !i.optionGroups.some((g) => g.required));
