#!/usr/bin/env node
/*
 * Clear's signer on a shop's organization wallet: check it, attach it, prove it.
 *
 * A merchant's money lives in a Privy ORGANIZATION wallet owned by the owner's key quorum. Clear
 * acts on it as an *additional signer*: one P-256 authorization key per deployment, wrapped in a
 * key quorum of one, attached under a policy ceiling. The counter device holds no signing material
 * at all -- `services/merchant/privySigner.ts` says why.
 *
 * None of that was actually in place. Checked on 2026-09-21: `PRIVY_AUTHORIZATION_PUBLIC_KEY` was
 * set, the private half existed in no environment, and the demo shop's wallet came back with
 * `additional_signers: []`. So gasless redemption reports "not configured" and the withdraw route
 * records a request, exactly as it did before the chain leg existed.
 *
 *   node scripts/merchant-clear-signer.mjs keygen
 *   railway run --service Protocol-Contracts -- node scripts/merchant-clear-signer.mjs status 0x…
 *   railway run --service Protocol-Contracts -- node scripts/merchant-clear-signer.mjs attach 0x…
 *   railway run --service Protocol-Contracts -- node scripts/merchant-clear-signer.mjs verify 0x…
 *
 * `keygen` is local and touches no network. The rest need PRIVY_APP_ID and PRIVY_APP_SECRET, which
 * is what `railway run` is for.
 *
 * ORDER MATTERS: keygen, set BOTH variables as one pair, attach per shop, verify. Attaching before
 * the public key is in the environment builds a quorum around a key nobody holds -- the state this
 * exists to get out of, and a second one would be worse, because then there are two to tell apart.
 *
 * Verify before any money moves. A redemption that fails at the signature costs a merchant their
 * confidence; a test message costs nothing.
 *
 * **Whether Privy lets Clear attach a signer to a wallet owned by somebody else's quorum is not
 * settled.** It may want the owner's own authorization. If it refuses, this prints the refusal
 * verbatim rather than interpreting it, and the answer is an owner-consent step in onboarding
 * rather than anything to work around here.
 */
import { PrivyClient } from '@privy-io/node';
import { generateKeyPairSync, createHash } from 'node:crypto';

const [, , command, address] = process.argv;
const APP_ID = (process.env.PRIVY_APP_ID || '').trim();
const APP_SECRET = (process.env.PRIVY_APP_SECRET || '').trim();
const PUBLIC_KEY = (process.env.PRIVY_AUTHORIZATION_PUBLIC_KEY || '').trim();
const PRIVATE_KEY = (process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY || '').trim();
const CEILING = Number(process.env.MERCHANT_POLICY_CEILING_USD || '5000');

/** Keys are compared by fingerprint, never printed whole: the question is only ever "same key?". */
const fingerprint = (key) => (key ? createHash('sha256').update(key).digest('hex').slice(0, 12) : 'none');

function privy() {
  if (!APP_ID || !APP_SECRET) {
    console.error('Needs PRIVY_APP_ID and PRIVY_APP_SECRET. Run it under `railway run`.');
    process.exit(1);
  }
  return new PrivyClient({ appId: APP_ID, appSecret: APP_SECRET });
}

async function walletFor(p, merchant) {
  if (!merchant) {
    console.error('Give the merchant address — the org wallet address the registry knows.');
    process.exit(1);
  }
  try {
    return await p.wallets().getWalletByAddress({ address: merchant });
  } catch (error) {
    console.error(`No Privy wallet at ${merchant}: ${error?.message || error}`);
    process.exit(1);
  }
}

/** Who may act on this wallet, and whether any of them is this deployment. */
async function describe(p, wallet) {
  console.log(`wallet             ${wallet.id}`);
  console.log(`address            ${wallet.address}`);
  console.log(`entity             ${JSON.stringify(wallet.entity ?? null)}`);
  console.log(`owner quorum       ${wallet.owner_id ?? '(none)'}`);

  const signers = wallet.additional_signers ?? [];
  console.log(`additional signers ${signers.length === 0 ? 'NONE — Clear cannot sign for this shop' : ''}`);

  let ours = false;
  for (const signer of signers) {
    const quorum = await p.keyQuorums().get(signer.signer_id).catch(() => null);
    const keys = (quorum?.authorization_keys ?? []).map((k) => fingerprint(k.public_key ?? k));
    const mine = Boolean(PUBLIC_KEY) && keys.includes(fingerprint(PUBLIC_KEY));
    if (mine) ours = true;
    console.log(
      `  ${signer.signer_id}  "${quorum?.display_name ?? '?'}"  keys=${keys.join(',') || 'none'}` +
        (mine ? '  <== this deployment' : ''),
    );
  }
  return ours;
}

