import type { CardDeposit, Overview } from '@clear/merchant-contracts';

/**
 * A month's statement (Overview › Statements): what the shop took, how, what came off it, and what
 * the card processor paid out. Built from the merchant API's month (`overview`) and card deposits,
 * the same figures Overview shows, and printed with the device's print dialog, where "Save as PDF"
 * is one of the choices. Built with text nodes, never HTML strings: names are typed by people.
 */

export interface Statement {
  shop: string;
  /** "September 2026" */
  month: string;
  /** "Sep 1 – 25, 2026", or the whole month once it's over. */
  period: string;
  inProgress: boolean;
  sections: { title: string; rows: [string, number | string][] }[];
}

const METHOD = { clear: 'Clear', card: 'Card', cash: 'Cash' } as const;

export function statementOf(input: { shop: string; month: string; from: string; to: string; inProgress: boolean; overview: Overview; deposits: CardDeposit[] }): Statement {
  const o = input.overview;
  const d = (s: string) => new Date(`${s}T12:00:00`);
  const f = d(input.from);
  const t = d(input.to);
  const period = `${f.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${t.getMonth() === f.getMonth() ? t.getDate() : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${t.getFullYear()}`;
  const methods = (Object.keys(METHOD) as (keyof typeof METHOD)[])
    .filter((k) => o.byMethod[k]?.count)
    .map((k) => [`${METHOD[k]} · ${o.byMethod[k]!.count} ${o.byMethod[k]!.count === 1 ? 'sale' : 'sales'}`, o.byMethod[k]!.cents] as [string, number]);
  const sum = (k: 'grossCents' | 'processorFeeCents' | 'clearFeeCents' | 'netCents') => input.deposits.reduce((s, x) => s + x[k], 0);
  const sections: Statement['sections'] = [
    { title: 'Sales', rows: [[`Taken · ${o.orderCount} ${o.orderCount === 1 ? 'sale' : 'sales'}`, o.takenCents], ...methods] },
    {
      title: 'On those sales',
      rows: [
        [`Discounts · ${o.discounts.count}`, -o.discounts.cents],
        ['Tips', o.tips.cents],
        ['Sales tax collected', o.taxCents],
        ['Refunds', -o.refundsCents],
      ],
    },
  ];
  if (input.deposits.length)
    sections.push({
      title: 'Card deposits',
      rows: [
        [`Card sales paid out · ${input.deposits.length} ${input.deposits.length === 1 ? 'deposit' : 'deposits'}`, sum('grossCents')],
        ['Processor fees', -sum('processorFeeCents')],
        ['Clear’s fee', -sum('clearFeeCents')],
        ['To your bank', sum('netCents')],
      ],
    });
  if (o.tips.byStaff.length) sections.push({ title: 'Tips by person', rows: o.tips.byStaff.map((s) => [s.name, s.cents] as [string, number]) });
  sections.push({ title: 'Days', rows: [['Days closed', String(o.dayReports.length)]] });
  return { shop: input.shop, month: input.month, period, inProgress: input.inProgress, sections };
}

export const money = (cents: number) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

const PRINT_CSS = `
@media screen { #c-print-root { display: none } }
@media print {
  @page { size: letter; margin: 18mm }
  body > *:not(#c-print-root) { display: none !important }
  #c-print-root { display: block; font: 11pt/1.45 -apple-system, system-ui, sans-serif; color: #000; background: #fff }
  #c-print-root h1 { font-size: 18pt; margin: 0 }
  #c-print-root .sub { color: #444; margin: 2pt 0 14pt }
  #c-print-root h2 { font-size: 10pt; letter-spacing: .06em; text-transform: uppercase; margin: 14pt 0 4pt; border-bottom: 1px solid #000; padding-bottom: 2pt }
  #c-print-root .row { display: flex; justify-content: space-between; padding: 2pt 0; border-bottom: 1px solid #ddd; font-variant-numeric: tabular-nums }
  #c-print-root .foot { margin-top: 18pt; color: #444; font-size: 9pt }
}`;

function el(tag: string, cls: string | null, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The statement's printed page. Exported for tests. */
export function statementPage(s: Statement): HTMLElement {
  const page = el('div', 'page');
  page.append(el('h1', null, `${s.shop} · ${s.month}`), el('p', 'sub', `Statement for ${s.period}${s.inProgress ? ' (month in progress)' : ''}`));
  for (const sec of s.sections) {
    page.append(el('h2', null, sec.title));
    for (const [k, v] of sec.rows) {
      const r = el('div', 'row');
      r.append(el('span', null, k), el('span', null, typeof v === 'number' ? money(v) : v));
      page.append(r);
    }
  }
  page.append(el('p', 'foot', `Made by Clear on ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Card figures are as the processor paid them out.`));
  return page;
}

export function printStatement(s: Statement): void {
  document.getElementById('c-print-root')?.remove();
  document.getElementById('c-print-css')?.remove();
  const css = el('style', null, PRINT_CSS);
  css.id = 'c-print-css';
  const root = el('div', null);
  root.id = 'c-print-root';
  root.append(statementPage(s));
  document.head.append(css);
  document.body.append(root);
  const done = () => {
    root.remove();
    css.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
