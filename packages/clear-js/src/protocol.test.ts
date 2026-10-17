import { describe, expect, test } from 'bun:test';
import { ModalMessage as Contract } from '@clear/public-api-contracts';
import { acceptMessage, parseMessage } from './protocol';

const P = 'clear.v1';
const ORIGIN = 'https://pay.useclear.org';
const frame = { name: 'the frame' };
const success = { protocol: P, type: 'success', id: 'pay_8f2k', status: 'succeeded', reference: 'catering-1042' };

const VALID: unknown[] = [
  { protocol: P, type: 'ready' },
  { protocol: P, type: 'resize', height: 0 },
  { protocol: P, type: 'resize', height: 612 },
  { protocol: P, type: 'resize', height: 10_000 },
  success,
  { ...success, status: 'processing', reference: null },
  { ...success, reference: '  padded  ' },
  { protocol: P, type: 'cancel' },
  { protocol: P, type: 'error', code: 'session_expired', message: 'This checkout ran out of time.' },
  { protocol: P, type: 'error', code: 'origin_not_allowed', message: '' },
  { protocol: P, type: 'error', code: 'unavailable', message: 'x'.repeat(200) },
];

const INVALID: unknown[] = [
  null, undefined, 'ready', 42, [], [{ protocol: P, type: 'ready' }],
  JSON.stringify({ protocol: P, type: 'ready' }),
  { type: 'ready' },
  { protocol: 'clear.v2', type: 'ready' },
  { protocol: P },
  { protocol: P, type: 'open' },
  { protocol: P, type: 'toString' },
  { protocol: P, type: '__proto__' },
  { protocol: P, type: 'ready', extra: 1 },
  { protocol: P, type: 'ready', phone: '9095550142' },
  { protocol: P, type: 'cancel', reason: 'esc' },
  { protocol: P, type: 'resize' },
  { protocol: P, type: 'resize', height: -1 },
  { protocol: P, type: 'resize', height: 10_001 },
  { protocol: P, type: 'resize', height: 12.5 },
  { protocol: P, type: 'resize', height: '600' },
  { protocol: P, type: 'resize', height: Number.NaN },
  { ...success, phone: '9095550142' },
  { ...success, email: 'sofia.m@gmail.com' },
  { ...success, amount: 18532 },
  { ...success, id: 'ord_8f2k' },
  { ...success, id: 'pay_' },
  { ...success, status: 'failed' },
  { ...success, reference: '' },
  { ...success, reference: '   ' },
  { ...success, reference: 'r'.repeat(101) },
  { protocol: P, type: 'success', id: 'pay_8f2k', status: 'succeeded' },
  { protocol: P, type: 'error', code: 'card_declined', message: 'x' },
  { protocol: P, type: 'error', code: 'unavailable', message: 'x'.repeat(201) },
  { protocol: P, type: 'error', code: 'unavailable' },
  { protocol: P, type: 'error', code: 'unavailable', message: 'x', name: 'Sofia' },
];

describe('the validator', () => {
  test('takes every valid message', () => {
    for (const m of VALID) expect(parseMessage(m)).not.toBeNull();
  });

  test('refuses everything else: extra fields, wrong values, unknown types', () => {
    for (const m of INVALID) expect(parseMessage(m)).toBeNull();
  });

  test("agrees with the contract's zod schema on every case", () => {
    for (const m of [...VALID, ...INVALID]) {
      expect({ m, ok: parseMessage(m) !== null }).toEqual({ m, ok: Contract.safeParse(m).success });
    }
  });

  test('a class instance is not a message', () => {
    class Fake {
      protocol = P;
      type = 'ready';
    }
    expect(parseMessage(new Fake())).toBeNull();
  });
});

describe('accepting an event', () => {
  test('from the pay origin and its own frame', () => {
    expect(acceptMessage({ origin: ORIGIN, source: frame, data: success }, frame, ORIGIN)).toEqual(success as never);
  });

  test('from another origin: ignored', () => {
    for (const origin of ['https://micasatacos.com', 'https://pay.useclear.org.evil.com', 'http://pay.useclear.org', 'https://pay.useclear.org:444', 'null', '']) {
      expect(acceptMessage({ origin, source: frame, data: success }, frame, ORIGIN)).toBeNull();
    }
  });

  test('from another window, even on the pay origin: ignored', () => {
    expect(acceptMessage({ origin: ORIGIN, source: { name: 'another frame' }, data: success }, frame, ORIGIN)).toBeNull();
    expect(acceptMessage({ origin: ORIGIN, source: null, data: success }, frame, ORIGIN)).toBeNull();
    expect(acceptMessage({ origin: ORIGIN, source: null, data: success }, null, ORIGIN)).toBeNull();
  });

  test('that does not parse: ignored', () => {
    expect(acceptMessage({ origin: ORIGIN, source: frame, data: { ...success, phone: '9095550142' } }, frame, ORIGIN)).toBeNull();
    expect(acceptMessage({ origin: ORIGIN, source: frame, data: { protocol: P, type: 'navigate', to: '/' } }, frame, ORIGIN)).toBeNull();
  });
});
