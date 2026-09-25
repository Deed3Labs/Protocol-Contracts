import { dollars } from '@clear/domain';

/**
 * New Charge, as data: the catalog, the cart and its arithmetic.
 *
 * Drawn from docs/merchant-reference/clear-merchant-new-charge.html. Money is integer cents
 * throughout. Tax, discounts and stock are decided by the server once the backend exists
 * (card-processing prompt, Phase 6); until then this arithmetic is what the preview shows, and it
 * reproduces the reference's own figures ($927.52, FALL10 to $834.77).
 */

export const usd = (cents: number) => dollars(cents / 100);

export type TaxKind = 'goods' | 'labour' | 'food' | 'exempt';
export type Thumb = 'tire' | 'service' | 'part' | 'food';

export interface OptionChoice {
  id: string;
  name: string;
  deltaCents: number;
}

export interface OptionGroup {
  id: string;
  name: string;
  /** Pick one, or pick any. */
  rule: 'one' | 'any';
  required: boolean;
  choices: OptionChoice[];
}

export interface Item {
  id: string;
  name: string;
  /** "225/65R17", "Per tire" */
  detail: string;
  category: string;
  thumb: Thumb;
  priceCents: number;
  tax: TaxKind;
  /** Absent when stock is not tracked (labour). */
  stock?: { free: number; held?: number; low?: boolean };
  options?: OptionGroup[];
  /** Tile name when the full name is too long for a tile. */
  short?: string;
}

export interface CartLine {
  key: string;
  itemId?: string;
  /** "Michelin Defender2", or a quick sale's note. */
  name: string;
  /** "al pastor, guac": the options chosen, for the line. */
  chosen?: string;
  qty: number;
  unitCents: number;
  tax: TaxKind;
  hasOptions?: boolean;
}

export interface Discount {
  /** "FALL10 · 10% off", or "15% · Returning customer" */
  label: string;
  percent?: number;
  amountCents?: number;
}

export const TAX_RATE = 0.0775;

