import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { PLAN_PRODUCTS, PLAN_TERMS_TYPE_STRING, PLAN_TERMS_TYPES, planTermsTypedData, planDisclosureText } from '@clear/domain';
import { chargePlanTerms, explainChainError, TERM_ISSUER_ABI } from './chargeService';
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
};
const CYCLE = 30n * 86_400n;
/** What `quoteTermPlan` reads from chain for this charge: 2% a month, a 3% discount. */
const QUOTE = { rateBps: 200n, payout: 940_000_000n - (940_000_000n * 300n) / 10_000n };

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
      ['bytes32', 'address', 'address', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint64', 'uint32', 'uint64', 'bytes32', 'uint256', 'uint256'],
      [typehash, terms.member, terms.merchant, terms.productId, terms.purchase, terms.payout, terms.ratePerCycle, terms.cycleLength, terms.installments, terms.installmentLength, terms.disclosureHash, nonce, terms.deadline],
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
    const { terms } = chargePlanTerms(charge, 4, CYCLE, 2_000_000_000, QUOTE);
    const td = planTermsTypedData({ chainId: 84532, termIssuer: ISSUER, terms, nonce: 3n });
    const walletHash = ethers.TypedDataEncoder.hash(td.domain, { PlanTerms: [...PLAN_TERMS_TYPES.PlanTerms] }, td.message);
    expect(walletHash).toBe(contractDigest(terms, 3n, 84532));
  });

  test('a member’s signature over it recovers to the member', async () => {
    const { terms } = chargePlanTerms(charge, 4, CYCLE, 2_000_000_000, QUOTE);
    const td = planTermsTypedData({ chainId: 84532, termIssuer: ISSUER, terms, nonce: 0n });
    const types = { PlanTerms: [...PLAN_TERMS_TYPES.PlanTerms] };
    const signature = await member.signTypedData(td.domain, types, td.message);
    expect(ethers.verifyTypedData(td.domain, types, td.message, signature)).toBe(member.address);
  });

  test('the disclosure hash is keccak-256 of the disclosure lines', () => {
    const { terms, disclosure } = chargePlanTerms(charge, 4, CYCLE, 2_000_000_000, QUOTE);
    expect(terms.disclosureHash).toBe(ethers.id(planDisclosureText(disclosure)));
    expect(disclosure[2]).toBe('Credit: Partner credit');
    expect(disclosure[3]).toBe('Purchase: $940.00');
  });

  test('the product is PARTNER, and the rate and payout are the chain’s quote, not a table', () => {
    const { terms } = chargePlanTerms(charge, 4, CYCLE, 2_000_000_000, QUOTE);
    expect(terms.productId).toBe(PLAN_PRODUCTS.PARTNER);
    expect(terms.ratePerCycle).toBe('200');
    expect(terms.payout).toBe('911800000');
    expect(service).not.toContain('DEFAULT_RATE_BPS');
    const prepare = service.slice(service.indexOf('export async function prepareChargeApproval'));
    expect(prepare.indexOf('quoteCharge(')).toBeLessThan(prepare.indexOf('chargePlanTerms('));
  });

  test('a reopened plan is priced on what was unwound', () => {
    const { terms } = chargePlanTerms(charge, 2, CYCLE, 2_000_000_000, { rateBps: 0n, payout: 455_900_000n }, 47_000);
    expect(terms.purchase).toBe('470000000');
    expect(terms.payout).toBe('455900000');
    expect(terms.ratePerCycle).toBe('0');
  });

  test('PlanOpened is the Phase 2 event, so a mined plan’s id is found', () => {
    const iface = new ethers.Interface(TERM_ISSUER_ABI);
    const event = iface.getEvent('PlanOpened')!;
    expect(event.format('sighash')).toBe('PlanOpened(uint256,address,address,uint256,uint32,uint256,bytes32,uint256,bytes32)');
    const contract = new URL('../../../../contracts/peripherals/TermIssuerBase.sol', import.meta.url);
    let solidity = '';
    try { solidity = readFileSync(contract, 'utf8'); } catch { return; }
    const decl = solidity.slice(solidity.indexOf('event PlanOpened('), solidity.indexOf(');', solidity.indexOf('event PlanOpened(')));
    expect(decl.replace(/\s+/g, ' ')).toContain('uint256 indexed planId, address indexed member, address indexed merchant, uint256 principal, uint32 split, uint256 rateBps, bytes32 scheduleHash, uint256 totalCarry, bytes32 disclosureHash');
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

  test('Phase 2: a member with no attested state is told their state is not confirmed', () => {
    const none = data('TermIssuerProductNotEnabled', [member.address, ethers.ZeroHash, PLAN_PRODUCTS.PARTNER]);
    expect(explainChainError({ data: none })).toContain('state of residence isn’t confirmed');
    expect(explainChainError({ data: data('TermIssuerTermsMismatch', [200n, 150n, 1n, 1n]) })).toContain('Approve again');
  });

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
