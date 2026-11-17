import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/*
 * Phase 2 re-split and pricing, read from the source: these paths talk to the chain, and what matters
 * here is the order of the checks and where each figure comes from.
 */
const resplit = readFileSync(new URL('./planResplit.ts', import.meta.url), 'utf8');
const pricing = readFileSync(new URL('./chain/planPricing.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../routes/credit.ts', import.meta.url), 'utf8');
const disputes = readFileSync(new URL('../routes/disputes.ts', import.meta.url), 'utf8');

describe('a re-split that costs more is signed by the member and submitted by the operator', () => {
  test('the typed data is the contract’s Resplit at planNonces(member)', () => {
    expect(resplit).toContain('resplitTypedData({');
    expect(resplit).toContain('state.issuer.planNonces(state.member)');
  });

  test('the rate is priced again at submit and must be the one signed', () => {
    const submit = resplit.slice(resplit.indexOf('export async function submitResplit'));
    expect(submit.indexOf('String(state.rateBps) !== String(input.rateBps)')).toBeLessThan(submit.indexOf('resplitWithSignature('));
  });

  test('the member’s own bounds are checked, since the operator path skips them on chain', () => {
    const submit = resplit.slice(resplit.indexOf('export async function submitResplit'));
    expect(submit.indexOf('await memberBounds(')).toBeLessThan(submit.indexOf('resplitWithSignature('));
    expect(resplit).toContain('issuer.arrearsOf(planId)');
    expect(resplit).toContain('issuer.splitAllowance(planId)');
  });

  test('re-priced on the principal alone, as _resplit does', () => {
    expect(resplit).toContain('BigInt(plan.principalOutstanding) - carry');
  });

  test('routes: prepare, then a signed submit behind a fresh Face ID', () => {
    expect(routes).toContain("creditRouter.post('/:wallet/plans/:planId/split/prepare'");
    expect(routes).toContain("creditRouter.post('/:wallet/plans/:planId/split', requireStepUp");
  });
});

describe('a plan is priced from chain, never a table', () => {
  test('state, product, cap and the merchant’s split terms are read the way _quote reads them', () => {
    expect(pricing).toContain('stateCodeOf(input.member)');
    expect(pricing).toContain('registry.splitTermsOf(input.merchant, input.installments)');
    expect(pricing).toContain('rates.effectiveMonthlyBps(stateCode, input.productId, input.principal)');
    expect(pricing).toContain('rates.isEnabled(stateCode, input.productId)');
  });
});

describe('a lost partner dispute is reopened on the member’s signature', () => {
  test('prepare and submit routes exist, the submit behind a fresh Face ID', () => {
    expect(disputes).toContain("disputesRouter.post('/:token/reopen/prepare'");
    expect(disputes).toContain("disputesRouter.post('/:token/reopen', requireStepUp");
  });
});
