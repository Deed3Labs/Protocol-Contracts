import type { Overview, TenderMethod } from '@clear/merchant-contracts';
import type { Queryable } from '../../db/db.js';
import { dayReports } from './drawer/closeService.js';
import { dayTips } from './drawer/tipShare.js';
import { getSettings } from './shop/shopService.js';

/**
 * Overview (card-processing prompt, Phase 8): the summary views over orders and the ledger's
 * sources. Sales by payment method, discounts, tips (by person), tax collected, refunds, top items,
 * and the end-of-day reports, for a range of business days. Every sale counts, Clear included.
 */
export async function overview(q: Queryable, input: { merchant: string; from: string; to: string; topItems?: number }): Promise<Overview> {
  const paid = `o.merchant = $1 AND o.business_date BETWEEN $2 AND $3 AND o.status IN ('paid','refunded','partly_refunded')`;
  const args = [input.merchant, input.from, input.to];

  const { rows: tenders } = await q.query<{ method: TenderMethod; n: string | number; cents: string | number }>(
    `SELECT t.method, count(*) AS n, COALESCE(sum(t.amount_cents + t.tip_cents), 0) AS cents
       FROM payments.tenders t JOIN commerce.orders o ON o.id = t.order_id
      WHERE ${paid} AND t.status IN ('authorised','approved','captured','partly_refunded','refunded')
      GROUP BY t.method`,
    args,
  );
  const byMethod = { clear: { count: 0, cents: 0 }, card: { count: 0, cents: 0 }, cash: { count: 0, cents: 0 } } as Overview['byMethod'];
  for (const t of tenders) byMethod[t.method] = { count: Number(t.n), cents: Number(t.cents) };

  const { rows: totals } = await q.query<{ orders: string | number; tax: string | number; discounted: string | number; discounts: string | number }>(
    `SELECT count(*) AS orders, COALESCE(sum(o.tax_cents), 0) AS tax, count(*) FILTER (WHERE o.discount_cents > 0) AS discounted, COALESCE(sum(o.discount_cents), 0) AS discounts
       FROM commerce.orders o WHERE ${paid}`,
    args,
  );
  const { rows: tips } = await q.query<{ staff_id: string; name: string | null; cents: string | number; cash_cents: string | number }>(
    `SELECT COALESCE(t.tip_staff_id, t.created_by) AS staff_id, s.name, sum(t.tip_cents) AS cents,
            COALESCE(sum(t.tip_cents) FILTER (WHERE t.method = 'cash'), 0) AS cash_cents
       FROM payments.tenders t JOIN commerce.orders o ON o.id = t.order_id LEFT JOIN merchant.staff s ON s.id = COALESCE(t.tip_staff_id, t.created_by)
      WHERE ${paid} AND t.tip_cents > 0 AND t.status IN ('authorised','approved','captured','partly_refunded','refunded')
      GROUP BY 1, 2 ORDER BY 3 DESC`,
    args,
  );
  const { rows: refunds } = await q.query<{ cents: string | number }>(
    `SELECT COALESCE(sum(f.amount_cents), 0) AS cents FROM payments.refunds f JOIN payments.tenders t ON t.id = f.tender_id JOIN commerce.orders o ON o.id = t.order_id
      WHERE o.merchant = $1 AND o.business_date BETWEEN $2 AND $3 AND f.status = 'succeeded'`,
    args,
  );
  const { rows: items } = await q.query<{ item_id: string | null; name: string; qty: string | number; cents: string | number }>(
    `SELECT l.item_id, CASE WHEN l.item_id IS NULL THEN 'Quick sales' ELSE max(l.name) END AS name, sum(l.quantity) AS qty, sum(l.line_cents - l.discount_cents) AS cents
       FROM commerce.order_lines l JOIN commerce.orders o ON o.id = l.order_id
      WHERE ${paid} AND l.removed_at IS NULL
      GROUP BY l.item_id ORDER BY 4 DESC LIMIT $4`,
    [...args, input.topItems ?? 5],
  );

  const reports = await dayReports(q, { merchant: input.merchant, from: input.from, to: input.to });
  let byStaff = tips.map((t) => ({ staffId: t.staff_id, name: t.name ?? '—', cents: Number(t.cents), cashCents: Number(t.cash_cents) }));
  /*
   * Shared by hours on shift: a closed day as its report shares it (what was paid), a day not yet
   * closed as it would be shared now (tipShare.ts), so Close the day shows what closing will do.
   */
  if ((await getSettings(q, input.merchant)).tips.goTo === 'hours' && tips.length) {
    const { rows: dates } = await q.query<{ d: string }>(
      `SELECT DISTINCT o.business_date::text AS d FROM payments.tenders t JOIN commerce.orders o ON o.id = t.order_id
        WHERE ${paid} AND t.tip_cents > 0 AND t.status IN ('authorised','approved','captured','partly_refunded','refunded') ORDER BY 1`,
      args,
    );
    const each = new Map<string, { cents: number; cashCents: number }>();
    for (const { d } of dates) {
      const shares = reports.find((r) => r.businessDate === d)?.tipsByStaff ?? (await dayTips(q, { merchant: input.merchant, date: d, goTo: 'hours' })).byStaff;
      for (const t of shares) {
        const e = each.get(t.staffId) ?? { cents: 0, cashCents: 0 };
        e.cents += t.cents;
        if (t.how === 'cash') e.cashCents += t.cents;
        each.set(t.staffId, e);
      }
    }
    const { rows: names } = await q.query<{ id: string; name: string }>('SELECT id, name FROM merchant.staff WHERE merchant = $1', [input.merchant]);
    byStaff = [...each]
      .map(([staffId, e]) => ({ staffId, name: names.find((n) => n.id === staffId)?.name ?? '—', ...e }))
      .filter((t) => t.cents > 0)
      .sort((a, b) => b.cents - a.cents);
  }

  return {
    from: input.from,
    to: input.to,
    takenCents: Object.values(byMethod).reduce((s, m) => s + m.cents, 0),
    orderCount: Number(totals[0]!.orders),
    byMethod,
    discounts: { count: Number(totals[0]!.discounted), cents: Number(totals[0]!.discounts) },
    tips: { cents: tips.reduce((s, t) => s + Number(t.cents), 0), byStaff },
    taxCents: Number(totals[0]!.tax),
    refundsCents: Number(refunds[0]!.cents),
    topItems: items.map((i) => ({ itemId: i.item_id, name: i.name, quantity: Number(i.qty), cents: Number(i.cents) })),
    dayReports: reports,
  };
}
