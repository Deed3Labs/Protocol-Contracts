import type { Queryable } from '../../db/db.js';

/*
 * What goes into a product (docs/command-center-plan.md, Phase 10): the shop's costing engine.
 *
 * A product's cost is the sum of its recipe's lines, each an input from one library. A line is
 * entered either way, and the other is worked out: an amount used ("12 ml") gives its cost from the
 * input's unit cost, and a cost per product ("$5.20 of embroidery") gives the amount. Any colour or
 * size can override a line. A product with no recipe yet keeps its four cost boxes.
 *
 * The redesign (docs/ui-redesign-plan.md, decision 4): a stocked input's unit cost is the average of
 * what's on hand, its last price paid kept beside it; an input can cost more in some sizes or colours
 * (its extras); and a product can be costed at one flat cost instead, which wins over its recipe.
 *
 * Money is cents throughout, with the fractions kept (1 ml at $0.0425 is 4.25¢): rounding to whole
 * cents happens only where money is shown (the payload) or stored on an order (shop_order_costs).
 *
 * The functions up top are pure; the readers below load the few small tables they work on.
 */

export type InputKind = 'material' | 'service' | 'labour';

export interface Input {
  id: string;
  name: string;
  kind: InputKind;
  unit: string;
  stocked: boolean;
  /** As set or as the latest purchase set it; null when not known yet. */
  unitCostCents: number | null;
  lowMark: number | null;
  note: string;
  archived: boolean;
  lastPurchase: { at: number; quantity: number; totalCents: number; supplier: string } | null;
  /** Once per order: packing for the whole order, not each item. */
  perOrder?: boolean;
  /** A once-per-order input used on a pickup too (tissue), not only on a shipped order. */
  onPickup?: boolean;
  supplierId?: string | null;
  /** The last price paid a unit; unitCostCents is the average for a stocked input. */
  lastCostCents?: number | null;
  /** What a size or a colour adds to one unit. */
  extras?: Extra[];
}

/** One size's or one colour's extra on an input: the other is ''. */
export interface Extra {
  option: string;
  size: string;
  cents: number;
}

/** The reference's three kinds: kept on hand, made to order, once per order. */
export type InputType = 'stock' | 'mto' | 'order';
export const inputType = (i: Pick<Input, 'stocked' | 'perOrder'>): InputType => (i.perOrder ? 'order' : i.stocked ? 'stock' : 'mto');

/** What was typed for a line or an override: an amount, a cost, or (amount wins) both. */
export interface Entered {
  amount: number | null;
  costCents: number | null;
  /** Which side was typed: a cost typed is kept with its amount once the input has a unit cost. */
  entered?: 'amount' | 'cost';
}
export interface Line extends Entered {
  productId: string;
  inputId: string;
  position: number;
}
export interface Override extends Entered {
  productId: string;
  inputId: string;
  /** '' is any colour. */
  option: string;
  /** '' is any size. */
  size: string;
}
export interface Variant {
  option: string;
  size: string;
}
export interface Product {
  id: string;
  priceCents: number;
  /** The four boxes: blank or base, making, label, packing. Null for a deposit. */
  boxes: number[] | null;
  deposit: boolean;
  /** One flat cost instead of materials: set, it's the product's cost. */
  flatCents?: number | null;
  flatEstimate?: boolean;
  flatNote?: string;
}
/** A colour's or size's own flat cost ('' is any). */
export interface FlatOverride {
  option: string;
  size: string;
  costCents: number;
}

/** Everything the engine reads, loaded once a request. */
export interface Book {
  inputs: Map<string, Input>;
  products: Map<string, Product>;
  /** Each product's lines, in order. */
  lines: Map<string, Line[]>;
  overrides: Map<string, Override[]>;
  /** Each product's colours and sizes, as its stock lists them. */
  variants: Map<string, Variant[]>;
  /** Stocked inputs' on hand, from the ledger. */
  onHand: Map<string, number>;
  /** Each flat-costed product's colour and size costs. */
  flatOverrides?: Map<string, FlatOverride[]>;
}

// ── the arithmetic ──────────────────────────────────────────────────────────

/** A purchase's unit cost: what was paid over how much came ($164 for 20 is 820¢ each). */
export const purchaseUnitCost = (totalCents: number, quantity: number) => totalCents / quantity;

