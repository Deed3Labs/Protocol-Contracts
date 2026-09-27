import type { CloseDayFigures } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { overview } from '../overview.js';
import { CloseError, mayClose } from './closeService.js';

/**
 * What Close the day shows about the day, for whoever may close it (Settings › Closing): the day's
 * totals by how they were paid, tips, tax and discounts, and the names to put to the counts and
 * tips. The Overview itself stays a manager's (a month's figures, statements, top items); this is
 * one day of it, the day being closed.
 */
export async function closeDayFigures(q: Queryable, input: { merchant: string; sessionId: string; staffId: string }): Promise<CloseDayFigures> {
  await mayClose(q, input);
  const { rows } = await q.query<{ business_date: string | Date }>('SELECT business_date FROM payments.drawer_sessions WHERE id = $1 AND merchant = $2', [input.sessionId, input.merchant]);
  if (!rows[0]) throw new CloseError('No such drawer', 'not_found');
  const d = rows[0].business_date;
  const day = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const o = await overview(q, { merchant: input.merchant, from: day, to: day, topItems: 0 });
  const { rows: names } = await q.query<{ id: string; name: string }>('SELECT id, name FROM merchant.staff WHERE merchant = $1', [input.merchant]);
  return {
    from: o.from,
    to: o.to,
    takenCents: o.takenCents,
    orderCount: o.orderCount,
    byMethod: o.byMethod,
    discounts: o.discounts,
    tips: o.tips,
    taxCents: o.taxCents,
    names,
  };
}
