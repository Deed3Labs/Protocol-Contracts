import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  buildPlanTerms,
  bytes32String,
  disclosureMoney,
  PLAN_PRODUCTS,
  PLAN_TERMS_TYPE_STRING,
  planDisclosure,
  planDisclosureForTerms,
  planDisclosureText,
  planProductOf,
  planSchedule,
  planTermsMismatch,
  planTermsTypedData,
  RESPLIT_TYPE_STRING,
  resplitMismatch,
  resplitTypedData,
  samePlanTerms,
} from './planTerms';

// A stand-in hash: the module never hashes itself, so any collision-free function proves the wiring.
const fakeKeccak = (text: string) => `0x${createHash('sha256').update(text).digest('hex')}`;

const MEMBER = '0x00000000000000000000000000000000000000a1';
const MERCHANT = '0x00000000000000000000000000000000000000b2';
const ISSUER = '0x00000000000000000000000000000000000000c3';
const DAY = 86_400;

function sample(overrides: Partial<Parameters<typeof buildPlanTerms>[0]> = {}) {
  return buildPlanTerms({
    member: MEMBER,
    merchant: MERCHANT,
    merchantName: 'Corner Garage',
    productId: PLAN_PRODUCTS.PARTNER,
    purchaseCents: 94_000,
    payout: 911_800_000n,
    ratePerCycleBps: 200,
    cycleLengthSeconds: 30 * DAY,
    installments: 4,
    installmentLengthSeconds: 30 * DAY,
    deadline: 2_000_000_000,
    keccakUtf8: fakeKeccak,
    ...overrides,
  });
}

const contracts = (file: string) => new URL(`../../../contracts/peripherals/${file}`, import.meta.url);

describe('the typed data is the contract’s', () => {
  test('field for field, in TermIssuerBase.PLAN_TERMS_TYPEHASH order, productId after merchant', () => {
    expect(PLAN_TERMS_TYPE_STRING).toBe(
      'PlanTerms(address member,address merchant,bytes32 productId,uint256 purchase,uint256 payout,uint256 ratePerCycle,uint64 cycleLength,uint32 installments,uint64 installmentLength,bytes32 disclosureHash,uint256 nonce,uint256 deadline)',
    );
    expect(RESPLIT_TYPE_STRING).toBe('Resplit(uint256 planId,uint32 installments,uint256 rateBps,uint256 nonce,uint256 deadline)');
  });

  test('and still matches the Solidity, when the contracts are checked out beside it', () => {
    if (!existsSync(contracts('TermIssuerBase.sol'))) return;
    const base = readFileSync(contracts('TermIssuerBase.sol'), 'utf8');
    expect(base).toContain(`"${PLAN_TERMS_TYPE_STRING}"`);
    expect(base).toContain('keccak256(bytes("Clear TermIssuer"))');
    expect(readFileSync(contracts('TermIssuerExtension.sol'), 'utf8')).toContain(`"${RESPLIT_TYPE_STRING}"`);
  });

  test('the product ids are encodeBytes32String of the rate-schedule names', () => {
    expect(PLAN_PRODUCTS.PARTNER).toBe('0x504152544e455200000000000000000000000000000000000000000000000000');
    expect(PLAN_PRODUCTS.CASH).toBe(bytes32String('CASH'));
    expect(planProductOf(PLAN_PRODUCTS.CASH.toUpperCase().replace('0X', '0x'))).toBe('CASH');
    expect(planProductOf(bytes32String('BOOST'))).toBeNull();
    const config = new URL('../../../deploy/config/rate-schedule.json', import.meta.url);
    if (!existsSync(config)) return;
    const products = (JSON.parse(readFileSync(config, 'utf8')) as { products: { product: string; role: string }[] }).products;
    expect(products.filter((p) => p.role === 'term').map((p) => p.product).sort()).toEqual(['CASH', 'PARTNER']);
  });

  test('the domain names the issuer and the chain, and the nonce rides in the message', () => {
    const { terms } = sample();
    const td = planTermsTypedData({ chainId: 84532, termIssuer: ISSUER, terms, nonce: 7n });
    expect(td.domain).toEqual({ name: 'Clear TermIssuer', version: '1', chainId: 84532, verifyingContract: ISSUER });
    expect(td.primaryType).toBe('PlanTerms');
    expect(td.message.nonce).toBe('7');
    expect(td.message.productId).toBe(PLAN_PRODUCTS.PARTNER);
  });

  test('cents become six-decimal ledger units; payout is taken in units as the chain computes it', () => {
    const { terms } = sample({ payout: 911_798_600n });
    expect(terms.purchase).toBe('940000000');
    expect(terms.payout).toBe('911798600');
    expect(terms.ratePerCycle).toBe('200');
  });
});

