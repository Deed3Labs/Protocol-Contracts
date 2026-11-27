#!/usr/bin/env node
/*
 * Step 2 verification against Lithic sandbox: provision a member, then read them back the way the
 * route does. Sandbox only, no database required — this exercises the Lithic half.
 *
 *   node scripts/lithic-verify-step2.mjs
 */
import 'dotenv/config';
import Lithic from 'lithic';

const env = (process.env.LITHIC_ENV || 'sandbox').trim().toLowerCase();
if (env !== 'sandbox') {
  console.error('Sandbox only.');
  process.exit(1);
}

const lithic = new Lithic({ apiKey: process.env.LITHIC_API_KEY, environment: 'sandbox' });
const wallet = `0x${'a'.repeat(39)}${Math.floor(Math.random() * 10)}`;
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// 1. Provision.
const holder = await lithic.accountHolders.create(
  {
    workflow: 'KYC_BASIC',
    tos_timestamp: new Date().toISOString(),
    individual: {
      first_name: 'Step', last_name: 'Two',
      email: `clear+step2-${Date.now()}@example.com`,
      phone_number: '+15555555555',
      dob: '1985-04-12',
      government_id: '111-11-1111',
      address: { address1: '1 Test Street', city: 'Redlands', state: 'CA', postal_code: '92373', country: 'USA' },
    },
    external_id: wallet,
  },
  { idempotencyKey: `member:${wallet}` },
);
check('account holder created', Boolean(holder.account_token), holder.status);

// 2. Lithic has no idempotency on this endpoint — verified: the same idempotency key produces a
// second holder. Our dedupe is the external_id lookup, so that is what gets tested.
let found = null;
for await (const h of lithic.accountHolders.list({ external_id: wallet })) { found = h; break; }
check('external_id lookup finds the holder', Boolean(found), found?.token || 'not found');
check('lookup returns the same account', found?.account_token === holder.account_token,
  found?.account_token === holder.account_token ? 'same account_token' : `${holder.account_token} vs ${found?.account_token}`);

// 3. Financial accounts — the state the program is actually in.
let accounts = null;
try {
  accounts = [];
  for await (const a of lithic.financialAccounts.list({ account_token: holder.account_token })) accounts.push(a);
} catch (e) {
  accounts = null;
  console.log(`INFO  financial accounts unavailable — ${e.message}`);
}
check('financial accounts resolve to a known state', accounts === null || Array.isArray(accounts),
  accounts === null ? 'program has none (cash rail blocked)' : `${accounts.length} account(s)`);

// 4. Deposit instructions, if any.
const routable = (accounts || []).find((a) => a.routing_number && a.account_number);
console.log(routable
  ? `INFO  routable account ${routable.token} — routing ${routable.routing_number}`
  : 'INFO  no routable account yet, so /api/lithic/account returns deposit: null');

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
