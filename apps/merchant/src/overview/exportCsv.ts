import type { OrderWithTenders } from '@clear/merchant-contracts';
import type { MerchantCharge } from '../data/apiClient';

/**
 * Overview › Export: the month's sales as a spreadsheet (CSV), one row a sale, every way it was
 * paid. Made on the tablet from the same order history Charges reads, so it says what Charges says.
 * A Clear charge raised before orders existed (no order behind it) is its own row.
 */

const dollars = (cents: number) => (cents / 100).toFixed(2);
const METHOD: Record<string, string> = { card: 'Card', cash: 'Cash', clear: 'Clear' };
/** Tenders that took money (a refund later doesn't undo that it was paid). */
const TOOK = ['authorised', 'approved', 'captured', 'refunded', 'partly_refunded'];

/** A field as CSV writes it: quoted when it has a comma, a quote or a line break. */
export function field(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const HEADER = ['Date', 'Time', 'Sale', 'Customer', 'Raised by', 'Status', 'Items', 'Subtotal', 'Discount', 'Tax', 'Tip', 'Total', 'Paid by', 'Refunded'];

function time(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
}

export function salesCsv(input: {
  orders: OrderWithTenders[];
  /** Clear charges, to add those with no order behind them. */
  clear?: MerchantCharge[];
  nameOf: (staffId: string) => string;
  timeZone?: string;
}): string {
  const rows: { at: string; cells: string[] }[] = [];
  const codes = new Set(input.orders.flatMap((o) => o.tenders.map((t) => t.clearChargeCode).filter(Boolean)));
  for (const o of input.orders) {
    if (o.status === 'open') continue;
    const paid = o.tenders.filter((t) => TOOK.includes(t.status));
    rows.push({ at: o.createdAt, cells: [
      o.businessDate,
      time(o.createdAt, input.timeZone),
      o.number ? `#${o.number}` : o.id,
      o.customer ?? '',
      input.nameOf(o.raisedBy),
      o.status,
      o.lines.map((l) => `${l.quantity} × ${l.name}`).join('; '),
      dollars(o.subtotalCents),
      dollars(o.discountCents),
      dollars(o.taxCents),
      dollars(o.tipCents),
      dollars(o.totalCents + o.tipCents),
      paid.map((t) => `${METHOD[t.method] ?? t.method}${t.cardLast4 ? ` ${t.cardBrand ?? ''} ${t.cardLast4}`.replace(/\s+/g, ' ') : ''} ${dollars(t.amountCents + t.tipCents)}`).join('; '),
      dollars(o.tenders.reduce((s, t) => s + t.refundedCents, 0)),
    ] });
  }
  for (const c of input.clear ?? []) {
    if (codes.has(c.code) || c.state !== 'approved') continue;
    const cents = Math.round(c.amount * 100);
    rows.push({ at: c.createdAt, cells: [c.createdAt.slice(0, 10), time(c.createdAt, input.timeZone), c.code, c.memberName ?? '', c.raisedBy ?? '', 'paid', '', dollars(cents), '0.00', '0.00', '0.00', dollars(cents), `Clear ${dollars(cents)}`, '0.00'] });
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  return [HEADER, ...rows.map((r) => r.cells)].map((r) => r.map(field).join(',')).join('\r\n') + '\r\n';
}
