import { describe, expect, test } from 'bun:test';
import { ACTIVITY_IN_USE } from '@/data/clearPlaceholder';
import { DEFAULT_FILTERS, categoryShares, filterRows, groupByDay, rowTag, sortRows } from './activityView';

const rows = ACTIVITY_IN_USE.rows;

describe('where it went', () => {
  test('shares are whole numbers that add to 100, the catch-all taking the rounding', () => {
    const shares = categoryShares(ACTIVITY_IN_USE.categories!, 1842);
    expect(shares.map((s) => [s.label, s.pct])).toEqual([
      ['Groceries', 22],
      ['Bills', 15],
      ['Fuel', 10],
      ['Everything else', 53],
    ]);
  });
});

describe('the list', () => {
  test('direction and paid-from narrow the rows', () => {
    expect(filterRows(rows, { ...DEFAULT_FILTERS, direction: 'in' }, '').every((r) => r.amount > 0)).toBe(true);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, paidFrom: 'savings' }, '').map((r) => r.name)).toEqual(['Equity credits vested']);
  });

  test('search matches a merchant or an amount', () => {
    expect(filterRows(rows, DEFAULT_FILTERS, 'shell').map((r) => r.name)).toEqual(['Shell']);
    expect(filterRows(rows, DEFAULT_FILTERS, '$118.44').map((r) => r.name)).toEqual(['Stater Bros']);
  });

  test('days are sections in the order the rows arrive', () => {
    expect(groupByDay(rows).map((g) => g.day)).toEqual(['Today · Oct 26', 'Yesterday · Oct 25', 'Fri · Oct 24']);
  });

  test('largest sorts by size whichever way the money moved', () => {
    expect(sortRows(rows, 'largest')[0].name).toBe('Payroll deposit');
  });

  test('the tag says what paid, or what the row was', () => {
    const byName = (name: string) => rowTag(rows.find((r) => r.name === name)!).label;
    expect(byName('Shell')).toBe('Asset-backed');
    expect(byName('Chipotle')).toBe('Cash account');
    expect(byName('Diego R.')).toBe('Sent · @diegor');
    expect(byName("Mike's Tire")).toBe('Term plan · 2 of 4');
  });
});

import { cardTransactionRow } from './activityMapping';
import { sourceTag } from './clearModel';

describe('a credit purchase that has been repaid says so', () => {
  const base = {
    id: 't', name: 'MIKES TIRES', at: '2026-09-17T23:41:03Z', amountCents: 17500, heldCents: 17500,
    reversed: false, mcc: '7538', city: null, state: null, cardToken: 'c',
    draws: [{ source: 'savings', amountCents: 17500 }],
  };

  test('fully repaid: the row reads "Credit · repaid"', () => {
    const row = cardTransactionRow({ ...base, creditCents: 17500, creditRepaidCents: 17500 });
    expect(row.creditRepaid).toBe('full');
    expect(row.paidFromLabel).toBe('Credit · repaid');
    expect(sourceTag(row).label).toBe('Credit · repaid');
  });

  test('part repaid, and not repaid', () => {
    expect(cardTransactionRow({ ...base, creditCents: 17500, creditRepaidCents: 500 }).paidFromLabel).toBe('Credit · part repaid');
    const owed = cardTransactionRow({ ...base, creditCents: 17500, creditRepaidCents: 0 });
    expect(owed.paidFromLabel).toBe('Credit');
    expect(owed.creditRepaid).toBeUndefined();
  });
});

import { mergedActivityRows, repaymentRow } from './activityMapping';
import { rowTag } from './activityView';

describe('repayments show in Activity, named by how they were paid', () => {
  const entries = [
    { id: 'repay:0xb2f1', at: '2026-09-19T00:00:07Z', amountCents: 2500, method: 'savings' as const, txHash: '0xb2f1b716' },
    { id: 'repay:grp', at: '2026-09-18T20:55:23Z', amountCents: 17500, method: 'bank' as const, txHash: null },
  ];

  test('each method is labelled', () => {
    expect(rowTag(repaymentRow(entries[0])).label).toBe('Repaid · Savings');
    expect(sourceTag(repaymentRow(entries[1])).label).toBe('Repaid · Bank deposit');
    expect(repaymentRow({ ...entries[0], method: 'auto' }).paidFromLabel).toBe('USDC · automatic');
    expect(repaymentRow({ ...entries[0], method: 'manual' }).paidFromLabel).toBe('USDC');
  });

  test('negative: it left whatever paid it', () => {
    expect(repaymentRow(entries[1]).amount).toBe(-175);
    expect(repaymentRow(entries[1]).kind).toBe('repayment');
  });

  test('the token transfer behind an on-chain repayment is folded in, not listed twice', () => {
    const transfer = {
      id: '0xwallet:0xb2f1b716', name: 'USDC transfer', category: 'Transfer', date: 'Sep 19', ts: Date.parse('2026-09-19T00:00:07Z'),
      amount: -25, status: 'completed', source: '0xwallet', internal: false, spendCategory: 'Misc',
    } as never;
    const rows = mergedActivityRows([transfer], [], undefined, entries);
    expect(rows.map((r) => r.name)).toEqual(['Credit repayment', 'Credit repayment']);
  });

  test('a plan payment is named for the plan and tagged with where the schedule stands', () => {
    const row = repaymentRow({
      ...entries[0], id: 'plan:0xab:3', method: 'manual', amountCents: 10200,
      plan: { planId: 3, name: "Mike's Tire", index: 2, count: 4 },
    });
    expect(row.name).toBe("Mike's Tire payment");
    expect(rowTag(row).label).toBe('Term plan · 2 of 4');
    expect(row.amount).toBe(-102);
  });
});

