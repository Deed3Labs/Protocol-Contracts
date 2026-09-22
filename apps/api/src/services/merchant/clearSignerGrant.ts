import { merchantOrgFor, verifyPrivyToken } from './privyOrg.js';
import { merchantProfileStore } from './profileStore.js';
import {
  attachClearSigner,
  clearSignerConfigured,
  clearSignerOnWallet,
  provisionClearSigner,
} from './privySigner.js';
import { redemptionGap } from './payoutRedemption.js';

/*
 * The one-time grant that lets Clear settle a shop's payouts, for shops that predate it.
 *
 * Onboarding does this at step six. Every shop created before step six existed — and every shop
 * onboarded while the authorization key was missing — has a wallet only its owner can sign for, so
 * redemption cannot work however well the rest of it is configured. The demo shop on Base Sepolia
 * was exactly that: registered, active, holding 97.50, `additional_signers: []`.
 *
 * It cannot be fixed from the server alone, and that is the wallet behaving correctly. Privy
 * refuses the change without authorization from whoever owns the wallet:
 *
 *   401 Missing `privy-authorization-signature` header or no signatures provided
 *
 * So the owner's own Privy token is the consent, and this is the shape of the thing: the owner
 * agrees, in their own session, on their own device, and Clear's key is added in that moment.
 */

export interface ClearSignerStatus {
  /** Whether Clear's key is attached to this shop's wallet. */
  attached: boolean;
  /** Whether a redemption could actually be sent today: the key, plus sponsorship. */
  canRedeem: boolean;
  /** What is missing, in the words an owner should read. Null when nothing is. */
  gap: string | null;
}

export async function clearSignerStatus(merchant: string): Promise<ClearSignerStatus> {
  const org = await merchantOrgFor(merchant);
  if (!org) {
    return { attached: false, canRedeem: false, gap: 'This shop has no wallet on file.' };
  }
  if (!clearSignerConfigured()) {
    return { attached: false, canRedeem: false, gap: "Clear's signing key is not configured on this server." };
  }

  const attached = await clearSignerOnWallet(org.walletId);
  const sponsorship = redemptionGap();
  return {
    attached,
    canRedeem: attached && sponsorship === null,
    gap: attached ? sponsorship : 'Clear cannot act on this shop’s wallet yet.',
  };
}

/**
 * Attach Clear's signer, with the owner's consent.
 *
 * The token is verified twice over: Privy says which user it belongs to, and Clear's own staff
 * table says whether that user owns this shop. Either alone would be weaker — the first would let
 * any owner grant on any shop, the second would trust our own record about somebody else's wallet.
 */
export async function grantClearSigner(input: {
  merchant: string;
  ownerJwt: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const org = await merchantOrgFor(input.merchant);
  if (!org) return { ok: false, reason: 'This shop has no wallet on file.' };
  if (!clearSignerConfigured()) {
    return { ok: false, reason: "Clear's signing key is not configured on this server." };
  }

  const privyUserId = await verifyPrivyToken(input.ownerJwt);
  if (!privyUserId) return { ok: false, reason: 'That sign-in could not be verified. Sign in again.' };
  const { isOwnerOf } = await import('./privyOrg.js');
  if (!(await isOwnerOf(input.merchant, privyUserId))) {
    return { ok: false, reason: 'Only an owner of this shop can allow that.' };
  }

  if (await clearSignerOnWallet(org.walletId)) return { ok: true };

  const signer = await provisionClearSigner({ merchantName: input.merchant.slice(0, 10) });
  if (!signer) return { ok: false, reason: 'Clear could not prepare its signer just now.' };

  const attached = await attachClearSigner({ walletId: org.walletId, signer, ownerJwt: input.ownerJwt });
  if (!attached.ok) return { ok: false, reason: attached.reason };

  await merchantProfileStore.setClearSigner(input.merchant, signer.signerQuorumId, signer.policyId);
  return { ok: true };
}
