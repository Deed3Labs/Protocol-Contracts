import type { Queryable } from '../../db/db.js';
import { inputType, lastPaidOf, productCost, roundCents, runUses, shown, unitCostOf, type Book, type Input } from './costing.js';
import { readSetting } from './settings.js';

/*
 * The redesign's Shop data model (docs/ui-redesign-plan.md, the Shop gaps): suppliers and their price
 * breaks, buys ordered but not here yet, reorder suggestions, batches, what an order costs once (its
 * packing, the postage label against the shipping charged, the card fee) and pickup points.
 *
 * The arithmetic up top is pure; the readers below load what it works on, and shopModelPayload is what
 * the Shop section sends. Money is cents inside, dollars in the payload, as costing.ts has it.
 */

/**
 * The card fee: Stripe's 2.9% + 30¢ on what the buyer paid. A constant, not a setting: it's the payment
 * processor's price, not a rule the co-op decides, and each order keeps the fee it was charged
 * (shop_order_overheads), so a new rate here changes no past margin. An order paid with Clear pays none.
 */
export const CARD_FEE = { pct: 0.029, fixedCents: 30 };
/** A reorder covers the wait (lead time plus the buffer) and this many weeks of use after it lands. */
export const REORDER_COVER_WEEKS = 4;
/** Use per week is read over the last four weeks of runs and packed orders. */
export const USAGE_WEEKS = 4;
const DAY = 864e5;
const WEEK = 7 * DAY;

// ── the arithmetic ──────────────────────────────────────────────────────────

/** An order's card fee, in whole cents: none on nothing, or on an order paid with Clear. */
export const cardFee = (totalCents: number, paidWith: string) => (paidWith === 'clear' || totalCents <= 0 ? 0 : Math.round(totalCents * CARD_FEE.pct + CARD_FEE.fixedCents));

/** The once-per-order inputs an order uses, with each one's unit cost now (unrounded): all of them shipped, those marked for pickups picked up. */
export function orderSupplies(book: Book, fulfilment: 'ship' | 'pickup'): Array<[string, number]> {
  return [...book.inputs.values()].filter((i) => i.perOrder && !i.archived && (fulfilment === 'ship' || i.onPickup)).map((i) => [i.id, unitCostOf(i) ?? 0]);
}

/** The best discount a quantity gets: the largest break at or under it (0 below the first). */
export function breakFor(breaks: Array<[number, number]>, quantity: number): number {
  let d = 0;
  for (const [q, off] of [...breaks].sort((a, b) => a[0] - b[0])) if (quantity + 1e-9 >= q) d = off;
  return d;
}

export interface Reorder {
  input: string;
  onHand: number;
  /** Bought and not here yet. */
  onOrder: number;
  /** Used a week, over the last four weeks; 0 when nothing was used. */
  perWeek: number;
  /** How long on hand and on order last at that rate; null when nothing's being used. */
  lastsWeeks: number | null;
  /** The supplier's lead time plus the buffer: under it, it's time to reorder. */
  needWeeks: number;
  leadDays: number | null;
  /** At or under its reorder mark. */
  low: boolean;
  /** Whether to reorder now: it won't last the wait, or it's at its mark, and nothing on order covers it. */
  due: boolean;
  suggest: { quantity: number; supplier: string | null; unitCostCents: number; discount: number; totalCents: number; landsAt: number | null } | null;
}

/**
 * Whether a stocked input needs reordering, and how much. It's due when what's on hand and on order
 * lasts less than the supplier's lead time plus the buffer, or is at or under its reorder mark. The
 * suggestion covers the wait and four weeks after (with nothing used, twice the mark), at least the
 * supplier's first price break, at the last price paid less the break it reaches.
 */
