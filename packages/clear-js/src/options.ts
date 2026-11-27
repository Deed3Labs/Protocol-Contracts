import { MODAL_OPTIONS, PRICE_ID } from './constants';
import type { Callbacks } from './types';

export type SessionBody = Record<string, unknown>;

export interface Plan {
  /** Exactly what `POST /v1/modal_sessions` gets: the target and the options the API takes. */
  body: SessionBody;
  callbacks: Callbacks;
  /** Why the options are wrong; a click then goes straight to `onError`. */
  problem?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `attach(target, { price, quantity, …options, onSuccess })` and `attach(target, { price, quantity },
 * { …options, onSuccess })` are the same: the two objects are merged, the second winning. Returns the
 * request body and the callbacks, or why they're wrong.
 */
export function plan(first: unknown, second?: unknown): Plan {
  const all: Record<string, unknown> = { ...(isObject(first) ? first : {}), ...(isObject(second) ? second : {}) };
  const callbacks: Callbacks = {};
  for (const name of ['onSuccess', 'onCancel', 'onError'] as const) {
    if (typeof all[name] === 'function') callbacks[name] = all[name] as never;
  }
  const body = target(all, first, second);
  return typeof body === 'string' ? { body: {}, callbacks, problem: body } : { body, callbacks };
}

function target(all: Record<string, unknown>, first: unknown, second: unknown): SessionBody | string {
  if (!isObject(first)) return 'attach needs what to pay for: { price: "price_…" } or { payment: clientSecret }.';
  if (second != null && !isObject(second)) return "attach's third argument must be an object of options.";
  for (const name of ['onSuccess', 'onCancel', 'onError'] as const) {
    if (all[name] != null && typeof all[name] !== 'function') return `${name} must be a function.`;
  }

  const hasPrice = all.price != null;
  const hasPayment = all.payment != null;
  if (hasPrice === hasPayment) {
    return hasPrice
      ? 'Pass a price or a payment, not both.'
      : 'attach needs what to pay for: { price: "price_…" } or { payment: clientSecret }. The amount never comes from the page.';
  }

  const body: SessionBody = {};
  if (hasPrice) {
    if (typeof all.price !== 'string' || !PRICE_ID.test(all.price)) return 'price must be a price id from the merchant app, like "price_tacotray12".';
    body.price = all.price;
    if (all.quantity != null) {
      const q = all.quantity;
      if (typeof q !== 'number' || !Number.isInteger(q) || q < 1) return 'quantity must be a whole number, 1 or more.';
      body.quantity = q;
    }
  } else {
    if (typeof all.payment !== 'string' || !all.payment) return "payment must be the payment's clientSecret, from your server.";
    if (all.quantity != null) return 'quantity goes with a price. A payment from your server already has its lines.';
    body.payment = all.payment;
  }
  for (const name of MODAL_OPTIONS) if (all[name] != null) body[name] = all[name];
  return body;
}

/** Options the script drops, so the console can say so. `amount` gets its own sentence. */
export function ignoredOptions(first: unknown, second?: unknown): string[] {
  const known = new Set<string>(['price', 'quantity', 'payment', 'onSuccess', 'onCancel', 'onError', ...MODAL_OPTIONS]);
  const keys = [first, second].flatMap((o) => (isObject(o) ? Object.keys(o) : []));
  return [...new Set(keys.filter((k) => !known.has(k)))];
}
