/**
 * Shared transaction types
 * Used across wallet activity hooks
 */

export interface WalletTransaction {
  id: string;
  chainId?: number;
  chainName?: string;
  type: 'buy' | 'sell' | 'deposit' | 'withdraw' | 'mint' | 'trade' | 'transfer' | 'contract';
  assetSymbol: string;
  assetName?: string;
  assetAddress?: string | null;
  amount: number;
  amountUsd?: number | null;
  currency: string;
  date: string;
  status: 'completed' | 'pending' | 'failed';
  hash?: string;
  from?: string;
  to?: string;
  timestamp?: number;
}
