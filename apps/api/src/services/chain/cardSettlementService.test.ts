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

import { cardDebtToClear, carryAccruedCents } from './cardSettlementService.js';
const deposits = readFileSync(new URL('../deposits/depositReceiptService.ts', import.meta.url), 'utf8');

describe('a fiat repayment comes off the chain too', () => {
  test('repaid in full after settlement: all of it is cleared', () => {
    expect(cardDebtToClear({ offchainOwedCents: 0, notOnChainCents: 0, onChainCents: 17500 }).toClearCents).toBe(17500);
  });

  test('part repaid: only what was paid is cleared', () => {
    expect(cardDebtToClear({ offchainOwedCents: 7500, notOnChainCents: 0, onChainCents: 17500 }).toClearCents).toBe(10000);
  });

  test('money still on a pending hold is not mistaken for a repayment', () => {
    // Owes 175 settled + 50 pending; nothing repaid, so nothing comes off the chain.
    expect(cardDebtToClear({ offchainOwedCents: 22500, notOnChainCents: 5000, onChainCents: 17500 }).toClearCents).toBe(0);
  });

  test('already cleared is not cleared again', () => {
    expect(cardDebtToClear({ offchainOwedCents: 0, notOnChainCents: 0, onChainCents: 0 }).toClearCents).toBe(0);
  });

  test('repaid before it settled: cleared once it reaches the chain', () => {
    // Before settlement: nothing issued, nothing to clear. After: issued, and the repayment clears it.
    expect(cardDebtToClear({ offchainOwedCents: 0, notOnChainCents: 0, onChainCents: 0 }).toClearCents).toBe(0);
    expect(cardDebtToClear({ offchainOwedCents: 0, notOnChainCents: 0, onChainCents: 17500 }).toClearCents).toBe(17500);
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

describe('carry is owed, paid, and cleared too', () => {
  const settlement = readFileSync(new URL('../deposits/settlement.ts', import.meta.url), 'utf8');

  test('carry accrued is what the tiers hold beyond what was issued and not yet cleared', () => {
    expect(carryAccruedCents({ drawnCents: 17612, issuedCents: 17500, clearedCents: 0 })).toBe(112);
    // After a repayment of 10000 cleared on chain: drawn fell by the same, carry unchanged.
    expect(carryAccruedCents({ drawnCents: 7612, issuedCents: 17500, clearedCents: 10000 })).toBe(112);
    expect(carryAccruedCents({ drawnCents: 0, issuedCents: 17500, clearedCents: 17500 })).toBe(0);
  });

  test('a member who repaid principal but not carry still owes the carry on chain', () => {
    // Our ledger: principal 0, carry 112. Chain: 112 of carry on the tiers. Nothing to clear.
    expect(cardDebtToClear({ offchainOwedCents: 112, notOnChainCents: 0, onChainCents: 112 }).toClearCents).toBe(0);
  });

  test('once the carry is paid in fiat, it comes off the chain as well', () => {
    expect(cardDebtToClear({ offchainOwedCents: 0, notOnChainCents: 0, onChainCents: 112 }).toClearCents).toBe(112);
  });

  test('carry is written to the ledger before the target is measured, so it is never mistaken for a repayment', () => {
    expect(service.indexOf('await recordCarry(wallet, accrued)')).toBeLessThan(service.indexOf("AND NOT (direction = 'credit' AND event_type = 'credit_settlement' AND rail = 'chain')"));
    expect(service).toContain("VALUES ($1, $2, 'member_credit_carry', 'debit'");
    expect(service).toContain('ON CONFLICT DO NOTHING');
  });

  test('carry owed to a pool is left on chain, not netted against the float', () => {
    expect(service).toContain('const onChain = carryHeldElsewhere ? Math.max(0, issued - cleared) : drawnCents;');
    expect(service).toMatch(/if \(!carryHeldElsewhere\) \{\s*if \(record\) await recordCarry/);
  });

  test('a deposit pays carry before any principal', () => {
    expect(settlement).toMatch(/const carry = Math\.max\(0, Math\.round\(carryCents\)\);[\s\S]{0,120}settlements\.push\(\{ tier: 'carry'/);
    expect(deposits).toContain('planSettlement(term.remainingCents, outstanding, await readCarryOwed(client, wallet))');
  });
});

import { CHAIN_ERRORS, decodeChainError, describeCardRefusal } from './chainErrors.js';
const asaRoute = readFileSync(new URL('../../routes/lithicAuthStream.ts', import.meta.url), 'utf8');
const encumbrance = readFileSync(new URL('./encumbranceSync.ts', import.meta.url), 'utf8');

describe('authorized at approval, settled only up to it (audit M-2)', () => {
  test('the Auth Stream records the approval on chain only after it has answered', () => {
    const answered = asaRoute.indexOf('res.status(200).json({ result: outcome.decision.result });');
    const hook = asaRoute.indexOf('void afterApproval(transactionToken)');
    expect(answered).toBeGreaterThan(-1);
    expect(hook).toBeGreaterThan(answered);
    // Only a fresh approval with a credit part; a replay was already recorded.
    expect(asaRoute).toContain("outcome.decision.result === 'APPROVED' && outcome.decision.creditCents > 0 && !outcome.replayed");
    expect(index).toContain('onAuthorizationApproved(authorizeCardOnChain)');
    // The route itself still never imports anything that reaches a chain.
    expect(asaRoute).not.toContain('cardSettlementService');
  });

  test('settlement makes sure of the authorization first, and never settles more than it allows', () => {
    const settleAt = service.indexOf('const tx = await issuer.settleCardSpend(ref, row.wallet, units);');
    expect(service.indexOf('await ensureAuthorized(issuer, ref, row.wallet, units)')).toBeLessThan(settleAt);
    expect(service.indexOf('if (authorized < units) {')).toBeLessThan(settleAt);
  });

  test('a re-issue after a dispute is a fresh purchase to the contract, so it is authorized too', () => {
    const reissue = service.slice(service.indexOf('export async function reissueAfterDispute'));
    expect(reissue.indexOf('await ensureAuthorized(issuer, ref, row.wallet, units)')).toBeLessThan(reissue.indexOf('issuer.settleCardSpend('));
  });

  test('a card rule saying no goes to a person at once, not five retries', () => {
    expect(service).toContain("attempts >= MAX_ATTEMPTS || isCardRefusal(error) ? 'needs_review' : 'failed'");
  });

  test('refusals are sentences, with the figures', () => {
    const decode = (name: string, args: unknown[]) =>
      describeCardRefusal(decodeChainError({ data: CHAIN_ERRORS.encodeErrorResult(name, args) }));
    expect(decode('RevolvingIssuerMemberNotInGoodStanding', [ethers.ZeroAddress])).toContain('frozen or in default');
    expect(decode('RevolvingIssuerCardTxCap', [3_000_000_000n, 2_500_000_000n])).toBe(
      'Over the per-purchase card cap: $3,000.00 asked, the cap is $2,500.00.',
    );
    expect(decode('CreditIssuerDailyCapExceeded', [ethers.encodeBytes32String('CARD'), 100_000_000n, 0n])).toContain('today');
    expect(decode('RevolvingIssuerCardExceedsAuthorization', [ethers.ZeroHash, 2n, 1n])).toContain('more than was authorized');
  });
});

describe('a draw on savings keeps the CLRUSD lock current (audit M-3)', () => {
  test('synced after a settlement and after a re-issue', () => {
    expect(service.match(/await syncClrusdEncumbrance\(/g)?.length).toBe(2);
    const settled = service.indexOf('console.log(`[card-settlement] ${token} issued ${target}c on chain');
    expect(service.indexOf('await syncClrusdEncumbrance(', settled)).toBeGreaterThan(settled);
  });

  test('a transaction only when the record is behind, and never failing the draw', () => {
    expect(encumbrance).toContain('clrusd.syncEncumbrance.staticCall(member)');
    expect(encumbrance).toContain("if (live === recorded) return 'current';");
    expect(encumbrance).toContain("return 'failed';");
  });
});
