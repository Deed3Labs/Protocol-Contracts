import { describe, expect, test } from 'bun:test';
import { keyProblem, makeConfig, pageProblem, type Config } from './config';
import { fakeKey } from './testing';

describe('keys', () => {
  test('a publishable key, test or live, is taken', () => {
    expect(keyProblem(fakeKey('test'))).toBeNull();
    expect(keyProblem(fakeKey('live'))).toBeNull();
    expect((makeConfig(fakeKey('live')) as Config).mode).toBe('live');
    expect((makeConfig(fakeKey('test')) as Config).mode).toBe('test');
  });

  test('a secret key is refused, and told it must never be in a page', () => {
    for (const k of [fakeKey('live', 'sk'), fakeKey('test', 'sk'), ['sk', 'live', 'x'.repeat(24)].join('_')]) {
      expect(keyProblem(k)).toContain('must never be in a web page');
    }
  });

  test("Stripe's pk_, an empty key and other strings are refused", () => {
    for (const k of [['pk', 'live', 'a'.repeat(24)].join('_'), '', '   ', undefined, null, 42, 'clear_pk_prod_abc', 'clear_pk_live_', 'clear_pk_live_ab-c', 'clear_pk_live_mc8Q2v…']) {
      expect(keyProblem(k)).toBeTruthy();
      expect(typeof makeConfig(k)).toBe('string');
    }
  });

  test('defaults: the production API and pay.useclear.org', () => {
    const c = makeConfig(fakeKey('live')) as Config;
    expect(c.apiBase).toBe('https://api.useclear.org');
    expect(c.payOrigin).toBe('https://pay.useclear.org');
  });

  test('payOrigin moves only with a test key', () => {
    expect((makeConfig(fakeKey('test'), { payOrigin: 'http://localhost:5195/' }) as Config).payOrigin).toBe('http://localhost:5195');
    expect(makeConfig(fakeKey('live'), { payOrigin: 'http://localhost:5195' })).toContain('test key');
    expect(makeConfig(fakeKey('live'), { payOrigin: 'https://evil.example' })).toContain('test key');
    expect((makeConfig(fakeKey('live'), { payOrigin: 'https://pay.useclear.org' }) as Config).payOrigin).toBe('https://pay.useclear.org');
    expect(makeConfig(fakeKey('test'), { payOrigin: 'http://example.com' })).toContain('https');
    expect(makeConfig(fakeKey('test'), { payOrigin: 'javascript:alert(1)' })).toContain('https');
  });

  test('apiBase takes an https URL, or http on localhost, without a trailing slash', () => {
    expect((makeConfig(fakeKey('test'), { apiBase: 'http://localhost:3001/' }) as Config).apiBase).toBe('http://localhost:3001');
    expect((makeConfig(fakeKey('live'), { apiBase: 'https://api.example.com' }) as Config).apiBase).toBe('https://api.example.com');
    expect(makeConfig(fakeKey('test'), { apiBase: 'http://api.example.com' })).toContain('https');
  });
});

describe('the page', () => {
  test('https is fine for either key', () => {
    expect(pageProblem({ protocol: 'https:', hostname: 'micasatacos.com' }, 'live')).toBeNull();
    expect(pageProblem({ protocol: 'https:', hostname: 'micasatacos.com' }, 'test')).toBeNull();
  });

  test('http is refused, except loopback with a test key', () => {
    expect(pageProblem({ protocol: 'http:', hostname: 'micasatacos.com' }, 'test')).toContain('https');
    expect(pageProblem({ protocol: 'http:', hostname: 'micasatacos.com' }, 'live')).toContain('https');
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      expect(pageProblem({ protocol: 'http:', hostname }, 'test')).toBeNull();
      expect(pageProblem({ protocol: 'http:', hostname }, 'live')).toContain('test key');
    }
    expect(pageProblem({ protocol: 'file:', hostname: '' }, 'test')).toContain('https');
    expect(pageProblem({ protocol: 'http:', hostname: 'localhost.evil.com' }, 'test')).toContain('https');
  });
});
