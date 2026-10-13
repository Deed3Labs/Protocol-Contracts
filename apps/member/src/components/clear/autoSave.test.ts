import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  autoSaveFromRules,
  DEPOSIT_MATCH_MONTHLY_CAP,
  firstAutoSaveRun,
  monthlyAutoSave,
  monthlyAutoSaveCredits,
  onTrackFor,
  withOnTrack,
} from '@/lib/clearModel';

const DIALOG = readFileSync(join(import.meta.dir, 'AutoSaveDialog.tsx'), 'utf8');
const CONNECTED = readFileSync(join(import.meta.dir, 'ConnectedAutoSave.tsx'), 'utf8');
const HOOK = readFileSync(join(import.meta.dir, '../../hooks/useAutoSave.ts'), 'utf8');
const DATA = readFileSync(join(import.meta.dir, '../../hooks/useSavingsData.ts'), 'utf8');
const ACTIONS = readFileSync(join(import.meta.dir, '../../context/MoneyActionsContext.tsx'), 'utf8');

const rule = (over: Partial<Parameters<typeof autoSaveFromRules>[0][number]> = {}) => ({
  status: 'active',
  amountUsdc: 250,
  cadence: 'monthly' as const,
  nextRunAt: '2026-11-13T00:00:00.000Z',
  runsLeft: 11,
  ...over,
});

describe('the auto-save Savings shows is the active autopay rule', () => {
  test('none running reads as off', () => {
    expect(autoSaveFromRules([])).toBeUndefined();
    expect(autoSaveFromRules([rule({ status: 'exhausted' }), rule({ status: 'expired' })])).toBeUndefined();
  });

  test('the newest active rule wins: the API lists newest first', () => {
    const shown = autoSaveFromRules([rule({ status: 'exhausted', amountUsdc: 900 }), rule({ amountUsdc: 100, cadence: 'weekly' }), rule()]);
    expect(shown).toEqual({ amount: 100, cadence: 'weekly', nextRunAt: '2026-11-13T00:00:00.000Z', runsLeft: 11 });
  });

  test('the yearly total is the API\'s, and absent when it does not report one', () => {
    expect(autoSaveFromRules([rule()], 750)?.savedThisYear).toBe(750);
    expect(autoSaveFromRules([rule()], 0)?.savedThisYear).toBe(0);
    expect(autoSaveFromRules([rule()], null)?.savedThisYear).toBeUndefined();
    expect(autoSaveFromRules([rule()])?.savedThisYear).toBeUndefined();
  });

  test('a failed read keeps the last rules instead of reading as off', () => {
    expect(DATA).toContain('if (!cancelled && summary) setAutopay(summary)');
  });
});

describe('a new rule first runs one period out, as the API schedules it', () => {
  const from = new Date(2026, 9, 13);
  test('weekly is a week', () => {
    expect(firstAutoSaveRun('weekly', from)).toEqual(new Date(2026, 9, 20));
  });
  test('monthly is a calendar month', () => {
    expect(firstAutoSaveRun('monthly', from)).toEqual(new Date(2026, 10, 13));
  });
});

describe('setting auto-save', () => {
  test('signs the new rule before cancelling the old, so backing out keeps what was running', () => {
    expect(HOOK.indexOf('installAutopaySession({')).toBeGreaterThan(-1);
    expect(HOOK.indexOf('installAutopaySession({')).toBeLessThan(HOOK.indexOf('replaced.map((id) => cancelAutopayRule'));
  });

  test('re-reads the page once the server has answered', () => {
    expect(HOOK).toContain('markChainSettled()');
  });

  test('payday is not offered: the sweep rule it maps to moves no money yet', () => {
    expect(DIALOG).not.toContain("id: 'payday'");
  });
});

describe('the preview harness still renders', () => {
  test('nothing under a page reaches for a raw wallet hook', () => {
    for (const source of [CONNECTED, HOOK]) {
      expect(source).not.toContain("from '@/lib/walletCompat'");
      expect(source).not.toContain("from '@privy-io/react-auth/smart-wallets'");
    }
  });

  test('and the dialog itself stays presentational', () => {
    expect(DIALOG).not.toContain('useAutoSave');
    expect(DIALOG).not.toContain('installAutopaySession');
  });
});

describe('one auto-save screen', () => {
  test('every entry point outside Savings opens the same connected dialog', () => {
    expect(ACTIONS).toContain('<ConnectedAutoSave');
    expect(ACTIONS).not.toContain('AutoSaveModal');
  });
});

describe('the "On track for" date is the auto-save rate', () => {
  const from = new Date(2026, 9, 13);

  test('weekly is 52 runs a year; payday 26', () => {
    expect(monthlyAutoSave({ amount: 120, cadence: 'weekly' })).toBe(520);
    expect(monthlyAutoSave({ amount: 120, cadence: 'payday' })).toBe(260);
    expect(monthlyAutoSave({ amount: 120, cadence: 'monthly' })).toBe(120);
  });

  test('credits a month stop at the match cap', () => {
    expect(monthlyAutoSaveCredits({ amount: 1000, cadence: 'monthly' })).toBe(1000);
    expect(monthlyAutoSaveCredits({ amount: 500, cadence: 'weekly' })).toBe(DEPOSIT_MATCH_MONTHLY_CAP);
    expect(monthlyAutoSaveCredits(undefined)).toBe(0);
  });

  test('the month the last credit lands', () => {
    // 13,500 to go at 1,000 a month is 14 months: December 2027.
    expect(onTrackFor(1500, 15000, 1000, from)).toBe('Dec 2027');
    // A part month still has to be waited out: 13,500 at 1,300 is 10.4 months, so 11.
    expect(onTrackFor(1500, 15000, 1300, from)).toBe('Sep 2027');
    expect(onTrackFor(14999, 15000, 1000, from)).toBe('Nov 2026');
  });

  test('no rate, no date; and none once the path is complete', () => {
    expect(onTrackFor(1500, 15000, 0, from)).toBeUndefined();
    expect(onTrackFor(15000, 15000, 1000, from)).toBeUndefined();
  });

  test('a date carried in from a fixture or memory is replaced, never kept', () => {
    const savings = { cash: 0, vested: 0, vesting: 0, credits: 1500, creditsGoal: 15000, onTrackFor: 'Jan 2030' };
    expect(withOnTrack(savings, undefined, from).onTrackFor).toBeUndefined();
    expect(withOnTrack(savings, { amount: 1000, cadence: 'monthly' }, from).onTrackFor).toBe('Dec 2027');
  });
});

describe('Home and Savings show one date', () => {
  const HOME = readFileSync(join(import.meta.dir, '../../pages/app/HomeRoute.tsx'), 'utf8');

  test('both work it out with the same rule, from the same remembered auto-save', () => {
    for (const source of [HOME, DATA]) {
      expect(source).toContain('withOnTrack(');
      expect(source).toContain('`autosave:${walletKey(address)}`');
    }
  });
});
