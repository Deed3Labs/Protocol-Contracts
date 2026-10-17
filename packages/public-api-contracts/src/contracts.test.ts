import { describe, expect, test } from 'bun:test';
import {
  CreateModalSession,
  CreatePayment,
  CreatePaymentLink,
  CreateRefund,
  Event,
  formatSignatureHeader,
  fromZodError,
  LATEST_VERSION,
  ModalMessage,
  parseSignatureHeader,
  resolveVersion,
  signedPayload,
  timestampFresh,
  type ApiError,
} from './index';

const errorOf = (schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, body: unknown): ApiError => {
  const r = schema.safeParse(body);
  if (r.success) throw new Error('expected it to fail');
  return fromZodError(r.error as never);
};

describe('Clear-Version', () => {
  test("no header runs at the key's pinned version", () => {
    expect(resolveVersion(undefined, '2026-10-16')).toEqual({ ok: true, version: '2026-10-16' });
    expect(resolveVersion('  ', '2026-10-16')).toEqual({ ok: true, version: '2026-10-16' });
  });
  test('a known version is used', () => {
    expect(resolveVersion('2026-10-16', LATEST_VERSION)).toEqual({ ok: true, version: '2026-10-16' });
  });
  test('an unknown version is refused, never rounded', () => {
    expect(resolveVersion('2026-10-17', LATEST_VERSION)).toEqual({ ok: false, code: 'version_unknown' });
    expect(resolveVersion('2025-01-01', LATEST_VERSION)).toEqual({ ok: false, code: 'version_unknown' });
  });
});

describe("the spec's server snippet", () => {
  const body = {
    amount: 18532,
    currency: 'usd',
    reference: 'catering-1042',
    lines: [
      { name: 'Taco tray for 12', amount: 14900 },
      { name: 'Agua fresca, gallon', amount: 1100, quantity: 2 },
    ],
  };
  test('parses, with a quantity of 1 and both methods by default', () => {
    const p = CreatePayment.parse(body);
    expect(p.lines?.[0]?.quantity).toBe(1);
    expect(p.methods).toEqual(['clear', 'card']);
  });
  test('what the amount comes to above the lines is the tax: $14.32', () => {
    const p = CreatePayment.parse(body);
    const lines = p.lines!.reduce((s, l) => s + l.amount * l.quantity, 0);
    expect(lines).toBe(17100);
    expect(p.amount - lines).toBe(1432);
  });
  test('lines over the amount are refused', () => {
    expect(errorOf(CreatePayment, { ...body, amount: 17000 })).toMatchObject({ code: 'lines_exceed_amount', param: 'lines' });
  });
  test('under $0.50 is refused', () => {
    expect(errorOf(CreatePayment, { amount: 49, currency: 'usd' })).toMatchObject({ code: 'amount_too_small', param: 'amount' });
  });
  test('a missing amount and an unknown field are named', () => {
    expect(errorOf(CreatePayment, { currency: 'usd' })).toMatchObject({ code: 'parameter_missing', param: 'amount' });
    expect(errorOf(CreatePayment, { amount: 500, currency: 'usd', tip: 100 })).toMatchObject({ code: 'parameter_unknown', param: 'tip' });
  });
  test('only usd', () => {
    expect(errorOf(CreatePayment, { amount: 500, currency: 'eur' })).toMatchObject({ code: 'parameter_invalid', param: 'currency' });
  });
});

describe('payment links and modal sessions', () => {
  test('a link is an amount, or a price and a quantity, never both', () => {
    expect(CreatePaymentLink.safeParse({ amount: 16148 }).success).toBe(true);
    expect(CreatePaymentLink.parse({ price: 'price_tacotray12' })).toMatchObject({ quantity: 1, allowOverTime: false });
    expect(CreatePaymentLink.safeParse({ amount: 16148, price: 'price_tacotray12' }).success).toBe(false);
  });
  test("the no-server snippet's session: a price and a quantity", () => {
    expect(CreateModalSession.parse({ price: 'price_tacotray12', quantity: 1 })).toMatchObject({ price: 'price_tacotray12', quantity: 1 });
  });
  test('a session never takes an amount', () => {
    expect(CreateModalSession.safeParse({ price: 'price_tacotray12', amount: 1 }).success).toBe(false);
    expect(CreateModalSession.safeParse({ payment: 'pay_1_secret_x', amount: 1 }).success).toBe(false);
  });
  test('a logo must be https', () => {
    expect(CreateModalSession.safeParse({ price: 'price_a', logo: 'http://micasatacos.com/logo.png' }).success).toBe(false);
    expect(CreateModalSession.safeParse({ price: 'price_a', logo: 'https://micasatacos.com/logo.png' }).success).toBe(true);
  });
});

