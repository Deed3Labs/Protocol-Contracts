import { describe, expect, test } from 'bun:test';
import { LATEST_VERSION } from '@clear/public-api-contracts';
import Clear, { ClearError } from './index';
import { SDK_VERSION } from './version';

// Made at run time: written out, a fake key looks like a Stripe key to secret scanners.
const fakeKey = (mode: 'test' | 'live') => ['clear', 'sk', mode, 'Fake0Key1For2Tests3Only4X'.slice(0, 24)].join('_');
const KEY = fakeKey('test');

type Call = { url: URL; method: string; headers: Record<string, string>; body: unknown };

/** A fetch that answers from a script, and records what it was asked. */
function fakeFetch(answers: Array<Response | Error | ((call: Call) => Response)>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const call: Call = { url: new URL(String(input)), method: init?.method ?? 'GET', headers, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const next = answers.shift();
    if (!next) throw new Error('fakeFetch: no answer left');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(call) : next;
  }) as typeof fetch;
  return { fetch: fn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const payment = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  object: 'payment',
  livemode: false,
  amount: 18532,
  currency: 'usd',
  lines: [],
  reference: 'catering-1042',
  methods: ['clear', 'card'],
  status: 'requires_customer',
  method: null,
  amountRefunded: 0,
  clientSecret: `${id}_secret_shh`,
  createdAt: '2026-10-16T17:40:00Z',
  succeededAt: null,
  metadata: {},
  ...extra,
});

describe("the spec's create call", () => {
  test('sends the right method, path, headers and body', async () => {
    const f = fakeFetch([json(200, payment('pay_abc'))]);
    const clear = new Clear(KEY, { fetch: f.fetch, baseUrl: 'https://api.example.test' });
    const p = await clear.payments.create(
      {
        amount: 18532,
        currency: 'usd',
        reference: 'catering-1042',
        lines: [
          { name: 'Taco tray for 12', amount: 14900 },
          { name: 'Agua fresca, gallon', amount: 1100, quantity: 2 },
        ],
      },
      { idempotencyKey: 'catering-1042' },
    );
    expect(p.clientSecret).toBe('pay_abc_secret_shh');
    expect(f.calls).toHaveLength(1);
    const [call] = f.calls;
    expect(call!.method).toBe('POST');
    expect(call!.url.toString()).toBe('https://api.example.test/v1/payments');
    expect(call!.headers).toMatchObject({
      authorization: `Bearer ${KEY}`,
      'clear-version': '2026-10-16',
      'content-type': 'application/json',
      'user-agent': `useclear-node/${SDK_VERSION}`,
      'idempotency-key': 'catering-1042',
    });
    expect(LATEST_VERSION).toBe('2026-10-16');
    expect(call!.body).toEqual({
      amount: 18532,
      currency: 'usd',
      reference: 'catering-1042',
      lines: [
        { name: 'Taco tray for 12', amount: 14900 },
        { name: 'Agua fresca, gallon', amount: 1100, quantity: 2 },
      ],
    });
  });

  test('the default base URL, and CLEAR_API_URL over it', async () => {
    const f = fakeFetch([json(200, payment('pay_a')), json(200, payment('pay_a'))]);
    const saved = process.env.CLEAR_API_URL;
    try {
      delete process.env.CLEAR_API_URL;
      await new Clear(KEY, { fetch: f.fetch }).payments.retrieve('pay_a');
      process.env.CLEAR_API_URL = 'http://localhost:4000/';
      await new Clear(KEY, { fetch: f.fetch }).payments.retrieve('pay_a');
    } finally {
      if (saved === undefined) delete process.env.CLEAR_API_URL;
      else process.env.CLEAR_API_URL = saved;
    }
    expect(f.calls.map((c) => c.url.toString())).toEqual(['https://api.useclear.org/v1/payments/pay_a', 'http://localhost:4000/v1/payments/pay_a']);
    expect(f.calls[0]!.method).toBe('GET');
    expect(f.calls[0]!.headers['idempotency-key']).toBeUndefined();
  });

  test('a version of your own is sent', async () => {
    const f = fakeFetch([json(200, { object: 'list', data: [], hasMore: false })]);
    await new Clear(KEY, { fetch: f.fetch, version: '2027-01-01' }).prices.list();
    expect(f.calls[0]!.headers['clear-version']).toBe('2027-01-01');
  });
});

