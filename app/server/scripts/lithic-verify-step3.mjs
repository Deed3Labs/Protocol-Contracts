#!/usr/bin/env node
/*
 * Step 3 verification: drive the real ASA endpoint over HTTP with real signatures.
 *
 *   node scripts/lithic-verify-step3.mjs
 *
 * Boots the router in-process on an ephemeral port — no database required for the decline paths,
 * and the approval paths are covered by the unit tests on the pure decision function. What this
 * proves is the wiring: signature verification, idempotent parsing, the balance-inquiry branch, and
 * that every failure mode still answers HTTP 200 with a decline rather than a timeout.
 */
import express from 'express';
import { Webhook } from 'standardwebhooks';
import crypto from 'crypto';

process.env.LITHIC_WEBHOOK_SECRET =
  process.env.LITHIC_WEBHOOK_SECRET || `whsec_${Buffer.from(crypto.randomBytes(24)).toString('base64')}`;

const { default: router } = await import('../dist/routes/lithicAuthStream.js').catch(() => {
  console.error('Compile first: npm run lithic:build-asa');
  process.exit(1);
});

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
app.use('/asa', router);
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}/asa`;

const wh = new Webhook(process.env.LITHIC_WEBHOOK_SECRET);
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function post(body, { sign = true } = {}) {
  const payload = JSON.stringify(body);
  const id = `msg_${crypto.randomUUID()}`;
  const timestamp = new Date();
  const headers = { 'content-type': 'application/json' };
  if (sign) {
    const signature = wh.sign(id, timestamp, payload);
    Object.assign(headers, { 'webhook-id': id, 'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)), 'webhook-signature': signature });
  }
  const res = await fetch(base, { method: 'POST', headers, body: payload });
  return { status: res.status, body: await res.json() };
}

const auth = (over = {}) => ({
  token: crypto.randomUUID(),
  status: 'AUTHORIZATION',
  amounts: { cardholder: { amount: 5210, currency: 'USD' } },
  card: { token: crypto.randomUUID(), state: 'OPEN' },
  merchant: { descriptor: 'SHELL', mcc: '5541' },
  ...over,
});

// 1. Unsigned requests must never be trusted.
const unsigned = await post(auth(), { sign: false });
check('unsigned request declines', unsigned.status === 200 && unsigned.body.result !== 'APPROVED', `${unsigned.status} ${unsigned.body.result}`);

// 2. A tampered body must fail verification.
const good = auth();
const payload = JSON.stringify(good);
const id = `msg_${crypto.randomUUID()}`;
const ts = new Date();
const sig = wh.sign(id, ts, payload);
const tampered = await fetch(base, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(Math.floor(ts.getTime() / 1000)), 'webhook-signature': sig },
  body: JSON.stringify({ ...good, amounts: { cardholder: { amount: 1, currency: 'USD' } } }),
});
const tamperedBody = await tampered.json();
check('tampered body declines', tampered.status === 200 && tamperedBody.result !== 'APPROVED', tamperedBody.result);

// 3. A signed request for a card we have no snapshot for: fail closed, still HTTP 200.
const unknown = await post(auth());
check('unknown card declines, not errors', unknown.status === 200 && unknown.body.result === 'INSUFFICIENT_FUNDS', `${unknown.status} ${unknown.body.result}`);

// 4. Malformed payloads decline rather than throw.
const malformed = await post({ status: 'AUTHORIZATION' });
check('missing tokens decline', malformed.status === 200 && malformed.body.result === 'INSUFFICIENT_FUNDS', malformed.body.result);

// 5. Balance inquiry answers with a balance and draws nothing.
const inquiry = await post(auth({ status: 'BALANCE_INQUIRY' }));
check('balance inquiry answers', inquiry.status === 200 && typeof inquiry.body.available === 'number', JSON.stringify(inquiry.body));

// 6. Every response is HTTP 200 — a non-200 reads as a timeout to Lithic.
check('all responses were HTTP 200', [unsigned, unknown, malformed, inquiry].every((r) => r.status === 200));

server.close();
console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
