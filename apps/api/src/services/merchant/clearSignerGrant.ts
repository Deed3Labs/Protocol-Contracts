import { merchantOrgFor } from './privyOrg.js';
import { merchantProfileStore } from './profileStore.js';
import {
  applyClearSigner,
  clearSignerConfigured,
  clearSignerOnWallet,
  merchantWallet,
  provisionClearSigner,
  signableSignerRequest,
} from './privySigner.js';
import { redemptionGap } from './payoutRedemption.js';

/*
 * Letting Clear settle a shop's payouts: what the server prepares, and what the owner grants.
 *
 * Onboarding was written as though the server could attach its own signer. It cannot, and two
 * refusals from Privy say why:
 *
 *   401 Missing `privy-authorization-signature` header or no signatures provided
 *   400 Invalid JWT token provided        (an access token, sent to the wallet JWT exchange)
 *
 * The wallet is owned by the owner's key quorum, so widening who may act on it takes the owner's
 * own authorization — which lives in their browser session, not in anything a server holds. That
 * is the wallet working correctly: Clear cannot quietly add itself as a signer on a shop's money.
 *
 * So the work splits three ways:
 *
 *   prepare   here. A key quorum of one holding Clear's public key, and a policy ceiling, plus the
 *             EXACT request that would add them — inert until somebody signs it, and safe to
 *             re-run: the ids are recorded and reused, so a second press is the same offer rather
 *             than another quorum nobody attached.
 *   sign      the owner's browser, `useAuthorizationSignature`. Not `addSigners`, which refuses an
 *             organization's wallet outright:
 *
 *               Address to add signers too is not associated with current user
 *
 *             — because the wallet belongs to the shop, not to the person. What the owner CAN do
 *             is authorize one specific request with their own key, which is the narrower and more
 *             honest thing anyway: they sign the sentence "add this quorum under this policy", not
 *             a session that could later mean anything.
 *   confirm   here. Send the signed request, then ask Privy whether the key is really on the
 *             wallet — being told a grant happened and it having happened are different facts.
 */

export interface ClearSignerStatus {
  /** Whether Clear's key is on this shop's wallet, as Privy reports it. */
  attached: boolean;
  /** Whether a redemption could actually be sent today: the key, plus sponsorship. */
  canRedeem: boolean;
  /** What is missing, in the words an owner should read. Null when nothing is. */
  gap: string | null;
}

export async function clearSignerStatus(merchant: string): Promise<ClearSignerStatus> {
  const org = await merchantOrgFor(merchant);
  if (!org) return { attached: false, canRedeem: false, gap: 'This shop has no wallet on file.' };
  if (!clearSignerConfigured()) {
    return {
      attached: false,
      canRedeem: false,
      gap: "Clear's signing key is not configured on this server.",
    };
  }

  const attached = await clearSignerOnWallet(org.walletAddress);
  const sponsorship = redemptionGap();
  return {
    attached,
    canRedeem: attached && sponsorship === null,
    gap: attached ? sponsorship : 'Clear cannot act on this shop’s wallet yet.',
  };
}

export interface PreparedSigner {
  /** The wallet the owner is granting on — their own shop's address. */
  walletAddress: string;
  /** The key quorum holding Clear's public key. */
  signerId: string;
  /** The ceiling that quorum acts under. */
  policyId: string;
  /**
   * The request, exactly as it will be sent, for the owner to sign.
   *
   * Byte-for-byte matters: the signature covers a canonicalization of this object, and the server
   * rebuilds the same request when it sends it. That is also what makes the grant narrow — this
   * authorizes one PATCH adding one quorum, and nothing else.
   */
  authorization: NonNullable<ReturnType<typeof signableSignerRequest>>['payload'];
  /** Included in the signed headers, so both sides must use this one value. */
  requestExpiry: number;
}

/**
 * What the owner will be granting, created if it does not exist yet.
 *
 * Reuses whatever this shop already has recorded. A quorum is cheap but not free: one per press
 * would leave a trail of unattached quorums each holding a live key and each indistinguishable
 * from the real one.
 */
export async function prepareClearSigner(
  merchant: string,
): Promise<{ ok: true; prepared: PreparedSigner } | { ok: false; reason: string }> {
  const org = await merchantOrgFor(merchant);
  if (!org) return { ok: false, reason: 'This shop has no wallet on file.' };
  if (!clearSignerConfigured()) {
    return { ok: false, reason: "Clear's signing key is not configured on this server." };
  }

  // The address is the shop; the wallet id we stored may not be — the demo shop's row holds one
  // Privy answers 404 to. Resolved here so a bad row fails with a sentence rather than as a grant
  // that appears to work and signs nothing.
  const wallet = await merchantWallet(org.walletAddress);
  if (!wallet) return { ok: false, reason: 'Privy has no wallet at this shop’s address.' };

  const existing = await merchantProfileStore.clearSignerIds(merchant);
  let signerId = existing?.signerQuorumId ?? null;
  let policyId = existing?.policyId ?? null;

  if (!signerId || !policyId) {
    const signer = await provisionClearSigner({ merchantName: merchant.slice(0, 10) });
    if (!signer) return { ok: false, reason: 'Clear could not prepare its signer just now.' };
    await merchantProfileStore.setClearSigner(merchant, signer.signerQuorumId, signer.policyId);
    signerId = signer.signerQuorumId;
    policyId = signer.policyId;
  }

  const request = signableSignerRequest({ walletId: wallet.id, signerId, policyId });
  if (!request) return { ok: false, reason: 'Privy is not configured on this server.' };
  return {
    ok: true,
    prepared: {
      walletAddress: wallet.address,
      signerId,
      policyId,
      authorization: request.payload,
      requestExpiry: request.requestExpiry,
    },
  };
}

/**
 * Send what the owner signed, then check what Privy actually did.
 *
 * The signature is the whole of the authorization: Clear holds no power to add itself here, and a
 * signature over a different request would simply be rejected. Checking afterwards is not
 * belt-and-braces — a 200 on the PATCH and the key being on the wallet are the same thing today,
 * and the day they are not is the day a merchant cannot be paid for a reason nobody can see.
 */
export async function confirmClearSigner(input: {
  merchant: string;
  signature: string;
  requestExpiry: number;
}): Promise<{ ok: true; status: ClearSignerStatus } | { ok: false; reason: string }> {
  const org = await merchantOrgFor(input.merchant);
  if (!org) return { ok: false, reason: 'This shop has no wallet on file.' };
  const wallet = await merchantWallet(org.walletAddress);
  if (!wallet) return { ok: false, reason: 'Privy has no wallet at this shop’s address.' };

  const ids = await merchantProfileStore.clearSignerIds(input.merchant);
  if (!ids?.signerQuorumId || !ids.policyId) {
    return { ok: false, reason: 'Nothing was prepared to grant. Try again.' };
  }

  const applied = await applyClearSigner({
    walletId: wallet.id,
    signerId: ids.signerQuorumId,
    policyId: ids.policyId,
    signature: input.signature,
    requestExpiry: input.requestExpiry,
  });
  if (!applied.ok) return { ok: false, reason: applied.reason };

  return { ok: true, status: await clearSignerStatus(input.merchant) };
}
