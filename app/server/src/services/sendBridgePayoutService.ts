import { randomUUID } from 'crypto';
import type { RecipientType, SendTransferRecord } from './sendTransferStore.js';
import { sendTransferStore } from './sendTransferStore.js';

type DispatchPhase = 'precheck' | 'execute';
type DispatchMethod = 'DEBIT' | 'BANK';
type DispatchStatus = 'SUCCESS' | 'PROCESSING' | 'FALLBACK_REQUIRED' | 'FAILED';

type BridgeCustomerType = 'individual' | 'business';

interface BridgeKycLinkRecord {
  customer_id?: string;
  kyc_link?: string;
  tos_link?: string;
  tos_status?: string;
}

interface BridgeListKycLinksResponse {
  data?: BridgeKycLinkRecord[];
}

interface BridgeHostedLinkResponse {
  url?: string | null;
}

interface BridgeCreateKycLinkRequest {
  full_name: string;
  email: string;
  type: BridgeCustomerType;
  redirect_uri?: string;
}

interface BridgeCreateKycLinkResponse extends BridgeKycLinkRecord {}

interface BridgeExternalAccountRecord {
  id?: string;
  status?: string;
  state?: string;
  disabled?: boolean;
  payment_rail?: string;
  paymentRail?: string;
  payment_rails?: unknown;
  supported_payment_rails?: unknown;
  rail?: string;
  rails?: unknown;
  payment_method?: string;
  paymentMethod?: string;
  payment_methods?: unknown;
  type?: string;
  account_type?: string;
  accountType?: string;
  network?: string;
  currency?: string;
  currencies?: unknown;
}

interface BridgeListExternalAccountsResponse {
  data?: BridgeExternalAccountRecord[];
}

type BridgeApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

export interface BridgeRecipientContext {
  recipientType: RecipientType;
  recipientContact: string;
  bridgeFullName?: string;
  bridgeEmail?: string;
}

export interface BridgeRecipientEligibilityResult {
  status: 'SUCCESS' | 'ACTION_REQUIRED' | 'FAILED';
  provider: string;
  bridgeCustomerId?: string;
  bridgeExternalAccountId?: string;
  onboardingUrl?: string;
  kycUrl?: string;
  tosUrl?: string;
  failureCode?: string;
  failureReason?: string;
  requiredFields?: Array<'bridgeEmail' | 'bridgeFullName'>;
}

export interface BridgePayoutDispatchRequest {
  phase: DispatchPhase;
  method: DispatchMethod;
  transfer: {
    id: number;
    transferId: string;
    senderWallet: string;
    principalUsdc: string;
    sponsorFeeUsdc: string;
    totalLockedUsdc: string;
    region: string;
    chainId: number;
    expiresAt: string;
  };
  treasuryTxHash?: string;
  recipientBridgeExternalAccountId?: string;
  recipientBridgeCustomerId?: string;
}

export interface BridgePayoutDispatchResponse {
  status: DispatchStatus;
  provider: string;
  providerReference?: string;
  failureCode?: string;
  failureReason?: string;
  fallbackMethod?: 'BANK';
  eta?: string;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJsonEnv(name: string): Record<string, unknown> | null {
  const raw = (process.env[name] || '').trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function formatUsdcMicros(microsValue: string): string {
  const micros = BigInt(microsValue);
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function bridgeProviderName(): string {
  return (process.env.SEND_BRIDGE_PAYOUT_PROVIDER_NAME || 'bridge').trim() || 'bridge';
}

function bridgeEnabledRegions(): Set<string> {
  return new Set(
    (process.env.SEND_BRIDGE_PAYOUT_ENABLED_REGIONS || 'US')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  );
}

function defaultBankEta(): string {
  return process.env.SEND_BRIDGE_BANK_ETA || '1-3 business days';
}

function webhookTimeoutMs(): number {
  return parseIntEnv('SEND_BRIDGE_PAYOUT_TIMEOUT_MS', 15000);
}

function bridgeApiTimeoutMs(): number {
  return parseIntEnv('BRIDGE_API_TIMEOUT_MS', 15000);
}

function messageFromBridgeError(body: Record<string, unknown>, fallback: string): string {
  if (typeof body.message === 'string' && body.message.trim().length > 0) return body.message;
  if (typeof body.error === 'string' && body.error.trim().length > 0) return body.error;

  const nestedError = body.error;
  if (nestedError && typeof nestedError === 'object' && !Array.isArray(nestedError)) {
    const nestedMessage = (nestedError as { message?: unknown }).message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim().length > 0) return nestedMessage;
  }

  return fallback;
}

function parseJsonMaybe(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getMessageFromUnknown(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim().length > 0) return payload;
  if (typeof payload === 'object' && payload != null) {
    const fromMessage = (payload as { message?: unknown }).message;
    if (typeof fromMessage === 'string' && fromMessage.trim().length > 0) return fromMessage;

    const fromError = (payload as { error?: unknown }).error;
    if (typeof fromError === 'string' && fromError.trim().length > 0) return fromError;
    if (typeof fromError === 'object' && fromError != null) {
      const nested = (fromError as { message?: unknown }).message;
      if (typeof nested === 'string' && nested.trim().length > 0) return nested;
    }
  }
  return fallback;
}

function normalizeBridgeUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return trimmed;
}

function isBridgeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
}

