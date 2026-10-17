# @clear/public-api-contracts

Pay with Clear's public API, `/v1`: its objects, requests, routes, errors, webhook events and signatures,
versions, and the modal's postMessage protocol, as zod schemas. Private; `@useclear/node` and
`@useclear/js` are typed from it, and `apps/api` validates with it.

## It only grows

Within a version, a field, route, event or code is added, never renamed or removed.

- `src/published/<version>.json` is a snapshot of what each version publishes (`bun run snapshot` writes
  it, and refuses a breaking one).
- `published.test.ts` compares every snapshot with the schemas as they are now. It fails on anything
  that disappeared, changed type, turned nullable, became required in a request, or stopped being
  required in a response.
- A real removal takes a new version in `src/versions.ts`.

## What's in it

- `payments.ts`, `prices.ts`, `refunds.ts`: the objects and their requests.
- `webhooks.ts`: endpoints, events, deliveries, and the `Clear-Signature` format.
- `endpoints.ts`: the routes, which the API's tests check its router against and `@clear/pay-docs`
  renders into `api.md`.
- `errors.ts`: every error `code`, with its `type` and HTTP status.
- `modal.ts`: modal sessions and the `clear.v1` postMessage protocol between the frame and the page.
- `versions.ts`: `Clear-Version`, `Idempotency-Key`, and the list of versions.