if (command === 'keygen') {
  /*
   * Printed once, kept by whoever runs it. Nothing writes it to disk on purpose: a private key in
   * a file is a private key in a backup.
   */
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  console.log('A new authorization keypair. Set BOTH, as one pair, then attach each shop.\n');
  console.log(`PRIVY_AUTHORIZATION_PUBLIC_KEY=${pub}\n`);
  console.log(`PRIVY_AUTHORIZATION_PRIVATE_KEY=${priv}\n`);
  console.log('This script stores neither half. Lose the private one and the answer is another');
  console.log('pair and another attach — never a quorum left standing around a key nobody holds.');
  process.exit(0);
}

if (command === 'status') {
  const p = privy();
  console.log(`env public key     ${fingerprint(PUBLIC_KEY)}${PUBLIC_KEY ? '' : '  (unset)'}`);
  console.log(`env private key    ${PRIVATE_KEY ? 'set' : 'UNSET — nothing can sign'}`);
  const wallet = await walletFor(p, address);
  const ours = await describe(p, wallet);
  console.log(`\nClear can sign for this shop: ${ours && PRIVATE_KEY ? 'yes' : 'no'}`);
  process.exit(0);
}

if (command === 'attach') {
  const p = privy();
  if (!PUBLIC_KEY) {
    console.error('PRIVY_AUTHORIZATION_PUBLIC_KEY is unset. Run keygen and set both halves first.');
    process.exit(1);
  }
  const wallet = await walletFor(p, address);
  if (await describe(p, wallet)) {
    console.log('\nAlready attached. Nothing to do.');
    process.exit(0);
  }

  const name = wallet.address.slice(0, 10);
  const quorum = await p.keyQuorums().create({
    display_name: `Clear signer — ${name}`,
    public_keys: [PUBLIC_KEY],
  });
  console.log(`\nkey quorum         ${quorum.id}`);

  /*
   * The coarse ceiling, and deliberately generous. The real per-charge cap is MerchantRegistry's,
   * because it is business logic that varies per shop; this is what survives a compromised backend
   * key — the difference between a disabled button and a wallet that will not do it.
   */
  const policy = await p.policies().create({
    name: `Clear ceiling — ${name}`,
    chain_type: 'ethereum',
    version: '1.0',
    rules: [
      {
        name: `Under $${CEILING.toLocaleString('en-US')} per transaction`,
        method: 'eth_sendTransaction',
        action: 'ALLOW',
        conditions: [
          {
            field_source: 'ethereum_transaction',
            field: 'value',
            operator: 'lte',
            value: String(BigInt(Math.round(CEILING)) * 10n ** 18n),
          },
        ],
      },
    ],
  });
  console.log(`policy             ${policy.id}`);

  try {
    const updated = await p.wallets().update(wallet.id, {
      additional_signers: [{ signer_id: quorum.id, override_policy_ids: [policy.id] }],
    });
    console.log(`attached           ${JSON.stringify(updated.additional_signers)}`);
    console.log(`\nNow prove it:  verify ${wallet.address}`);
  } catch (error) {
    // Verbatim. If Privy wants the owner's authorization, that is an owner-consent step in
    // onboarding, not something to be talked around from a script.
    console.error('\nATTACH REFUSED:', error?.message || error);
    console.error(`\nThe quorum (${quorum.id}) and policy (${policy.id}) exist, unattached.`);
    console.error('Re-run attach once the refusal is answered, rather than making a second pair.');
    process.exit(1);
  }
  process.exit(0);
}

if (command === 'verify') {
  const p = privy();
  if (!PRIVATE_KEY) {
    console.error('PRIVY_AUTHORIZATION_PRIVATE_KEY is unset, so there is nothing to prove.');
    process.exit(1);
  }
  const wallet = await walletFor(p, address);
  try {
    // A message, not a transaction. "Can Clear sign for this wallet" is the only question here,
    // and it is answerable without touching anybody's money.
    const { signature } = await p
      .wallets()
      .ethereum()
      .signMessage(wallet.id, {
        message: `Clear signer check ${new Date().toISOString()}`,
        authorization_context: { authorization_private_keys: [PRIVATE_KEY] },
      });
    console.log(`signed OK — ${signature.slice(0, 18)}…`);
    console.log('Clear can act for this shop. Redemption also needs ZERODEV_PROJECT_ID.');
  } catch (error) {
    console.error('SIGNING REFUSED:', error?.message || error);
    console.error('\nUsually: the key is not attached to this wallet, or the halves are not a pair.');
    process.exit(1);
  }
  process.exit(0);
}

console.error('Usage: merchant-clear-signer.mjs keygen | status <address> | attach <address> | verify <address>');
process.exit(1);