function bridgeApiBaseUrl(): string {
  const raw = (process.env.BRIDGE_API_BASE_URL || 'https://api.bridge.xyz/v0').trim().replace(/\/+$/, '');
  if (raw.endsWith('/v0')) return raw;
  return `${raw}/v0`;
}

function bridgeApiKeyHeader(): string {
  return (process.env.SEND_BRIDGE_PAYOUT_API_KEY_HEADER || 'Api-Key').trim();
}

function bridgeApiKey(): string {
  return (process.env.SEND_BRIDGE_PAYOUT_API_KEY || process.env.BRIDGE_API_KEY || '').trim();
}

function recipientOnboardingRequired(): boolean {
  return (process.env.SEND_BRIDGE_REQUIRE_RECIPIENT_ONBOARDING || 'false').trim().toLowerCase() === 'true';
}

function bridgeCustomerType(): BridgeCustomerType {
  const raw = (process.env.SEND_BRIDGE_RECIPIENT_CUSTOMER_TYPE || 'individual').trim().toLowerCase();
  return raw === 'business' ? 'business' : 'individual';
}

function bridgeOnboardingRedirectUri(): string | undefined {
  const explicit = (process.env.SEND_BRIDGE_ONBOARDING_REDIRECT_URI || process.env.BRIDGE_ONBOARDING_REDIRECT_URI || '').trim();
  if (explicit) return explicit;

  const claimUrl = (process.env.SEND_CLAIM_APP_URL || '').trim();
  if (claimUrl) return `${claimUrl.replace(/\/+$/, '')}/claim`;

  return undefined;
}

function bridgeExternalAccountLookupLimit(): number {
  return parseIntEnv('SEND_BRIDGE_EXTERNAL_ACCOUNT_LOOKUP_LIMIT', 10);
}

function preferRecipientOnBehalfOf(): boolean {
  return (process.env.SEND_BRIDGE_USE_RECIPIENT_ON_BEHALF_OF || 'true').trim().toLowerCase() === 'true';
}

function recipientDestinationPaymentRail(): string {
  return (process.env.SEND_BRIDGE_RECIPIENT_DESTINATION_PAYMENT_RAIL || '').trim();
}

function recipientDestinationCurrency(): string {
  return (process.env.SEND_BRIDGE_RECIPIENT_DESTINATION_CURRENCY || '').trim().toLowerCase();
}

function normalizeRailToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function parseCsvSet(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((value) => normalizeRailToken(value))
      .filter(Boolean)
  );
}

function isLikelyDebitRail(rail: string): boolean {
  const normalized = normalizeRailToken(rail);
  return (
    normalized.includes('debit') ||
    normalized.includes('card') ||
    normalized.includes('visa') ||
    normalized.includes('mastercard') ||
    normalized.includes('master_card') ||
    normalized.includes('maestro')
  );
}

function isLikelyBankRail(rail: string): boolean {
  const normalized = normalizeRailToken(rail);
  return (
    normalized.includes('ach') ||
    normalized.includes('bank') ||
    normalized.includes('sepa') ||
    normalized.includes('wire') ||
    normalized.includes('swift') ||
    normalized.includes('fps') ||
    normalized.includes('pix')
  );
}

function methodRecipientDestinationPaymentRail(method: DispatchMethod): string {
  const explicit =
    method === 'DEBIT'
      ? (process.env.SEND_BRIDGE_RECIPIENT_DEBIT_DESTINATION_PAYMENT_RAIL || '').trim()
      : (process.env.SEND_BRIDGE_RECIPIENT_BANK_DESTINATION_PAYMENT_RAIL || '').trim();
  if (explicit) return explicit;

  const shared = recipientDestinationPaymentRail();
  if (!shared) return '';

  // Do not silently reuse a bank rail for debit selection.
  if (method === 'DEBIT' && !isLikelyDebitRail(shared)) {
    return '';
  }

  return shared;
}

