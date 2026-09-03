import 'dotenv/config';
import Lithic from 'lithic';
import { Webhook } from 'standardwebhooks';

/*
 * ASA readiness — proving our authorization endpoint before Lithic is pointed at it.
 *
 * Enrolment itself is not an API call. The Lithic SDK exposes only retrieveSecret and rotateSecret;
 * registering the URL Lithic posts authorizations to is done in their dashboard or by their support
 * team. So this script does the part that IS ours: it signs a realistic authorization the way
 * Lithic signs one, posts it at our endpoint, and checks the answer.
 *
 * That ordering matters. Enrolling first and testing afterwards means the first real cardholder at
 * a real checkout is the test, and a wrong answer there is a declined card in someone's hand.
 *
 * Usage:  node scripts/lithic-verify-asa.mjs [baseUrl]
 *         defaults to http://localhost:8080
 */

const baseUrl = (process.argv[2] || process.env.ASA_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const endpoint = `${baseUrl}/api/webhooks/lithic/auth-stream`;

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// The secret Lithic signs with. Retrieved rather than configured, so this tests the real one.
let secret = (process.env.LITHIC_WEBHOOK_SECRET || '').trim();
if (!secret) {
  try {
    const lithic = new Lithic({ apiKey: process.env.LITHIC_API_KEY, environment: 'sandbox' });
    const retrieved = await lithic.authStreamEnrollment.retrieveSecret();
    secret = retrieved?.secret || '';
    console.log(`INFO  retrieved ASA secret from sandbox${secret ? '' : ' — but it was empty'}`);
  } catch (error) {
    console.log(`INFO  could not retrieve ASA secret — ${error.message}`);
  }
}

if (!secret) {
  console.log('\nCannot sign without the ASA secret. Set LITHIC_WEBHOOK_SECRET or enable sandbox access.');
  process.exit(1);
}

/** Sign and post exactly the way Lithic does — standard-webhooks over the raw body. */
async function post(body, { corrupt = false } = {}) {
  const payload = JSON.stringify(body);
  const id = `msg_${body.token}`;
  const timestamp = new Date();

  const signature = new Webhook(secret).sign(id, timestamp, payload);
  const started = Date.now();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'webhook-signature': corrupt ? 'v1,YmFkc2lnbmF0dXJl' : signature,
    },
    body: payload,
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* a non-JSON body is itself a finding */
  }
  return { status: response.status, json, text, ms: Date.now() - started };
}

const authorization = (amountCents, token) => ({
  token,
  card: { token: process.env.ASA_TEST_CARD_TOKEN || '00000000-0000-0000-0000-000000000000' },
  amounts: { cardholder: { amount: amountCents, currency: 'USD' } },
  merchant: { descriptor: 'PROBE MERCHANT', mcc: '5411' },
  status: 'PENDING',
});

// 1. A well-formed, correctly signed authorization gets a decision.
const first = await post(authorization(2500, 'aaaaaaaa-0000-4000-8000-000000000001'));
check(first.status === 200, 'signed authorization answers 200', `status ${first.status}`);
check(
  first.json?.result !== undefined,
  'the response carries a result',
  first.json ? JSON.stringify(first.json).slice(0, 90) : first.text.slice(0, 90),
);

// 2. Speed. Lithic times out at 6s and recommends under 3s.
check(first.ms < 3000, 'answers inside the recommended 3s', `${first.ms}ms`);

// 3. A bad signature must not produce an approval.
const forged = await post(authorization(2500, 'aaaaaaaa-0000-4000-8000-000000000002'), { corrupt: true });
check(
  forged.json?.result !== 'APPROVED',
  'a forged signature is never approved',
  forged.json ? String(forged.json.result) : `status ${forged.status}`,
);

// 4. Idempotency: the same token twice is one decision, not two draws.
const token = 'aaaaaaaa-0000-4000-8000-000000000003';
const once = await post(authorization(1500, token));
const twice = await post(authorization(1500, token));
check(
  once.json?.result === twice.json?.result,
  'replaying a transaction token repeats the decision',
  `${once.json?.result} then ${twice.json?.result}`,
);

// 5. Fail-closed: an unknown card has no snapshot, and no snapshot must never mean approved.
const unknown = await post({
  ...authorization(9999, 'aaaaaaaa-0000-4000-8000-000000000004'),
  card: { token: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
});
check(
  unknown.json?.result !== 'APPROVED',
  'an unknown card is declined, not approved',
  String(unknown.json?.result),
);

console.log(
  failures
    ? `\n${failures} check(s) failed. Do not enrol the URL with Lithic until these pass.`
    : '\nAll checks passed. Safe to give Lithic the endpoint URL.',
);
process.exit(failures ? 1 : 0);
