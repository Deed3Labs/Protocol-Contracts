#!/usr/bin/env node
/*
 * Look at (and, asked twice, remove) a member's Privy passkeys.
 *
 *   node scripts/privy-passkey-reset.mjs --email you@example.com
 *   node scripts/privy-passkey-reset.mjs --email you@example.com --unlink
 *
 * Why this exists: a passkey deleted from the phone cannot be removed from the account in the app.
 * Privy requires MFA verification to unenrol an MFA method, and the method being unenrolled is the
 * passkey that is gone -- so the member is asked for the thing they are trying to remove. The
 * dashboard does not offer it either. This uses the app secret, which is the one credential that
 * does not have to ask the member anything.
 *
 * It prints `mfa_methods` before and after. That is the point of running it: whether unlinking the
 * passkey also drops it as an MFA method is not documented, and this is how we find out. If the
 * method survives, the wallet still asks for a passkey that does not exist and only Privy support
 * can clear it -- the script says so rather than leaving you to guess.
 *
 * Nothing is removed without --unlink. Run it without first and read what it found.
 *
 * Needs PRIVY_APP_ID and PRIVY_APP_SECRET. Take them from the environment the app runs in rather
 * than pasting them anywhere:
 *
 *   railway run --service Protocol-Contracts node scripts/privy-passkey-reset.mjs --email ...
 */
import 'dotenv/config';
import { PrivyClient } from '@privy-io/node';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const email = arg('email', '').trim().toLowerCase();
const unlink = process.argv.includes('--unlink');
const appID = (process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID || '').trim();
const appSecret = (process.env.PRIVY_APP_SECRET || '').trim();

if (!email) {
  console.error('Which member? --email you@example.com');
  process.exit(1);
}
if (!appID || !appSecret) {
  console.error('Needs PRIVY_APP_ID and PRIVY_APP_SECRET (from the API service\'s own environment).');
  process.exit(1);
}

// Resources are call-and-then-use here ('privy.users()'), as the merchant code notes.
const privy = new PrivyClient({ appId: appID, appSecret });
const users = privy.users();

const describe = (user) => ({
  did: user.id,
  passkeys: (user.linked_accounts ?? [])
    .filter((a) => a.type === 'passkey')
    .map((p) => ({ credentialId: p.credential_id, enrolledInMfa: p.enrolled_in_mfa, device: p.credential_device_type })),
  mfaMethods: (user.mfa_methods ?? []).map((m) => m.type ?? m),
});

const user = await users.getByEmailAddress({ address: email }).catch((e) => {
  console.error('Could not read that member:', e?.message ?? e);
  process.exit(1);
});

const before = describe(user);
console.log('Before:', JSON.stringify(before, null, 2));

if (!before.passkeys.length) {
  console.log('\nNo passkeys on this account. Nothing to unlink.');
  if (before.mfaMethods.includes('passkey')) {
    console.log('It still has passkey MFA with no passkey behind it — only Privy support can clear that.');
  }
  process.exit(0);
}

if (!unlink) {
  console.log('\nNothing changed. Add --unlink to remove the passkeys above.');
  process.exit(0);
}

/*
 * An MFA-enrolled passkey has its own endpoint, which the SDK does not expose: the ordinary unlink
 * refuses with "MFA-enrolled passkeys must be unlinked via POST /users/{userId}/passkeys/unlink".
 * So that one is called directly. Basic auth is the app id and secret, as everywhere in Privy's API.
 */
async function unlinkPasskey(userId, credentialId) {
  const response = await fetch(`https://api.privy.io/v1/users/${userId}/passkeys/unlink`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${appID}:${appSecret}`).toString('base64')}`,
      'privy-app-id': appID,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ credential_id: credentialId }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

let failed = false;
for (const passkey of before.passkeys) {
  console.log(`\nUnlinking ${passkey.credentialId}…`);
  try {
    await unlinkPasskey(user.id, passkey.credentialId);
    console.log('  gone');
  } catch (e) {
    failed = true;
    console.error('  refused:', e?.message ?? e);
  }
}

const now = describe(await users.getByEmailAddress({ address: email }));
console.log('\nAfter:', JSON.stringify(now, null, 2));

if (!now.passkeys.length && !now.mfaMethods.includes('passkey')) {
  console.log('\nDone: no passkey, and none enrolled for MFA. Turn Face ID on again in Settings to set up a new one.');
} else if (now.mfaMethods.includes('passkey')) {
  console.log(
    `\nPasskey MFA is still enrolled${failed ? '' : ' even though the passkey is gone'}, so the wallet will keep asking for it.\n` +
      `Ask Privy support to clear MFA for ${now.did}. Signing in with a code still works meanwhile.`,
  );
} else {
  console.log('\nSome passkeys are still linked; read the refusals above.');
}
