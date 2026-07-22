import { generateJwt } from '@coinbase/cdp-sdk/auth';

/*
 * Coinbase CDP Onramp/Offramp (headless) — fiat↔USDC for the Add-money / Withdraw flows, replacing the
 * Onramper aggregator (kept as an env fallback). We reuse the SAME CDP API key the gasless relayer uses
 * (generateJwt from @coinbase/cdp-sdk/auth) to authenticate the Onramp API; the browser only ever gets a
 * short-lived session token + a pay.coinbase.com URL, never the key. Mainly Base + USDC.
 *
 * Setup (one-time, in the CDP portal): enable Onramp on the project and allowlist the app domain.
 * Docs: https://docs.cdp.coinbase.com/onramp/introduction/welcome
 *
 * NOTE: exact request/response field names for the Onramp REST API are followed from the docs but parsed
 * defensively (like the Onramper integration was) until verified against live responses.
 */

const API_HOST = 'api.developer.coinbase.com';
// The headless (Apple Pay) order API lives on a DIFFERENT host and under a /platform prefix:
// POST https://api.cdp.coinbase.com/platform/v2/onramp/orders. Calling it on API_HOST as
// /v2/onramp/orders 404s — which surfaced as Apple Pay silently opening the hosted page instead.
const CDP_API_HOST = 'api.cdp.coinbase.com';
const PAY_URL = 'https://pay.coinbase.com';

// Default asset/network for Clear — Base USDC.
const DEFAULT_NETWORK = 'base';
const DEFAULT_ASSET = 'USDC';

// Resolve the CDP API key the same way the relayer does (SEND_CDP_* is what's set on Railway), with an
// optional CDP_ONRAMP_* override — the same Secret API key works for all CDP APIs once Onramp is enabled.
function keyId(): string | null {
  return (
    process.env.CDP_ONRAMP_API_KEY_ID ||
    process.env.SEND_CDP_API_KEY_ID ||
    process.env.CDP_API_KEY_ID ||
    process.env.CDP_API_KEY_NAME ||
    ''
  ).trim() || null;
}
function keySecret(): string | null {
  return (
    process.env.CDP_ONRAMP_API_KEY_SECRET ||
    process.env.SEND_CDP_API_KEY_SECRET ||
    process.env.CDP_API_KEY_SECRET ||
    ''
  ).trim() || null;
}

/** Sandbox mode (RAMP_SANDBOX=true, set on dev/preview): transactions always succeed and the card is
 *  never charged. Enabled by a `sandbox-` partnerUserRef prefix + a useApplePaySandbox=true URL param. */
export function isRampSandbox(): boolean {
  return /^(true|1|yes)$/i.test((process.env.RAMP_SANDBOX || '').trim());
}
/** Prefix a ref for sandbox so the order, the status poll and the webhook all agree on the same id. */
export function sandboxRef(ref: string): string {
  return isRampSandbox() && !ref.startsWith('sandbox-') ? `sandbox-${ref}` : ref;
}

/** Map the UI's payment-method id to Coinbase's enum. Guest checkout (no Coinbase login) is offered by
 *  the widget automatically when eligible, so we pass the plain method and let Coinbase pick the lane. */
export function toCoinbasePaymentMethod(methodId?: string): string {
  switch ((methodId || '').toLowerCase()) {
    case 'applepay':
    case 'apple_pay':
      return 'APPLE_PAY';
    case 'ach':
    case 'bank':
    case 'ach_bank_account':
      return 'ACH_BANK_ACCOUNT';
    default:
      return 'CARD';
  }
}

