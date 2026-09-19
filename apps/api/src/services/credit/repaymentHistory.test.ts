import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const history = readFileSync(new URL('./repaymentHistory.ts', import.meta.url), 'utf8');
const deposits = readFileSync(new URL('../deposits/depositReceiptService.ts', import.meta.url), 'utf8');
const auto = readFileSync(new URL('../chain/autoRepayService.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../routes/credit.ts', import.meta.url), 'utf8');

describe('every repayment shows, whichever way it was made', () => {
  test('on-chain repayments carry their method: savings detected, auto set by the sweep, else a Repay tap', () => {
    expect(deposits).toContain("(input.savingsCents ?? 0) > 0 ? 'savings' : (input.method ?? 'manual')");
    expect(auto).toContain("await recordUsdcRepayment(wallet, tx.hash, 'auto');");
  });

  test('bank deposits that paid down credit are listed as bank repayments', () => {
    expect(history).toContain("event_type = 'credit_settlement' AND rail = 'fiat'");
    expect(history).toContain("method: 'bank' as const");
  });

  test('rows recorded before the method existed still show, and a savings one is still named', () => {
    expect(history).toContain('NULL::text AS method');
    expect(history).toContain("paidFromSavings(r.tx_hash) ? 'savings' : 'manual'");
  });

  test('served to the member only', () => {
    expect(route).toMatch(/creditRouter\.get\('\/:wallet\/repayments'[\s\S]{0,160}requireWalletMatch/);
  });
});