describe('idempotency and retries', () => {
  test('a POST without a key gets one, the same on every retry', async () => {
    const f = fakeFetch([new TypeError('fetch failed'), json(502, { error: { type: 'api', code: 'internal_error', message: 'x' } }), json(200, payment('pay_a'))]);
    const clear = new Clear(KEY, { fetch: f.fetch });
    await clear.payments.create({ amount: 500, currency: 'usd' });
    expect(f.calls).toHaveLength(3);
    const keys = f.calls.map((c) => c.headers['idempotency-key']);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(keys).size).toBe(1);
  });

  test('two calls get two keys', async () => {
    const f = fakeFetch([json(200, payment('pay_a')), json(200, payment('pay_b'))]);
    const clear = new Clear(KEY, { fetch: f.fetch });
    await clear.payments.create({ amount: 500, currency: 'usd' });
    await clear.payments.create({ amount: 500, currency: 'usd' });
    expect(f.calls[0]!.headers['idempotency-key']).not.toBe(f.calls[1]!.headers['idempotency-key']);
  });

  test("the caller's key is reused across retries", async () => {
    const f = fakeFetch([json(503, {}), json(200, payment('pay_a'))]);
    await new Clear(KEY, { fetch: f.fetch }).payments.cancel('pay_a', { idempotencyKey: 'cancel-1042' });
    expect(f.calls.map((c) => c.headers['idempotency-key'])).toEqual(['cancel-1042', 'cancel-1042']);
    expect(f.calls[0]!.url.pathname).toBe('/v1/payments/pay_a/cancel');
  });

  test('a 503, then success', async () => {
    const f = fakeFetch([json(503, { error: { type: 'api', code: 'internal_error', message: 'busy' } }), json(200, payment('pay_a'))]);
    const p = await new Clear(KEY, { fetch: f.fetch }).payments.retrieve('pay_a');
    expect(p.id).toBe('pay_a');
    expect(f.calls).toHaveLength(2);
  });

  test('a 429 is retried too, and the last 5xx is thrown when retries run out', async () => {
    const f = fakeFetch([
      json(429, { error: { type: 'rate_limit', code: 'rate_limited', message: 'slow down' } }),
      json(500, { error: { type: 'api', code: 'internal_error', message: 'broke' } }, { 'Request-Id': 'req_last' }),
    ]);
    const err = await new Clear(KEY, { fetch: f.fetch, maxRetries: 1 }).prices.list().catch((e) => e);
    expect(f.calls).toHaveLength(2);
    expect(err).toBeInstanceOf(ClearError);
    expect(err).toMatchObject({ type: 'api', code: 'internal_error', status: 500, requestId: 'req_last' });
  });

  test('no retry on a 400, and the error carries what Clear said', async () => {
    const f = fakeFetch([
      json(400, { error: { type: 'invalid_request', code: 'lines_exceed_amount', message: 'The lines come to more than the amount', param: 'lines' } }, { 'Request-Id': 'req_123' }),
    ]);
    const err = await new Clear(KEY, { fetch: f.fetch })
      .payments.create({ amount: 17000, currency: 'usd', lines: [{ name: 'Taco tray for 12', amount: 17100 }] })
      .catch((e) => e);
    expect(f.calls).toHaveLength(1);
    expect(err).toBeInstanceOf(ClearError);
    expect(err).toMatchObject({
      name: 'ClearError',
      type: 'invalid_request',
      code: 'lines_exceed_amount',
      message: 'The lines come to more than the amount',
      param: 'lines',
      status: 400,
      requestId: 'req_123',
    });
  });

  test('no retry on a 409 either', async () => {
    const f = fakeFetch([json(409, { error: { type: 'conflict', code: 'reference_taken', message: 'taken' } })]);
    const err = await new Clear(KEY, { fetch: f.fetch }).payments.create({ amount: 500, currency: 'usd', reference: 'r' }).catch((e) => e);
    expect(f.calls).toHaveLength(1);
    expect(err).toMatchObject({ code: 'reference_taken', status: 409, param: undefined, requestId: null });
  });

  test('an answer that is not JSON is an api error', async () => {
    const f = fakeFetch([new Response('<html>Bad gateway</html>', { status: 404 })]);
    const err = await new Clear(KEY, { fetch: f.fetch }).payments.retrieve('pay_a').catch((e) => e);
    expect(err).toBeInstanceOf(ClearError);
    expect(err).toMatchObject({ type: 'api', code: 'internal_error', status: 404 });
  });

  test('no answer at all is a connection error', async () => {
    const f = fakeFetch([new TypeError('fetch failed')]);
    const err = await new Clear(KEY, { fetch: f.fetch, maxRetries: 0 }).payments.retrieve('pay_a').catch((e) => e);
    expect(err).toMatchObject({ type: 'api', code: 'connection_error', status: null });
  });
});