export interface Totals {
  count: number;
  goodsCents: number;
  labourCents: number;
  foodCents: number;
  exemptCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * The cart's totals. A discount comes off before tax, spread across the lines by value, so tax is
 * worked out on the discounted goods: FALL10 on $768.00 of parts and $100.00 of labour leaves
 * $691.20 and $90.00, with $53.57 of tax on the parts.
 */
export function totals(lines: CartLine[], discount?: Discount | null): Totals {
  const sum = (k: TaxKind) => lines.filter((l) => l.tax === k).reduce((s, l) => s + l.qty * l.unitCents, 0);
  const goods = sum('goods');
  const labour = sum('labour');
  const food = sum('food');
  const exempt = sum('exempt');
  const gross = goods + labour + food + exempt;
  const off = discount
    ? Math.min(gross, discount.percent !== undefined ? Math.round((gross * discount.percent) / 100) : (discount.amountCents ?? 0))
    : 0;
  const keep = gross ? (gross - off) / gross : 1;
  const g = Math.round(goods * keep);
  const l = Math.round(labour * keep);
  const f = Math.round(food * keep);
  const e = gross - off - g - l - f;
  const tax = Math.round((g + f) * TAX_RATE);
  return {
    count: lines.reduce((s, x) => s + x.qty, 0),
    goodsCents: g,
    labourCents: l,
    foodCents: f,
    exemptCents: e,
    discountCents: off,
    taxCents: tax,
    totalCents: g + l + f + e + tax,
  };
}

/** A line's price with its options: the base plus what each choice adds. */
export function unitPrice(item: Item, picked: Record<string, string[]>): number {
  const extra = (item.options ?? []).reduce(
    (s, g) => s + (picked[g.id] ?? []).reduce((t, id) => t + (g.choices.find((c) => c.id === id)?.deltaCents ?? 0), 0),
    0,
  );
  return item.priceCents + extra;
}

/** The first required group with nothing picked, which the Add button names instead. */
export function missingGroup(item: Item, picked: Record<string, string[]>): OptionGroup | undefined {
  return (item.options ?? []).find((g) => g.required && !(picked[g.id] ?? []).length);
}

export function itemCount(n: number) {
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

// ---- The reference scenario -------------------------------------------------------------------

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
export const CATALOG: Item[] = [
  { id: 'michelin', name: 'Michelin Defender2', detail: '225/65R17', category: 'Tires', thumb: 'tire', priceCents: 18900, tax: 'goods', stock: { free: 14 }, options: tireOptions },
  { id: 'goodyear', name: 'Goodyear Assurance', detail: '215/55R17', category: 'Tires', thumb: 'tire', priceCents: 16200, tax: 'goods', stock: { free: 4, held: 2, low: true }, options: tireOptions },
  { id: 'continental', name: 'Continental CrossContact LX25', short: 'Continental CrossContact', detail: '245/60R18', category: 'Tires', thumb: 'tire', priceCents: 21400, tax: 'goods', stock: { free: 22 }, options: tireOptions },
  { id: 'blizzak', name: 'Bridgestone Blizzak WS90', detail: '205/55R16', category: 'Tires', thumb: 'tire', priceCents: 14800, tax: 'goods', stock: { free: 0 } },
  { id: 'mount', name: 'Mount and balance', detail: 'Per tire', category: 'Services', thumb: 'service', priceCents: 2500, tax: 'labour' },
  { id: 'alignment', name: 'Four-wheel alignment', detail: 'Includes printout', category: 'Services', thumb: 'service', priceCents: 11900, tax: 'labour' },
  { id: 'brakes', name: 'Brake job, per axle', detail: 'Labour', category: 'Services', thumb: 'service', priceCents: 14000, tax: 'labour' },
  { id: 'tpms', name: 'TPMS sensor', detail: '315/433 MHz', category: 'Parts', thumb: 'part', priceCents: 5800, tax: 'goods', stock: { free: 11 } },
  { id: 'valves', name: 'Valve stems, set of 4', detail: 'Rubber snap-in', category: 'Parts', thumb: 'part', priceCents: 1200, tax: 'goods', stock: { free: 40 } },
];

const byId = (id: string) => CATALOG.find((i) => i.id === id)!;
export const lineOf = (id: string, qty: number): CartLine => {
  const it = byId(id);
  return { key: id, itemId: id, name: it.name, qty, unitCents: it.priceCents, tax: it.tax, hasOptions: !!it.options };
};

/** The reference cart: four Michelins, four mount and balance, one set of valve stems. */
export const REFERENCE_CART: CartLine[] = [lineOf('michelin', 4), lineOf('mount', 4), lineOf('valves', 1)];

export const FALL10: Discount = { label: 'FALL10 · 10% off', percent: 10 };

/** "Another kind of shop": the reference's food truck, for the tiles and their options. */
export const FOOD: Item[] = [
  {
    id: 'tacos',
    name: 'Street tacos, 3',
    detail: '',
    category: 'Food',
    thumb: 'food',
    priceCents: 900,
    tax: 'food',
    options: [
      {
        id: 'protein',
        name: 'Protein',
        rule: 'one',
        required: true,
        choices: [
          { id: 'asada', name: 'Asada', deltaCents: 0 },
          { id: 'pollo', name: 'Pollo', deltaCents: 0 },
          { id: 'pastor', name: 'Al pastor', deltaCents: 100 },
          { id: 'veggie', name: 'Veggie', deltaCents: 0 },
        ],
      },
      {
        id: 'addons',
        name: 'Add-ons',
        rule: 'any',
        required: false,
        choices: [
          { id: 'guac', name: 'Guacamole', deltaCents: 100 },
          { id: 'cheese', name: 'Cheese', deltaCents: 50 },
        ],
      },
      {
        id: 'make',
        name: 'Make it',
        rule: 'any',
        required: false,
        choices: [
          { id: 'noonion', name: 'No onions', deltaCents: 0 },
          { id: 'nocilantro', name: 'No cilantro', deltaCents: 0 },
          { id: 'spicy', name: 'Extra spicy', deltaCents: 0 },
        ],
      },
    ],
  },
  {
    id: 'burrito',
    name: 'Burrito',
    detail: '',
    category: 'Food',
    thumb: 'food',
    priceCents: 1200,
    tax: 'food',
    options: [
      {
        id: 'protein',
        name: 'Protein',
        rule: 'one',
        required: true,
        choices: [
          { id: 'asada', name: 'Asada', deltaCents: 0 },
          { id: 'pollo', name: 'Pollo', deltaCents: 0 },
          { id: 'pastor', name: 'Al pastor', deltaCents: 100 },
          { id: 'veggie', name: 'Veggie', deltaCents: 0 },
        ],
      },
    ],
  },
  { id: 'quesadilla', name: 'Quesadilla', detail: '', category: 'Food', thumb: 'food', priceCents: 1000, tax: 'food', options: [] },
  { id: 'chips', name: 'Chips and salsa', detail: '', category: 'Food', thumb: 'food', priceCents: 500, tax: 'food' },
  { id: 'horchata', name: 'Horchata', detail: '', category: 'Drinks', thumb: 'food', priceCents: 400, tax: 'food' },
  { id: 'agua', name: 'Agua fresca', detail: '', category: 'Drinks', thumb: 'food', priceCents: 400, tax: 'food' },
  { id: 'churros', name: 'Churros', detail: '', category: 'Sweet', thumb: 'food', priceCents: 500, tax: 'food' },
];

/** Mike's Tire's tile layout, as the reference draws All. */
export const TILE_ORDER = ['michelin', 'goodyear', 'continental', 'mount', 'alignment', 'valves', 'tpms'];

/** The food truck's order 47, for "Sam". */
export const FOOD_ORDER: CartLine[] = [
  { key: 'tacos', itemId: 'tacos', name: 'Street tacos, 3', chosen: 'al pastor, guac', qty: 2, unitCents: 1100, tax: 'food', hasOptions: true },
  { key: 'chips', itemId: 'chips', name: 'Chips and salsa', qty: 1, unitCents: 500, tax: 'food' },
  { key: 'agua', itemId: 'agua', name: 'Agua fresca', chosen: 'jamaica', qty: 2, unitCents: 400, tax: 'food', hasOptions: true },
];
