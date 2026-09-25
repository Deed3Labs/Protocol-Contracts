import { randomUUID } from 'node:crypto';
import {
  type ChosenOption,
  DiscountRequest,
  LineInput,
  type Order,
  type OrderDiscount,
  type OrderLine,
  orderStatus,
  type Role,
  type TaxKind,
  type TenderState,
} from '@clear/merchant-contracts';
import { z } from 'zod';
import type { Db, Queryable } from '../../../db/db.js';
import { getSettings } from '../shop/shopService.js';
import type { TaxApi } from '../tax/taxApi.js';
import { type OrderTax, taxForOrder } from '../tax/taxService.js';
import { settleOrder } from './settle.js';
import { audit } from '../security/audit.js';

/**
 * Orders (card-processing prompt, Phase 6: the order service). The app sends lines and a discount
 * request; the server works out prices, the discount, tax and totals (principle 7) and holds the
 * stock. Lines and the discount change only while nothing has been paid or is being paid.
 *
 * Tax is on each line after its share of the discount ("Sales tax · on the discounted parts"). With
 * tax included in prices, the total is what the prices say and the tax is the part of it that is tax.
 */

export class OrderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'invalid'
      | 'out_of_stock'
      | 'locked'
      | 'one_discount'
      | 'code_unknown'
      | 'code_not_live'
      | 'code_used'
      | 'code_not_applicable'
      | 'needs_approval'
      | 'approver_invalid',
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

/** Checks a manager's or owner's PIN at the counter; rate-limited per shop by the real one. */
export type PinCheck = (merchant: string, pin: string) => Promise<{ id: string; role: Role } | null>;

export interface OrderDeps {
  taxApi: TaxApi | null;
  pinCheck: PinCheck;
}

// ---- Lines -------------------------------------------------------------------------------------

interface PreparedLine {
  itemId: string | null;
  category: string | null;
  name: string;
  note: string | null;
  quantity: number;
  unitCents: number;
  options: ChosenOption[];
  lineCents: number;
  taxKind: TaxKind;
  stockTracked: boolean;
}

async function prepareLines(q: Queryable, merchant: string, input: unknown): Promise<PreparedLine[]> {
  // Each line through the contract's own schema: composing it with this package's zod would mix
  // two copies of the library.
  if (!Array.isArray(input) || input.length === 0) throw new OrderError('An order needs at least one line', 'invalid');
  const parsedLines = input.map((x) => LineInput.safeParse(x));
  const bad = parsedLines.find((r) => !r.success);
  if (bad && !bad.success) throw new OrderError(bad.error.issues[0]?.message ?? 'A line isn’t valid', 'invalid');
  const out: PreparedLine[] = [];
  for (const r of parsedLines) {
    const l = r.data!;
    if (l.itemId === null) {
      out.push({ itemId: null, category: null, name: l.name.trim(), note: l.note, quantity: 1, unitCents: l.amountCents, options: [], lineCents: l.amountCents, taxKind: l.taxKind, stockTracked: false });
      continue;
    }
    const { rows: items } = await q.query<{ id: string; name: string; category: string; price_cents: string | number; tax_kind: TaxKind; stock_tracked: boolean; archived_at: unknown }>(
      'SELECT id, name, category, price_cents, tax_kind, stock_tracked, archived_at FROM commerce.catalog_items WHERE id = $1 AND merchant = $2',
      [l.itemId, merchant],
    );
    const item = items[0];
    if (!item || item.archived_at) throw new OrderError('That item isn’t for sale', 'invalid');
    const { rows: opts } = await q.query<{ id: string; group_id: string; name: string; delta_cents: string | number; group_name: string; rule: 'one' | 'any'; required: boolean }>(
      `SELECT o.id, o.group_id, o.name, o.delta_cents, g.name AS group_name, g.rule, g.required
         FROM commerce.options o JOIN commerce.option_groups g ON g.id = o.group_id WHERE g.item_id = $1`,
      [item.id],
    );
    const chosen = l.optionIds.map((id) => opts.find((o) => o.id === id));
    if (chosen.some((o) => !o)) throw new OrderError(`An option chosen isn’t one of ${item.name}’s`, 'invalid');
    if (new Set(l.optionIds).size !== l.optionIds.length) throw new OrderError('Each option once', 'invalid');
    const groups = new Map<string, { name: string; rule: string; required: boolean; picked: number }>();
    for (const o of opts) groups.set(o.group_id, { name: o.group_name, rule: o.rule, required: o.required, picked: 0 });
    for (const o of chosen) groups.get(o!.group_id)!.picked += 1;
    for (const g of groups.values()) {
      if (g.rule === 'one' && g.picked > 1) throw new OrderError(`Pick one ${g.name}`, 'invalid');
      if (g.required && g.picked === 0) throw new OrderError(`${item.name} needs a ${g.name}`, 'invalid');
    }
    const options: ChosenOption[] = chosen.map((o) => ({ groupId: o!.group_id, optionId: o!.id, name: o!.name, deltaCents: Number(o!.delta_cents) }));
    const unitCents = Number(item.price_cents) + options.reduce((s, o) => s + o.deltaCents, 0);
    if (unitCents < 0) throw new OrderError('Those options take the price below zero', 'invalid');
    out.push({
      itemId: item.id,
      category: item.category,
      name: item.name,
      note: null,
      quantity: l.quantity,
      unitCents,
      options,
      lineCents: unitCents * l.quantity,
      taxKind: item.tax_kind,
      stockTracked: item.stock_tracked,
    });
  }
  return out;
}