/** An input's unit cost: as set, else from its latest purchase, else not known (null). */
export function unitCostOf(i: Pick<Input, 'unitCostCents' | 'lastPurchase'>): number | null {
  if (i.unitCostCents != null) return i.unitCostCents;
  return i.lastPurchase ? purchaseUnitCost(i.lastPurchase.totalCents, i.lastPurchase.quantity) : null;
}

/**
 * The average after a buy is received: what's on hand at the old average, plus what was paid, over the
 * new total. With nothing on hand (or less, after a run made short), or no average yet, it's the price paid.
 */
export function averageAfter(onHand: number, avgCents: number | null, quantity: number, paidCents: number): number {
  if (onHand <= 1e-9 || avgCents == null) return paidCents / quantity;
  return (onHand * avgCents + paidCents) / (onHand + quantity);
}

/** The last price paid a unit: as stored, else from the latest purchase. */
export function lastPaidOf(i: Pick<Input, 'lastCostCents' | 'lastPurchase'>): number | null {
  if (i.lastCostCents != null) return i.lastCostCents;
  return i.lastPurchase ? purchaseUnitCost(i.lastPurchase.totalCents, i.lastPurchase.quantity) : null;
}

/** What a colour and size add to one unit of an input: its size's extra plus its colour's. */
export function extraFor(i: Pick<Input, 'extras'> | undefined, v: Variant | null): number {
  if (!v || !i?.extras?.length) return 0;
  return i.extras.reduce((a, x) => a + ((x.size !== '' && x.size === v.size) || (x.option !== '' && x.option === v.option) ? x.cents : 0), 0);
}

/** A line worked out: both sides, which one was typed, and why a side is missing. */
export interface Worked {
  amount: number | null;
  costCents: number;
  entered: 'amount' | 'cost';
  /** The cost as it was typed, when it was typed as a cost: what the editor shows as "entered as". */
  typedCents?: number;
  note?: string;
}

/**
 * One line, from whichever side was typed. An amount gives amount × unit cost (an input with no
 * unit cost yet costs nothing, and says so). A cost gives cost ÷ unit cost, which a zero or unknown
 * unit cost can't: the amount is null, with the reason.
 */
export function workLine(e: Entered, unitCostCents: number | null): Worked {
  const typed = e.entered === 'cost' || (e.amount == null && e.costCents != null) ? { typedCents: e.costCents ?? 0 } : {};
  if (e.amount != null) return { amount: e.amount, costCents: e.amount * (unitCostCents ?? 0), entered: e.entered ?? 'amount', ...typed, ...(unitCostCents == null ? { note: 'No unit cost yet' } : {}) };
  const cost = e.costCents ?? 0;
  if (unitCostCents == null) return { amount: null, costCents: cost, entered: 'cost', ...typed, note: 'No unit cost yet, so the amount is worked out once it has one' };
  if (!unitCostCents) return { amount: null, costCents: cost, entered: 'cost', ...typed, note: 'The unit cost is zero, so the amount can’t be worked out' };
  return { amount: cost / unitCostCents, costCents: cost, entered: 'cost', ...typed };
}

/** The override for a colour and size, if any: colour and size, then size alone, then colour alone. */
export function overrideFor(list: Override[], inputId: string, v: Variant | null): Override | undefined {
  if (!v) return undefined;
  const mine = list.filter((o) => o.inputId === inputId);
  return (
    mine.find((o) => o.option !== '' && o.size !== '' && o.option === v.option && o.size === v.size) ??
    mine.find((o) => o.option === '' && o.size !== '' && o.size === v.size) ??
    mine.find((o) => o.option !== '' && o.size === '' && o.option === v.option)
  );
}

export interface CostedLine extends Worked {
  inputId: string;
  /** Whether a colour's or size's override set it. */
  override: boolean;
  /** What the input's extras added for this colour and size, in all (unrounded). */
  extraCents?: number;
}
export interface Costed {
  /** Unrounded. */
  costCents: number;
  lines: CostedLine[];
}

/**
 * A recipe's cost for a colour and size (null: the recipe as written), line by line. A product's
 * override of a line wins; otherwise the input's extras for that colour and size are added to each unit
 * (a line with no amount yet has no units to add them to).
 */
