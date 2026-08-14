import type {
  HomeData,
  SavingsData,
  Milestone,
  AssuranceItem,
  ActivityData,
  CardData,
  SendData,
  EarnData,
  BondTerm,
  SettingsData,
} from '@/lib/clearModel';

/**
 * Where the flow surfaces draw from. Home's scenario is deliberately late-cycle —
 * cash spent to zero, credit engaged — but the reference draws its purchase and
 * deposit modals at a funded moment, so they get their own figure rather than
 * showing "pay from $0".
 */
const PAY_FROM = { label: 'Cash account', balance: 6200 };

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
    carryCost: 10.4,
    carryFreeUnder: 3000,
    tiers: [
      { key: 'savings', label: 'Savings (CLRUSD)', shortLabel: 'Savings', rate: 'free', used: 3000, limit: 3000, added: true },
      { key: 'asset', label: 'Asset-backed', rate: '0.65–0.75%', used: 2400, limit: 8300, added: true },
      { key: 'income', label: 'Income-backed', shortLabel: 'Income', rate: '1.5% / cycle', used: 0, limit: 1000, added: true },
      { key: 'boost', label: 'Boost', rate: '3% / cycle', ratePerCycle: 0.03, used: 0, limit: 500, added: false },
    ],
  },
  cycle: { lengthDays: 30, daysLeft: 6, clearsOn: 'Nov 1 payday' },
  savings: { cash: 3000, vested: 1500, vesting: 1500, credits: 1500, creditsGoal: 15000 },
  cashAccount: {
    balance: 0,
    nextDepositOn: 'Nov 1',
    nextDepositEstimate: 2000,
    directDepositActive: true,
    accountNumber: '000123454192',
    routingNumber: '084106768',
    bankName: 'Lead Bank',
    employer: 'Acme Logistics',
  },
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
      {
        label: 'Clear Boost',
        contribution: 500,
        detail: 'Not added · opt-in · 3% per cycle',
        tier: 'boost',
        notAdded: true,
        addAmount: 500,
      },
    ],
  },
};

/** "Day one" — account created, nothing deposited yet (spec §4). */
export const HOME_DAY_ONE: HomeData = {
  cash: 0,
  credit: {
    carryCost: 0,
    carryFreeUnder: 0,
    tiers: HOME_IN_USE.credit.tiers.map((t) => ({ ...t, used: 0, limit: 0, added: false })),
  },
  cycle: { lengthDays: 30, daysLeft: 0, clearsOn: '' },
  savings: { cash: 0, vested: 0, vesting: 0, credits: 0, creditsGoal: 15000 },
  cashAccount: {
    balance: 0,
    nextDepositOn: '',
    nextDepositEstimate: 0,
    directDepositActive: false,
    accountNumber: '000123454192',
    routingNumber: '084106768',
    bankName: 'Lead Bank',
    employer: 'Acme Logistics',
  },
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
  payFrom: PAY_FROM,
  creditLimitToday: 12300,
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
  payFrom: PAY_FROM,
  creditLimitToday: 0,
  milestones: MILESTONES,
  assurance: ASSURANCE,
  vesting: [],
};

export const ACTIVITY_IN_USE: ActivityData = {
  cycleNet: -1842,
  pendingClaim: { amount: 40, recipient: 'Marcus T.', sentOn: 'Oct 26', expiresInDays: 12 },
  rows: [
    {
      id: 't1',
      name: 'Shell',
      date: 'Today · Oct 26',
      source: 'credit',
      kind: 'spending',
      amount: -52.1,
      location: 'Redlands, CA',
      datetime: 'Oct 26, 2026 · 8:14 AM',
      paidFromTier: 'asset',
      paidFromLabel: 'Asset-backed credit',
      rate: '0.65% per cycle',
      cardLast4: '8836',
      status: 'Settled',
    },
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
  pan: '4241 8890 1174 8836',
  cvc: '318',
  period: 'October',
  transactions: [
    { id: 'c1', name: 'Shell', date: 'Oct 26', source: 'credit', kind: 'spending', amount: -52.1 },
    { id: 'c2', name: 'Stater Bros', date: 'Oct 25', source: 'credit', kind: 'spending', amount: -118.44 },
    { id: 'c3', name: 'Verizon', date: 'Oct 24', source: 'credit', kind: 'spending', amount: -85 },
    { id: 'c4', name: 'Chipotle', date: 'Oct 23', source: 'cash', kind: 'spending', amount: -14.2 },
    { id: 'c5', name: 'Costco', date: 'Oct 22', source: 'cash', kind: 'spending', amount: -212.66 },
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
  pan: '',
  cvc: '',
  period: '',
  transactions: [],
};

export const SEND_IN_USE: SendData = {
  handle: '@kaim',
  codeUrl: 'https://useclear.org/pay/kaim',
  payFrom: PAY_FROM,
  recent: [
    { id: 'p1', name: 'Diego R.', handle: '@diegor', initials: 'DR', role: 'member' },
    { id: 'p2', name: 'TinyBox Systems', handle: '@tinybox', initials: 'TB', role: 'partner' },
    { id: 'p3', name: 'Maria C.', handle: '@mariac', initials: 'MC', role: 'member' },
  ],
};

/** Day one — the code exists from the moment the account does; nobody paid yet. */
export const SEND_DAY_ONE: SendData = {
  handle: '@kaim',
  codeUrl: 'https://useclear.org/pay/kaim',
  payFrom: PAY_FROM,
  recent: [],
};

/** The bond ladder is a property of the product — offered whether or not you hold any. */
const BOND_TERMS: BondTerm[] = [
  { months: 12, price: 939, face: 1000, rate: 6.5 },
  { months: 24, price: 865, face: 1000, rate: 7.5 },
  { months: 36, price: 783, face: 1000, rate: 8.5 },
  { months: 60, price: 621, face: 1000, rate: 10 },
];

export const EARN_IN_USE: EarnData = {
  earnedToDate: 412.6,
  payFrom: PAY_FROM,
  bondLtv: 0.95,
  poolLtv: 0.7,
  reserveDate: 'Mar 2029',
  pool: { apy: 6.8, lent: 740000, capacity: 1000000, position: 2500, earned: 41.2 },
  terms: BOND_TERMS,
  bonds: [
    { id: 'b1', face: 5000, months: 24, paid: 4325, maturesOn: 'Mar 14, 2028', monthsLeft: 19 },
    { id: 'b2', face: 2500, months: 12, paid: 2400, maturesOn: 'Jan 8, 2027', monthsLeft: 5 },
  ],
};

/** Day one — the pool and the ladder still exist, this member just isn't in them. */
export const EARN_DAY_ONE: EarnData = {
  earnedToDate: 0,
  payFrom: PAY_FROM,
  bondLtv: 0.95,
  poolLtv: 0.7,
  reserveDate: 'Mar 2029',
  pool: { apy: 6.8, lent: 740000, capacity: 1000000, position: 0, earned: 0 },
  terms: BOND_TERMS,
  bonds: [],
};

export const SETTINGS: SettingsData = {
  profile: {
    name: 'Kai Moore',
    initials: 'KM',
    handle: '@kaim',
    memberSince: 'March 2026',
    legalName: 'Kai Moore',
    phone: '(909) 555-0148',
    email: 'kai@example.com',
    address: 'Redlands, CA',
    region: 'Inland Empire',
    votes: 1,
    walletAddress: '0x7a3f…91c4',
  },
  accelerationActive: false,
  faceIdOn: true,
  trustedDevices: 2,
  linkedAccountCount: 2,
  externalBank: 'Chase ••4021',
  employer: 'Acme Logistics',
};
