import { keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CLAIM_TYPES, PAYOUT_CLAIM_TYPES, claimKeySeed, claimTypedData, payoutClaimTypedData } from '@clear/domain';

/*
 * The claim link is the claim key (audit H-4, ClaimEscrow).
 *
 * A Send to an email or phone is locked with a claim key the sender committed to. Claiming to a
 * wallet needs that key's EIP-712 signature over Claim(transferId, recipientWallet); the escrow
 * releases the money only to the wallet the key signed for, so the server relays the claim but
 * cannot redirect it. The key is derived from the token in the link (@clear/domain claimKey), here,
 * in the recipient's browser, and never sent anywhere: only the signature leaves.
 */

/** Sign Claim(transferId, recipientWallet) with the key the claim token derives. */
export async function signClaimToWallet(args: {
  claimToken: string;
  chainId: number;
  escrow: string;
  transferId: string;
  recipientWallet: string;
}): Promise<string> {
  const key = privateKeyToAccount(keccak256(toBytes(claimKeySeed(args.claimToken))));
  const td = claimTypedData({
    chainId: args.chainId,
    escrow: args.escrow,
    transferId: args.transferId,
    recipientWallet: args.recipientWallet,
  });
  return key.signTypedData({
    domain: { ...td.domain, verifyingContract: td.domain.verifyingContract as `0x${string}` },
    types: CLAIM_TYPES,
    primaryType: 'Claim',
    message: {
      transferId: td.message.transferId as `0x${string}`,
      recipientWallet: td.message.recipientWallet as `0x${string}`,
    },
  });
}

/**
 * Sign PayoutClaim(transferId, payoutTreasury, payoutRefHash) with the key the claim token derives
 * (Phase 2d, L-D): consent to a card or bank payout through the co-op's treasury. The typed data
 * comes from the server; it is checked here against this transfer and this escrow first.
 */
export async function signPayoutClaim(args: {
  claimToken: string;
  typedData: ReturnType<typeof payoutClaimTypedData>;
  expected: { chainId: number; escrow: string; transferId: string };
}): Promise<string> {
  const td = args.typedData;
  if (
    td.primaryType !== 'PayoutClaim' ||
    Number(td.domain.chainId) !== args.expected.chainId ||
    td.domain.verifyingContract.toLowerCase() !== args.expected.escrow.toLowerCase() ||
    td.message.transferId.toLowerCase() !== args.expected.transferId.toLowerCase()
  ) {
    throw new Error('This payout is not for this transfer. Nothing was signed.');
  }
  const key = privateKeyToAccount(keccak256(toBytes(claimKeySeed(args.claimToken))));
  return key.signTypedData({
    domain: { ...td.domain, verifyingContract: td.domain.verifyingContract as `0x${string}` },
    types: PAYOUT_CLAIM_TYPES,
    primaryType: 'PayoutClaim',
    message: {
      transferId: td.message.transferId as `0x${string}`,
      payoutTreasury: td.message.payoutTreasury as `0x${string}`,
      payoutRefHash: td.message.payoutRefHash as `0x${string}`,
    },
  });
}

/** The claim key's address for a token: what the lock committed. */
export function claimSignerOf(claimToken: string): string {
  return privateKeyToAccount(keccak256(toBytes(claimKeySeed(claimToken)))).address;
}
