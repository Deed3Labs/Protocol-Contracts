import type { RecipientType, SendTransferRecord } from './sendTransferStore.js';
import { sendTransferStore } from './sendTransferStore.js';

type DispatchMethod = 'DEBIT' | 'BANK';
type DispatchStatus = 'SUCCESS' | 'PROCESSING' | 'FALLBACK_REQUIRED' | 'FAILED' | 'ACTION_REQUIRED';

export interface StripeRecipientContext {
  recipientType: RecipientType;
  recipientContact: string;
}

export interface StripeEligibilityResult {
  status: 'SUCCESS' | 'FALLBACK_REQUIRED' | 'FAILED' | 'ACTION_REQUIRED';
  provider: string;
  failureCode?: string;
  failureReason?: string;
  fallbackMethod?: 'BANK';
  onboardingUrl?: string;
  action?: 'STRIPE_ONBOARDING';
  connectedAccountId?: string;
}

export interface StripePayoutResult {
  status: DispatchStatus;
  provider: string;
  providerReference?: string;
  failureCode?: string;
  failureReason?: string;
  fallbackMethod?: 'BANK';
  eta?: string;
  onboardingUrl?: string;
  action?: 'STRIPE_ONBOARDING';
}

type StripeErrorResponse = {
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
};

type StripePayoutResponse = {
  id?: string;
  status?: string;
};

type StripeAccountResponse = {
  id?: string;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: {
    currently_due?: string[];
  };
};

type StripeAccountLinkResponse = {
  url?: string;
};

function stripeProviderName(): string {
  return (process.env.SEND_STRIPE_PAYOUT_PROVIDER_NAME || 'stripe').trim() || 'stripe';
}

function defaultBankEta(): string {
  return process.env.SEND_STRIPE_BANK_ETA || '1-3 business days';
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stripeTimeoutMs(): number {
  return parseIntEnv('SEND_STRIPE_PAYOUT_TIMEOUT_MS', 15000);
}

function normalizeRecipientMap(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const mapped: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        mapped[key.trim().toLowerCase()] = value.trim();
      }
    }
    return mapped;
  } catch {
    return {};
  }
}

function usdcMicrosToUsdCents(value: string): bigint {
  const micros = BigInt(value);
  return micros / 10_000n;
}

function payoutStatusFromStripe(rawStatus: unknown): DispatchStatus {
  const normalized = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : '';
  if (normalized === 'paid') return 'SUCCESS';
  if (normalized === 'pending' || normalized === 'in_transit') return 'PROCESSING';
  if (normalized === 'failed' || normalized === 'canceled') return 'FAILED';
  return 'PROCESSING';
}

function payoutFailureMessage(data: StripeErrorResponse, fallback: string): string {
  const message = data.error?.message?.trim();
  if (message) return message;
  return fallback;
}

function parseBoolean(value: unknown): boolean {
  return value === true;
}

function firstCorsOrigin(): string {
  const raw = (process.env.CORS_ORIGIN || '').trim();
  if (!raw) return '';
  return raw.split(',')[0]?.trim() || '';
}

function normalizeEmail(contact: string): string | null {
  const normalized = contact.trim().toLowerCase();
  if (!normalized.includes('@')) return null;
  return normalized;
}

type EnsureConnectedAccountReadyResult =
  | { status: 'READY'; connectedAccountId: string }
  | {
      status: 'ACTION_REQUIRED';
      failureCode: string;
      failureReason: string;
      onboardingUrl?: string;
    }
  | {
      status: 'FAILED';
      failureCode: string;
      failureReason: string;
    };

class SendStripePayoutService {
  private readonly provider = stripeProviderName();

  private stripeSecretKey(): string {
    return (process.env.STRIPE_SECRET_KEY || '').trim();
  }

  private payoutCurrency(): string {
    return (process.env.SEND_STRIPE_PAYOUT_CURRENCY || 'usd').trim().toLowerCase();
  }

  private debitEnabled(): boolean {
    return (process.env.SEND_STRIPE_DEBIT_ENABLED || 'true').trim().toLowerCase() === 'true';
  }

  private instantEnabled(): boolean {
    return (process.env.SEND_STRIPE_ENABLE_INSTANT_PAYOUTS || 'true').trim().toLowerCase() === 'true';
  }

  private autoCreateConnectedAccountEnabled(): boolean {
    return (process.env.SEND_STRIPE_AUTO_CREATE_CONNECTED_ACCOUNT || 'true').trim().toLowerCase() === 'true';
  }

