import { describe, expect, test } from 'bun:test';
import Clear from '@useclear/node';
import {
  createPaymentLink,
  getPayment,
  listPayments,
  listWebhookDeliveries,
  refundPayment,
  REFUND_IN_APP,
  REFUND_WAITING,
  toTimestamp,
  type ToolResult,
} from './tools';

// Made at run time: written out, a fake key looks like a real one to secret scanners.
const KEY = ['clear', 'sk', 'test', 'Fake0Key1For2Tests3Only4'].join('_');

type Call = { url: URL; method: string; headers: Record<string, string>; body: unknown };

/** The real SDK over a fetch that answers from a script and records what it was asked. */
function fakeClear(answers: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url: new URL(String(input)), method: init?.method ?? 'GET', headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = answers.shift();
    if (!next) throw new Error('fakeFetch: no answer left');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof globalThis.fetch;
  return { clear: new Clear(KEY, { fetch, baseUrl: 'https://api.example.test', maxRetries: 0 }), calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_123' } });
const apiError = (status: number, type: string, code: string, message: string, param?: string) =>
  json(status, { error: { type, code, message, ...(param ? { param } : {}) } });

const payment = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  object: 'payment',
  livemode: false,
  amount: 18532,
  currency: 'usd',
  lines: [{ name: 'Taco tray for 12', amount: 14900, quantity: 1 }],
  reference: 'catering-1042',
  methods: ['clear', 'card'],
  status: 'succeeded',
  method: 'card',
  amountRefunded: 0,
  clientSecret: `${id}_secret_shh`,
  createdAt: '2026-10-15T17:40:00Z',
  succeededAt: '2026-10-15T17:42:00Z',
  metadata: {},
  ...extra,
});

const read = (r: ToolResult) => JSON.parse(r.content[0]!.text);

describe('create_payment_link', () => {
  test('an amount link: posts the amount and note, answers url, amount in cents and dollars, id', async () => {
    const f = fakeClear([
      json(200, {
        id: 'plink_1',
        object: 'payment_link',
        livemode: false,
        url: 'https://pay.useclear.org/l/abc',
        slug: 'abc',
        amount: 18532,
        price: null,
        quantity: null,
        note: 'Saturday catering',
        expiresAt: null,
        allowOverTime: false,
        active: true,
        createdAt: '2026-10-16T10:00:00Z',
      }),
    ]);
    const r = await createPaymentLink(f.clear, { amount: 18532, note: 'Saturday catering' });
    expect(r.isError).toBeUndefined();
    expect(f.calls[0]!.method).toBe('POST');
    expect(f.calls[0]!.url.pathname).toBe('/v1/payment_links');
    expect(f.calls[0]!.body).toEqual({ amount: 18532, note: 'Saturday catering' });
    expect(read(r)).toMatchObject({ id: 'plink_1', url: 'https://pay.useclear.org/l/abc', amount: { cents: 18532, formatted: '$185.32' } });
  });

  test('a price link: posts the price and quantity (1 unless said)', async () => {
    const f = fakeClear([
      json(200, {
        id: 'plink_2',
        object: 'payment_link',
        livemode: false,
        url: 'https://pay.useclear.org/l/def',
        slug: 'def',
        amount: null,
        price: 'price_tray',
        quantity: 1,
        note: null,
        expiresAt: null,
        allowOverTime: false,
        active: true,
        createdAt: '2026-10-16T10:00:00Z',
      }),
    ]);
    const r = await createPaymentLink(f.clear, { price: 'price_tray' });
    expect(f.calls[0]!.body).toEqual({ price: 'price_tray', quantity: 1 });
    expect(read(r)).toMatchObject({ id: 'plink_2', amount: null, price: 'price_tray', quantity: 1 });
  });

  test('both or neither of amount and price is refused before any request', async () => {
    const f = fakeClear([]);
    for (const input of [{}, { amount: 5000, price: 'price_tray' }]) {
      const r = await createPaymentLink(f.clear, input);
      expect(r.isError).toBe(true);
      expect(read(r).error.code).toBe('parameter_invalid');
    }
    expect(f.calls).toHaveLength(0);
  });
});

