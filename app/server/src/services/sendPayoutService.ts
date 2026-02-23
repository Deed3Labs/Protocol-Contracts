import { sendRelayerService } from './sendRelayerService.js';
import { sendBridgePayoutService } from './sendBridgePayoutService.js';
import { sendStripePayoutService } from './sendStripePayoutService.js';
import type { SendTransferRecord } from './sendTransferStore.js';
import type { StripeRecipientContext } from './sendStripePayoutService.js';
import type { BridgeRecipientContext } from './sendBridgePayoutService.js';

type ClaimRecipientContext = StripeRecipientContext & BridgeRecipientContext;

export interface DebitPayoutResult {
  status: 'SUCCESS' | 'PROCESSING' | 'FALLBACK_REQUIRED' | 'FAILED' | 'ACTION_REQUIRED';
  provider: string;
  providerReference?: string;
  failureCode?: string;
  failureReason?: string;
  fallbackMethod?: 'BANK';
  treasuryTxHash?: string;
  onboardingUrl?: string;
  action?: 'STRIPE_ONBOARDING' | 'BRIDGE_ONBOARDING';
  bridgeCustomerId?: string;
  bridgeExternalAccountId?: string;
}

export interface BankPayoutResult {
  status: 'SUCCESS' | 'PROCESSING' | 'FAILED' | 'ACTION_REQUIRED';
  provider: string;
  providerReference?: string;
  failureCode?: string;
  failureReason?: string;
  treasuryTxHash?: string;
  eta?: string;
  onboardingUrl?: string;
  action?: 'STRIPE_ONBOARDING' | 'BRIDGE_ONBOARDING';
  bridgeCustomerId?: string;
  bridgeExternalAccountId?: string;
}

export interface WalletPayoutResult {
  status: 'SUCCESS' | 'FAILED';
  provider: string;
  providerReference?: string;
  walletTxHash?: string;
  failureCode?: string;
  failureReason?: string;
}

type PayoutWebhookStatus = 'SUCCESS' | 'PROCESSING' | 'FALLBACK_REQUIRED' | 'FAILED';

type PayoutWebhookResponse = {
  status?: PayoutWebhookStatus;
  provider?: string;
  providerReference?: string;
  failureCode?: string;
  failureReason?: string;
  fallbackMethod?: 'BANK';
  eta?: string;
};

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function webhookTimeoutMs(): number {
  return parseIntEnv('SEND_PAYOUT_WEBHOOK_TIMEOUT_MS', 15000);
}

class SendPayoutService {
  private readonly providerMode = (process.env.SEND_PAYOUT_PROVIDER || 'mock').trim().toLowerCase();
  private readonly debitProvider = process.env.SEND_DEBIT_PROVIDER || 'mock-debit';
  private readonly bankProvider = process.env.SEND_BANK_PROVIDER || 'mock-bank';

  private isStripeBridgeJitMode(): boolean {
    return this.providerMode === 'stripe_bridge_jit';
  }

  private isBridgeOnlyMode(): boolean {
    return this.providerMode === 'bridge_only' || this.providerMode === 'bridge';
  }