export function costRecipe(lines: Line[], overrides: Override[], inputs: Map<string, Input>, v: Variant | null = null): Costed {
  const out = lines.map((l): CostedLine => {
    const o = overrideFor(overrides, l.inputId, v);
    const input = inputs.get(l.inputId);
    const w = workLine(o ?? l, input ? unitCostOf(input) : null);
    const extra = o || w.amount == null ? 0 : w.amount * extraFor(input, v);
    return { inputId: l.inputId, override: !!o, ...w, ...(extra ? { costCents: w.costCents + extra, extraCents: extra } : {}) };
  });
  return { costCents: out.reduce((a, l) => a + l.costCents, 0), lines: out };
}

export type CostSource = 'recipe' | 'boxes' | 'flat' | 'none';

/** A flat-costed product's cost for a colour and size: colour and size, then size, then colour, then the flat cost. */
export function flatFor(flatCents: number, list: FlatOverride[], v: Variant | null): number {
  if (!v) return flatCents;
  const o =
    list.find((x) => x.option !== '' && x.size !== '' && x.option === v.option && x.size === v.size) ??
    list.find((x) => x.option === '' && x.size !== '' && x.size === v.size) ??
    list.find((x) => x.option !== '' && x.size === '' && x.option === v.option);
  return o ? o.costCents : flatCents;
}

/**
 * A product's cost: its flat cost when one is set (with the variant's own), else its recipe's, with the
 * variant's overrides and extras, or with no recipe the sum of its four boxes, so nothing changes until
 * a recipe is filled in. A deposit with none of them has 'none'.
 */
export function productCost(book: Book, productId: string, v: Variant | null = null): Costed & { source: CostSource } {
  const flat = book.products.get(productId)?.flatCents;
  if (flat != null) return { costCents: flatFor(flat, book.flatOverrides?.get(productId) ?? [], v), lines: [], source: 'flat' };
  const lines = book.lines.get(productId) ?? [];
  if (lines.length) return { ...costRecipe(lines, book.overrides.get(productId) ?? [], book.inputs, v), source: 'recipe' };
  const boxes = book.products.get(productId)?.boxes;
  return boxes ? { costCents: boxes.reduce((a, b) => a + b, 0), lines: [], source: 'boxes' } : { costCents: 0, lines: [], source: 'none' };
}

/** Price less cost, and that as a share of the price (null for a free product). */
export function margin(priceCents: number, costCents: number): { cents: number; share: number | null } {
  return { cents: priceCents - costCents, share: priceCents > 0 ? (priceCents - costCents) / priceCents : null };
}

/** On hand per input: the sum of its moves. */
export function onHandFrom(moves: Array<{ inputId: string; quantity: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of moves) m.set(x.inputId, (m.get(x.inputId) ?? 0) + x.quantity);
  return m;
}

/** Floors a count made from fractions (0.3 ÷ 0.1 is 2.9999…), without letting a real shortfall round up. */
const floorCount = (x: number) => Math.max(0, Math.floor(x + 1e-9));

/**
 * How many units the stocked inputs on hand would make, and the one that runs out first. Null units
 * when the recipe uses no stocked input (nothing on hand limits it). A stocked line whose amount
 * can't be worked out is listed, not guessed.
 */
export function canMake(c: Costed, inputs: Map<string, Input>, onHand: Map<string, number>): { units: number | null; binding: string | null; unknown: string[] } {
  let units: number | null = null,
    binding: string | null = null;
  const unknown: string[] = [];
  for (const l of c.lines) {
    if (!inputs.get(l.inputId)?.stocked) continue;
    if (l.amount == null) {
      unknown.push(l.inputId);
      continue;
    }
    const n = floorCount((onHand.get(l.inputId) ?? 0) / l.amount);
    if (units == null || n < units) [units, binding] = [n, l.inputId];
  }
  return { units, binding, unknown };
}

/** What a run of `units` uses of each stocked input, by the recipe as costed for its colour and size. */
export function runUses(c: Costed, inputs: Map<string, Input>, units: number): { uses: Array<{ inputId: string; quantity: number }>; unknown: string[] } {
  const uses: Array<{ inputId: string; quantity: number }> = [];
  const unknown: string[] = [];
  for (const l of c.lines) {
    if (!inputs.get(l.inputId)?.stocked) continue;
    if (l.amount == null) unknown.push(l.inputId);
    else uses.push({ inputId: l.inputId, quantity: l.amount * units });
  }
  return { uses, unknown };
}

