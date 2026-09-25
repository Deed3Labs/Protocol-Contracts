import { DEFAULT_SETTINGS } from '@clear/merchant-contracts';
import type { CatalogItem, DiscountCode, LineInput, Reader, Reorder, Shop, ShopHours, ShopSettings, Staff } from '@clear/merchant-contracts';
import { GOODYEAR_ON_ORDER, INVENTORY } from '../../inventory/model';

/**
 * The mock's seed: the reference scenario (UI prompt, Phase 3), in the contract's shapes. Mike's
 * Tire on Tue, Sep 22. Figures come from the reference constants the screens already use
 * (inventory/model.ts), so a number lives in one place.
 */

export const REFERENCE_DAY = '2026-09-22';
export const YESTERDAY = '2026-09-21';
/** 4:41pm on the reference day, in Los Angeles (UTC−7 in September). */
export const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-07:00`).toISOString();

export const SHOP: Shop = {
  id: '0x4d696b65735469726500000000000000000000a1',
  name: 'Mike’s Tire',
  address: { line1: '412 Colton Ave', line2: null, city: 'Redlands', region: 'CA', postalCode: '92374', country: 'US' },
  timezone: 'America/Los_Angeles',
  currency: 'usd',
  cardPlan: { kind: 'payg' },
  // Founding: 1.25% paid now, 2.0% over time (standard is 1.5% and 2.5%).
  clearTier: { tier: 'founding', paidNowBps: 125, overTimeBps: 200 },
  listing: { category: 'Auto repair, Tires', oneLine: 'Tires, brakes and alignment', phone: '(909) 555-0142', email: 'hello@mikestire.com' },
};

/** The Settings reference's week: Monday to Thursday 8 to 6, Friday to 4, Saturday 9 to 2, closed Sunday. */
export const HOURS: ShopHours = {
  week: [
    ['08:00', '18:00'],
    ['08:00', '18:00'],
    ['08:00', '18:00'],
    ['08:00', '18:00'],
    ['08:00', '16:00'],
    ['09:00', '14:00'],
    null,
  ].map((o, day) => ({ day, open: o ? { from: o[0]!, to: o[1]! } : null })),
  dates: [
    { date: '2026-11-26', label: 'Thanksgiving', open: null },
    { date: '2026-12-24', label: 'Christmas Eve', open: { from: '08:00', to: '12:00' } },
  ],
};

export const STAFF: Staff[] = [
  { id: 'stf_jen', name: 'Jen R.', role: 'counter', active: true },
  { id: 'stf_luis', name: 'Luis M.', role: 'manager', active: true },
  { id: 'stf_mike', name: 'Mike R.', role: 'owner', active: true },
  { id: 'stf_ana', name: 'Ana Ruiz', role: 'counter', active: true },
];
export const STAFF_ID = { jen: 'stf_jen', luis: 'stf_luis', mike: 'stf_mike', ana: 'stf_ana' } as const;
/** PINs in the mock: a manager's or owner's approves. */
export const MOCK_PINS: Record<string, string> = { '1111': STAFF_ID.jen, '2222': STAFF_ID.luis, '9999': STAFF_ID.mike, '3333': STAFF_ID.ana };

export const SETTINGS: ShopSettings = { ...DEFAULT_SETTINGS, updatedAt: at(YESTERDAY, '09:00') };

/** The Inventory file's items, as the API returns them. */
export function catalog(): CatalogItem[] {
  return INVENTORY.map((i) => ({
    id: `itm_${i.id}`,
    shop: SHOP.id,
    name: i.name,
    detail: i.detail || null,
    category: i.category,
    priceCents: i.priceCents,
    costCents: i.costCents ?? null,
    taxKind: i.tax,
    stockTracked: Boolean(i.stock),
    stock: i.stock ? { onHand: i.stock.shelf, held: i.stock.held, free: i.stock.shelf - i.stock.held } : null,
    reorderAt: i.stock?.reorderAt ?? null,
    optionGroups: (i.options ?? []).map((g, gi) => ({
      id: `grp_${i.id}_${g.id}`,
      name: g.name,
      rule: g.rule,
      required: g.required,
      position: gi,
      options: g.choices.map((c, ci) => ({ id: `opt_${i.id}_${g.id}_${c.id}`, name: c.name, deltaCents: c.deltaCents, position: ci })),
    })),
    archivedAt: null,
  }));
}
export const itemId = (ref: string) => `itm_${ref}`;

const onOrder = GOODYEAR_ON_ORDER.stock!;
export const REORDERS: Reorder[] = [
  { id: 'reo_goodyear', itemId: itemId('goodyear'), quantity: onOrder.onOrder!, supplier: onOrder.supplier ?? null, expectedOn: '2026-09-26', receivedQuantity: 0, status: 'open' },
];

export const DISCOUNT_CODES: DiscountCode[] = [
  { id: 'dsc_fall10', code: 'FALL10', percent: 10, amountCents: null, appliesTo: { all: true }, startsAt: null, endsAt: null, oncePerCustomer: false, uses: 3 },
];

export const READERS: Reader[] = [
  { id: 'rdr_front', shop: SHOP.id, provider: 'stripe', type: 'smart', externalReaderId: 'tmr_mock_front', label: 'Front counter', locationId: 'tml_mock', lastSeenAt: at(REFERENCE_DAY, '16:40') },
  { id: 'rdr_m2', shop: SHOP.id, provider: 'stripe', type: 'm2', externalReaderId: 'STRM2-MOCK', label: 'Bay M2', locationId: 'tml_mock', lastSeenAt: at(REFERENCE_DAY, '15:10') },
];

const quick = (name: string, amountCents: number): LineInput => ({ itemId: null, name, note: null, amountCents, taxKind: 'labour' });

/**
 * The day's (and yesterday's) orders, each with how it was paid. Prices come out through the same
 * pricing as a new order, so the reference cart is $927.52 because it's priced, not because it's typed.
 */
export interface SeedOrder {
  ref: string;
  day: string;
  time: string;
  by: string;
  customer: string | null;
  lines: LineInput[];
  tender:
    | { method: 'clear'; status: 'approved' | 'pending' | 'cancelled'; code: string }
    | { method: 'cash'; tipCents: number; tipBy?: string }
    | { method: 'card'; tipCents: number; brand: string; last4: string };
}

export const ORDERS: SeedOrder[] = [
  { ref: 'ray', day: YESTERDAY, time: '15:20', by: STAFF_ID.luis, customer: 'Ray C.', lines: [quick('Four tires, fitted', 124000)], tender: { method: 'clear', status: 'approved', code: 'CLR-RAY' } },
  { ref: 'tom', day: YESTERDAY, time: '10:05', by: STAFF_ID.jen, customer: 'Tom B.', lines: [quick('Brake inspection and pads', 31000)], tender: { method: 'clear', status: 'cancelled', code: 'CLR-TOM' } },
  { ref: 'ana', day: REFERENCE_DAY, time: '08:30', by: STAFF_ID.luis, customer: 'Ana V.', lines: [quick('Alignment and rotation', 30000)], tender: { method: 'clear', status: 'approved', code: 'CLR-ANA' } },
  { ref: 'priya', day: REFERENCE_DAY, time: '09:47', by: STAFF_ID.luis, customer: 'Priya S.', lines: [quick('Brake job, front axle', 18800)], tender: { method: 'clear', status: 'approved', code: 'CLR-PRIYA' } },
  { ref: 'marcus', day: REFERENCE_DAY, time: '11:02', by: STAFF_ID.jen, customer: 'Marcus T.', lines: [quick('Tires and fitting', 41200)], tender: { method: 'clear', status: 'approved', code: 'CLR-MARCUS' } },
  { ref: 'walkin1', day: REFERENCE_DAY, time: '12:15', by: STAFF_ID.jen, customer: null, lines: [quick('Flat repair', 2300)], tender: { method: 'cash', tipCents: 0 } },
  { ref: 'walkin2', day: REFERENCE_DAY, time: '13:40', by: STAFF_ID.luis, customer: null, lines: [quick('Valve replacement', 3400)], tender: { method: 'cash', tipCents: 500, tipBy: STAFF_ID.luis } },
  {
    ref: 'nina',
    day: REFERENCE_DAY,
    time: '14:26',
    by: STAFF_ID.jen,
    customer: 'Nina P.',
    // Holds the two Goodyears the inventory history shows as held for her charge.
    lines: [{ itemId: itemId('goodyear'), quantity: 2, optionIds: [] }, quick('Fitting and alignment', 6089)],
    tender: { method: 'clear', status: 'pending', code: 'CLR-NINA' },
  },
  { ref: 'dana', day: REFERENCE_DAY, time: '15:52', by: STAFF_ID.jen, customer: 'Dana R.', lines: [quick('Suspension work', 94000)], tender: { method: 'clear', status: 'pending', code: 'CLR-DANA' } },
  {
    ref: 'walkin_card',
    day: REFERENCE_DAY,
    time: '16:41',
    by: STAFF_ID.jen,
    customer: null,
    // The reference cart: four Michelins, four mount and balance, one set of valve stems.
    lines: [
      { itemId: itemId('michelin'), quantity: 4, optionIds: [] },
      { itemId: itemId('mount'), quantity: 4, optionIds: [] },
      { itemId: itemId('valves'), quantity: 1, optionIds: [] },
    ],
    tender: { method: 'card', tipCents: 1000, brand: 'visa', last4: '4242' },
  },
];

/** The drawer at the reference close: $150 to start, $212 expected, both counted $208. */
export const DRAWER = { startingCashCents: 15000, countedCents: 20800 } as const;

/** Wed, Sep 23: the card walk-in's deposit. Stripe 2.7% + 5¢ on $937.52 is $25.36; Clear's 30¢. */
export const CARD_DEPOSIT = { arrivalDate: '2026-09-23', grossCents: 93752, processorFeeCents: 2536, clearFeeCents: 30 } as const;

/**
 * The Clear side, for the older client's calls (mock.ts, ClearSide).
 *
 * How each confirmed member chose to pay, as the Charges reference draws them: Marcus in four,
 * Priya all at once, Ana and Ray in two. A charge approved in the mock later splits in four.
 */
export const CLEAR_SPLITS: Record<string, number> = { 'CLR-MARCUS': 4, 'CLR-PRIYA': 1, 'CLR-ANA': 2, 'CLR-RAY': 2 };
/** Dana has seen hers; Nina hasn't opened it (Home reference). */
export const CLEAR_OPENED = new Set(['CLR-DANA']);

/** The payout position the Payouts reference draws: $3,012.40 ready, $4,218.91 releasing Oct 14. */
export const POSITION = {
  owedCents: 421891,
  cashAccountCents: 61240,
  releasedReadyCents: 240000,
  scheduledCents: 181891,
  readyToWithdrawCents: 301240,
  nextPayoutOn: '2026-10-14T12:00:00',
  clearsBalanceCents: 0,
  toBankCents: 421891,
  availableTodayCents: 240000,
  paid: [
    { id: 'po_sep', amountCents: 311840, charges: 22, on: '2026-09-14', paidAt: '2026-09-14T15:00:00Z' },
    { id: 'po_aug', amountCents: 588410, charges: 61, on: '2026-08-14', paidAt: '2026-08-14T15:00:00Z' },
  ],
};

/** Charges each person raised this month (Overview: "Jen has raised 18 of this month's 34"). */
export const CHARGES_THIS_MONTH: Record<string, number> = { [STAFF_ID.jen]: 18, [STAFF_ID.luis]: 13, [STAFF_ID.mike]: 3, [STAFF_ID.ana]: 0 };

/** What anyone on shift may read about the shop. */
export const PROFILE = {
  merchant: SHOP.id,
  name: SHOP.name,
  category: 'Auto repair',
  town: 'Redlands',
  partnerSince: '2026-08-12',
  founding: true,
  payoutTerms: 'Paid on the 14th, and sooner when the pool allows',
};
/** The owner's own: the rate over time, the cap, where payouts land. */
export const PROFILE_OWNER = { discountRate: 0.02, approvalCapCents: 250000, payoutAccount: 'Chase ••4417', termsSource: 'chain' as const };
