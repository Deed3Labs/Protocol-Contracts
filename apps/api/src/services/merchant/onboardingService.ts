import { staffStore } from './staffStore.js';
import { merchantProfileStore } from './profileStore.js';
import {
  createMerchantOrg,
  merchantOrgFor,
  saveMerchantOrg,
  verifyPrivyToken,
} from './privyOrg.js';
import { attachClearSigner, clearSignerConfigured, provisionClearSigner } from './privySigner.js';

/**
 * Bringing a shop into existence — reference section 13.
 *
 * **The shop's identity comes from Privy, not from a form.** Everything else here is chosen by the
 * owner; the merchant address is not. It is the address of the organization wallet Privy creates,
 * and the registry knows the shop by that address — so a charge raised at the counter, the wallet
 * that receives the payout and the row this service writes all name the same thing by
 * construction. Asking an owner to paste an address would make that a hope rather than a fact.
 *
 * **Ordering is not arbitrary and not reorderable.** A key quorum must exist before an
 * organization can name it as its default, the organization must exist before a wallet can be
 * created against it, and a wallet's entity cannot be changed once set. A wallet created against
 * the wrong entity is a wallet that has to be abandoned — so this creates them in that order and
 * writes nothing to Clear's own tables until Privy has given back all three.
 *
 * **Idempotent, because people refresh.** Signup is six steps and a person will reload one of
 * them. Creating a second organization for an owner who already has one would strand a wallet
 * nobody can reach and cannot be undone, so an owner who already has a shop is handed that shop
 * back rather than given another.
 */

export interface OnboardingResult {
  merchant: string;
  walletAddress: string;
  organizationId: string;
  /** False when Clear has no authorization key configured — the shop exists, signing does not. */
  signerReady: boolean;
  /** True when this call created the shop, false when it returned one that already existed. */
  created: boolean;
}

export type OnboardingFailure =
  | { ok: false; reason: 'unverified' }
  | { ok: false; reason: 'privy_unavailable' }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'bad_pin' };

export async function onboardMerchant(input: {
  privyToken: string;
  shopName: string;
  ownerName: string;
  ownerPin: string;
  category?: string | null;
  town?: string | null;
}): Promise<({ ok: true } & OnboardingResult) | OnboardingFailure> {
  const privyUserId = await verifyPrivyToken(input.privyToken);
  if (!privyUserId) return { ok: false, reason: 'unverified' };

  // An owner still gets a four-digit PIN. It starts a shift and attributes charges and does
  // nothing else — their AUTHORITY is the Privy sign-in they just completed. Checked before
  // anything is created at Privy, because a rejected PIN after an organization exists leaves an
  // orphan that cannot be cleaned up.
  if (!/^\d{4}$/.test(input.ownerPin)) return { ok: false, reason: 'bad_pin' };

  // Already has a shop? Hand it back. See the note above about refreshes.
  const existing = await staffStore.shopsForPrivyUser(privyUserId);
  if (existing.length > 0) {
    const merchant = existing[0]!.merchant;
    const org = await merchantOrgFor(merchant);
    if (org) {
      return {
        ok: true,
        created: false,
        merchant,
        walletAddress: org.walletAddress,
        organizationId: org.organizationId,
        signerReady: clearSignerConfigured(),
      };
    }
  }

  const org = await createMerchantOrg({
    displayName: input.shopName.trim(),
    ownerPrivyUserId: privyUserId,
  });
  if (!org) return { ok: false, reason: 'privy_unavailable' };

  const merchant = org.walletAddress.trim().toLowerCase();

  const created = await merchantProfileStore.create({
    merchant,
    name: input.shopName.trim(),
    category: input.category ?? null,
    town: input.town ?? null,
  });
  if (!created && !(await merchantOrgFor(merchant))) {
    // The profile row is the one thing this needs and could not get. Without it nothing else has
    // anywhere to hang.
    return { ok: false, reason: 'not_configured' };
  }

  await saveMerchantOrg(merchant, org);

  const owner = await staffStore.add({
    merchant,
    name: input.ownerName.trim(),
    role: 'owner',
    secret: input.ownerPin,
  });
  if (!owner) return { ok: false, reason: 'not_configured' };
  await staffStore.linkPrivyUser(owner.id, privyUserId);

  /**
   * Clear's own signer, last and optional.
   *
   * A shop whose organization and wallet exist is a shop that can be signed into and set up, even
   * if Clear cannot yet sign on its behalf — so a missing authorization key must not fail
   * onboarding six steps in. It reports `signerReady: false` and the shop is completed later.
   */
  let signerReady = false;
  if (clearSignerConfigured()) {
    const signer = await provisionClearSigner({ merchantName: input.shopName.trim() });
    if (signer && (await attachClearSigner({ walletId: org.walletId, signer }))) {
      await merchantProfileStore.setClearSigner(merchant, signer.signerQuorumId, signer.policyId);
      signerReady = true;
    }
  }

  return {
    ok: true,
    created: true,
    merchant,
    walletAddress: org.walletAddress,
    organizationId: org.organizationId,
    signerReady,
  };
}