/** Whole cents, for showing or storing on an order. */
export const roundCents = (c: number) => Math.round(c);
/** Dollars to the cent, as the payload shows money. */
export const shown = (c: number) => Math.round(c) / 100;

// ── the readers ─────────────────────────────────────────────────────────────

const num = (v: unknown) => (v == null ? null : Number(v));
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);

/** The library, the recipes, the products' prices and boxes, their variants and what's on hand. */
export async function readBook(db: Queryable): Promise<Book> {
  const [inputs, products, lines, overrides, variants, moves, extras, flats] = await Promise.all([
    // the latest purchase received: one ordered or cancelled isn't a price paid
    db.query<any>(
      `SELECT i.*, p.at AS p_at, p.quantity AS p_quantity, p.total_cents AS p_total, p.supplier AS p_supplier
       FROM command.shop_inputs i
       LEFT JOIN LATERAL (SELECT * FROM command.shop_input_purchases x WHERE x.input_id = i.id AND x.state = 'received' ORDER BY coalesce(x.received_at, x.at) DESC, x.id DESC LIMIT 1) p ON true
       ORDER BY i.archived_at IS NOT NULL, i.name`,
    ),
    db.query<any>('SELECT id, price_cents, cost_cents, deposit, flat_cost_cents, cost_estimate, cost_note FROM command.shop_products ORDER BY position'),
    db.query<any>('SELECT * FROM command.shop_recipe_lines ORDER BY product_id, position, input_id'),
    db.query<any>('SELECT * FROM command.shop_recipe_overrides ORDER BY product_id, input_id, option, size'),
    db.query<any>('SELECT product_id, option, size FROM command.shop_stock ORDER BY product_id, option_pos, size_pos'),
    db.query<any>('SELECT input_id, sum(quantity) AS quantity FROM command.shop_input_moves GROUP BY input_id'),
    db.query<any>('SELECT * FROM command.shop_input_extras ORDER BY input_id, size, option'),
    db.query<any>('SELECT * FROM command.shop_flat_overrides ORDER BY product_id, option, size'),
  ]);
  const book: Book = { inputs: new Map(), products: new Map(), lines: new Map(), overrides: new Map(), variants: new Map(), onHand: new Map(), flatOverrides: new Map() };
  const extrasOf = new Map<string, Extra[]>();
  for (const r of extras.rows) push(extrasOf, r.input_id, { option: r.option, size: r.size, cents: Number(r.extra_cents) });
  for (const r of inputs.rows)
    book.inputs.set(r.id, {
      id: r.id,
      name: r.name,
      kind: r.kind,
      unit: r.unit,
      stocked: r.stocked,
      unitCostCents: num(r.unit_cost_cents),
      lowMark: num(r.low_mark),
      note: r.note,
      archived: r.archived_at != null,
      lastPurchase: r.p_at == null ? null : { at: new Date(r.p_at).getTime(), quantity: Number(r.p_quantity), totalCents: Number(r.p_total), supplier: r.p_supplier },
      perOrder: r.per_order,
      onPickup: r.on_pickup,
      supplierId: r.supplier_id ?? null,
      lastCostCents: num(r.last_cost_cents),
      extras: extrasOf.get(r.id) ?? [],
    });
  for (const r of products.rows)
    book.products.set(r.id, {
      id: r.id,
      priceCents: r.price_cents,
      boxes: r.cost_cents ? r.cost_cents.map(Number) : null,
      deposit: r.deposit,
      flatCents: num(r.flat_cost_cents),
      flatEstimate: r.cost_estimate,
      flatNote: r.cost_note,
    });
  for (const r of flats.rows) push(book.flatOverrides!, r.product_id, { option: r.option, size: r.size, costCents: Number(r.cost_cents) });
  for (const r of lines.rows) push(book.lines, r.product_id, { productId: r.product_id, inputId: r.input_id, position: r.position, amount: num(r.amount), costCents: num(r.cost_cents), entered: r.entered });
  for (const r of overrides.rows)
    push(book.overrides, r.product_id, { productId: r.product_id, inputId: r.input_id, option: r.option, size: r.size, amount: num(r.amount), costCents: num(r.cost_cents), entered: r.entered });
  for (const r of variants.rows) push(book.variants, r.product_id, { option: r.option, size: r.size });
  for (const r of moves.rows) book.onHand.set(r.input_id, Number(r.quantity));
  return book;
}