describe('get_payment', () => {
  test('by id: GETs it, and leaves out the client secret', async () => {
    const f = fakeClear([json(200, payment('pay_abc'))]);
    const r = await getPayment(f.clear, { id: 'pay_abc' });
    expect(f.calls[0]!.url.pathname).toBe('/v1/payments/pay_abc');
    const out = read(r);
    expect(out).toMatchObject({ id: 'pay_abc', status: 'succeeded', amount: { cents: 18532, formatted: '$185.32' }, amountRefunded: { formatted: '$0.00' } });
    expect(out.lines[0]).toEqual({ name: 'Taco tray for 12', quantity: 1, amountEach: { cents: 14900, formatted: '$149.00' } });
    expect(r.content[0]!.text).not.toContain('secret');
  });

  test('by reference: lists with that reference and limit 1', async () => {
    const f = fakeClear([json(200, { object: 'list', data: [payment('pay_ref')], hasMore: false })]);
    const r = await getPayment(f.clear, { reference: 'catering-1042' });
    const q = f.calls[0]!.url;
    expect(q.pathname).toBe('/v1/payments');
    expect(q.searchParams.get('reference')).toBe('catering-1042');
    expect(q.searchParams.get('limit')).toBe('1');
    expect(read(r).id).toBe('pay_ref');
  });

  test('a reference nothing has is payment_not_found', async () => {
    const f = fakeClear([json(200, { object: 'list', data: [], hasMore: false })]);
    const r = await getPayment(f.clear, { reference: 'nope-1' });
    expect(r.isError).toBe(true);
    expect(read(r).error.code).toBe('payment_not_found');
  });

  test("Clear's 404 comes back as its code and message", async () => {
    const f = fakeClear([apiError(404, 'not_found', 'payment_not_found', 'No such payment')]);
    const r = await getPayment(f.clear, { id: 'pay_gone' });
    expect(r.isError).toBe(true);
    expect(read(r).error).toEqual({ code: 'payment_not_found', message: 'No such payment', requestId: 'req_123' });
  });
});

describe('list_payments', () => {
  test('bare dates become a whole UTC range; the list is compact, with hasMore', async () => {
    const f = fakeClear([json(200, { object: 'list', data: [payment('pay_1'), payment('pay_2', { reference: null, status: 'requires_customer', method: null })], hasMore: true })]);
    const r = await listPayments(f.clear, { from: '2026-10-15', to: '2026-10-15' });
    const q = f.calls[0]!.url.searchParams;
    expect(q.get('createdFrom')).toBe('2026-10-15T00:00:00.000Z');
    expect(q.get('createdTo')).toBe('2026-10-15T23:59:59.999Z');
    expect(q.get('limit')).toBe('20');
    const out = read(r);
    expect(out.hasMore).toBe(true);
    expect(out.payments).toEqual([
      { id: 'pay_1', reference: 'catering-1042', amount: { cents: 18532, formatted: '$185.32' }, status: 'succeeded', method: 'card', createdAt: '2026-10-15T17:40:00Z' },
      { id: 'pay_2', reference: null, amount: { cents: 18532, formatted: '$185.32' }, status: 'requires_customer', method: null, createdAt: '2026-10-15T17:40:00Z' },
    ]);
  });

  test('datetimes pass through (as UTC), limit is sent, no range sends neither', async () => {
    const f = fakeClear([json(200, { object: 'list', data: [], hasMore: false }), json(200, { object: 'list', data: [], hasMore: false })]);
    await listPayments(f.clear, { from: '2026-10-15T09:00:00-07:00', limit: 100 });
    expect(f.calls[0]!.url.searchParams.get('createdFrom')).toBe('2026-10-15T16:00:00.000Z');
    expect(f.calls[0]!.url.searchParams.has('createdTo')).toBe(false);
    expect(f.calls[0]!.url.searchParams.get('limit')).toBe('100');
    await listPayments(f.clear, {});
    expect([...f.calls[1]!.url.searchParams.keys()]).toEqual(['limit']);
  });

  test('a bad date, or from after to, is refused before any request', async () => {
    const f = fakeClear([]);
    expect(read(await listPayments(f.clear, { from: 'yesterday' })).error.param).toBe('from');
    expect(read(await listPayments(f.clear, { to: '2026-02-30' })).error.param).toBe('to');
    expect(read(await listPayments(f.clear, { from: '2026-10-16', to: '2026-10-15' })).error.code).toBe('parameter_invalid');
    expect(f.calls).toHaveLength(0);
  });

  test('toTimestamp', () => {
    expect(toTimestamp('2026-10-15T09:00', 'from')).toBe('2026-10-15T09:00:00.000Z');
    expect(toTimestamp('2026-10-15', 'to')).toBe('2026-10-15T23:59:59.999Z');
    expect(toTimestamp('Oct 15', 'from')).toBeNull();
  });
});