export function reorderFor(
  i: Pick<Input, 'id' | 'lowMark' | 'lastCostCents' | 'lastPurchase' | 'unitCostCents'>,
  x: { onHand: number; onOrder: number; used: number; leadDays: number | null; bufferWeeks: number; breaks: Array<[number, number]>; supplier: string | null; now: number },
): Reorder {
  const perWeek = x.used / USAGE_WEEKS;
  const have = x.onHand + x.onOrder;
  const lastsWeeks = perWeek > 0 ? have / perWeek : null;
  const needWeeks = (x.leadDays ?? 0) / 7 + x.bufferWeeks;
  const low = i.lowMark != null && x.onHand <= i.lowMark;
  const due = (lastsWeeks != null && lastsWeeks < needWeeks) || (i.lowMark != null && have <= i.lowMark);
  let suggest: Reorder['suggest'] = null;
  if (due) {
    const target = perWeek > 0 ? perWeek * (needWeeks + REORDER_COVER_WEEKS) + (i.lowMark ?? 0) : 2 * (i.lowMark ?? 0);
    const first = x.breaks.length ? Math.min(...x.breaks.map((b) => b[0])) : 0;
    const quantity = Math.max(Math.ceil(target - have - 1e-9), Math.ceil(first), 1);
    const unit = lastPaidOf(i) ?? unitCostOf(i) ?? 0;
    const discount = breakFor(x.breaks, quantity);
    suggest = {
      quantity,
      supplier: x.supplier,
      unitCostCents: unit,
      discount,
      totalCents: roundCents(quantity * unit * (1 - discount)),
      landsAt: x.leadDays == null ? null : x.now + x.leadDays * DAY,
    };
  }
  return { input: i.id, onHand: x.onHand, onOrder: x.onOrder, perWeek, lastsWeeks, needWeeks, leadDays: x.leadDays, low, due, suggest };
}

// ── the readers ─────────────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  city: string;
  sells: string;
  leadDays: number | null;
  terms: string;
  minimum: string;
  note: string;
  /** [from this many, this much off], smallest first. */
  breaks: Array<[number, number]>;
  /** The latest buy from them, ordered or received. */
  lastOrder: number | null;
}

export async function readSuppliers(db: Queryable): Promise<Map<string, Supplier>> {
  const [sup, brk] = await Promise.all([
    db.query<any>(
      `SELECT s.*, (SELECT max(p.at) FROM command.shop_input_purchases p WHERE p.supplier_id = s.id AND p.state <> 'cancelled') AS last_order
       FROM command.shop_suppliers s ORDER BY s.name`,
    ),
    db.query<any>('SELECT * FROM command.shop_supplier_breaks ORDER BY supplier_id, quantity'),
  ]);
  const m = new Map<string, Supplier>();
  for (const r of sup.rows)
    m.set(r.id, {
      id: r.id,
      name: r.name,
      city: r.city,
      sells: r.sells,
      leadDays: r.lead_days,
      terms: r.terms,
      minimum: r.minimum,
      note: r.note,
      breaks: [],
      lastOrder: r.last_order ? new Date(r.last_order).getTime() : null,
    });
  for (const r of brk.rows) m.get(r.supplier_id)?.breaks.push([Number(r.quantity), Number(r.discount)]);
  return m;
}

/** A buy ordered and not here yet. */
export interface OnOrder {
  id: number;
  input: string;
  quantity: number;
  totalCents: number;
  supplierId: string | null;
  supplier: string;
  orderedAt: number;
  due: number | null;
  who: string;
  note: string;
}

export async function readOnOrder(db: Queryable): Promise<OnOrder[]> {
  const { rows } = await db.query<any>(`SELECT * FROM command.shop_input_purchases WHERE state = 'ordered' ORDER BY due_on NULLS LAST, at, id`);
  return rows.map((r) => ({
    id: Number(r.id),
    input: r.input_id,
    quantity: Number(r.quantity),
    totalCents: Number(r.total_cents),
    supplierId: r.supplier_id,
    supplier: r.supplier,
    orderedAt: new Date(r.at).getTime(),
    due: r.due_on ? new Date(r.due_on).getTime() : null,
    who: r.who,
    note: r.note,
  }));
}

