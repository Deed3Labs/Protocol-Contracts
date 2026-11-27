import type { Receipt } from '@clear/merchant-contracts';

/**
 * Print a receipt on whatever printer this device can reach: the system's print dialog (AirPrint on
 * an iPad, the Android print service, a browser's own). A counter printer on the network or paired
 * to the tablet shows up there. There is no printer SDK here; one would replace this file.
 *
 * The receipt is laid out for 80mm receipt paper and built from the order's receipt (GET
 * /orders/:id/receipt), so a refund taken later shows on a reprint. Built with text nodes, never
 * HTML strings: item names and notes are typed by staff.
 */

const usd = (cents: number) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

const PRINT_CSS = `
@media screen { #c-print-root { display: none } }
@media print {
  @page { size: 80mm auto; margin: 4mm }
  body > *:not(#c-print-root) { display: none !important }
  #c-print-root { display: block; font: 12px/1.4 ui-monospace, Menlo, monospace; color: #000; background: #fff }
  #c-print-root .r { break-after: page; width: 72mm }
  #c-print-root .r:last-child { break-after: auto }
  #c-print-root h1 { font-size: 14px; margin: 0 0 2px; text-align: center }
  #c-print-root .c { text-align: center; margin: 0 }
  #c-print-root .row { display: flex; justify-content: space-between; gap: 8px }
  #c-print-root .sub { padding-left: 12px; color: #333 }
  #c-print-root hr { border: 0; border-top: 1px dashed #000; margin: 6px 0 }
  #c-print-root .b { font-weight: 700 }
}`;

function el(tag: string, cls: string | null, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function row(left: string, right: string, cls = 'row'): HTMLElement {
  const r = el('div', cls);
  r.append(el('span', null, left), el('span', null, right));
  return r;
}

/** The receipt's printed lines: what the paper says, in order. Exported for tests. */
export function receiptSheet(r: Receipt): HTMLElement {
  const box = el('div', 'r');
  box.append(el('h1', null, r.shop.name));
  if (r.shop.address) box.append(el('p', 'c', r.shop.address));
  const when = new Date(r.issuedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  box.append(el('p', 'c', `${when}${r.orderNumber ? ` · Order ${r.orderNumber}` : ''}`), el('hr', null));
  for (const l of r.lines) {
    box.append(row(`${l.quantity} × ${l.name}`, usd(l.lineCents)));
    for (const o of l.options) box.append(el('div', 'sub', o));
    if (l.note) box.append(el('div', 'sub', l.note));
  }
  box.append(el('hr', null), row('Subtotal', usd(r.subtotalCents)));
  if (r.discount) box.append(row(r.discount.label, usd(-r.discount.amountCents)));
  box.append(row(r.taxIncluded ? 'Tax included' : 'Tax', usd(r.taxCents)));
  if (r.tipCents) box.append(row('Tip', usd(r.tipCents)));
  box.append(row('Total', usd(r.totalCents + r.tipCents), 'row b'), el('hr', null));
  for (const t of r.tenders) {
    const how = t.method === 'card' ? (t.card ?? 'Card') : t.method === 'cash' ? 'Cash' : 'Clear';
    box.append(row(how, usd(t.amountCents + t.tipCents)));
    if (t.changeCents) box.append(row('Change', usd(t.changeCents), 'row sub'));
  }
  if (r.refundedCents) box.append(row('Refunded', usd(-r.refundedCents)));
  box.append(el('hr', null), el('p', 'c', 'Thank you'));
  return box;
}

export function printReceipt(r: Receipt, copies = 1): void {
  document.getElementById('c-print-root')?.remove();
  document.getElementById('c-print-css')?.remove();
  const css = el('style', null, PRINT_CSS);
  css.id = 'c-print-css';
  const root = el('div', null);
  root.id = 'c-print-root';
  for (let i = 0; i < Math.max(1, copies); i++) root.append(receiptSheet(r));
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
