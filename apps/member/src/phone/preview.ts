import type { PublicBill, PublicMenu, PublicPoint, Receipt } from './types';

/**
 * Dev only (`?preview=1`): the reference's own Mi Casa Tacos at dinner, so the phone pages can be
 * looked at without a Point. `&view=menu|bill|paid` picks Table 12's state; D00R is the door.
 * Imported behind `import.meta.env.DEV`, so no production bundle has it.
 */

const SHOP = { name: 'Mi Casa Tacos' };
const BILL: PublicBill = {
  orderNumber: 141,
  lines: [
    { name: 'Al pastor', quantity: 4, lineCents: 1800 },
    { name: 'Horchata', quantity: 2, lineCents: 700 },
    { name: 'Nachos grande', quantity: 1, lineCents: 1950 },
  ],
  discountCents: 0,
  taxCents: 370,
  tipCents: 0,
  totalCents: 4820,
  remainingCents: 4820,
  sentAt: '2026-10-15T19:42:00-07:00',
};
const RECEIPT_12: Receipt = {
  shop: { name: SHOP.name, address: null },
  orderNumber: 141,
  issuedAt: '2026-10-15T19:46:00-07:00',
  lines: BILL.lines,
  discountCents: 0,
  taxCents: 370,
  tipCents: 0,
  totalCents: 4820,
  tenders: [{ method: 'card', amountCents: 4820, tipCents: 0, card: 'Visa ending 4242', changeCents: null, status: 'captured' }],
  table: 'Table 12, back patio',
  code: 'K7Q2M9XH4P',
};
/** Order 0142 at the reference's one rate (DECISIONS › Terminal Phase 4): $45.76, $4.24 change. */
const RECEIPT_0142: Receipt = {
  shop: { name: SHOP.name, address: null },
  orderNumber: 142,
  issuedAt: '2026-10-15T12:41:00-07:00',
  lines: [
    { name: 'Carne asada burrito', quantity: 2, lineCents: 2500 },
    { name: 'Chips and salsa', quantity: 1, lineCents: 450 },
    { name: 'Mexican Coke', quantity: 2, lineCents: 700 },
    { name: 'Churros', quantity: 1, lineCents: 575 },
  ],
  discountCents: 0,
  taxCents: 351,
  tipCents: 0,
  totalCents: 4576,
  tenders: [{ method: 'cash', amountCents: 4576, tipCents: 0, card: null, changeCents: 424, status: 'captured' }],
  table: null,
  code: 'R0142XXXXX',
};
const MENU: PublicMenu = {
  categories: [
    {
      name: 'Tacos',
      items: [
        { id: 'pastor', name: 'Al pastor', detail: null, priceCents: 450 },
        { id: 'asada', name: 'Carne asada', detail: null, priceCents: 500 },
        { id: 'pescado', name: 'Pescado', detail: null, priceCents: 550 },
      ],
    },
    {
      name: 'Drinks',
      items: [
        { id: 'horchata', name: 'Horchata', detail: null, priceCents: 350 },
        { id: 'jamaica', name: 'Jamaica', detail: null, priceCents: 350 },
      ],
    },
    { name: 'Dessert', items: [{ id: 'churros', name: 'Churros', detail: null, priceCents: 575 }] },
  ],
};

function point(code: string): PublicPoint {
  const base = { code, shop: SHOP, bill: null, paid: null, waitlist: null, pay: { clear: true, card: true } };
  if (code === 'D00R') return { ...base, table: null, placement: 'door', view: 'waitlist', waitlist: { quotedMinutes: 15 } };
  const view = (new URLSearchParams(window.location.search).get('view') ?? 'bill') as PublicPoint['view'];
  if (view === 'bill') return { ...base, table: 'Table 12', placement: 'table', view, bill: BILL };
  if (view === 'paid') return { ...base, table: 'Table 12', placement: 'table', view, paid: { paidAt: RECEIPT_12.issuedAt, receipt: RECEIPT_12 } };
  return { ...base, table: 'Table 12', placement: 'table', view: view === 'pay_here' ? 'pay_here' : 'menu' };
}

export async function previewCall(path: string, body?: unknown): Promise<unknown> {
  const [, kind, code, rest] = /^\/api\/([pr])\/([^/]+)\/?(.*)$/.exec(path) ?? [];
  if (kind === 'r') return rest === 'email' ? undefined : RECEIPT_0142;
  if (rest === 'menu') return MENU;
  if (rest === 'waitlist') return { position: 4, quotedMinutes: 15 };
  if (rest === 'pay') return (body as { method: string }).method === 'clear' ? { method: 'clear', chargeCode: 'K7Q2M9XH', url: `${window.location.origin}/c/K7Q2M9XH` } : { method: 'card', checkoutUrl: `${window.location.origin}/p/${code}?preview=1&view=paid` };
  return point(String(code));
}
