import { randomUUID } from 'node:crypto';
import {
  type CatalogItem,
  DiscountCode,
  ItemInput,
  type OptionGroup,
  type Reorder,
  StockAdjustment,
  type StockMovement,
} from '@clear/merchant-contracts';
import { z } from 'zod';
import type { Db, Queryable } from '../../../db/db.js';
import { markSetup } from '../setup/setupService.js';

/**
 * Items, their options, stock, reorders and discount codes (card-processing prompt, Phase 6;
 * the Inventory reference).
 *
 * Stock is movements (commerce.stock_movements): on hand, held and free are sums, and every change
 * is kept and can be shown ("Received · 8 from the distributor +8"). Anything that moves an item's
 * stock locks the item's row first, the same lock checkout's holds take, so a count and a sale
 * can't interleave and leave the count wrong.
 *
 * Who: everyone on shift sees items, prices and stock; cost is for managers and owners only, and
 * absent (not null) for anyone else. Changing items and stock needs a manager or owner (the
 * reference: "Stock changes need an owner or a manager"). Enforced in the routes.
 */

export class CatalogError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'invalid' | 'not_tracked' | 'code_taken' | 'archived',
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

interface ItemRow {
  id: string;
  merchant: string;
  name: string;
  detail: string | null;
  category: string;
  price_cents: string | number;
  cost_cents: string | number | null;
  tax_kind: CatalogItem['taxKind'];
  stock_tracked: boolean;
  reorder_at: number | null;
  archived_at: Date | string | null;
  on_hand: number | null;
  held: number | null;
  free: number | null;
}

const ITEM_SELECT = `SELECT i.*, l.on_hand, l.held, l.free
  FROM commerce.catalog_items i LEFT JOIN commerce.stock_levels l ON l.item_id = i.id`;

async function groupsFor(q: Queryable, itemIds: string[]): Promise<Map<string, OptionGroup[]>> {
  const out = new Map<string, OptionGroup[]>();
  if (itemIds.length === 0) return out;
  const { rows: groups } = await q.query<{ id: string; item_id: string; name: string; rule: 'one' | 'any'; required: boolean; position: number }>(
    'SELECT * FROM commerce.option_groups WHERE item_id = ANY($1::text[]) ORDER BY position, id',
    [itemIds],
  );
  const { rows: options } = await q.query<{ id: string; group_id: string; name: string; delta_cents: string | number; position: number }>(
    'SELECT o.* FROM commerce.options o JOIN commerce.option_groups g ON g.id = o.group_id WHERE g.item_id = ANY($1::text[]) ORDER BY o.position, o.id',
    [itemIds],
  );
  for (const g of groups) {
    const list = out.get(g.item_id) ?? [];
    list.push({
      id: g.id,
      name: g.name,
      rule: g.rule,
      required: g.required,
      position: g.position,
      options: options.filter((o) => o.group_id === g.id).map((o) => ({ id: o.id, name: o.name, deltaCents: Number(o.delta_cents), position: o.position })),
    });
    out.set(g.item_id, list);
  }
  return out;
}

function toItem(r: ItemRow, groups: OptionGroup[], seesCost: boolean): CatalogItem {
  return {
    id: r.id,
    shop: r.merchant,
    name: r.name,
    detail: r.detail,
    category: r.category,
    priceCents: Number(r.price_cents),
    // Absent rather than null for counter staff, so a bug that renders it has nothing to render.
    ...(seesCost ? { costCents: r.cost_cents === null ? null : Number(r.cost_cents) } : {}),
    taxKind: r.tax_kind,
    stockTracked: r.stock_tracked,
    stock: r.stock_tracked ? { onHand: r.on_hand ?? 0, held: r.held ?? 0, free: r.free ?? 0 } : null,
    reorderAt: r.reorder_at,
    optionGroups: groups,
    archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
  };
}

