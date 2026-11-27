#!/usr/bin/env node
/*
 * Provision a test member end to end against Lithic sandbox, and print what we'd persist.
 *
 *   node scripts/lithic-provision-test-member.mjs
 *   node scripts/lithic-provision-test-member.mjs --email you@example.com --name "Ada Lovelace"
 *
 * Needs LITHIC_API_KEY (sandbox). Refuses to run against production outright — this script creates
 * account holders, and there is no good reason to do that against live from a laptop.
 *
 * What it proves, which is the point of step 1: that the key works, that the account holder is
 * accepted, and whether this program has Financial Accounts at all. If it doesn't, the whole cash
 * rail — direct deposit, ACH, book transfers — is blocked on Lithic enabling that product for the
 * program. That is a conversation with them, not a bug in our code, so the script says which of the
 * two it is rather than failing with a raw 400.
 *
 * Defaults to KYC_BASIC, the workflow we'd actually ship: Program Managed means Lithic runs KYC.
 * `--workflow KYC_EXEMPT` uses the low-PII path instead, which needs no dob or government id.
 */
import 'dotenv/config';
import Lithic from 'lithic';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const env = (process.env.LITHIC_ENV || 'sandbox').trim().toLowerCase();
if (env !== 'sandbox') {
  console.error('This script is sandbox-only. Unset LITHIC_ENV or set it to "sandbox".');
  process.exit(1);
}

const apiKey = (process.env.LITHIC_API_KEY || '').trim();
if (!apiKey) {
  console.error('LITHIC_API_KEY is not set. Add a sandbox key to apps/api/.env and retry.');
  process.exit(1);
}

const stamp = Date.now();
const fullName = arg('name', 'Test Member');
const [firstName, ...rest] = fullName.split(/\s+/);
const lastName = rest.join(' ') || 'Member';
const email = arg('email', `clear+${stamp}@example.com`);
const externalId = arg('external-id', `local-test-${stamp}`);
const workflow = arg('workflow', 'KYC_BASIC');

const lithic = new Lithic({ apiKey, environment: 'sandbox' });

const money = (cents) =>
  typeof cents === 'number' ? `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—';

async function main() {
  console.log(`\nProvisioning ${fullName} <${email}> in Lithic sandbox via ${workflow}…\n`);

  const address = {
    address1: arg('address1', '1 Test Street'),
    city: arg('city', 'Redlands'),
    state: arg('state', 'CA'),
    postal_code: arg('postal-code', '92373'),
    country: 'USA',
  };

  // KYC_EXEMPT is flat — no `individual` wrapper — and needs a kyc_exemption_type. The KYC
  // workflows nest under `individual` and additionally require dob + government_id.
  const params =
    workflow === 'KYC_EXEMPT'
      ? {
          workflow: 'KYC_EXEMPT',
          kyc_exemption_type: 'PREPAID_CARD_USER',
          first_name: firstName,
          last_name: lastName,
          email,
          phone_number: arg('phone', '+15555555555'),
          address,
          external_id: externalId,
        }
      : {
          workflow,
          tos_timestamp: new Date().toISOString(),
          individual: {
            first_name: firstName,
            last_name: lastName,
            email,
            phone_number: arg('phone', '+15555555555'),
            dob: arg('dob', '1985-04-12'),
            government_id: arg('government-id', '111-11-1111'),
            address,
          },
          external_id: externalId,
        };

  const holder = await lithic.accountHolders.create(params, {
    idempotencyKey: `member:${externalId}`,
  });

  const accountHolderToken = holder.token;
  const accountToken = holder.account_token;

  console.log('Account holder');
  console.log(`  status               ${holder.status ?? 'UNKNOWN'}`);
  if (holder.status_reasons?.length) {
    console.log(`  status_reasons       ${holder.status_reasons.join(', ')}`);
  }
  console.log(`  account_holder_token ${accountHolderToken}`);
  console.log(`  account_token        ${accountToken}\n`);

  if (!accountToken) {
    console.error('No account_token came back — nothing further to read.');
    process.exit(1);
  }

  // Financial accounts are created with the holder; we read them rather than creating them. A 400
  // here means the program has no Financial Accounts product at all, which is worth saying plainly.
  const accounts = [];
  try {
    for await (const account of lithic.financialAccounts.list({ account_token: accountToken })) {
      accounts.push(account);
    }
  } catch (error) {
    console.log(`Financial accounts: unavailable — ${error?.message || error}`);
    let programAccounts = 0;
    try {
      for await (const _ of lithic.financialAccounts.list({})) programAccounts += 1;
    } catch {
      /* the unfiltered list can fail the same way */
    }
    console.log(
      `\nThis program exposes ${programAccounts} financial account(s) in total.\n` +
        'Cards work without them, but the cash rail does not: direct deposit, ACH receipt,\n' +
        'ACH origination, book transfers and external bank accounts all key off a\n' +
        'financial_account_token. Ask Lithic to enable Financial Accounts on this program.\n',
    );
    process.exit(0);
  }

  console.log(`Financial accounts (${accounts.length})`);
  for (const account of accounts) {
    const routable = Boolean(account.routing_number && account.account_number);
    console.log(`  ${account.type ?? '?'}  ${account.token}`);
    console.log(`    routable          ${routable ? 'yes' : 'no'}`);
    if (routable) {
      console.log(`    routing_number    ${account.routing_number}`);
      console.log(`    account_number    ${account.account_number}`);
    }
    if (account.nickname) console.log(`    nickname          ${account.nickname}`);
  }

  const routable = accounts.find((a) => a.routing_number && a.account_number);
  console.log('\nWhat we would persist against the member record:');
  console.log(
    JSON.stringify(
      {
        lithic_account_holder_token: accountHolderToken,
        lithic_account_token: accountToken,
        lithic_cash_financial_account_token: routable?.token ?? null,
        lithic_issuing_financial_account_token:
          accounts.find((a) => a.type === 'ISSUING')?.token ?? null,
      },
      null,
      2,
    ),
  );

  if (!routable) {
    console.log(
      '\nNo routable account came back. Direct deposit needs one, so this program has to be\n' +
        'configured for routable customer accounts before step 2 can surface a routing number.',
    );
  }

  // Balances, so the ledger work in later steps starts from a known shape.
  if (accounts[0]) {
    const detail = await lithic.financialAccounts.retrieve(accounts[0].token);
    const balance = detail?.balance ?? detail?.available_balance;
    if (balance !== undefined) console.log(`\nFirst account balance: ${money(balance)}`);
  }

  console.log('\nDone.\n');
}

main().catch((error) => {
  console.error('\nFailed:', error?.message || error);
  if (error?.status) console.error('HTTP status:', error.status);
  if (error?.error) console.error('Body:', JSON.stringify(error.error, null, 2));
  process.exit(1);
});
