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
  async authHeader(method: string, path: string): Promise<string> {
    const apiKeyId = keyId();
    const apiKeySecret = keySecret();
    if (!apiKeyId || !apiKeySecret) throw new Error('Coinbase Onramp not configured (CDP_API_KEY_ID/SECRET)');
    const jwt = await generateJwt({
      apiKeyId,
      apiKeySecret,
      requestMethod: method,
      requestHost: API_HOST,
      requestPath: path,
      expiresIn: 120,
    });
    return `Bearer ${jwt}`;
  },

  async apiFetch(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    const auth = await this.authHeader(method, path);
    const r = await fetch(`https://${API_HOST}${path}`, {
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
};

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