export async function listCatalog(q: Queryable, merchant: string, opts: { seesCost: boolean; includeArchived?: boolean }): Promise<CatalogItem[]> {
  const { rows } = await q.query<ItemRow>(
    `${ITEM_SELECT} WHERE i.merchant = $1 AND ($2 OR i.archived_at IS NULL) ORDER BY i.category, i.name`,
    [merchant, opts.includeArchived ?? false],
  );
  const groups = await groupsFor(q, rows.map((r) => r.id));
  return rows.map((r) => toItem(r, groups.get(r.id) ?? [], opts.seesCost));
}

export async function getItem(q: Queryable, merchant: string, itemId: string, seesCost: boolean): Promise<CatalogItem> {
  const { rows } = await q.query<ItemRow>(`${ITEM_SELECT} WHERE i.merchant = $1 AND i.id = $2`, [merchant, itemId]);
  if (!rows[0]) throw new CatalogError('No such item', 'not_found');
  const groups = await groupsFor(q, [itemId]);
  return toItem(rows[0], groups.get(itemId) ?? [], seesCost);
}

/** Locks an item for a stock change; checkout's holds take the same lock. */
export async function lockItem(tx: Queryable, merchant: string, itemId: string): Promise<ItemRow> {
  const { rows } = await tx.query<ItemRow>('SELECT *, NULL::int AS on_hand, NULL::int AS held, NULL::int AS free FROM commerce.catalog_items WHERE id = $1 AND merchant = $2 FOR UPDATE', [
    itemId,
    merchant,
  ]);
  if (!rows[0]) throw new CatalogError('No such item', 'not_found');
  return rows[0];
}

export async function stockLevel(tx: Queryable, itemId: string): Promise<{ onHand: number; held: number; free: number }> {
  const { rows } = await tx.query<{ on_hand: number; held: number; free: number }>('SELECT on_hand, held, free FROM commerce.stock_levels WHERE item_id = $1', [itemId]);
  return { onHand: rows[0]?.on_hand ?? 0, held: rows[0]?.held ?? 0, free: rows[0]?.free ?? 0 };
}

