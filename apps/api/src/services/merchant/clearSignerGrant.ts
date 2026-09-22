import { merchantOrgFor } from './privyOrg.js';
import { merchantProfileStore } from './profileStore.js';
import {
  clearSignerConfigured,
  clearSignerOnWallet,
  merchantWallet,
  provisionClearSigner,
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
 *   prepare   here. A key quorum of one holding Clear's public key, and a policy ceiling. Inert
 *             until somebody grants it, and safe to re-run: the ids are recorded and reused, so a
 *             second press is the same offer rather than another quorum nobody attached.
 *   grant     the owner's browser, `useSigners().addSigners`.
 *   confirm   here. Ask Privy whether the key is really on the wallet, because being told the
 *             grant happened and it having happened are different facts.
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
  if (existing?.signerQuorumId && existing.policyId) {
    return {
      ok: true,
      prepared: {
        walletAddress: wallet.address,
        signerId: existing.signerQuorumId,
        policyId: existing.policyId,
      },
    };
  }

  const signer = await provisionClearSigner({ merchantName: merchant.slice(0, 10) });
  if (!signer) return { ok: false, reason: 'Clear could not prepare its signer just now.' };
  await merchantProfileStore.setClearSigner(merchant, signer.signerQuorumId, signer.policyId);
  return {
    ok: true,
    prepared: {
      walletAddress: wallet.address,
      signerId: signer.signerQuorumId,
      policyId: signer.policyId,
    },
  };
}

/**
 * Did the grant take?
 *
 * Asked of Privy rather than believed from the caller: the browser reporting success and the
 * wallet carrying the key are different facts, and the second is the one that matters when a
 * merchant asks for money.
 */
export async function confirmClearSigner(merchant: string): Promise<ClearSignerStatus> {
  return clearSignerStatus(merchant);
}
