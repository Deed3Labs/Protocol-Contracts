import type { AuditEntry, CloseDayResult, CountsView, DrawerSession, Order, Overview, ShopSettings, Staff } from '@clear/merchant-contracts';
import type { DaySummary, DrawerClose } from './drawer';
import { clockTime, usd } from './model';

/**
 * Close the day for a live shop (UI Phase 6, step 7): the reference's two blocks (the day by how it
 * was paid; the drawer as the counts left it) from the merchant API. Null until the two counts
 * agree: the server shows no expected figure before then, and neither does this.
 */

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function closeDayFrom(input: {
  session: DrawerSession;
  view: CountsView;
  overview: Overview;
  orders: Order[];
  settings: ShopSettings | null;
  staff: Staff[];
  audit: AuditEntry[];
}): { day: DaySummary; drawer: DrawerClose } | null {
  const { view, overview: o } = input;
  if (view.state !== 'compared') return null;
  const nameOf = (id: string) => input.staff.find((s) => s.id === id)?.name ?? 'A counter';

  const paid = input.orders.filter((x) => ['paid', 'partly_refunded', 'refunded'].includes(x.status)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const waiting = input.orders.filter((x) => x.status === 'paying');
  const day: DaySummary = {
    date: dayLabel(input.session.businessDate),
    charges: o.orderCount,
    span: paid.length ? `${clockTime(paid[0]!.createdAt)} to ${clockTime(paid[paid.length - 1]!.createdAt)}` : '—',
    takenCents: o.takenCents,
    clear: { n: o.byMethod.clear.count, cents: o.byMethod.clear.cents },
    card: { n: o.byMethod.card.count, cents: o.byMethod.card.cents },
    cash: { n: o.byMethod.cash.count, cents: o.byMethod.cash.cents },
    tipsCents: o.tips.cents,
    taxCents: o.taxCents,
    discountsCents: o.discounts.cents,
    waiting: waiting.length ? { n: waiting.length, cents: waiting.reduce((s, x) => s + x.remainingCents, 0) } : null,
  };

  const [first, second] = [view.counts[0], view.counts[1] ?? view.counts[0]];
  const signedEntry = input.audit.find((e) => e.action === 'drawer.signed_off' && e.ref?.id === input.session.id);
  const signed =
    view.differenceCents !== 0 && !view.signoffNeeded
      ? { name: signedEntry?.approver ? nameOf(signedEntry.approver) : 'a manager', at: signedEntry ? clockTime(signedEntry.at) : 'close' }
      : undefined;
  const startingCash = input.settings?.startingCashCents ?? input.session.startingCashCents;
  const drawer: DrawerClose = {
    expectedCents: view.expectedCents,
    countedCents: first.totalCents,
    counters: [nameOf(first.counter), nameOf(second.counter)],
    ...(signed ? { signed } : {}),
    ...(typeof signedEntry?.detail.note === 'string' && signedEntry.detail.note ? { note: signedEntry.detail.note } : {}),
    // Each person's tips, split by how they were paid: cash tips come out of the drawer at close.
    tips: o.tips.byStaff.flatMap((t) => [
      ...(t.cents - t.cashCents > 0 ? [{ name: t.name, cents: t.cents - t.cashCents, how: 'card' as const }] : []),
      ...(t.cashCents > 0 ? [{ name: t.name, cents: t.cashCents, how: 'cash' as const }] : []),
    ]),
    // What stays in for tomorrow: the starting float, or all of it if there's less.
    leaveCents: Math.min(first.totalCents, startingCash),
  };
  return { day, drawer };
}

/** The locked report, as the closed screen lists it. */
export function closedSummary(r: CloseDayResult): { date: string; rows: [string, string][] } {
  const rep = r.report;
  const d = rep.drawer;
  return {
    date: dayLabel(rep.businessDate),
    rows: [
      ['Taken', usd(rep.takenCents)],
      ['Card', `${rep.byMethod.card.count} · ${usd(rep.byMethod.card.cents)}`],
      ['Cash', `${rep.byMethod.cash.count} · ${usd(rep.byMethod.cash.cents)}`],
      ['Clear', `${rep.byMethod.clear.count} · ${usd(rep.byMethod.clear.cents)}`],
      ['Tips', usd(rep.tipsCents)],
      ['Drawer', d.differenceCents === 0 ? `Counted ${usd(d.countedCents)}, as expected` : `Counted ${usd(d.countedCents)}, ${usd(Math.abs(d.differenceCents))} ${d.differenceCents < 0 ? 'short' : 'over'}`],
      ['Left for tomorrow', usd(d.leaveCents)],
      ['To the bank', usd(d.toBankCents)],
    ],
  };
}
