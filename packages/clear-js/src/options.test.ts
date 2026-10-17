import { describe, expect, test } from 'bun:test';
import { ignoredOptions, plan } from './options';

const onSuccess = () => {};
const onCancel = () => {};
const onError = () => {};

describe('one object or two', () => {
  test('the snippet: target, options and callbacks in one object', () => {
    const p = plan({ price: 'price_tacotray12', quantity: 1, onSuccess });
    expect(p.problem).toBeUndefined();
    expect(p.body).toEqual({ price: 'price_tacotray12', quantity: 1 });
    expect(p.callbacks.onSuccess).toBe(onSuccess);
  });

  test("the prompt's form: the target, then options and callbacks", () => {
    const opts = { accent: '#B4532A', logo: 'https://micasatacos.com/logo.png', locale: 'es-US', methods: ['clear'], email: 'sofia@example.com', onSuccess, onCancel, onError };
    const one = plan({ price: 'price_tacotray12', quantity: 2, ...opts });
    const two = plan({ price: 'price_tacotray12', quantity: 2 }, opts);
    expect(two).toEqual(one);
    expect(two.body).toEqual({ price: 'price_tacotray12', quantity: 2, accent: '#B4532A', logo: 'https://micasatacos.com/logo.png', locale: 'es-US', methods: ['clear'], email: 'sofia@example.com' });
    expect(two.callbacks).toEqual({ onSuccess, onCancel, onError });
  });

  test('a payment from the server', () => {
    const p = plan({ payment: 'pay_123_secret_abc' });
    expect(p.body).toEqual({ payment: 'pay_123_secret_abc' });
    expect(plan({ payment: 'pay_123_secret_abc' }, { email: 'a@b.co' }).body).toEqual({ payment: 'pay_123_secret_abc', email: 'a@b.co' });
  });

  test('a quantity is only sent when given (the API defaults it to 1)', () => {
    expect(plan({ price: 'price_x' }).body).toEqual({ price: 'price_x' });
  });
});

describe('the request body', () => {
  test('never carries an amount, or anything the API does not take', () => {
    const p = plan({ price: 'price_x', amount: 1, currency: 'usd', phone: '9095550142', name: 'Sofia', onSuccess }, { amount: 18532, lines: [], metadata: {} });
    expect(p.problem).toBeUndefined();
    expect(Object.keys(p.body).sort()).toEqual(['price']);
    expect(JSON.stringify(p.body)).not.toContain('amount');
    expect(ignoredOptions({ price: 'price_x', amount: 1, phone: 'x' }, { amount: 2, lines: [] })).toEqual(['amount', 'phone', 'lines']);
  });

  test('every key it can carry is allowed', () => {
    const allowed = new Set(['price', 'quantity', 'payment', 'accent', 'logo', 'locale', 'methods', 'email']);
    const p = plan({ price: 'price_x', quantity: 3, accent: '#000000', logo: 'https://x.co/l.png', locale: 'en', methods: ['card'], email: 'a@b.co', x: 1 });
    for (const k of Object.keys(p.body)) expect(allowed.has(k)).toBe(true);
  });

  test('callbacks never go in the body', () => {
    const p = plan({ price: 'price_x' }, { onSuccess, onCancel, onError });
    expect(Object.keys(p.body)).toEqual(['price']);
  });
});

describe('problems', () => {
  test('nothing to pay for, or both', () => {
    expect(plan({}).problem).toContain('price');
    expect(plan(undefined).problem).toContain('price');
    expect(plan({ onSuccess }).problem).toContain('amount never comes from the page');
    expect(plan({ price: 'price_x', payment: 'pay_1_secret' }).problem).toContain('not both');
  });

  test('a bad price, quantity or payment', () => {
    expect(plan({ price: 'tacotray12' }).problem).toContain('price id');
    expect(plan({ price: 'price_x', quantity: 0 }).problem).toContain('quantity');
    expect(plan({ price: 'price_x', quantity: 1.5 }).problem).toContain('quantity');
    expect(plan({ price: 'price_x', quantity: '2' }).problem).toContain('quantity');
    expect(plan({ payment: '' }).problem).toContain('clientSecret');
    expect(plan({ payment: 'pay_1', quantity: 2 }).problem).toContain('quantity goes with a price');
  });

  test('callbacks are kept even when the target is wrong, so onError hears about it', () => {
    const p = plan({ onError }, {});
    expect(p.problem).toBeTruthy();
    expect(p.callbacks.onError).toBe(onError);
    expect(plan({ price: 'price_x' }, { onError }).callbacks.onError).toBe(onError);
  });

  test('a callback that is not a function, or a third argument that is not an object', () => {
    expect(plan({ price: 'price_x', onSuccess: 'go' }).problem).toContain('onSuccess');
    expect(plan({ price: 'price_x' }, 'x').problem).toContain('third argument');
  });
});
