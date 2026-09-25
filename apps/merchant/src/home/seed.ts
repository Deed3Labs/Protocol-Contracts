import type { DaySummary, DrawerClose } from '@/home/drawer';
import type { HomeModel, SetupItem } from '@/home/model';
import type { Milestone } from '@/home/WaitingSheet';
import { INVENTORY } from '@/inventory/model';

/**
 * The reference scenario for Home: Mike's Tire on Tue, Sep 22. Every figure is from
 * docs/merchant-reference/clear-merchant-home.html, corrected where DECISIONS.md says so (sales tax
 * $62.31, not $60.45). Used by the dev preview (`?home=`) and the gallery; it becomes part of the
 * mock data layer when that lands. Never shown to a live shop.
 */

const confirmed = [
  { id: 'marcus', name: 'Marcus T.', time: '11:02am', by: 'Jen', amountCents: 41200 },
  { id: 'priya', name: 'Priya S.', time: '9:47am', by: 'Luis', amountCents: 18800 },
  { id: 'ana', name: 'Ana V.', time: '8:30am', by: 'Luis', amountCents: 30000 },
];
const waiting = [
  { id: 'nina', name: 'Nina P.', amountCents: 41000, opened: false, ago: '2 minutes ago', by: 'Jen' },
  { id: 'dana', name: 'Dana R.', amountCents: 94000, opened: true, ago: '6 minutes ago' },
];

const running: HomeModel = {
  role: 'owner',
  stage: 'running',
  confirmedCents: 90000,
  confirmedCount: 3,
  waiting,
  confirmed,
  payout: {
    totalCents: 421891,
    availableCents: 240000,
    settlingCents: 181891,
    landsOn: 'Oct 14',
    dayOrdinal: '14th',
    first: false,
  },
  byPerson: [
    { name: 'Jen R.', confirmed: 1, waiting: 1, amountCents: 41200 },
    { name: 'Luis M.', confirmed: 2, waiting: 0, amountCents: 48800 },
    { name: 'Mike R.', confirmed: 0, waiting: 0, amountCents: 0 },
  ],
};

const counter: HomeModel = {
  role: 'counter',
  stage: 'running',
  confirmedCents: 90000,
  confirmedCount: 3,
  waiting,
  confirmed,
  shift: {
    clock: { onFor: '4h 12m', left: '3h 48m', since: '8:04am', until: '4:00pm', hours: 8, done: 4.27 },
    raised: 2,
    shopRaised: 5,
    drawer: { startCents: 15000, cashInCents: 6179 },
    job: { name: 'Nina P.', amountCents: 41000, ago: '2 minutes ago', opened: false },
  },
};

const onBreak: HomeModel = {
  ...counter,
  shift: {
    ...counter.shift!,
    clock: { ...counter.shift!.clock!, onBreak: { for: '9m', from: '12:16pm' } },
  },
};

const early: HomeModel = {
  role: 'owner',
  stage: 'early',
  confirmedCents: 60000,
  confirmedCount: 2,
  waiting: [],
  confirmed: [
    { id: 'marcus', name: 'Marcus T.', time: '11:02am', by: 'Jen', amountCents: 41200 },
    { id: 'priya', name: 'Priya S.', time: '9:47am', by: 'Jen', amountCents: 18800 },
  ],
  payout: { totalCents: 60000, availableCents: 0, settlingCents: 60000, landsOn: 'Oct 14', dayOrdinal: '14th', first: true },
  tip: { fact: 'Jen has raised both of today’s charges', other: 'Luis' },
};

export const SETUP: SetupItem[] = [
  { key: 'staff', t: 'Add your counter staff', det: 'A PIN each, so every charge says who raised it', action: 'Add' },
  { key: 'cards', t: 'Print counter cards', det: 'Goes home with an estimate', action: 'Print' },
  {
    key: 'test',
    t: 'Run a $1.00 test charge',
    det: 'The whole loop once, with nobody watching — refunded straight away',
    action: 'Run',
  },
];

const dayOne: HomeModel = {
  role: 'owner',
  stage: 'dayOne',
  confirmedCents: 0,
  confirmedCount: 0,
  waiting: [],
  confirmed: [],
  setup: SETUP,
  payout: { totalCents: 0, availableCents: 0, settlingCents: 0, landsOn: 'Oct 14', dayOrdinal: '14th', first: true },
};

const closing: HomeModel = {
  ...running,
  closing: {
    closesAt: '6:00pm',
    drawer: 'Two counts to go',
    stillOn: 'Luis M., who closes at 6:00pm',
    waiting: '2 · $1,350.00',
  },
};

const lowStock: HomeModel = { ...running, runningLow: INVENTORY.filter((i) => i.id === 'goodyear' || i.id === 'rotor') };

export const HOME_STATES = { running, counter, onBreak, early, dayOne, closing, lowStock } as const;
export type HomeState = keyof typeof HOME_STATES;

export const DANA_STEPS: Milestone[] = [
  { t: 'Raised', det: 'By Jen at 2:14pm', state: 'done' },
  { t: 'Text delivered', det: '2:14pm', state: 'done' },
  { t: 'Email delivered', det: '2:14pm', state: 'done' },
  { t: 'App opened', det: '2:15pm · 6 min ago', state: 'now' },
  { t: 'Approved', det: 'Not yet', state: 'later' },
];

export const DAY: DaySummary = {
  date: 'Tue, Sep 22',
  charges: 6,
  span: '8:30am to 5:40pm',
  takenCents: 189931,
  clear: { n: 3, cents: 90000 },
  card: { n: 1, cents: 93752 },
  cash: { n: 2, cents: 6179 },
  tipsCents: 1500,
  taxCents: 6231,
  discountsCents: 0,
  waiting: { n: 2, cents: 135000 },
};

const tips: DrawerClose['tips'] = [
  { name: 'Jen R.', cents: 1000, how: 'card' },
  { name: 'Luis M.', cents: 500, how: 'cash' },
];

export const DRAWERS = {
  short: {
    expectedCents: 21179,
    countedCents: 20800,
    note: 'Gave change twice on a $20.',
    counters: ['Luis M.', 'Mike R.'],
    tips,
    leaveCents: 15000,
  },
  signed: {
    expectedCents: 21179,
    countedCents: 20800,
    note: 'Gave change twice on a $20.',
    counters: ['Luis M.', 'Mike R.'],
    signed: { name: 'Mike R.', at: '6:02pm' },
    tips,
    leaveCents: 15000,
  },
  balanced: {
    expectedCents: 21179,
    countedCents: 21179,
    counters: ['Luis M.', 'Mike R.'],
    tips,
    leaveCents: 15000,
  },
} satisfies Record<string, DrawerClose>;
