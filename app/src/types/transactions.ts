/**
 * Shared transaction types
 * Used across wallet activity hooks
 */

export interface WalletTransaction {
  id: string;
  type: 'buy' | 'sell' | 'deposit' | 'withdraw' | 'mint' | 'trade' | 'transfer' | 'contract';
  assetSymbol: string;
  assetName?: string;
  amount: number;
  currency: string;
  date: string;
  status: 'completed' | 'pending' | 'failed';
  hash?: string;
  from?: string;
  to?: string;
  timestamp?: number;
}
