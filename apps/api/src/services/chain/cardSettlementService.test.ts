import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { creditCentsOf, refOf } from './cardSettlementService.js';

const service = readFileSync(new URL('./cardSettlementService.ts', import.meta.url), 'utf8');
const events = readFileSync(new URL('../lithic/cardTransactionEvents.ts', import.meta.url), 'utf8');
const held = readFileSync(new URL('../lithic/cardTransactionsService.ts', import.meta.url), 'utf8');
const index = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');

describe('only the credit part of a purchase becomes debt', () => {
  test('cash draws are the member’s own money and are not issued', () => {
    expect(
      creditCentsOf([
        { source: 'cash', amountCents: 2500 },
        { source: 'savings', amountCents: 10000 },
        { source: 'asset', amountCents: 5000 },
      ]),
    ).toBe(15000);
    expect(creditCentsOf([{ source: 'cash', amountCents: 17500 }])).toBe(0);
    expect(creditCentsOf(null)).toBe(0);
  });

  test('the on-chain ref is the hashed Lithic token, so the chain carries no Lithic id', () => {
    expect(refOf('13d8cfa7-a2f3-454a-8801-aec7fea1ba01')).toBe(ethers.id('13d8cfa7-a2f3-454a-8801-aec7fea1ba01'));
  });
});

describe('issued at settlement, once, and never silently', () => {
  test('only a settled approval is issued — pending can still be voided', () => {
    expect(service).toContain("row.result !== 'APPROVED' || row.status !== 'SETTLED'");
    expect(events).toMatch(/if \(status === 'SETTLED'\) \{\s*void syncCardSettlement\(transactionToken\)/);
  });

  test('a settlement the contract already has is recorded, not sent again', () => {
    expect(service.indexOf('issuer.cardSettlementOf(ref)')).toBeLessThan(service.indexOf('issuer.settleCardSpend('));
  });

  test('every outcome is stored; five failures stop the retries for a person to look', () => {
    expect(service).toContain("attempts >= MAX_ATTEMPTS ? 'needs_review' : 'failed'");
    expect(service).toContain('const MAX_ATTEMPTS = 5;');
  });

  test('a refund after settlement is given back on chain', () => {
    expect(service).toMatch(/if \(target < issued\)[\s\S]{0,120}reverseCardSpend\(ref, BigInt\(issued - target\)/);
  });

  test('the sweeper backs up the webhook, and is inert without a key', () => {
    expect(index).toContain('startCardSettlementSweeper()');
    expect(service).toContain("(process.env.CARD_SETTLER_PRIVATE_KEY || '').trim()");
  });
});

describe('a settled purchase is not shown twice', () => {
  test('once issued, its credit part stops counting as a pending hold', () => {
    expect(held).toContain("const onChain = row.onchain_status === 'issued';");
    expect(held).toContain("if (onChain && source !== 'cash') continue;");
  });
});

import { cardDebtToClear } from './cardSettlementService.js';
const deposits = readFileSync(new URL('../deposits/depositReceiptService.ts', import.meta.url), 'utf8');

describe('a fiat repayment comes off the chain too', () => {
  test('repaid in full after settlement: all of it is cleared', () => {
    expect(cardDebtToClear({ offchainOwedCents: 0, notOnChainCents: 0, issuedCents: 17500, clearedCents: 0 }).toClearCents).toBe(17500);
  });

  test('part repaid: only what was paid is cleared', () => {
    expect(cardDebtToClear({ offchainOwedCents: 7500, notOnChainCents: 0, issuedCents: 17500, clearedCents: 0 }).toClearCents).toBe(10000);
  });

  test('money still on a pending hold is not mistaken for a repayment', () => {
    // Owes 175 settled + 50 pending; nothing repaid, so nothing comes off the chain.
    expect(cardDebtToClear({ offchainOwedCents: 22500, notOnChainCents: 5000, issuedCents: 17500, clearedCents: 0 }).toClearCents).toBe(0);
  });

  test('already cleared is not cleared again', () => {
    expect(cardDebtToClear({ offchainOwedCents: 0, notOnChainCents: 0, issuedCents: 17500, clearedCents: 17500 }).toClearCents).toBe(0);
  });

  test('repaid before it settled: cleared once it reaches the chain', () => {
    // Before settlement: nothing issued, nothing to clear. After: issued, and the repayment clears it.
    expect(cardDebtToClear({ offchainOwedCents: 0, notOnChainCents: 0, issuedCents: 0, clearedCents: 0 }).toClearCents).toBe(0);
    expect(cardDebtToClear({ offchainOwedCents: 0, notOnChainCents: 0, issuedCents: 17500, clearedCents: 0 }).toClearCents).toBe(17500);
  });

  test('only fiat repayments count — USDC did not refill the float', () => {
    expect(service).toContain("AND NOT (direction = 'credit' AND event_type = 'credit_settlement' AND rail = 'chain')");
    expect(deposits).toMatch(/if \(plan && receipt\.rail === 'lithic_ach'\) \{\s*void syncCardRepayment\(wallet\)/);
  });

  test('a retry resumes under its own ref and asks the chain first', () => {
    expect(service).toContain('issuer.cardRepaymentOf(attempt.ref)');
    expect(service).toContain('ethers.id(`card-repay:${wallet}:${seq}`)');
  });
});
