import type { SetupProgress } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { cardAvailability } from '../cards/availability.js';
import { connectorStore } from '../cards/connectorStore.js';

/**
 * Set up the till (Home): the six steps signup leaves for later.
 *
 * Four are read from the shop's own data (cards connected, a reader, an item, someone besides the
 * owner). The other two leave nothing else behind, so they're marked when they happen: starting
 * cash when it's saved or a drawer is opened, tips and discounts when either is saved or a code is
 * made. A mark is never taken back: changing starting cash again doesn't undo having set it.
 */

export type SetupMark = 'cash' | 'tips';

export async function markSetup(q: Queryable, merchant: string, mark: SetupMark): Promise<void> {
  await q.query('INSERT INTO merchant.setup_marks (merchant, mark) VALUES ($1, $2) ON CONFLICT DO NOTHING', [merchant, mark]);
}

export async function setupProgress(q: Queryable, merchant: string): Promise<SetupProgress> {
  const card = cardAvailability(await connectorStore.latest(q, merchant));
  const { rows: readers } = await q.query('SELECT 1 FROM merchant.readers WHERE merchant = $1 AND removed_at IS NULL LIMIT 1', [merchant]);
  const { rows: items } = await q.query('SELECT 1 FROM commerce.catalog_items WHERE merchant = $1 AND archived_at IS NULL LIMIT 1', [merchant]);
  const { rows: team } = await q.query<{ name: string }>(
    `SELECT name FROM merchant.staff WHERE merchant = $1 AND active AND role <> 'owner' ORDER BY created_at, name`,
    [merchant],
  );
  const { rows: marks } = await q.query<{ mark: SetupMark }>('SELECT mark FROM merchant.setup_marks WHERE merchant = $1', [merchant]);
  const marked = new Set(marks.map((m) => m.mark));
  return {
    stripe: card.available,
    reader: readers.length > 0,
    items: items.length > 0,
    team: team.map((t) => t.name),
    cash: marked.has('cash'),
    tips: marked.has('tips'),
  };
}
