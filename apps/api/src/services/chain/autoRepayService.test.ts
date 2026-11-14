import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('./autoRepayService.ts', import.meta.url), 'utf8');
const deposits = readFileSync(new URL('../deposits/depositReceiptService.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../routes/credit.ts', import.meta.url), 'utf8');
const sweeper = readFileSync(new URL('../../jobs/cardSettlementSweeper.ts', import.meta.url), 'utf8');

describe('a USDC deposit repays what is owed first, then the rest is theirs', () => {
  test('owed amount (carry and tiers) is earmarked, and auto-save only sees the rest', () => {
    expect(deposits).toContain('const owed = totalOutstanding(outstanding) + (await readCarryOwed(client, wallet));');
    expect(deposits).toContain('earmarkCents = Math.min(amount, owed);');
    expect(deposits).toContain('plan.remainingCents = Math.max(0, plan.remainingCents - earmarkCents);');
  });

  test('only for a member who switched it on; ACH keeps settling on arrival as before', () => {
    expect(deposits).toContain("if (receipt.rail !== 'lithic_ach' && (await autoRepayEnabledFor(client, wallet)))");
  });
});

describe('repaid on chain under the member’s mandate, bounded by the chain', () => {
  test('Phase 2b: capped at what is owed in the member’s scope, never at their USDC or approval', () => {
    expect(service).toContain('const owed = await owedInScope(issuer, wallet, scope);');
    expect(service).toContain('let amount = owed < due ? owed : due;');
    expect(service).toContain("await issuer.repayForMember(ref, wallet, amount)");
    // Nothing reads the member's balance or allowance any more: the settler delivers the cash.
    expect(service).not.toContain('usdc.balanceOf(wallet)');
    expect(service).not.toContain('usdc.allowance(wallet');
  });

  test('the settler approves the issuer for exactly what it pays, and pays it', () => {
    const sweep = service.slice(service.indexOf('export async function sweepAutoRepay'));
    expect(sweep).toContain('usdc.allowance(settler, issuerAddress)');
    expect(sweep.indexOf('usdc.approve(issuerAddress, amount)')).toBeLessThan(sweep.indexOf('issuer.repayForMember('));
  });

  test('AutoCleared says what was applied and what is spendable; the member is told so', () => {
    expect(service).toContain("parsed?.name === 'AutoCleared'");
    expect(service).toContain('cleared · ${money(releasedCents)} now spendable');
  });

  test('nothing to clear waits; the network-wide switch pauses everyone', () => {
    expect(service).toContain("decoded?.name === 'RevolvingIssuerNothingToClear'");
    expect(service).toContain('if (terms.autoClearOffGlobal)');
  });

  test('turned off on chain: the earmark is released', () => {
    expect(service).toMatch(/if \(!\(\(await issuer\.autoRepayEnabled\(wallet\)\) as boolean\)\)[\s\S]{0,200}due_cents = 0/);
  });

  test('books and the pool’s side are written from the transaction, like a Repay tap', () => {
    expect(service).toContain("await recordUsdcRepayment(wallet, tx.hash, 'auto');");
  });

  test('the repayment token comes from the chain, not a hardcoded address', () => {
    expect(service).toContain('await assurance.reserveToken()');
    expect(service).not.toMatch(/0x036CbD53842c5426634e7929541eC2318f3dCF7e/);
  });

  test('the choice is recorded only once the member’s wallet has set it on chain', () => {
    expect(service).toContain('if (onChain !== enabled || (scope !== undefined && Number(onChainScope) !== scope)) {');
    expect(route).toContain('await setAutoRepayChoice(wallet, req.body?.enabled === true, scope)');
    expect(sweeper).toContain('await sweepAutoRepay()');
  });
});
