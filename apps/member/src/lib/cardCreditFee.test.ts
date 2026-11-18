import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { cardTransactionRow, feeLabel } from './activityMapping';
import { creditFeeTotals } from './activityCycle';
import { cardCreditCostLine, quotedFee } from './cardCreditFee';
import type { CardTransaction } from '@/utils/apiClient';

/*
 * The card credit fee as the member sees it (decision 55): under the purchase that carried it, given
 * back after a full refund, totalled on the cycle, and disclosed before card spending from Savings is
 * allowed. Never shown for a fee that was not charged.
 */

const tx = (over: Partial<CardTransaction> = {}): CardTransaction => ({
  id: 'tx1',
  name: 'SHELL',
  at: '2026-11-17T04:35:00.000Z',
  amountCents: 5_000,
  mcc: '5541',
  city: null,
  state: null,
  draws: [{ source: 'asset', amountCents: 5_000 }],
  cardToken: 'card1',
  creditCents: 5_000,
  ...over,
});

describe('under the purchase', () => {
  test('a purchase that carried the fee shows it; the merchant amount is unchanged', () => {
    const row = cardTransactionRow(tx({ creditFeeCents: 30, creditFeeState: 'charged' }));
    expect(row.creditFee).toEqual({ amount: 0.3, returned: false, returnedAmount: 0 });
    expect(row.amount).toBe(-50);
    expect(feeLabel(row.creditFee!.amount)).toBe('30¢');
  });

  test('after a full refund it shows the fee given back', () => {
    const row = cardTransactionRow(tx({ creditFeeCents: 30, creditFeeState: 'returned', creditFeeReturned: true, reversed: true }));
    expect(row.creditFee).toEqual({ amount: 0.3, returned: true, returnedAmount: 0.3 });
  });

  test('part credited back shows what came back', () => {
    const row = cardTransactionRow(tx({ creditFeeCents: 30, creditFeeState: 'charged', creditFeeReturnedCents: 10 }));
    expect(row.creditFee).toEqual({ amount: 0.3, returned: false, returnedAmount: 0.1 });
  });

  test('no fee, a fee released with a void, or one waived: nothing shown', () => {
    expect(cardTransactionRow(tx()).creditFee).toBeUndefined();
    expect(cardTransactionRow(tx({ creditFeeCents: 30, creditFeeState: 'released' })).creditFee).toBeUndefined();
    expect(cardTransactionRow(tx({ creditFeeCents: 30, creditFeeState: 'waived' })).creditFee).toBeUndefined();
  });

  test('repaid means the purchase and its fee', () => {
    expect(cardTransactionRow(tx({ creditFeeCents: 30, creditFeeState: 'charged', creditRepaidCents: 5_000 })).creditRepaid).toBe('partial');
    expect(cardTransactionRow(tx({ creditFeeCents: 30, creditFeeState: 'charged', creditRepaidCents: 5_030 })).creditRepaid).toBe('full');
  });

  test('the detail view lists it under the purchase, named as the agreements name it', () => {
    const dialog = readFileSync(new URL('../components/clear/TransactionDetailDialog.tsx', import.meta.url), 'utf8');
    expect(dialog).toContain("label: 'Card credit fee'");
    expect(dialog).toContain("label: 'Card credit fee returned'");
  });
});

describe('on the cycle', () => {
  test('the cycle and the year to date, net of what was given back; nothing shown with none', () => {
    expect(
      creditFeeTotals({
        fee: { cents: 30, on: true },
        cycle: { chargedCents: 90, returnedCents: 30 },
        yearToDate: { chargedCents: 300, returnedCents: 30 },
      }),
    ).toEqual({ cycle: 0.6, yearToDate: 2.7 });
    expect(creditFeeTotals({ fee: { cents: 0, on: false }, cycle: { chargedCents: 0, returnedCents: 0 }, yearToDate: { chargedCents: 0, returnedCents: 0 } })).toBeUndefined();
    expect(creditFeeTotals(null)).toBeUndefined();
  });
});

describe('before card spending on credit is allowed', () => {
  test('the APR and the fee, said to be not charged yet while it is off', () => {
    expect(cardCreditCostLine(undefined)).toBe(
      'Savings-backed credit is 0% APR: it has no carry. Each card purchase that uses credit has a 30¢ card credit fee (not charged yet).',
    );
    expect(cardCreditCostLine({ cents: 0, on: false })).toContain('30¢ card credit fee (not charged yet)');
    expect(cardCreditCostLine({ cents: 30, on: true })).toContain('has a 30¢ card credit fee.');
    expect(quotedFee(125)).toBe('$1.25');
  });

  test('the Savings permission shows it', () => {
    const panel = readFileSync(new URL('../components/settings/PermissionsPanel.tsx', import.meta.url), 'utf8');
    expect(panel).toContain('cardCreditCostLine(autoRepay.cardCreditFee)');
  });

  test('the placeholder alert no longer calls savings-backed credit free', () => {
    const data = readFileSync(new URL('../data/clearPlaceholder.ts', import.meta.url), 'utf8');
    expect(data).not.toContain('Savings-backed credit is free until $3,000.');
    expect(data).toContain('30¢ card credit fee, not charged yet');
  });
});