describe('refunds', () => {
  test('an amount is optional; approval is off unless asked', () => {
    expect(CreateRefund.parse({ payment: 'pay_abc' })).toEqual({ payment: 'pay_abc', requireApproval: false });
  });
});

describe('the modal protocol', () => {
  const success = { protocol: 'clear.v1', type: 'success', id: 'pay_abc', status: 'succeeded', reference: 'catering-1042' };
  test('success carries exactly id, status and reference', () => {
    expect(ModalMessage.parse(success)).toEqual(success as never);
  });
  test('anything more fails to parse, so it never reaches the page', () => {
    for (const extra of [{ phone: '9095550188' }, { email: 'sofia.m@gmail.com' }, { name: 'Sofia' }, { balanceCents: 1 }, { code: '000000' }]) {
      expect(ModalMessage.safeParse({ ...success, ...extra }).success).toBe(false);
    }
  });
  test('another protocol or type is ignored', () => {
    expect(ModalMessage.safeParse({ ...success, protocol: 'clear.v2' }).success).toBe(false);
    expect(ModalMessage.safeParse({ protocol: 'clear.v1', type: 'debug' }).success).toBe(false);
  });
  test('the other four', () => {
    for (const m of [
      { protocol: 'clear.v1', type: 'ready' },
      { protocol: 'clear.v1', type: 'resize', height: 612 },
      { protocol: 'clear.v1', type: 'cancel' },
      { protocol: 'clear.v1', type: 'error', code: 'session_expired', message: 'This checkout ran out of time.' },
    ]) {
      expect(ModalMessage.safeParse(m).success).toBe(true);
    }
  });
});

describe('webhook events', () => {
  const payment = {
    id: 'pay_abc',
    object: 'payment',
    livemode: false,
    amount: 18532,
    currency: 'usd',
    lines: [{ name: 'Taco tray for 12', amount: 14900, quantity: 1 }],
    reference: 'catering-1042',
    methods: ['clear', 'card'],
    status: 'succeeded',
    method: 'clear',
    amountRefunded: 0,
    clientSecret: 'pay_abc_secret_shh',
    createdAt: '2026-10-16T17:40:00Z',
    succeededAt: '2026-10-16T17:42:00Z',
    metadata: {},
  };
  test('event.data is the payment, so event.data.reference is the reference', () => {
    const e = Event.parse({ id: 'evt_1', object: 'event', type: 'payment.succeeded', createdAt: '2026-10-16T17:42:00Z', livemode: false, apiVersion: '2026-10-16', data: payment });
    expect(e.type === 'payment.succeeded' && e.data.reference).toBe('catering-1042');
  });
  test('an event never carries the client secret', () => {
    const e = Event.parse({ id: 'evt_1', object: 'event', type: 'payment.succeeded', createdAt: '2026-10-16T17:42:00Z', livemode: false, apiVersion: '2026-10-16', data: payment });
    expect('clientSecret' in e.data).toBe(false);
  });
});

describe('Clear-Signature', () => {
  const sig = 'a'.repeat(64);
  test('round trips, with one v1 per live secret', () => {
    const header = formatSignatureHeader(1792180920, [sig, 'b'.repeat(64)]);
    expect(header).toBe(`t=1792180920,v1=${sig},v1=${'b'.repeat(64)}`);
    expect(parseSignatureHeader(header)).toEqual({ timestamp: 1792180920, signatures: [sig, 'b'.repeat(64)] });
  });
  test('the signed payload is "t.body"', () => {
    expect(signedPayload(1792180920, '{"id":"evt_1"}')).toBe('1792180920.{"id":"evt_1"}');
  });
  test('a header without a time or a signature is not one', () => {
    expect(parseSignatureHeader(`v1=${sig}`)).toBeNull();
    expect(parseSignatureHeader('t=1792180920')).toBeNull();
    expect(parseSignatureHeader('t=1792180920,v1=nothex')).toBeNull();
    expect(parseSignatureHeader('')).toBeNull();
  });
  test('five minutes either way', () => {
    expect(timestampFresh(1000, 1300)).toBe(true);
    expect(timestampFresh(1000, 1301)).toBe(false);
  });
});
