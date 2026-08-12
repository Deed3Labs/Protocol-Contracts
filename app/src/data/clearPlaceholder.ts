import type { HomeData } from '@/lib/clearModel';

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
    { id: 'r1', name: 'Shell', date: 'Oct 26', source: 'credit', amount: -52.1 },
    { id: 'r2', name: 'Stater Bros', date: 'Oct 25', source: 'credit', amount: -118.44 },
    { id: 'r3', name: 'Payroll deposit', date: 'Oct 25', source: 'cash account', amount: 2000 },
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
