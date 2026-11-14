/*
 * DeedNFT v5's trust record, as the app needs it (docs/audit/DEED-V5-INTERFACE.md).
 *
 * Land and Estate deeds are trust deeds: they carry a trustee, a protector (zero means the current
 * holder), a transfer policy fixed at mint, a status, and a beneficial owner who is not the holder.
 * DeedNFT serves these from its fallback (`IDeedTrust`), so they are called on the DeedNFT address with
 * the merged ABI in contracts/<chain>/DeedNFT.json. On a v4 DeedNFT, or a Vehicle or Equipment deed,
 * there is no trust record and nothing here applies.
 */

export const TRANSFER_POLICIES = ['Open', 'Verified', 'Coop'] as const;
export const DEED_STATUSES = ['Active', 'Retired', 'Void'] as const;

export interface DeedTrust {
  trustee: string;
  trusteeSuspended: boolean;
  /** Zero means the current holder is the protector. */
  protector: string;
  transferPolicy: (typeof TRANSFER_POLICIES)[number];
  status: (typeof DEED_STATUSES)[number];
  /** Reason codes from 128 freeze the deed: no transfer but burning. */
  voidReason: number;
  beneficialOwner: string;
}

type TrustReader = {
  isTrustDeed(tokenId: bigint): Promise<boolean>;
  trustRecordOf(tokenId: bigint): Promise<Record<string, unknown>>;
  beneficialOwnerOf(tokenId: bigint): Promise<string>;
};

/** The trust record of one deed, or null for a legacy deed or a DeedNFT before v5. Never throws. */
export async function deedTrustOf(contract: TrustReader, tokenId: string | bigint): Promise<DeedTrust | null> {
  try {
    const id = BigInt(tokenId);
    if (!(await contract.isTrustDeed(id))) return null;
    const [r, beneficial] = await Promise.all([contract.trustRecordOf(id), contract.beneficialOwnerOf(id)]);
    return {
      trustee: String(r.trustee),
      trusteeSuspended: Boolean(r.trusteeSuspended),
      protector: String(r.protector),
      transferPolicy: TRANSFER_POLICIES[Number(r.transferPolicy)] ?? 'Open',
      status: DEED_STATUSES[Number(r.status)] ?? 'Active',
      voidReason: Number(r.voidReason ?? 0),
      beneficialOwner: String(beneficial),
    };
  } catch {
    return null;
  }
}

/**
 * Why a direct transfer of this deed would be refused by the contract's transfer rules (item 9 and
 * item 10), in a sentence; null when it may go ahead. A Verified deed may still be refused if the
 * recipient is not a member in good standing, which only the chain can say at the time.
 */
export function transferBlockedReason(trust: DeedTrust | null | undefined): string | null {
  if (!trust) return null;
  if (trust.status === 'Retired') return 'This deed is retired and can no longer be transferred.';
  if (trust.status === 'Void' && trust.voidReason >= 128) return 'This deed is frozen by its validator and can’t be transferred.';
  if (trust.transferPolicy === 'Coop') {
    return 'This deed changes hands only through the co-op’s transfer agent (Coop policy): list it there instead of sending it directly.';
  }
  return null;
}

/** A note to show before a transfer that may still be refused. */
export function transferNote(trust: DeedTrust | null | undefined): string | null {
  if (trust?.transferPolicy === 'Verified') return 'Verified policy: the recipient must be a Clear member in good standing, or the transfer is refused.';
  return null;
}
