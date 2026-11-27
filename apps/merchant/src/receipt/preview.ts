import type { Receipt } from '@clear/merchant-contracts';

/** `/r/preview` in development: the New Charge reference's card sale, with a tip. */
export const PREVIEW_RECEIPT: Receipt = {
  shop: { name: 'Mike’s Tire', address: '412 Colton Ave, Redlands, CA' },
  orderNumber: 14,
  businessDate: '2026-09-24',
  issuedAt: '2026-09-24T23:38:00.000Z',
  lines: [
    { name: 'Michelin Defender2', quantity: 4, options: ['Road hazard warranty'], note: null, lineCents: 75600, discountCents: 0 },
    { name: 'Mount and balance', quantity: 4, options: [], note: null, lineCents: 10000, discountCents: 0 },
    { name: 'Valve stems, set of 4', quantity: 1, options: [], note: null, lineCents: 1200, discountCents: 0 },
  ],
  discount: null,
  subtotalCents: 86800,
  discountCents: 0,
  taxCents: 5952,
  taxIncluded: false,
  tipCents: 1000,
  totalCents: 92752,
  tenders: [{ method: 'card', amountCents: 92752, tipCents: 1000, card: 'Visa ending 4242', changeCents: null, status: 'captured' }],
  refundedCents: 0,
};
