import { beforeEach, describe, expect, test } from 'bun:test';
import { makeConfig, type Config } from './config';
import { isBusy, start, type Env, type MessageLike, type View } from './controller';
import { plan } from './options';
import type { FetchLike } from './session';
import { fakeKey } from './testing';
import type { ClearError, PaymentResult } from './types';

const ORIGIN = 'https://pay.useclear.org';
const FRAME_URL = 'https://pay.useclear.org/m/ms_1';
const live = makeConfig(fakeKey('live')) as Config;

/** A fake page: a view that records what it was told, and an env whose fetch and messages we drive. */
function harness(opts: { fetch?: FetchLike; location?: { protocol: string; hostname: string } } = {}) {
  const log: string[] = [];
  const frameWindow = { name: 'frame' };
  let listener: ((e: MessageLike) => void) | null = null;
  let dismiss: (() => void) | null = null;
  const timers: Array<() => void> = [];
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const errors: string[] = [];
  const reported: unknown[] = [];
  let loaded = false;

  const view: View = {
    show: (d) => ((dismiss = d), log.push('show')),
    load: (url) => ((loaded = true), log.push(`load ${url}`)),
    frame: () => (loaded ? frameWindow : null),
    ready: () => log.push('ready'),
    height: (px) => log.push(`height ${px}`),
    close: () => log.push('close'),
  };
  const env: Env = {
    fetch: opts.fetch ?? (async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ id: 'ms_1', object: 'modal_session', livemode: true, url: FRAME_URL, expiresAt: '2026-10-16T20:00:00Z' }) };
    }),
    location: opts.location ?? { protocol: 'https:', hostname: 'micasatacos.com' },
    listen: (fn) => ((listener = fn), () => (listener = null)),
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: (id) => {
      if (typeof id === 'number') timers[id - 1] = () => {};
    },
    report: (e) => reported.push(e),
    error: (m) => errors.push(m),
  };
  const post = (data: unknown, origin = ORIGIN, source: unknown = frameWindow) => listener?.({ origin, source, data });
  return { log, view, env, post, requests, errors, reported, timers, dismiss: () => dismiss?.(), listening: () => listener !== null };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function callbacks() {
  const calls: { success: PaymentResult[]; cancel: number; error: ClearError[] } = { success: [], cancel: 0, error: [] };
  return {
    calls,
    cb: {
      onSuccess: (p: PaymentResult) => calls.success.push(p),
      onCancel: () => calls.cancel++,
      onError: (e: ClearError) => calls.error.push(e),
    },
  };
}

beforeEach(async () => {
  // A test that leaves a modal open would block the next; none should.
  expect(isBusy()).toBe(false);
});

describe('a click', () => {
  test('makes the session, loads the frame, and takes ready and resize', async () => {
    const h = harness();
    const { cb } = callbacks();
    expect(start(live, plan({ price: 'price_tacotray12', quantity: 1, ...cb }), () => h.view, h.env)).toBe(true);
    expect(h.log).toEqual(['show']);
    await tick();
    expect(h.requests).toHaveLength(1);
    expect(JSON.parse(h.requests[0]!.init.body as string)).toEqual({ price: 'price_tacotray12', quantity: 1 });
    expect(h.log).toEqual(['show', `load ${FRAME_URL}`]);
    h.post({ protocol: 'clear.v1', type: 'ready' });
    h.post({ protocol: 'clear.v1', type: 'resize', height: 612 });
    expect(h.log).toEqual(['show', `load ${FRAME_URL}`, 'ready', 'height 612']);
    h.post({ protocol: 'clear.v1', type: 'cancel' });
  });

  test('success passes exactly { id, status, reference } and closes', async () => {
    const h = harness();
    const { calls, cb } = callbacks();
    start(live, plan({ payment: 'pay_1_secret_x' }, cb), () => h.view, h.env);
    await tick();
    h.post({ protocol: 'clear.v1', type: 'success', id: 'pay_8f2k', status: 'succeeded', reference: 'catering-1042' });
    expect(calls.success).toHaveLength(1);
    expect(calls.success[0]).toStrictEqual({ id: 'pay_8f2k', status: 'succeeded', reference: 'catering-1042' });
    expect(Object.keys(calls.success[0]!)).toEqual(['id', 'status', 'reference']);
    expect(h.log.at(-1)).toBe('close');
    expect(isBusy()).toBe(false);
    expect(h.listening()).toBe(false);
    // A second success after closing is never heard.
    h.post({ protocol: 'clear.v1', type: 'success', id: 'pay_8f2k', status: 'succeeded', reference: null });
    expect(calls.success).toHaveLength(1);
  });

  test('a success carrying anything else is ignored, and the modal stays open', async () => {
    const h = harness();
    const { calls, cb } = callbacks();
    start(live, plan({ payment: 'pay_1_secret_x' }, cb), () => h.view, h.env);
    await tick();
    h.post({ protocol: 'clear.v1', type: 'success', id: 'pay_8f2k', status: 'succeeded', reference: null, phone: '9095550142' });
    expect(calls.success).toHaveLength(0);
    expect(h.log).not.toContain('close');
    h.post({ protocol: 'clear.v1', type: 'cancel' });
  });

  test('messages from another origin or another window are ignored', async () => {
    const h = harness();
    const { calls, cb } = callbacks();
    start(live, plan({ price: 'price_x' }, cb), () => h.view, h.env);
    await tick();
    const ok = { protocol: 'clear.v1', type: 'success', id: 'pay_8f2k', status: 'succeeded', reference: null };
    h.post(ok, 'https://micasatacos.com');
    h.post(ok, ORIGIN, { name: 'another frame' });
    h.post({ protocol: 'clear.v1', type: 'teleport' });
    h.post({ protocol: 'clear.v1', type: 'cancel' }, 'https://evil.example');
    expect(calls).toEqual({ success: [], cancel: 0, error: [] });
    expect(h.log).not.toContain('close');
    h.post(ok);
    expect(calls.success).toHaveLength(1);
  });

  test('cancel closes and calls onCancel', async () => {
    const h = harness();
    const { calls, cb } = callbacks();
    start(live, plan({ price: 'price_x' }, cb), () => h.view, h.env);
    await tick();
    h.post({ protocol: 'clear.v1', type: 'cancel' });
    expect(calls.cancel).toBe(1);
    expect(h.log.at(-1)).toBe('close');
  });

  test('Esc or the scrim (dismiss) closes and calls onCancel, even while loading', async () => {
    const h = harness();
    const { calls, cb } = callbacks();
    start(live, plan({ price: 'price_x' }, cb), () => h.view, h.env);
    h.dismiss();
    expect(calls.cancel).toBe(1);
    expect(isBusy()).toBe(false);
    await tick();
    // The session answered after the close: no frame is loaded.
    expect(h.log).toEqual(['show', 'close']);
  });

  test('error: onError; closes on session_expired and origin_not_allowed only', async () => {
    for (const [code, closes] of [['unavailable', false], ['session_expired', true], ['origin_not_allowed', true]] as const) {
      const h = harness();
      const { calls, cb } = callbacks();
      start(live, plan({ price: 'price_x' }, cb), () => h.view, h.env);
      await tick();
      h.post({ protocol: 'clear.v1', type: 'error', code, message: 'm' });
      expect(calls.error).toEqual([{ code, message: 'm' }]);
      expect(h.log.includes('close')).toBe(closes);
      if (!closes) h.post({ protocol: 'clear.v1', type: 'cancel' });
    }
  });
});

