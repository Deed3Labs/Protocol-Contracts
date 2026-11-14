import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('./autoRepayService.ts', import.meta.url), 'utf8');
const deposits = readFileSync(new URL('../deposits/depositReceiptService.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../routes/credit.ts', import.meta.url), 'utf8');
const sweeper = readFileSync(new URL('../../jobs/cardSettlementSweeper.ts', import.meta.url), 'utf8');

describe('a Spendable deposit clears what is owed first, then the rest is theirs (option 1)', () => {
  test('owed amount (carry and tiers) is earmarked, and auto-save only sees the rest', () => {
    expect(deposits).toContain('owedCents: autoClearOn ? totalOutstanding(outstanding) + carryOwed : 0,');
    expect(deposits).toContain('earmarkCents: Math.max(0, Math.min(input.availableCents, input.owedCents))');
    expect(deposits).toContain('plan.remainingCents = Math.max(0, plan.remainingCents - earmarkCents);');
  });

  test('only Spendable deposits, only for a member who switched it on; Bridge never', () => {
    expect(deposits).toContain("new Set<DepositRail>(['lithic_ach'])");
    expect(deposits).toContain('const autoClearOn = spendable && (await autoRepayEnabledFor(pool, wallet));');
  });
});

describe('repaid on chain under the member’s mandate, bounded by the chain', () => {
  // How a clearing behaves (hold, chain, transfer, retries) is tested against stand-ins in
  // deposits/autoClearRuns.test.ts. These check the wiring to the real chain.
  test('Phase 2b: capped at what is owed in the member’s scope, never at their USDC or approval', () => {
    expect(service).toContain('return Number((await owedInScope(issuer, run.wallet, scope)) / CENTS);');
    expect(service).toContain('await issuer.repayForMember(run.ref, run.wallet, BigInt(cents) * CENTS)');
    // Nothing reads the member's balance or allowance any more: the settler delivers the cash.
    expect(service).not.toContain('usdc.balanceOf(wallet)');
    expect(service).not.toContain('usdc.allowance(wallet');
  });

  test('the settler approves the issuer for exactly what it pays, and pays it', () => {
    expect(service).toContain('usdc.allowance(settler, issuerAddress)');
    expect(service.indexOf('usdc.approve(issuerAddress, amount)')).toBeLessThan(service.indexOf('issuer.repayForMember('));
  });

  test('AutoCleared says what was applied; the chain is asked by ref after a crash', () => {
    expect(service).toContain("parsed?.name === 'AutoCleared'");
    expect(service).toContain('issuer.autoRepaymentOf(run.ref)');
    expect(service).toContain('issuer.filters.AutoCleared(run.ref)');
  });

  test('the network-wide switch and the member’s own switch are read from the chain', () => {
    expect(service).toContain('.autoClearOffGlobal)');
    expect(service).toContain('enabled: async (wallet) => (await issuer.autoRepayEnabled(wallet)) as boolean');
    expect(service).toContain("errorName: (error) => decodeChainError(error)?.name ?? null");
  });

  test('turned off on chain: the member’s record follows', () => {
    expect(service).toMatch(/step\.action === 'off'[\s\S]{0,200}SET enabled = false/);
  });

  test('term clearings go through the same sweep, with the term chain side and the same switch', () => {
    expect(service).toContain('const term = await termChainSide(signer, line);');
    expect(service).toContain("if (run.kind !== 'term') return line;");
    expect(service).toContain('unbook: pgUnbook,');
  });

  test('books and the pool’s side are written from the transaction, like a Repay tap', () => {
    expect(service).toContain("await recordUsdcRepayment(run.wallet, hash, 'auto');");
  });

  test('the repayment token comes from the chain, not a hardcoded address', () => {
    expect(service).toContain('await ledger.reserveToken()');
    expect(service).not.toContain('assurancePool()');
    expect(service).not.toMatch(/0x036CbD53842c5426634e7929541eC2318f3dCF7e/);
  });

  test('the choice is recorded only once the member’s wallet has set it on chain', () => {
    expect(service).toContain('if (onChain !== enabled || (scope !== undefined && Number(onChainScope) !== scope)) {');
    expect(route).toContain('await setAutoRepayChoice(wallet, req.body?.enabled === true, scope)');
    expect(sweeper).toContain('await sweepAutoRepay()');
  });
});
