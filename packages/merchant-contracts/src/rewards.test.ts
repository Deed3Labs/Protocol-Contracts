import { describe, expect, test } from 'bun:test';
import {
  BRAND_PRESETS,
  brandContrast,
  ClaimCode,
  claimCodeLabel,
  CounterCustomer,
  DiscountCode,
  DiscountRequest,
  earnLabels,
  earnPoints,
  EarnRules,
  giveBack,
  Order,
  refundPoints,
  SendClearCharge,
  ShopSlug,
  type EarnInput,
} from './index';

const rules = (patch: Partial<EarnRules> = {}): EarnRules =>
  EarnRules.parse({
    version: 1,
    effectiveAt: '2026-10-01T00:00:00-07:00',
    unit: 'dollars',
    pointsPer: 1,
    perAmountCents: 100,
    visitMinCents: 0,
    cardSize: 10,
    keepTheChange: false,
    clearMultiplier: 1,
    boosts: [],
    joinBonus: 0,
    birthdayRewardId: null,
    referralBonus: null,
    expiry: 'never',
    ...patch,
  });

/** Mi Casa's boosts, as Settings › Shop app draws them. */
const MI_CASA_BOOSTS: EarnRules['boosts'] = [
  { id: 'bst_tue', name: 'Double points · Tuesdays', multiplier: 2, scope: { kind: 'days', days: [1] }, on: true },
  { id: 'bst_hh', name: 'Happy hour · 2×', multiplier: 2, scope: { kind: 'hours', days: [0, 1, 2, 3, 4], span: { from: '14:00', to: '17:00' } }, on: true },
  { id: 'bst_cat', name: 'Catering · 3×', multiplier: 3, scope: { kind: 'categories', categories: ['Catering'] }, on: false },
];

const THURSDAY_EVENING = { weekday: 3, time: '19:46' };
const input = (patch: Partial<EarnInput>): EarnInput => ({
  rules: rules(),
  lines: [],
  at: THURSDAY_EVENING,
  clearCents: 0,
  paidCents: 0,
  carryCents: 0,
  stampedToday: false,
  ...patch,
});

// Section 3: $16.00 of food, less the $3.50 reward spread across the lines, is $12.50 before tax.
const TABLE_6 = [
  { netCents: 703, category: 'Tacos' },
  { netCents: 273, category: 'Drinks' },
  { netCents: 274, category: 'Drinks' },
];

