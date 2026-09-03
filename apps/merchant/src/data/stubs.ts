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
    resolvedAt: at(11, 4),
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

const yesterdayAt = (h: number, m: number) => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

/** Yesterday, so Charges has history to filter and sort. Reference section 06. */
export const STUB_EARLIER_CHARGES: Charge[] = [
  {
    id: 'c_ray',
    code: 'M3ZP',
    merchantId: STUB_MERCHANT.id,
    member: { id: 'mem_ray', displayName: 'Ray C.' },
    amount: 1240,
    state: 'approved',
    splitInto: 2,
    payout: 1209,
    raisedByStaffId: 's_luis',
    createdAt: yesterdayAt(15, 20),
    expiresAt: yesterdayAt(15, 35),
    openedAt: yesterdayAt(15, 22),
    resolvedAt: yesterdayAt(15, 23),
  },
  {
    id: 'c_tom',
    code: 'D9KF',
    merchantId: STUB_MERCHANT.id,
    member: { id: 'mem_tom', displayName: 'Tom B.' },
    amount: 310,
    state: 'expired',
    raisedByStaffId: 's_jen',
    createdAt: yesterdayAt(16, 5),
    expiresAt: yesterdayAt(16, 20),
  },
];

/** Every charge the shop has, newest first. */
export const ALL_CHARGES: Charge[] = [...STUB_CHARGES, ...STUB_EARLIER_CHARGES];

/**
 * The plans behind confirmed charges.
 *
 * `cyclesCleared` is what the detail screen needs to say "1 cleared", and what a refund needs to
 * work out the carry already paid. Keyed by charge so the two screens read the same record.
 */
export const STUB_PLANS: Record<string, { splitInto: number; cyclesCleared: number }> = {
  c_marcus: { splitInto: 4, cyclesCleared: 1 },
  c_priya: { splitInto: 1, cyclesCleared: 0 },
  c_ana: { splitInto: 4, cyclesCleared: 0 },
  c_ray: { splitInto: 2, cyclesCleared: 1 },
};

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

/**
 * Setup tasks — the right column on day one.
 *
 * A shop that has signed but not run anything. The list retires itself: once every task is done
 * the panel is replaced by the day's charges, which is what it was standing in for.
 */
export interface SetupTask {
  id: string;
  title: string;
  detail: string;
  action?: string;
  done?: boolean;
}

export const STUB_SETUP: SetupTask[] = [
  {
    id: 'staff',
    title: 'Add your counter staff',
    detail: 'A PIN each, so charges are attributed',
    action: 'Add',
  },
  {
    id: 'cards',
    title: 'Print counter cards',
    detail: 'Goes home with an estimate',
    action: 'Print',
  },
  {
    id: 'bank',
    title: 'Bank account added',
    detail: `Chase ····${STUB_MERCHANT.payoutAccountLast4}`,
    done: true,
  },
];

/**
 * The three stages Home has to hold, as the reference draws them.
 *
 * Home is the only screen that must fill a tablet at any stage, so the space activity will
 * eventually occupy is never left empty — early on it carries setup and training. Charges,
 * Payouts, Staff and Settings are lists with a one-line empty state; they need none of this.
 *
 * Selectable at `/?home=empty|early|running` so all three can be seen without waiting for a shop
 * to age. Fixture data only — it selects between these arrays and nothing else.
 */
export type HomeStage = 'empty' | 'early' | 'running';

export interface HomeScenario {
  charges: Charge[];
  setup: SetupTask[];
  /** Nothing has landed yet, so the payout explainer still has a job to do. */
  hasHadPayout: boolean;
}

export const HOME_SCENARIOS: Record<HomeStage, HomeScenario> = {
  // Day one: signed, nothing run. Setup incomplete, so the right column is the setup list.
  empty: { charges: [], setup: STUB_SETUP, hasHadPayout: false },
  /**
   * A few charges in. Activity has started but does not fill the column, so one tip stays.
   *
   * Both raised by Jen, which the reference's own early state does not quite say: its rows credit
   * Priya's charge to Luis while the tip beside them reads "Jen has raised both of today's
   * charges". Both cannot be true on one screen. The tip is the designed content — it is the
   * insight the whole panel exists for — so the rows are made consistent with it rather than the
   * other way round. A tip contradicting the list above it is worse than either version alone.
   */
  early: {
    charges: STUB_CHARGES.filter((c) => c.id === 'c_priya' || c.id === 'c_marcus').map((c) => ({
      ...c,
      raisedByStaffId: 's_jen',
    })),
    setup: STUB_SETUP.map((t) => ({ ...t, done: true })),
    hasHadPayout: false,
  },
  // Activity fills the column on its own. No tips, no prompts.
  running: {
    charges: STUB_CHARGES,
    setup: STUB_SETUP.map((t) => ({ ...t, done: true })),
    hasHadPayout: true,
  },
};