export const coinbaseOnrampService = {
  isConfigured(): boolean {
    return Boolean(keyId() && keySecret());
  },

  /** Bearer auth header for an Onramp API request (short-lived JWT signed with the CDP API key). */
  async authHeader(method: string, path: string, host: string = API_HOST): Promise<string> {
    const apiKeyId = keyId();
    const apiKeySecret = keySecret();
    if (!apiKeyId || !apiKeySecret) throw new Error('Coinbase Onramp not configured (CDP_API_KEY_ID/SECRET)');
    // The JWT is bound to the host + path, so both must match the request exactly or Coinbase rejects it.
    const jwt = await generateJwt({
      apiKeyId,
      apiKeySecret,
      requestMethod: method,
      requestHost: host,
      requestPath: path,
      expiresIn: 120,
    });
    return `Bearer ${jwt}`;
  },

  async apiFetch(method: 'GET' | 'POST', path: string, body?: unknown, host: string = API_HOST): Promise<any> {
    const auth = await this.authHeader(method, path, host);
    const r = await fetch(`https://${host}${path}`, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data: any = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = (data && (data.message || data.error || data.error_message)) || `Coinbase Onramp API ${r.status}`;
      const err = new Error(String(msg)) as Error & { status?: number; raw?: unknown };
      err.status = r.status;
      err.raw = data;
      throw err;
    }
    return data;
  },

  /**
   * Create a single-use session token scoped to the destination wallet + assets/networks. Required to
   * open the hosted pay.coinbase.com flow without exposing the API key. ~5 min TTL, one-time use.
   */
  async createSessionToken(params: {
    address: string;
    blockchains?: string[];
    assets?: string[];
  }): Promise<{ token: string; channelId?: string }> {
    const data = await this.apiFetch('POST', '/onramp/v1/token', {
      addresses: [{ address: params.address, blockchains: params.blockchains ?? [DEFAULT_NETWORK] }],
      assets: params.assets ?? [DEFAULT_ASSET],
    });
    const token = data?.token || data?.session_token || data?.data?.token;
    if (!token) {
      const err = new Error('Coinbase session token missing from response') as Error & { raw?: unknown };
      err.raw = data;
      throw err;
    }
    return { token: String(token), channelId: data?.channel_id ? String(data.channel_id) : undefined };
  },

  /** Buy quote (fees + rate) for a fiat amount → USDC on Base. Normalized to the app's quote shape. */
  /**
   * Per-payment-method min/max for buying. Coinbase does NOT publish these — the docs say to read
   * them at runtime from Get Buy Options — and they differ by method (a card minimum is not an ACH
   * minimum). Hardcoding a floor guarantees either rejected checkouts or an artificially high limit.
   */
  async buyLimits(params: { country?: string; subdivision?: string } = {}): Promise<Record<string, { min: number; max: number }>> {
    const q = new URLSearchParams({ country: (params.country ?? 'US').toUpperCase() });
    if (params.subdivision) q.set('subdivision', params.subdivision.toUpperCase());
    const data = await this.apiFetch('GET', `/onramp/v1/buy/options?${q.toString()}`);
    const currencies: any[] = data?.payment_currencies ?? data?.paymentCurrencies ?? [];
    const usd = currencies.find((c) => String(c?.id ?? '').toUpperCase() === 'USD') ?? currencies[0];
    const out: Record<string, { min: number; max: number }> = {};
    for (const l of usd?.limits ?? []) {
      const id = String(l?.id ?? '').toUpperCase();
      const min = Number(l?.min);
      const max = Number(l?.max);
      if (id && Number.isFinite(min) && Number.isFinite(max)) out[id] = { min, max };
    }
    return out;
  },

  async buyQuote(params: {
    amount: number;
    fiat?: string;
    asset?: string;
    network?: string;
    paymentMethod?: string;
    country?: string;
    subdivision?: string;
  }): Promise<NormalizedRampQuote> {
    const data = await this.apiFetch('POST', '/onramp/v1/buy/quote', {
      purchase_currency: params.asset ?? DEFAULT_ASSET,
      purchase_network: params.network ?? DEFAULT_NETWORK,
      payment_amount: params.amount.toFixed(2),
      payment_currency: (params.fiat ?? 'USD').toUpperCase(),
      payment_method: toCoinbasePaymentMethod(params.paymentMethod),
      country: (params.country ?? 'US').toUpperCase(),
      ...(params.subdivision ? { subdivision: params.subdivision.toUpperCase() } : {}),
    });
    const num = (v: unknown): number | undefined => {
      const n = typeof v === 'object' && v ? Number((v as any).amount ?? (v as any).value) : Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    return {
      provider: 'coinbase',
      fiatAmount: num(data?.payment_total) ?? params.amount,
      fiatSubtotal: num(data?.payment_subtotal) ?? params.amount,
      cryptoAmount: num(data?.purchase_amount),
      coinbaseFee: num(data?.coinbase_fee),
      networkFee: num(data?.network_fee),
      quoteId: data?.quote_id ? String(data.quote_id) : undefined,
      asset: params.asset ?? DEFAULT_ASSET,
      network: params.network ?? DEFAULT_NETWORK,
      raw: data,
    };
  },

  /**
   * HEADLESS on-ramp (Guest Checkout) — create an order and get back a payment link (an Apple Pay
   * button URL) we embed in an iframe, so the buy happens inside our own UI. US only, Apple Pay on web.
   * Requires the user's verified email + phone (we source these from the authed Privy session). Docs:
   * https://docs.cdp.coinbase.com/onramp/headless-onramp/overview
   */
  async createOnrampOrder(params: {
    amount: number;
    email: string;
    phoneNumber: string; // E.164
    destinationAddress: string;
    domain: string; // where the iframe is embedded — must be allowlisted in the CDP portal
    partnerUserRef: string;
    fiat?: string;
    asset?: string;
    network?: string;
    paymentMethod?: 'GUEST_CHECKOUT_APPLE_PAY' | 'GUEST_CHECKOUT_CARD';
  }): Promise<{ paymentLinkUrl: string; paymentLinkType?: string; orderId?: string; raw: any }> {
    const now = new Date().toISOString();
    const data = await this.apiFetch('POST', '/platform/v2/onramp/orders', {
      paymentCurrency: (params.fiat ?? 'USD').toUpperCase(),
      purchaseCurrency: params.asset ?? DEFAULT_ASSET,
      destinationNetwork: params.network ?? DEFAULT_NETWORK,
      destinationAddress: params.destinationAddress,
      paymentMethod: params.paymentMethod ?? 'GUEST_CHECKOUT_APPLE_PAY',
      paymentAmount: params.amount.toFixed(2), // fiat, inclusive of fees
      email: params.email,
      phoneNumber: params.phoneNumber,
      // The user is verified via Privy at login; we attest the verification time (no separate SMS step).
      phoneNumberVerifiedAt: now,
      agreementAcceptedAt: now,
      partnerUserRef: sandboxRef(params.partnerUserRef),
      domain: params.domain,
    }, CDP_API_HOST);
    let url = data?.paymentLink?.url || data?.payment_link?.url;
    if (!url) {
      const err = new Error('Coinbase order payment link missing') as Error & { raw?: unknown };
      err.raw = data;
      throw err;
    }
    if (isRampSandbox()) url = `${url}${String(url).includes('?') ? '&' : '?'}useApplePaySandbox=true`;
    return {
      paymentLinkUrl: String(url),
      paymentLinkType: data?.paymentLink?.paymentLinkType || data?.payment_link?.paymentLinkType,
      orderId: data?.order?.orderId ? String(data.order.orderId) : undefined,
      raw: data,
    };
  },

  /** Build the hosted onramp URL to redirect the user to (session token carries the appId + wallet). */
  buildBuyUrl(params: {
    token: string;
    amount: number;
    fiat?: string;
    asset?: string;
    network?: string;
    paymentMethod?: string;
    quoteId?: string;
    partnerUserId?: string;
    redirectUrl?: string;
  }): string {
    const q = new URLSearchParams({
      sessionToken: params.token,
      defaultAsset: params.asset ?? DEFAULT_ASSET,
      defaultNetwork: params.network ?? DEFAULT_NETWORK,
      defaultPaymentMethod: toCoinbasePaymentMethod(params.paymentMethod),
      presetFiatAmount: String(Math.round(params.amount)),
      fiatCurrency: (params.fiat ?? 'USD').toUpperCase(),
      defaultExperience: 'buy',
    });
    if (params.quoteId) q.set('quoteId', params.quoteId);
    if (params.partnerUserId) q.set('partnerUserId', params.partnerUserId);
    if (params.redirectUrl) q.set('redirectUrl', params.redirectUrl);
    return `${PAY_URL}/buy/select-asset?${q.toString()}`;
  },

  /**
   * Latest ON-ramp (buy) transaction for a partnerUserRef — used to confirm a deposit landed (so we can
   * notify + refresh the balance) for both the hosted-redirect and the Apple Pay iframe flows.
   */
  async getBuyStatus(partnerUserRef: string): Promise<OnrampBuyStatus | null> {
    const path = `/onramp/v1/buy/user/${encodeURIComponent(sandboxRef(partnerUserRef))}/transactions?page_size=1`;
    const data = await this.apiFetch('GET', path);
    const tx = Array.isArray(data?.transactions) ? data.transactions[0] : undefined;
    if (!tx) return null;
    const amt = tx.purchase_amount || tx.purchaseAmount || {};
    return {
      id: String(tx.transaction_id || tx.transactionId || tx.order_id || tx.orderId || ''),
      status: String(tx.status || ''),
      purchaseAmount: amt.value != null ? String(amt.value) : null,
      currency: amt.currency ? String(amt.currency) : null,
      txHash: tx.tx_hash ? String(tx.tx_hash) : null,
      raw: tx,
    };
  },

  // ---- OFF-RAMP (sell → fiat) --------------------------------------------------------------------
  // Flow: open the offramp URL → user picks amount + cash-out destination on Coinbase → we poll the
  // status API → when it's STARTED with a to_address, our app sends that USDC on-chain → Coinbase pays
  // out. Docs: https://docs.cdp.coinbase.com/onramp/offramp/offramp-overview

  /** Build the hosted offramp URL. `partnerUserRef` scopes the transaction so we can poll its status. */
  buildSellUrl(params: { token: string; partnerUserRef: string; redirectUrl?: string }): string {
    const q = new URLSearchParams({ sessionToken: params.token, partnerUserRef: params.partnerUserRef });
    if (params.redirectUrl) q.set('redirectUrl', params.redirectUrl);
    return `${PAY_URL}/v3/sell/input?${q.toString()}`;
  },

  /**
   * Latest offramp transaction for a partnerUserRef. When status is STARTED it carries the Coinbase
   * `to_address` + `sell_amount` we must send USDC to (within 30 min). Normalized for the app.
   */
  async getSellStatus(partnerUserRef: string): Promise<OfframpStatus | null> {
    const path = `/onramp/v1/sell/user/${encodeURIComponent(partnerUserRef)}/transactions?page_size=1`;
    const data = await this.apiFetch('GET', path);
    const tx = Array.isArray(data?.transactions) ? data.transactions[0] : undefined;
    if (!tx) return null;
    const amt = tx.sell_amount || {};
    return {
      status: String(tx.status || ''),
      toAddress: tx.to_address ? String(tx.to_address) : null,
      amount: amt.value != null ? String(amt.value) : null,
      currency: amt.currency ? String(amt.currency) : null,
      asset: tx.asset ? String(tx.asset) : null,
      network: tx.network ? String(tx.network) : null,
      raw: tx,
    };
  },
};

export interface OnrampBuyStatus {
  id: string; // Coinbase transaction/order id — used as the notification dedupe ref
  status: string; // TRANSACTION_STATUS_STARTED | _SUCCESS | _FAILED
  purchaseAmount: string | null; // USDC bought
  currency: string | null;
  txHash: string | null;
  raw?: unknown;
}

export interface OfframpStatus {
  status: string; // TRANSACTION_STATUS_STARTED | _SUCCESS | _FAILED
  toAddress: string | null; // Coinbase-managed address to send the USDC to (when STARTED)
  amount: string | null; // sell_amount.value
  currency: string | null; // sell_amount.currency (e.g. USDC)
  asset: string | null;
  network: string | null;
  raw?: unknown;
}

export interface NormalizedRampQuote {
  provider: string;
  fiatAmount: number; // total the user pays (incl. fees) for buy; total received for sell
  fiatSubtotal: number;
  cryptoAmount?: number; // USDC bought (buy) / sold (sell)
  coinbaseFee?: number;
  networkFee?: number;
  quoteId?: string;
  asset: string;
  network: string;
  raw?: unknown;
}
