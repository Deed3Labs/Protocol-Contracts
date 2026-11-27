import { describe, expect, test } from 'bun:test';
import { connectPath, readConnect, siteName } from './connectFlow';

describe('the useclear.org sign-in request', () => {
  test('reads return, state and setup from the address bar', () => {
    const r = readConnect('?return=https%3A%2F%2Fwww.useclear.org%2Fapi%2Fshop%2Faccount%2Freturn&state=abc_DEF-1234567890xyz&setup=1');
    expect(r).toEqual({ return: 'https://www.useclear.org/api/shop/account/return', state: 'abc_DEF-1234567890xyz', setup: true });
    expect(readConnect('?return=https://www.useclear.org/api/shop/account/return&state=s')?.setup).toBe(false);
  });
  test('is not a request without both, or with a return that is not a web address', () => {
    expect(readConnect('')).toBeNull();
    expect(readConnect('?state=abc')).toBeNull();
    expect(readConnect('?return=https://www.useclear.org/x')).toBeNull();
    expect(readConnect('?return=javascript:alert(1)&state=abc')).toBeNull();
  });
  test('comes back to /connect after onboarding with the same request', () => {
    const r = { return: 'https://www.useclear.org/api/shop/account/return', state: 'abc', setup: true };
    expect(readConnect(connectPath(r).slice('/connect'.length))).toEqual({ ...r, setup: false });
  });
  test('names the site it is going back to', () => {
    expect(siteName('https://www.useclear.org/api/shop/account/return')).toBe('useclear.org');
    expect(siteName('http://localhost:8137/api/shop/account/return')).toBe('localhost:8137');
    expect(siteName('nonsense')).toBe('useclear.org');
  });
});
