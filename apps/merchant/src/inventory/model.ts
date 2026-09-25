import type { OptionGroup, TaxKind } from '@/charge/model';

/**
 * Inventory, as data — docs/merchant-reference/clear-merchant-inventory.html.
 *
 * Stock is a count, not bookkeeping: on the shelf, held for waiting charges, free to sell, and
 * the reorder line. Services keep no stock. There is no catalog API yet (card-processing prompt,
 * Phase 2), so a live shop has an empty inventory and this module's scenario is what the
 * preview shows.
 */

export type ItemKind = 'tire' | 'brake' | 'part' | 'service';

export interface HistoryEntry {
  /** "Today, 2:26pm", "Sep 19" */
  when: string;
  /** "Held for Nina P.'s charge", "Sold · Marcus T. · Jen" */
  what: string;
  /** "−2", "+8", "8 due" */
  q: string;
  tone?: 'held' | 'in' | 'oo';
}

export interface InvItem {
  id: string;
  name: string;
  /** "225/65R17 · all-season" */
  detail: string;
  category: 'Tires' | 'Brakes' | 'Parts' | 'Services';
  kind: ItemKind;
  priceCents: number;
  /** What the shop pays. Owners and managers only. */
  costCents?: number;
  tax: TaxKind;
  /** Absent for services, which keep no stock. */
  stock?: { shelf: number; held: number; reorderAt: number; onOrder?: number; supplier?: string; due?: string };
  /** "Per tire", "Per visit" */
  per?: string;
  soldThisMonth?: { n: number; cents: number };
  options?: OptionGroup[];
  history?: HistoryEntry[];
  goesWith?: string;
}

export type StockLevel = 'ok' | 'low' | 'out' | 'svc';

export function level(i: InvItem): StockLevel {
  if (!i.stock) return 'svc';
  if (i.stock.shelf <= 0) return 'out';
  return i.stock.shelf <= i.stock.reorderAt ? 'low' : 'ok';
}

export const free = (i: InvItem) => (i.stock ? Math.max(0, i.stock.shelf - i.stock.held) : 0);

const tireOptions: OptionGroup[] = [
  {
    id: 'warranty',
    name: 'Road hazard warranty',
    rule: 'one',
    required: false,
    choices: [
      { id: 'none', name: 'None', deltaCents: 0 },
      { id: '3y', name: '3-year', deltaCents: 2200 },
      { id: '5y', name: '5-year', deltaCents: 3400 },
    ],
  },
  {
    id: 'extras',
    name: 'Extras',
    rule: 'any',
    required: false,
    choices: [
      { id: 'disposal', name: 'Old tire disposal', deltaCents: 300 },
      { id: 'nitrogen', name: 'Nitrogen fill', deltaCents: 500 },
    ],
  },
];

/** Mike's Tire, as the Inventory reference stocks it. */
export const INVENTORY: InvItem[] = [
  { id: 'michelin', name: 'Michelin Defender2', detail: '225/65R17 · all-season', category: 'Tires', kind: 'tire', priceCents: 18900, tax: 'goods', stock: { shelf: 14, held: 0, reorderAt: 8 }, per: 'Per tire', options: tireOptions },
  {
    id: 'goodyear',
    name: 'Goodyear Assurance',
    detail: '215/55R17 · all-season',
    category: 'Tires',
    kind: 'tire',
    priceCents: 16200,
    costCents: 11800,
    tax: 'goods',
    stock: { shelf: 6, held: 2, reorderAt: 8 },
    per: 'Per tire',
    soldThisMonth: { n: 8, cents: 129600 },
    options: tireOptions,
    goesWith: 'Mount and balance, valve stems',
    history: [
      { when: 'Today, 2:26pm', what: 'Held for Nina P.’s charge', q: '−2', tone: 'held' },
      { when: 'Today, 11:02am', what: 'Sold · Marcus T. · Jen', q: '−2' },
      { when: 'Sep 19', what: 'Received · 8 from the distributor', q: '+8', tone: 'in' },
      { when: 'Sep 15', what: 'Sold · Ray C. · Luis', q: '−4' },
      { when: 'Sep 8', what: 'Counted · was 5, found 6', q: '+1', tone: 'in' },
    ],
  },
  { id: 'continental', name: 'Continental CrossContact LX25', detail: '245/60R18 · touring', category: 'Tires', kind: 'tire', priceCents: 21400, tax: 'goods', stock: { shelf: 22, held: 0, reorderAt: 8 }, per: 'Per tire', options: tireOptions },
  { id: 'blizzak', name: 'Bridgestone Blizzak WS90', detail: '205/55R16 · winter', category: 'Tires', kind: 'tire', priceCents: 14800, tax: 'goods', stock: { shelf: 0, held: 0, reorderAt: 4 }, per: 'Per tire', soldThisMonth: { n: 11, cents: 0 } },
  { id: 'pads', name: 'Ceramic brake pads, front', detail: 'Most sedans and small SUVs', category: 'Brakes', kind: 'brake', priceCents: 8900, tax: 'goods', stock: { shelf: 18, held: 0, reorderAt: 6 } },
  { id: 'rotor', name: 'Brake rotor, front', detail: 'Standard, vented', category: 'Brakes', kind: 'brake', priceCents: 7400, tax: 'goods', stock: { shelf: 3, held: 0, reorderAt: 6 } },
  { id: 'tpms', name: 'TPMS sensor', detail: 'Programmable, 315/433 MHz', category: 'Parts', kind: 'part', priceCents: 5800, tax: 'goods', stock: { shelf: 11, held: 0, reorderAt: 4 } },
  { id: 'valves', name: 'Valve stems, set of 4', detail: 'Rubber snap-in', category: 'Parts', kind: 'part', priceCents: 1200, tax: 'goods', stock: { shelf: 40, held: 0, reorderAt: 10 } },
  { id: 'mount', name: 'Mount and balance', detail: 'Per tire', category: 'Services', kind: 'service', priceCents: 2500, tax: 'labour' },
  { id: 'alignment', name: 'Four-wheel alignment', detail: 'Includes printout', category: 'Services', kind: 'service', priceCents: 11900, tax: 'labour' },
  { id: 'brakejob', name: 'Brake job, per axle', detail: 'Labour, parts extra', category: 'Services', kind: 'service', priceCents: 14000, tax: 'labour' },
];

/** The shelf at cost, for the owner's note. The reference states it: $7,308.00. */
export const SHELF_AT_COST_CENTS = 730800;

/** The Goodyear order, once marked reordered. */
export const GOODYEAR_ON_ORDER: InvItem = {
  ...INVENTORY[1],
  stock: { ...INVENTORY[1].stock!, onOrder: 8, supplier: 'Western Tire Supply', due: 'Sat, Sep 26' },
  history: [
    { when: 'Today, 4:10pm', what: 'Reordered · 8 from Western Tire Supply · Mike', q: '8 due', tone: 'oo' },
    ...INVENTORY[1].history!,
  ],
};

export const TAX_LABEL: Record<TaxKind, string> = {
  goods: 'Taxable goods',
  labour: 'Labour, not taxed',
  food: 'Prepared food',
  exempt: 'Exempt',
};
