import { randomUUID } from 'node:crypto';
import { CatalogImport, type ImportResult } from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';
import { CatalogError } from './catalogService.js';

/**
 * Inventory › Import a spreadsheet: many items at once, in one transaction (all of it or none).
 *
 * A row that matches an item the shop already has (same name and detail, ignoring case and spacing)
 * adds its quantity to that item's stock as a delivery, and changes nothing else about it. Any other
 * row is a new item: it needs a price. A category of services or labour makes it a service (no
 * stock, labour's tax); anything else is goods on the shelf, in "Parts" when no category is given.
 * Rows that can't be imported are listed back with why, and the rest still go in.
 */

const key = (name: string, detail: string | null | undefined) => `${name.trim().toLowerCase().replace(/\s+/g, ' ')}|${(detail ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
const SERVICE = /^(services?|labou?r)$/i;

export async function importCatalog(db: Db, input: { merchant: string; staffId: string; body: unknown }): Promise<ImportResult> {
  const parsed = CatalogImport.safeParse(input.body);
  if (!parsed.success) throw new CatalogError(parsed.error.issues[0]?.message ?? 'That spreadsheet can’t be imported', 'invalid');
  const result: ImportResult = { created: 0, addedTo: 0, skipped: [] };
  await db.transaction(async (tx) => {
    const { rows: existing } = await tx.query<{ id: string; name: string; detail: string | null; stock_tracked: boolean }>(
      'SELECT id, name, detail, stock_tracked FROM commerce.catalog_items WHERE merchant = $1 AND archived_at IS NULL',
      [input.merchant],
    );
    const byKey = new Map(existing.map((i) => [key(i.name, i.detail), i]));
    const receive = async (itemId: string, quantity: number) =>
      tx.query(`INSERT INTO commerce.stock_movements (id, merchant, item_id, kind, quantity, reason, actor) VALUES ($1,$2,$3,'receive',$4,'Imported from a spreadsheet',$5)`, [
        `mov_${randomUUID()}`,
        input.merchant,
        itemId,
        quantity,
        input.staffId,
      ]);

    for (const [i, r] of parsed.data.rows.entries()) {
      const row = i + 1;
      const match = byKey.get(key(r.name, r.detail));
      if (match) {
        if (r.quantity && !match.stock_tracked) {
          result.skipped.push({ row, reason: `${r.name} is a service, which keeps no stock` });
          continue;
        }
        if (r.quantity) await receive(match.id, r.quantity);
        result.addedTo++;
        continue;
      }
      if (r.priceCents === null) {
        result.skipped.push({ row, reason: `${r.name} has no price` });
        continue;
      }
      const service = !!r.category && SERVICE.test(r.category.trim());
      const id = `itm_${randomUUID()}`;
      await tx.query(
        `INSERT INTO commerce.catalog_items (id, merchant, name, detail, category, price_cents, cost_cents, tax_kind, stock_tracked, reorder_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          input.merchant,
          r.name.trim(),
          r.detail?.trim() || null,
          service ? 'Services' : r.category?.trim() || 'Parts',
          r.priceCents,
          r.costCents,
          service ? 'labour' : 'goods',
          !service,
          service ? null : r.reorderAt,
          input.staffId,
        ],
      );
      if (!service && r.quantity) await receive(id, r.quantity);
      // A second row for the same item in the same file adds to the one just made.
      byKey.set(key(r.name, r.detail), { id, name: r.name, detail: r.detail, stock_tracked: !service });
      result.created++;
    }
  });
  return result;
}
