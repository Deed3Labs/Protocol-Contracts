/**
 * The routes of `/v1`, beside the objects they take and give: what `docs/api.md` is generated from
 * (`@clear/pay-docs`), and what the API's tests check its router against, so neither can drift. The
 * method-and-path strings are published (`PUBLISHED_LISTS.endpoints`): one can be added, never removed.
 */

export interface Endpoint {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  /** Which key: the secret key (server only), or either. */
  key: 'secret' | 'publishable' | 'either';
  /** The request's schema in `PUBLISHED_SCHEMAS.requests` (a body, or the query for a GET). */
  request?: string;
  /** The answer's schema in `PUBLISHED_SCHEMAS.responses`, or `list of X`. */
  response: string;
  /** Takes `Idempotency-Key` (required). */
  idempotent?: boolean;
  summary: string;
}

export const ENDPOINTS: readonly Endpoint[] = [
  {
    method: 'POST',
    path: '/v1/payments',
    key: 'secret',
    request: 'CreatePayment',
    response: 'Payment',
    idempotent: true,
    summary: 'Make a payment for an amount your server worked out. Hand the page its `clientSecret`.',
  },
  { method: 'GET', path: '/v1/payments', key: 'secret', request: 'ListPayments', response: 'list of Payment', summary: 'Payments, newest first: by `reference`, or in a time range.' },
  { method: 'GET', path: '/v1/payments/:id', key: 'secret', response: 'Payment', summary: 'One payment.' },
  { method: 'POST', path: '/v1/payments/:id/cancel', key: 'secret', response: 'Payment', summary: 'Cancel a payment nobody has paid yet.' },
  { method: 'GET', path: '/v1/prices', key: 'either', response: 'list of Price', summary: 'The prices made in the merchant app, for `Clear(key).attach(…, { price })` with no server.' },
  { method: 'POST', path: '/v1/payment_links', key: 'secret', request: 'CreatePaymentLink', response: 'PaymentLink', summary: 'A payment link (`pay.useclear.org/l/…`), for an amount or a price. No website needed.' },
  {
    method: 'POST',
    path: '/v1/refunds',
    key: 'secret',
    request: 'CreateRefund',
    response: 'Refund',
    idempotent: true,
    summary:
      'Refund a card payment, in part or in full. With `requireApproval`, it waits for an owner or manager in the merchant app. A Clear payment is refunded from Charges in the merchant app (`refund_in_app`).',
  },
  { method: 'POST', path: '/v1/webhook_endpoints', key: 'secret', request: 'CreateWebhookEndpoint', response: 'WebhookEndpoint', summary: 'Where Clear sends events. The answer carries the signing secret, once.' },
  { method: 'GET', path: '/v1/webhook_endpoints', key: 'secret', response: 'list of WebhookEndpoint', summary: 'Your webhook endpoints, in this key’s mode.' },
  { method: 'DELETE', path: '/v1/webhook_endpoints/:id', key: 'secret', response: 'WebhookEndpoint', summary: 'Turn an endpoint off for good. What it was sent stays in the log.' },
  {
    method: 'GET',
    path: '/v1/webhook_deliveries',
    key: 'secret',
    request: 'ListWebhookDeliveries',
    response: 'list of WebhookDelivery',
    summary: 'Each event sent to each endpoint: whether it got there, and the endpoint’s last answer. Newest first.',
  },
  {
    method: 'POST',
    path: '/v1/modal_sessions',
    key: 'publishable',
    request: 'CreateModalSession',
    response: 'ModalSession',
    summary: 'What `@useclear/js` calls from the page to open the modal. Only from a website on your list in Developers.',
  },
];

/** "POST /v1/payments", … : the published list. */
export const ENDPOINT_LIST = ENDPOINTS.map((e) => `${e.method} ${e.path}`);
