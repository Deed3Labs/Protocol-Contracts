import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keccak256, toBytes, hashTypedData } from 'viem';
import { ethers } from 'ethers';
import { buildPlanTerms, planDisclosureForTerms, planDisclosureText, planTermsMessage, planTermsTypedData, PLAN_TERMS_TYPES } from '@clear/domain';

const SIGNING = readFileSync(join(import.meta.dir, 'planSigning.ts'), 'utf8');
const ROUTE = readFileSync(join(import.meta.dir, '../pages/app/ChargeApprovalRoute.tsx'), 'utf8');

const built = buildPlanTerms({
  member: '0x00000000000000000000000000000000000000A1',
  merchant: '0x00000000000000000000000000000000000000b2',
  merchantName: 'Corner Garage',
  purchaseCents: 94_000,
  payoutCents: 91_180,
  ratePerCycleBps: 200,
  cycleLengthSeconds: 30 * 86_400,
  installments: 4,
  installmentLengthSeconds: 30 * 86_400,
  deadline: 2_000_000_000,
  keccakUtf8: (text) => ethers.id(text),
});

describe('the phone and the server hash the same disclosure (audit H-4)', () => {
  test('viem’s keccak of the lines is the server’s ethers.id of them', () => {
    const text = planDisclosureText(built.disclosure);
    expect(keccak256(toBytes(text))).toBe(ethers.id(text) as `0x${string}`);
    expect(built.terms.disclosureHash).toBe(ethers.id(text));
  });

  test('the lines the phone shows are rebuilt from the signed fields', () => {
    expect(planDisclosureForTerms(built.terms, 'Corner Garage')).toEqual(built.disclosure);
  });

  test('viem hashes the shared typed data the way ethers does', () => {
    const td = planTermsTypedData({ chainId: 84532, termIssuer: '0x00000000000000000000000000000000000000c3', terms: built.terms, nonce: 5n });
    const viaViem = hashTypedData({
      domain: { ...td.domain, verifyingContract: td.domain.verifyingContract as `0x${string}` },
      types: PLAN_TERMS_TYPES,
      primaryType: 'PlanTerms',
      message: {
        ...planTermsMessage(td.message),
        member: td.message.member as `0x${string}`,
        merchant: td.message.merchant as `0x${string}`,
        disclosureHash: td.message.disclosureHash as `0x${string}`,
      },
    });
    const viaEthers = ethers.TypedDataEncoder.hash(td.domain, { PlanTerms: [...PLAN_TERMS_TYPES.PlanTerms] }, td.message);
    expect(viaViem).toBe(viaEthers as `0x${string}`);
  });
});

describe('nothing is signed that the screen did not show', () => {
  test('the terms are checked against the screen before Face ID and before the wallet signs', () => {
    const check = SIGNING.indexOf('planTermsMismatch(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(SIGNING.indexOf('await requireStepUp()'));
    expect(check).toBeLessThan(SIGNING.indexOf('await signTypedData('));
  });

  test('the disclosure on screen is rebuilt from the terms, not taken from the server', () => {
    expect(ROUTE).toContain('disclosure: disclosureFor(next.typedData, charge.merchantName)');
    expect(ROUTE).toContain('planTerms={prepared?.disclosure ?? null}');
  });

  test('approve sends the signature, and a used set of terms is never sent twice', () => {
    expect(ROUTE).toContain('await approveCharge(charge.code, splitInto, signed)');
    const approve = ROUTE.slice(ROUTE.indexOf('await approveCharge(charge.code, splitInto, signed)'));
    expect(approve.indexOf('setPrepared(null)')).toBeLessThan(approve.indexOf('setCharge(result.charge)'));
  });
});
