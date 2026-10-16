import { merchantDb } from '../../../config/merchantDb.js';
import type { Queryable } from '../../../db/db.js';

/**
 * Whether a payment made online may be paid over time (rule 9). Paying over time online reaches buyers
 * in any state, so it stays off in live mode until counsel signs off (spec, Open), and on in test.
 * `PAY_OVER_TIME_ONLINE=on` turns it on in live.
 */
export const overTimeOnlineInLive = () => process.env.PAY_OVER_TIME_ONLINE === 'on';

export const overTimeOnline = (livemode: boolean) => !livemode || overTimeOnlineInLive();

/**
 * For the Clear charge behind a tender: null when its order isn't online (the counter's rules apply),
 * else whether over time is allowed. A link allows it only when the shop said so.
 */
export async function onlineOverTimeForCharge(q: Queryable, chargeCode: string): Promise<boolean | null> {
  const { rows } = await q.query<{ source: string; livemode: boolean; allow_over_time: boolean | null }>(
    `SELECT o.source, o.livemode, l.allow_over_time
       FROM payments.tenders t
       JOIN commerce.orders o ON o.id = t.order_id
       LEFT JOIN payments.payment_links l ON o.source = 'link' AND l.slug = o.source_detail
      WHERE t.clear_charge_code = $1
      LIMIT 1`,
    [chargeCode],
  );
  const r = rows[0];
  if (!r || (r.source !== 'link' && r.source !== 'online')) return null;
  if (r.source === 'link' && !r.allow_over_time) return false;
  return overTimeOnline(r.livemode);
}

/**
 * The same, reading the merchant database itself: for approving a charge, which lives beside the
 * charge store. Null when there's no merchant database (a charge raised outside the merchant app).
 */
export async function onlineOverTime(chargeCode: string): Promise<boolean | null> {
  const db = await merchantDb();
  return db ? onlineOverTimeForCharge(db, chargeCode) : null;
}
