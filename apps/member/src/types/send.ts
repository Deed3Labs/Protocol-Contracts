export type SendFundingSource = 'WALLET_USDC' | 'CARD_ONRAMP' | 'BANK_ONRAMP';

export type SendTransferStatus =
  | 'PREPARED'
  | 'LOCK_CONFIRMED'
  | 'CLAIM_STARTED'
  | 'CLAIMED_DEBIT'
  | 'CLAIMED_BANK'
  | 'CLAIMED_WALLET'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'FAILED';

export type ClaimPayoutMethod = 'DEBIT' | 'BANK' | 'WALLET';

export interface SendTransferSummary {
  id: number;
  transferId: string;
  principalUsdc: string;
  sponsorFeeUsdc: string;
  totalLockedUsdc: string;
  recipientHintHash: string;
  chainId: number;
  expiresAt: string;
  status: SendTransferStatus;
  region: string;
  payoutMethods: ClaimPayoutMethod[];
  /** The ClaimEscrow the claim key signs for (audit H-4). */
  escrowAddress?: string | null;
}

export interface PrepareSendTransferRequest {
  recipient: string;
  amount: string;
  fundingSource: SendFundingSource;
  memo?: string;
  region?: string;
  chainId?: number;
}

export interface PrepareSendTransferResponse {
  transfer: SendTransferSummary;
  /**
   * The claim link's token and the address of the claim key it derives (audit H-4). The lock
   * commits `signer` on chain; the token goes back to the server to confirm, which sends the link.
   */
  claim: { token: string; signer: string };
  recipient: {
    type: 'email' | 'phone';
    masked: string;
  };
  limits: {
    dailyCapUsdc: string;
    dailyUsedUsdc: string;
  };
}

export interface ConfirmSendTransferLockRequest {
  transferId: string;
  escrowTxHash: string;
  /** From prepare: the lock committed its claim key, and the link is built from it. */
  claimToken: string;
  /** True when the lock was an AA UserOp — server verifies via the on-chain event, not the outer tx. */
  aa?: boolean;
}

export interface ConfirmSendTransferLockResponse {
  transfer: SendTransferSummary;
  claimUrl: string;
  notificationWarning?: string;
}

export interface ClaimSession {
  claimSessionId: number;
  otpExpiresAt: string;
  maxAttempts: number;
  resendCooldownSeconds: number;
  recipientMasked: string;
  transfer: SendTransferSummary;
}

export interface VerifyClaimOtpResponse {
  claimSessionToken: string;
  transfer: SendTransferSummary;
  payoutMethods: ClaimPayoutMethod[];
}

export interface ClaimPayoutResponse {
  success: boolean;
  method?: ClaimPayoutMethod;
  provider?: string;
  providerReference?: string;
  treasuryTxHash?: string;
  walletTxHash?: string;
  eta?: string;
  status?: string;
  fallbackMethod?: 'BANK';
  reason?: string;
  action?: 'STRIPE_ONBOARDING' | 'BRIDGE_ONBOARDING';
  onboardingUrl?: string;
  bridgeCustomerId?: string;
  bridgeExternalAccountId?: string;
}