describe('earning by dollars', () => {
  test('section 3: $12.50 paid before tax earns 12 points, whole dollars only', () => {
    const e = earnPoints(input({ lines: TABLE_6, clearCents: 1355, paidCents: 1355 }));
    expect(e.points).toBe(12);
    expect(128 - 75 + e.points).toBe(65);
  });

  test('section 3 with the drawn 1.5× for paying with Clear would earn 18, not 12', () => {
    const e = earnPoints(input({ rules: rules({ clearMultiplier: 1.5 }), lines: TABLE_6, clearCents: 1355, paidCents: 1355 }));
    expect(e.points).toBe(18);
  });

  test('a $24.00 order earns 24 points', () => {
    expect(earnPoints(input({ lines: [{ netCents: 2400, category: null }], paidCents: 2400 })).points).toBe(24);
  });

  test('keep the change: at $10 a point, $15 and $15 earn 3', () => {
    const r = rules({ perAmountCents: 1000, keepTheChange: true });
    const first = earnPoints(input({ rules: r, lines: [{ netCents: 1500, category: null }], paidCents: 1500 }));
    expect(first).toMatchObject({ points: 1, carryCents: 500 });
    const second = earnPoints(input({ rules: r, lines: [{ netCents: 1500, category: null }], paidCents: 1500, carryCents: first.carryCents }));
    expect(second).toMatchObject({ points: 2, carryCents: 0 });
    expect(first.points + second.points).toBe(3);
  });

  test('without keep the change, the leftover is lost', () => {
    const r = rules({ perAmountCents: 1000 });
    const e = earnPoints(input({ rules: r, lines: [{ netCents: 1500, category: null }], paidCents: 1500, carryCents: 500 }));
    expect(e).toMatchObject({ points: 1, carryCents: 500 });
  });

  test('a Tuesday doubles', () => {
    const e = earnPoints(input({ rules: rules({ boosts: MI_CASA_BOOSTS }), lines: TABLE_6, paidCents: 1355, at: { weekday: 1, time: '19:00' } }));
    expect(e).toMatchObject({ points: 25, multiplier: 2 });
  });

  test('only the biggest boost applies: Double Tuesday and happy hour are 2×, not 4×', () => {
    const e = earnPoints(input({ rules: rules({ boosts: MI_CASA_BOOSTS }), lines: [{ netCents: 1000, category: null }], paidCents: 1000, at: { weekday: 1, time: '15:00' } }));
    expect(e).toMatchObject({ points: 20, multiplier: 2 });
  });

  test('paying with Clear is a candidate for the biggest, never on top: 2× Tuesday with 1.5× Clear is 2×', () => {
    const r = rules({ boosts: MI_CASA_BOOSTS, clearMultiplier: 1.5 });
    const e = earnPoints(input({ rules: r, lines: [{ netCents: 1000, category: null }], clearCents: 1000, paidCents: 1000, at: { weekday: 1, time: '19:00' } }));
    expect(e).toMatchObject({ points: 20, multiplier: 2 });
    const thursday = earnPoints(input({ rules: r, lines: [{ netCents: 1000, category: null }], clearCents: 1000, paidCents: 1000 }));
    expect(thursday).toMatchObject({ points: 15, multiplier: 1.5 });
  });

  test('a category boost lifts only its own lines', () => {
    const r = rules({ boosts: MI_CASA_BOOSTS.map((b) => ({ ...b, on: true })) });
    const e = earnPoints(input({ rules: r, lines: [{ netCents: 6000, category: 'Catering' }, { netCents: 1000, category: 'Drinks' }], paidCents: 7000 }));
    expect(e.points).toBe(190);
  });

  test('a split sale gets the Clear multiplier on its Clear part only', () => {
    const r = rules({ clearMultiplier: 2 });
    const e = earnPoints(input({ rules: r, lines: [{ netCents: 2000, category: null }], clearCents: 1000, paidCents: 2000 }));
    expect(e.points).toBe(30);
  });

  test('switched-off boosts never count', () => {
    const r = rules({ boosts: MI_CASA_BOOSTS.map((b) => ({ ...b, on: false })) });
    expect(earnPoints(input({ rules: r, lines: [{ netCents: 1000, category: null }], paidCents: 1000, at: { weekday: 1, time: '15:00' } })).points).toBe(10);
  });

  test('cents only', () => {
    expect(() => earnPoints(input({ lines: [{ netCents: 10.5, category: null }], paidCents: 11 }))).toThrow();
    expect(() => earnPoints(input({ clearCents: 200, paidCents: 100 }))).toThrow();
  });
});

describe('earning by visits', () => {
  const r = rules({ unit: 'visits', visitMinCents: 500, cardSize: 10 });
  test('one stamp for $5 or more', () => {
    expect(earnPoints(input({ rules: r, lines: [{ netCents: 500, category: null }], paidCents: 541 })).points).toBe(1);
  });
  test('nothing under the minimum', () => {
    expect(earnPoints(input({ rules: r, lines: [{ netCents: 499, category: null }], paidCents: 540 })).points).toBe(0);
  });
  test('at most one a day', () => {
    expect(earnPoints(input({ rules: r, lines: [{ netCents: 2000, category: null }], paidCents: 2000, stampedToday: true })).points).toBe(0);
  });
});

describe('refunds take points back', () => {
  test('in proportion to the refunded part', () => {
    expect(refundPoints(12, 1250, 274)).toBe(3);
    expect(refundPoints(12, 1250, 1250)).toBe(12);
    expect(refundPoints(12, 1250, 5000)).toBe(12);
    expect(refundPoints(0, 1250, 274)).toBe(0);
  });
});

describe('the give-back line', () => {
  const prices: Record<string, number> = { itm_jamaica: 350, itm_horchata: 350, itm_churros: 600, itm_plate: 1600 };
  const MI_CASA_REWARDS = [
    { id: 'rwd_agua', gives: { kind: 'item' as const, itemIds: ['itm_jamaica', 'itm_horchata'], maxCents: null }, cost: 75 },
    { id: 'rwd_churros', gives: { kind: 'item' as const, itemIds: ['itm_churros'], maxCents: null }, cost: 150 },
    { id: 'rwd_plate', gives: { kind: 'item' as const, itemIds: ['itm_plate'], maxCents: 1400 }, cost: 300 },
    { id: 'rwd_tray', gives: { kind: 'amount' as const, amountCents: 2000, categories: ['Catering'] }, cost: 600 },
  ];
  test('as drawn: 3.3–4.7%, or 5.0–7.0% paying with Clear at 1.5×', () => {
    const g = giveBack(rules({ clearMultiplier: 1.5 }), MI_CASA_REWARDS, (id) => prices[id] ?? null);
    expect(g).toMatchObject({ low: 3.3, high: 4.7, lowWithClear: 5, highWithClear: 7 });
    expect(g.byReward.find((b) => b.rewardId === 'rwd_agua')).toMatchObject({ worthCents: 350, spendCents: 7500, percent: 4.7 });
  });
  test('no Clear figures with the multiplier off', () => {
    const g = giveBack(rules(), MI_CASA_REWARDS, (id) => prices[id] ?? null);
    expect(g.lowWithClear).toBeNull();
  });
  test('a percent off has no fixed worth', () => {
    const g = giveBack(rules(), [{ id: 'r', gives: { kind: 'percent', percent: 10, categories: null }, cost: 100 }], () => null);
    expect(g.low).toBeNull();
  });
});