/** Splits a discount across lines in proportion to their amounts; the pennies left go to the largest remainders. */
export function allocate(amounts: number[], discount: number): number[] {
  const total = amounts.reduce((s, a) => s + a, 0);
  if (total === 0 || discount === 0) return amounts.map(() => 0);
  const exact = amounts.map((a) => (a * discount) / total);
  const shares = exact.map(Math.floor);
  let left = discount - shares.reduce((s, a) => s + a, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left === 0) break;
    shares[i]! += 1;
    left -= 1;
  }
  return shares;
}

// ---- Discounts ---------------------------------------------------------------------------------

interface DiscountSpec {
  kind: 'code' | 'manual';
  codeId: string | null;
  percent: number | null;
  amountCents: number | null;
  /** Categories the discount applies to; null for everything. */
  categories: string[] | null;
  label: string;
  reason: string | null;
  appliedBy: string;
  approvedBy: string | null;
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** How much a discount takes off these lines, and each line's share of it. Never more than they come to. */
function discountOn(lines: PreparedLine[], spec: DiscountSpec | null): { amount: number; shares: number[] } {
  if (!spec) return { amount: 0, shares: lines.map(() => 0) };
  const eligible = lines.map((l) => (spec.categories === null || (l.category !== null && spec.categories.includes(l.category)) ? l.lineCents : 0));
  const base = eligible.reduce((s, a) => s + a, 0);
  const amount = Math.min(base, spec.percent !== null ? Math.floor((base * spec.percent) / 100) : (spec.amountCents ?? 0));
  return { amount, shares: allocate(eligible, amount) };
}

// ---- Pricing -----------------------------------------------------------------------------------

interface Priced {
  lines: Array<PreparedLine & { discountCents: number; taxCents: number }>;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  inclusive: boolean;
  taxSource: OrderTax['source'];
  calculationId: string | null;
}

async function price(db: Queryable, deps: OrderDeps, merchant: string, lines: PreparedLine[], spec: DiscountSpec | null): Promise<Priced> {
  const settings = await getSettings(db, merchant);
  const inclusive = settings.tax.pricesIncludeTax;
  const { amount: discount, shares } = discountOn(lines, spec);
  const tax = await taxForOrder(db, deps.taxApi, {
    merchant,
    inclusive,
    lines: lines.map((l, i) => ({ reference: `L${i + 1}`, amountCents: l.lineCents - shares[i]!, taxKind: l.taxKind })),
  });
  const priced = lines.map((l, i) => ({ ...l, discountCents: shares[i]!, taxCents: tax.taxByLine.get(`L${i + 1}`) ?? 0 }));
  const gross = priced.reduce((s, l) => s + l.lineCents, 0);
  const taxTotal = priced.reduce((s, l) => s + l.taxCents, 0);
  // Exclusive: subtotal − discount + tax. Inclusive: the total is the prices less the discount, and
  // the subtotal is what's left of it before tax, so the same identity holds.
  const total = inclusive ? gross - discount : gross - discount + taxTotal;
  const subtotal = inclusive ? total - taxTotal + discount : gross;
  return { lines: priced, subtotal, discount, tax: taxTotal, total, inclusive, taxSource: tax.source, calculationId: tax.calculationId };
}

// ---- Reading -----------------------------------------------------------------------------------

interface OrderRow {
  id: string;
  merchant: string;
  number: number | null;
  name: string | null;
  raised_by: string;
  customer: string | null;
  status: Order['status'];
  subtotal_cents: string | number;
  discount_cents: string | number;
  tax_cents: string | number;
  total_cents: string | number;
  tip_cents: string | number;
  business_date: Date | string;
  created_at: Date | string;
  voided_at: unknown;
  tax_included: boolean;
  tax_source: Order['taxSource'];
}

const day = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

async function toOrder(q: Queryable, r: OrderRow): Promise<Order> {
  const { rows: lines } = await q.query<{
    id: string;
    item_id: string | null;
    name: string;
    note: string | null;
    quantity: number;
    unit_cents: string | number;
    options: ChosenOption[] | string;
    line_cents: string | number;
    discount_cents: string | number;
    tax_kind: TaxKind;
    tax_cents: string | number;
  }>('SELECT * FROM commerce.order_lines WHERE order_id = $1 AND removed_at IS NULL ORDER BY position, id', [r.id]);
  const { rows: discounts } = await q.query<{ kind: 'code' | 'manual'; code_id: string | null; label: string; amount_cents: string | number; reason: string | null; approved_by: string | null }>(
    'SELECT * FROM commerce.order_discounts WHERE order_id = $1 AND removed_at IS NULL',
    [r.id],
  );
  const { rows: tenders } = await q.query<{ method: TenderState['method']; status: TenderState['status']; amount_cents: string | number; tip_cents: string | number; refunded_cents: string | number }>(
    'SELECT method, status, amount_cents, tip_cents, refunded_cents FROM payments.tenders WHERE order_id = $1',
    [r.id],
  );
  const summary = orderStatus(
    { totalCents: Number(r.total_cents), voided: Boolean(r.voided_at) },
    tenders.map((t) => ({ method: t.method, status: t.status, amountCents: Number(t.amount_cents), tipCents: Number(t.tip_cents), refundedCents: Number(t.refunded_cents) })),
  );
  const d = discounts[0];
  const discount: OrderDiscount | null = d
    ? { kind: d.kind, codeId: d.code_id, label: d.label, amountCents: Number(d.amount_cents), reason: d.reason, approvedBy: d.approved_by }
    : null;
  const toLine = (l: (typeof lines)[number]): OrderLine => ({
    id: l.id,
    itemId: l.item_id,
    name: l.name,
    note: l.note,
    quantity: l.quantity,
    unitCents: Number(l.unit_cents),
    options: typeof l.options === 'string' ? JSON.parse(l.options) : l.options,
    lineCents: Number(l.line_cents),
    discountCents: Number(l.discount_cents),
    taxKind: l.tax_kind,
    taxCents: Number(l.tax_cents),
  });
  return {
    id: r.id,
    shop: r.merchant,
    number: r.number,
    name: r.name,
    raisedBy: r.raised_by,
    customer: r.customer,
    status: r.status,
    lines: lines.map(toLine),
    discount,
    subtotalCents: Number(r.subtotal_cents),
    discountCents: Number(r.discount_cents),
    taxCents: Number(r.tax_cents),
    totalCents: Number(r.total_cents),
    taxIncluded: r.tax_included,
    taxSource: r.tax_source,
    tipCents: Number(r.tip_cents),
    remainingCents: summary.remainingCents,
    businessDate: day(r.business_date),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function getOrder(q: Queryable, merchant: string, orderId: string): Promise<Order> {
  const { rows } = await q.query<OrderRow>('SELECT * FROM commerce.orders WHERE id = $1 AND merchant = $2', [orderId, merchant]);
  if (!rows[0]) throw new OrderError('No such order', 'not_found');
  return toOrder(q, rows[0]);
}

export async function listOrders(q: Queryable, merchant: string, businessDate: string): Promise<Order[]> {
  const { rows } = await q.query<OrderRow>('SELECT * FROM commerce.orders WHERE merchant = $1 AND business_date = $2 ORDER BY created_at DESC', [merchant, businessDate]);
  const out: Order[] = [];
  for (const r of rows) out.push(await toOrder(q, r));
  return out;
}

/** The shop's day, in its own timezone: an 11pm sale lands on today, not tomorrow. */
export function businessDate(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// ---- Writing -----------------------------------------------------------------------------------

async function writeLines(tx: Queryable, orderId: string, lines: Priced['lines']): Promise<void> {
  for (const [i, l] of lines.entries()) {
    await tx.query(
      `INSERT INTO commerce.order_lines (id, order_id, item_id, name, note, quantity, unit_cents, options, line_cents, discount_cents, tax_kind, tax_cents, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [`oln_${randomUUID()}`, orderId, l.itemId, l.name, l.note, l.quantity, l.unitCents, JSON.stringify(l.options), l.lineCents, l.discountCents, l.taxKind, l.taxCents, i],
    );
  }
}

/** Stock for these lines is free to hold. Checked under the items' row locks, after any of this order's own holds are released. */
async function checkStock(tx: Queryable, lines: PreparedLine[]): Promise<void> {
  const need = new Map<string, { name: string; qty: number }>();
  for (const l of lines) if (l.itemId && l.stockTracked) need.set(l.itemId, { name: l.name, qty: (need.get(l.itemId)?.qty ?? 0) + l.quantity });
  for (const itemId of [...need.keys()].sort()) {
    await tx.query('SELECT 1 FROM commerce.catalog_items WHERE id = $1 FOR UPDATE', [itemId]);
    const { rows } = await tx.query<{ free: number }>('SELECT free FROM commerce.stock_levels WHERE item_id = $1', [itemId]);
    const free = rows[0]?.free ?? 0;
    const n = need.get(itemId)!;
    if (free < n.qty) throw new OrderError(free <= 0 ? `${n.name} is out of stock` : `Only ${free} ${n.name} left`, 'out_of_stock');
  }
}

const OrderStart = z.object({ customer: z.string().trim().max(120).nullable().optional(), name: z.string().trim().max(60).nullable().optional() });

/** Raising an order: prices, tax and totals worked out here, and its stock held. */
export async function createOrder(db: Db, deps: OrderDeps, input: { merchant: string; staffId: string; lines: unknown; customer?: unknown; name?: unknown }): Promise<Order> {
  const meta = OrderStart.safeParse({ customer: input.customer ?? null, name: input.name ?? null });
  if (!meta.success) throw new OrderError('That customer or order name isn’t valid', 'invalid');
  const lines = await prepareLines(db, input.merchant, input.lines);
  const priced = await price(db, deps, input.merchant, lines, null);
  const { rows: shop } = await db.query<{ timezone: string }>('SELECT timezone FROM merchant.profiles WHERE merchant = $1', [input.merchant]);
  const date = businessDate(shop[0]!.timezone);
  const id = `ord_${randomUUID()}`;
  await db.transaction(async (tx) => {
    await checkStock(tx, lines);
    // The next number for call-outs, one sequence per shop per day.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`order_number:${input.merchant}:${date}`]);
    const { rows: n } = await tx.query<{ next: number }>('SELECT COALESCE(max(number), 0) + 1 AS next FROM commerce.orders WHERE merchant = $1 AND business_date = $2', [input.merchant, date]);
    await tx.query(
      `INSERT INTO commerce.orders (id, merchant, number, name, raised_by, customer, subtotal_cents, discount_cents, tax_cents, total_cents, business_date, tax_included, tax_source, tax_calculation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, input.merchant, n[0]!.next, meta.data.name || null, input.staffId, meta.data.customer || null, priced.subtotal, priced.discount, priced.tax, priced.total, date, priced.inclusive, priced.taxSource, priced.calculationId],
    );
    await writeLines(tx, id, priced.lines);
    await settleOrder(tx, { merchant: input.merchant, orderId: id, actor: input.staffId });
  });
  return getOrder(db, input.merchant, id);
}

/** Locks an order that can still change: open, and nothing paid or being paid on it. */
async function lockEditable(tx: Queryable, merchant: string, orderId: string): Promise<OrderRow> {
  const { rows } = await tx.query<OrderRow>('SELECT * FROM commerce.orders WHERE id = $1 AND merchant = $2 FOR UPDATE', [orderId, merchant]);
  const order = rows[0];
  if (!order) throw new OrderError('No such order', 'not_found');
  const { rows: tenders } = await tx.query('SELECT 1 FROM payments.tenders WHERE order_id = $1 AND status NOT IN (\'declined\', \'cancelled\') LIMIT 1', [orderId]);
  if (order.status !== 'open' || tenders[0]) throw new OrderError('Payment has started on this order; void it to change it', 'locked');
  return order;
}

async function currentLines(tx: Queryable, orderId: string): Promise<PreparedLine[]> {
  const { rows } = await tx.query<{ item_id: string | null; name: string; note: string | null; quantity: number; unit_cents: string | number; options: ChosenOption[] | string; line_cents: string | number; tax_kind: TaxKind; category: string | null; stock_tracked: boolean | null }>(
    `SELECT l.*, i.category, i.stock_tracked FROM commerce.order_lines l LEFT JOIN commerce.catalog_items i ON i.id = l.item_id
      WHERE l.order_id = $1 AND l.removed_at IS NULL ORDER BY l.position, l.id`,
    [orderId],
  );
  return rows.map((l) => ({
    itemId: l.item_id,
    category: l.category,
    name: l.name,
    note: l.note,
    quantity: l.quantity,
    unitCents: Number(l.unit_cents),
    options: typeof l.options === 'string' ? JSON.parse(l.options) : l.options,
    lineCents: Number(l.line_cents),
    taxKind: l.tax_kind,
    stockTracked: Boolean(l.stock_tracked),
  }));
}

async function currentDiscount(tx: Queryable, orderId: string): Promise<DiscountSpec | null> {
  const { rows } = await tx.query<{ kind: 'code' | 'manual'; code_id: string | null; percent: number | null; amount_cents: string | number; label: string; reason: string | null; applied_by: string; approved_by: string | null; applies_to: string[] | null; code_amount: string | number | null }>(
    `SELECT d.*, c.applies_to, c.amount_cents AS code_amount FROM commerce.order_discounts d LEFT JOIN commerce.discount_codes c ON c.id = d.code_id
      WHERE d.order_id = $1 AND d.removed_at IS NULL`,
    [orderId],
  );
  const d = rows[0];
  if (!d) return null;
  return {
    kind: d.kind,
    codeId: d.code_id,
    percent: d.percent,
    // A manual amount is the amount asked for; a code's is the code's own.
    amountCents: d.percent !== null ? null : d.kind === 'code' ? Number(d.code_amount) : Number(d.amount_cents),
    categories: d.applies_to,
    label: d.label,
    reason: d.reason,
    appliedBy: d.applied_by,
    approvedBy: d.approved_by,
  };
}

/** Writes the order's new figures and lines, re-holding stock. Inside the caller's lock. */
async function rewrite(tx: Queryable, merchant: string, order: OrderRow, priced: Priced, spec: DiscountSpec | null, actor: string): Promise<void> {
  await tx.query('UPDATE commerce.order_lines SET removed_at = now() WHERE order_id = $1 AND removed_at IS NULL', [order.id]);
  // Release the old lines' holds before checking the new ones, so an order can keep its own stock.
  await settleOrder(tx, { merchant, orderId: order.id, actor });
  await checkStock(tx, priced.lines);
  await writeLines(tx, order.id, priced.lines);
  if (spec) {
    await tx.query('UPDATE commerce.order_discounts SET amount_cents = $2 WHERE order_id = $1 AND removed_at IS NULL', [order.id, priced.discount]);
  }
  await tx.query(
    `UPDATE commerce.orders SET subtotal_cents = $2, discount_cents = $3, tax_cents = $4, total_cents = $5, tax_included = $6, tax_source = $7, tax_calculation_id = $8, updated_at = now() WHERE id = $1`,
    [order.id, priced.subtotal, priced.discount, priced.tax, priced.total, priced.inclusive, priced.taxSource, priced.calculationId],
  );
  await settleOrder(tx, { merchant, orderId: order.id, actor });
}

/** New lines for an open order. The discount is worked out again on them, and so is the tax. */
export async function updateOrder(db: Db, deps: OrderDeps, input: { merchant: string; orderId: string; staffId: string; lines: unknown }): Promise<Order> {
  const lines = await prepareLines(db, input.merchant, input.lines);
  await db.transaction(async (tx) => {
    const order = await lockEditable(tx, input.merchant, input.orderId);
    const spec = await currentDiscount(tx, order.id);
    const priced = await price(tx, deps, input.merchant, lines, spec);
    await rewrite(tx, input.merchant, order, priced, spec, input.staffId);
  });
  return getOrder(db, input.merchant, input.orderId);
}

/**
 * One discount per order: a code, or a manual percent or amount with a reason. A manual discount
 * over the applier's limit needs a manager's or owner's PIN, someone else's, whose own limit covers
 * it. Codes were set up by a manager, so they need no PIN.
 */
export async function applyDiscount(
  db: Db,
  deps: OrderDeps,
  input: { merchant: string; orderId: string; staff: { id: string; role: Role }; request: unknown },
): Promise<Order> {
  const parsed = DiscountRequest.safeParse(input.request);
  if (!parsed.success) throw new OrderError(parsed.error.issues[0]?.message ?? 'That discount isn’t valid', 'invalid');
  const req = parsed.data;

  await db.transaction(async (tx) => {
    const order = await lockEditable(tx, input.merchant, input.orderId);
    const { rows: existing } = await tx.query('SELECT 1 FROM commerce.order_discounts WHERE order_id = $1 AND removed_at IS NULL', [order.id]);
    if (existing[0]) throw new OrderError('This order already has a discount; remove it first', 'one_discount');
    const lines = await currentLines(tx, order.id);
    let spec: DiscountSpec;

    if (req.kind === 'code') {
      const { rows } = await tx.query<{ id: string; code: string; percent: number | null; amount_cents: string | number | null; applies_to: string[] | null; starts_at: Date | null; ends_at: Date | null; once_per_customer: boolean }>(
        'SELECT * FROM commerce.discount_codes WHERE merchant = $1 AND upper(code) = upper($2) AND archived_at IS NULL',
        [input.merchant, req.code.trim()],
      );
      const c = rows[0];
      if (!c) throw new OrderError(`${req.code.toUpperCase()} isn’t a code here`, 'code_unknown');
      const now = Date.now();
      if ((c.starts_at && new Date(c.starts_at).getTime() > now) || (c.ends_at && new Date(c.ends_at).getTime() <= now)) throw new OrderError(`${c.code} isn’t running now`, 'code_not_live');
      if (c.once_per_customer) {
        if (!order.customer) throw new OrderError(`${c.code} is once per customer: add who it’s for first`, 'invalid');
        const { rows: used } = await tx.query(
          `SELECT 1 FROM commerce.order_discounts d JOIN commerce.orders o ON o.id = d.order_id
            WHERE d.code_id = $1 AND d.removed_at IS NULL AND lower(o.customer) = lower($2) AND o.status IN ('paid','refunded','partly_refunded') LIMIT 1`,
          [c.id, order.customer],
        );
        if (used[0]) throw new OrderError(`${order.customer} has used ${c.code} already`, 'code_used');
      }
      const amountCents = c.amount_cents === null ? null : Number(c.amount_cents);
      spec = {
        kind: 'code',
        codeId: c.id,
        percent: c.percent,
        amountCents,
        categories: c.applies_to,
        label: c.percent !== null ? `${c.code} · ${c.percent}% off` : `${c.code} · ${usd(amountCents!)} off`,
        reason: null,
        appliedBy: input.staff.id,
        approvedBy: null,
      };
      if (discountOn(lines, spec).amount === 0) throw new OrderError(`${c.code} doesn’t apply to anything on this order`, 'code_not_applicable');
    } else {
      if ((req.percent === null) === (req.amountCents === null)) throw new OrderError('A percent or an amount, not both', 'invalid');
      spec = {
        kind: 'manual',
        codeId: null,
        percent: req.percent,
        amountCents: req.amountCents,
        categories: null,
        label: req.percent !== null ? `${req.percent}% · ${req.reason}` : `${usd(req.amountCents!)} · ${req.reason}`,
        reason: req.reason,
        appliedBy: input.staff.id,
        approvedBy: null,
      };
      const subtotal = lines.reduce((s, l) => s + l.lineCents, 0);
      const amount = discountOn(lines, spec).amount;
      const settings = await getSettings(tx, input.merchant);
      const within = (role: Role) => {
        const limit = settings.discountLimits[role];
        return limit === null || amount * 100 <= limit * subtotal;
      };
      if (!within(input.staff.role)) {
        if (!req.approverPin) throw new OrderError('That’s more than you can give. A manager or owner can approve it with their PIN.', 'needs_approval');
        const approver = await deps.pinCheck(input.merchant, req.approverPin);
        if (!approver || approver.id === input.staff.id || approver.role === 'counter') throw new OrderError('That PIN isn’t a manager’s or owner’s', 'approver_invalid');
        if (!within(approver.role)) throw new OrderError('That’s more than they can approve too', 'approver_invalid');
        spec.approvedBy = approver.id;
      }
    }

    const priced = await price(tx, deps, input.merchant, lines, spec);
    await tx.query(
      `INSERT INTO commerce.order_discounts (id, order_id, kind, code_id, label, percent, amount_cents, reason, applied_by, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [`odc_${randomUUID()}`, order.id, spec.kind, spec.codeId, spec.label, spec.percent, priced.discount, spec.reason, spec.appliedBy, spec.approvedBy],
    );
    await audit(tx, {
      merchant: input.merchant,
      actor: input.staff.id,
      approver: spec.approvedBy,
      action: 'order.discount_applied',
      ref: { type: 'order', id: order.id },
      amountCents: priced.discount,
      detail: { kind: spec.kind, label: spec.label, percent: spec.percent, codeId: spec.codeId, reason: spec.reason },
    });
    await rewrite(tx, input.merchant, order, priced, spec, input.staff.id);
  });
  return getOrder(db, input.merchant, input.orderId);
}

export async function removeDiscount(db: Db, deps: OrderDeps, input: { merchant: string; orderId: string; staffId: string }): Promise<Order> {
  await db.transaction(async (tx) => {
    const order = await lockEditable(tx, input.merchant, input.orderId);
    await tx.query('UPDATE commerce.order_discounts SET removed_at = now() WHERE order_id = $1 AND removed_at IS NULL', [order.id]);
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'order.discount_removed', ref: { type: 'order', id: order.id } });
    const lines = await currentLines(tx, order.id);
    const priced = await price(tx, deps, input.merchant, lines, null);
    await rewrite(tx, input.merchant, order, priced, null, input.staffId);
  });
  return getOrder(db, input.merchant, input.orderId);
}
