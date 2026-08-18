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
  Alert,
  AssuranceReserve,
  InboxData,
  Thread,
  Contact,
  Partner,
  PartnersData,
  YieldPool,
  HeldBond,
  TermPlan,
  LinkedAccount,
} from '@/lib/clearModel';
import { assetBackedLimit } from '@/lib/clearModel';

/**
 * Where the flow surfaces draw from. Home's scenario is deliberately late-cycle —
 * cash spent to zero, credit engaged — but the reference draws its purchase and
 * deposit modals at a funded moment, so they get their own figure rather than
 * showing "pay from $0".
 */
const PAY_FROM = { label: 'Cash account', balance: 6200 };

/** Loan-to-value each product is lent against — spec §6. */
const BOND_LTV = 0.95;
const POOL_LTV = 0.7;

const POOL: YieldPool = { apy: 6.8, lent: 740000, capacity: 1000000, position: 2500, earned: 41.2 };

const BONDS: HeldBond[] = [
  { id: 'b1', face: 5000, months: 24, paid: 4325, maturesOn: 'Mar 14, 2028', monthsLeft: 19, worthToday: 4459 },
  { id: 'b2', face: 2500, months: 12, paid: 2400, maturesOn: 'Jan 8, 2027', monthsLeft: 5, worthToday: 2436 },
];

/**
 * Home's asset-backed tier is exactly what the Earn positions back, so the two
 * pages are reading one number rather than agreeing by hand.
 */
const ASSET_BACKED_LIMIT = assetBackedLimit({
  pool: POOL,
  bonds: BONDS,
  bondLtv: BOND_LTV,
  poolLtv: POOL_LTV,
} as EarnData);

/**
 * Placeholder data for the rebuild — the design spec's own example values, so the
 * built pages can be diffed against the reference screens directly.
 *
 * Not fixtures for tests and not a fallback for production: pages take their data
 * as props, and these are what the preview harness passes in. Swap for the real
 * contexts (useClearBalances / useClearTransactions / CreditContext) when wiring.
 */

/**
 * The linked accounts the ACH fallback can draw on — spec §4c. An external account is what backs a
 * term plan, so this list is the product's collateral, not a convenience setting.
 */
const LINKED_ACCOUNTS: LinkedAccount[] = [
  {
    id: 'chase',
    name: 'Chase ····4471',
    detail: 'Checking · paycheck arrives here',
    kind: 'Checking',
    readForLimit: true,
  },
  { id: 'golden1', name: 'Golden 1 ····8802', detail: 'Savings', kind: 'Savings' },
];

const SPLIT_OPTIONS = [1, 2, 4, 12];

/**
 * The locked rows, which every member sees from the first minute regardless of how they signed up.
 * Each states its own unlock condition — that's what makes the shelf teach rather than tease.
 */
const LOCKED_PLANS: TermPlan[] = [
  {
    id: 'cash-plan',
    name: 'Cash plan',
    lockedNote: 'Unlocks after six clean cycles · 2.5% / cycle',
  },
  {
    id: 'ground-lease',
    name: 'Ground lease — your backyard',
    lockedNote: 'For members who own their home',
  },
  {
    id: 'elpa',
    name: 'ELPA — buy a home',
    lockedNote: '1,500 of 15,000 credits · on track for Feb 2028',
  },
];

/**
 * "In use" — cash spent to zero, credit engaged (spec §4), and the cycle in its **third state**:
 * drawn unsecured, with the deposit that's coming covering only part of it.
 *
 * The scenario, because the figures only reconcile if you know it: this member's hours were cut.
 * Their income-backed limit ($1,000) is still set from a trailing ~$2,000/mo — which is why the
 * limit breakdown and the Oct 25 payroll row both still say $2,000 — but the check landing Nov 1 is
 * only ~$500. They've drawn $700 against that tier, so $500 clears and $200 doesn't. A limit set
 * from a trailing average lagging a recent dip is exactly how a member ends up short, and it's the
 * one state in §4b that asks them for anything.
 *
 * Change `income.used` or `cashAccount.nextDepositEstimate` and the cycle moves between states on
 * its own — the three states are derived by `cycleStatus`, never set by hand.
 */
