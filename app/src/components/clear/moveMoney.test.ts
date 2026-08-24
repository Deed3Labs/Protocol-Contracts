import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyKey } from '@/lib/amountEntry';
import { freeSavings } from '@/lib/freeSavings';

const DIALOG = readFileSync(join(import.meta.dir, 'MoveMoneyDialog.tsx'), 'utf8');
const CONNECTED = readFileSync(join(import.meta.dir, 'ConnectedMoveMoney.tsx'), 'utf8');
const HOOK = readFileSync(join(import.meta.dir, '../../hooks/useSavingsMove.ts'), 'utf8');
const GUARDS = readFileSync(join(import.meta.dir, '../../hooks/useOptionalWallet.ts'), 'utf8');

/*
 * Entry is string-based, not numeric: "250." is a state somebody passes through on the way to
 * "250.5", and parsing on every press erases the decimal point the moment it is entered.
 */
describe('typing an amount', () => {
  test('builds digits left to right', () => {
    expect(['2', '5', '0'].reduce(applyKey, '')).toBe('250');
  });

  test('keeps a trailing decimal point while it is being typed', () => {
    expect(applyKey('250', '.')).toBe('250.');
  });

  test('allows only one decimal point', () => {
    expect(applyKey('250.5', '.')).toBe('250.5');
  });

  test('stops at two decimal places', () => {
    // Accepting the third and rounding would change somebody's deposit behind their back.
    expect(applyKey('250.55', '5')).toBe('250.55');
  });

  test('a leading point becomes a leading zero', () => {
    expect(applyKey('', '.')).toBe('0.');
  });

  test('has no leading zeros', () => {
    expect(applyKey('0', '5')).toBe('5');
  });

  test('delete removes one character, and empty stays empty', () => {
    expect(applyKey('250', 'del')).toBe('25');
    expect(applyKey('', 'del')).toBe('');
  });
});

/*
 * Savings pledged against the credit line cannot leave — the token enforces it at transfer time.
 * A withdrawal capped at the total would offer an amount the chain will refuse.
 */
describe('what is free to withdraw', () => {
  test('excludes what is pledged', () => {
    expect(freeSavings(6000, 300_000)).toBe(3000);
  });

  test('never goes below zero', () => {
    expect(freeSavings(1000, 500_000)).toBe(0);
  });

  test('an unreadable credit line does not lock a member out of their own savings', () => {
    // The transfer still enforces the real rule, so the worst case is a rejected transaction
    // rather than telling somebody their money is locked when it is not.
    expect(freeSavings(6000, null)).toBe(6000);
  });
});

describe('one component, two directions', () => {
  test('each leg carries its own balance, which is what gives the presets stated meanings', () => {
    expect(DIALOG).toContain("isDeposit ? 'All' : 'All free'");
    expect(DIALOG).toContain('const available = isDeposit ? cashReady : savingsFree;');
  });

  test('the consequence flips with the direction', () => {
    expect(DIALOG).toContain('Credits earned');
    expect(DIALOG).toContain('Credits given up');
    expect(DIALOG).toContain('Your limit rises by');
    expect(DIALOG).toContain('Your limit drops by');
  });

  test('the cost of withdrawing is stated, not moralised', () => {
    // Three facts and no scare copy. A member taking out their own money is exercising the thing
    // that makes this an equity account rather than a lock-up.
    expect(DIALOG).toContain('Vested credits stay. Only the credits this money was still earning are given up.');
    expect(DIALOG).toContain('Credits given up');
    expect(DIALOG).toContain('Your limit drops by');
    // No confirmation gate in front of it — asserted on the rendered strings, not the file, so a
    // docblock explaining the rule cannot satisfy or break it.
    const rendered = DIALOG.match(/>[^<>{}]*[a-z][^<>{}]*</gi)?.join(' ') ?? '';
    expect(rendered).not.toMatch(/are you sure|be careful|cannot be undone/i);
  });

  test('swapping clears the amount', () => {
    // The caps differ between directions; carrying an amount that was valid one way into the
    // other would arrive already over the limit.
    expect(DIALOG).toContain("onDirectionChange(isDeposit ? 'withdraw' : 'deposit');\n    setTyped('');");
  });

  test('both rails exist and pick by direction', () => {
    expect(HOOK).toContain("const sponsored = direction === 'deposit' ? scDeposit : scRedeem;");
    expect(HOOK).toContain("const relayed = direction === 'deposit' ? gaslessDeposit : gaslessRedeem;");
  });
});

describe('empty is a different screen, not a disabled button', () => {
  test('nothing ready to allocate replaces the form', () => {
    expect(DIALOG).toContain('const nothingReady = isDeposit && cashReady <= 0;');
    expect(DIALOG).toContain('Add money first');
  });

  test('and only on the deposit leg', () => {
    // With savings to draw on, the other direction still works — an empty cash account is not an
    // empty account.
    expect(DIALOG).toContain('isDeposit && cashReady <= 0');
  });

  test('auto-save is offered there and nowhere else', () => {
    // Once, and inside the empty branch — which in source order sits between the eyebrow and the
    // keypad that only the form branch renders.
    expect(DIALOG.split('Set up auto-save instead').length - 1).toBe(1);
    const at = DIALOG.indexOf('Set up auto-save instead');
    expect(at).toBeGreaterThan(DIALOG.indexOf('Nothing ready to allocate'));
    expect(at).toBeLessThan(DIALOG.indexOf('<Keypad'));
  });
});

describe('the balances shown are the ones enforced', () => {
  test('savings is the whole balance, not its cash slice', () => {
    // `savings.cash` is one of three parts. Using it quoted $3,000.00 in the dialog on a page
    // whose own header read $6,000.00.
    expect(CONNECTED).toContain('savingsBalance(data.savings)');
  });

  test('the cash leg is ready-to-allocate, not card-spendable', () => {
    expect(CONNECTED).toContain('ready to allocate');
  });
});

/*
 * The preview harness renders these pages with no wallet providers. This broke twice — once in the
 * hook, then again in the component that consumed it — which is why the guards are a module rather
 * than a comment.
 */
describe('the preview harness still renders', () => {
  test('the guarded hooks are shared, not re-derived per consumer', () => {
    expect(GUARDS).toContain('export function useOptionalAddress');
    expect(GUARDS).toContain('export function useOptionalSmartWalletClient');
  });

  test('nothing under a page reaches for a raw wallet hook', () => {
    for (const source of [CONNECTED, HOOK]) {
      expect(source).not.toContain("from '@/lib/walletCompat'");
      expect(source).not.toContain("from '@privy-io/react-auth/smart-wallets'");
    }
  });

  test('and the dialog itself stays presentational', () => {
    expect(DIALOG).not.toContain('useSavingsMove');
    expect(DIALOG).not.toContain('useClearBalances');
  });
});
