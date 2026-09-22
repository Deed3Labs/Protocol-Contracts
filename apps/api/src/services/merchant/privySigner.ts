import { PrivyClient } from '@privy-io/node';

/**
 * Clear's own signer on a merchant's organization wallet.
 *
 * **The counter device holds no signing material.** An earlier draft made the enrolled tablet the
 * scoped signer; this is strictly better. Clear's backend holds one P-256 authorization key per
 * merchant organization, registered as a signer on that org's wallet, and the device holds only a
 * session against Clear. Which means:
 *
 *   - a stolen tablet carries nothing that can sign
 *   - revoking a device is a server-side session delete: instant, free, and effective immediately
 *   - the policy ceiling applies to every device at once, which is what an owner means by
 *     "my approval cap"
 *   - there is one key per merchant to rotate rather than one per tablet
 *
 * Privy's owners-and-signers model accepts a user, an authorization key, or a key quorum. A raw
 * authorization key is registered by wrapping it in a key quorum of one — `additional_signers`
 * takes quorum ids — which is why there are two quorums per shop: the owner's, which owns the
 * wallet, and Clear's, which may act within a policy.
 *
 * **The policy is a backstop, not the rule.** The real approval cap lives in `MerchantRegistry`,
 * because it is business logic: it varies per merchant, moves with volume, and forms part of the
 * signed agreement. It belongs in the protocol so it holds whichever path a transaction arrives
 * through. What the policy adds is a coarse dollar ceiling that survives a compromised backend
 * key — the difference between "the button is disabled" and "the wallet will not do it".
 */

const APP_ID = process.env.PRIVY_APP_ID || '';
const APP_SECRET = process.env.PRIVY_APP_SECRET || '';

/**
 * Clear's P-256 public key, base64-encoded DER.
 *
 * The private half never appears here — it lives wherever the signing service keeps it. This
 * module only ever registers the public half as an authorised signer.
 */
const CLEAR_SIGNER_PUBLIC_KEY = process.env.PRIVY_AUTHORIZATION_PUBLIC_KEY || '';

/** The coarse ceiling. Deliberately generous: the precise cap is the registry's job. */
const POLICY_CEILING_USD = Number(process.env.MERCHANT_POLICY_CEILING_USD || '5000');

let client: PrivyClient | null = null;

function privy(): PrivyClient | null {
  if (!APP_ID || !APP_SECRET) return null;
  if (!client) client = new PrivyClient({ appId: APP_ID, appSecret: APP_SECRET });
  return client;
}

export function clearSignerConfigured(): boolean {
  return privy() !== null && CLEAR_SIGNER_PUBLIC_KEY.length > 0;
}

/**
 * The shop's wallet at Privy, found by ADDRESS.
 *
 * Not by the `privy_wallet_id` we stored: the demo shop's row holds an id Privy answers 404 to,
 * and a lookup that fails silently reads as "no signer attached" — which is the same shape as the
 * real problem it was meant to detect. The address cannot drift, because the address IS the shop:
 * the registry, the cash account and this record all name it by construction.
 */
export async function merchantWallet(address: string): Promise<{ id: string; address: string } | null> {
  const p = privy();
  if (!p) return null;
  try {
    const wallet = await p.wallets().getWalletByAddress({ address });
    return { id: wallet.id, address: wallet.address };
  } catch (error) {
    console.error(
      '[merchant] no Privy wallet at that address',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}

/**
 * Is Clear's key actually on this wallet?
 *
 * Asked of Privy rather than of our own `clear_signer_quorum_id` column, because that column
 * records what onboarding *tried* to do. A shop whose grant never happened, or whose wallet was
 * created before the signer existed, has a row that says nothing and a wallet that refuses to
 * sign — and the difference only shows up when a merchant asks for money.
 *
 * A quorum holding a different key is a different deployment's, and counts as not ours: the
 * fingerprint comparison is what makes that distinction rather than the mere presence of a signer.
 */
export async function clearSignerOnWallet(address: string): Promise<boolean> {
  const p = privy();
  if (!p || !CLEAR_SIGNER_PUBLIC_KEY) return false;
  const wallet = await merchantWallet(address);
  if (!wallet) return false;
  try {
    const full = await p.wallets().get(wallet.id);
    const signers = (full as { additional_signers?: { signer_id?: string }[] }).additional_signers ?? [];
    for (const signer of signers) {
      if (!signer.signer_id) continue;
      const quorum = await p.keyQuorums().get(signer.signer_id).catch(() => null);
      const keys = (quorum?.authorization_keys ?? []) as Array<{ public_key?: string } | string>;
      const has = keys.some((k) => (typeof k === 'string' ? k : k.public_key) === CLEAR_SIGNER_PUBLIC_KEY);
      if (has) return true;
    }
    return false;
  } catch (error) {
    console.error(
      '[merchant] could not read the wallet’s signers',
      error instanceof Error ? error.message : 'unknown error',
    );
    return false;
  }
}

export interface ClearSigner {
  /** The quorum wrapping Clear's authorization key. This is what the wallet lists as a signer. */
  signerQuorumId: string;
  policyId: string;
}

/**
 * Provision Clear's signer for a shop — onboarding step six, once, with the owner's consent.
 *
 * Returns null rather than throwing when Privy is unconfigured or unreachable. A shop that reaches
 * the last step of onboarding and cannot be provisioned should be told the counter is not ready,
 * not handed a stack trace.
 */
export async function provisionClearSigner(input: {
  merchantName: string;
  chainType?: 'ethereum';
}): Promise<ClearSigner | null> {
  const p = privy();
  if (!p || !CLEAR_SIGNER_PUBLIC_KEY) return null;

  try {
    // A quorum of one key. `public_keys` takes P-256 keys in base64-encoded DER, which is exactly
    // what an authorization key is — no Privy user is created and none is needed.
    const signerQuorum = await p.keyQuorums().create({
      display_name: `Clear signer — ${input.merchantName}`,
      public_keys: [CLEAR_SIGNER_PUBLIC_KEY],
    });

    const policy = await p.policies().create({
      name: `Clear ceiling — ${input.merchantName}`,
      chain_type: input.chainType ?? 'ethereum',
      version: '1.0',
      rules: [
        {
          name: `Under $${POLICY_CEILING_USD.toLocaleString('en-US')} per transaction`,
          method: 'eth_sendTransaction',
          action: 'ALLOW',
          conditions: [
            {
              field_source: 'ethereum_transaction',
              field: 'value',
              operator: 'lte',
              // Wei. The ceiling is a native-value bound; the registry enforces the real per-charge
              // cap in cents, which is the number that actually varies per merchant.
              value: String(BigInt(Math.round(POLICY_CEILING_USD)) * 10n ** 18n),
            },
          ],
        },
      ],
    });

    return { signerQuorumId: signerQuorum.id, policyId: policy.id };
  } catch (error) {
    console.error(
      '[merchant] could not provision the Clear signer',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}

/*
 * There is no `attachClearSigner` here, and that is the finding rather than an omission.
 *
 * Adding a signer to a wallet requires authorization from whoever OWNS that wallet, and the owner
 * is a Privy user with a browser session — not something a server holds. Two attempts proved it:
 *
 *   401 Missing `privy-authorization-signature` header or no signatures provided
 *   400 Invalid JWT token provided        (the access token, sent to the wallet JWT exchange)
 *
 * So the grant happens in the owner's browser, with `useSigners().addSigners`, and the server's
 * part is to prepare what they are granting — a key quorum holding Clear's public key, under a
 * policy ceiling — and to check afterwards that it took. `clearSignerGrant` is that pair.
 */