export const HOME_IN_USE: HomeData = {
  cash: 0,
  credit: {
    // Accrued so far this cycle, same elapsed fraction across both drawn tiers:
    // asset $2,400 × 0.65% × ⅔ = $10.40, income $700 × 1.5% × ⅔ = $7.00.
    carryCost: 17.4,
    carryFreeUnder: 3000,
    tiers: [
      { key: 'savings', label: 'Savings (CLRUSD)', shortLabel: 'Savings', rate: 'free', used: 3000, limit: 3000, added: true },
      { key: 'asset', label: 'Asset-backed', rate: '0.65–0.75%', used: 2400, limit: ASSET_BACKED_LIMIT, added: true },
      // The unsecured draw — the only figure the cycle strip reports, and what makes it state three.
      { key: 'income', label: 'Income-backed', shortLabel: 'Income', rate: '1.5% / cycle', used: 700, limit: 1000, added: true },
      { key: 'boost', label: 'Boost', rate: '3% / cycle', ratePerCycle: 0.03, used: 0, limit: 500, added: false },
    ],
  },
  cycle: {
    lengthDays: 30,
    daysLeft: 6,
    clearsOn: 'Nov 1 payday',
    rebalanceBy: 'Nov 12',
  },
  savings: {
    cash: 3000,
    vested: 1500,
    vesting: 1500,
    credits: 1500,
    creditsGoal: 15000,
    onTrackFor: 'Feb 2028',
  },
  cashAccount: {
    spendable: 0,
    // $0.00 is the resting state — this member is the exception the spec describes: they parked a
    // sweep on-chain and never placed it. It's also the money that resolves the cycle, which is why
    // Repay draws from here rather than from a bank pull that wouldn't land before Nov 12.
    readyToAllocate: 700,
    nextDepositOn: 'Nov 1',
    // The reduced check. One field feeds both the cash card's sub-line and what the cycle says the
    // deposit covers, so the two can't disagree.
    nextDepositEstimate: 500,
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
    { id: 'r1', name: 'Shell', date: 'Oct 26', source: 'credit', kind: 'spending', amount: -52.1, paidFromTier: 'asset' },
    { id: 'r2', name: 'Stater Bros', date: 'Oct 25', source: 'credit', kind: 'spending', amount: -118.44, paidFromTier: 'asset' },
    { id: 'r3', name: 'Payroll deposit', date: 'Oct 25', source: 'cash account', kind: 'deposit', amount: 2000 },
    { id: 'r4', name: 'Equity credits vested', date: 'Oct 25', source: 'savings', kind: 'savings', amount: 500 },
    { id: 'r5', name: 'Verizon', date: 'Oct 24', source: 'credit', kind: 'spending', amount: -85, paidFromTier: 'asset' },
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
  // Two live splits and the home still locked — the shelf a member sees a few months in.
  termPlans: {
    plans: [
      {
        id: 'mikes-tire',
        name: "Mike's Tire",
        openedOn: 'Jun',
        balance: 940,
        splitInto: 4,
        cyclesLeft: 2,
        rate: '2% / cycle',
        ratePerCycle: 0.02,
      },
      {
        id: 'cash-plan',
        name: 'Cash plan',
        balance: 410,
        splitInto: 2,
        cyclesLeft: 1,
        rate: '2.5% / cycle',
        ratePerCycle: 0.025,
      },
      LOCKED_PLANS[2],
    ],
    balanceLimit: 3000,
    perCycleLimit: 656,
    limitNote: 'from money in and out',
    accounts: LINKED_ACCOUNTS,
    clearsFromId: 'chase',
    splitOptions: SPLIT_OPTIONS,
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
  cycle: { lengthDays: 30, daysLeft: 0, clearsOn: '', rebalanceBy: '' },
  savings: { cash: 0, vested: 0, vesting: 0, credits: 0, creditsGoal: 15000 },
  cashAccount: {
    spendable: 0,
    readyToAllocate: 0,
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
  // Signed up directly: the whole shelf is locked, and partner credit leads because it's the row
  // this member is most likely to reach first.
  termPlans: {
    plans: [
      {
        id: 'partner-credit',
        name: 'Partner credit',
        lockedNote: 'Unlocks with a linked account · at partner shops · 2% / cycle',
      },
      LOCKED_PLANS[0],
      LOCKED_PLANS[1],
      { ...LOCKED_PLANS[2], lockedNote: '0 of 15,000 credits' },
    ],
    accounts: [],
    splitOptions: SPLIT_OPTIONS,
  },
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
/**
 * Four of the five names and descriptions are placeholders the product owner
 * still has to supply. They render as written — never invent a replacement.
 */
const ASSURANCE: AssuranceItem[] = [
  {
    id: 'a1',
    name: 'Home repair assurance',
    description:
      'Covers qualifying repairs on your unit once you move in, up to an annual cap.',
    unlocksAt: 0,
  },
  {
    id: 'a2',
    name: '[PLACEHOLDER — replace]',
    description: 'Real protection name and description needed.',
    unlocksAt: 1000,
    placeholder: true,
  },
  {
    id: 'a3',
    name: '[PLACEHOLDER — replace]',
    description: 'Real protection name and description needed.',
    unlocksAt: 4000,
    placeholder: true,
  },
  {
    id: 'a4',
    name: '[PLACEHOLDER — replace]',
    description: 'Real protection name and description needed.',
    unlocksAt: 8000,
    placeholder: true,
  },
  {
    id: 'a5',
    name: '[PLACEHOLDER — replace]',
    description: 'Real protection name and description needed.',
    unlocksAt: 15000,
    placeholder: true,
  },
];

export const ASSURANCE_RESERVE: AssuranceReserve = {
  balance: 412800,
  membersCovered: 184,
  claimsPaidThisYear: 8400,
  reportCadence: 'Quarterly',
};

export const ALERTS: Alert[] = [
  {
    id: 'n1',
    group: 'Today',
    tone: 'boost',
    time: '8:14 AM',
    title: "You're using Clear Credit",
    detail: 'Cash ran out at Shell. Savings-backed credit is free until $3,000.',
  },
  {
    id: 'n2',
    group: 'Today',
    tone: 'asset',
    time: '6:02 AM',
    title: '500 credits vested',
    detail: '1,500 of 15,000 toward your Clear Deed.',
  },
  {
    id: 'n3',
    group: 'This week',
    tone: 'muted',
    time: 'Nov 6',
    read: true,
    title: 'Rebalance by Nov 12',
    detail: 'Your payday on Nov 1 covers $500.00 of it — $200.00 short.',
    action: { label: 'View cycle', to: '/' },
  },
  {
    id: 'n4',
    group: 'This week',
    tone: 'muted',
    time: 'Nov 5',
    read: true,
    title: 'Vote open: which region next?',
    detail: 'Closes in 6 days.',
    action: { label: 'Cast vote', to: '/settings' },
  },
];

export const THREADS: Thread[] = [
  {
    id: 'support',
    name: 'Clear Support',
    initials: 'CS',
    subtitle: 'Usually replies within 4 hours',
    preview: "We've looked into the Shell charge — here's what…",
    time: '9:41 AM',
    unread: true,
  },
  {
    id: 'diego',
    name: 'Diego R.',
    initials: 'DR',
    preview: 'sent you $35 — thanks for covering lunch',
    time: 'Yesterday',
    unread: true,
  },
  {
    id: 'tinybox',
    name: 'TinyBox Systems',
    initials: 'TB',
    preview: 'Invoice for the site visit is attached',
    time: 'Oct 22',
  },
  {
    id: 'maria',
    name: 'Maria C.',
    initials: 'MC',
    preview: 'You: sounds good, see you Thursday',
    time: 'Oct 19',
  },
];

export const INBOX: InboxData = {
  alerts: ALERTS,
  threads: THREADS,
  messages: {
    support: [
      {
        id: 'm1',
        mine: true,
        body: 'The Shell charge on Oct 26 came off my credit line, not cash. Is that right?',
      },
      {
        id: 'm2',
        body: 'Yes — your cash account hit $0 that morning, so it drew from your savings-backed tier. That tier is free, so the charge cost you nothing extra.',
      },
      { id: 'm3', body: "Here's the tier breakdown for that day." },
      {
        id: 'm4',
        body: '',
        attachment: { label: 'Oct 26 · $52.10', tier: 'savings', note: 'Savings-backed · free' },
      },
    ],
    diego: [
      { id: 'd1', body: 'sent you $35 — thanks for covering lunch' },
      { id: 'd2', mine: true, body: 'Anytime' },
    ],
    tinybox: [{ id: 't1', body: 'Invoice for the site visit is attached' }],
    maria: [
      { id: 'r1', body: 'Thursday still work for the walkthrough?' },
      { id: 'r2', mine: true, body: 'sounds good, see you Thursday' },
    ],
  },
};

export const SAVINGS_IN_USE: SavingsData = {
  savings: HOME_IN_USE.savings,
  projection: { perPayday: 500, extraMonthly: 250, withExtra: 'Apr 2027' },
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
  projection: { perPayday: 500, extraMonthly: 250, withExtra: 'Apr 2027' },
  payFrom: PAY_FROM,
  creditLimitToday: 0,
  milestones: MILESTONES,
  assurance: ASSURANCE,
  vesting: [],
};

export const ACTIVITY_IN_USE: ActivityData = {
  // Carry cost is the same quantity Home reports; it moves with HOME_IN_USE.credit.carryCost.
  cycleSpend: { spent: 1842, daysLeft: 6, fromCash: 1242, fromCredit: 600, carryCost: 17.4 },
  categories: [
    { label: 'Groceries', amount: 412 },
    { label: 'Fuel', amount: 188 },
    { label: 'Bills', amount: 285 },
    { label: 'Everything else', amount: 957 },
  ],
  insideCoop: 35,
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
    {
      id: 't5',
      name: 'Stater Bros',
      date: 'Oct 25',
      source: 'credit',
      kind: 'spending',
      amount: -118.44,
      paidFromTier: 'asset',
      paidFromLabel: 'Asset-backed credit',
      rate: '0.65% per cycle',
      cardLast4: '8836',
    },
    {
      id: 't7',
      name: 'Diego R.',
      date: 'Oct 25',
      source: 'received',
      // Money in from a member — the Deposits filter is "money arriving", not just payroll.
      kind: 'deposit',
      amount: 35,
    },
    {
      id: 't8',
      name: 'Verizon',
      date: 'Oct 24',
      source: 'credit',
      kind: 'spending',
      amount: -85,
      paidFromTier: 'asset',
      paidFromLabel: 'Asset-backed credit',
      rate: '0.65% per cycle',
      cardLast4: '8836',
    },
    { id: 't6', name: 'Chipotle', date: 'Oct 23', source: 'cash', kind: 'spending', amount: -14.2 },
  ],
};

export const ACTIVITY_DAY_ONE: ActivityData = { rows: [] };

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
  periodTotal: 1842,
  variant: 'physical',
  controls: [
    { id: 'contactless', label: 'Contactless', on: true },
    { id: 'online', label: 'Online payments', on: true },
    { id: 'atm', label: 'ATM withdrawals', on: true },
    { id: 'international', label: 'International', on: false },
  ],
  perTransactionLimit: 2000,
  perDayLimit: 3000,
  transactions: [
    { id: 'c1', name: 'Shell', date: 'Oct 26', source: 'credit', kind: 'spending', amount: -52.1, paidFromTier: 'asset' },
    { id: 'c2', name: 'Stater Bros', date: 'Oct 25', source: 'credit', kind: 'spending', amount: -118.44, paidFromTier: 'asset' },
    { id: 'c3', name: 'Verizon', date: 'Oct 24', source: 'credit', kind: 'spending', amount: -85, paidFromTier: 'asset' },
    { id: 'c4', name: 'Chipotle', date: 'Oct 23', source: 'cash', kind: 'spending', amount: -14.2 },
    { id: 'c5', name: 'Costco', date: 'Oct 22', source: 'cash', kind: 'spending', amount: -212.66 },
    { id: 'c6', name: 'TinyBox Systems', date: 'Oct 22', source: 'cash', kind: 'spending', amount: -180 },
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
  periodTotal: 0,
  variant: 'physical',
  controls: [
    { id: 'contactless', label: 'Contactless', on: true },
    { id: 'online', label: 'Online payments', on: true },
    { id: 'atm', label: 'ATM withdrawals', on: true },
    { id: 'international', label: 'International', on: false },
  ],
  perTransactionLimit: 2000,
  perDayLimit: 3000,
  transactions: [],
};

/** Members and not-yet-members. Partners are a separate list — see PARTNERS. */
export const CONTACTS: Contact[] = [
  { id: 'p1', name: 'Diego R.', handle: '@diegor', initials: 'DR', role: 'member' },
  { id: 'p2', name: 'Maria C.', handle: '@mariac', initials: 'MC', role: 'member' },
  {
    id: 'p3',
    name: 'Marcus T.',
    contactPoint: '(909) 555-0177',
    initials: 'MT',
    role: 'member',
    pending: true,
  },
  { id: 'p4', name: 'Ana L.', handle: '@anal', initials: 'AL', role: 'member' },
  {
    id: 'p5',
    name: 'Jenna W.',
    contactPoint: 'jenna@example.com',
    initials: 'JW',
    role: 'member',
    pending: true,
  },
];

export const PARTNERS: Partner[] = [
  { id: 'b1', name: 'TinyBox Systems', initials: 'TB', category: 'Modular homes', city: 'Redlands' },
  { id: 'b2', name: 'Vega Electric', initials: 'VE', category: 'Trades', city: 'Redlands' },
  { id: 'b3', name: 'Rincon Coffee', initials: 'RC', category: 'Food & drink', city: 'Riverside' },
  { id: 'b4', name: 'Highland Supply', initials: 'HS', category: 'Materials', city: 'Highland' },
  { id: 'b5', name: 'Orange St Market', initials: 'OM', category: 'Groceries', city: 'Redlands' },
  {
    id: 'b6',
    name: 'Cortez Plumbing',
    initials: 'CP',
    category: 'Trades',
    city: 'San Bernardino',
  },
];

export const PARTNERS_DATA: PartnersData = {
  partners: PARTNERS,
  count: 14,
  region: 'the Inland Empire',
  radiusNote: 'Partners shown are within 20 miles of Redlands.',
  radiusShort: 'Within 20 miles of Redlands.',
};

export const SEND_IN_USE: SendData = {
  handle: '@kaim',
  codeUrl: 'https://useclear.org/pay/kaim',
  payFrom: PAY_FROM,
  contacts: CONTACTS,
  partners: PARTNERS,
  partnerCount: 14,
  keptInNetwork: 215,
  pendingClaim: { amount: 40, recipient: 'Marcus T.', sentOn: 'Oct 26', expiresInDays: 12 },
};

/** Day one — the code exists from the moment the account does; nobody paid yet. */
/** Day one — no contacts saved yet, but the partners nearby exist regardless. */
export const SEND_DAY_ONE: SendData = {
  handle: '@kaim',
  codeUrl: 'https://useclear.org/pay/kaim',
  payFrom: PAY_FROM,
  contacts: [],
  partners: PARTNERS,
  partnerCount: 14,
  keptInNetwork: 0,
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
  bondLtv: BOND_LTV,
  poolLtv: POOL_LTV,
  reserveDate: 'Mar 2029',
  pool: POOL,
  terms: BOND_TERMS,
  bonds: BONDS,
};

/** Day one — the pool and the ladder still exist, this member just isn't in them. */
export const EARN_DAY_ONE: EarnData = {
  earnedToDate: 0,
  payFrom: PAY_FROM,
  bondLtv: BOND_LTV,
  poolLtv: POOL_LTV,
  reserveDate: 'Mar 2029',
  pool: { ...POOL, position: 0, earned: 0 },
  terms: BOND_TERMS,
  bonds: [],
};

export const SETTINGS: SettingsData = {
  profile: {
    name: 'Kai Moore',
    initials: 'KM',
    // No photo in the placeholder — initials are the real fallback, and a stock
    // face here would make every screenshot look like it has a member it doesn't.
    avatarUrl: null,
    handle: '@kaim',
    memberSince: 'March 2026',
    legalName: 'Kai Moore',
    phone: '(909) 555-0148',
    email: 'kai@example.com',
    address: 'Redlands, CA',
    region: 'Inland Empire',
    votes: 1,
    walletAddress: '0x7a3f…91c4',
    dateOfBirth: '••/••/1994',
  },
  accelerationActive: false,
  accelerationBenefits: [
    { label: 'Clear Boost', standard: '$500', accelerated: '$750' },
    { label: 'Credits vest in', standard: '30 days', accelerated: '15 days' },
    { label: 'Income-backed rate', standard: '1.5%', accelerated: '1.25%' },
    { label: 'Priority on new communities', standard: '—', accelerated: '', acceleratedOnly: true },
  ],
  accelerationPlans: [
    { id: 'monthly', label: '$25 / month' },
    { id: 'annual', label: '$250 / year' },
  ],
  accelerationCyclesToBoost: 4,
  faceIdOn: true,
  paymentFaceIdOver: 200,
  lastLogin: 'today, 8:02 AM',
  recoveryContacts: [],
  devices: [
    { id: 'd1', name: 'iPhone 16 Pro', detail: 'Redlands, CA · active now', current: true },
    { id: 'd2', name: 'MacBook Pro', detail: 'Redlands, CA · 2 days ago' },
  ],
  notificationGroups: [
    {
      title: 'Money',
      prefs: [
        { id: 'card', label: 'Card transactions', detail: 'Every purchase' },
        { id: 'deposits', label: 'Deposits', detail: 'Payroll and transfers in' },
        { id: 'sent', label: 'Sent & received', detail: 'Member payments' },
      ],
    },
    {
      title: 'Credit',
      prefs: [
        { id: 'using', label: 'Using credit', detail: 'When you cross from cash into credit' },
        { id: 'rebalance', label: 'Rebalance reminder', detail: '3 days before your cycle ends' },
        { id: 'limit', label: 'Limit changes', detail: 'When your limit goes up or down' },
      ],
    },
    {
      title: 'Savings',
      prefs: [
        { id: 'vesting', label: 'Credits vesting', detail: 'When credits become yours' },
        { id: 'milestones', label: 'Milestones', detail: 'When you unlock a new step' },
      ],
    },
  ],
  linkedAccountCount: 2,
  externalBank: 'Chase ••4021',
  employer: 'Acme Logistics',
  votesCast: 2,
  legalDocs: [
    { id: 'membership', label: 'Membership agreement', detail: 'Accepted Mar 4, 2026', version: 'v2.1' },
    { id: 'bylaws', label: 'Bylaws', detail: 'Updated Jun 2026', version: 'v2.0' },
    { id: 'deposit', label: 'Deposit account terms', detail: 'Issued by our partner bank' },
    { id: 'credit', label: 'Clear Credit terms', detail: 'Rates, cycles, and how defaults work' },
    { id: 'cardholder', label: 'Cardholder agreement' },
    { id: 'privacy', label: 'Privacy policy' },
    { id: 'earn', label: 'Earn product disclosures', detail: 'Yield pool and BurnerBonds' },
  ],
  helpTopics: [
    { id: 'h1', question: 'How does my credit limit work?' },
    { id: 'h2', question: 'What are equity credits?' },
    { id: 'h3', question: 'When do I need to rebalance?' },
    { id: 'h4', question: 'How do I reserve a home?' },
  ],
  bylaws: {
    version: 'v2.0',
    updated: 'Jun 2026',
    articles: [
      {
        id: 'i',
        title: 'Article I — Membership',
        clauses: [
          {
            number: '1.1',
            text: 'Any natural person who maintains an Equity Savings Account in good standing shall be a member of the cooperative. No separate share purchase is required; the member\u2019s account balance constitutes their equity interest.',
          },
          {
            number: '1.2',
            text: 'Each member shall have one vote on all matters submitted to the membership, without regard to the size of their account balance.',
          },
        ],
      },
      {
        id: 'ii',
        title: 'Article II — Meetings and Voting',
        clauses: [
          {
            number: '2.1',
            text: 'An annual meeting of the membership shall be held within 120 days of the close of the fiscal year, on notice of not less than thirty days to every member of record.',
          },
          {
            number: '2.2',
            text: 'Special meetings may be called by the board, or on the written request of ten percent of the membership.',
          },
        ],
      },
      {
        id: 'iii',
        title: 'Article III — Surplus and Patronage',
        clauses: [
          {
            number: '3.1',
            text: 'Surplus remaining after costs and reserves shall be allocated to members in proportion to patronage, as determined by the board and ratified by the membership.',
          },
        ],
      },
    ],
  },
  patronage: {
    fiscalYear: '2026 fiscal year',
    status: 'In progress',
    basisRows: [
      { label: 'Carry cost you paid on credit', amount: 18.4 },
      { label: 'Interchange from your card spend', amount: 367 },
      { label: 'Acceleration fee, if any', amount: 0 },
    ],
    history: [],
  },
  ballot: {
    id: 'v1',
    question: 'Which region should we open next?',
    closesOn: 'Aug 19',
    closesInDays: 6,
    voted: 41,
    members: 118,
    options: [
      { id: 'o1', label: 'Phoenix / Tempe, AZ' },
      { id: 'o2', label: 'Las Vegas / Henderson, NV' },
      { id: 'o3', label: 'Expand within the Inland Empire' },
      { id: 'o4', label: 'Abstain' },
    ],
  },
  pastVotes: [
    {
      id: 'pv1',
      title: 'Approve 2026 bylaw amendment',
      detail: 'Jun 2026 · Passed 84%',
      participated: true,
    },
    {
      id: 'pv2',
      title: 'Elect regional council — IE',
      detail: 'Apr 2026 · Passed',
      participated: false,
    },
  ],
  logins: [
    { id: 'l1', device: 'iPhone 16 Pro', detail: 'Redlands, CA · Face ID', when: '8:02 AM' },
    { id: 'l2', device: 'MacBook Pro', detail: 'Redlands, CA · Code', when: 'Aug 12' },
    { id: 'l3', device: 'iPhone 16 Pro', detail: 'Redlands, CA · Face ID', when: 'Aug 11' },
  ],
  closure: {
    savingsReturned: 3000,
    creditToSettle: 3200,
    bondsNote: 'Held',
    creditsForfeited: 3000,
  },
};
