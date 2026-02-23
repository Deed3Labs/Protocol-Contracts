import { sendRelayerService } from './sendRelayerService.js';
import type { SendTransferRecord } from './sendTransferStore.js';

export interface DebitPayoutResult {
  status: 'SUCCESS' | 'FALLBACK_REQUIRED' | 'FAILED';
  provider: string;
  providerReference?: string;
  failureCode?: string;
  failureReason?: string;
  fallbackMethod?: 'BANK';
  treasuryTxHash?: string;
}

export interface BankPayoutResult {
  status: 'SUCCESS' | 'FAILED';
  provider: string;
  providerReference?: string;
  failureCode?: string;
  failureReason?: string;
  treasuryTxHash?: string;
  eta?: string;
}

export interface WalletPayoutResult {
  status: 'SUCCESS' | 'FAILED';
  provider: string;
  providerReference?: string;
  walletTxHash?: string;
  failureCode?: string;
  failureReason?: string;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class SendPayoutService {
  private readonly debitProvider = process.env.SEND_DEBIT_PROVIDER || 'mock-debit';
  private readonly bankProvider = process.env.SEND_BANK_PROVIDER || 'mock-bank';

  async executeDebitPayout(transfer: SendTransferRecord): Promise<DebitPayoutResult> {
    const debitEnabledRegions = (process.env.SEND_DEBIT_ENABLED_REGIONS || 'US')
      .split(',')
      .map((region) => region.trim().toUpperCase())
      .filter(Boolean);

    const transferRegion = transfer.region.toUpperCase();
    if (!debitEnabledRegions.includes(transferRegion)) {
      return {
        status: 'FALLBACK_REQUIRED',
        provider: this.debitProvider,
        failureCode: 'DEBIT_REGION_UNSUPPORTED',
        failureReason: `Debit payout is not enabled in ${transferRegion}`,
        fallbackMethod: 'BANK',
      };
    }

    const forceFallback = (process.env.SEND_FORCE_DEBIT_FALLBACK || 'false') === 'true';
    const debitMaxUsdc = parseIntEnv('SEND_DEBIT_MAX_USDC_MICROS', 2_500_000_000); // 2,500 USDC
    const principalMicros = BigInt(transfer.principalUsdc);

    if (forceFallback || principalMicros > BigInt(debitMaxUsdc)) {
      return {
        status: 'FALLBACK_REQUIRED',
        provider: this.debitProvider,
        failureCode: 'DEBIT_INELIGIBLE',
        failureReason: 'Card payout ineligible for this recipient or amount',
        fallbackMethod: 'BANK',
      };
    }

    try {
      const treasuryTx = await sendRelayerService.claimToPayoutTreasury(transfer.transferId);
      return {
        status: 'SUCCESS',
        provider: this.debitProvider,
        providerReference: `debit_${transfer.id}_${Date.now()}`,
        treasuryTxHash: treasuryTx.txHash,
      };
    } catch (error) {
      return {
        status: 'FAILED',
        provider: this.debitProvider,
        failureCode: 'DEBIT_PAYOUT_ERROR',
        failureReason: error instanceof Error ? error.message : 'Debit payout execution failed',
      };
    }
  }

  async executeBankPayout(transfer: SendTransferRecord): Promise<BankPayoutResult> {
    try {
      const treasuryTx = await sendRelayerService.claimToPayoutTreasury(transfer.transferId);

      return {
        status: 'SUCCESS',
        provider: this.bankProvider,
        providerReference: `bank_${transfer.id}_${Date.now()}`,
        treasuryTxHash: treasuryTx.txHash,
        eta: '1-3 business days',
      };
    } catch (error) {
      return {
        status: 'FAILED',
        provider: this.bankProvider,
        failureCode: 'BANK_PAYOUT_ERROR',
        failureReason: error instanceof Error ? error.message : 'Bank payout execution failed',
      };
    }
  }

  async executeWalletPayout(transfer: SendTransferRecord, recipientWallet: string): Promise<WalletPayoutResult> {
    try {
      const walletTx = await sendRelayerService.claimToWallet(transfer.transferId, recipientWallet);
      return {
        status: 'SUCCESS',
        provider: 'send-relayer',
        providerReference: `wallet_${transfer.id}_${Date.now()}`,
        walletTxHash: walletTx.txHash,
      };
    } catch (error) {
      return {
        status: 'FAILED',
        provider: 'send-relayer',
        failureCode: 'WALLET_PAYOUT_ERROR',
        failureReason: error instanceof Error ? error.message : 'Wallet claim failed',
      };
    }
  }
}

export const sendPayoutService = new SendPayoutService();