export async function createItem(db: Db, input: { merchant: string; staffId: string; item: unknown }): Promise<CatalogItem> {
  const parsed = ItemInput.safeParse(input.item);
  if (!parsed.success) throw new CatalogError(parsed.error.issues[0]?.message ?? 'That item isn’t valid', 'invalid');
  const i = parsed.data;
  const id = `itm_${randomUUID()}`;
  await db.query(
    `INSERT INTO commerce.catalog_items (id, merchant, name, detail, category, price_cents, cost_cents, tax_kind, stock_tracked, reorder_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, input.merchant, i.name.trim(), i.detail, i.category.trim(), i.priceCents, i.costCents, i.taxKind, i.stockTracked, i.stockTracked ? i.reorderAt : null, input.staffId],
  );
  return getItem(db, input.merchant, id, true);
}

/** New prices don't touch past charges: order lines keep the price they were sold at. */
export async function updateItem(db: Db, input: { merchant: string; itemId: string; patch: unknown }): Promise<CatalogItem> {
  const parsed = ItemInput.partial().safeParse(input.patch);
  if (!parsed.success) throw new CatalogError(parsed.error.issues[0]?.message ?? 'That change isn’t valid', 'invalid');
  const current = await getItem(db, input.merchant, input.itemId, true);
  if (current.archivedAt) throw new CatalogError('That item is archived', 'archived');
  const p = parsed.data;
  const tracked = p.stockTracked ?? current.stockTracked;
  await db.query(
    `UPDATE commerce.catalog_items SET
       name = $3, detail = $4, category = $5, price_cents = $6, cost_cents = $7, tax_kind = $8,
       stock_tracked = $9, reorder_at = $10, updated_at = now()
     WHERE id = $1 AND merchant = $2`,
    [
      input.itemId,
      input.merchant,
      (p.name ?? current.name).trim(),
      p.detail !== undefined ? p.detail : current.detail,
      (p.category ?? current.category).trim(),
      p.priceCents ?? current.priceCents,
      p.costCents !== undefined ? p.costCents : (current.costCents ?? null),
      p.taxKind ?? current.taxKind,
      tracked,
      tracked ? (p.reorderAt !== undefined ? p.reorderAt : current.reorderAt) : null,
    ],
  );
  return getItem(db, input.merchant, input.itemId, true);
}

/** Archived, never deleted: past orders still point at it. */
export async function archiveItem(db: Db, input: { merchant: string; itemId: string }): Promise<CatalogItem> {
  const { rows } = await db.query<{ id: string }>(
    'UPDATE commerce.catalog_items SET archived_at = COALESCE(archived_at, now()), updated_at = now() WHERE id = $1 AND merchant = $2 RETURNING id',
    [input.itemId, input.merchant],
  );
  if (!rows[0]) throw new CatalogError('No such item', 'not_found');
  return getItem(db, input.merchant, input.itemId, true);
}

const GroupsInput = z.array(
  z.object({
    name: z.string().trim().min(1),
    rule: z.enum(['one', 'any']),
    required: z.boolean(),
    position: z.number().int().min(0),
    options: z.array(z.object({ name: z.string().trim().min(1), deltaCents: z.number().int().safe(), position: z.number().int().min(0) })),
  }),
);

/**
 * Replaces an item's option groups. Orders keep a snapshot of what was chosen (name and price), so
 * changing options never rewrites a past sale.
 */
export async function saveOptionGroups(db: Db, input: { merchant: string; itemId: string; groups: unknown }): Promise<CatalogItem> {
  const parsed = GroupsInput.safeParse(input.groups);
  if (!parsed.success) throw new CatalogError(parsed.error.issues[0]?.message ?? 'Those options aren’t valid', 'invalid');
  for (const g of parsed.data) {
    if (g.options.length === 0) throw new CatalogError(`“${g.name}” needs at least one option`, 'invalid');
    if (new Set(g.options.map((o) => o.name.toLowerCase())).size !== g.options.length) throw new CatalogError(`Each option in “${g.name}” once`, 'invalid');
  }
  await db.transaction(async (tx) => {
    await lockItem(tx, input.merchant, input.itemId);
    await tx.query('DELETE FROM commerce.option_groups WHERE item_id = $1', [input.itemId]);
    for (const g of parsed.data) {
      const groupId = `ogr_${randomUUID()}`;
      await tx.query('INSERT INTO commerce.option_groups (id, item_id, name, rule, required, position) VALUES ($1,$2,$3,$4,$5,$6)', [groupId, input.itemId, g.name, g.rule, g.required, g.position]);
      for (const o of g.options) {
        await tx.query('INSERT INTO commerce.options (id, group_id, name, delta_cents, position) VALUES ($1,$2,$3,$4,$5)', [`opt_${randomUUID()}`, groupId, o.name, o.deltaCents, o.position]);
      }
    }
  });
  return getItem(db, input.merchant, input.itemId, true);
}

/** Receiving, returns, damage and counts, by hand. A count that finds what the books say moves nothing. */
export async function adjustStock(db: Db, input: { merchant: string; staffId: string; adjustment: unknown }): Promise<CatalogItem> {
  const parsed = StockAdjustment.safeParse(input.adjustment);
  if (!parsed.success) throw new CatalogError(parsed.error.issues[0]?.message ?? 'That stock change isn’t valid', 'invalid');
  const a = parsed.data;
  await db.transaction(async (tx) => {
    const item = await lockItem(tx, input.merchant, a.itemId);
    if (!item.stock_tracked) throw new CatalogError('That item doesn’t keep stock', 'not_tracked');
    if (item.archived_at) throw new CatalogError('That item is archived', 'archived');
    const level = await stockLevel(tx, a.itemId);
    let quantity: number;
    if (a.kind === 'count') quantity = a.found - level.onHand;
    else if (a.kind === 'damage') {
      if (a.quantity > level.onHand) throw new CatalogError(`Only ${level.onHand} on the shelf`, 'invalid');
      quantity = -a.quantity;
    } else quantity = a.quantity;
    if (quantity === 0) return;
    await tx.query(
      `INSERT INTO commerce.stock_movements (id, merchant, item_id, kind, quantity, reason, actor) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`mov_${randomUUID()}`, input.merchant, a.itemId, a.kind, quantity, a.kind === 'count' ? (a.reason ?? `was ${level.onHand}, found ${a.found}`) : a.reason, input.staffId],
    );
  });
  return getItem(db, input.merchant, a.itemId, true);
}