describe('refund_payment', () => {
  const refund = (extra: Record<string, unknown> = {}) => ({
    id: 're_1',
    object: 'refund',
    livemode: false,
    payment: 'pay_abc',
    amount: 2500,
    status: 'pending_approval',
    reason: 'Cold tacos',
    createdAt: '2026-10-16T10:00:00Z',
    ...extra,
  });

  test('always sends requireApproval: true, with an idempotency key, and says it waits for approval', async () => {
    const f = fakeClear([json(200, refund())]);
    const r = await refundPayment(f.clear, { payment: 'pay_abc', amount: 2500, reason: 'Cold tacos' });
    expect(f.calls[0]!.method).toBe('POST');
    expect(f.calls[0]!.url.pathname).toBe('/v1/refunds');
    expect(f.calls[0]!.body).toEqual({ payment: 'pay_abc', amount: 2500, reason: 'Cold tacos', requireApproval: true });
    expect(f.calls[0]!.headers['idempotency-key']).toBeTruthy();
    const out = read(r);
    expect(out.message).toBe(REFUND_WAITING);
    expect(out.message).toBe("Waiting for an owner or manager to approve it in Clear's merchant app, under Charges.");
    expect(out.refund).toEqual({ id: 're_1', payment: 'pay_abc', amount: { cents: 2500, formatted: '$25.00' }, status: 'pending_approval', reason: 'Cold tacos' });
  });

  test('with no amount, still requireApproval: true', async () => {
    const f = fakeClear([json(200, refund({ amount: 18532, reason: null }))]);
    await refundPayment(f.clear, { payment: 'pay_abc' });
    expect(f.calls[0]!.body).toEqual({ payment: 'pay_abc', requireApproval: true });
  });

  test('a Clear payment (refund_in_app) says where it is refunded, and that nothing changed', async () => {
    const f = fakeClear([apiError(409, 'conflict', 'refund_in_app', 'Refund a Clear payment from Charges in the merchant app')]);
    const r = await refundPayment(f.clear, { payment: 'pay_clear' });
    expect(r.isError).toBe(true);
    const { error } = read(r);
    expect(error.code).toBe('refund_in_app');
    expect(error.message).toBe(REFUND_IN_APP);
    expect(error.message).toContain('Charges');
    expect(error.message).toContain('Nothing was changed');
  });

  test('another refusal is its code and message', async () => {
    const f = fakeClear([apiError(400, 'invalid_request', 'refund_exceeds_payment', 'That is more than is left to refund', 'amount')]);
    const { error } = read(await refundPayment(f.clear, { payment: 'pay_abc', amount: 99999 }));
    expect(error).toEqual({ code: 'refund_exceeds_payment', message: 'That is more than is left to refund', param: 'amount', requestId: 'req_123' });
  });

  test('a non-Clear failure is a short generic message, not its text', async () => {
    const f = fakeClear([]);
    const broken = { ...f.clear, refunds: { create: async () => Promise.reject(new Error(`boom ${KEY}`)) } } as unknown as Clear;
    const r = await refundPayment(broken, { payment: 'pay_abc' });
    expect(r.isError).toBe(true);
    expect(read(r).error.code).toBe('tool_error');
    expect(r.content[0]!.text).not.toContain('boom');
    expect(r.content[0]!.text).not.toContain(KEY);
  });
});

describe('list_webhook_deliveries', () => {
  test('passes endpoint, status and limit; answers type, status, attempts, last HTTP status, next attempt', async () => {
    const f = fakeClear([
      json(200, {
        object: 'list',
        data: [
          {
            id: 'whd_1',
            object: 'webhook_delivery',
            livemode: false,
            endpoint: 'we_1',
            event: { id: 'evt_1', type: 'payment.succeeded' },
            status: 'pending',
            attempts: 3,
            responseStatus: 500,
            lastAttemptAt: '2026-10-16T10:05:00Z',
            nextAttemptAt: '2026-10-16T10:35:00Z',
            createdAt: '2026-10-16T10:00:00Z',
          },
        ],
        hasMore: false,
      }),
    ]);
    const r = await listWebhookDeliveries(f.clear, { endpoint: 'we_1', status: 'pending', limit: 5 });
    const q = f.calls[0]!.url;
    expect(q.pathname).toBe('/v1/webhook_deliveries');
    expect(Object.fromEntries(q.searchParams)).toEqual({ endpoint: 'we_1', status: 'pending', limit: '5' });
    expect(read(r)).toEqual({
      deliveries: [
        {
          id: 'whd_1',
          endpoint: 'we_1',
          eventType: 'payment.succeeded',
          eventId: 'evt_1',
          status: 'pending',
          attempts: 3,
          lastHttpStatus: 500,
          lastAttemptAt: '2026-10-16T10:05:00Z',
          nextAttemptAt: '2026-10-16T10:35:00Z',
          createdAt: '2026-10-16T10:00:00Z',
        },
      ],
      hasMore: false,
    });
  });

  test('a connection failure is ClearError connection_error, as a result', async () => {
    const f = fakeClear([new TypeError('fetch failed')]);
    const r = await listWebhookDeliveries(f.clear, {});
    expect(r.isError).toBe(true);
    expect(read(r).error.code).toBe('connection_error');
  });
});
