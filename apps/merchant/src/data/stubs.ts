import type { Charge, Merchant, Payout, Staff } from '@clear/domain';

/**
 * Fixtures for the shell, typed against the domain.
 *
 * No API calls yet — Phase 3 builds the shape, Phase 4 builds the screens, and wiring comes after.
 * These exist so the layout has real figures to lay out and so the types are exercised: if the
 * domain changes shape, this file stops compiling, which is the point of it being typed rather
 * than a bag of `any`.
 *
 * The figures are the design reference's, so what appears on screen while scaffolding matches what
 * the reference drew.
 *
 * **Financed transactions only.** A member paying from their balance or tapping a Clear card runs
 * on ordinary payment rails and never reaches this app, so there is nothing here representing one
 * and no total that mixes them.
 */

export const STUB_MERCHANT: Merchant = {
  id: 'm_mikes',
  name: "Mike's Tire",
  discountRate: 0.025,
  ratePerCycle: 0.02,
  splitOptions: [1, 2, 4, 12],
  payoutAccountLast4: '9012',
};

export const STUB_STAFF: Staff[] = [
  { id: 's_jen', name: 'Jen', role: 'counter', hasPin: true, active: true },
  { id: 's_luis', name: 'Luis', role: 'counter', hasPin: true, active: true },
  { id: 's_mike', name: 'Mike', role: 'owner', hasPin: true, active: true },
];

/**
 * Today's charges, mirroring the design reference's "running" counter home exactly — same names,
 * same amounts, same times, same writers — so the built screen can be held against the drawing.
 *
 * Times are fixed to today's date at the reference's clock times rather than offsets from now, so
 * the screen reads the same whenever it is opened.
 */
const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export const STUB_CHARGES: Charge[] = [
  {
    id: 'c_dana',
    code: 'P8QT',
    merchantId: STUB_MERCHANT.id,
    member: { id: 'mem_dana', displayName: 'Dana R.' },
    amount: 940,
    state: 'waiting',
    raisedByStaffId: 's_jen',
    createdAt: minutesAgo(6),
    expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
    openedAt: minutesAgo(4),
  },
  {
    id: 'c_marcus',
    code: 'K4M2',
    merchantId: STUB_MERCHANT.id,
    member: { id: 'mem_marcus', displayName: 'Marcus T.' },
    amount: 412,
    state: 'approved',
    splitInto: 4,
    payout: 401.7,
    raisedByStaffId: 's_jen',
    createdAt: at(11, 2),
    expiresAt: at(11, 17),
    openedAt: at(11, 4),
    resolvedAt: at(11, 5),
  },
  {
    id: 'c_priya',
    code: 'B7HL',
    merchantId: STUB_MERCHANT.id,
    member: { id: 'mem_priya', displayName: 'Priya S.' },
    amount: 188,
    state: 'approved',
    splitInto: 2,
    payout: 183.3,
    raisedByStaffId: 's_luis',
    createdAt: at(9, 47),
    expiresAt: at(10, 2),
    openedAt: at(9, 49),
    resolvedAt: at(9, 50),
  },
  {
    id: 'c_ana',
    code: 'R2WX',
    merchantId: STUB_MERCHANT.id,
    member: { id: 'mem_ana', displayName: 'Ana V.' },
    amount: 300,
    state: 'approved',
    splitInto: 4,
    payout: 292.5,
    raisedByStaffId: 's_luis',
    createdAt: at(8, 30),
    expiresAt: at(8, 45),
    openedAt: at(8, 32),
    resolvedAt: at(8, 33),
  },
];

export const STUB_PAYOUTS: Payout[] = [
  {
    id: 'p_next',
    merchantId: STUB_MERCHANT.id,
    amount: 4210,
    scheduledFor: '2026-12-14',
    status: 'scheduled',
  },
  {
    id: 'p_last',
    merchantId: STUB_MERCHANT.id,
    amount: 3106.55,
    scheduledFor: '2026-11-30',
    paidAt: '2026-11-30',
    status: 'paid',
  },
];

/** What is on the counter right now — the merchant's waiting state. */
export const waitingCharges = (charges: Charge[] = STUB_CHARGES) =>
  charges.filter((c) => c.state === 'waiting' || c.state === 'resolving');