function methodRecipientDestinationCurrency(method: DispatchMethod): string {
  const explicit =
    method === 'DEBIT'
      ? (process.env.SEND_BRIDGE_RECIPIENT_DEBIT_DESTINATION_CURRENCY || '').trim().toLowerCase()
      : (process.env.SEND_BRIDGE_RECIPIENT_BANK_DESTINATION_CURRENCY || '').trim().toLowerCase();
  if (explicit) return explicit;

  const shared = recipientDestinationCurrency();
  return shared || 'usd';
}

function methodExternalRailHints(method: DispatchMethod): Set<string> {
  const explicitCsv =
    method === 'DEBIT'
      ? process.env.SEND_BRIDGE_RECIPIENT_DEBIT_EXTERNAL_ACCOUNT_RAILS
      : process.env.SEND_BRIDGE_RECIPIENT_BANK_EXTERNAL_ACCOUNT_RAILS;
  const explicit = parseCsvSet(explicitCsv);
  if (explicit.size > 0) return explicit;

  const destinationRail = methodRecipientDestinationPaymentRail(method);
  if (destinationRail) {
    return new Set([normalizeRailToken(destinationRail)]);
  }

  return new Set();
}

function collectRailTokensFromUnknown(value: unknown, target: Set<string>): void {
  if (!value) return;
  if (typeof value === 'string') {
    const normalized = normalizeRailToken(value);
    if (normalized) {
      target.add(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectRailTokensFromUnknown(entry, target);
    }
    return;
  }
  if (typeof value === 'object') {
    const objectRecord = value as Record<string, unknown>;
    for (const entry of Object.values(objectRecord)) {
      collectRailTokensFromUnknown(entry, target);
    }
  }
}

function externalAccountRailTokens(account: BridgeExternalAccountRecord): Set<string> {
  const tokens = new Set<string>();
  collectRailTokensFromUnknown(account.payment_rail, tokens);
  collectRailTokensFromUnknown(account.paymentRail, tokens);
  collectRailTokensFromUnknown(account.rail, tokens);
  collectRailTokensFromUnknown(account.payment_rails, tokens);
  collectRailTokensFromUnknown(account.supported_payment_rails, tokens);
  collectRailTokensFromUnknown(account.rails, tokens);
  collectRailTokensFromUnknown(account.payment_method, tokens);
  collectRailTokensFromUnknown(account.paymentMethod, tokens);
  collectRailTokensFromUnknown(account.payment_methods, tokens);
  collectRailTokensFromUnknown(account.type, tokens);
  collectRailTokensFromUnknown(account.account_type, tokens);
  collectRailTokensFromUnknown(account.accountType, tokens);
  collectRailTokensFromUnknown(account.network, tokens);
  return tokens;
}

function externalAccountMatchesMethod(
  account: BridgeExternalAccountRecord,
  method: DispatchMethod,
  expectedRails: Set<string>
): boolean {
  const accountRails = externalAccountRailTokens(account);

  if (expectedRails.size > 0) {
    // If Bridge does not expose rails on this object shape, avoid hard-blocking.
    if (accountRails.size === 0) return true;
    for (const rail of accountRails) {
      if (expectedRails.has(rail)) {
        return true;
      }
    }
    return false;
  }

  if (accountRails.size === 0) return true;
  const matcher = method === 'DEBIT' ? isLikelyDebitRail : isLikelyBankRail;
  for (const rail of accountRails) {
    if (matcher(rail)) {
      return true;
    }
  }
  return false;
}

function recipientDefaultFullName(): string {
  const configured = (process.env.SEND_BRIDGE_RECIPIENT_DEFAULT_FULL_NAME || '').trim();
  return configured || 'Recipient User';
}

function normalizeBridgeFullName(name: string | undefined): string {
  const trimmed = (name || '').trim();
  if (trimmed.length >= 2) return trimmed;
  return recipientDefaultFullName();
}

function normalizeBridgeEmail(input: {
  recipientType: RecipientType;
  recipientContact: string;
  bridgeEmail?: string;
}): string | null {
  const explicit = (input.bridgeEmail || '').trim().toLowerCase();
  if (explicit && isBridgeEmail(explicit)) return explicit;

  if (input.recipientType === 'email') {
    const fromContact = input.recipientContact.trim().toLowerCase();
    if (isBridgeEmail(fromContact)) return fromContact;
  }

  return null;
}

function isExternalAccountActive(account: BridgeExternalAccountRecord): boolean {
  if (!account.id || account.id.trim().length === 0) return false;
  if (account.disabled === true) return false;

  const normalizedStatus = (account.status || account.state || '').trim().toUpperCase();
  if (!normalizedStatus) return true;

  return !['INACTIVE', 'DISABLED', 'ARCHIVED', 'CLOSED', 'REMOVED'].includes(normalizedStatus);
}

export function mapBridgeStateToDispatchStatus(value: unknown): DispatchStatus {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (raw === 'SUCCESS' || raw === 'PROCESSING' || raw === 'FALLBACK_REQUIRED' || raw === 'FAILED') {
    return raw;
  }

  if (
    raw === 'SUCCEEDED' ||
    raw === 'COMPLETED' ||
    raw === 'SETTLED' ||
    raw === 'PAYMENT_PROCESSED'
  ) {
    return 'SUCCESS';
  }

  if (
    raw === 'PENDING' ||
    raw === 'PROCESSING' ||
    raw === 'QUEUED' ||
    raw === 'IN_PROGRESS' ||
    raw === 'AWAITING_FUNDS' ||
    raw === 'AWAITING_PAYMENT' ||
    raw === 'SUBMITTED'
  ) {
    return 'PROCESSING';
  }

  if (
    raw === 'ERROR' ||
    raw === 'REJECTED' ||
    raw === 'FAILED' ||
    raw === 'CANCELED' ||
    raw === 'CANCELLED' ||
    raw === 'EXPIRED' ||
    raw === 'RETURNED'
  ) {
    return 'FAILED';
  }

  return 'PROCESSING';
}

function bridgeDispatchUrl(): string {
  const directUrl = (process.env.SEND_BRIDGE_PAYOUT_EXECUTE_URL || '').trim();
  if (directUrl) return directUrl;

  const bridgeBase = (process.env.BRIDGE_API_BASE_URL || 'https://api.bridge.xyz/v0').trim().replace(/\/+$/, '');

  const path = (process.env.SEND_BRIDGE_PAYOUT_PATH || '/transfers').trim();
  if (!path.startsWith('/')) {
    return `${bridgeBase}/${path}`;
  }
  return `${bridgeBase}${path}`;
}

class SendBridgePayoutService {
  async ensureRecipientEligibility(params: {
    transfer: SendTransferRecord;
    method: DispatchMethod;
    recipientContext?: BridgeRecipientContext;
  }): Promise<BridgeRecipientEligibilityResult> {
    const provider = bridgeProviderName();

    if (!recipientOnboardingRequired()) {
      return {
        status: 'SUCCESS',
        provider,
      };
    }

    const apiKey = bridgeApiKey();
    if (!apiKey) {
      return {
        status: 'FAILED',
        provider,
        failureCode: 'BRIDGE_API_KEY_MISSING',
        failureReason: 'Bridge API key is not configured',
      };
    }

    if (!params.recipientContext) {
      return {
        status: 'FAILED',
        provider,
        failureCode: 'BRIDGE_RECIPIENT_CONTEXT_REQUIRED',
        failureReason: 'Recipient context is required for Bridge onboarding',
      };
    }

    const normalizedEmail = normalizeBridgeEmail(params.recipientContext);
    if (!normalizedEmail) {
      return {
        status: 'ACTION_REQUIRED',
        provider,
        failureCode: 'BRIDGE_RECIPIENT_EMAIL_REQUIRED',
        failureReason: 'A valid email is required to complete Bridge onboarding',
        requiredFields: ['bridgeEmail'],
      };
    }

    const fullName = normalizeBridgeFullName(params.recipientContext.bridgeFullName);

    const persisted = await sendTransferStore.getBridgeRecipientByHashes(
      params.transfer.recipientContactHash,
      params.transfer.recipientHintHash
    );

    let customerId = persisted?.bridgeCustomerId || null;
    let externalAccountId = persisted?.bridgeExternalAccountId || null;
    let hasActiveExternalAccounts = false;

    if (!customerId) {
      const existingByEmail = await this.findKycByEmail(apiKey, normalizedEmail);
      if (existingByEmail?.customer_id) {
        customerId = existingByEmail.customer_id;
      }
    }

    if (customerId) {
      const lookup = await this.findEligibleExternalAccount(apiKey, customerId, params.method, externalAccountId);
      externalAccountId = lookup.externalAccountId;
      hasActiveExternalAccounts = lookup.hasActiveAccounts;
    }

    if (customerId && externalAccountId) {
      await sendTransferStore.upsertBridgeRecipient({
        recipientContactHash: params.transfer.recipientContactHash,
        recipientHintHash: params.transfer.recipientHintHash,
        bridgeCustomerId: customerId,
        bridgeExternalAccountId: externalAccountId,
        onboardingStatus: 'READY',
      });

      return {
        status: 'SUCCESS',
        provider,
        bridgeCustomerId: customerId,
        bridgeExternalAccountId: externalAccountId,
      };
    }

    if (customerId && hasActiveExternalAccounts) {
      await sendTransferStore.upsertBridgeRecipient({
        recipientContactHash: params.transfer.recipientContactHash,
        recipientHintHash: params.transfer.recipientHintHash,
        bridgeCustomerId: customerId,
        bridgeExternalAccountId: null,
        onboardingStatus: 'READY',
      });

      if (params.method === 'DEBIT') {
        return {
          status: 'FAILED',
          provider,
          bridgeCustomerId: customerId,
          failureCode: 'BRIDGE_DEBIT_EXTERNAL_ACCOUNT_INELIGIBLE',
          failureReason: 'Recipient does not have an eligible debit payout account. Use bank payout instead.',
        };
      }

      return {
        status: 'FAILED',
        provider,
        bridgeCustomerId: customerId,
        failureCode: 'BRIDGE_BANK_EXTERNAL_ACCOUNT_INELIGIBLE',
        failureReason: 'Recipient does not have an eligible bank payout account.',
      };
    }

    const redirectUri = bridgeOnboardingRedirectUri();
    let onboardingUrl: string | null = null;
    let kycUrl: string | null = null;
    let tosUrl: string | null = null;

    if (!customerId) {
      const created = await this.createKycLink(apiKey, {
        full_name: fullName,
        email: normalizedEmail,
        type: bridgeCustomerType(),
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      });

      if (!created.ok) {
        return {
          status: 'FAILED',
          provider,
          failureCode: 'BRIDGE_KYC_LINK_CREATE_FAILED',
          failureReason: created.message,
        };
      }

      customerId = created.data.customer_id || null;
      tosUrl = normalizeBridgeUrl(created.data.tos_link);
      kycUrl = normalizeBridgeUrl(created.data.kyc_link);
      onboardingUrl = tosUrl || kycUrl;
    } else {
      const links = await this.fetchHostedOnboardingLinks(apiKey, customerId);
      if (!links.ok) {
        return {
          status: 'FAILED',
          provider,
          failureCode: 'BRIDGE_HOSTED_LINK_FETCH_FAILED',
          failureReason: links.message,
        };
      }

      kycUrl = links.kycUrl;
      tosUrl = links.tosUrl;
      onboardingUrl = links.onboardingUrl;
    }

    await sendTransferStore.upsertBridgeRecipient({
      recipientContactHash: params.transfer.recipientContactHash,
      recipientHintHash: params.transfer.recipientHintHash,
      bridgeCustomerId: customerId,
      bridgeExternalAccountId: externalAccountId,
      onboardingStatus: 'PENDING_ONBOARDING',
      lastOnboardingUrl: onboardingUrl,
      lastKycUrl: kycUrl,
      lastTosUrl: tosUrl,
    });

    if (!onboardingUrl) {
      return {
        status: 'FAILED',
        provider,
        failureCode: 'BRIDGE_ONBOARDING_LINK_UNAVAILABLE',
        failureReason: 'Bridge did not return an onboarding URL',
      };
    }

    return {
      status: 'ACTION_REQUIRED',
      provider,
      bridgeCustomerId: customerId || undefined,
      bridgeExternalAccountId: externalAccountId || undefined,
      onboardingUrl,
      kycUrl: kycUrl || undefined,
      tosUrl: tosUrl || undefined,
      failureCode: 'BRIDGE_ONBOARDING_REQUIRED',
      failureReason: 'Recipient must complete Bridge onboarding to receive fiat payout',
      requiredFields: fullName === recipientDefaultFullName() ? ['bridgeFullName'] : undefined,
    };
  }

  async dispatch(
    payload: BridgePayoutDispatchRequest
  ): Promise<BridgePayoutDispatchResponse> {
    const provider = bridgeProviderName();

    const region = payload.transfer.region.toUpperCase();
    if (!bridgeEnabledRegions().has(region)) {
      return {
        status: 'FAILED',
        provider,
        failureCode: 'BRIDGE_REGION_UNSUPPORTED',
        failureReason: `Bridge payout is not enabled in ${region}`,
      };
    }

    if (payload.phase === 'precheck') {
      const recipientRail = methodRecipientDestinationPaymentRail(payload.method);
      if (payload.method === 'DEBIT' && !recipientRail) {
        return {
          status: 'FALLBACK_REQUIRED',
          provider,
          failureCode: 'BRIDGE_DEBIT_RAIL_UNCONFIGURED',
          failureReason:
            'Debit payout rail is not configured. Set SEND_BRIDGE_RECIPIENT_DEBIT_DESTINATION_PAYMENT_RAIL.',
          fallbackMethod: 'BANK',
        };
      }

      if (recipientOnboardingRequired() && !payload.recipientBridgeExternalAccountId) {
        if (payload.method === 'DEBIT') {
          return {
            status: 'FALLBACK_REQUIRED',
            provider,
            failureCode: 'BRIDGE_DEBIT_EXTERNAL_ACCOUNT_MISSING',
            failureReason: 'Recipient has no eligible debit payout account on file.',
            fallbackMethod: 'BANK',
          };
        }

        return {
          status: 'FAILED',
          provider,
          failureCode: 'BRIDGE_BANK_EXTERNAL_ACCOUNT_MISSING',
          failureReason: 'Recipient has no eligible bank payout account on file.',
        };
      }

      const destination = this.buildBridgeDestination(payload.method, payload.recipientBridgeExternalAccountId);
      if (!destination) {
        if (payload.method === 'DEBIT') {
          return {
            status: 'FALLBACK_REQUIRED',
            provider,
            failureCode: 'BRIDGE_DEBIT_DESTINATION_CONFIG_MISSING',
            failureReason: 'Debit destination config is missing or invalid.',
            fallbackMethod: 'BANK',
          };
        }

        return {
          status: 'FAILED',
          provider,
          failureCode: 'BRIDGE_BANK_DESTINATION_CONFIG_MISSING',
          failureReason: 'Bank destination config is missing or invalid.',
        };
      }

      return {
        status: 'SUCCESS',
        provider,
      };
    }

    return this.executeBridgeDispatch(payload);
  }

  private buildBridgeSource(): Record<string, unknown> | null {
    const override = parseJsonEnv('SEND_BRIDGE_TRANSFER_SOURCE_JSON');
    if (override) return override;

    const paymentRail = (process.env.SEND_BRIDGE_SOURCE_PAYMENT_RAIL || 'ethereum').trim();
    const currency = (process.env.SEND_BRIDGE_SOURCE_CURRENCY || 'usdc').trim().toLowerCase();
    const fromAddress = (
      process.env.SEND_BRIDGE_SOURCE_FROM_ADDRESS ||
      process.env.SEND_PAYOUT_TREASURY ||
      ''
    ).trim();

    if (!paymentRail || !currency) return null;
    if (paymentRail === 'bridge_wallet') {
      const bridgeWalletId = (process.env.SEND_BRIDGE_SOURCE_BRIDGE_WALLET_ID || '').trim();
      if (!bridgeWalletId) return null;

      return {
        payment_rail: paymentRail,
        currency,
        bridge_wallet_id: bridgeWalletId,
      };
    }

    const source: Record<string, unknown> = {
      payment_rail: paymentRail,
      currency,
    };
    if (fromAddress) {
      source.from_address = fromAddress;
    }
    return source;
  }

  private buildBridgeDestination(
    method: DispatchMethod,
    recipientBridgeExternalAccountId?: string
  ): Record<string, unknown> | null {
    const rawOverride = parseJsonEnv('SEND_BRIDGE_TRANSFER_DESTINATION_JSON');
    const recipientRail = methodRecipientDestinationPaymentRail(method);
    const recipientCurrency = methodRecipientDestinationCurrency(method);

    if (rawOverride) {
      const destination = { ...rawOverride };

      if (recipientBridgeExternalAccountId) {
        if (method === 'DEBIT' && !recipientRail) {
          return null;
        }
        if (recipientRail) {
          destination.payment_rail = recipientRail;
        }
        if (recipientCurrency) {
          destination.currency = recipientCurrency;
        }
        delete destination.prefunded_account_id;
        destination.external_account_id = recipientBridgeExternalAccountId;
      }

      return destination;
    }

    const paymentRail = (process.env.SEND_BRIDGE_DESTINATION_PAYMENT_RAIL || 'prefunded').trim();
    const currency = (process.env.SEND_BRIDGE_DESTINATION_CURRENCY || 'usd').trim().toLowerCase();
    if (!paymentRail || !currency) return null;

    const destination: Record<string, unknown> = {
      payment_rail: paymentRail,
      currency,
    };

    if (paymentRail === 'prefunded') {
      const prefundedAccountId = (process.env.SEND_BRIDGE_DESTINATION_PREFUNDED_ACCOUNT_ID || '').trim();
      if (!prefundedAccountId) return null;
      destination.prefunded_account_id = prefundedAccountId;
    }

    const destinationAddress = (process.env.SEND_BRIDGE_DESTINATION_ADDRESS || '').trim();
    if (destinationAddress) {
      destination.to_address = destinationAddress;
    }

    const destinationExternalAccountId = (process.env.SEND_BRIDGE_DESTINATION_EXTERNAL_ACCOUNT_ID || '').trim();
    if (destinationExternalAccountId) {
      destination.external_account_id = destinationExternalAccountId;
    }

    if (recipientBridgeExternalAccountId) {
      if (method === 'DEBIT' && !recipientRail) {
        return null;
      }
      if (recipientRail) {
        destination.payment_rail = recipientRail;
      }
      if (recipientCurrency) {
        destination.currency = recipientCurrency;
      }
      delete destination.prefunded_account_id;
      destination.external_account_id = recipientBridgeExternalAccountId;
    }

    return destination;
  }

  private async executeBridgeDispatch(
    payload: BridgePayoutDispatchRequest
  ): Promise<BridgePayoutDispatchResponse> {
    const provider = bridgeProviderName();
    const url = bridgeDispatchUrl();
    const apiKey = bridgeApiKey();
    if (!apiKey) {
      return {
        status: 'FAILED',
        provider,
        failureCode: 'BRIDGE_API_KEY_MISSING',
        failureReason: 'Bridge API key is not configured',
      };
    }

    const source = this.buildBridgeSource();
    const destination = this.buildBridgeDestination(payload.method, payload.recipientBridgeExternalAccountId);
    if (!source || !destination) {
      return {
        status: 'FAILED',
        provider,
        failureCode: 'BRIDGE_TRANSFER_CONFIG_MISSING',
        failureReason:
          'Bridge source/destination config is missing. Set SEND_BRIDGE_TRANSFER_SOURCE_JSON and SEND_BRIDGE_TRANSFER_DESTINATION_JSON or configure source/destination env defaults.',
      };
    }

    const apiKeyHeader = bridgeApiKeyHeader();
    const envOnBehalfOf = (process.env.SEND_BRIDGE_ON_BEHALF_OF || '').trim();
    const onBehalfOf =
      preferRecipientOnBehalfOf() && payload.recipientBridgeCustomerId
        ? payload.recipientBridgeCustomerId
        : envOnBehalfOf;
    const amount = formatUsdcMicros(payload.transfer.principalUsdc);
    const clientReferenceId = `send_${payload.transfer.transferId}_${payload.method.toLowerCase()}_${Date.now()}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), webhookTimeoutMs());

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { [apiKeyHeader]: apiKey } : {}),
        },
        body: JSON.stringify({
          amount,
          ...(onBehalfOf ? { on_behalf_of: onBehalfOf } : {}),
          source,
          destination,
          client_reference_id: clientReferenceId,
          metadata: {
            send_transfer_row_id: payload.transfer.id,
            send_transfer_id: payload.transfer.transferId,
            send_method: payload.method,
            send_chain_id: payload.transfer.chainId,
            send_treasury_tx_hash: payload.treasuryTxHash || '',
            send_bridge_customer_id: payload.recipientBridgeCustomerId || '',
            send_bridge_external_account_id: payload.recipientBridgeExternalAccountId || '',
          },
        }),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => ({}))) as {
        status?: unknown;
        provider?: unknown;
        providerReference?: unknown;
        reference?: unknown;
        id?: unknown;
        failureCode?: unknown;
        failureReason?: unknown;
        message?: unknown;
        fallbackMethod?: unknown;
        eta?: unknown;
        state?: unknown;
        transfer_id?: unknown;
      };

      if (!response.ok) {
        return {
          status: 'FAILED',
          provider,
          failureCode: `BRIDGE_HTTP_${response.status}`,
          failureReason: messageFromBridgeError(body, `Bridge dispatch failed (${response.status})`),
        };
      }

      const status = mapBridgeStateToDispatchStatus(body.state || body.status);
      const providerReference =
        typeof body.providerReference === 'string'
          ? body.providerReference
          : typeof body.reference === 'string'
          ? body.reference
          : typeof body.id === 'string'
          ? body.id
          : typeof body.transfer_id === 'string'
          ? body.transfer_id
          : `bridge_${payload.transfer.id}_${Date.now()}`;

      return {
        status,
        provider: typeof body.provider === 'string' ? body.provider : provider,
        providerReference,
        failureCode: typeof body.failureCode === 'string' ? body.failureCode : undefined,
        failureReason: typeof body.failureReason === 'string' ? body.failureReason : undefined,
        fallbackMethod: body.fallbackMethod === 'BANK' ? 'BANK' : undefined,
        eta: typeof body.eta === 'string' ? body.eta : defaultBankEta(),
      };
    } catch (error) {
      return {
        status: 'FAILED',
        provider,
        failureCode: 'BRIDGE_DISPATCH_ERROR',
        failureReason: error instanceof Error ? error.message : 'Bridge dispatch failed',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async bridgeApiRequest<T>(
    apiKey: string,
    path: string,
    init: RequestInit = {}
  ): Promise<BridgeApiResult<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), bridgeApiTimeoutMs());

    try {
      const headers = new Headers(init.headers ?? {});
      headers.set('Accept', 'application/json');
      headers.set(bridgeApiKeyHeader(), apiKey);
      if (init.body != null && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(`${bridgeApiBaseUrl()}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });

      const body = parseJsonMaybe(await response.text());
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          message: getMessageFromUnknown(body, `Bridge request failed (${response.status})`),
        };
      }

      return { ok: true, data: body as T };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          ok: false,
          status: 504,
          message: 'Bridge request timed out',
        };
      }
      return {
        ok: false,
        status: 502,
        message: error instanceof Error ? error.message : 'Bridge request failed',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async findKycByEmail(apiKey: string, email: string): Promise<BridgeKycLinkRecord | null> {
    const result = await this.bridgeApiRequest<BridgeListKycLinksResponse>(
      apiKey,
      `/kyc_links?email=${encodeURIComponent(email)}&limit=1`,
      { method: 'GET' }
    );

    if (!result.ok || !Array.isArray(result.data.data) || result.data.data.length === 0) {
      return null;
    }

    return result.data.data[0] ?? null;
  }

  private async createKycLink(
    apiKey: string,
    payload: BridgeCreateKycLinkRequest
  ): Promise<BridgeApiResult<BridgeCreateKycLinkResponse>> {
    return this.bridgeApiRequest<BridgeCreateKycLinkResponse>(apiKey, '/kyc_links', {
      method: 'POST',
      headers: { 'Idempotency-Key': randomUUID() },
      body: JSON.stringify(payload),
    });
  }

  private async fetchHostedOnboardingLinks(
    apiKey: string,
    customerId: string
  ): Promise<
    | {
        ok: true;
        onboardingUrl: string | null;
        kycUrl: string | null;
        tosUrl: string | null;
      }
    | { ok: false; message: string }
  > {
    const redirectUri = bridgeOnboardingRedirectUri();
    const redirectQuery = redirectUri
      ? `?redirect_uri=${encodeURIComponent(redirectUri)}`
      : '';

    const [tosResult, kycResult] = await Promise.all([
      this.bridgeApiRequest<BridgeHostedLinkResponse>(
        apiKey,
        `/customers/${encodeURIComponent(customerId)}/tos_acceptance_link`,
        { method: 'GET' }
      ),
      this.bridgeApiRequest<BridgeHostedLinkResponse>(
        apiKey,
        `/customers/${encodeURIComponent(customerId)}/kyc_link${redirectQuery}`,
        { method: 'GET' }
      ),
    ]);

    if (!tosResult.ok && !kycResult.ok) {
      return {
        ok: false,
        message: tosResult.message || kycResult.message || 'Unable to retrieve Bridge onboarding links',
      };
    }

    const tosUrl = normalizeBridgeUrl(tosResult.ok ? tosResult.data.url : null);
    const kycUrl = normalizeBridgeUrl(kycResult.ok ? kycResult.data.url : null);
    return {
      ok: true,
      onboardingUrl: tosUrl || kycUrl,
      kycUrl,
      tosUrl,
    };
  }

  private async findEligibleExternalAccount(
    apiKey: string,
    customerId: string,
    method: DispatchMethod,
    preferredExternalAccountId?: string | null
  ): Promise<{ externalAccountId: string | null; hasActiveAccounts: boolean }> {
    const result = await this.bridgeApiRequest<BridgeListExternalAccountsResponse>(
      apiKey,
      `/customers/${encodeURIComponent(customerId)}/external_accounts?limit=${bridgeExternalAccountLookupLimit()}`,
      { method: 'GET' }
    );

    if (!result.ok || !Array.isArray(result.data.data)) {
      return { externalAccountId: null, hasActiveAccounts: false };
    }

    const activeAccounts = result.data.data.filter((account) => isExternalAccountActive(account) && !!account.id);
    if (activeAccounts.length === 0) {
      return { externalAccountId: null, hasActiveAccounts: false };
    }

    const expectedRails = methodExternalRailHints(method);

    if (preferredExternalAccountId) {
      const preferred = activeAccounts.find(
        (account) =>
          account.id === preferredExternalAccountId &&
          externalAccountMatchesMethod(account, method, expectedRails)
      );
      if (preferred?.id) {
        return { externalAccountId: preferred.id, hasActiveAccounts: true };
      }
    }

    const matched = activeAccounts.find((account) => externalAccountMatchesMethod(account, method, expectedRails));
    if (matched?.id) {
      return { externalAccountId: matched.id, hasActiveAccounts: true };
    }

    return { externalAccountId: null, hasActiveAccounts: true };
  }

  fromTransferRecord(transfer: SendTransferRecord): BridgePayoutDispatchRequest['transfer'] {
    return {
      id: transfer.id,
      transferId: transfer.transferId,
      senderWallet: transfer.senderWallet,
      principalUsdc: transfer.principalUsdc,
      sponsorFeeUsdc: transfer.sponsorFeeUsdc,
      totalLockedUsdc: transfer.totalLockedUsdc,
      region: transfer.region,
      chainId: transfer.chainId,
      expiresAt: transfer.expiresAt.toISOString(),
    };
  }
}

export const sendBridgePayoutService = new SendBridgePayoutService();
