import type { DayReport } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { getSettings } from '../shop/shopService.js';

/**
 * The end-of-day summary (Settings › Notifications): the day's report, emailed when the day is
 * closed, since that's when its figures are final. Best effort: a summary that can't go never
 * holds up a close, and says why in the log.
 */

export interface SummaryMailer {
  configured(): boolean;
  send(input: { to: string; subject: string; body: string }): Promise<unknown>;
}

const money = (cents: number) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

/** The summary's text. Exported for tests. */
export function daySummaryText(r: DayReport, input: { shop: string; nameOf: (id: string) => string; captureFailures: number }): { subject: string; body: string } {
  const day = new Date(`${r.businessDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const rows: [string, string][] = [['Taken', money(r.takenCents)]];
  for (const k of ['clear', 'card', 'cash'] as const) {
    const m = r.byMethod[k];
    if (m?.count) rows.push([`  ${k === 'clear' ? 'Clear' : k === 'card' ? 'Card' : 'Cash'} (${m.count})`, money(m.cents)]);
  }
  rows.push(['Tips', money(r.tipsCents)], ['Sales tax', money(r.taxCents)], ['Discounts', money(-r.discountsCents)], ['Refunds', money(-r.refundsCents)]);
  const d = r.drawer;
  const drawer: [string, string][] = [
    ['Counted', money(d.countedCents)],
    ['Expected', money(d.expectedCents)],
    ['Difference', d.differenceCents === 0 ? 'none' : `${money(d.differenceCents)}${d.signedOffBy ? `, signed off by ${input.nameOf(d.signedOffBy)}` : ''}`],
    ['To the bank', money(d.toBankCents)],
    ['Left for tomorrow', money(d.leaveCents)],
  ];
  const width = Math.max(...[...rows, ...drawer].map(([k]) => k.length));
  const line = ([k, v]: [string, string]) => `${k.padEnd(width)}  ${v}`;
  const tips = new Map<string, number>();
  for (const t of r.tipsByStaff) tips.set(t.staffId, (tips.get(t.staffId) ?? 0) + t.cents);
  const body = [
    `${input.shop}, ${day}`,
    `Closed by ${input.nameOf(r.closedBy)} at ${new Date(r.closedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`,
    '',
    ...rows.map(line),
    '',
    'THE DRAWER',
    ...drawer.map(line),
    ...(tips.size
      ? [
          '',
          r.tipsHours ? 'TIPS BY PERSON, SHARED BY HOURS ON SHIFT' : 'TIPS BY PERSON',
          ...[...tips].map(([id, c]) => {
            const m = r.tipsHours?.find((h) => h.staffId === id)?.minutes;
            return `${input.nameOf(id)}  ${money(c)}${m ? ` (${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m)` : ''}`;
          }),
        ]
      : []),
    ...(input.captureFailures ? ['', `${input.captureFailures} card ${input.captureFailures === 1 ? 'payment' : 'payments'} couldn’t be captured. Open Close the day on the tablet for what to do.`] : []),
    '',
    'Sent by Clear when the day was closed. Turn it off in Settings › Notifications.',
  ].join('\n');
  return { subject: `${input.shop}: ${money(r.takenCents)} taken ${day}`, body };
}

export async function sendDaySummary(q: Queryable, mailer: SummaryMailer | undefined, input: { merchant: string; report: DayReport; captureFailures: number }): Promise<'sent' | 'off' | 'no_email' | 'not_configured' | 'failed'> {
  if (!mailer) return 'not_configured';
  const s = await getSettings(q, input.merchant);
  if (!s.notifications.endOfDay) return 'off';
  if (!s.notifications.email) return 'no_email';
  if (!mailer.configured()) return 'not_configured';
  const { rows: shop } = await q.query<{ name: string }>('SELECT name FROM merchant.profiles WHERE merchant = $1', [input.merchant]);
  const { rows: staff } = await q.query<{ id: string; name: string }>('SELECT id, name FROM merchant.staff WHERE merchant = $1', [input.merchant]);
  const names = new Map(staff.map((x) => [x.id, x.name]));
  const { subject, body } = daySummaryText(input.report, { shop: shop[0]?.name ?? 'Your shop', nameOf: (id) => names.get(id) ?? 'Someone', captureFailures: input.captureFailures });
  try {
    await mailer.send({ to: s.notifications.email, subject, body });
    return 'sent';
  } catch (e) {
    console.error('[day summary] not sent', e instanceof Error ? e.message : e);
    return 'failed';
  }
}