/** What each stocked input used since then: its runs and packed orders, as a positive amount. */
export async function readUsage(db: Queryable, since: Date): Promise<Map<string, number>> {
  const { rows } = await db.query<{ input_id: string; used: string }>(
    `SELECT input_id, -sum(quantity) AS used FROM command.shop_input_moves WHERE reason IN ('run', 'order') AND quantity < 0 AND at >= $1 GROUP BY input_id`,
    [since],
  );
  return new Map(rows.map((r) => [r.input_id, Number(r.used)]));
}

/**
 * Records what each live order cost once (shop_order_overheads), for every Stripe order without a
 * record yet: new ones as the shop feed brings them in, and once, the ones from before. Packing is at
 * its cost now; the shipping charged is the checkout's, else Settings' flat `ship`; the label is
 * recorded when it's bought (the order-label action). Returns how many it recorded.
 */
export async function costOverheads(db: Queryable, book: Book): Promise<number> {
  const { rows } = await db.query<OrderRow>(
    `SELECT o.id, o.items, o.paid_with, o.fulfilment, o.total_cents, o.shipping_cents FROM command.shop_orders o
     WHERE o.source = 'stripe' AND NOT EXISTS (SELECT 1 FROM command.shop_order_overheads x WHERE x.order_id = o.id)
     ORDER BY o.paid_at`,
  );
  if (!rows.length) return 0;
  const ship = await readSetting<number>(db, 'ship');
  let n = 0;
  for (const o of rows) if (await recordOverhead(db, o, book, ship)) n++;
  return n;
}

export type OrderRow = { id: string; items: Array<[string, string, string, number]>; paid_with: string; fulfilment: 'ship' | 'pickup'; total_cents: number | null; shipping_cents: number | null };

/** One order's once-per-order costs, written if it has none yet. A seeded order has no total: its items at their prices stand in. */
export async function recordOverhead(db: Queryable, o: OrderRow, book: Book, shipDollars: number, labelCents: number | null = null): Promise<boolean> {
  const supplies = orderSupplies(book, o.fulfilment).map(([id, c]) => [id, roundCents(c)] as [string, number]);
  const total = o.total_cents ?? o.items.reduce((a, [pid, , , q]) => a + (book.products.get(pid)?.priceCents ?? 0) * q, 0);
  const charged = o.fulfilment === 'ship' ? (o.shipping_cents ?? Math.round(shipDollars * 100)) : 0;
  const r = await db.query(
    `INSERT INTO command.shop_order_overheads (order_id, fulfilment, supplies, supplies_cents, charged_cents, label_cents, fee_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (order_id) DO NOTHING RETURNING 1`,
    [o.id, o.fulfilment, JSON.stringify(supplies), supplies.reduce((a, s) => a + s[1], 0), charged, labelCents, cardFee(total, o.paid_with)],
  );
  return r.rows.length > 0;
}

// ── the payload ─────────────────────────────────────────────────────────────

/**
 * What the redesigned Shop page needs beyond the costing (costingPayload): SUPPLIERS, ON_ORDER,
 * REORDER, BATCHES, PER_ORDER, ORDER_COSTS, POINTS and PICKUP. From See, like the costing; below See,
 * only the pickup points (partner shops, no one's details) and how many orders each holds.
 */