export async function stockHistory(q: Queryable, input: { merchant: string; itemId: string; limit?: number }): Promise<StockMovement[]> {
  const { rows } = await q.query<{ id: string; kind: StockMovement['kind']; quantity: number; reason: string | null; actor: string | null; order_id: string | null; reorder_id: string | null; created_at: Date | string }>(
    `SELECT m.id, m.kind, m.quantity, m.reason, m.actor, l.order_id, m.reorder_id, m.created_at
       FROM commerce.stock_movements m LEFT JOIN commerce.order_lines l ON l.id = m.order_line_id
      WHERE m.merchant = $1 AND m.item_id = $2
      ORDER BY m.created_at DESC, m.id DESC LIMIT $3`,
    [input.merchant, input.itemId, input.limit ?? 200],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, quantity: r.quantity, reason: r.reason, actor: r.actor, orderId: r.order_id, reorderId: r.reorder_id, at: new Date(r.created_at).toISOString() }));
}

// ---- Reorders ----------------------------------------------------------------------------------

interface ReorderRow {
  id: string;
  item_id: string;
  quantity: number;
  supplier: string | null;
  expected_on: Date | string | null;
  received_quantity: number;
  status: Reorder['status'];
}

const isoDate = (d: Date | string | null) => (d === null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const toReorder = (r: ReorderRow): Reorder => ({
  id: r.id,
  itemId: r.item_id,
  quantity: r.quantity,
  supplier: r.supplier,
  expectedOn: isoDate(r.expected_on),
  receivedQuantity: r.received_quantity,
  status: r.status,
});

/** Open ones first, then the most recent. */
export async function listReorders(q: Queryable, merchant: string): Promise<Reorder[]> {
  const { rows } = await q.query<ReorderRow>(
    `SELECT * FROM commerce.reorders WHERE merchant = $1
      ORDER BY (status IN ('open','partly_received')) DESC, created_at DESC LIMIT 200`,
    [merchant],
  );
  return rows.map(toReorder);
}

const MarkReordered = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1),
  supplier: z.string().trim().max(120).nullable(),
  expectedOn: z.iso.date().nullable(),
});

