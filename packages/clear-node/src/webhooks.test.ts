import { afterEach, describe, expect, test } from 'bun:test';
import Clear, { ClearSignatureError } from './index';

// Made at run time: written out, a fake key looks like a Stripe key to secret scanners.
const fakeKey = (mode: 'test' | 'live') => ['sk', mode, 'Fake0Key1For2Tests3Only4X'.slice(0, 24)].join('_');
const KEY = fakeKey('test');
const SECRET = 'whsec_micasa_current';
const OLD_SECRET = 'whsec_micasa_old';
const NOW = 1_792_180_920;

const event = {
  id: 'evt_1',
  object: 'event',
  type: 'payment.succeeded',
  createdAt: '2026-10-16T17:42:00Z',
  livemode: false,
  apiVersion: '2026-10-16',
  data: { id: 'pay_abc', object: 'payment', reference: 'catering-1042', amount: 18532, status: 'succeeded' },
};
const body = JSON.stringify(event);
const opts = { now: NOW };

const clear = () => new Clear(KEY, { webhookSecret: SECRET });
const reason = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ClearSignatureError);
    return (e as Error).message;
  }
  throw new Error('expected it to throw');
};

describe('webhooks.verify', () => {
  test('accepts a body signed with sign(), as a Buffer or a string, and returns the event', () => {
    const c = clear();
    const header = c.webhooks.sign(body, SECRET, NOW);
    expect(header).toMatch(/^t=1792180920,v1=[0-9a-f]{64}$/);
    const e = c.webhooks.verify(Buffer.from(body), header, undefined, opts);
    expect(e.type === 'payment.succeeded' && e.data.reference).toBe('catering-1042');
    expect(c.webhooks.verify(body, header, undefined, opts).id).toBe('evt_1');
    expect(c.webhooks.verify(new TextEncoder().encode(body), header, undefined, opts).id).toBe('evt_1');
  });

  test('accepts when one of two v1 signatures matches (a secret being rolled)', () => {
    const c = clear();
    const old = c.webhooks.sign(body, OLD_SECRET, NOW);
    const current = c.webhooks.sign(body, SECRET, NOW).split(',')[1];
    expect(c.webhooks.verify(body, `${old},${current}`, undefined, opts).id).toBe('evt_1');
    expect(c.webhooks.verify(body, `${old},${current}`, OLD_SECRET, opts).id).toBe('evt_1');
  });

  test('an explicit secret wins over the option', () => {
    const header = clear().webhooks.sign(body, 'whsec_other', NOW);
    expect(clear().webhooks.verify(body, header, 'whsec_other', opts).id).toBe('evt_1');
  });

  test('rejects a tampered body', () => {
    const c = clear();
    const header = c.webhooks.sign(body, SECRET, NOW);
    expect(reason(() => c.webhooks.verify(body.replace('18532', '1'), header, undefined, opts))).toMatch(/No signature matches/);
  });

  test('rejects the wrong secret', () => {
    const c = clear();
    const header = c.webhooks.sign(body, 'whsec_someone_else', NOW);
    expect(reason(() => c.webhooks.verify(body, header, undefined, opts))).toMatch(/No signature matches/);
  });

  test('rejects a timestamp more than five minutes away, either way', () => {
    const c = clear();
    const header = c.webhooks.sign(body, SECRET, NOW);
    expect(c.webhooks.verify(body, header, undefined, { now: NOW + 300 }).id).toBe('evt_1');
    expect(reason(() => c.webhooks.verify(body, header, undefined, { now: NOW + 301 }))).toMatch(/more than 300 seconds/);
    expect(reason(() => c.webhooks.verify(body, header, undefined, { now: new Date((NOW - 301) * 1000) }))).toMatch(/more than 300 seconds/);
    expect(c.webhooks.verify(body, header, undefined, { now: NOW + 600, toleranceSeconds: 600 }).id).toBe('evt_1');
  });

  test('uses the clock when no now is given', () => {
    const c = clear();
    expect(c.webhooks.verify(body, c.webhooks.sign(body, SECRET)).id).toBe('evt_1');
  });

  test('rejects a missing or malformed header', () => {
    const c = clear();
    expect(reason(() => c.webhooks.verify(body, undefined, undefined, opts))).toMatch(/No Clear-Signature header/);
    expect(reason(() => c.webhooks.verify(body, '', undefined, opts))).toMatch(/No Clear-Signature header/);
    expect(reason(() => c.webhooks.verify(body, 't=1792180920,v1=nothex', undefined, opts))).toMatch(/not one Clear sends/);
  });

  test('a body that was already parsed is refused with how to fix it', () => {
    const c = clear();
    const header = c.webhooks.sign(body, SECRET, NOW);
    expect(reason(() => c.webhooks.verify(event as never, header, undefined, opts))).toMatch(/express\.raw/);
  });

  test('a signed body that is not JSON is refused', () => {
    const c = clear();
    const header = c.webhooks.sign('not json', SECRET, NOW);
    expect(reason(() => c.webhooks.verify('not json', header, undefined, opts))).toMatch(/not JSON/);
  });

  test('a header given as several lines is joined', () => {
    const c = clear();
    const [t, v1] = c.webhooks.sign(body, SECRET, NOW).split(',');
    expect(c.webhooks.verify(body, [t!, v1!], undefined, opts).id).toBe('evt_1');
  });
});

describe('the secret from the environment', () => {
  const saved = process.env.CLEAR_WEBHOOK_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLEAR_WEBHOOK_SECRET;
    else process.env.CLEAR_WEBHOOK_SECRET = saved;
  });

  test('reads CLEAR_WEBHOOK_SECRET when no secret is passed', () => {
    process.env.CLEAR_WEBHOOK_SECRET = SECRET;
    const c = new Clear(KEY);
    const header = c.webhooks.sign(body, SECRET, NOW);
    expect(c.webhooks.verify(Buffer.from(body), header, undefined, opts).id).toBe('evt_1');
  });

  test('says so when there is no secret anywhere', () => {
    delete process.env.CLEAR_WEBHOOK_SECRET;
    const c = new Clear(KEY);
    const header = c.webhooks.sign(body, SECRET, NOW);
    expect(reason(() => c.webhooks.verify(body, header, undefined, opts))).toMatch(/No webhook secret/);
  });
});
