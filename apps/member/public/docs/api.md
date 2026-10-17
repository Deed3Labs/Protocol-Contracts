# Pay with Clear: API reference

Generated from `@clear/public-api-contracts` for version `2026-10-16`. Base URL `https://api.useclear.org`.

## Every request

- `Authorization: Bearer <key>`. The secret key (`clear_sk_…`) from a server; the publishable key (`clear_pk_…`) only where a route says so.
- `Clear-Version: 2026-10-16`. Without it, the key's pinned version is used, and said in the answer. An unknown version is refused.
- `Idempotency-Key` on the routes marked so: the same key and body give the same answer; the same key with another body is refused.
- Bodies are JSON. Amounts are integer cents in `usd`. Times are ISO 8601. Lists are newest first: `{ object: "list", data, hasMore }`, continued with `startingAfter`.
- A test key sees only test objects, and a live key only live ones.

## Routes

| Route | Key | Request | Answer |
|---|---|---|---|
| `POST /v1/payments` | secret, with `Idempotency-Key` | [CreatePayment](#createpayment) | Payment |
| `GET /v1/payments` | secret | [ListPayments](#listpayments) | list of Payment |
| `GET /v1/payments/:id` | secret | - | Payment |
| `POST /v1/payments/:id/cancel` | secret | - | Payment |
| `GET /v1/prices` | either | - | list of Price |
| `POST /v1/payment_links` | secret | [CreatePaymentLink](#createpaymentlink) | PaymentLink |
| `POST /v1/refunds` | secret, with `Idempotency-Key` | [CreateRefund](#createrefund) | Refund |
| `POST /v1/webhook_endpoints` | secret | [CreateWebhookEndpoint](#createwebhookendpoint) | WebhookEndpoint |
| `GET /v1/webhook_endpoints` | secret | - | list of WebhookEndpoint |
| `DELETE /v1/webhook_endpoints/:id` | secret | - | WebhookEndpoint |
| `GET /v1/webhook_deliveries` | secret | [ListWebhookDeliveries](#listwebhookdeliveries) | list of WebhookDelivery |
| `POST /v1/modal_sessions` | publishable | [CreateModalSession](#createmodalsession) | ModalSession |

### `POST /v1/payments`

Make a payment for an amount your server worked out. Hand the page its `clientSecret`.

### `GET /v1/payments`

Payments, newest first: by `reference`, or in a time range.

### `GET /v1/payments/:id`

One payment.

### `POST /v1/payments/:id/cancel`

Cancel a payment nobody has paid yet.

### `GET /v1/prices`

The prices made in the merchant app, for `Clear(key).attach(…, { price })` with no server.

### `POST /v1/payment_links`

A payment link (`pay.useclear.org/l/…`), for an amount or a price. No website needed.

### `POST /v1/refunds`

Refund a card payment, in part or in full. With `requireApproval`, it waits for an owner or manager in the merchant app. A Clear payment is refunded from Charges in the merchant app (`refund_in_app`).

### `POST /v1/webhook_endpoints`

Where Clear sends events. The answer carries the signing secret, once.

### `GET /v1/webhook_endpoints`

Your webhook endpoints, in this key’s mode.

### `DELETE /v1/webhook_endpoints/:id`

Turn an endpoint off for good. What it was sent stays in the log.

### `GET /v1/webhook_deliveries`

Each event sent to each endpoint: whether it got there, and the endpoint’s last answer. Newest first.

### `POST /v1/modal_sessions`

What `@useclear/js` calls from the page to open the modal. Only from a website on your list in Developers.

## Requests

### CreatePayment

| Field | Type | Required | Notes |
|---|---|---|---|
| `amount` | integer, at least -9007199254740991 | yes |  |
| `currency` | `usd` | yes |  |
| `reference` | string, 1 to 100 characters | no |  |
| `lines` | list of object (at least 1) | no |  |
| `lines[].name` | string, 1 to 80 characters | yes |  |
| `lines[].amount` | integer, at least 1 | yes |  |
| `lines[].quantity` | integer, 1 to 999 | no | default `1` |
| `methods` | list of one of `clear`, `card` (at least 1) | no | default `["clear","card"]` |
| `metadata` | object | no |  |

### ListPayments

| Field | Type | Required | Notes |
|---|---|---|---|
| `reference` | string, 1 to 100 characters | no |  |
| `createdFrom` | timestamp (ISO 8601, with a zone) | no |  |
| `createdTo` | timestamp (ISO 8601, with a zone) | no |  |
| `limit` | integer, 1 to 100 | no | default `20` |
| `startingAfter` | id (`pay_…`) | no |  |

### CreatePaymentLink

Either:

| Field | Type | Required | Notes |
|---|---|---|---|
| `amount` | integer, at least 50 | yes |  |
| `note` | string, 1 to 200 characters | no |  |
| `expiresAt` | timestamp (ISO 8601, with a zone) | no |  |
| `allowOverTime` | boolean | no | default `false` |

Or:

| Field | Type | Required | Notes |
|---|---|---|---|
| `price` | id (`price_…`) | yes |  |
| `quantity` | integer, 1 to 99 | no | default `1` |
| `note` | string, 1 to 200 characters | no |  |
| `expiresAt` | timestamp (ISO 8601, with a zone) | no |  |
| `allowOverTime` | boolean | no | default `false` |

### CreateRefund

| Field | Type | Required | Notes |
|---|---|---|---|
| `payment` | id (`pay_…`) | yes |  |
| `amount` | integer, at least 1 | no |  |
| `reason` | string, 1 to 200 characters | no |  |
| `requireApproval` | boolean | no | default `false` |

### CreateWebhookEndpoint

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | URL | yes |  |
| `events` | list of one of `payment.succeeded`, `payment.failed`, `payment.canceled`, `refund.succeeded` (at least 1) | yes |  |

### CreateModalSession

Either:

| Field | Type | Required | Notes |
|---|---|---|---|
| `price` | id (`price_…`) | yes |  |
| `quantity` | integer, 1 to 99 | no | default `1` |
| `accent` | string | no |  |
| `logo` | URL | no |  |
| `locale` | string, 2 to 35 characters | no |  |
| `methods` | list of one of `clear`, `card` (at least 1) | no |  |
| `email` | string, up to 254 characters | no |  |

Or:

| Field | Type | Required | Notes |
|---|---|---|---|
| `payment` | string, 1 to 200 characters | yes |  |
| `accent` | string | no |  |
| `logo` | URL | no |  |
| `locale` | string, 2 to 35 characters | no |  |
| `methods` | list of one of `clear`, `card` (at least 1) | no |  |
| `email` | string, up to 254 characters | no |  |

### ListWebhookDeliveries

| Field | Type | Required | Notes |
|---|---|---|---|
| `endpoint` | id (`we_…`) | no |  |
| `status` | one of `pending`, `succeeded`, `failed` | no |  |
| `limit` | integer, 1 to 100 | no | default `20` |
| `startingAfter` | id (`whd_…`) | no |  |

## Objects

### Payment

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | id (`pay_…`) | yes |  |
| `object` | `payment` | yes |  |
| `livemode` | boolean | yes |  |
| `amount` | integer, at least 1 | yes |  |
| `currency` | `usd` | yes |  |
| `lines` | list of object | yes |  |
| `lines[].name` | string, 1 to 80 characters | yes |  |
| `lines[].amount` | integer, at least 1 | yes |  |
| `lines[].quantity` | integer, 1 to 999 | yes |  |
| `reference` | string, 1 to 100 characters, or null | yes |  |
| `methods` | list of one of `clear`, `card` (at least 1) | yes |  |
| `status` | one of `requires_customer`, `processing`, `succeeded`, `failed`, `canceled` | yes |  |
| `method` | one of `clear`, `card`, or null | yes |  |
| `amountRefunded` | integer, at least 0 | yes |  |
| `clientSecret` | string | no |  |
| `createdAt` | timestamp (ISO 8601, with a zone) | yes |  |
| `succeededAt` | timestamp (ISO 8601, with a zone), or null | yes |  |
| `metadata` | object | yes |  |

### Price

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | id (`price_…`) | yes |  |
| `object` | `price` | yes |  |
| `name` | string | yes |  |
| `amount` | integer, at least 1 | yes |  |
| `active` | boolean | yes |  |
| `allowQuantity` | boolean | yes |  |

### PaymentLink

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | id (`plink_…`) | yes |  |
| `object` | `payment_link` | yes |  |
| `livemode` | boolean | yes |  |
| `url` | URL | yes |  |
| `slug` | string | yes |  |
| `amount` | integer, at least 1, or null | yes |  |
| `price` | id (`price_…`), or null | yes |  |
| `quantity` | integer, 1 to 99, or null | yes |  |
| `note` | string, 1 to 200 characters, or null | yes |  |
| `expiresAt` | timestamp (ISO 8601, with a zone), or null | yes |  |
| `allowOverTime` | boolean | yes |  |
| `active` | boolean | yes |  |
| `createdAt` | timestamp (ISO 8601, with a zone) | yes |  |

### Refund

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | id (`re_…`) | yes |  |
| `object` | `refund` | yes |  |
| `livemode` | boolean | yes |  |
| `payment` | id (`pay_…`) | yes |  |
| `amount` | integer, at least 1 | yes |  |
| `status` | one of `pending_approval`, `pending`, `succeeded`, `failed`, `canceled` | yes |  |
| `reason` | string, 1 to 200 characters, or null | yes |  |
| `createdAt` | timestamp (ISO 8601, with a zone) | yes |  |

### WebhookEndpoint

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | id (`we_…`) | yes |  |
| `object` | `webhook_endpoint` | yes |  |
| `livemode` | boolean | yes |  |
| `url` | URL | yes |  |
| `events` | list of one of `payment.succeeded`, `payment.failed`, `payment.canceled`, `refund.succeeded` (at least 1) | yes |  |
| `status` | one of `enabled`, `disabled` | yes |  |
| `secret` | string | no |  |
| `createdAt` | timestamp (ISO 8601, with a zone) | yes |  |

### Event

A webhook's body. `type` is one of `payment.succeeded`, `payment.failed`, `payment.canceled`, `refund.succeeded`; `data` is the payment (or for a refund event, the refund).

Either:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | id (`evt_…`) | yes |  |
| `object` | `event` | yes |  |
| `createdAt` | timestamp (ISO 8601, with a zone) | yes |  |
| `livemode` | boolean | yes |  |
| `apiVersion` | one of `2026-10-16` | yes |  |
| `type` | `payment.succeeded` | yes |  |
| `data` | object | yes |  |
| `data.id` | id (`pay_…`) | yes |  |
| `data.object` | `payment` | yes |  |
| `data.livemode` | boolean | yes |  |
| `data.amount` | integer, at least 1 | yes |  |
| `data.currency` | `usd` | yes |  |
| `data.lines` | list of object | yes |  |
| `data.lines[].name` | string, 1 to 80 characters | yes |  |
| `data.lines[].amount` | integer, at least 1 | yes |  |
| `data.lines[].quantity` | integer, 1 to 999 | yes |  |
| `data.reference` | string, 1 to 100 characters, or null | yes |  |
| `data.methods` | list of one of `clear`, `card` (at least 1) | yes |  |
| `data.status` | one of `requires_customer`, `processing`, `succeeded`, `failed`, `canceled` | yes |  |
| `data.method` | one of `clear`, `card`, or null | yes |  |
| `data.amountRefunded` | integer, at least 0 | yes |  |
| `data.createdAt` | timestamp (ISO 8601, with a zone) | yes |  |
| `data.succeededAt` | timestamp (ISO 8601, with a zone), or null | yes |  |
| `data.metadata` | object | yes |  |

Or:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | id (`evt_…`) | yes |  |
| `object` | `event` | yes |  |
| `createdAt` | timestamp (ISO 8601, with a zone) | yes |  |
| `livemode` | boolean | yes |  |
| `apiVersion` | one of `2026-10-16` | yes |  |
| `type` | `payment.failed` | yes |  |
| `data` | object | yes |  |
| `data.id` | id (`pay_…`) | yes |  |
| `data.object` | `payment` | yes |  |
| `data.livemode` | boolean | yes |  |
| `data.amount` | integer, at least 1 | yes |  |
| `data.currency` | `usd` | yes |  |
| `data.lines` | list of object | yes |  |
| `data.lines[].name` | string, 1 to 80 characters | yes |  |
| `data.lines[].amount` | integer, at least 1 | yes |  |
| `data.lines[].quantity` | integer, 1 to 999 | yes |  |
| `data.reference` | string, 1 to 100 characters, or null | yes |  |
| `data.methods` | list of one of `clear`, `card` (at least 1) | yes |  |
| `data.status` | one of `requires_customer`, `processing`, `succeeded`, `failed`, `canceled` | yes |  |
| `data.method` | one of `clear`, `card`, or null | yes |  |
| `data.amountRefunded` | integer, at least 0 | yes |  |
| `data.createdAt` | timestamp (ISO 8601, with a zone) | yes |  |
| `data.succeededAt` | timestamp (ISO 8601, with a zone), or null | yes |  |
| `data.metadata` | object | yes |  |

Or:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | id (`evt_…`) | yes |  |
| `object` | `event` | yes |  |
| `createdAt` | timestamp (ISO 8601, with a zone) | yes |  |
| `livemode` | boolean | yes |  |
| `apiVersion` | one of `2026-10-16` | yes |  |
| `type` | `payment.canceled` | yes |  |
| `data` | object | yes |  |
| `data.id` | id (`pay_…`) | yes |  |
| `data.object` | `payment` | yes |  |
| `data.livemode` | boolean | yes |  |
| `data.amount` | integer, at least 1 | yes |  |
| `data.currency` | `usd` | yes |  |
| `data.lines` | list of object | yes |  |
| `data.lines[].name` | string, 1 to 80 characters | yes |  |
| `data.lines[].amount` | integer, at least 1 | yes |  |
| `data.lines[].quantity` | integer, 1 to 999 | yes |  |
| `data.reference` | string, 1 to 100 characters, or null | yes |  |
| `data.methods` | list of one of `clear`, `card` (at least 1) | yes |  |
| `data.status` | one of `requires_customer`, `processing`, `succeeded`, `failed`, `canceled` | yes |  |
| `data.method` | one of `clear`, `card`, or null | yes |  |
| `data.amountRefunded` | integer, at least 0 | yes |  |
| `data.createdAt` | timestamp (ISO 8601, with a zone) | yes |  |
| `data.succeededAt` | timestamp (ISO 8601, with a zone), or null | yes |  |
| `data.metadata` | object | yes |  |

Or:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | id (`evt_…`) | yes |  |
| `object` | `event` | yes |  |
| `createdAt` | timestamp (ISO 8601, with a zone) | yes |  |
| `livemode` | boolean | yes |  |
| `apiVersion` | one of `2026-10-16` | yes |  |
| `type` | `refund.succeeded` | yes |  |
| `data` | object | yes |  |
| `data.id` | id (`re_…`) | yes |  |
| `data.object` | `refund` | yes |  |
| `data.livemode` | boolean | yes |  |
| `data.payment` | id (`pay_…`) | yes |  |
| `data.amount` | integer, at least 1 | yes |  |
| `data.status` | one of `pending_approval`, `pending`, `succeeded`, `failed`, `canceled` | yes |  |
| `data.reason` | string, 1 to 200 characters, or null | yes |  |
| `data.createdAt` | timestamp (ISO 8601, with a zone) | yes |  |

### ModalSession

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | id (`ms_…`) | yes |  |
| `object` | `modal_session` | yes |  |
| `livemode` | boolean | yes |  |
| `url` | URL | yes |  |
| `expiresAt` | timestamp (ISO 8601, with a zone) | yes |  |

### ErrorResponse

| Field | Type | Required | Notes |
|---|---|---|---|
| `error` | object | yes |  |
| `error.type` | one of `invalid_request`, `authentication`, `permission`, `not_found`, `conflict`, `rate_limit`, `api` | yes |  |
| `error.code` | one of `parameter_missing`, `parameter_invalid`, `parameter_unknown`, `amount_too_small`, `amount_too_large`, `lines_exceed_amount`, `metadata_invalid`, `quantity_not_allowed`, `partial_refund_unsupported`, `refund_exceeds_payment`, `webhook_url_invalid`, `idempotency_key_required`, `version_unknown`, `key_missing`, `key_invalid`, `key_expired`, `publishable_key_not_allowed`, `origin_not_allowed`, `method_unavailable`, `payment_not_found`, `price_not_found`, `payment_link_not_found`, `refund_not_found`, `webhook_endpoint_not_found`, `route_not_found`, `idempotency_key_reused`, `reference_taken`, `price_inactive`, `payment_link_inactive`, `payment_link_expired`, `payment_not_cancelable`, `payment_not_refundable`, `payment_closed`, `refund_in_app`, `rate_limited`, `internal_error` | yes |  |
| `error.message` | string | yes |  |
| `error.param` | string | no |  |

### WebhookDelivery

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | id (`whd_…`) | yes |  |
| `object` | `webhook_delivery` | yes |  |
| `livemode` | boolean | yes |  |
| `endpoint` | id (`we_…`) | yes |  |
| `event` | object | yes |  |
| `event.id` | id (`evt_…`) | yes |  |
| `event.type` | one of `payment.succeeded`, `payment.failed`, `payment.canceled`, `refund.succeeded` | yes |  |
| `status` | one of `pending`, `succeeded`, `failed` | yes |  |
| `attempts` | integer, at least 0 | yes |  |
| `responseStatus` | integer, at least -9007199254740991, or null | yes |  |
| `lastAttemptAt` | timestamp (ISO 8601, with a zone), or null | yes |  |
| `nextAttemptAt` | timestamp (ISO 8601, with a zone), or null | yes |  |
| `createdAt` | timestamp (ISO 8601, with a zone) | yes |  |

## Errors

Every refusal is `{ "error": { "type", "code", "message", "param" } }`. Branch on `code`; `message` is for people; `param` is the field at fault.

| Code | Type | HTTP |
|---|---|---|
| `parameter_missing` | invalid_request | 400 |
| `parameter_invalid` | invalid_request | 400 |
| `parameter_unknown` | invalid_request | 400 |
| `amount_too_small` | invalid_request | 400 |
| `amount_too_large` | invalid_request | 400 |
| `lines_exceed_amount` | invalid_request | 400 |
| `metadata_invalid` | invalid_request | 400 |
| `quantity_not_allowed` | invalid_request | 400 |
| `partial_refund_unsupported` | invalid_request | 400 |
| `refund_exceeds_payment` | invalid_request | 400 |
| `webhook_url_invalid` | invalid_request | 400 |
| `idempotency_key_required` | invalid_request | 400 |
| `version_unknown` | invalid_request | 400 |
| `key_missing` | authentication | 401 |
| `key_invalid` | authentication | 401 |
| `key_expired` | authentication | 401 |
| `publishable_key_not_allowed` | permission | 403 |
| `origin_not_allowed` | permission | 403 |
| `method_unavailable` | permission | 403 |
| `payment_not_found` | not_found | 404 |
| `price_not_found` | not_found | 404 |
| `payment_link_not_found` | not_found | 404 |
| `refund_not_found` | not_found | 404 |
| `webhook_endpoint_not_found` | not_found | 404 |
| `route_not_found` | not_found | 404 |
| `idempotency_key_reused` | conflict | 409 |
| `reference_taken` | conflict | 409 |
| `price_inactive` | conflict | 409 |
| `payment_link_inactive` | conflict | 409 |
| `payment_link_expired` | conflict | 409 |
| `payment_not_cancelable` | conflict | 409 |
| `payment_not_refundable` | conflict | 409 |
| `payment_closed` | conflict | 409 |
| `refund_in_app` | conflict | 409 |
| `rate_limited` | rate_limit | 429 |
| `internal_error` | api | 500 |

## Lists

- Versions: `2026-10-16`
- Payment statuses: `requires_customer`, `processing`, `succeeded`, `failed`, `canceled`
- Refund statuses: `pending_approval`, `pending`, `succeeded`, `failed`, `canceled`
- Webhook delivery statuses: `pending`, `succeeded`, `failed`
