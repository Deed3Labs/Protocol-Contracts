import type {
  CreatePayment,
  CreatePaymentLink,
  CreateRefund,
  CreateWebhookEndpoint,
  Payment,
  PaymentLink,
  Price,
  Refund,
  WebhookDelivery,
  WebhookEndpoint,
} from '@clear/public-api-contracts';
import type { Http, RequestOptions } from './http';

/** A page of a list, newest first. */
export type List<T> = { object: 'list'; data: T[]; hasMore: boolean };

/** `GET /v1/payments`: by reference or dates, newest first. */
export type ListPaymentsParams = {
  reference?: string;
  /** ISO 8601, with a zone. */
  createdFrom?: string;
  createdTo?: string;
  /** 1 to 100; 20 unless you say. */
  limit?: number;
  /** A payment id from the previous page: the list continues after it. */
  startingAfter?: string;
};

const id = (value: string, what: string) => {
  if (typeof value !== 'string' || !value) throw new TypeError(`Expected a ${what} id`);
  return encodeURIComponent(value);
};

export class Payments {
  readonly #http: Http;
  constructor(http: Http) {
    this.#http = http;
  }

  /** `POST /v1/payments`. The amount is your server's, tax included; hand `clientSecret` to the page. */
  create(params: CreatePayment, options?: RequestOptions): Promise<Payment> {
    return this.#http.request('POST', '/v1/payments', { body: params, options });
  }

  retrieve(paymentId: string): Promise<Payment> {
    return this.#http.request('GET', `/v1/payments/${id(paymentId, 'payment')}`);
  }

  list(params: ListPaymentsParams = {}): Promise<List<Payment>> {
    return this.#http.request('GET', '/v1/payments', { query: { ...params } });
  }

  /** Every payment that matches, page after page: `for await (const p of clear.payments.listAll())`. */
  async *listAll(params: ListPaymentsParams = {}): AsyncGenerator<Payment, void, undefined> {
    let startingAfter = params.startingAfter;
    for (;;) {
      const page = await this.list({ ...params, startingAfter });
      yield* page.data;
      const last = page.data[page.data.length - 1];
      if (!page.hasMore || !last) return;
      startingAfter = last.id;
    }
  }

  /** `POST /v1/payments/:id/cancel`, while it's still waiting for the customer. */
  cancel(paymentId: string, options?: RequestOptions): Promise<Payment> {
    return this.#http.request('POST', `/v1/payments/${id(paymentId, 'payment')}/cancel`, { options });
  }
}

export class Prices {
  readonly #http: Http;
  constructor(http: Http) {
    this.#http = http;
  }

  /** Your Inventory items that a page can sell by id. */
  list(): Promise<List<Price>> {
    return this.#http.request('GET', '/v1/prices');
  }
}

export class PaymentLinks {
  readonly #http: Http;
  constructor(http: Http) {
    this.#http = http;
  }

  /** An amount, or a price and a quantity. Text, email or print its `url`. */
  create(params: CreatePaymentLink, options?: RequestOptions): Promise<PaymentLink> {
    return this.#http.request('POST', '/v1/payment_links', { body: params, options });
  }
}

export class Refunds {
  readonly #http: Http;
  constructor(http: Http) {
    this.#http = http;
  }

  /** With no amount, what's left of the payment. A Clear payment is refunded whole. */
  create(params: CreateRefund, options?: RequestOptions): Promise<Refund> {
    return this.#http.request('POST', '/v1/refunds', { body: params, options });
  }
}

export class WebhookEndpoints {
  readonly #http: Http;
  constructor(http: Http) {
    this.#http = http;
  }

  /** The answer carries the endpoint's `secret` (`whsec_…`) this once: keep it. */
  create(params: CreateWebhookEndpoint, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.#http.request('POST', '/v1/webhook_endpoints', { body: params, options });
  }

  list(): Promise<List<WebhookEndpoint>> {
    return this.#http.request('GET', '/v1/webhook_endpoints');
  }

  /** Turns the endpoint off; the answer is the endpoint, `status: 'disabled'`. */
  del(endpointId: string): Promise<WebhookEndpoint> {
    return this.#http.request('DELETE', `/v1/webhook_endpoints/${id(endpointId, 'webhook endpoint')}`);
  }
}

/** `GET /v1/webhook_deliveries`: one endpoint's, or one status, newest first. */
export type ListWebhookDeliveriesParams = {
  endpoint?: string;
  status?: 'pending' | 'succeeded' | 'failed';
  /** 1 to 100; 20 unless you say. */
  limit?: number;
  /** A delivery id from the previous page: the list continues after it. */
  startingAfter?: string;
};

export class WebhookDeliveries {
  readonly #http: Http;
  constructor(http: Http) {
    this.#http = http;
  }

  /** Each event sent to each endpoint: whether it got there, and the endpoint's last answer. */
  list(params: ListWebhookDeliveriesParams = {}): Promise<List<WebhookDelivery>> {
    return this.#http.request('GET', '/v1/webhook_deliveries', { query: { ...params } });
  }
}
