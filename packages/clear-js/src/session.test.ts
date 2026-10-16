import { describe, expect, test } from 'bun:test';
import { makeConfig, type Config } from './config';
import { plan } from './options';
import { apiError, createSession, sessionRequest, sessionUrl, type FetchLike } from './session';
import { fakeKey } from './testing';

const live = makeConfig(fakeKey('live')) as Config;
const test_ = makeConfig(fakeKey('test'), { payOrigin: 'http://localhost:5195', apiBase: 'http://localhost:3001' }) as Config;
const session = (url: string, livemode = true) => ({ id: 'ms_1', object: 'modal_session', livemode, url, expiresAt: '2026-10-16T20:00:00Z' });

describe('the request', () => {
  test('POST /v1/modal_sessions with the key, the version and JSON, no cookies', () => {
    const { url, init } = sessionRequest(live, plan({ price: 'price_tacotray12', quantity: 1 }).body);
    expect(url).toBe('https://api.useclear.org/v1/modal_sessions');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual({ Authorization: `Bearer ${fakeKey('live')}`, 'Clear-Version': '2026-10-16', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ price: 'price_tacotray12', quantity: 1 });
  });

  test('the body never has an amount, even when the page passes one', () => {
    const { init } = sessionRequest(live, plan({ payment: 'pay_1_secret_x', amount: 1 }, { amount: 2, email: 'a@b.co' }).body);
    expect(JSON.parse(init.body as string)).toEqual({ payment: 'pay_1_secret_x', email: 'a@b.co' });
  });

  test('a local API for a test key', () => {
    expect(sessionRequest(test_, {}).url).toBe('http://localhost:3001/v1/modal_sessions');
  });
});

describe("the session's url", () => {
  test('on pay.useclear.org: taken', () => {
    expect(sessionUrl(session('https://pay.useclear.org/m/ms_1'), live)).toBe('https://pay.useclear.org/m/ms_1');
  });

  test('anywhere else: refused', () => {
    for (const url of ['https://evil.example/m/ms_1', 'http://pay.useclear.org/m/ms_1', 'https://pay.useclear.org.evil.example/m', 'https://pay.useclear.org:8443/m', 'javascript:alert(1)', 'data:text/html,hi', '/m/ms_1', 'not a url']) {
      const r = sessionUrl(session(url), live);
      expect(typeof r).toBe('object');
      expect((r as { code: string }).code).toBe('invalid_response');
    }
  });

  test('a local frame for a test key', () => {
    expect(sessionUrl(session('http://localhost:5195/m/ms_1', false), test_)).toBe('http://localhost:5195/m/ms_1');
    expect(typeof sessionUrl(session('https://pay.useclear.org/m/ms_1', false), test_)).toBe('object');
  });

  test("in the other mode, or not a session: refused", () => {
    expect(typeof sessionUrl(session('https://pay.useclear.org/m/ms_1', false), live)).toBe('object');
    expect(typeof sessionUrl({ url: 'https://pay.useclear.org/m/ms_1' }, live)).toBe('object');
    expect(typeof sessionUrl(null, live)).toBe('object');
  });
});

describe('errors', () => {
  test("the API's { error: { code, message } } is passed on as { code, message }", () => {
    expect(apiError({ error: { type: 'permission', code: 'origin_not_allowed', message: "This site isn't allowed.", param: 'x' } }, 403)).toEqual({ code: 'origin_not_allowed', message: "This site isn't allowed." });
  });

  test('anything else gets a generic one', () => {
    expect(apiError(null, 502).code).toBe('api_error');
    expect(apiError({ error: 'nope' }, 400).code).toBe('invalid_response');
  });

  test('createSession never throws', async () => {
    const offline: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await createSession(offline, live, {})).toEqual({ code: 'network_error', message: expect.any(String) });
    const html: FetchLike = async () => ({ ok: false, status: 500, json: () => Promise.reject(new SyntaxError('html')) });
    expect(((await createSession(html, live, {})) as { code: string }).code).toBe('api_error');
    const denied: FetchLike = async () => ({ ok: false, status: 404, json: async () => ({ error: { type: 'not_found', code: 'price_not_found', message: 'No such price.' } }) });
    expect(await createSession(denied, live, {})).toEqual({ code: 'price_not_found', message: 'No such price.' });
    const ok: FetchLike = async () => ({ ok: true, status: 200, json: async () => session('https://pay.useclear.org/m/ms_1') });
    expect(await createSession(ok, live, {})).toBe('https://pay.useclear.org/m/ms_1');
  });
});