describe('labels', () => {
  test("Mi Casa's", () => {
    expect(earnLabels(rules({ boosts: MI_CASA_BOOSTS }), { kind: 'points' })).toEqual({
      rate: '1 point per $1',
      sentence: 'Earn 1 point for every $1. Double on Tuesdays.',
      expiry: 'Points never expire',
    });
  });
  test("La Bonita's stamps", () => {
    const l = earnLabels(rules({ unit: 'visits', visitMinCents: 500 }), { kind: 'custom', one: 'stamp', many: 'stamps' });
    expect(l).toMatchObject({ rate: '$5 or more, once a day', expiry: 'Stamps never expire' });
  });
  test('a claim code', () => {
    expect(claimCodeLabel('K7P4QM')).toBe('K7P · 4QM');
    expect(ClaimCode.safeParse('K7P4QM').success).toBe(true);
    expect(ClaimCode.safeParse('K7P4QO').success).toBe(false);
  });
});

describe('colours', () => {
  test('every preset and every drawn shop passes', () => {
    for (const p of Object.values(BRAND_PRESETS)) expect(brandContrast(p)).toEqual([]);
    expect(brandContrast({ colour: '#1F4E8C', onColour: '#F2F5F9', paper: '#E7EBEF', paper2: '#D6DDE5' })).toEqual([]);
  });
  test('pale text on a pale colour fails', () => {
    expect(brandContrast({ colour: '#E8C07A', onColour: '#FFFFFF', paper: '#F1EADF', paper2: '#E8DCCB' })).toHaveLength(2);
  });
});

describe('the contracts', () => {
  test('a slug', () => {
    expect(ShopSlug.safeParse('micasa').success).toBe(true);
    expect(ShopSlug.safeParse('la-bonita').success).toBe(true);
    expect(ShopSlug.safeParse('api').success).toBe(false);
    expect(ShopSlug.safeParse('-x').success).toBe(false);
    expect(ShopSlug.safeParse('MiCasa').success).toBe(false);
  });

  test('the counter never sees a balance', () => {
    const sofia = {
      firstName: 'Sofia',
      lastInitial: 'M',
      isClearMember: true,
      canPayWithClear: true,
      membership: { points: 128, joinedAt: '2026-03-04T12:00:00-08:00', readyRewards: [], nextReward: null },
      lastVisit: { at: '2026-10-12T19:30:00-07:00', table: 'Table 6' },
    };
    expect(CounterCustomer.safeParse(sofia).success).toBe(true);
    expect(CounterCustomer.safeParse({ ...sofia, balanceCents: 21240 }).success).toBe(false);
    expect(CounterCustomer.safeParse({ ...sofia, membership: { ...sofia.membership, otherShops: [] } }).success).toBe(false);
  });

  test('a reward and a claim are discount requests, as a code is', () => {
    expect(DiscountRequest.safeParse({ kind: 'reward', rewardId: 'rwd_agua' }).success).toBe(true);
    expect(DiscountRequest.safeParse({ kind: 'claim', code: 'K7P4QM' }).success).toBe(true);
  });

  test('Clear goes to the added customer with nothing in the body', () => {
    expect(SendClearCharge.safeParse({ to: 'customer' }).success).toBe(true);
  });

  test('older orders and codes still parse', () => {
    const code = { id: 'dsc_1', code: 'FALL10', percent: 10, amountCents: null, appliesTo: { all: true }, startsAt: null, endsAt: null, oncePerCustomer: false, uses: 0 };
    expect(DiscountCode.safeParse(code).success).toBe(true);
    expect(DiscountCode.safeParse({ ...code, showInApp: true, audience: 'members', offer: { title: 'Fall', detail: '10% off' }, days: [1] }).success).toBe(true);
    expect(Order.shape.member.safeParse(undefined).success).toBe(true);
  });
});
