import { memberStore } from '../../memberStore.js';

/**
 * What rewards asks of the Clear app's member records (the main database): whether a person is a
 * Clear member, and whether Clear can be sent to them. The API's capability check decides, never
 * the app (rewards spec, "Two levels").
 */
export interface ClearMember {
  /** The member's auth subject, to link the rewards person to. */
  subject: string;
  /** Onboarding submitted and not restricted (`canPayWithClear`). */
  canPayWithClear: boolean;
  /** The name they chose to be seen by, when they set one: "Sofia M.". */
  displayName: string | null;
}

export interface ClearSide {
  member(input: { did: string; wallet: string | null; phone?: string | null; email?: string | null }): Promise<ClearMember | null>;
}

export const defaultClearSide = (): ClearSide => ({
  async member({ did, wallet, phone, email }) {
    if (!memberStore.isConfigured()) return null;
    const subject = await memberStore.resolveCanonicalAuthSubject({ authSubject: did, profileUuid: did, walletAddress: wallet, phone, email });
    if (!subject) return null;
    const capabilities = await memberStore.getCapabilitiesByAuthSubject(subject);
    if (!capabilities) return null;
    const names = wallet ? await memberStore.publicNamesForWallets([wallet]) : new Map<string, string>();
    return { subject, canPayWithClear: capabilities.canPayWithClear, displayName: (wallet && names.get(wallet.toLowerCase())) || null };
  },
});

/** For tests and the mock: a fixed set of members, by DID or wallet. */
export function fixedClearSide(members: Array<{ did?: string; wallet?: string } & ClearMember>): ClearSide {
  return {
    async member({ did, wallet }) {
      const w = wallet?.toLowerCase();
      return members.find((m) => (m.did && m.did === did) || (m.wallet && w && m.wallet.toLowerCase() === w)) ?? null;
    },
  };
}
