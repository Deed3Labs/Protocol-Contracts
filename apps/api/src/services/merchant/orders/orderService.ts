import { randomUUID } from 'node:crypto';
import {
  type ChosenOption,
  CreateOrder,
  DiscountRequest,
  LineInput,
  type Order,
  type OrderDiscount,
  type OrderSource,
  sourceHasStaff,
  type OrderLine,
  orderStatus,
  type Role,
  type TaxKind,
  type Tender,
  type TenderState,
} from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { getSettings } from '../shop/shopService.js';
import type { TaxApi } from '../tax/taxApi.js';
import { type OrderTax, taxForOrder } from '../tax/taxService.js';
import { settleOrder } from './settle.js';
import { audit } from '../security/audit.js';
import { type TenderRow, toTender } from '../cards/cardTenders.js';
import { attachTab } from '../terminal/tabs.js';
import { TerminalError } from '../terminal/errors.js';
import { RewardsError } from '../rewards/errors.js';
import { openClaim, rewardAmountNow, rewardSpecFor, setOrderMember } from '../rewards/counter.js';

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
  kind: 'code' | 'manual' | 'reward';
  codeId: string | null;
  percent: number | null;
  amountCents: number | null;
  /** Categories the discount applies to; null for everything. */
  categories: string[] | null;
  label: string;
  reason: string | null;
  appliedBy: string | null;
  approvedBy: string | null;
  /** A reward: which, its points, and the counter code it came from. */
  rewardId?: string | null;
  points?: number | null;
  claimId?: string | null;
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
  raised_by: string | null;
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
  table_id?: string | null;
  service_type?: Order['serviceType'];
  delivery_partner?: string | null;
  called_at?: Date | string | null;
  picked_up_at?: Date | string | null;
  offline?: boolean;
  member_person?: string | null;
  member_added_by?: string | null;
  member_added_via?: 'code' | 'phone' | 'claim' | 'app' | null;
  member_added_at?: Date | string | null;
  source?: OrderSource;
  source_detail?: string | null;
  livemode?: boolean;
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
  const { rows: discounts } = await q.query<{ kind: 'code' | 'manual' | 'reward'; code_id: string | null; label: string; amount_cents: string | number; reason: string | null; approved_by: string | null; reward_id: string | null; reward_points: number | null }>(
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
    ? { kind: d.kind, codeId: d.code_id, label: d.label, amountCents: Number(d.amount_cents), reason: d.reason, approvedBy: d.approved_by, ...(d.kind === 'reward' ? { rewardId: d.reward_id, points: d.reward_points } : {}) }
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
    tableId: r.table_id ?? null,
    serviceType: r.service_type ?? null,
    deliveryPartner: r.delivery_partner ?? null,
    calledAt: r.called_at ? new Date(r.called_at).toISOString() : null,
    pickedUpAt: r.picked_up_at ? new Date(r.picked_up_at).toISOString() : null,
    offline: Boolean(r.offline),
    member: r.member_person
      ? { memberId: r.member_person, addedBy: r.member_added_by ?? null, addedVia: r.member_added_via ?? 'app', at: new Date(r.member_added_at ?? r.created_at).toISOString() }
      : null,
    source: r.source ?? 'counter',
    sourceDetail: r.source_detail ?? null,
    livemode: r.livemode ?? true,
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

/**
 * Orders over a range of business days, newest first, each with its tenders: the Charges list's
 * card, cash and split sales, and a sale opened. A range, so a month is one request.
 */
export async function listOrderHistory(q: Queryable, merchant: string, from: string, to: string): Promise<Array<Order & { tenders: Tender[] }>> {
  const { rows } = await q.query<OrderRow>(
    'SELECT * FROM commerce.orders WHERE merchant = $1 AND business_date BETWEEN $2 AND $3 ORDER BY created_at DESC',
    [merchant, from, to],
  );
  const { rows: tenders } = rows.length
    ? await q.query<TenderRow>('SELECT * FROM payments.tenders WHERE order_id = ANY($1) ORDER BY created_at, id', [rows.map((r) => r.id)])
    : { rows: [] as TenderRow[] };
  const out: Array<Order & { tenders: Tender[] }> = [];
  for (const r of rows) out.push({ ...(await toOrder(q, r)), tenders: tenders.filter((t) => t.order_id === r.id).map(toTender) });
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

/**
 * What these lines would come to, priced and taxed as an order would be, without raising one: a
 * payment link's page shows it before anyone pays.
 */
export async function quoteLines(db: Db, deps: OrderDeps, merchant: string, lines: unknown): Promise<{ lines: Priced['lines']; subtotal: number; tax: number; total: number }> {
  const priced = await price(db, deps, merchant, await prepareLines(db, merchant, lines), null);
  return { lines: priced.lines, subtotal: priced.subtotal, tax: priced.tax, total: priced.total };
}

/** Where an order nobody at the shop raised came from: a website or a link, and whether it's a test. */
export interface OnlineSource {
  source: Extract<OrderSource, 'online' | 'link'>;
  /** The website's origin, or the link's slug; null for a payment the shop's server made, until a page opens it. */
  detail: string | null;
  livemode: boolean;
  /**
   * A payment the shop's server made (`POST /v1/payments`): its own lines and the tax it worked out,
   * kept as they are. The lines aren't Inventory's, so nothing is priced or held here.
   */
  given?: { lines: Array<{ name: string; unitCents: number; quantity: number }>; taxCents: number };
}

/**
 * Raising an order: prices, tax and totals worked out here, and its stock held. A table's order
 * becomes its tab. With a key, a retry is the same order. An order rung up offline keeps the
 * tablet's subtotal, tax and total (the customer paid that and had their change): its lines are
 * priced here, its tax is the tablet's spread across them, and stock is taken without the check.
 * A website's or a link's order has no staff member, and says where it came from (`online`).
 */
export async function createOrder(
  db: Db,
  deps: OrderDeps,
  input: { merchant: string; staffId: string | null; lines: unknown; customer?: unknown; name?: unknown; request?: Record<string, unknown>; now?: Date; online?: OnlineSource },
): Promise<Order> {
  if (input.staffId === null && (!input.online || sourceHasStaff(input.online.source))) throw new OrderError('Only a website’s or a link’s order has nobody behind it', 'invalid');
  // The lines go through prepareLines, which says what's wrong with one; the rest through the contract.
  const parsed = CreateOrder.omit({ lines: true }).safeParse({ customer: input.customer ?? null, name: input.name ?? null, ...(input.request ?? {}) });
  if (!parsed.success) throw new OrderError(parsed.error.issues[0]?.message ?? 'That customer or order name isn’t valid', 'invalid');
  const r = parsed.data;
  if (r.customer !== null && r.customer.trim().length > 120) throw new OrderError('That customer or order name isn’t valid', 'invalid');
  if (r.idempotencyKey) {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM commerce.orders WHERE merchant = $1 AND idempotency_key = $2', [input.merchant, r.idempotencyKey]);
    if (rows[0]) return getOrder(db, input.merchant, rows[0].id);
  }
  const given = input.online?.given;
  const lines: PreparedLine[] = given
    ? given.lines.map((l) => ({ itemId: null, category: null, name: l.name, note: null, quantity: l.quantity, unitCents: l.unitCents, options: [], lineCents: l.unitCents * l.quantity, taxKind: 'exempt', stockTracked: false }))
    : await prepareLines(db, input.merchant, input.lines);
  const off = r.offline;
  let priced: Priced;
  if (given) {
    // The shop's server worked out the tax; it's spread across the lines as an offline sale's is,
    // and the amount is the lines and that tax (never tax-inclusive).
    const subtotal = lines.reduce((s, l) => s + l.lineCents, 0);
    const shares = allocate(lines.map((l) => l.lineCents), given.taxCents);
    priced = {
      lines: lines.map((l, i) => ({ ...l, discountCents: 0, taxCents: shares[i]! })),
      subtotal,
      discount: 0,
      tax: given.taxCents,
      total: subtotal + given.taxCents,
      inclusive: false,
      taxSource: 'none',
      calculationId: null,
    };
  } else if (off) {
    if (off.totalCents !== off.subtotalCents + off.taxCents) throw new OrderError('An offline order’s total is its subtotal and tax', 'invalid');
    const settings = await getSettings(db, input.merchant);
    const shares = allocate(lines.map((l) => l.lineCents), off.taxCents);
    priced = {
      lines: lines.map((l, i) => ({ ...l, discountCents: 0, taxCents: shares[i]! })),
      subtotal: off.subtotalCents,
      discount: 0,
      tax: off.taxCents,
      total: off.totalCents,
      inclusive: settings.tax.pricesIncludeTax,
      taxSource: 'none',
      calculationId: null,
    };
  } else {
    priced = await price(db, deps, input.merchant, lines, null);
  }
  const { rows: shop } = await db.query<{ timezone: string }>('SELECT timezone FROM merchant.profiles WHERE merchant = $1', [input.merchant]);
  const at = off ? new Date(off.createdAt) : (input.now ?? new Date());
  const date = businessDate(shop[0]!.timezone, at);
  const id = `ord_${randomUUID()}`;
  await db.transaction(async (tx) => {
    if (!off) await checkStock(tx, lines);
    // The next number for call-outs, one sequence per shop per day.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`order_number:${input.merchant}:${date}`]);
    const { rows: n } = await tx.query<{ next: number }>('SELECT COALESCE(max(number), 0) + 1 AS next FROM commerce.orders WHERE merchant = $1 AND business_date = $2', [input.merchant, date]);
    await tx.query(
      `INSERT INTO commerce.orders (id, merchant, number, name, raised_by, customer, subtotal_cents, discount_cents, tax_cents, total_cents, business_date, tax_included, tax_source, tax_calculation_id,
          table_id, service_type, delivery_partner, idempotency_key, offline, created_at, source, source_detail, livemode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        id,
        input.merchant,
        n[0]!.next,
        r.name || null,
        input.staffId,
        r.customer?.trim() || null,
        priced.subtotal,
        priced.discount,
        priced.tax,
        priced.total,
        date,
        priced.inclusive,
        priced.taxSource,
        priced.calculationId,
        r.tableId ?? null,
        r.serviceType ?? (r.tableId ? 'dine_in' : null),
        r.deliveryPartner ?? null,
        r.idempotencyKey ?? null,
        Boolean(off),
        at,
        input.online?.source ?? 'counter',
        input.online?.detail ?? null,
        input.online?.livemode ?? true,
      ],
    );
    if (r.tableId) {
      await attachTab(tx, { merchant: input.merchant, tableId: r.tableId, orderId: id, now: at }).catch((error) => {
        if (error instanceof TerminalError) throw new OrderError(error.message, error.code === 'not_found' ? 'invalid' : 'locked');
        throw error;
      });
    }
    await writeLines(tx, id, priced.lines);
    await settleOrder(tx, { merchant: input.merchant, orderId: id, actor: input.staffId });
    if (off) {
      const gross = lines.reduce((s, l) => s + l.lineCents, 0);
      await audit(tx, {
        merchant: input.merchant,
        actor: input.staffId,
        action: 'order.offline_synced',
        ref: { type: 'order', id },
        amountCents: off.totalCents,
        detail: { rungUpAt: off.createdAt, pricedHere: gross, tabletSubtotal: off.subtotalCents },
      });
    }
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
  const { rows } = await tx.query<{ kind: 'code' | 'manual' | 'reward'; code_id: string | null; percent: number | null; amount_cents: string | number; label: string; reason: string | null; applied_by: string | null; approved_by: string | null; applies_to: string[] | null; code_amount: string | number | null; reward_id: string | null; reward_points: number | null; claim_id: string | null; merchant: string }>(
    `SELECT d.*, c.applies_to, c.amount_cents AS code_amount, o.merchant FROM commerce.order_discounts d LEFT JOIN commerce.discount_codes c ON c.id = d.code_id
       JOIN commerce.orders o ON o.id = d.order_id
      WHERE d.order_id = $1 AND d.removed_at IS NULL`,
    [orderId],
  );
  const d = rows[0];
  if (!d) return null;
  if (d.kind === 'reward' && d.reward_id) {
    // An item reward follows the cart: a free drink is still the drink's price after a change.
    const now = await rewardAmountNow(tx, d.merchant, orderId, d.reward_id);
    return { kind: 'reward', codeId: null, percent: now.percent, amountCents: now.amountCents, categories: now.categories, label: d.label, reason: d.reason, appliedBy: d.applied_by, approvedBy: null, rewardId: d.reward_id, points: d.reward_points, claimId: d.claim_id };
  }
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
async function rewrite(tx: Queryable, merchant: string, order: OrderRow, priced: Priced, spec: DiscountSpec | null, actor: string | null): Promise<void> {
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

    if (req.kind === 'reward' || req.kind === 'claim') {
      spec = await rewardSpec(tx, { merchant: input.merchant, order, staffId: input.staff.id, request: req });
    } else if (req.kind === 'code') {
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
    await insertDiscount(tx, order.id, spec, priced.discount);
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

async function insertDiscount(tx: Queryable, orderId: string, spec: DiscountSpec, amountCents: number): Promise<void> {
  await tx.query(
    `INSERT INTO commerce.order_discounts (id, order_id, kind, code_id, label, percent, amount_cents, reason, applied_by, approved_by, reward_id, reward_points, claim_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [`odc_${randomUUID()}`, orderId, spec.kind, spec.codeId, spec.label, spec.percent, amountCents, spec.reason, spec.appliedBy, spec.approvedBy, spec.rewardId ?? null, spec.points ?? null, spec.claimId ?? null],
  );
  if (spec.claimId) await tx.query('UPDATE rewards.reward_claims SET order_id = $2 WHERE id = $1', [spec.claimId, orderId]);
}

const REWARD_TO_ORDER: Record<RewardsError['code'], OrderError['code']> = {
  not_found: 'invalid',
  invalid: 'invalid',
  forbidden: 'invalid',
  scope: 'invalid',
  conflict: 'locked',
  not_joined: 'invalid',
  needs_clear: 'invalid',
  limit: 'invalid',
  expired: 'invalid',
  not_enough: 'invalid',
  unavailable: 'invalid',
};

/**
 * A reward as the order's discount: the added customer's (`reward`), or a counter code they claimed
 * in their app (`claim`), which adds them when nobody is on the order. Points come off when it's paid.
 */
async function rewardSpec(
  tx: Queryable,
  input: { merchant: string; order: OrderRow & { member_person?: string | null }; staffId: string | null; request: { kind: 'reward'; rewardId: string } | { kind: 'claim'; code: string } },
): Promise<DiscountSpec> {
  try {
    let personId = input.order.member_person ?? null;
    let rewardId: string;
    let claimId: string | null = null;
    if (input.request.kind === 'claim') {
      const claim = await openClaim(tx, { merchant: input.merchant, code: input.request.code, orderId: input.order.id });
      if (personId && personId !== claim.personId) throw new RewardsError('That code is someone else’s', 'conflict');
      if (!personId) {
        await setOrderMember(tx, { merchant: input.merchant, orderId: input.order.id, personId: claim.personId, by: input.staffId, via: 'claim' });
        personId = claim.personId;
      }
      rewardId = claim.rewardId;
      claimId = claim.id;
    } else {
      if (!personId) throw new RewardsError('Add the customer first', 'conflict');
      rewardId = input.request.rewardId;
    }
    const r = await rewardSpecFor(tx, { merchant: input.merchant, orderId: input.order.id, personId, rewardId, claimId });
    return {
      kind: 'reward',
      codeId: null,
      percent: r.percent,
      amountCents: r.amountCents,
      categories: r.categories,
      label: r.name,
      reason: `Reward · ${r.points} points`,
      appliedBy: input.staffId,
      approvedBy: null,
      rewardId: r.rewardId,
      points: r.points,
      claimId: r.claimId,
    };
  } catch (error) {
    if (error instanceof RewardsError) throw new OrderError(error.message, REWARD_TO_ORDER[error.code]);
    throw error;
  }
}

/**
 * The customer's own reward, from a Point's bill in their app (rewards spec, section 3): the same
 * discount the counter would apply, with no staff member on it.
 */
export async function applyCustomerReward(db: Db, deps: OrderDeps, input: { merchant: string; orderId: string; personId: string; rewardId: string }): Promise<Order> {
  await db.transaction(async (tx) => {
    const order = await lockEditable(tx, input.merchant, input.orderId);
    const { rows: existing } = await tx.query<{ reward_id: string | null }>('SELECT reward_id FROM commerce.order_discounts WHERE order_id = $1 AND removed_at IS NULL', [order.id]);
    if (existing[0]?.reward_id === input.rewardId) return;
    if (existing[0]) throw new OrderError('This order already has a discount; remove it first', 'one_discount');
    const withMember = order as OrderRow & { member_person?: string | null };
    if (withMember.member_person && withMember.member_person !== input.personId) throw new OrderError('This order is someone else’s', 'locked');
    if (!withMember.member_person) {
      await setOrderMember(tx, { merchant: input.merchant, orderId: order.id, personId: input.personId, by: null, via: 'app' }).catch((e) => {
        if (e instanceof RewardsError) throw new OrderError(e.message, REWARD_TO_ORDER[e.code]);
        throw e;
      });
      withMember.member_person = input.personId;
    }
    const spec = await rewardSpec(tx, { merchant: input.merchant, order: withMember, staffId: null, request: { kind: 'reward', rewardId: input.rewardId } });
    const lines = await currentLines(tx, order.id);
    const priced = await price(tx, deps, input.merchant, lines, spec);
    await insertDiscount(tx, order.id, spec, priced.discount);
    await audit(tx, { merchant: input.merchant, actor: null, action: 'order.discount_applied', ref: { type: 'order', id: order.id }, amountCents: priced.discount, detail: { kind: 'reward', label: spec.label, rewardId: spec.rewardId, by: 'customer' } });
    await rewrite(tx, input.merchant, order, priced, spec, order.raised_by);
  });
  return getOrder(db, input.merchant, input.orderId);
}

export async function removeDiscount(db: Db, deps: OrderDeps, input: { merchant: string; orderId: string; staffId: string }): Promise<Order> {
  await db.transaction(async (tx) => {
    const order = await lockEditable(tx, input.merchant, input.orderId);
    // A claimed code goes back to being good, until it runs out.
    await tx.query('UPDATE rewards.reward_claims SET order_id = NULL WHERE id IN (SELECT claim_id FROM commerce.order_discounts WHERE order_id = $1 AND removed_at IS NULL AND claim_id IS NOT NULL)', [order.id]);
    await tx.query('UPDATE commerce.order_discounts SET removed_at = now() WHERE order_id = $1 AND removed_at IS NULL', [order.id]);
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'order.discount_removed', ref: { type: 'order', id: order.id } });
    const lines = await currentLines(tx, order.id);
    const priced = await price(tx, deps, input.merchant, lines, null);
    await rewrite(tx, input.merchant, order, priced, null, input.staffId);
  });
  return getOrder(db, input.merchant, input.orderId);
}

/**
 * An order's figures as they would be with a reward on it, without saving anything: the bill a
 * customer sees in their app with the reward line switched on, and its lines after their share.
 */
export async function priceWithReward(
  q: Queryable,
  deps: OrderDeps,
  input: { merchant: string; orderId: string; reward: { percent: number | null; amountCents: number | null; categories: string[] | null } | null },
): Promise<{ discountCents: number; taxCents: number; totalCents: number; lines: Array<{ netCents: number; category: string | null }> }> {
  const lines = await currentLines(q, input.orderId);
  const spec: DiscountSpec | null = input.reward
    ? { kind: 'reward', codeId: null, percent: input.reward.percent, amountCents: input.reward.amountCents, categories: input.reward.categories, label: '', reason: null, appliedBy: null, approvedBy: null }
    : await currentDiscount(q, input.orderId);
  const priced = await price(q, deps, input.merchant, lines, spec);
  return {
    discountCents: priced.discount,
    taxCents: priced.tax,
    totalCents: priced.total,
    lines: priced.lines.map((l) => ({ netCents: l.lineCents - l.discountCents, category: l.category })),
  };
}
