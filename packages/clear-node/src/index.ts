/**
 * @useclear/node: Pay with Clear for your server.
 *
 *   import Clear from "@useclear/node";
 *   const clear = new Clear(process.env.CLEAR_SECRET_KEY);
 *   const payment = await clear.payments.create({ amount: 18532, currency: "usd" }, { idempotencyKey: "order-1" });
 */
import { LATEST_VERSION } from '@clear/public-api-contracts';
import { ClearError } from './errors';
import { Http } from './http';
import { PaymentLinks, Payments, Prices, Refunds, WebhookEndpoints } from './resources';
import { Webhooks } from './webhooks';

export type ClearOptions = {
  /** `https://api.useclear.org`, or `CLEAR_API_URL` when it's set. */
  baseUrl?: string;
  /** The webhook endpoint's `whsec_…` secret for `webhooks.verify`. Else `CLEAR_WEBHOOK_SECRET`. */
  webhookSecret?: string;
  /** The `Clear-Version` to send. The version this SDK was built for unless you say. */
  version?: string;
  /** Your own fetch (a proxy, a test double). The global one unless you say. */
  fetch?: typeof fetch;
  /** Per try. 30 seconds unless you say. */
  timeoutMs?: number;
  /** Tries after the first, for network errors, 429 and 5xx. 2 unless you say. */
  maxRetries?: number;
};

const DEFAULT_BASE_URL = 'https://api.useclear.org';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const SECRET_KEY = /^sk_(test|live)_[A-Za-z0-9]+$/;

const env = (name: string): string | undefined => (typeof process === 'undefined' ? undefined : process.env[name]) || undefined;

function checkKey(key: unknown): string {
  if (typeof key !== 'string' || !key.trim()) {
    throw new ClearError({
      type: 'authentication',
      code: 'key_missing',
      message: 'No secret key. Pass yours: new Clear(process.env.CLEAR_SECRET_KEY), with sk_test_… or sk_live_… from Developers in the merchant app.',
    });
  }
  const k = key.trim();
  if (k.startsWith('pk_')) {
    throw new ClearError({
      type: 'permission',
      code: 'publishable_key_not_allowed',
      message: 'That is a publishable key (pk_…). It belongs in the browser, with the Clear script; your server uses the secret key (sk_test_… or sk_live_…).',
    });
  }
  if (!SECRET_KEY.test(k)) {
    throw new ClearError({ type: 'authentication', code: 'key_invalid', message: 'That is not a Clear secret key. It starts sk_test_ or sk_live_.' });
  }
  return k;
}

export default class Clear {
  readonly payments: Payments;
  readonly prices: Prices;
  readonly paymentLinks: PaymentLinks;
  readonly refunds: Refunds;
  readonly webhookEndpoints: WebhookEndpoints;
  readonly webhooks: Webhooks;
  /** Whether the key is a live one. Test keys only ever see test payments, and the other way round. */
  readonly livemode: boolean;

  /** `secretKey` may be undefined only so `process.env.CLEAR_SECRET_KEY` type-checks; a missing key throws. */
  constructor(secretKey: string | undefined, options: ClearOptions = {}) {
    const key = checkKey(secretKey);
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('No fetch here. Use Node 18 or later, or pass options.fetch.');
    const http = new Http({
      secretKey: key,
      baseUrl: options.baseUrl ?? env('CLEAR_API_URL') ?? DEFAULT_BASE_URL,
      version: options.version ?? LATEST_VERSION,
      fetch: fetchImpl,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES),
    });
    this.livemode = key.startsWith('sk_live_');
    this.payments = new Payments(http);
    this.prices = new Prices(http);
    this.paymentLinks = new PaymentLinks(http);
    this.refunds = new Refunds(http);
    this.webhookEndpoints = new WebhookEndpoints(http);
    this.webhooks = new Webhooks(() => options.webhookSecret ?? env('CLEAR_WEBHOOK_SECRET'));
  }
}

export { Clear };
export { ClearError, ClearSignatureError, type ClearErrorCode } from './errors';
export type { RequestOptions } from './http';
export type { List, ListPaymentsParams, Payments, Prices, PaymentLinks, Refunds, WebhookEndpoints } from './resources';
export type { RawBody, VerifyOptions, Webhooks } from './webhooks';
export type {
  ApiError,
  CreatePayment,
  CreatePaymentLink,
  CreateRefund,
  CreateWebhookEndpoint,
  ErrorCode,
  ErrorType,
  Event,
  EventType,
  Payment,
  PaymentEventObject,
  PaymentLine,
  PaymentLink,
  PaymentMethod,
  PaymentStatus,
  Price,
  Refund,
  RefundStatus,
  WebhookEndpoint,
} from '@clear/public-api-contracts';