export async function shopModelPayload(db: Queryable, book: Book, o: { now: number; sees: boolean }) {
  const points = await db.query<any>(
    `SELECT p.*, (SELECT count(*)::int FROM command.shop_orders x WHERE x.pickup_point = p.id AND x.state = 'ready') AS held,
            (SELECT count(*)::int FROM command.shop_orders x WHERE x.pickup_point = p.id AND x.paid_at >= $1) AS last4w
     FROM command.shop_pickup_points p ORDER BY p.position, p.name`,
    [new Date(o.now - 28 * DAY)],
  );
  const POINTS = points.rows.map((r) => ({ id: r.id, name: r.name, city: r.city, active: r.active, held: r.held, last4w: r.last4w }));
  if (!o.sees) return { SUPPLIERS: [], ON_ORDER: [], REORDER: [], BATCHES: [], PER_ORDER: null, ORDER_COSTS: {}, POINTS, PICKUP: {} };

  const [suppliers, onOrder, usage, buffer, hold, ship, shopbuy, marginTarget, refund] = await Promise.all([
    readSuppliers(db),
    readOnOrder(db),
    readUsage(db, new Date(o.now - USAGE_WEEKS * WEEK)),
    readSetting<number>(db, 'buffer'),
    readSetting<number>(db, 'hold'),
    readSetting<number>(db, 'ship'),
    readSetting<number>(db, 'shopbuy'),
    readSetting<number>(db, 'margin'),
    readSetting<number>(db, 'refund'),
  ]);
  const inputs = [...book.inputs.values()];

  const SUPPLIERS = [...suppliers.values()].map((s) => ({
    id: s.id,
    name: s.name,
    city: s.city,
    sells: s.sells,
    leadDays: s.leadDays,
    terms: s.terms,
    minimum: s.minimum,
    note: s.note,
    breaks: s.breaks,
    lastOrder: s.lastOrder,
    inputs: inputs.filter((i) => i.supplierId === s.id).map((i) => i.id),
  }));

  const ON_ORDER = onOrder.map((p) => ({
    id: p.id,
    input: p.input,
    quantity: p.quantity,
    total: p.totalCents / 100,
    unitCost: p.totalCents / p.quantity / 100,
    supplier: p.supplierId,
    supplierName: p.supplier,
    orderedAt: p.orderedAt,
    due: p.due,
    who: p.who,
    note: p.note,
  }));

  // each stocked input still in use: how long it lasts, and what to order when it won't last the wait
  const ordered = new Map<string, number>();
  for (const p of onOrder) ordered.set(p.input, (ordered.get(p.input) ?? 0) + p.quantity);
  const REORDER = inputs
    .filter((i) => i.stocked && !i.archived)
    .map((i) => {
      const s = i.supplierId ? suppliers.get(i.supplierId) : undefined;
      const r = reorderFor(i, {
        onHand: book.onHand.get(i.id) ?? 0,
        onOrder: ordered.get(i.id) ?? 0,
        used: usage.get(i.id) ?? 0,
        leadDays: s?.leadDays ?? null,
        bufferWeeks: buffer,
        breaks: s?.breaks ?? [],
        supplier: s?.id ?? null,
        now: o.now,
      });
      return {
        ...r,
        type: inputType(i),
        suggest: r.suggest && {
          quantity: r.suggest.quantity,
          supplier: r.suggest.supplier,
          unitCost: r.suggest.unitCostCents / 100,
          discount: r.suggest.discount,
          total: shown(r.suggest.totalCents),
          landsAt: r.suggest.landsAt,
          // over Settings' limit, the buy waits for a second person
          second: r.suggest.totalCents / 100 > shopbuy,
        },
      };
    });

  // batches: the runs that share a batch id, the planned ones costed and checked against what's on hand now
  const { rows: runs } = await db.query<any>(
    `SELECT * FROM command.shop_runs WHERE state = 'planned' OR id IN (SELECT id FROM command.shop_runs WHERE state = 'done' ORDER BY at DESC, id DESC LIMIT 100) ORDER BY id`,
  );
  const groups = new Map<string, any[]>();
  for (const r of runs) {
    const k = r.batch_id ?? `R-${r.id}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const BATCHES = [...groups.entries()]
    .map(([id, rs]) => {
      const planned = rs.some((r) => r.state === 'planned');
      const need = new Map<string, number>();
      let unknown = false;
      const sizes = rs.map((r) => {
        const c = productCost(book, r.product_id, { option: r.option, size: r.size });
        if (planned && c.source === 'recipe') {
          const u = runUses(c, book.inputs, r.units);
          if (u.unknown.length) unknown = true;
          for (const x of u.uses) need.set(x.inputId, (need.get(x.inputId) ?? 0) + x.quantity);
        }
        const cents = r.state === 'done' ? r.unit_cost_cents : roundCents(c.costCents);
        return { run: Number(r.id), size: r.size, units: r.units, unitCost: cents == null ? null : cents / 100 };
      });
      const needs = [...need].map(([input, quantity]) => ({ input, quantity, onHand: book.onHand.get(input) ?? 0 }));
      const short = needs.some((n) => n.onHand - n.quantity < -1e-9);
      const units = rs.reduce((a, r) => a + r.units, 0);
      const known = sizes.every((s) => s.unitCost != null);
      const total = known ? sizes.reduce((a, s) => a + s.unitCost! * s.units, 0) : null;
      const first = rs[0];
      return {
        id,
        product: first.product_id,
        option: first.option,
        state: planned ? (short ? 'short' : 'planned') : 'done',
        at: planned && first.planned_on ? new Date(first.planned_on).getTime() : new Date(first.at).getTime(),
        units,
        sizes,
        // each, the batch's units at their sizes' costs; an estimate until it's made
        unitCost: total == null || !units ? null : Math.round((total / units) * 100) / 100,
        total: total == null ? null : Math.round(total * 100) / 100,
        estimate: planned,
        // made while an input ran short (the count was off)
        madeShort: rs.some((r) => r.short),
        ...(planned ? { needs, ...(unknown ? { unknownAmounts: true } : {}) } : {}),
        note: first.note,
        who: first.who,
      };
    })
    .sort((a, b) => b.at - a.at);

  // the once-per-order costs as they'd be today, for an order with no record yet
  const avgLabel = await db.query<{ avg: string | null }>(
    `SELECT avg(label_cents) AS avg FROM (SELECT label_cents FROM command.shop_order_overheads WHERE label_cents IS NOT NULL ORDER BY costed_at DESC LIMIT 20) x`,
  );
  const sum = (xs: Array<[string, number]>) => shown(xs.reduce((a, x) => a + x[1], 0));
  const PER_ORDER = {
    ship: { inputs: orderSupplies(book, 'ship').map((x) => x[0]), supplies: sum(orderSupplies(book, 'ship')) },
    pickup: { inputs: orderSupplies(book, 'pickup').map((x) => x[0]), supplies: sum(orderSupplies(book, 'pickup')) },
    fee: { pct: CARD_FEE.pct, fixed: CARD_FEE.fixedCents / 100 },
    charged: ship,
    // what labels have cost lately: null until one's recorded
    label: avgLabel.rows[0]?.avg == null ? null : shown(Number(avgLabel.rows[0].avg)),
    hold,
    // the Settings the page works its figures out with: the target margin (a percentage), the reorder
    // buffer (weeks), and the amounts over which a buy or a refund waits for a second person (dollars)
    margin: marginTarget,
    buffer,
    shopbuy,
    refund,
  };

  const { rows: oh } = await db.query<any>('SELECT * FROM command.shop_order_overheads');
  const ORDER_COSTS = Object.fromEntries(
    oh.map((r) => [
      r.order_id,
      {
        fulfilment: r.fulfilment,
        supplies: (r.supplies as Array<[string, number]>).map(([input, c]) => ({ input, cost: c / 100 })),
        suppliesCost: r.supplies_cents / 100,
        charged: r.charged_cents / 100,
        label: r.label_cents == null ? null : r.label_cents / 100,
        // the label less the shipping charged: what shipping cost the shop
        gap: r.label_cents == null ? null : (r.label_cents - r.charged_cents) / 100,
        fee: r.fee_cents / 100,
        costedAt: new Date(r.costed_at).getTime(),
      },
    ]),
  );

  const { rows: held } = await db.query<any>(`SELECT id, pickup_point, ready_at, state FROM command.shop_orders WHERE fulfilment = 'pickup' AND (pickup_point IS NOT NULL OR ready_at IS NOT NULL)`);
  const PICKUP = Object.fromEntries(
    held.map((r) => {
      const ready = r.ready_at ? new Date(r.ready_at).getTime() : null;
      const until = ready == null ? null : ready + hold * DAY;
      return [r.id, { point: r.pickup_point, readyAt: ready, holdUntil: until, overdue: r.state === 'ready' && until != null && until < o.now }];
    }),
  );

  return { SUPPLIERS, ON_ORDER, REORDER, BATCHES, PER_ORDER, ORDER_COSTS, POINTS, PICKUP };
}