  async executeDebitPayout(
    transfer: SendTransferRecord,
    recipientContext?: ClaimRecipientContext
  ): Promise<DebitPayoutResult> {
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

    const eligibility = await this.checkDebitEligibility(transfer, recipientContext);
    if (eligibility.status === 'FALLBACK_REQUIRED') {
      return eligibility;
    }

    if (eligibility.status === 'ACTION_REQUIRED') {
      return eligibility;
    }

    if (eligibility.status === 'FAILED') {
      return eligibility;
    }

    try {
      const treasuryTx = await sendRelayerService.claimToPayoutTreasury(transfer.transferId, transfer.chainId);
      const payoutDispatch = await this.dispatchFiatPayout({
        method: 'DEBIT',
        transfer,
        treasuryTxHash: treasuryTx.txHash,
        recipientContext,
        recipientBridgeCustomerId: eligibility.bridgeCustomerId,
        recipientBridgeExternalAccountId: eligibility.bridgeExternalAccountId,
      });

      if (payoutDispatch.status === 'FALLBACK_REQUIRED') {
        return {
          status: 'FAILED',
          provider: payoutDispatch.provider,
          providerReference: payoutDispatch.providerReference,
          failureCode: payoutDispatch.failureCode || 'DEBIT_FALLBACK_AFTER_SETTLEMENT',
          failureReason:
            payoutDispatch.failureReason ||
            'Debit fallback was returned after settlement; manual payout handling required',
          treasuryTxHash: treasuryTx.txHash,
        };
      }

      return {
        status: payoutDispatch.status,
        provider: payoutDispatch.provider,
        providerReference: payoutDispatch.providerReference,
        failureCode: payoutDispatch.failureCode,
        failureReason: payoutDispatch.failureReason,
        fallbackMethod: payoutDispatch.fallbackMethod,
        treasuryTxHash: treasuryTx.txHash,
        onboardingUrl: payoutDispatch.onboardingUrl,
        action: payoutDispatch.action,
        bridgeCustomerId: payoutDispatch.bridgeCustomerId,
        bridgeExternalAccountId: payoutDispatch.bridgeExternalAccountId,
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

  async executeBankPayout(
    transfer: SendTransferRecord,
    recipientContext?: ClaimRecipientContext
  ): Promise<BankPayoutResult> {
    let bridgeEligibility:
      | {
          bridgeCustomerId?: string;
          bridgeExternalAccountId?: string;
        }
      | null = null;

    if (this.isStripeBridgeJitMode()) {
      const eligibility = await sendStripePayoutService.checkBankEligibility(transfer, recipientContext);
      if (eligibility.status === 'ACTION_REQUIRED') {
        return {
          status: 'ACTION_REQUIRED',
          provider: eligibility.provider,
          failureCode: eligibility.failureCode,
          failureReason: eligibility.failureReason,
          onboardingUrl: eligibility.onboardingUrl,
          action: eligibility.action,
        };
      }

      if (eligibility.status !== 'SUCCESS') {
        return {
          status: 'FAILED',
          provider: eligibility.provider,
          failureCode: eligibility.failureCode,
          failureReason: eligibility.failureReason,
        };
      }
    }

    if (this.isBridgeOnlyMode()) {
      const bridgeRecipientEligibility = await sendBridgePayoutService.ensureRecipientEligibility({
        transfer,
        method: 'BANK',
        recipientContext,
      });

      if (bridgeRecipientEligibility.status === 'ACTION_REQUIRED') {
        return {
          status: 'ACTION_REQUIRED',
          provider: bridgeRecipientEligibility.provider,
          failureCode: bridgeRecipientEligibility.failureCode,
          failureReason: bridgeRecipientEligibility.failureReason,
          onboardingUrl: bridgeRecipientEligibility.onboardingUrl,
          action: 'BRIDGE_ONBOARDING',
          bridgeCustomerId: bridgeRecipientEligibility.bridgeCustomerId,
          bridgeExternalAccountId: bridgeRecipientEligibility.bridgeExternalAccountId,
        };
      }

      if (bridgeRecipientEligibility.status === 'FAILED') {
        return {
          status: 'FAILED',
          provider: bridgeRecipientEligibility.provider,
          failureCode: bridgeRecipientEligibility.failureCode || 'BANK_ELIGIBILITY_FAILED',
          failureReason: bridgeRecipientEligibility.failureReason || 'Bank eligibility check failed',
        };
      }

      bridgeEligibility = {
        bridgeCustomerId: bridgeRecipientEligibility.bridgeCustomerId,
        bridgeExternalAccountId: bridgeRecipientEligibility.bridgeExternalAccountId,
      };

      const precheck = await sendBridgePayoutService.dispatch({
        phase: 'precheck',
        method: 'BANK',
        transfer: sendBridgePayoutService.fromTransferRecord(transfer),
      });

      if (precheck.status === 'FALLBACK_REQUIRED') {
        return {
          status: 'FAILED',
          provider: precheck.provider,
          failureCode: precheck.failureCode || 'BANK_FALLBACK_UNSUPPORTED',
          failureReason:
            precheck.failureReason ||
            'Bank fallback is not supported for bank payout execution',
        };
      }

      if (precheck.status === 'FAILED') {
        return {
          status: 'FAILED',
          provider: precheck.provider,
          failureCode: precheck.failureCode || 'BANK_ELIGIBILITY_FAILED',
          failureReason: precheck.failureReason || 'Bank eligibility check failed',
        };
      }
    }

    try {
      const treasuryTx = await sendRelayerService.claimToPayoutTreasury(transfer.transferId, transfer.chainId);
      const payoutDispatch = await this.dispatchFiatPayout({
        method: 'BANK',
        transfer,
        treasuryTxHash: treasuryTx.txHash,
        recipientContext,
        recipientBridgeCustomerId: bridgeEligibility?.bridgeCustomerId,
        recipientBridgeExternalAccountId: bridgeEligibility?.bridgeExternalAccountId,
      });

      if (payoutDispatch.status === 'FAILED') {
        return {
          status: 'FAILED',
          provider: payoutDispatch.provider,
          failureCode: payoutDispatch.failureCode,
          failureReason: payoutDispatch.failureReason,
        };
      }

      if (payoutDispatch.status === 'FALLBACK_REQUIRED') {
        return {
          status: 'FAILED',
          provider: payoutDispatch.provider,
          failureCode: payoutDispatch.failureCode || 'BANK_FALLBACK_UNSUPPORTED',
          failureReason:
            payoutDispatch.failureReason ||
            'Fallback is not supported for bank payout execution',
        };
      }

      if (payoutDispatch.status === 'ACTION_REQUIRED') {
        return {
          status: 'ACTION_REQUIRED',
          provider: payoutDispatch.provider,
          failureCode: payoutDispatch.failureCode,
          failureReason: payoutDispatch.failureReason,
          onboardingUrl: payoutDispatch.onboardingUrl,
          action: payoutDispatch.action,
          treasuryTxHash: treasuryTx.txHash,
          bridgeCustomerId: payoutDispatch.bridgeCustomerId,
          bridgeExternalAccountId: payoutDispatch.bridgeExternalAccountId,
        };
      }

      return {
        status: payoutDispatch.status,
        provider: payoutDispatch.provider,
        providerReference: payoutDispatch.providerReference,
        treasuryTxHash: treasuryTx.txHash,
        eta: payoutDispatch.eta || (payoutDispatch.status === 'SUCCESS' ? '1-3 business days' : undefined),
        onboardingUrl: payoutDispatch.onboardingUrl,
        action: payoutDispatch.action,
        bridgeCustomerId: payoutDispatch.bridgeCustomerId,
        bridgeExternalAccountId: payoutDispatch.bridgeExternalAccountId,
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
      const walletTx = await sendRelayerService.claimToWallet(transfer.transferId, recipientWallet, transfer.chainId);
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

  private async checkDebitEligibility(
    transfer: SendTransferRecord,
    recipientContext?: ClaimRecipientContext
  ): Promise<DebitPayoutResult> {
    if (this.isStripeBridgeJitMode()) {
      const eligibility = await sendStripePayoutService.checkDebitEligibility(transfer, recipientContext);
      if (eligibility.status === 'FALLBACK_REQUIRED') {
        return {
          status: 'FALLBACK_REQUIRED',
          provider: eligibility.provider,
          failureCode: eligibility.failureCode || 'DEBIT_INELIGIBLE',
          failureReason: eligibility.failureReason || 'Debit payout is ineligible',
          fallbackMethod: eligibility.fallbackMethod || 'BANK',
        };
      }

      if (eligibility.status === 'ACTION_REQUIRED') {
        return {
          status: 'ACTION_REQUIRED',
          provider: eligibility.provider,
          failureCode: eligibility.failureCode || 'STRIPE_ONBOARDING_REQUIRED',
          failureReason: eligibility.failureReason || 'Recipient onboarding is required',
          onboardingUrl: eligibility.onboardingUrl,
          action: eligibility.action,
        };
      }

      if (eligibility.status === 'FAILED') {
        return {
          status: 'FAILED',
          provider: eligibility.provider,
          failureCode: eligibility.failureCode || 'DEBIT_ELIGIBILITY_FAILED',
          failureReason: eligibility.failureReason || 'Debit eligibility check failed',
        };
      }

      return {
        status: 'SUCCESS',
        provider: eligibility.provider,
      };
    }

    if (this.isBridgeOnlyMode()) {
      const bridgeRecipientEligibility = await sendBridgePayoutService.ensureRecipientEligibility({
        transfer,
        method: 'DEBIT',
        recipientContext,
      });

      if (bridgeRecipientEligibility.status === 'ACTION_REQUIRED') {
        return {
          status: 'ACTION_REQUIRED',
          provider: bridgeRecipientEligibility.provider,
          failureCode: bridgeRecipientEligibility.failureCode || 'BRIDGE_ONBOARDING_REQUIRED',
          failureReason: bridgeRecipientEligibility.failureReason || 'Recipient onboarding is required',
          onboardingUrl: bridgeRecipientEligibility.onboardingUrl,
          action: 'BRIDGE_ONBOARDING',
          bridgeCustomerId: bridgeRecipientEligibility.bridgeCustomerId,
          bridgeExternalAccountId: bridgeRecipientEligibility.bridgeExternalAccountId,
        };
      }

      if (bridgeRecipientEligibility.status === 'FAILED') {
        return {
          status: 'FAILED',
          provider: bridgeRecipientEligibility.provider,
          failureCode: bridgeRecipientEligibility.failureCode || 'DEBIT_ELIGIBILITY_FAILED',
          failureReason: bridgeRecipientEligibility.failureReason || 'Debit eligibility check failed',
        };
      }

      const precheck = await sendBridgePayoutService.dispatch({
        phase: 'precheck',
        method: 'DEBIT',
        transfer: sendBridgePayoutService.fromTransferRecord(transfer),
      });

      if (precheck.status === 'FALLBACK_REQUIRED') {
        return {
          status: 'FALLBACK_REQUIRED',
          provider: precheck.provider,
          failureCode: precheck.failureCode || 'DEBIT_INELIGIBLE',
          failureReason: precheck.failureReason || 'Debit payout is ineligible',
          fallbackMethod: precheck.fallbackMethod || 'BANK',
        };
      }

      if (precheck.status === 'FAILED') {
        return {
          status: 'FAILED',
          provider: precheck.provider,
          failureCode: precheck.failureCode || 'DEBIT_ELIGIBILITY_FAILED',
          failureReason: precheck.failureReason || 'Debit eligibility check failed',
        };
      }

      return {
        status: 'SUCCESS',
        provider: precheck.provider,
        bridgeCustomerId: bridgeRecipientEligibility.bridgeCustomerId,
        bridgeExternalAccountId: bridgeRecipientEligibility.bridgeExternalAccountId,
      };
    }

    if (this.providerMode === 'generic_webhook') {
      const precheck = await this.callPayoutWebhook({
        phase: 'precheck',
        method: 'DEBIT',
        transfer,
      });

      if (precheck.status === 'FALLBACK_REQUIRED') {
        return {
          status: 'FALLBACK_REQUIRED',
          provider: precheck.provider || this.debitProvider,
          failureCode: precheck.failureCode || 'DEBIT_INELIGIBLE',
          failureReason: precheck.failureReason || 'Debit payout is ineligible',
          fallbackMethod: precheck.fallbackMethod || 'BANK',
        };
      }

      if (precheck.status === 'FAILED') {
        return {
          status: 'FAILED',
          provider: precheck.provider || this.debitProvider,
          failureCode: precheck.failureCode || 'DEBIT_ELIGIBILITY_FAILED',
          failureReason: precheck.failureReason || 'Debit eligibility check failed',
        };
      }

      return {
        status: 'SUCCESS',
        provider: precheck.provider || this.debitProvider,
      };
    }

    const forceFallback = (process.env.SEND_FORCE_DEBIT_FALLBACK || 'false') === 'true';
    const debitMaxUsdc = parseIntEnv('SEND_DEBIT_MAX_USDC_MICROS', 2_500_000_000);
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

    return {
      status: 'SUCCESS',
      provider: this.debitProvider,
    };
  }

  private async dispatchFiatPayout(params: {
    method: 'DEBIT' | 'BANK';
    transfer: SendTransferRecord;
    treasuryTxHash: string;
    recipientContext?: ClaimRecipientContext;
    recipientBridgeCustomerId?: string;
    recipientBridgeExternalAccountId?: string;
  }): Promise<{
    status: 'SUCCESS' | 'PROCESSING' | 'FALLBACK_REQUIRED' | 'FAILED' | 'ACTION_REQUIRED';
    provider: string;
    providerReference?: string;
    failureCode?: string;
    failureReason?: string;
    fallbackMethod?: 'BANK';
    eta?: string;
    onboardingUrl?: string;
    action?: 'STRIPE_ONBOARDING' | 'BRIDGE_ONBOARDING';
    bridgeCustomerId?: string;
    bridgeExternalAccountId?: string;
  }> {
    if (this.isStripeBridgeJitMode() || this.isBridgeOnlyMode()) {
      const bridgeDispatch = await sendBridgePayoutService.dispatch({
        phase: 'execute',
        method: params.method,
        transfer: sendBridgePayoutService.fromTransferRecord(params.transfer),
        treasuryTxHash: params.treasuryTxHash,
        recipientBridgeCustomerId: params.recipientBridgeCustomerId,
        recipientBridgeExternalAccountId: params.recipientBridgeExternalAccountId,
      });

      if (bridgeDispatch.status === 'FAILED' || bridgeDispatch.status === 'FALLBACK_REQUIRED') {
        return {
          status: bridgeDispatch.status,
          provider: bridgeDispatch.provider,
          providerReference: bridgeDispatch.providerReference,
          failureCode: bridgeDispatch.failureCode,
          failureReason: bridgeDispatch.failureReason,
          fallbackMethod: bridgeDispatch.fallbackMethod,
          eta: bridgeDispatch.eta,
        };
      }

      if (this.isBridgeOnlyMode()) {
        return {
          status: bridgeDispatch.status,
          provider: bridgeDispatch.provider,
          providerReference: bridgeDispatch.providerReference,
          failureCode: bridgeDispatch.failureCode,
          failureReason: bridgeDispatch.failureReason,
          fallbackMethod: bridgeDispatch.fallbackMethod,
          eta: bridgeDispatch.eta,
          bridgeCustomerId: params.recipientBridgeCustomerId,
          bridgeExternalAccountId: params.recipientBridgeExternalAccountId,
        };
      }

      const requireBridgeSuccess = (process.env.SEND_STRIPE_REQUIRE_BRIDGE_SUCCESS || 'true').trim().toLowerCase() === 'true';
      if (bridgeDispatch.status !== 'SUCCESS' && requireBridgeSuccess) {
        return {
          status: 'PROCESSING',
          provider: bridgeDispatch.provider,
          providerReference: bridgeDispatch.providerReference,
          eta: bridgeDispatch.eta || 'Pending conversion settlement',
        };
      }

      const stripePayout = await sendStripePayoutService.createRecipientPayout({
        method: params.method,
        transfer: params.transfer,
        bridgeTransferReference: bridgeDispatch.providerReference,
        recipientContext: params.recipientContext,
      });

      if (params.method === 'DEBIT' && stripePayout.status === 'FALLBACK_REQUIRED') {
        return {
          status: 'FAILED',
          provider: stripePayout.provider,
          providerReference: stripePayout.providerReference || bridgeDispatch.providerReference,
          failureCode: stripePayout.failureCode || 'DEBIT_FALLBACK_AFTER_SETTLEMENT',
          failureReason:
            stripePayout.failureReason ||
            'Debit fallback was returned after settlement; manual payout handling required',
          eta: stripePayout.eta,
        };
      }

      return {
        status: stripePayout.status,
        provider: stripePayout.provider,
        providerReference: stripePayout.providerReference || bridgeDispatch.providerReference,
        failureCode: stripePayout.failureCode,
        failureReason: stripePayout.failureReason,
        fallbackMethod: stripePayout.fallbackMethod,
        eta: stripePayout.eta || bridgeDispatch.eta,
        onboardingUrl: stripePayout.onboardingUrl,
        action: stripePayout.action,
      };
    }

    if (this.providerMode === 'generic_webhook') {
      const response = await this.callPayoutWebhook({
        phase: 'execute',
        method: params.method,
        transfer: params.transfer,
        treasuryTxHash: params.treasuryTxHash,
      });

      return {
        status: response.status || 'PROCESSING',
        provider: response.provider || (params.method === 'DEBIT' ? this.debitProvider : this.bankProvider),
        providerReference:
          response.providerReference || `${params.method.toLowerCase()}_${params.transfer.id}_${Date.now()}`,
        failureCode: response.failureCode,
        failureReason: response.failureReason,
        fallbackMethod: response.fallbackMethod,
        eta: response.eta,
      };
    }

    return {
      status: 'SUCCESS',
      provider: params.method === 'DEBIT' ? this.debitProvider : this.bankProvider,
      providerReference: `${params.method.toLowerCase()}_${params.transfer.id}_${Date.now()}`,
      ...(params.method === 'BANK' ? { eta: '1-3 business days' } : {}),
    };
  }

  private async callPayoutWebhook(params: {
    phase: 'precheck' | 'execute';
    method: 'DEBIT' | 'BANK';
    transfer: SendTransferRecord;
    treasuryTxHash?: string;
  }): Promise<PayoutWebhookResponse> {
    const webhookUrl = (process.env.SEND_PAYOUT_PROVIDER_URL || '').trim();
    if (!webhookUrl) {
      throw new Error('SEND_PAYOUT_PROVIDER_URL is required for generic_webhook payout mode');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), webhookTimeoutMs());

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SEND_PAYOUT_PROVIDER_SECRET
            ? { 'X-Send-Payout-Secret': process.env.SEND_PAYOUT_PROVIDER_SECRET }
            : {}),
        },
        body: JSON.stringify({
          phase: params.phase,
          method: params.method,
          transfer: {
            id: params.transfer.id,
            transferId: params.transfer.transferId,
            senderWallet: params.transfer.senderWallet,
            recipientContactHash: params.transfer.recipientContactHash,
            recipientHintHash: params.transfer.recipientHintHash,
            principalUsdc: params.transfer.principalUsdc,
            sponsorFeeUsdc: params.transfer.sponsorFeeUsdc,
            totalLockedUsdc: params.transfer.totalLockedUsdc,
            region: params.transfer.region,
            chainId: params.transfer.chainId,
            expiresAt: params.transfer.expiresAt.toISOString(),
          },
          treasuryTxHash: params.treasuryTxHash,
        }),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => ({}))) as PayoutWebhookResponse;
      if (!response.ok) {
        throw new Error(`Payout provider webhook failed (${response.status})`);
      }

      return body;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const sendPayoutService = new SendPayoutService();
