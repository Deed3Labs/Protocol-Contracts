import { keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CLAIM_TYPES, claimKeySeed, claimTypedData } from '@clear/domain';

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

/** The claim key's address for a token: what the lock committed. */
export function claimSignerOf(claimToken: string): string {
  return privateKeyToAccount(keccak256(toBytes(claimKeySeed(claimToken)))).address;
}
