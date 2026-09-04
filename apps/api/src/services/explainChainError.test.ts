import { describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { explainChainError } from './chargeService';

const iface = new ethers.Interface([
  'error TermIssuerExceedsTermLimit(address member, uint256 requested, uint256 limit)',
  'error TermIssuerSplitNotOffered(uint32 installments)',
]);
const MEMBER = '0x7ec1D6b69398af413edC94692FB167A3864A86cF';

describe('a revert becomes a sentence', () => {
  test('the exact error from the reported failure', () => {
    const data = iface.encodeErrorResult('TermIssuerExceedsTermLimit', [MEMBER, 10_000_000n, 0n]);
    expect(explainChainError({ data })).toBe(
      'Your account is not set up to split purchases yet.',
    );
  });

  test('a real ceiling names what is left of it', () => {
    const data = iface.encodeErrorResult('TermIssuerExceedsTermLimit', [
      MEMBER, 60_000_000n, 50_000_000n,
    ]);
    expect(explainChainError({ data })).toContain('$50');
  });

  test('an unknown revert says nothing it cannot back up', () => {
    const msg = explainChainError({ data: '0xdeadbeef' });
    expect(msg).toBe('We could not approve this charge. Nothing was charged — try again in a moment.');
  });

  test('no calldata, contract name, or selector ever reaches a member', () => {
    const ethersish = new Error(
      'execution reverted (unknown custom error) (action="estimateGas", data="0x867c3628...")',
    );
    const msg = explainChainError(ethersish);
    expect(msg).not.toContain('0x');
    expect(msg).not.toContain('estimateGas');
    expect(msg).not.toContain('TermIssuer');
  });
});
