import { describe, expect, test } from 'bun:test';
import { payError } from './usePayNow';

describe('Pay now: the wallet’s refusal, as a sentence', () => {
  test('Privy’s MFA time-out, as viem wraps it', () => {
    const e = new Error('An unknown RPC error occurred.\n\nDetails: Timed out waiting for MFA code\nVersion: viem@2.56.3');
    expect(payError(e)).toBe('Confirming it’s you took too long, so nothing was paid. Try again.');
  });
  test('a bare unknown RPC error, or none, says nothing was paid', () => {
    expect(payError(new Error('An unknown RPC error occurred.'))).toBe('That did not go through. Nothing was paid.');
    expect(payError('nope')).toBe('That did not go through. Nothing was paid.');
  });
  test('our own sentences pass through', () => {
    expect(payError(new Error('This needs Face ID. Nothing was changed.'))).toBe('This needs Face ID. Nothing was changed.');
  });
});
