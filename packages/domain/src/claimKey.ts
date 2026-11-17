/**
 * Send's claim key (audit H-4, ClaimEscrow).
 *
 * A transfer to an email or phone is held in `ClaimEscrow` until it is claimed. The settler key
 * used to choose where a claim went; now the transfer is created with a claim key the sender
 * commits to (`createTransferWithClaimKey`, or `createTransferWithAuthorizationAndClaimKey` when
 * gasless, where the sender's USDC authorization nonce is `transferTermsHash(terms)` so it commits
 * to the key too), and a claim to a wallet needs that key's EIP-712 signature over
 * `Claim(transferId, recipientWallet)` (`claimToWalletWithSignature`). The old `claimToWallet`
 * reverts. Claims are allowed up to and including `expiry`; refunds only after it.
 *
 * The key rides in the claim link. The link already carries a random claim token
 * (`/claim/<token>`); the claim key is derived from it, so the link is the key and nothing new has
 * to travel or be stored:
 *
 *   claimKey = keccak256(utf8("clear-claim-key/v1:" + token))   (a secp256k1 private key)
 *
 * The server generates the token when the transfer is prepared and hands it to the sender's app,
 * which commits the key's address on chain; the server keeps only a peppered hash of the token, as
 * before. The recipient's browser, which has the link, derives the key and signs the claim; the
 * server relays the signature and cannot redirect the money without the link.
 *
 * Like planTerms, no dependencies: callers pass keccak (ethers or viem) and sign with their own
 * library. This file is the one definition of the derivation and the typed data.
 */

export const CLAIM_KEY_DERIVATION_PREFIX = 'clear-claim-key/v1:';

/** The string whose keccak-256 is the claim key's private key. */
export function claimKeySeed(claimToken: string): string {
  return `${CLAIM_KEY_DERIVATION_PREFIX}${claimToken.trim()}`;
}

export const CLAIM_ESCROW_DOMAIN_NAME = 'ClaimEscrow';
export const CLAIM_ESCROW_DOMAIN_VERSION = '1';

export function claimEscrowDomain(chainId: number, escrow: string) {
  return { name: CLAIM_ESCROW_DOMAIN_NAME, version: CLAIM_ESCROW_DOMAIN_VERSION, chainId, verifyingContract: escrow };
}

/** `Claim(bytes32 transferId,address recipientWallet)`: the claim key's consent to one wallet. */
export const CLAIM_TYPES = {
  Claim: [
    { name: 'transferId', type: 'bytes32' },
    { name: 'recipientWallet', type: 'address' },
  ],
} as const;

/** What a gasless sender commits to through the EIP-3009 nonce: every term, the claim key included. */
export const TRANSFER_TERMS_TYPES = {
  TransferTerms: [
    { name: 'transferId', type: 'bytes32' },
    { name: 'principalUsdc', type: 'uint256' },
    { name: 'sponsorFeeUsdc', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'recipientHintHash', type: 'bytes32' },
    { name: 'claimSigner', type: 'address' },
  ],
} as const;

export interface ClaimTransferTerms {
  transferId: string;
  principalUsdc: string;
  sponsorFeeUsdc: string;
  expiry: string;
  recipientHintHash: string;
  claimSigner: string;
}

/** The typed data the claim key signs to send a transfer to `recipientWallet`. */
export function claimTypedData(input: { chainId: number; escrow: string; transferId: string; recipientWallet: string }) {
  return {
    domain: claimEscrowDomain(input.chainId, input.escrow),
    types: CLAIM_TYPES,
    primaryType: 'Claim' as const,
    message: { transferId: input.transferId, recipientWallet: input.recipientWallet },
  };
}

/** Claims stop at expiry (inclusive); after it, the transfer can only be refunded to the sender. */
export function claimWindowOpen(expiresAt: Date | string, now: Date = new Date()): boolean {
  const expiry = Math.floor(new Date(expiresAt).getTime() / 1000);
  return Math.floor(now.getTime() / 1000) <= expiry;
}