  private connectedAccountType(): string {
    return (process.env.SEND_STRIPE_CONNECTED_ACCOUNT_TYPE || 'express').trim().toLowerCase();
  }

  private defaultCountry(transfer: SendTransferRecord): string {
    const explicit = (process.env.SEND_STRIPE_CONNECTED_ACCOUNT_COUNTRY || '').trim().toUpperCase();
    if (explicit) return explicit;

    const fromRegion = transfer.region.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(fromRegion)) return fromRegion;

    return 'US';
  }

  private onboardingReturnUrl(): string {
    const explicit = (process.env.SEND_STRIPE_ONBOARDING_RETURN_URL || '').trim();
    if (explicit) return explicit;

    const claimBase = (process.env.SEND_PUBLIC_CLAIM_BASE_URL || '').trim();
    if (claimBase) return claimBase;

    const corsBase = firstCorsOrigin();
    if (corsBase) return `${corsBase.replace(/\/+$/, '')}/claim`;

    return 'http://localhost:5173/claim';
  }

  private onboardingRefreshUrl(): string {
    const explicit = (process.env.SEND_STRIPE_ONBOARDING_REFRESH_URL || '').trim();
    if (explicit) return explicit;

    return this.onboardingReturnUrl();
  }

  private mapKeyCandidates(transfer: SendTransferRecord): string[] {
    return [transfer.recipientContactHash.toLowerCase(), transfer.recipientHintHash.toLowerCase()];
  }

  private async resolveConnectedAccount(transfer: SendTransferRecord): Promise<{
    accountId: string | null;
    source: 'ENV' | 'STORE' | null;
  }> {
    const map = normalizeRecipientMap((process.env.SEND_STRIPE_RECIPIENT_ACCOUNT_MAP_JSON || '').trim());
    for (const key of this.mapKeyCandidates(transfer)) {
      const mapped = map[key];
      if (mapped) return { accountId: mapped, source: 'ENV' };
    }

    const persisted = await sendTransferStore.getStripeRecipientByHashes(
      transfer.recipientContactHash,
      transfer.recipientHintHash
    );
    if (persisted?.stripeAccountId) {
      return { accountId: persisted.stripeAccountId, source: 'STORE' };
    }

    const mappedDefault = map.default;
    if (mappedDefault) return { accountId: mappedDefault, source: 'ENV' };

    const fallbackAccount = (process.env.SEND_STRIPE_DEFAULT_CONNECTED_ACCOUNT_ID || '').trim();
    if (fallbackAccount) return { accountId: fallbackAccount, source: 'ENV' };

    return { accountId: null, source: null };
  }

  private async upsertRecipientAccount(params: {
    transfer: SendTransferRecord;
    stripeAccountId: string;
    onboardingStatus: 'PENDING_ONBOARDING' | 'READY' | 'RESTRICTED';
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    lastAccountLinkUrl?: string | null;
  }): Promise<void> {
    await sendTransferStore.upsertStripeRecipient({
      recipientContactHash: params.transfer.recipientContactHash,
      recipientHintHash: params.transfer.recipientHintHash,
      stripeAccountId: params.stripeAccountId,
      onboardingStatus: params.onboardingStatus,
      payoutsEnabled: params.payoutsEnabled,
      detailsSubmitted: params.detailsSubmitted,
      lastAccountLinkUrl: params.lastAccountLinkUrl ?? null,
    });
  }

  private async createConnectedAccount(params: {
    transfer: SendTransferRecord;
    recipientContext?: StripeRecipientContext;
  }): Promise<{ ok: true; accountId: string } | { ok: false; failureCode: string; failureReason: string }> {
    const secretKey = this.stripeSecretKey();
    if (!secretKey) {
      return {
        ok: false,
        failureCode: 'STRIPE_SECRET_KEY_MISSING',
        failureReason: 'STRIPE_SECRET_KEY is not configured',
      };
    }

    const formData = new URLSearchParams();
    formData.set('type', this.connectedAccountType());
    formData.set('country', this.defaultCountry(params.transfer));
    formData.set('capabilities[transfers][requested]', 'true');
    formData.set('business_type', 'individual');
    formData.set('metadata[send_recipient_contact_hash]', params.transfer.recipientContactHash);
    formData.set('metadata[send_recipient_hint_hash]', params.transfer.recipientHintHash);
    formData.set('metadata[send_transfer_id]', params.transfer.transferId);

    const recipientEmail =
      params.recipientContext?.recipientType === 'email'
        ? normalizeEmail(params.recipientContext.recipientContact)
        : null;
    if (recipientEmail) {
      formData.set('email', recipientEmail);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), stripeTimeoutMs());

    try {
      const response = await fetch('https://api.stripe.com/v1/accounts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': `send_connect_${params.transfer.transferId}`,
        },
        body: formData.toString(),
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({}))) as StripeAccountResponse & StripeErrorResponse;
      if (!response.ok || !data.id) {
        return {
          ok: false,
          failureCode: data.error?.code?.toUpperCase() || `STRIPE_HTTP_${response.status}`,
          failureReason: payoutFailureMessage(data, `Failed to create Stripe connected account (${response.status})`),
        };
      }

      return {
        ok: true,
        accountId: data.id,
      };
    } catch (error) {
      return {
        ok: false,
        failureCode: 'STRIPE_CONNECTED_ACCOUNT_CREATE_ERROR',
        failureReason: error instanceof Error ? error.message : 'Failed to create Stripe connected account',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchAccount(accountId: string): Promise<{
    ok: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    currentlyDueCount: number;
    failureCode?: string;
    failureReason?: string;
  }> {
    const secretKey = this.stripeSecretKey();
    if (!secretKey) {
      return {
        ok: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        currentlyDueCount: 0,
        failureCode: 'STRIPE_SECRET_KEY_MISSING',
        failureReason: 'STRIPE_SECRET_KEY is not configured',
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), stripeTimeoutMs());

    try {
      const response = await fetch(`https://api.stripe.com/v1/accounts/${accountId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({}))) as StripeAccountResponse & StripeErrorResponse;
      if (!response.ok) {
        return {
          ok: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          currentlyDueCount: 0,
          failureCode: data.error?.code?.toUpperCase() || `STRIPE_HTTP_${response.status}`,
          failureReason: payoutFailureMessage(data, `Failed to fetch Stripe connected account (${response.status})`),
        };
      }

      const currentlyDue = Array.isArray(data.requirements?.currently_due)
        ? data.requirements?.currently_due.length
        : 0;

      return {
        ok: true,
        payoutsEnabled: parseBoolean(data.payouts_enabled),
        detailsSubmitted: parseBoolean(data.details_submitted),
        currentlyDueCount: currentlyDue,
      };
    } catch (error) {
      return {
        ok: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        currentlyDueCount: 0,
        failureCode: 'STRIPE_ACCOUNT_FETCH_ERROR',
        failureReason: error instanceof Error ? error.message : 'Failed to fetch Stripe connected account',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async createAccountLink(accountId: string): Promise<{
    ok: boolean;
    onboardingUrl?: string;
    failureCode?: string;
    failureReason?: string;
  }> {
    const secretKey = this.stripeSecretKey();
    if (!secretKey) {
      return {
        ok: false,
        failureCode: 'STRIPE_SECRET_KEY_MISSING',
        failureReason: 'STRIPE_SECRET_KEY is not configured',
      };
    }

    const formData = new URLSearchParams();
    formData.set('account', accountId);
    formData.set('type', 'account_onboarding');
    formData.set('refresh_url', this.onboardingRefreshUrl());
    formData.set('return_url', this.onboardingReturnUrl());

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), stripeTimeoutMs());

    try {
      const response = await fetch('https://api.stripe.com/v1/account_links', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({}))) as StripeAccountLinkResponse & StripeErrorResponse;
      if (!response.ok) {
        return {
          ok: false,
          failureCode: data.error?.code?.toUpperCase() || `STRIPE_HTTP_${response.status}`,
          failureReason: payoutFailureMessage(data, `Failed to create Stripe account onboarding link (${response.status})`),
        };
      }

      if (!data.url || data.url.trim().length === 0) {
        return {
          ok: false,
          failureCode: 'STRIPE_ACCOUNT_LINK_INVALID',
          failureReason: 'Stripe returned an empty onboarding URL',
        };
      }

      return {
        ok: true,
        onboardingUrl: data.url,
      };
    } catch (error) {
      return {
        ok: false,
        failureCode: 'STRIPE_ACCOUNT_LINK_ERROR',
        failureReason: error instanceof Error ? error.message : 'Failed to create Stripe onboarding link',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async ensureConnectedAccountReady(params: {
    transfer: SendTransferRecord;
    recipientContext?: StripeRecipientContext;
  }): Promise<EnsureConnectedAccountReadyResult> {
    const existing = await this.resolveConnectedAccount(params.transfer);
    let accountId = existing.accountId;
    let shouldPersist = existing.source === 'STORE';

    if (!accountId) {
      if (!this.autoCreateConnectedAccountEnabled()) {
        return {
          status: 'ACTION_REQUIRED',
          failureCode: 'STRIPE_CONNECTED_ACCOUNT_REQUIRED',
          failureReason: 'Recipient Stripe connected account is not configured',
        };
      }

      const created = await this.createConnectedAccount(params);
      if (!created.ok) {
        return {
          status: 'FAILED',
          failureCode: created.failureCode,
          failureReason: created.failureReason,
        };
      }

      accountId = created.accountId;
      shouldPersist = true;
      await this.upsertRecipientAccount({
        transfer: params.transfer,
        stripeAccountId: accountId,
        onboardingStatus: 'PENDING_ONBOARDING',
        payoutsEnabled: false,
        detailsSubmitted: false,
      });
    }

    const account = await this.fetchAccount(accountId);
    if (!account.ok) {
      return {
        status: 'FAILED',
        failureCode: account.failureCode || 'STRIPE_ACCOUNT_FETCH_ERROR',
        failureReason: account.failureReason || 'Unable to fetch Stripe connected account',
      };
    }

    if (account.payoutsEnabled) {
      if (shouldPersist) {
        await this.upsertRecipientAccount({
          transfer: params.transfer,
          stripeAccountId: accountId,
          onboardingStatus: 'READY',
          payoutsEnabled: account.payoutsEnabled,
          detailsSubmitted: account.detailsSubmitted,
        });
      }

      return {
        status: 'READY',
        connectedAccountId: accountId,
      };
    }

    const linkResult = await this.createAccountLink(accountId);
    if (!linkResult.ok) {
      if (shouldPersist) {
        await this.upsertRecipientAccount({
          transfer: params.transfer,
          stripeAccountId: accountId,
          onboardingStatus: account.currentlyDueCount > 0 ? 'PENDING_ONBOARDING' : 'RESTRICTED',
          payoutsEnabled: account.payoutsEnabled,
          detailsSubmitted: account.detailsSubmitted,
        });
      }

      return {
        status: 'FAILED',
        failureCode: linkResult.failureCode || 'STRIPE_ACCOUNT_LINK_ERROR',
        failureReason: linkResult.failureReason || 'Unable to create Stripe onboarding link',
      };
    }

    if (shouldPersist) {
      await this.upsertRecipientAccount({
        transfer: params.transfer,
        stripeAccountId: accountId,
        onboardingStatus: 'PENDING_ONBOARDING',
        payoutsEnabled: account.payoutsEnabled,
        detailsSubmitted: account.detailsSubmitted,
        lastAccountLinkUrl: linkResult.onboardingUrl,
      });
    }

    return {
      status: 'ACTION_REQUIRED',
      failureCode: 'STRIPE_ONBOARDING_REQUIRED',
      failureReason: 'Recipient must complete Stripe onboarding to receive fiat payout',
      onboardingUrl: linkResult.onboardingUrl,
    };
  }

  async checkDebitEligibility(
    transfer: SendTransferRecord,
    recipientContext?: StripeRecipientContext
  ): Promise<StripeEligibilityResult> {
    if (!this.debitEnabled()) {
      return {
        status: 'FALLBACK_REQUIRED',
        provider: this.provider,
        failureCode: 'STRIPE_DEBIT_DISABLED',
        failureReason: 'Stripe debit payouts are disabled',
        fallbackMethod: 'BANK',
      };
    }

    if (!this.stripeSecretKey()) {
      return {
        status: 'FAILED',
        provider: this.provider,
        failureCode: 'STRIPE_SECRET_KEY_MISSING',
        failureReason: 'STRIPE_SECRET_KEY is not configured',
      };
    }

    const account = await this.ensureConnectedAccountReady({ transfer, recipientContext });
    if (account.status === 'READY') {
      return {
        status: 'SUCCESS',
        provider: this.provider,
        connectedAccountId: account.connectedAccountId,
      };
    }

    if (account.status === 'ACTION_REQUIRED') {
      return {
        status: 'ACTION_REQUIRED',
        provider: this.provider,
        failureCode: account.failureCode,
        failureReason: account.failureReason,
        onboardingUrl: account.onboardingUrl,
        action: 'STRIPE_ONBOARDING',
      };
    }

    return {
      status: 'FAILED',
      provider: this.provider,
      failureCode: account.failureCode,
      failureReason: account.failureReason,
    };
  }

  async checkBankEligibility(
    transfer: SendTransferRecord,
    recipientContext?: StripeRecipientContext
  ): Promise<StripeEligibilityResult> {
    if (!this.stripeSecretKey()) {
      return {
        status: 'FAILED',
        provider: this.provider,
        failureCode: 'STRIPE_SECRET_KEY_MISSING',
        failureReason: 'STRIPE_SECRET_KEY is not configured',
      };
    }

    const account = await this.ensureConnectedAccountReady({ transfer, recipientContext });
    if (account.status === 'READY') {
      return {
        status: 'SUCCESS',
        provider: this.provider,
        connectedAccountId: account.connectedAccountId,
      };
    }

    if (account.status === 'ACTION_REQUIRED') {
      return {
        status: 'ACTION_REQUIRED',
        provider: this.provider,
        failureCode: account.failureCode,
        failureReason: account.failureReason,
        onboardingUrl: account.onboardingUrl,
        action: 'STRIPE_ONBOARDING',
      };
    }

    return {
      status: 'FAILED',
      provider: this.provider,
      failureCode: account.failureCode,
      failureReason: account.failureReason,
    };
  }

  async createRecipientPayout(params: {
    method: DispatchMethod;
    transfer: SendTransferRecord;
    bridgeTransferReference?: string;
    recipientContext?: StripeRecipientContext;
  }): Promise<StripePayoutResult> {
    const eligibility =
      params.method === 'DEBIT'
        ? await this.checkDebitEligibility(params.transfer, params.recipientContext)
        : await this.checkBankEligibility(params.transfer, params.recipientContext);

    if (eligibility.status !== 'SUCCESS') {
      return {
        status: eligibility.status,
        provider: eligibility.provider,
        failureCode: eligibility.failureCode,
        failureReason: eligibility.failureReason,
        fallbackMethod: eligibility.fallbackMethod,
        onboardingUrl: eligibility.onboardingUrl,
        action: eligibility.action,
      };
    }

    const connectedAccountId = eligibility.connectedAccountId;
    if (!connectedAccountId) {
      return {
        status: 'FAILED',
        provider: this.provider,
        failureCode: 'STRIPE_CONNECTED_ACCOUNT_REQUIRED',
        failureReason: 'Recipient Stripe connected account is not configured',
      };
    }

    const amountCents = usdcMicrosToUsdCents(params.transfer.principalUsdc);
    if (amountCents <= 0n) {
      return {
        status: 'FAILED',
        provider: this.provider,
        failureCode: 'STRIPE_INVALID_PAYOUT_AMOUNT',
        failureReason: 'Calculated payout amount is zero',
      };
    }

    const method =
      params.method === 'DEBIT'
        ? this.instantEnabled()
          ? 'instant'
          : 'standard'
        : 'standard';

    const formData = new URLSearchParams();
    formData.set('amount', amountCents.toString());
    formData.set('currency', this.payoutCurrency());
    formData.set('method', method);
    formData.set('metadata[send_transfer_id]', params.transfer.transferId);
    formData.set('metadata[send_transfer_row_id]', params.transfer.id.toString());
    formData.set('metadata[send_payout_method]', params.method.toLowerCase());
    if (params.bridgeTransferReference) {
      formData.set('metadata[bridge_transfer_reference]', params.bridgeTransferReference);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), stripeTimeoutMs());

    try {
      const response = await fetch('https://api.stripe.com/v1/payouts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.stripeSecretKey()}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Stripe-Account': connectedAccountId,
          'Idempotency-Key': `send_${params.transfer.transferId}_${params.method.toLowerCase()}`,
        },
        body: formData.toString(),
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({}))) as StripePayoutResponse & StripeErrorResponse;
      if (!response.ok) {
        const errorCode = data.error?.code?.toUpperCase() || `STRIPE_HTTP_${response.status}`;
        const reason = payoutFailureMessage(data, `Stripe payout failed (${response.status})`);

        if (params.method === 'DEBIT' && errorCode.includes('INSTANT')) {
          return {
            status: 'FALLBACK_REQUIRED',
            provider: this.provider,
            failureCode: errorCode,
            failureReason: reason,
            fallbackMethod: 'BANK',
          };
        }

        return {
          status: 'FAILED',
          provider: this.provider,
          failureCode: errorCode,
          failureReason: reason,
        };
      }

      const status = payoutStatusFromStripe(data.status);
      return {
        status,
        provider: this.provider,
        providerReference: data.id,
        ...(status === 'PROCESSING' && params.method === 'BANK' ? { eta: defaultBankEta() } : {}),
      };
    } catch (error) {
      return {
        status: 'FAILED',
        provider: this.provider,
        failureCode: 'STRIPE_PAYOUT_ERROR',
        failureReason: error instanceof Error ? error.message : 'Stripe payout failed',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const sendStripePayoutService = new SendStripePayoutService();