/** A purchase as the payload shows it: newest first, the latest 20 an input. */
export interface PurchaseRow {
  at: number;
  quantity: number;
  totalCents: number;
  supplier: string;
  note: string;
}
/** A stock move: + in, − out. `ref` is the purchase or the run it came from. */
export interface MoveRow {
  at: number;
  quantity: number;
  reason: 'purchase' | 'run' | 'adjust' | 'waste' | 'order';
  note: string;
  ref: number | null;
}
/** A production run, with what it used of each stocked input (its 'run' moves). */
export interface RunRow {
  id: number;
  at: number;
  productId: string;
  option: string;
  size: string;
  units: number;
  note: string;
  short: boolean;
  who: string;
  uses: Array<{ inputId: string; quantity: number }>;
  state?: 'planned' | 'done';
  /** Locked when it was made; null for a run from before batches, or one still planned. */
  unitCostCents?: number | null;
  batch?: string | null;
  plannedOn?: number | null;
}
export interface History {
  purchases: Map<string, PurchaseRow[]>;
  moves: Map<string, MoveRow[]>;
  runs: RunRow[];
}
export const HISTORY_CAPS = { purchases: 20, moves: 30, runs: 50 };
export const noHistory = (): History => ({ purchases: new Map(), moves: new Map(), runs: [] });

/**
 * Each input's recent purchases and stock moves, and the recent production runs. A run's uses aren't
 * stored on it: they're its 'run' moves (ref = the run), turned back to positive amounts.
 */
export async function readHistory(db: Queryable): Promise<History> {
  const [purchases, moves, runs] = await Promise.all([
    db.query<any>(
      `SELECT * FROM (SELECT p.*, row_number() OVER (PARTITION BY input_id ORDER BY at DESC, id DESC) AS n FROM command.shop_input_purchases p WHERE state = 'received') x
       WHERE n <= $1 ORDER BY input_id, at DESC, id DESC`,
      [HISTORY_CAPS.purchases],
    ),
    db.query<any>(
      `SELECT * FROM (SELECT m.*, row_number() OVER (PARTITION BY input_id ORDER BY at DESC, id DESC) AS n FROM command.shop_input_moves m) x
       WHERE n <= $1 ORDER BY input_id, at DESC, id DESC`,
      [HISTORY_CAPS.moves],
    ),
    // the runs made, newest first; the planned ones are batches still to make (shopModel.ts)
    db.query<any>(`SELECT * FROM command.shop_runs WHERE state = 'done' ORDER BY at DESC, id DESC LIMIT $1`, [HISTORY_CAPS.runs]),
  ]);
  const h = noHistory();
  for (const r of purchases.rows)
    push(h.purchases, r.input_id, { at: new Date(r.at).getTime(), quantity: Number(r.quantity), totalCents: Number(r.total_cents), supplier: r.supplier, note: r.note });
  for (const r of moves.rows) push(h.moves, r.input_id, { at: new Date(r.at).getTime(), quantity: Number(r.quantity), reason: r.reason, note: r.note, ref: r.ref == null ? null : Number(r.ref) });
  const ids = runs.rows.map((r) => Number(r.id));
  const uses = new Map<number, RunRow['uses']>();
  if (ids.length) {
    // in the order the run wrote them, which is the recipe's
    const { rows } = await db.query<any>(
      `SELECT ref, input_id, -sum(quantity) AS quantity FROM command.shop_input_moves WHERE reason = 'run' AND ref = ANY($1) GROUP BY ref, input_id ORDER BY ref, min(id)`,
      [ids],
    );
    for (const r of rows) push(uses, Number(r.ref), { inputId: r.input_id, quantity: Number(r.quantity) });
  }
  h.runs = runs.rows.map((r) => ({
    id: Number(r.id),
    at: new Date(r.at).getTime(),
    productId: r.product_id,
    option: r.option,
    size: r.size,
    units: r.units,
    note: r.note,
    short: r.short,
    who: r.who,
    uses: uses.get(Number(r.id)) ?? [],
    state: r.state,
    unitCostCents: r.unit_cost_cents,
    batch: r.batch_id,
    plannedOn: r.planned_on ? new Date(r.planned_on).getTime() : null,
  }));
  return h;
}

/**
 * What one order line costs at the moment it sells, in whole cents, for shop_order_costs. Phase 10d
 * calls it at ingest (pass a book read once for a batch of orders). `productId` is Command's id: a
 * live order's items carry the site's slug, which the caller maps first.
 */
