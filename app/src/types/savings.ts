export type SavingsIntentAction = 'deposit' | 'redeem';

export interface CreateSavingsIntentRequest {
  action: SavingsIntentAction;
  ownerWallet: string;
  receiverWallet?: string;
  amount: string;
  chainId?: number;
}

export interface CreateSavingsIntentResponse {
  action: SavingsIntentAction;
  chainId: number;
  escrowAddress: string;
  transferToken: string;
  vaultToken: string;
  vaultAddress: string;
  ownerWallet: string;
  receiverWallet: string;
  amount: string;
  amountMicros: string;
  expiryAt: string;
  intentToken: string;
}

export interface FinalizeSavingsIntentResponse {
  success: boolean;
  action: SavingsIntentAction;
  escrowAddress: string;
  fundingTxHash: string;
  settlementTxHash: string | null;
  status: 'FINALIZED';
}

export interface RefundSavingsIntentResponse {
  success: boolean;
  action: SavingsIntentAction;
  escrowAddress: string;
  refundTxHash: string;
  status: 'REFUNDED';
}
