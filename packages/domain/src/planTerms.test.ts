import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import {
  buildPlanTerms,
  disclosureMoney,
  PLAN_TERMS_TYPE_STRING,
  planDisclosure,
  planDisclosureForTerms,
  planDisclosureText,
  planTermsMismatch,
  planTermsTypedData,
  samePlanTerms,
} from './planTerms';

// A stand-in hash: the module never hashes itself, so any injective function proves the wiring.
const fakeKeccak = (text: string) => `0x${Buffer.from(text).toString('hex').slice(0, 64).padEnd(64, '0')}`;

const MEMBER = '0x00000000000000000000000000000000000000a1';
const MERCHANT = '0x00000000000000000000000000000000000000b2';
const ISSUER = '0x00000000000000000000000000000000000000c3';

function sample(overrides: Partial<Parameters<typeof buildPlanTerms>[0]> = {}) {
  return buildPlanTerms({
    member: MEMBER,
    merchant: MERCHANT,
    merchantName: 'Corner Garage',
    purchaseCents: 94_000,
    payoutCents: 91_180,
    ratePerCycleBps: 200,
    cycleLengthSeconds: 30 * 86_400,
    installments: 4,
    installmentLengthSeconds: 30 * 86_400,
    deadline: 2_000_000_000,
    keccakUtf8: fakeKeccak,
    ...overrides,
  });
}

describe('the typed data is the contract’s', () => {
  test('field for field, in TermIssuer.PLAN_TERMS_TYPEHASH order', () => {
    expect(PLAN_TERMS_TYPE_STRING).toBe(
      'PlanTerms(address member,address merchant,uint256 purchase,uint256 payout,uint256 ratePerCycle,uint64 cycleLength,uint32 installments,uint64 installmentLength,bytes32 disclosureHash,uint256 nonce,uint256 deadline)',
    );
  });

  test('and still matches the Solidity, when the contracts are checked out beside it', () => {
    const source = new URL('../../../contracts/peripherals/TermIssuer.sol', import.meta.url);
    if (!existsSync(source)) return;
    expect(readFileSync(source, 'utf8')).toContain(`"${PLAN_TERMS_TYPE_STRING}"`);
    expect(readFileSync(source, 'utf8')).toContain('keccak256(bytes("Clear TermIssuer"))');
  });

  test('the domain names the issuer and the chain, and the nonce rides in the message', () => {
    const { terms } = sample();
    const td = planTermsTypedData({ chainId: 84532, termIssuer: ISSUER, terms, nonce: 7n });
    expect(td.domain).toEqual({ name: 'Clear TermIssuer', version: '1', chainId: 84532, verifyingContract: ISSUER });
    expect(td.primaryType).toBe('PlanTerms');
    expect(td.message.nonce).toBe('7');
  });

  test('cents become six-decimal ledger units', () => {
    const { terms } = sample();
    expect(terms.purchase).toBe('940000000');
    expect(terms.payout).toBe('911800000');
    expect(terms.ratePerCycle).toBe('200');
  });
});

describe('the disclosure', () => {
  test('is fixed text, not the locale, so the server and the phone write the same bytes', () => {
    expect(disclosureMoney(123_456_789)).toBe('$1,234,567.89');
    expect(disclosureMoney(5)).toBe('$0.05');
    expect(planDisclosure({
      merchantName: 'Corner Garage',
      purchaseCents: 94_000,
      ratePerCycleBps: 200,
      cycleLengthSeconds: 30 * 86_400,
      installments: 4,
      installmentLengthSeconds: 30 * 86_400,
    })).toEqual([
      'Clear plan terms, v1',
      'Shop: Corner Garage',
      'Purchase: $940.00',
      'Repaid in 4 installments, one every 30 days',
      'Carry: 2% a cycle on what is still owed; a cycle is 30 days',
      'About $246.75 an installment, $47.00 in carry, $987.00 in all',
    ]);
  });

  test('the hash in the terms is the hash of those lines', () => {
    const { terms, disclosure } = sample();
    expect(terms.disclosureHash).toBe(fakeKeccak(planDisclosureText(disclosure)));
  });

  test('can be rebuilt from the signed fields alone', () => {
    const { terms, disclosure } = sample();
    expect(planDisclosureForTerms(terms, 'Corner Garage')).toEqual(disclosure);
  });
});

describe('what the phone checks before it signs', () => {
  const now = 1_900_000_000;
  const check = (mutate: (td: ReturnType<typeof planTermsTypedData>) => void, shownOverride: Partial<{ member: string; purchaseCents: number; installments: number; disclosure: string[] }> = {}) => {
    const { terms, disclosure } = sample();
    const td = planTermsTypedData({ chainId: 84532, termIssuer: ISSUER, terms, nonce: 0n });
    mutate(td);
    return planTermsMismatch({
      typedData: td,
      shown: { member: MEMBER, purchaseCents: 94_000, installments: 4, disclosure, ...shownOverride },
      expected: { chainId: 84532, termIssuer: ISSUER },
      keccakUtf8: fakeKeccak,
      nowSeconds: now,
    });
  };

  test('the terms on the screen pass', () => {
    expect(check(() => {})).toBeNull();
  });

  test('anything else is refused', () => {
    expect(check((td) => { td.message.member = MERCHANT; })).toBe('not your plan');
    expect(check((td) => { td.message.purchase = '1'; })).toBe('a different amount');
    expect(check((td) => { td.message.installments = 12; })).toBe('a different split');
    expect(check((td) => { td.message.payout = '940000001'; })).toBe('the shop is paid more than the purchase');
    expect(check((td) => { td.domain.verifyingContract = MERCHANT; })).toBe('not the plan issuer');
    expect(check((td) => { td.domain.chainId = 8453; })).toBe('wrong network');
    expect(check((td) => { td.message.deadline = String(now); })).toBe('terms that have expired');
    expect(check(() => {}, { disclosure: ['something else'] })).toBe('terms that differ from the ones shown');
  });

  test('two builds of the same terms are the same plan', () => {
    expect(samePlanTerms(sample().terms, sample().terms)).toBe(true);
    expect(samePlanTerms(sample().terms, sample({ installments: 2 }).terms)).toBe(false);
  });
});
