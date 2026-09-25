import type { CardDeposit, Order, Overview } from '@clear/merchant-contracts';
import type { OverviewModel, RecentRow } from './model';

/**
 * Overview for a live shop, from the merchant API (UI Phase 6, step 9): the month across every way
 * it was paid (Clear, card and cash), not Clear alone; the second slab (how it was paid, top items,
 * discounts, tips, tax, the end-of-day reports); card processing from the processor's deposits;
 * recent sales from the orders.
 */

const usd = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const first = (n: string) => n.split(/\s+/)[0] ?? n;
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function liveMonth(
  base: OverviewModel,
  input: { month: Overview; prev: Overview | null; deposits: CardDeposit[]; orders: Order[]; nameOf: (id: string) => string; today: string; monthName: string },
): OverviewModel {
  const { month: m, prev } = input;
  const more = m.orderCount - (prev?.orderCount ?? 0);

  // Recent: the last two days' orders, every way they were paid.
  const recent: RecentRow[] = [...input.orders]
    .filter((o) => o.status !== 'voided' && o.status !== 'open')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 6)
    .map((o) => ({
      id: o.id,
      name: o.customer ?? `Order ${o.number ?? ''}`.trim(),
      when: o.businessDate === input.today ? 'today' : 'yesterday',
      by: first(input.nameOf(o.raisedBy)),
      ...(o.status === 'paying' ? { state: 'waiting' as const } : {}),
      cents: o.totalCents + o.tipCents,
    }));

  // Card processing this month, from the processor's own fee data: its fee and Clear's.
  const processor = input.deposits.reduce((s, d) => s + d.processorFeeCents, 0);
  const clearCard = input.deposits.reduce((s, d) => s + d.clearFeeCents, 0);
  const fees = [
    ...base.fees,
    ...(input.deposits.length ? [{ t: 'Card processing', det: `Processor ${usd(processor)} · Clear ${usd(clearCard)}`, cents: processor + clearCard }] : []),
  ];

  // The month's row in the history: every way it was paid, where the history counts Clear alone.
  const label = new Date(`${input.today}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const months = base.months.some((x) => x.t === label)
    ? base.months.map((x) => (x.t === label ? { ...x, det: `${m.orderCount} charges · in progress`, cents: m.takenCents } : x))
    : [...base.months, { t: label, det: `${m.orderCount} charges · in progress`, cents: m.takenCents }];

  const tips = m.tips.cents ? `${usd(m.tips.cents)} · ${m.tips.byStaff.map((t) => `${first(t.name)} ${usd(t.cents)}`).join(', ')}` : '—';
  return {
    ...base,
    monthCents: m.takenCents,
    count: m.orderCount,
    avgCents: m.orderCount ? Math.round(m.takenCents / m.orderCount) : 0,
    vs: prev && prev.orderCount ? { cents: m.takenCents - prev.takenCents, prev: base.vs?.prev ?? 'last month' } : undefined,
    note: prev && prev.orderCount ? `${WORDS[Math.abs(more)] ?? Math.abs(more)} ${more >= 0 ? 'more' : 'fewer'} charges than ${base.vs?.prev ?? 'last month'}` : `Your ${input.monthName} so far`,
    recent,
    fees,
    months,
    more: {
      since: 'This month',
      taxNote: 'Worked out per line at each sale',
      paid: {
        clear: [m.byMethod.clear.count, m.byMethod.clear.cents],
        card: [m.byMethod.card.count, m.byMethod.card.cents],
        cash: [m.byMethod.cash.count, m.byMethod.cash.cents],
        note: 'Every sale, however it was paid',
      },
      items: m.topItems.map((i) => [i.name, i.quantity, i.cents] as [string, number, number]),
      discounts: m.discounts.count ? `${m.discounts.count} · −${usd(m.discounts.cents)}` : '—',
      tips,
      taxCents: m.taxCents,
      eod: m.dayReports.map((r) => {
        const d = r.drawer.differenceCents;
        const n = r.byMethod.clear.count + r.byMethod.card.count + r.byMethod.cash.count;
        return {
          date: dayLabel(r.businessDate),
          det: `${n} charge${n === 1 ? '' : 's'} · closed by ${first(input.nameOf(r.closedBy))}`,
          cents: r.takenCents,
          state: d === 0 ? 'Balanced' : `${d < 0 ? 'Short' : 'Over'} ${usd(Math.abs(d))}${r.drawer.signedOffBy ? ' · signed off' : ''}`,
        };
      }),
    },
  };
}