export async function orderLineCost(db: Queryable, productId: string, option: string, size: string, book?: Book): Promise<{ unitCostCents: number; source: CostSource }> {
  const b = book ?? (await readBook(db));
  const c = productCost(b, productId, { option, size });
  return { unitCostCents: roundCents(c.costCents), source: c.source };
}

/** A live order's line as shop_orders keeps it: the site's slug, colour, size and quantity. */
type OrderItem = [string, string, string, number];

/**
 * Records what each line of a live order cost (shop_order_costs), for every Stripe order that has no
 * record yet: new orders as the shop feed brings them in, and, once, the orders from before Phase
 * 10d. Those are costed at the recipe as it stands when they're recorded, which their costed_at says.
 * `productOf` maps a line's slug to Command's product id (null when Command has no record of it: that
 * line costs nothing, source 'none'). Each order's lines go in one statement, so an order is costed
 * whole or not at all. Returns how many orders it costed.
 */
export async function costOrders(db: Queryable, productOf: (slug: string) => string | null, book?: Book): Promise<number> {
  const { rows } = await db.query<{ id: string; items: OrderItem[] }>(
    `SELECT o.id, o.items FROM command.shop_orders o
     WHERE o.source = 'stripe' AND NOT EXISTS (SELECT 1 FROM command.shop_order_costs c WHERE c.order_id = o.id)
     ORDER BY o.paid_at`,
  );
  if (!rows.length) return 0;
  const b = book ?? (await readBook(db));
  let costed = 0;
  for (const o of rows) {
    if (!o.items.length) continue;
    const values: unknown[] = [];
    const marks = o.items.map(([slug, option, size], line) => {
      const pid = productOf(slug);
      const c = pid ? productCost(b, pid, { option, size }) : null;
      values.push(o.id, line, pid ?? slug, option, size, c ? roundCents(c.costCents) : 0, c?.source ?? 'none');
      const n = line * 7;
      return `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7})`;
    });
    const r = await db.query(
      `INSERT INTO command.shop_order_costs (order_id, line, product_id, option, size, unit_cost_cents, source) VALUES ${marks.join(', ')} ON CONFLICT (order_id, line) DO NOTHING RETURNING 1`,
      values,
    );
    if (r.rows.length) costed++;
  }
  return costed;
}

/** Each live order's recorded line costs, in cents, by order and line. */
export async function orderCosts(db: Queryable): Promise<Map<string, Map<number, number>>> {
  const { rows } = await db.query<{ order_id: string; line: number; unit_cost_cents: number }>('SELECT order_id, line, unit_cost_cents FROM command.shop_order_costs');
  const m = new Map<string, Map<number, number>>();
  for (const r of rows) (m.get(r.order_id) ?? m.set(r.order_id, new Map()).get(r.order_id)!).set(r.line, r.unit_cost_cents);
  return m;
}

/** One week of a product's cost at sale: the lowest and highest unit cost its sales recorded (sizes can differ). Dollars. */
export interface CostWeek {
  week: number;
  low: number;
  high: number;
  units: number;
  /** some of the week's sales came in before Phase 10d and were costed later, at the recipe then */
  later: boolean;
}

/**
 * Each product's cost over time, from its sales' recorded costs: by week (from Monday, UTC), newest
 * first, the last `weeks` weeks that had a sale. A line costed more than a day after it sold is
 * `later`. Lines Command had no record for (source 'none') aren't a cost, so they're left out.
 */
export async function costHistory(db: Queryable, weeks = 26): Promise<Record<string, CostWeek[]>> {
  const { rows } = await db.query<{ product_id: string; week: string; low: number; high: number; units: string; later: boolean }>(
    `SELECT c.product_id, (extract(epoch FROM date_trunc('week', o.paid_at AT TIME ZONE 'UTC')) * 1000)::bigint AS week,
            min(c.unit_cost_cents) AS low, max(c.unit_cost_cents) AS high,
            sum((o.items -> c.line ->> 3)::int) AS units,
            bool_or(c.costed_at > o.paid_at + interval '1 day') AS later
     FROM command.shop_order_costs c JOIN command.shop_orders o ON o.id = c.order_id
     WHERE c.source <> 'none'
     GROUP BY c.product_id, week ORDER BY c.product_id, week DESC`,
  );
  const out: Record<string, CostWeek[]> = {};
  for (const r of rows) {
    const list = (out[r.product_id] ??= []);
    if (list.length < weeks) list.push({ week: Number(r.week), low: shown(Number(r.low)), high: shown(Number(r.high)), units: Number(r.units), later: !!r.later });
  }
  return out;
}