describe('the schedule is TermIssuerBase._fixSchedule', () => {
  test('$940 in 4 at 2% a month: carry $18.54, $13.91, $9.27, $4.64 (PHASE-2-REPORT section 2)', () => {
    const s = planSchedule({ principal: 940_000_000n, ratePerCycleBps: 200, installments: 4, installmentLengthSeconds: 30 * DAY });
    expect(s.installments.map((r) => Math.round(Number(r.carry) / 10_000))).toEqual([1854, 1391, 927, 464]);
    expect(s.installments.map((r) => r.principal)).toEqual([235_000_000n, 235_000_000n, 235_000_000n, 235_000_000n]);
    // `scheduleTotal` exactly: the parts add up, and match (base * periodRate * (n + 1)) / (2 * RAY).
    expect(s.installments.reduce((a, r) => a + r.amount, 0n)).toBe(s.total);
    expect(s.total - 940_000_000n).toBe(s.totalCarry);
  });

  test('a free plan is principal only', () => {
    const s = planSchedule({ principal: 100_000_000n, ratePerCycleBps: 0, installments: 2, installmentLengthSeconds: 30 * DAY });
    expect(s.totalCarry).toBe(0n);
    expect(s.installments.map((r) => r.amount)).toEqual([50_000_000n, 50_000_000n]);
  });
});

describe('the disclosure', () => {
  test('is fixed text, not the locale, and states the product, rate and declining schedule', () => {
    expect(disclosureMoney(123_456_789)).toBe('$1,234,567.89');
    expect(disclosureMoney(5)).toBe('$0.05');
    expect(planDisclosure({
      merchantName: 'Corner Garage',
      productId: PLAN_PRODUCTS.PARTNER,
      purchase: 940_000_000n,
      ratePerCycleBps: 200,
      installments: 4,
      installmentLengthSeconds: 30 * DAY,
    })).toEqual([
      'Clear plan terms, v2',
      'Shop: Corner Garage',
      'Credit: Partner credit',
      'Purchase: $940.00',
      'Repaid in 4 installments, one every 30 days',
      'Carry: 2% a month (24% a year), simple interest by the second on principal still owed, never on carry',
      'Installment 1: $253.54 ($235.00 principal + $18.54 carry)',
      'Installment 2: $248.91 ($235.00 principal + $13.91 carry)',
      'Installment 3: $244.27 ($235.00 principal + $9.27 carry)',
      'Installment 4: $239.64 ($235.00 principal + $4.64 carry)',
      'Total carry $46.36, $986.36 in all, if paid on schedule',
    ]);
  });

  test('a free plan says so', () => {
    const lines = planDisclosure({ merchantName: 'X', productId: PLAN_PRODUCTS.PARTNER, purchase: 10_000_000n, ratePerCycleBps: 0, installments: 1, installmentLengthSeconds: 30 * DAY });
    expect(lines).toContain('Carry: none. This plan is free, even if a payment is late');
    expect(lines).toContain('Installment 1: $10.00');
  });

  test('the hash in the terms is the hash of those lines', () => {
    const { terms, disclosure } = sample();
    expect(terms.disclosureHash).toBe(fakeKeccak(planDisclosureText(disclosure)));
  });

  test('can be rebuilt from the signed fields alone, product included', () => {
    const { terms, disclosure } = sample();
    expect(planDisclosureForTerms(terms, 'Corner Garage')).toEqual(disclosure);
    expect(planDisclosureForTerms({ ...terms, productId: PLAN_PRODUCTS.CASH }, 'Corner Garage')).not.toEqual(disclosure);
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
    expect(check((td) => { td.message.productId = bytes32String('BOOST'); })).toBe('a different kind of credit');
    expect(check((td) => { td.domain.verifyingContract = MERCHANT; })).toBe('not the plan issuer');
    expect(check((td) => { td.domain.chainId = 8453; })).toBe('wrong network');
    expect(check((td) => { td.message.deadline = String(now); })).toBe('terms that have expired');
    expect(check(() => {}, { disclosure: ['something else'] })).toBe('terms that differ from the ones shown');
  });

  test('two builds of the same terms are the same plan', () => {
    expect(samePlanTerms(sample().terms, sample().terms)).toBe(true);
    expect(samePlanTerms(sample().terms, sample({ installments: 2 }).terms)).toBe(false);
    expect(samePlanTerms(sample().terms, sample({ productId: PLAN_PRODUCTS.CASH }).terms)).toBe(false);
  });
});

describe('a re-split the member signs', () => {
  const td = resplitTypedData({ chainId: 84532, termIssuer: ISSUER, planId: 3, installments: 12, rateBps: 200, nonce: 4n, deadline: 2_000_000_000 });
  const ok = { chainId: 84532, termIssuer: ISSUER };

  test('is in the plan domain, at the plan nonce', () => {
    expect(td.domain.name).toBe('Clear TermIssuer');
    expect(td.message).toEqual({ planId: '3', installments: 12, rateBps: '200', nonce: '4', deadline: '2000000000' });
  });

  test('is checked against the screen', () => {
    const shown = { planId: 3, installments: 12, rateBps: 200 };
    expect(resplitMismatch({ typedData: td, shown, expected: ok, nowSeconds: 1 })).toBeNull();
    expect(resplitMismatch({ typedData: td, shown: { ...shown, rateBps: 150 }, expected: ok, nowSeconds: 1 })).toBe('a different rate');
    expect(resplitMismatch({ typedData: td, shown: { ...shown, installments: 6 }, expected: ok, nowSeconds: 1 })).toBe('a different split');
    expect(resplitMismatch({ typedData: td, shown, expected: { ...ok, chainId: 1 }, nowSeconds: 1 })).toBe('wrong network');
    expect(resplitMismatch({ typedData: td, shown, expected: ok, nowSeconds: 2_000_000_000 })).toBe('terms that have expired');
  });
});
