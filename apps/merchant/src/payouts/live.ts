import type { BankDeposit, CardDeposit, DayReport } from '@clear/merchant-contracts';
import type { HistRow, PayoutsModel } from './model';

/**
 * Payouts for a live shop, from the merchant API (UI Phase 6, step 8): card deposits (the
 * processor's payouts, with its fee and Clear's apart, from its own fee data) and the drawer's cash
 * and tips from the last close.
 */

const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayOf = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', opts);

/** Card deposits, newest first; the next one still on its way is marked. */
export function cardRows(deposits: CardDeposit[], bank: string | null): HistRow[] {
  const sorted = [...deposits].sort((a, b) => (a.arrivalDate < b.arrivalDate ? 1 : -1));
  const next = [...sorted].reverse().find((d) => d.status === 'pending' || d.status === 'in_transit');
  return sorted.map((d) => {
    const processing = d.processorFeeCents + d.clearFeeCents;
    const charges = `${d.chargeCount} charge${d.chargeCount === 1 ? '' : 's'}`;
    const det =
      d.status === 'failed'
        ? `${charges} · didn’t reach the bank; your processor is sending it again`
        : `${charges}, less ${usd(processing)} card processing${bank ? ` · to ${bank}` : ''}`;
    return {
      id: d.id,
      t: dayOf(d.arrivalDate, { weekday: 'short', month: 'short', day: 'numeric' }),
      ...(d === next ? { next: true } : {}),
      det,
      cents: d.netCents,
      card: { salesCents: d.grossCents, stripeCents: d.processorFeeCents, clearCents: d.clearFeeCents },
    };
  });
}

/** The last close's cash: what stayed in the drawer, what goes to the bank (and whether it has), tips owed. */
export function drawerCash(reports: DayReport[], deposits: BankDeposit[], nameOf: (id: string) => string): (NonNullable<PayoutsModel['drawer']> & { depositId: string | null }) | undefined {
  const r = reports[0];
  if (!r) return undefined;
  const d = deposits.find((x) => x.amountCents === r.drawer.toBankCents) ?? null;
  const cardTips = r.tipsByStaff.filter((t) => t.how === 'card');
  const tipsCents = cardTips.reduce((s, t) => s + t.cents, 0);
  const first = (id: string) => nameOf(id).split(/\s+/)[0];
  return {
    inDrawerCents: r.drawer.leaveCents,
    toBankCents: r.drawer.toBankCents,
    tipsCents,
    tipsWho: cardTips.length ? `${cardTips.map((t) => first(t.staffId)).join(', ')}, card tip${cardTips.length > 1 ? 's' : ''}, with the next payroll` : 'None on card',
    from: `From ${dayOf(r.businessDate, { weekday: 'long' })}’s close`,
    ...(d?.markedAt ? { deposited: `Deposited ${dayOf(d.markedAt.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })}${d.markedBy ? ` by ${first(d.markedBy)}` : ''}` } : {}),
    depositId: d && !d.markedAt ? d.id : null,
  };
}
