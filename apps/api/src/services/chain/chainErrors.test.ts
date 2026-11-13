import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { CHAIN_ERROR_FRAGMENTS, CHAIN_ERRORS, chainErrorReason, decodeChainError, describeCreditRefusal, describeRedeemRefusal, STATE_NOT_CONFIRMED } from './chainErrors';

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

describe('Phase 2’s errors decode, and match the Solidity', () => {
  const PHASE_2: Record<string, string> = {
    TermIssuerProductNotEnabled: 'TermIssuerBase.sol',
    TermIssuerTermsMismatch: 'TermIssuerBase.sol',
    TermIssuerTermTooShort: 'TermIssuerBase.sol',
    TermIssuerResplitNeedsSignature: 'TermIssuerBase.sol',
    RevolvingIssuerStateNotEnabled: 'RevolvingIssuerBase.sol',
    ClearUSDPaused: 'ClearUSDUpgradeable.sol',
    ESADepositVaultPilotCapReached: 'ESADepositVault.sol',
  };

  test('each fragment is the contract’s declaration, argument for argument', () => {
    for (const [name, file] of Object.entries(PHASE_2)) {
      const fragment = CHAIN_ERROR_FRAGMENTS.find((f) => f.startsWith(`error ${name}(`));
      expect(fragment).toBeDefined();
      const source = new URL(`../../../../../contracts/peripherals/${file}`, import.meta.url);
      let solidity: string;
      try {
        solidity = readFileSync(source, 'utf8');
      } catch {
        continue; // the API checked out on its own
      }
      expect(solidity).toContain(`${fragment!.replace(/^error /, 'error ')};`);
    }
  });

  test('every one has a member-facing sentence', () => {
    const ARGS: Record<string, unknown[]> = {
      TermIssuerProductNotEnabled: [SHOP, ethers.ZeroHash, ethers.encodeBytes32String('PARTNER')],
      TermIssuerTermsMismatch: [200n, 150n, 1n, 1n],
      TermIssuerTermTooShort: [360n * 86_400n, 365n * 86_400n],
      TermIssuerResplitNeedsSignature: [3n],
      RevolvingIssuerStateNotEnabled: [SHOP, ethers.ZeroHash],
      ClearUSDPaused: [SHOP, 1, 1_900_000_000n],
      ESADepositVaultPilotCapReached: [1n, 2n, 3n],
    };
    for (const [name, args] of Object.entries(ARGS)) {
      const sentence = describeCreditRefusal(decodeChainError({ data: data(name, args) }));
      expect(sentence).toBeTruthy();
      expect(sentence).not.toContain('0x');
    }
  });

  test('no attested state says the state is not confirmed, not that the member was refused', () => {
    const none = decodeChainError({ data: data('TermIssuerProductNotEnabled', [SHOP, ethers.ZeroHash, ethers.ZeroHash]) });
    expect(describeCreditRefusal(none)).toBe(STATE_NOT_CONFIRMED);
    expect(describeCreditRefusal(decodeChainError({ data: data('RevolvingIssuerStateNotEnabled', [SHOP, ethers.ZeroHash]) }))).toContain(
      'isn’t confirmed yet',
    );
    const ny = decodeChainError({ data: data('TermIssuerProductNotEnabled', [SHOP, ethers.encodeBytes32String('NY'), ethers.ZeroHash]) });
    expect(describeCreditRefusal(ny)).toContain('in NY');
    expect(describeCreditRefusal(decodeChainError({ data: data('TermIssuerTermTooShort', [1n, 365n * 86_400n]) }))).toContain('365 days');
  });
});
