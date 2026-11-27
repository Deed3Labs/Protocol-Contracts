import { describe, expect, test } from 'bun:test';
import handler from '../../api/frame';
import { frameableOrigin, frameHeaders, lookupOrigin } from '../../api/_frameHeaders';

const SESSION = `ms_${'a1'.repeat(16)}`;
const API = 'https://api.test';
const answering = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('frame-ancestors for /m/:session (§5)', () => {
  test('the session’s website alone may frame it', () => {
    expect(frameHeaders('https://micasatacos.com')['Content-Security-Policy']).toBe('frame-ancestors https://micasatacos.com');
    expect(frameHeaders('https://micasatacos.com')['X-Frame-Options']).toBeUndefined();
  });

  test('no website: refused everywhere', () => {
    const h = frameHeaders(null);
    expect(h['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    expect(h['X-Frame-Options']).toBe('DENY');
  });

  test('only a clean origin goes in the header', () => {
    expect(frameableOrigin('https://micasatacos.com')).toBe('https://micasatacos.com');
    expect(frameableOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(frameableOrigin('http://micasatacos.com')).toBeNull();
    expect(frameableOrigin("https://a.com 'unsafe-inline'")).toBeNull();
    expect(frameableOrigin('https://a.com; script-src *')).toBeNull();
    expect(frameableOrigin('*')).toBeNull();
    expect(frameableOrigin('https://a.com/path')).toBeNull();
    expect(frameableOrigin(42)).toBeNull();
  });

  test('looks the session up; anything odd means none', async () => {
    expect(await lookupOrigin(API, SESSION, answering({ origin: 'https://micasatacos.com' }))).toBe('https://micasatacos.com');
    expect(await lookupOrigin(API, SESSION, answering({ origin: null }))).toBeNull();
    expect(await lookupOrigin(API, SESSION, answering({}, 404))).toBeNull();
    expect(await lookupOrigin(API, SESSION, (async () => { throw new Error('down'); }) as unknown as typeof fetch)).toBeNull();
    // A link session (or any other id) never reaches the API.
    let called = false;
    const spy = (async () => ((called = true), new Response('{}'))) as unknown as typeof fetch;
    expect(await lookupOrigin(API, 'ps_' + 'a1'.repeat(16), spy)).toBeNull();
    expect(await lookupOrigin(API, `${SESSION}/../x`, spy)).toBeNull();
    expect(called).toBe(false);
  });

  test('the function serves the page with that header', async () => {
    const real = globalThis.fetch;
    process.env.PAY_API_URL = API;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/index.html')) return new Response('<!doctype html><div id="root"></div>');
      if (url === `${API}/api/checkout/${SESSION}/frame`) return new Response(JSON.stringify({ origin: 'https://micasatacos.com' }));
      return new Response('{"origin":null}');
    }) as typeof fetch;
    try {
      const ok = await handler(new Request(`https://pay.useclear.org/api/frame?session=${SESSION}`));
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-security-policy')).toBe('frame-ancestors https://micasatacos.com');
      expect(await ok.text()).toContain('id="root"');
      const other = await handler(new Request(`https://pay.useclear.org/api/frame?session=ms_${'b2'.repeat(16)}`));
      expect(other.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    } finally {
      globalThis.fetch = real;
      delete process.env.PAY_API_URL;
    }
  });
});
