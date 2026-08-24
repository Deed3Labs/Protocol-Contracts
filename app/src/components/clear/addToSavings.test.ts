import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIALOG = readFileSync(join(import.meta.dir, 'AddToSavingsDialog.tsx'), 'utf8');
const CONNECTED = readFileSync(join(import.meta.dir, 'ConnectedAddToSavings.tsx'), 'utf8');
const HOOK = readFileSync(join(import.meta.dir, '../../hooks/useSavingsDeposit.ts'), 'utf8');

/*
 * The general deposit, as distinct from auto-save. Auto-save is a standing instruction; this is
 * "put $500 in now", and it had been routed through the recurring setup flow for want of a wired
 * component.
 */
describe('the deposit actually deposits', () => {
  test('every call site gets the connected version', () => {
    for (const page of ['../../pages/app/HomePage.tsx', '../../pages/app/SavingsPage.tsx']) {
      const source = readFileSync(join(import.meta.dir, page), 'utf8');
      expect(source).toContain('ConnectedAddToSavings');
      // The bare dialog does nothing on press — that was the bug.
      expect(source).not.toContain('<AddToSavingsDialog');
    }
  });

  test('and onAdd is wired rather than left undefined', () => {
    expect(CONNECTED).toContain('onAdd={(amount) => void deposit(amount)}');
  });
});

/*
 * One number, shown and enforced. These disagreed the first time round and the disagreement was
 * visible on screen: a From row reading $6,200.00 above a warning that the account held $0.00.
 */
describe('the balance shown is the balance enforced', () => {
  test('the cap reads the same field the From row displays', () => {
    expect(DIALOG).toContain('const available = data.payFrom.balance;');
    expect(DIALOG).toContain('const overBalance = amount > available;');
  });

  test('no second balance is passed in beside it', () => {
    expect(DIALOG).not.toContain('maxAmount');
    expect(CONNECTED).not.toContain('maxAmount');
  });

  test('the live balance replaces the displayed one rather than sitting next to it', () => {
    expect(CONNECTED).toContain('payFrom: { ...data.payFrom, balance: balances.cash }');
  });

  test('and only once it has been read', () => {
    // Refusing a deposit on a balance we have not seen would blame a member for our latency.
    expect(CONNECTED).toContain('const live = !balances.loading && balances.total > 0;');
  });
});

/*
 * Which rail a deposit takes is a property of the member's wallet, not of the screen. Neither
 * reaches the UI, because neither changes anything a member decides.
 */
describe('how the money moves', () => {
  test('smart accounts send a sponsored op, EOAs fall back to the relayer', () => {
    expect(HOOK).toContain('scDeposit(');
    expect(HOOK).toContain('gaslessDeposit(');
    expect(HOOK.indexOf('scDeposit(')).toBeLessThan(HOOK.indexOf('gaslessDeposit('));
  });

  test('the amount is a fixed-precision string, never a float', () => {
    // It becomes token micros. 0.1 + 0.2 has no business near somebody's savings balance.
    expect(HOOK).toContain('amount.toFixed(2)');
  });

  test('it is extracted rather than copied out of TransferModal', () => {
    const transfer = readFileSync(join(import.meta.dir, '../app-ui/TransferModal.tsx'), 'utf8');
    // Two implementations of "how money reaches savings" is how they end up disagreeing about
    // which paths a member has.
    expect(transfer).toContain('gaslessDeposit');
    expect(HOOK).toContain('Extracted from TransferModal');
  });
});

/*
 * The design preview renders these same pages with no wallet providers at all. A component
 * reaching for a wallet hook two levels below a page is what blanked the harness.
 */
describe('the preview harness still renders', () => {
  test('both wallet hooks are provider-optional', () => {
    expect(HOOK).toContain('function useOptionalSmartWalletClient');
    expect(HOOK).toContain('function useOptionalAddress');
  });

  test('and the dialog itself stays presentational', () => {
    expect(DIALOG).not.toContain('useSavingsDeposit');
    expect(DIALOG).not.toContain('useClearBalances');
  });
});

describe('the receipt', () => {
  test('replaces the form rather than closing on it', () => {
    // A deposit that just vanishes leaves somebody unsure whether it happened.
    expect(DIALOG).toContain('txHash ? (');
    expect(DIALOG).toContain('Added to savings');
  });

  test('is cleared on close, not on open', () => {
    // Clearing on open would blank the receipt the member just landed on.
    expect(CONNECTED).toContain('if (!next) reset();');
  });
});