// ── the payload ─────────────────────────────────────────────────────────────

/** The products using each input. */
const usedIn = (book: Book) => {
  const m = new Map<string, number>();
  for (const lines of book.lines.values()) for (const l of lines) m.set(l.inputId, (m.get(l.inputId) ?? 0) + 1);
  return m;
};
const isLow = (i: Input, onHand: number) => i.stocked && i.lowMark != null && onHand <= i.lowMark;
const line = (l: Worked & { inputId: string }) => ({ input: l.inputId, amount: l.amount, cost: shown(l.costCents), entered: l.entered, ...(l.typedCents != null ? { typed: shown(l.typedCents) } : {}), ...(l.note ? { note: l.note } : {}) });

/**
 * The Shop section's costing (INPUTS, RECIPES, MATERIALS). `priceOf` is the price the page shows a
 * product at (live, the site's), in dollars, so margins agree with the page's own.
 */
export function costingPayload(book: Book, priceOf: Map<string, number> = new Map(), history: History = noHistory()) {
  const uses = usedIn(book);
  const INPUTS = [...book.inputs.values()].map((i) => {
    const u = unitCostOf(i);
    const on = i.stocked ? (book.onHand.get(i.id) ?? 0) : null;
    return {
      id: i.id,
      name: i.name,
      kind: i.kind,
      unit: i.unit,
      stocked: i.stocked,
      // unrounded: $0.0425 a ml stays that
      unitCost: u == null ? null : u / 100,
      onHand: on,
      lowMark: i.lowMark,
      low: on != null && isLow(i, on),
      usedIn: uses.get(i.id) ?? 0,
      archived: i.archived,
      note: i.note,
      lastPurchase: i.lastPurchase ? { at: i.lastPurchase.at, quantity: i.lastPurchase.quantity, total: i.lastPurchase.totalCents / 100, supplier: i.lastPurchase.supplier } : null,
      // the redesign's: its kind (kept on hand, made to order, once per order), the average and the last
      // price paid (dollars, unrounded), its supplier, and its extras as the reference's `var`
      type: inputType(i),
      perOrder: !!i.perOrder,
      onPickup: !!i.onPickup,
      avg: u == null ? null : u / 100,
      last: lastPaidOf(i) == null ? null : lastPaidOf(i)! / 100,
      supplier: i.supplierId ?? null,
      var: Object.fromEntries((i.extras ?? []).map((x) => [x.size || x.option, x.cents / 100])),
      extras: (i.extras ?? []).map((x) => (x.size ? { size: x.size, extra: x.cents / 100 } : { option: x.option, extra: x.cents / 100 })),
      // the history (Phase 10c): purchases newest first, and the stock ledger of one kept on hand
      purchases: (history.purchases.get(i.id) ?? []).map((p) => ({ at: p.at, quantity: p.quantity, total: p.totalCents / 100, unitCost: purchaseUnitCost(p.totalCents, p.quantity) / 100, supplier: p.supplier, note: p.note })),
      moves: (history.moves.get(i.id) ?? []).map((m) => ({ at: m.at, quantity: m.quantity, reason: m.reason, note: m.note, ref: m.ref })),
    };
  });

  const RECIPES: Record<string, unknown> = {};
  const makes: Record<string, { units: number | null; binding: string | null; unknown?: string[] }> = {};
  // each stocked input on its own: how many of each product what's on hand would make
  const covers: Record<string, Record<string, number>> = {};
  for (const [pid, lines] of book.lines) {
    const p = book.products.get(pid);
    const price = Math.round((priceOf.get(pid) ?? (p ? p.priceCents / 100 : 0)) * 100);
    const base = costRecipe(lines, [], book.inputs);
    const ov = book.overrides.get(pid) ?? [];
    const mOf = (c: number) => {
      const m = margin(price, roundCents(c));
      return { amount: m.cents / 100, share: m.share };
    };
    const variants = (book.variants.get(pid) ?? []).map((v) => {
      const c = costRecipe(lines, ov, book.inputs, v);
      return { option: v.option, size: v.size, cost: shown(c.costCents), margin: mOf(c.costCents) };
    });
    RECIPES[pid] = {
      lines: base.lines.map(line),
      overrides: ov.map((o) => {
        const i = book.inputs.get(o.inputId);
        return { option: o.option, size: o.size, ...line({ inputId: o.inputId, ...workLine(o, i ? unitCostOf(i) : null) }) };
      }),
      cost: shown(base.costCents),
      margin: mOf(base.costCents),
      variants,
      // margin shows per size only where the sizes differ
      differs: variants.some((v) => v.cost !== shown(base.costCents)),
    };
    const k = canMake(base, book.inputs, book.onHand);
    makes[pid] = { units: k.units, binding: k.binding, ...(k.unknown.length ? { unknown: k.unknown } : {}) };
    for (const l of base.lines) {
      const i = book.inputs.get(l.inputId);
      if (!i?.stocked || i.archived || !l.amount) continue;
      (covers[l.inputId] ??= {})[pid] = floorCount((book.onHand.get(l.inputId) ?? 0) / l.amount);
    }
  }

  const stocked = INPUTS.filter((i) => i.stocked && !i.archived);
  const MATERIALS = {
    onHand: stocked.map((i) => ({ input: i.id, name: i.name, unit: i.unit, onHand: i.onHand, lowMark: i.lowMark, low: i.low })),
    low: stocked.filter((i) => i.low).map((i) => i.id),
    makes,
    covers,
  };
  // the recent production runs (Phase 10c), newest first
  const RUNS = history.runs.map((r) => ({
    id: r.id,
    at: r.at,
    product: r.productId,
    option: r.option,
    size: r.size,
    units: r.units,
    note: r.note,
    short: r.short,
    who: r.who,
    uses: r.uses.map((u) => ({ input: u.inputId, quantity: u.quantity })),
    batch: r.batch ?? `R-${r.id}`,
    unitCost: r.unitCostCents == null ? null : r.unitCostCents / 100,
  }));

  // each product's cost and where it comes from; a flat-costed one's flat cost and its colours' and sizes'
  const COST_BY: Record<string, CostSource> = {};
  const FLAT: Record<string, unknown> = {};
  for (const [pid, p] of book.products) {
    COST_BY[pid] = productCost(book, pid).source;
    if (p.flatCents == null) continue;
    const price = Math.round((priceOf.get(pid) ?? p.priceCents / 100) * 100);
    const m = margin(price, roundCents(p.flatCents));
    FLAT[pid] = {
      cost: shown(p.flatCents),
      estimate: !!p.flatEstimate,
      note: p.flatNote ?? '',
      margin: { amount: m.cents / 100, share: m.share },
      overrides: (book.flatOverrides?.get(pid) ?? []).map((o) => ({ option: o.option, size: o.size, cost: shown(o.costCents) })),
    };
  }
  return { INPUTS, RECIPES, MATERIALS, RUNS, COST_BY, FLAT };
}