describe('keys', () => {
  test('a publishable key is refused, and says it belongs in the browser', () => {
    let err: unknown;
    try {
      new Clear(['clear', 'pk', 'test', 'Fake0Key1For2Tests3Only4X'.slice(0, 24)].join('_'));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ClearError);
    expect(err).toMatchObject({ code: 'publishable_key_not_allowed' });
    expect((err as Error).message).toContain('browser');
  });
  test('no key, and not a key', () => {
    expect(() => new Clear(undefined)).toThrow(/No secret key/);
    expect(() => new Clear('whsec_abc')).toThrow(/clear_sk_test_ or clear_sk_live_/);
  });
  test('test and live', () => {
    expect(new Clear(KEY).livemode).toBe(false);
    expect(new Clear(fakeKey('live')).livemode).toBe(true);
  });
});

describe('lists', () => {
  test('list sends its filters as the query', async () => {
    const f = fakeFetch([json(200, { object: 'list', data: [], hasMore: false })]);
    await new Clear(KEY, { fetch: f.fetch }).payments.list({ reference: 'catering-1042', createdFrom: '2026-10-01T00:00:00Z', limit: 5 });
    const q = f.calls[0]!.url.searchParams;
    expect(f.calls[0]!.url.pathname).toBe('/v1/payments');
    expect(Object.fromEntries(q)).toEqual({ reference: 'catering-1042', createdFrom: '2026-10-01T00:00:00Z', limit: '5' });
  });

  test('listAll pages with startingAfter until hasMore is false', async () => {
    const f = fakeFetch([
      json(200, { object: 'list', data: [payment('pay_3'), payment('pay_2')], hasMore: true }),
      json(200, { object: 'list', data: [payment('pay_1')], hasMore: false }),
    ]);
    const ids: string[] = [];
    for await (const p of new Clear(KEY, { fetch: f.fetch }).payments.listAll({ limit: 2 })) ids.push(p.id);
    expect(ids).toEqual(['pay_3', 'pay_2', 'pay_1']);
    expect(f.calls.map((c) => c.url.searchParams.get('startingAfter'))).toEqual([null, 'pay_2']);
    expect(f.calls.map((c) => c.url.searchParams.get('limit'))).toEqual(['2', '2']);
  });
});

describe('the other routes', () => {
  test('each goes where the API expects', async () => {
    const list = { object: 'list', data: [], hasMore: false };
    const f = fakeFetch([json(200, list), json(200, {}), json(200, {}), json(200, {}), json(200, list), json(200, { status: 'disabled' }), json(200, list)]);
    const clear = new Clear(KEY, { fetch: f.fetch });
    await clear.prices.list();
    await clear.paymentLinks.create({ price: 'price_tacotray12', quantity: 2 }, { idempotencyKey: 'link-1' });
    await clear.refunds.create({ payment: 'pay_abc' });
    await clear.webhookEndpoints.create({ url: 'https://micasatacos.com/clear/webhook', events: ['payment.succeeded'] });
    await clear.webhookEndpoints.list();
    const gone = await clear.webhookEndpoints.del('we_abc');
    expect(gone.status).toBe('disabled');
    await clear.webhookDeliveries.list({ endpoint: 'we_abc', status: 'failed', limit: 5 });
    expect(f.calls[6]!.url.search).toBe('?endpoint=we_abc&status=failed&limit=5');
    expect(f.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'GET /v1/prices',
      'POST /v1/payment_links',
      'POST /v1/refunds',
      'POST /v1/webhook_endpoints',
      'GET /v1/webhook_endpoints',
      'DELETE /v1/webhook_endpoints/we_abc',
      'GET /v1/webhook_deliveries',
    ]);
    expect(f.calls[1]!.headers['idempotency-key']).toBe('link-1');
    expect(f.calls[2]!.headers['idempotency-key']).toBeDefined();
    expect(f.calls[5]!.headers['idempotency-key']).toBeUndefined();
  });
});
