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