/** The same, empty: below See, the costing isn't sent. */
export const noCosting = () => ({ INPUTS: [], RECIPES: {}, MATERIALS: { onHand: [], low: [], makes: {}, covers: {} }, RUNS: [], COST_BY: {}, FLAT: {} });

/**
 * The stocked inputs at or under their low mark, for Home's alerts: one small read, so Home needs
 * none of Shop loaded. The same rule as MATERIALS.low.
 */
export async function lowMaterials(db: Queryable): Promise<Array<{ input: string; name: string; unit: string; onHand: number; lowMark: number }>> {
  const { rows } = await db.query<{ id: string; name: string; unit: string; low_mark: string; on_hand: string }>(
    `SELECT i.id, i.name, i.unit, i.low_mark, coalesce(sum(m.quantity), 0) AS on_hand
     FROM command.shop_inputs i LEFT JOIN command.shop_input_moves m ON m.input_id = i.id
     WHERE i.stocked AND i.archived_at IS NULL AND i.low_mark IS NOT NULL
     GROUP BY i.id, i.name, i.unit, i.low_mark HAVING coalesce(sum(m.quantity), 0) <= i.low_mark
     ORDER BY i.name`,
  );
  return rows.map((r) => ({ input: r.id, name: r.name, unit: r.unit, onHand: Number(r.on_hand), lowMark: Number(r.low_mark) }));
}
