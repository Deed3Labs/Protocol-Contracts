import type { CardDeposit, OrderWithTenders } from '@clear/merchant-contracts';
import type { MerchantCharge, PayoutPosition } from '../data/apiClient';
import { field, salesCsv } from '../overview/exportCsv';

/**
 * Settings › Advanced › Your data: everything, as spreadsheets (CSV), made on the tablet from what
 * the app already reads.
 *
 *   Every charge  since the shop joined: Overview's export over the whole history, one row a sale,
 *                 every way it was paid. The history is read 93 days at a time (the most the API
 *                 gives in one go).
 *   Every payout  Clear's payouts and the card processor's deposits, one row each, with how many
 *                 charges were in it and its fees. Clear's payouts aren't itemised by charge yet
 *                 (nothing batches charges into a payout run), so the count is what there is.
 */

type Range = { from: string; to: string };
const day = (d: Date) => d.toISOString().slice(0, 10);

/** `from`..`to` in windows of at most `days` days, oldest first. */
export function windows(from: string, to: string, days = 93): Range[] {
  const out: Range[] = [];
  let start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (start <= end) {
    const stop = new Date(Math.min(end.getTime(), start.getTime() + (days - 1) * 86_400_000));
    out.push({ from: day(start), to: day(stop) });
    start = new Date(stop.getTime() + 86_400_000);
  }
  return out;
}

/** Where the history starts: the day the shop joined, or a year back when that isn't known. */
export function since(partnerSince: string | null | undefined, today: string): string {
  const d = partnerSince?.slice(0, 10);
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today ? d : day(new Date(new Date(`${today}T00:00:00Z`).getTime() - 365 * 86_400_000));
}

export async function everyChargeCsv(input: {
  from: string;
  to: string;
  history: (r: Range) => Promise<OrderWithTenders[]>;
  clear: () => Promise<MerchantCharge[]>;
  nameOf: (staffId: string) => string;
}): Promise<string> {
  const orders: OrderWithTenders[] = [];
  for (const r of windows(input.from, input.to)) orders.push(...(await input.history(r)));
  const clear = (await input.clear()).filter((c) => c.createdAt.slice(0, 10) >= input.from);
  return salesCsv({ orders, clear, nameOf: input.nameOf });
}

export const PAYOUT_HEADER = ['Date', 'Kind', 'Reference', 'Charges', 'Gross', 'Processor fee', 'Clear fee', 'Net', 'Status'];
const dollars = (cents: number) => (cents / 100).toFixed(2);

export function everyPayoutCsv(input: { clear: PayoutPosition['paid']; deposits: CardDeposit[] }): string {
  const rows: string[][] = [
    ...input.clear.map((p) => [(p.paidAt ?? p.on).slice(0, 10), 'Clear payout', p.id, String(p.charges), dollars(p.amountCents), '', '', dollars(p.amountCents), p.paidAt ? 'paid' : 'scheduled']),
    ...input.deposits.map((d) => [d.arrivalDate, 'Card deposit', d.externalPayoutId, String(d.chargeCount), dollars(d.grossCents), dollars(d.processorFeeCents), dollars(d.clearFeeCents), dollars(d.netCents), d.status.replace('_', ' ')]),
  ];
  rows.sort((a, b) => a[0]!.localeCompare(b[0]!));
  return [PAYOUT_HEADER, ...rows].map((r) => r.map(field).join(',')).join('\r\n') + '\r\n';
}
