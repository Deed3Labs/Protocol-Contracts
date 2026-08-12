import type {
  HomeData,
  SavingsData,
  Milestone,
  AssuranceItem,
  ActivityData,
  CardData,
} from '@/lib/clearModel';

/**
 * Placeholder data for the rebuild — the design spec's own example values, so the
 * built pages can be diffed against the reference screens directly.
 *
 * Not fixtures for tests and not a fallback for production: pages take their data
 * as props, and these are what the preview harness passes in. Swap for the real
 * contexts (useClearBalances / useClearTransactions / CreditContext) when wiring.
 */

/** "In use" — cash spent to zero, credit engaged (spec §4). */
export const HOME_IN_USE: HomeData = {
  cash: 0,
  credit: {
    cycleLimit: 4000,
    carryCost: 2,
    carryFreeUnder: 3000,
    tiers: [
      { key: 'savings', label: 'Savings (CLRUSD)', shortLabel: 'Savings', rate: 'free', used: 3000, limit: 3000, added: true },
      { key: 'asset', label: 'Asset-backed', rate: '0.65–0.75%', used: 200, limit: 8300, added: true },
      { key: 'income', label: 'Income-backed', shortLabel: 'Income', rate: '1.5% / cycle', used: 0, limit: 1000, added: true },
      { key: 'boost', label: 'Boost', rate: '3% / cycle', used: 0, limit: 500, added: false },
    ],
  },
  cycle: { lengthDays: 30, daysLeft: 6, clearsOn: 'Nov 1 payday' },
  savings: { cash: 3000, vested: 1500, vesting: 1500, credits: 1500, creditsGoal: 15000 },
  cashAccount: { balance: 0, nextDepositOn: 'Nov 1', nextDepositEstimate: 2000, directDepositActive: true },
  tasks: [
    { id: 'account', label: 'Account created', done: true },
    { id: 'deposit', label: 'Add your first deposit', cta: 'Add', done: true },
    { id: 'direct-deposit', label: 'Set up direct deposit', done: true },
    { id: 'card', label: 'Activate your card to start spending', cta: 'Activate', done: false },
  ],
  recent: [
    { id: 'r1', name: 'Shell', date: 'Oct 26', source: 'credit', kind: 'spending', amount: -52.1 },
    { id: 'r2', name: 'Stater Bros', date: 'Oct 25', source: 'credit', kind: 'spending', amount: -118.44 },
    { id: 'r3', name: 'Payroll deposit', date: 'Oct 25', source: 'cash account', kind: 'deposit', amount: 2000 },
  ],
  backing: {
    assetBacked: [
      { label: 'Savings (CLRUSD)', contribution: 3000, detail: '$3,000 balance · 100% · free', tier: 'savings' },
      { label: 'BurnerBonds', contribution: 6550, detail: '$6,895 value today · 95% · 0.65%', tier: 'savings' },
      { label: 'Yield pool', contribution: 1750, detail: '$2,500 position · 70% · 0.75%', tier: 'asset' },
    ],
    unsecured: [
      { label: 'Income-backed', contribution: 1000, detail: '50% of ~$2,000/mo · 1.5%', tier: 'income' },
      { label: 'Clear Boost', contribution: 500, detail: 'Opt-in · 3%', tier: 'boost', dimmed: true },
    ],
  },
};

/** "Day one" — account created, nothing deposited yet (spec §4). */
export const HOME_DAY_ONE: HomeData = {
  cash: 0,
  credit: {
    cycleLimit: 0,
    carryCost: 0,
    carryFreeUnder: 0,
    tiers: HOME_IN_USE.credit.tiers.map((t) => ({ ...t, used: 0, limit: 0, added: false })),
  },
  cycle: { lengthDays: 30, daysLeft: 0, clearsOn: '' },
  savings: { cash: 0, vested: 0, vesting: 0, credits: 0, creditsGoal: 15000 },
  cashAccount: { balance: 0, nextDepositOn: '', nextDepositEstimate: 0, directDepositActive: false },
  tasks: [
    { id: 'account', label: 'Account created', done: true },
    { id: 'deposit', label: 'Add your first deposit', cta: 'Add', done: false },
    { id: 'direct-deposit', label: 'Set up direct deposit', done: false },
    { id: 'card', label: 'Activate your card', done: false },
  ],
  recent: [],
  backing: { assetBacked: [], unsecured: [] },
};

