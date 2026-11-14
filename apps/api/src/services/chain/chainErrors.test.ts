import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { CHAIN_ERRORS, chainErrorReason, decodeChainError, describeRedeemRefusal } from './chainErrors';

const redemption = readFileSync(new URL('../merchant/payoutRedemption.ts', import.meta.url), 'utf8');
const SHOP = '0x00000000000000000000000000000000000000b2';
const data = (name: string, args: unknown[]) => CHAIN_ERRORS.encodeErrorResult(name, args);

describe('Phase 1’s custom errors decode wherever the library left them', () => {
  test('ethers: on the error, or nested under info.error', () => {
    expect(decodeChainError({ data: data('PayoutPoolNotEligible', [SHOP]) })?.name).toBe('PayoutPoolNotEligible');
    expect(decodeChainError({ info: { error: { data: data('CreditIssuerMissingRole', [ethers.ZeroHash, SHOP]) } } })?.name).toBe(
      'CreditIssuerMissingRole',
    );
  });

  test('viem: the raw revert on the cause', () => {
    const viemish = { shortMessage: 'reverted', cause: { data: { errorName: 'x' }, raw: data('StableCreditRecipientNotEligible', [SHOP, SHOP]) } };
    expect(decodeChainError(viemish)?.name).toBe('StableCreditRecipientNotEligible');
  });

  test('a stored reason names the error and its arguments, never raw calldata', () => {
    const reason = chainErrorReason({ data: data('RevolvingIssuerDrawUnplaced', [SHOP, 5n]) });
    expect(reason).toBe(`RevolvingIssuerDrawUnplaced(${SHOP}, 5)`);
  });

  test('anything unknown decodes to nothing rather than a guess', () => {
    expect(decodeChainError({ data: '0xdeadbeef' })).toBeNull();
    expect(decodeChainError(new Error('timeout'))).toBeNull();
  });
});

describe('a shop that cannot redeem is told why (audit C-1, H-1)', () => {
  test('not eligible, inactive, nothing owed', () => {
    expect(describeRedeemRefusal(decodeChainError({ data: data('PayoutPoolNotEligible', [SHOP]) }))).toContain('not a registered shop');
    expect(describeRedeemRefusal(decodeChainError({ data: data('PayoutPoolMerchantInactive', [SHOP]) }))).toContain('not active');
    expect(describeRedeemRefusal(decodeChainError({ data: data('PayoutPoolNothingToRedeem', [SHOP]) }))).toContain('nothing to withdraw');
  });

  test('the redeem is simulated before the approve, so an ineligible shop sends nothing', () => {
    expect(redemption.indexOf('publicClient.simulateContract(')).toBeLessThan(redemption.indexOf('if (allowance < amount) {'));
    expect(redemption).toContain("name: 'PayoutPoolNotEligible'");
  });
});