describe('one modal at a time', () => {
  test('a second click while open does nothing', async () => {
    const h = harness();
    const second = harness();
    start(live, plan({ price: 'price_x' }), () => h.view, h.env);
    expect(start(live, plan({ price: 'price_y' }), () => second.view, second.env)).toBe(false);
    await tick();
    expect(second.log).toEqual([]);
    expect(second.requests).toEqual([]);
    h.post({ protocol: 'clear.v1', type: 'cancel' });
    expect(start(live, plan({ price: 'price_y' }), () => second.view, second.env)).toBe(true);
    await tick();
    second.post({ protocol: 'clear.v1', type: 'cancel' });
  });
});

describe('failures go to onError, never thrown', () => {
  test('an http page: refused before any request', async () => {
    const h = harness({ location: { protocol: 'http:', hostname: 'micasatacos.com' } });
    const { calls, cb } = callbacks();
    expect(() => start(live, plan({ price: 'price_x' }, cb), () => h.view, h.env)).not.toThrow();
    await tick();
    expect(calls.error[0]!.code).toBe('insecure_page');
    expect(h.errors[0]).toContain('https');
    expect(h.requests).toEqual([]);
    expect(h.log).toEqual([]);
  });

  test('localhost over http with a live key: refused', async () => {
    const h = harness({ location: { protocol: 'http:', hostname: 'localhost' } });
    const { calls, cb } = callbacks();
    start(live, plan({ price: 'price_x' }, cb), () => h.view, h.env);
    expect(calls.error[0]!.message).toContain('test key');
  });

  test('bad options', () => {
    const h = harness();
    const { calls, cb } = callbacks();
    start(live, plan({ amount: 18532 }, cb), () => h.view, h.env);
    expect(calls.error[0]!.code).toBe('invalid_options');
    expect(h.log).toEqual([]);
  });

  test("the API's error, e.g. a site that isn't allowed", async () => {
    const h = harness({
      fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: { type: 'permission', code: 'origin_not_allowed', message: "This website isn't one of the shop's." } }) }),
    });
    const { calls, cb } = callbacks();
    start(live, plan({ price: 'price_x' }, cb), () => h.view, h.env);
    await tick();
    expect(calls.error).toEqual([{ code: 'origin_not_allowed', message: "This website isn't one of the shop's." }]);
    expect(h.log).toEqual(['show', 'close']);
    expect(isBusy()).toBe(false);
  });

  test('a session url off the pay origin: refused, no frame', async () => {
    const h = harness({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ object: 'modal_session', livemode: true, url: 'https://evil.example/m/ms_1' }) }) });
    const { calls, cb } = callbacks();
    start(live, plan({ price: 'price_x' }, cb), () => h.view, h.env);
    await tick();
    expect(calls.error[0]!.code).toBe('invalid_response');
    expect(h.log).toEqual(['show', 'close']);
  });

  test("the frame never says ready: unavailable after the wait", async () => {
    const h = harness();
    const { calls, cb } = callbacks();
    start(live, plan({ price: 'price_x' }, cb), () => h.view, h.env);
    await tick();
    h.timers[0]!();
    expect(calls.error[0]!.code).toBe('unavailable');
    expect(h.log.at(-1)).toBe('close');
  });

  test("a callback that throws is reported, and the modal still closes", async () => {
    const h = harness();
    start(live, plan({ price: 'price_x', onSuccess: () => { throw new Error('shop bug'); } }), () => h.view, h.env);
    await tick();
    h.post({ protocol: 'clear.v1', type: 'success', id: 'pay_1', status: 'processing', reference: null });
    expect((h.reported[0] as Error).message).toBe('shop bug');
    expect(h.log.at(-1)).toBe('close');
  });
});
