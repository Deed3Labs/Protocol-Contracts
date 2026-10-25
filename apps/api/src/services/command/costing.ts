import type { Queryable } from '../../db/db.js';

/*
 * What goes into a product (docs/command-center-plan.md, Phase 10): the shop's costing engine.
 *
 * A product's cost is the sum of its recipe's lines, each an input from one library. A line is
 * entered either way, and the other is worked out: an amount used ("12 ml") gives its cost from the
 * input's unit cost, and a cost per product ("$5.20 of embroidery") gives the amount. Any colour or
 * size can override a line. A product with no recipe yet keeps its four cost boxes.
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
}

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
}

// ── the arithmetic ──────────────────────────────────────────────────────────

/** A purchase's unit cost: what was paid over how much came ($164 for 20 is 820¢ each). */
export const purchaseUnitCost = (totalCents: number, quantity: number) => totalCents / quantity;

/** An input's unit cost: as set, else from its latest purchase, else not known (null). */
export function unitCostOf(i: Pick<Input, 'unitCostCents' | 'lastPurchase'>): number | null {
  if (i.unitCostCents != null) return i.unitCostCents;
  return i.lastPurchase ? purchaseUnitCost(i.lastPurchase.totalCents, i.lastPurchase.quantity) : null;
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
}
export interface Costed {
  /** Unrounded. */
  costCents: number;
  lines: CostedLine[];
}

/** A recipe's cost for a colour and size (null: the recipe as written), line by line. */
export function costRecipe(lines: Line[], overrides: Override[], inputs: Map<string, Input>, v: Variant | null = null): Costed {
  const out = lines.map((l): CostedLine => {
    const o = overrideFor(overrides, l.inputId, v);
    const input = inputs.get(l.inputId);
    return { inputId: l.inputId, override: !!o, ...workLine(o ?? l, input ? unitCostOf(input) : null) };
  });
  return { costCents: out.reduce((a, l) => a + l.costCents, 0), lines: out };
}

export type CostSource = 'recipe' | 'boxes' | 'none';

/**
 * A product's cost: its recipe's, with the variant's overrides, or with no recipe the sum of its
 * four boxes, so nothing changes until a recipe is filled in. A deposit has neither ('none').
 */
export function productCost(book: Book, productId: string, v: Variant | null = null): Costed & { source: CostSource } {
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
  const [inputs, products, lines, overrides, variants, moves] = await Promise.all([
    db.query<any>(
      `SELECT i.*, p.at AS p_at, p.quantity AS p_quantity, p.total_cents AS p_total, p.supplier AS p_supplier
       FROM command.shop_inputs i
       LEFT JOIN LATERAL (SELECT * FROM command.shop_input_purchases x WHERE x.input_id = i.id ORDER BY x.at DESC, x.id DESC LIMIT 1) p ON true
       ORDER BY i.archived_at IS NOT NULL, i.name`,
    ),
    db.query<any>('SELECT id, price_cents, cost_cents, deposit FROM command.shop_products ORDER BY position'),
    db.query<any>('SELECT * FROM command.shop_recipe_lines ORDER BY product_id, position, input_id'),
    db.query<any>('SELECT * FROM command.shop_recipe_overrides ORDER BY product_id, input_id, option, size'),
    db.query<any>('SELECT product_id, option, size FROM command.shop_stock ORDER BY product_id, option_pos, size_pos'),
    db.query<any>('SELECT input_id, sum(quantity) AS quantity FROM command.shop_input_moves GROUP BY input_id'),
  ]);
  const book: Book = { inputs: new Map(), products: new Map(), lines: new Map(), overrides: new Map(), variants: new Map(), onHand: new Map() };
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
    });
  for (const r of products.rows) book.products.set(r.id, { id: r.id, priceCents: r.price_cents, boxes: r.cost_cents ? r.cost_cents.map(Number) : null, deposit: r.deposit });
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
  reason: 'purchase' | 'run' | 'adjust' | 'waste';
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
      `SELECT * FROM (SELECT p.*, row_number() OVER (PARTITION BY input_id ORDER BY at DESC, id DESC) AS n FROM command.shop_input_purchases p) x
       WHERE n <= $1 ORDER BY input_id, at DESC, id DESC`,
      [HISTORY_CAPS.purchases],
    ),
    db.query<any>(
      `SELECT * FROM (SELECT m.*, row_number() OVER (PARTITION BY input_id ORDER BY at DESC, id DESC) AS n FROM command.shop_input_moves m) x
       WHERE n <= $1 ORDER BY input_id, at DESC, id DESC`,
      [HISTORY_CAPS.moves],
    ),
    db.query<any>('SELECT * FROM command.shop_runs ORDER BY at DESC, id DESC LIMIT $1', [HISTORY_CAPS.runs]),
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
  }));
  return { INPUTS, RECIPES, MATERIALS, RUNS };
}

/** The same, empty: below See, the costing isn't sent. */
export const noCosting = () => ({ INPUTS: [], RECIPES: {}, MATERIALS: { onHand: [], low: [], makes: {}, covers: {} }, RUNS: [] });

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