/**
 * Milestones and protections are properties of the product, not of a member's
 * balance, so both states share them — only the credit balance moves, and the
 * done/current/locked states fall out of that.
 */
const MILESTONES: Milestone[] = [
  { id: 'start', title: 'Start saving', credits: 1000 },
  { id: 'assurance', title: 'Unlock full assurance', credits: 4000 },
  { id: 'community', title: 'Choose your community', credits: 8000 },
  { id: 'reserve', title: 'Reserve your home', credits: 12000 },
  { id: 'deed', title: 'Sign your ELPA & Clear Deed', credits: 15000, note: 'move in' },
];

/**
 * Only "Home repair assurance" is a confirmed product name. The other four are
 * placeholders and MUST keep rendering as written until the real names arrive —
 * do not invent replacements.
 */
const ASSURANCE: AssuranceItem[] = [
  { id: 'a1', name: 'Home repair assurance', unlocksAt: 0 },
  { id: 'a2', name: '[PLACEHOLDER — replace]', unlocksAt: 1000, placeholder: true },
  { id: 'a3', name: '[PLACEHOLDER — replace]', unlocksAt: 4000, placeholder: true },
  { id: 'a4', name: '[PLACEHOLDER — replace]', unlocksAt: 8000, placeholder: true },
  { id: 'a5', name: '[PLACEHOLDER — replace]', unlocksAt: 15000, placeholder: true },
];

export const SAVINGS_IN_USE: SavingsData = {
  savings: HOME_IN_USE.savings,
  milestones: MILESTONES,
  assurance: ASSURANCE,
  vesting: [
    { id: 'v1', date: 'Nov 3', credits: 500 },
    { id: 'v2', date: 'Nov 17', credits: 500 },
    { id: 'v3', date: 'Dec 1', credits: 500 },
  ],
};

export const SAVINGS_DAY_ONE: SavingsData = {
  savings: HOME_DAY_ONE.savings,
  milestones: MILESTONES,
  assurance: ASSURANCE,
  vesting: [],
};

export const ACTIVITY_IN_USE: ActivityData = {
  cycleNet: -1842,
  pendingClaim: { amount: 40, recipient: 'Marcus T.', sentOn: 'Oct 26', expiresInDays: 12 },
  rows: [
    { id: 't1', name: 'Shell', date: 'Today · Oct 26', source: 'credit', kind: 'spending', amount: -52.1 },
    { id: 't2', name: 'Sent to Marcus T.', date: 'Today · Oct 26', source: 'pending', kind: 'sent', amount: -40 },
    { id: 't3', name: 'Payroll deposit', date: 'Oct 25', source: 'cash account', kind: 'deposit', amount: 2000 },
    { id: 't4', name: 'Equity credits vested', date: 'Oct 25', source: 'savings', kind: 'savings', amount: 500 },
    { id: 't5', name: 'Stater Bros', date: 'Oct 25', source: 'credit', kind: 'spending', amount: -118.44 },
    { id: 't6', name: 'Chipotle', date: 'Oct 23', source: 'cash', kind: 'spending', amount: -14.2 },
  ],
};

export const ACTIVITY_DAY_ONE: ActivityData = { cycleNet: 0, rows: [] };

export const CARD_IN_USE: CardData = {
  activated: true,
  last4: '8836',
  cardholder: 'Kai M',
  expiry: '04/29',
  network: 'VISA',
  frozen: false,
  transactions: [
    { id: 'c1', name: 'Shell', date: 'Oct 26', source: 'credit', kind: 'spending', amount: -52.1 },
    { id: 'c2', name: 'Stater Bros', date: 'Oct 25', source: 'credit', kind: 'spending', amount: -118.44 },
    { id: 'c3', name: 'Chipotle', date: 'Oct 23', source: 'cash', kind: 'spending', amount: -14.2 },
  ],
};

/** Day one — the card exists but hasn't been activated, so it has no number yet. */
export const CARD_DAY_ONE: CardData = {
  activated: false,
  last4: '',
  cardholder: 'Kai M',
  expiry: '',
  network: 'VISA',
  frozen: false,
  transactions: [],
};