describe('one tag for a row on every list', () => {
  const { readFileSync: rf } = require('node:fs');
  const { join: j } = require('node:path');
  const src = (p: string) => rf(j(import.meta.dirname, '..', p), 'utf8');

  test('a repaid credit purchase says so in the shared tag, with its colour kept', () => {
    const base = { id: 'x', name: 'DISPUTE TEST GARAGE', date: 'Sep 18', kind: 'card', source: 'credit', amount: -25 } as never;
    expect(rowTag({ ...(base as object), creditRepaid: 'full' } as never).label).toBe('Credit · repaid');
    expect(rowTag({ ...(base as object), creditRepaid: 'part', paidFromTier: 'income' } as never)).toEqual({
      label: 'Income-backed · part repaid',
      className: 'c-t-inc',
    });
  });

  test('Home recent activity and the Card page use it, as Activity does', () => {
    expect(src('components/clear/RecentActivityCard.tsx')).toContain('const tag = rowTag(row);');
    expect(src('pages/app/CardPage.tsx')).toContain('const tag = rowTag(row);');
    expect(src('pages/app/ActivityPage.tsx')).toContain('const t = rowTag(row);');
  });
});

describe('the card page', () => {
  const { readFileSync: rf } = require('node:fs');
  const { join: j } = require('node:path');
  const src = (p: string) => rf(j(import.meta.dirname, '..', p), 'utf8');

  test('the stack swipes on a phone: no pointer capture to lose mid-gesture, as in SwipeRow', () => {
    const stack = src('components/clear/card/CardStack.tsx');
    expect(stack).not.toContain('setPointerCapture?.(');
    expect(stack).not.toContain('onLostPointerCapture');
  });

  test('the selection follows the real cards when they replace the placeholder', () => {
    expect(src('pages/app/CardPage.tsx')).toMatch(/if \(wallet\.some\(\(c\) => c\.id === activeId\)\) return;\s*setActiveId\(wallet\[0\]\.id\);\s*setChosenKind\(wallet\[0\]\.variant\);/);
  });
});

describe('the card shows the network logo, not its name', () => {
  const { readFileSync: rf } = require('node:fs');
  const { join: j } = require('node:path');
  const src = (p: string) => rf(j(import.meta.dirname, '..', p), 'utf8');
  test('the live card face draws the mark from the one asset file', () => {
    expect(src('components/clear/card/CardFace.tsx')).toContain('<NetworkMark network={network} className="c-cnet" />');
    expect(src('components/clear/card/NetworkMark.tsx')).toContain("from '@/assets/brand/networkMarks'");
  });
  test('it takes the card\'s own light ink in both themes', () => {
    const css = src('styles/clear-components.css');
    expect(css).toContain('.c-cnet{height:13px;width:auto;flex-shrink:0;color:var(--paper);opacity:.95}');
    expect(css).toMatch(/\.dark \.c-pan,\.dark \.c-cardface \.c-wm,\.dark \.c-cstate,\.dark \.c-cnet,\.dark \.c-cbrand \.c-cmk\{color:#DFE3DE\}/);
  });
  test('the Clear lockup sits on the card: the mark as given, beside a slightly larger word', () => {
    expect(src('components/clear/card/CardFace.tsx')).toMatch(/<span className="c-cbrand">\s*<ClearMark className="c-cmk" \/>\s*<span className="c-wm">Clear<\/span>/);
    const css = src('styles/clear-components.css');
    expect(css).toContain('.c-cbrand .c-cmk{display:block;flex-shrink:0;width:18px;height:18px;color:var(--paper)}');
    expect(css).toContain('.c-cbrand .c-wm{font-size:17px;line-height:1;margin-left:9px}');
  });
  test('no "Online only" pill on a virtual card; a frozen card still says so', () => {
    const face = src('components/clear/card/CardFace.tsx');
    expect(face).not.toContain('Online only');
    expect(face).toContain('Frozen</span>');
  });
});
