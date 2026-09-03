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
  id: 'm_westside',
  name: 'Westside Tire & Auto',
  discountRate: 0.025,
  ratePerCycle: 0.02,
  splitOptions: [1, 2, 4, 12],
  payoutAccountLast4: '9012',
};

export const STUB_STAFF: Staff[] = [
  { id: 's_jen', name: 'Jen', role: 'counter', hasPin: true, active: true },
  { id: 's_amir', name: 'Amir', role: 'counter', hasPin: true, active: true },
  { id: 's_mike', name: 'Mike', role: 'owner', hasPin: true, active: true },
];

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export const STUB_CHARGES: Charge[] = [
  {
    id: 'c_1',
    code: 'K4M2',
    merchantId: STUB_MERCHANT.id,
    member: { id: 'mem_marcus', displayName: 'Marcus T.' },
    amount: 412,
    state: 'approved',
    splitInto: 4,
    payout: 401.7,
    raisedByStaffId: 's_jen',
    createdAt: hoursAgo(3),
    expiresAt: hoursAgo(2.75),
    openedAt: hoursAgo(2.95),
    resolvedAt: hoursAgo(2.9),
  },
  {
    id: 'c_2',
    code: 'P8QT',
    merchantId: STUB_MERCHANT.id,
    member: { id: 'mem_dana', displayName: 'Dana R.' },
    amount: 940,
    state: 'waiting',
    raisedByStaffId: 's_jen',
    createdAt: hoursAgo(0.05),
    expiresAt: minutesFromNow(12),
    openedAt: hoursAgo(0.02),
  },
  {
    id: 'c_3',
    code: 'R2WX',
    merchantId: STUB_MERCHANT.id,
    amount: 186.4,
    state: 'expired',
    raisedByStaffId: 's_amir',
    createdAt: hoursAgo(5),
    expiresAt: hoursAgo(4.75),
  },
  {
    id: 'c_4',
    code: 'B7HL',
    merchantId: STUB_MERCHANT.id,
    member: { id: 'mem_priya', displayName: 'Priya S.' },
    amount: 68,
    state: 'declined',
    raisedByStaffId: 's_amir',
    createdAt: hoursAgo(6),
    expiresAt: hoursAgo(5.75),
    openedAt: hoursAgo(5.9),
    resolvedAt: hoursAgo(5.88),
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