/** "Mark reordered": notes what's coming and from whom. Receiving closes it. */
export async function markReordered(db: Db, input: { merchant: string; staffId: string; reorder: unknown }): Promise<Reorder> {
  const parsed = MarkReordered.safeParse(input.reorder);
  if (!parsed.success) throw new CatalogError(parsed.error.issues[0]?.message ?? 'That reorder isn’t valid', 'invalid');
  const r = parsed.data;
  const item = await getItem(db, input.merchant, r.itemId, true);
  if (!item.stockTracked) throw new CatalogError('That item doesn’t keep stock', 'not_tracked');
  const { rows } = await db.query<ReorderRow>(
    `INSERT INTO commerce.reorders (id, merchant, item_id, quantity, supplier, expected_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [`rod_${randomUUID()}`, input.merchant, r.itemId, r.quantity, r.supplier || null, r.expectedOn, input.staffId],
  );
  return toReorder(rows[0]!);
}

/** Some or all of a reorder arrived: it goes on the shelf as a receive movement, in the same transaction. */
export async function receiveReorder(db: Db, input: { merchant: string; staffId: string; reorderId: string; quantity: number }): Promise<Reorder> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new CatalogError('Receive at least one', 'invalid');
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<ReorderRow>('SELECT * FROM commerce.reorders WHERE id = $1 AND merchant = $2 FOR UPDATE', [input.reorderId, input.merchant]);
    const r = rows[0];
    if (!r) throw new CatalogError('No such reorder', 'not_found');
    if (r.status === 'received' || r.status === 'cancelled') throw new CatalogError(`That reorder is ${r.status}`, 'invalid');
    await lockItem(tx, input.merchant, r.item_id);
    await tx.query(
      `INSERT INTO commerce.stock_movements (id, merchant, item_id, kind, quantity, reason, reorder_id, actor) VALUES ($1,$2,$3,'receive',$4,$5,$6,$7)`,
      [`mov_${randomUUID()}`, input.merchant, r.item_id, input.quantity, r.supplier ? `from ${r.supplier}` : 'reorder', r.id, input.staffId],
    );
    const received = r.received_quantity + input.quantity;
    const { rows: out } = await tx.query<ReorderRow>(
      'UPDATE commerce.reorders SET received_quantity = $2, status = $3 WHERE id = $1 RETURNING *',
      [r.id, received, received >= r.quantity ? 'received' : 'partly_received'],
    );
    return toReorder(out[0]!);
  });
}

// ---- Discount codes ----------------------------------------------------------------------------

interface CodeRow {
  id: string;
  code: string;
  percent: number | null;
  amount_cents: string | number | null;
  applies_to: string[] | null;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  once_per_customer: boolean;
  uses: string | number;
}

const toCode = (r: CodeRow): DiscountCode => ({
  id: r.id,
  code: r.code,
  percent: r.percent,
  amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
  appliesTo: r.applies_to ? { categories: r.applies_to } : { all: true },
  startsAt: r.starts_at ? new Date(r.starts_at).toISOString() : null,
  endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
  oncePerCustomer: r.once_per_customer,
  uses: Number(r.uses),
});

/** Uses are counted from the orders that kept the code, not stored, so they can't drift. */
const CODE_SELECT = `SELECT c.*,
    (SELECT count(*) FROM commerce.order_discounts d JOIN commerce.orders o ON o.id = d.order_id
      WHERE d.code_id = c.id AND d.removed_at IS NULL AND o.status IN ('paid','refunded','partly_refunded')) AS uses
  FROM commerce.discount_codes c`;

export async function listDiscountCodes(q: Queryable, merchant: string): Promise<DiscountCode[]> {
  const { rows } = await q.query<CodeRow>(`${CODE_SELECT} WHERE c.merchant = $1 AND c.archived_at IS NULL ORDER BY c.created_at DESC`, [merchant]);
  return rows.map(toCode);
}

export async function createDiscountCode(db: Db, input: { merchant: string; staffId: string; code: unknown }): Promise<DiscountCode> {
  const parsed = DiscountCode.safeParse({ ...(input.code as object), id: 'new', uses: 0 });
  if (!parsed.success) throw new CatalogError(parsed.error.issues[0]?.message ?? 'That code isn’t valid', 'invalid');
  const c = parsed.data;
  const code = c.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(code)) throw new CatalogError('Letters, numbers, - and _ only', 'invalid');
  if (c.startsAt && c.endsAt && c.endsAt <= c.startsAt) throw new CatalogError('It has to end after it starts', 'invalid');
  const id = `dsc_${randomUUID()}`;
  try {
    await db.query(
      `INSERT INTO commerce.discount_codes (id, merchant, code, percent, amount_cents, applies_to, starts_at, ends_at, once_per_customer, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, input.merchant, code, c.percent, c.amountCents, 'categories' in c.appliesTo ? c.appliesTo.categories : null, c.startsAt, c.endsAt, c.oncePerCustomer, input.staffId],
    );
  } catch (error) {
    if (String((error as { code?: string }).code) === '23505') throw new CatalogError(`${code} is already a code`, 'code_taken');
    throw error;
  }
  await markSetup(db, input.merchant, 'tips');
  const { rows } = await db.query<CodeRow>(`${CODE_SELECT} WHERE c.id = $1`, [id]);
  return toCode(rows[0]!);
}
