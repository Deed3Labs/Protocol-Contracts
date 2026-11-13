import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { PLAN_TERMS_TYPE_STRING, PLAN_TERMS_TYPES, planTermsTypedData, planDisclosureText } from '@clear/domain';
import { chargePlanTerms, explainChainError } from './chargeService';
import { CHAIN_ERRORS } from './chain/chainErrors';

const service = readFileSync(new URL('./chargeService.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../routes/charges.ts', import.meta.url), 'utf8');

const member = ethers.Wallet.createRandom();
const ISSUER = '0x00000000000000000000000000000000000000c3';
const charge = {
  memberWallet: member.address.toLowerCase(),
  merchantAddress: '0x00000000000000000000000000000000000000b2',
  merchantName: 'Corner Garage',
  amountCents: 94_000,
  payoutCents: 91_180,
};
const CYCLE = 30n * 86_400n;

/*
 * The digest `TermIssuer.planTermsDigest` computes, written out the way the contract writes it:
 * keccak256(abi.encode(PLAN_TERMS_TYPEHASH, ...fields, nonce, deadline)) under a domain separator
 * over ("Clear TermIssuer", "1", chainId, address(this)). If the shared typed data ever drifts from
 * the contract, this and the wallet's hash stop agreeing.
 */
function contractDigest(terms: ReturnType<typeof chargePlanTerms>['terms'], nonce: bigint, chainId: number) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const typehash = ethers.id(PLAN_TERMS_TYPE_STRING);
  const structHash = ethers.keccak256(
    coder.encode(
      ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint64', 'uint32', 'uint64', 'bytes32', 'uint256', 'uint256'],
      [typehash, terms.member, terms.merchant, terms.purchase, terms.payout, terms.ratePerCycle, terms.cycleLength, terms.installments, terms.installmentLength, terms.disclosureHash, nonce, terms.deadline],
    ),
  );
  const domainSeparator = ethers.keccak256(
    coder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        ethers.id('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
        ethers.id('Clear TermIssuer'),
        ethers.id('1'),
        chainId,
        ISSUER,
      ],
    ),
  );
  return ethers.keccak256(ethers.concat(['0x1901', domainSeparator, structHash]));
}

describe('a plan opens on terms the member signed (audit H-4)', () => {
  test('the shared typed data hashes to the digest the contract checks', () => {
    const { terms } = chargePlanTerms(charge, 4, CYCLE, 2_000_000_000);
    const td = planTermsTypedData({ chainId: 84532, termIssuer: ISSUER, terms, nonce: 3n });
    const walletHash = ethers.TypedDataEncoder.hash(td.domain, { PlanTerms: [...PLAN_TERMS_TYPES.PlanTerms] }, td.message);
    expect(walletHash).toBe(contractDigest(terms, 3n, 84532));
  });

  test('a member’s signature over it recovers to the member', async () => {
    const { terms } = chargePlanTerms(charge, 4, CYCLE, 2_000_000_000);
    const td = planTermsTypedData({ chainId: 84532, termIssuer: ISSUER, terms, nonce: 0n });
    const types = { PlanTerms: [...PLAN_TERMS_TYPES.PlanTerms] };
    const signature = await member.signTypedData(td.domain, types, td.message);
    expect(ethers.verifyTypedData(td.domain, types, td.message, signature)).toBe(member.address);
  });

  test('the disclosure hash is keccak-256 of the disclosure lines', () => {
    const { terms, disclosure } = chargePlanTerms(charge, 4, CYCLE, 2_000_000_000);
    expect(terms.disclosureHash).toBe(ethers.id(planDisclosureText(disclosure)));
    expect(disclosure[2]).toBe('Purchase: $940.00');
  });

  test('a reopened plan carries the payout in the sale’s own proportion', () => {
    const { terms } = chargePlanTerms(charge, 2, CYCLE, 2_000_000_000, { purchaseCents: 47_000, payoutCents: 45_590 });
    expect(terms.purchase).toBe('470000000');
    expect(terms.payout).toBe('455900000');
  });

  test('approve takes the signature and rebuilds the terms from the charge, never the request', () => {
    const approve = service.slice(service.indexOf('export async function approveCharge'));
    expect(approve).toContain("return { ok: false, reason: 'Sign the plan terms to approve this charge.' };");
    expect(approve).toContain('const expected = chargePlanTerms(claimed, installments');
    expect(approve.indexOf('samePlanTerms(expected.terms, signed.terms)')).toBeLessThan(approve.indexOf('issuer.openPlan('));
    expect(approve).toContain('issuer.openPlan(planTermsArg(expected.terms), signed.signature.trim())');
  });

  test('the member’s own session prepares and approves', () => {
    expect(routes).toContain("chargesRouter.post('/:code/approve/prepare', requireAuth");
    const approve = routes.slice(routes.indexOf("post('/:code/approve', requireAuth"));
    expect(approve).toContain('approveCharge(charge.code, charge.memberWallet, installments, signed)');
  });

  test('a reopened plan after a dispute is not opened without the member, and a person is told', () => {
    const reopen = service.slice(service.indexOf('export async function reopenPlanAfterDispute'));
    expect(reopen.indexOf('if (!signed) {')).toBeLessThan(reopen.indexOf('issuer.openPlan('));
    expect(reopen).toContain('needsSignature: true');
    expect(reopen).toContain('await alertOps(');
  });
});

describe('the new refusals are sentences', () => {
  const data = (name: string, args: unknown[]) => CHAIN_ERRORS.encodeErrorResult(name, args);

  test('a bad or expired signature asks the member to sign again', () => {
    expect(explainChainError({ data: data('TermIssuerBadSignature', [member.address]) })).toContain('approve again to sign');
    expect(explainChainError({ data: data('TermIssuerSignatureExpired', [1n]) })).toContain('timed out');
  });

  test('an inactive shop, a paused member and today’s cap each say so', () => {
    expect(explainChainError({ data: data('TermIssuerMerchantNotActive', [charge.merchantAddress]) })).toContain('shop');
    expect(explainChainError({ data: data('TermIssuerBehindSchedule', [member.address]) })).toContain('behind');
    expect(explainChainError({ data: data('CreditIssuerDailyCapExceeded', [ethers.encodeBytes32String('PLANS'), 1n, 0n]) })).toContain('today');
  });

  test('revert data nested the way ethers v6 nests it is still found', () => {
    const nested = { info: { error: { data: data('TermIssuerSignatureExpired', [1n]) } } };
    expect(explainChainError(nested)).toContain('timed out');
  });
});
