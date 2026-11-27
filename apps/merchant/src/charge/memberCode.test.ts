import { describe, expect, test } from 'bun:test';
import { memberWalletFrom } from './memberCode';

const W = '0x9F2c4e6a8b0d1f3e5a7c9b1d3f5e7a9c1b3d5f70';

describe('a member’s own code', () => {
  test('their send link, a bare address, or ethereum:', () => {
    expect(memberWalletFrom(`https://app.useclear.org/send?to=${W}`)).toBe(W.toLowerCase());
    expect(memberWalletFrom(`https://preview.useclear.org/send/?to=${W}&x=1`)).toBe(W.toLowerCase());
    expect(memberWalletFrom(W)).toBe(W.toLowerCase());
    expect(memberWalletFrom(`ethereum:${W}@8453`)).toBe(W.toLowerCase());
  });

  test('anything else is not a member', () => {
    expect(memberWalletFrom('https://app.useclear.org/c/55DCQ9PR')).toBeNull();
    expect(memberWalletFrom('WIFI:S:Shop;T:WPA;P:x;;')).toBeNull();
    expect(memberWalletFrom('https://example.com/send?to=0x123')).toBeNull();
    expect(memberWalletFrom('')).toBeNull();
  });
});
