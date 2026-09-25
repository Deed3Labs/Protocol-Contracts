import { type CardDeposit, type Overview, SendStatement } from '@clear/merchant-contracts';
import type { Db } from '../../db/db.js';
import { overview } from './overview.js';
import { cardDeposits } from './payouts/payoutSync.js';
import { audit } from './security/audit.js';

/**
 * A month's statement, emailed (Overview › Statements › Send to my accountant): the same figures the
 * tablet's statement shows (apps/merchant/src/overview/statement.ts), as plain text an accountant
 * can read in any mail client. Owners and managers.
 */

export class StatementError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'not_configured' | 'not_sent',
  ) {
    super(message);
    this.name = 'StatementError';
  }
}

export interface StatementMailer {
  configured(): boolean;
  send(input: { to: string; subject: string; body: string }): Promise<unknown>;
}

const money = (cents: number) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The statement's lines, a label and a figure each, under headings. Exported for tests. */
export function statementText(input: { shop: string; month: string; from: string; to: string; overview: Overview; deposits: CardDeposit[] }): string {
  const o = input.overview;
  const lines: string[] = [`${input.shop}: statement for ${input.month}`, `${input.from} to ${input.to}`, ''];
  const section = (title: string, rows: [string, string][]) => {
    lines.push(title.toUpperCase());
    const width = Math.max(...rows.map(([k]) => k.length));
    for (const [k, v] of rows) lines.push(`  ${k.padEnd(width)}  ${v}`);
    lines.push('');
  };
  const methods = (['clear', 'card', 'cash'] as const)
    .filter((k) => o.byMethod[k]?.count)
    .map((k) => [`${k === 'clear' ? 'Clear' : k === 'card' ? 'Card' : 'Cash'} (${plural(o.byMethod[k]!.count, 'sale')})`, money(o.byMethod[k]!.cents)] as [string, string]);
  section('Sales', [[`Taken (${plural(o.orderCount, 'sale')})`, money(o.takenCents)], ...methods]);
  section('On those sales', [
    [`Discounts (${o.discounts.count})`, money(-o.discounts.cents)],
    ['Tips', money(o.tips.cents)],
    ['Sales tax collected', money(o.taxCents)],
    ['Refunds', money(-o.refundsCents)],
  ]);
  if (input.deposits.length) {
    const sum = (k: 'grossCents' | 'processorFeeCents' | 'clearFeeCents' | 'netCents') => input.deposits.reduce((s, d) => s + d[k], 0);
    section('Card deposits', [
      [`Card sales paid out (${plural(input.deposits.length, 'deposit')})`, money(sum('grossCents'))],
      ['Processor fees', money(-sum('processorFeeCents'))],
      ['Clear’s fee', money(-sum('clearFeeCents'))],
      ['To the bank', money(sum('netCents'))],
    ]);
  }
  if (o.tips.byStaff.length) section('Tips by person', o.tips.byStaff.map((s) => [s.name, money(s.cents)]));
  section('Days', [['Days closed', String(o.dayReports.length)]]);
  lines.push('Card figures are as the processor paid them out. Sent from Clear.');
  return lines.join('\n');
}

export async function sendStatement(db: Db, mailer: StatementMailer, input: { merchant: string; staffId: string; body: unknown }): Promise<{ sentTo: string }> {
  const parsed = SendStatement.safeParse(input.body);
  if (!parsed.success) throw new StatementError(parsed.error.issues[0]?.message ?? 'That statement can’t be sent', 'invalid');
  if (!mailer.configured()) throw new StatementError('Email isn’t set up for Clear yet, so statements can’t be sent. Save it as a PDF instead.', 'not_configured');
  const { from, to, email } = parsed.data;
  const { rows } = await db.query<{ name: string }>('SELECT name FROM merchant.profiles WHERE merchant = $1', [input.merchant]);
  const shop = rows[0]?.name ?? 'Your shop';
  const month = new Date(`${from}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const [o, deposits] = await Promise.all([overview(db, { merchant: input.merchant, from, to }), cardDeposits(db, { merchant: input.merchant, from, to })]);
  try {
    await mailer.send({ to: email, subject: `${shop}: statement for ${month}`, body: statementText({ shop, month, from, to, overview: o, deposits }) });
  } catch (e) {
    throw new StatementError(`That didn’t send: ${e instanceof Error ? e.message : String(e)}`, 'not_sent');
  }
  await audit(db, { merchant: input.merchant, actor: input.staffId, action: 'statement.sent', ref: null, amountCents: o.takenCents, detail: { from, to, domain: email.split('@')[1] ?? '' } });
  return { sentTo: email };
}
