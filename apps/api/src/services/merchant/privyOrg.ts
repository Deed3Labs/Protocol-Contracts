import { PrivyClient } from '@privy-io/node';
import { MERCHANT_SCHEMA, ensureMerchantSchema, getMerchantPool } from '../../config/merchantDb.js';

/**
 * The merchant as a Privy organization.
 *
 * **The shop is the organization; the owner is its admin; the wallet belongs to the organization.**
 * Jen raising a charge at the counter is Mike's Tire acting, not Jen acting — and that is not a
 * turn of phrase, it is why the wallet is an org wallet rather than the owner's personal one. A
 * shop that changes hands, or has two owners, or fires the person whose wallet held the money, all
 * work; with an individual wallet none of them do.
 *
 * **Staff are not Privy users and never will be.** Privy organizations do assume members are Privy
 * users — the key quorum is built from them — so the mapping puts the *device* in that role rather
 * than the staff:
 *
 *   organization  →  the merchant
 *   key quorum    →  the owner (and any co-owners)
 *   scoped member →  an enrolled device, capped and restricted to raising charges
 *   staff         →  Clear's own records; a PIN attributes a charge and authorises nothing
 *
 * A counter worker will not manage keys or recovery, turnover would mean provisioning an identity
 * per hire, and the money is the business's rather than the employee's. Modelling the device
 * instead gets the same audit trail with none of that.
 *
 * This module is deliberately tolerant of not being configured. A Privy app without organizations
 * enabled, or a missing key, returns null rather than throwing — onboarding then reports honestly
 * that the wallet could not be created, which is far better than a shop that believes it is set up.
 */

const APP_ID = process.env.PRIVY_APP_ID || '';
const APP_SECRET = process.env.PRIVY_APP_SECRET || '';

let client: PrivyClient | null = null;

function privy(): PrivyClient | null {
  if (!APP_ID || !APP_SECRET) return null;
  if (!client) client = new PrivyClient({ appId: APP_ID, appSecret: APP_SECRET });
  return client;
}

export function privyOrgsConfigured(): boolean {
  return privy() !== null;
}

export interface MerchantOrg {
  organizationId: string;
  walletId: string;
  /** The address the MerchantRegistry knows this shop by. */
  walletAddress: string;
  keyQuorumId: string;
}

/**
 * Create the organization and its wallet for a shop being onboarded.
 *
 * Order matters and is not arbitrary: a key quorum has to exist before an organization can name it
 * as its default, and the organization has to exist before a wallet can be created against it. A
 * wallet's entity cannot be changed once set, so a wallet created against the wrong entity is a
 * wallet that has to be abandoned.
 *
 * `ownerPrivyUserId` is the owner's own Privy user — they signed in with an emailed code or a
 * passkey before reaching this step, so it already exists.
 */
export async function createMerchantOrg(input: {
  displayName: string;
  ownerPrivyUserId: string;
}): Promise<MerchantOrg | null> {
  const p = privy();
  if (!p) return null;

  try {
    // The owner owns and administers the wallet. Additional owners can be added to the quorum
    // later without touching the wallet, which is the point of a quorum rather than a single key.
    // Resources are call-and-then-use: `privy.keyQuorums().create(...)`. The package ships a
    // second entry point whose types read as plain properties, which is a trap — what the compiler
    // resolves here is the method form, and it is the one the docs show.
    const quorum = await p.keyQuorums().create({
      display_name: `${input.displayName} owners`,
      user_ids: [input.ownerPrivyUserId],
    });

    const organization = await p.organizations().create({
      display_name: input.displayName,
      default_key_quorum_id: quorum.id,
    });

    // Omitting owner details makes the organization's default key quorum the wallet's owner.
    const wallet = await p.wallets().create({
      chain_type: 'ethereum',
      entity: { id: organization.id, type: 'organization' },
    });

    return {
      organizationId: organization.id,
      walletId: wallet.id,
      walletAddress: wallet.address,
      keyQuorumId: quorum.id,
    };
  } catch (error) {
    // Never a throw into onboarding. A shop mid-signup that hits an unavailable Privy should be
    // told the wallet is not ready, not shown a stack trace at step five of six.
    console.error(
      '[merchant] could not create the organization',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}

/**
 * Verify an owner's Privy access token and return their user id.
 *
 * Uses `@privy-io/server-auth`, the same local JWT check the member API already relies on, rather
 * than the org SDK — the two packages sit side by side because they do different jobs: one
 * authenticates people, the other administers organizations.
 *
 * Null on any failure. A token that cannot be verified is not an owner, and there is nothing more
 * useful to say about it than that.
 */
export async function verifyPrivyToken(token: string): Promise<string | null> {
  if (!APP_ID || !APP_SECRET) return null;
  try {
    const { PrivyClient: AuthClient } = await import('@privy-io/server-auth');
    const auth = new AuthClient(APP_ID, APP_SECRET);
    const claims = await auth.verifyAuthToken(token);
    return claims.userId;
  } catch (error) {
    console.error(
      '[merchant] owner token verification failed',
      error instanceof Error ? error.message : 'unknown error',
    );
    return null;
  }
}

/** Record the organization against the shop, so later calls do not have to ask Privy. */
export async function saveMerchantOrg(merchant: string, org: MerchantOrg): Promise<void> {
  const pool = getMerchantPool();
  if (!pool) return;
  await ensureMerchantSchema();
  await pool.query(
    `UPDATE ${MERCHANT_SCHEMA}.profiles
        SET privy_org_id = $2, privy_wallet_id = $3, key_quorum_id = $4
      WHERE merchant = $1`,
    [merchant.trim().toLowerCase(), org.organizationId, org.walletId, org.keyQuorumId],
  );
}

export async function merchantOrgFor(merchant: string): Promise<MerchantOrg | null> {
  const pool = getMerchantPool();
  if (!pool) return null;
  await ensureMerchantSchema();
  const { rows } = await pool.query<{
    merchant: string;
    privy_org_id: string | null;
    privy_wallet_id: string | null;
    key_quorum_id: string | null;
  }>(
    `SELECT merchant, privy_org_id, privy_wallet_id, key_quorum_id
       FROM ${MERCHANT_SCHEMA}.profiles WHERE merchant = $1`,
    [merchant.trim().toLowerCase()],
  );
  const row = rows[0];
  if (!row?.privy_org_id || !row.privy_wallet_id) return null;
  return {
    organizationId: row.privy_org_id,
    walletId: row.privy_wallet_id,
    // The merchant address IS the org wallet's address — that is the whole identity.
    walletAddress: row.merchant,
    keyQuorumId: row.key_quorum_id ?? '',
  };
}

/**
 * Is this Privy user an owner of this shop?
 *
 * The question every privileged action asks. Answered from Clear's own staff table rather than by
 * calling Privy on each request: the org's quorum is the source of truth for *signing*, and this
 * table is the source of truth for *who may ask*. They are set together at onboarding and when an
 * owner is added, and keeping the check local means a payout screen does not depend on an RPC.
 */
export async function isOwnerOf(merchant: string, privyUserId: string): Promise<boolean> {
  const pool = getMerchantPool();
  if (!pool) return false;
  await ensureMerchantSchema();
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM ${MERCHANT_SCHEMA}.staff
      WHERE merchant = $1 AND privy_user_id = $2 AND role = 'owner' AND active = true`,
    [merchant.trim().toLowerCase(), privyUserId],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}
