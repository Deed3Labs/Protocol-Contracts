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
  termPeriodRate,
  unitsToCents,
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
  test('$940 in 4 at 2% per 30-day cycle is levelled: $246.87 x 4, $47.47 of carry (section 12.9)', () => {
    const s = planSchedule({ principal: 940_000_000n, ratePerCycleBps: 200, installments: 4, installmentLengthSeconds: 30 * DAY });
    // Term.spec acceptance 5: payment closeTo 246_866_000 within 1_000; carry closeTo 47_466_000 within 4_000.
    expect(s.payment).toBe(246_866_328n);
    expect(s.installments.map((r) => r.amount)).toEqual(Array(4).fill(246_866_328n));
    expect(s.totalCarry).toBe(47_465_312n);
    // The first payment clears $18.80 of carry and $228.07 of principal (Term.spec line "cleared").
    expect(s.installments.map((r) => unitsToCents(r.carry))).toEqual([1880, 1424, 959, 484]);
    expect(unitsToCents(s.installments[0].principal)).toBe(22807);
    // `scheduleTotal` is payment x n, and the principal paid down is the principal exactly.
    expect(s.total).toBe(s.payment * 4n);
    expect(s.installments.reduce((a, r) => a + r.principal, 0n)).toBe(940_000_000n);
    expect(s.installments.reduce((a, r) => a + r.carry, 0n)).toBe(s.totalCarry);
  });

  test('the period rate is the monthly rate per 30-day cycle, not x 12 / 365', () => {
    expect(termPeriodRate(200, 30 * DAY)).toBe(2n * 10n ** 25n);
  });

  test('a free plan splits the principal exactly; the last installment takes the remainder', () => {
    const s = planSchedule({ principal: 100_000_001n, ratePerCycleBps: 0, installments: 3, installmentLengthSeconds: 30 * DAY });
    expect(s.totalCarry).toBe(0n);
    expect(s.payment).toBe(33_333_334n);
    expect(s.installments.map((r) => r.amount)).toEqual([33_333_334n, 33_333_334n, 33_333_333n]);
    expect(s.total).toBe(100_000_001n);
  });
});

describe('the disclosure', () => {
  test('is fixed text, not the locale, and states the product, rate and level schedule', () => {
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
      'Clear plan terms, v3',
      'Shop: Corner Garage',
      'Credit: Partner credit',
      'Purchase: $940.00',
      'Repaid in 4 installments, one every 30 days',
      'Carry: 2% per 30-day cycle on principal still owed, never on carry. Equal payments of $246.87',
      'Installment 1: $246.87 ($228.07 principal + $18.80 carry)',
      'Installment 2: $246.87 ($232.63 principal + $14.24 carry)',
      'Installment 3: $246.87 ($237.28 principal + $9.59 carry)',
      'Installment 4: $246.87 ($242.03 principal + $4.84 carry)',
      'Total carry $47.47, $987.47 in all, if paid on schedule',
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
