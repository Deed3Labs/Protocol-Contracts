import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { requireWalletMatch } from '../middleware/auth.js';
import { bridgeCustomerStore } from '../services/bridgeCustomerStore.js';
import {
  resolveCustomerForEmails,
  getCustomerSnapshot,
  startKyc,
  ensureVirtualAccount,
} from '../services/bridgeCustomerService.js';
import { isAddress } from 'ethers';

const router = Router();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

type BridgeCustomerType = 'individual' | 'business';

type BridgeApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

type BridgeKycLinkRecord = {
  customer_id?: string;
  kyc_link?: string;
  tos_link?: string;
  tos_status?: string;
};

type BridgeListKycLinksResponse = {
  data?: BridgeKycLinkRecord[];
};

type BridgeHostedLinkResponse = {
  url?: string | null;
};

type BridgeCreateKycLinkRequest = {
  full_name: string;
  email: string;
  type: BridgeCustomerType;
  redirect_uri?: string;
};

type BridgeCreateKycLinkResponse = BridgeKycLinkRecord;

function getBridgeApiBaseUrl(): string {
  const raw = (process.env.BRIDGE_API_BASE_URL || 'https://api.bridge.xyz/v0').trim().replace(/\/+$/, '');
  if (raw.endsWith('/v0')) return raw;
  return `${raw}/v0`;
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

async function bridgeApiRequest<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<BridgeApiResult<T>> {
  const timeoutMs = parseInt(process.env.BRIDGE_API_TIMEOUT_MS || '15000', 10);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(init.headers ?? {});
    headers.set('Accept', 'application/json');
    headers.set('Api-Key', apiKey);
    if (init.body != null && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${getBridgeApiBaseUrl()}${path}`, {
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

function buildBridgeUrl(baseUrl: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    query.set(key, value);
  }
  return `${baseUrl.replace(/\/$/, '')}?${query.toString()}`;
}

/**
 * POST /api/bridge/funding-url
 * Returns a URL to open Bridge (ACH/wire) funding flow with wallet, amount, destination currency and network.
 * Body: { walletAddress, amount, destinationCurrency, destinationNetwork }
 * Returns: { url: string } or 501 if Bridge is not configured.
 */
router.post('/funding-url', async (req: Request, res: Response) => {
  try {
    const { walletAddress, amount, destinationCurrency, destinationNetwork } = req.body;

    if (!walletAddress || !amount || !destinationCurrency || !destinationNetwork) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'walletAddress, amount, destinationCurrency, and destinationNetwork are required',
      });
    }
    if (typeof walletAddress !== 'string' || !isAddress(walletAddress)) {
      return res.status(400).json({
        error: 'Invalid walletAddress',
        message: 'walletAddress must be a valid EVM address',
      });
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        error: 'Invalid amount',
        message: 'amount must be a positive number',
      });
    }
    const normalizedCurrency = String(destinationCurrency).trim().toUpperCase();
    const normalizedNetwork = String(destinationNetwork).trim().toLowerCase();
    if (!/^[A-Z0-9]{2,12}$/.test(normalizedCurrency)) {
      return res.status(400).json({
        error: 'Invalid destinationCurrency',
        message: 'destinationCurrency must be 2-12 alphanumeric characters',
      });
    }
    if (!/^[a-z0-9-]{2,32}$/.test(normalizedNetwork)) {
      return res.status(400).json({
        error: 'Invalid destinationNetwork',
        message: 'destinationNetwork must be 2-32 lowercase characters, numbers, or hyphens',
      });
    }
    if (!requireWalletMatch(req, res, walletAddress, 'walletAddress')) return;

    const bridgeBaseUrl = process.env.BRIDGE_FUNDING_URL_BASE || process.env.BRIDGE_BASE_URL;
    const bridgeApiKey = process.env.BRIDGE_API_KEY;

    // If Bridge provides a client URL with query params, build it
    if (bridgeBaseUrl) {
      const url = buildBridgeUrl(bridgeBaseUrl, {
        wallet: walletAddress,
        amount: String(parsedAmount),
        currency: normalizedCurrency,
        network: normalizedNetwork,
        intent: 'funding',
      });
      return res.json({ url });
    }

    // Optional: call Bridge API to create a session and return their redirect URL (when BRIDGE_API_KEY is set)
    if (bridgeApiKey) {
      // Placeholder for Bridge API session creation (e.g. bridge.xyz or similar)
      // const bridgeResponse = await fetch(`${getBridgeApiBaseUrl()}/sessions`, { ... });
      // return res.json({ url: bridgeResponse.redirect_url });
    }

    // Not configured: return a placeholder so client can still show "Funding complete" message
    // Client will open nothing and show the 1-3 business days message
    return res.status(501).json({
      error: 'Bridge not configured',
      message: 'Set BRIDGE_FUNDING_URL_BASE or BRIDGE_API_KEY to enable bank funding',
      url: null,
    });
  } catch (error) {
    console.error('Bridge funding-url error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/bridge/onboarding-url
 * Returns a URL to open Bridge onboarding for direct-deposit setup.
 * Body: { walletAddress, hasPlaidAccount?, fullName?, email?, customerType? }
 * Returns: { url: string } or 501 if Bridge is not configured.
 *
 * Behavior:
 * - If BRIDGE_API_KEY is configured, uses Bridge API:
 *   1) lookup existing customer via /kyc_links?email=...
 *   2) if found, fetch hosted /customers/{id}/tos_acceptance_link and /customers/{id}/kyc_link
 *   3) if not found, create /kyc_links
 * - Else falls back to BRIDGE_ONBOARDING_URL_BASE/BRIDGE_FUNDING_URL_BASE.
 */
router.post('/onboarding-url', async (req: Request, res: Response) => {
  try {
    const { walletAddress, hasPlaidAccount, fullName, email, customerType } = req.body as {
      walletAddress?: string;
      hasPlaidAccount?: boolean;
      fullName?: string;
      email?: string;
      customerType?: BridgeCustomerType;
    };

    if (!walletAddress) {
      return res.status(400).json({
        error: 'Missing walletAddress',
        message: 'walletAddress is required',
      });
    }
    if (typeof walletAddress !== 'string' || !isAddress(walletAddress)) {
      return res.status(400).json({
        error: 'Invalid walletAddress',
        message: 'walletAddress must be a valid EVM address',
      });
    }
    if (hasPlaidAccount != null && typeof hasPlaidAccount !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid hasPlaidAccount',
        message: 'hasPlaidAccount must be a boolean when provided',
      });
    }
    if (customerType != null && customerType !== 'individual' && customerType !== 'business') {
      return res.status(400).json({
        error: 'Invalid customerType',
        message: 'customerType must be "individual" or "business"',
      });
    }
    if (!requireWalletMatch(req, res, walletAddress, 'walletAddress')) return;

    const normalizedFullName = typeof fullName === 'string' ? fullName.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedCustomerType: BridgeCustomerType =
      customerType === 'business' ? 'business' : 'individual';

    const bridgeApiKey = (process.env.BRIDGE_API_KEY || '').trim();
    const bridgeBaseUrl =
      process.env.BRIDGE_ONBOARDING_URL_BASE ||
      process.env.BRIDGE_FUNDING_URL_BASE ||
      process.env.BRIDGE_BASE_URL;

    if (bridgeApiKey) {
      if (normalizedFullName.length < 2) {
        return res.status(400).json({
          error: 'Missing fullName',
          message: 'fullName is required for Bridge onboarding',
        });
      }
      if (!EMAIL_REGEX.test(normalizedEmail)) {
        return res.status(400).json({
          error: 'Invalid email',
          message: 'A valid email is required for Bridge onboarding',
        });
      }

      const redirectUri = process.env.BRIDGE_ONBOARDING_REDIRECT_URI?.trim();

      let existingByEmail: BridgeKycLinkRecord | null = null;
      const existingResult = await bridgeApiRequest<BridgeListKycLinksResponse>(
        bridgeApiKey,
        `/kyc_links?email=${encodeURIComponent(normalizedEmail)}&limit=1`,
        { method: 'GET' }
      );
      if (existingResult.ok && Array.isArray(existingResult.data.data) && existingResult.data.data.length > 0) {
        existingByEmail = existingResult.data.data[0] ?? null;
      }

      let source: 'existing_customer' | 'new_customer' = 'new_customer';
      let customerId: string | null = null;
      let kycUrl: string | null = null;
      let tosUrl: string | null = null;
      let onboardingUrl: string | null = null;

      if (existingByEmail?.customer_id) {
        source = 'existing_customer';
        customerId = existingByEmail.customer_id;

        const redirectQuery = redirectUri
          ? `?redirect_uri=${encodeURIComponent(redirectUri)}`
          : '';
        const [tosResult, kycResult] = await Promise.all([
          bridgeApiRequest<BridgeHostedLinkResponse>(
            bridgeApiKey,
            `/customers/${encodeURIComponent(existingByEmail.customer_id)}/tos_acceptance_link`,
            { method: 'GET' }
          ),
          bridgeApiRequest<BridgeHostedLinkResponse>(
            bridgeApiKey,
            `/customers/${encodeURIComponent(existingByEmail.customer_id)}/kyc_link${redirectQuery}`,
            { method: 'GET' }
          ),
        ]);

        tosUrl = normalizeBridgeUrl(tosResult.ok ? tosResult.data.url : existingByEmail.tos_link);
        kycUrl = normalizeBridgeUrl(kycResult.ok ? kycResult.data.url : existingByEmail.kyc_link);

        const tosApproved = (existingByEmail.tos_status || '').toLowerCase() === 'approved';
        onboardingUrl = tosApproved ? (kycUrl || tosUrl) : (tosUrl || kycUrl);
      }

      if (!onboardingUrl) {
        const payload: BridgeCreateKycLinkRequest = {
          full_name: normalizedFullName,
          email: normalizedEmail,
          type: normalizedCustomerType,
          ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        };

        const createResult = await bridgeApiRequest<BridgeCreateKycLinkResponse>(
          bridgeApiKey,
          '/kyc_links',
          {
            method: 'POST',
            headers: { 'Idempotency-Key': randomUUID() },
            body: JSON.stringify(payload),
          }
        );

        if (!createResult.ok) {
          const status = upstreamStatus(createResult.status);
          return res.status(status).json({
            error: 'Failed to create Bridge onboarding link',
            message: createResult.message,
          });
        }

        source = 'new_customer';
        customerId = createResult.data.customer_id ?? null;
        tosUrl = normalizeBridgeUrl(createResult.data.tos_link);
        kycUrl = normalizeBridgeUrl(createResult.data.kyc_link);
        onboardingUrl = tosUrl || kycUrl;
      }

      if (!onboardingUrl) {
        return res.status(502).json({
          error: 'Bridge returned no onboarding link',
          message: 'Unable to start onboarding at this time',
        });
      }

      return res.json({
        url: onboardingUrl,
        source,
        customerId,
        kycUrl,
        tosUrl,
      });
    }

    // Fallback: static hosted URL configuration
    if (bridgeBaseUrl) {
      const url = buildBridgeUrl(bridgeBaseUrl, {
        wallet: walletAddress,
        intent: 'onboarding',
        flow: 'direct-deposit',
        hasPlaidAccount: hasPlaidAccount == null ? undefined : hasPlaidAccount ? '1' : '0',
        email: normalizedEmail || undefined,
        fullName: normalizedFullName || undefined,
        customerType: normalizedCustomerType,
      });
      return res.json({
        url,
        source: 'configured_url',
      });
    }

    return res.status(501).json({
      error: 'Bridge onboarding not configured',
      message:
        'Set BRIDGE_API_KEY (recommended) or BRIDGE_ONBOARDING_URL_BASE / BRIDGE_FUNDING_URL_BASE to enable onboarding',
      url: null,
    });
  } catch (error) {
    console.error('Bridge onboarding-url error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/bridge/virtual-account  → the signed-in member's Bridge virtual account (USDC funding via
 * an ACH account/routing number).
 *
 * The customer is resolved from the emails Privy verified for THIS session (email login + Google/
 * Apple OAuth) — never from a client-supplied address, since the response contains bank account and
 * routing numbers and would otherwise let any authenticated caller enumerate other people's details.
 * Best-effort: returns { available: false } when Bridge isn't configured / no customer / no VA yet,
 * so the UI can fall back gracefully. (Field names read defensively against the Bridge v0 shape.)
 */
type BridgeVirtualAccount = {
  id?: string;
  status?: string;
  source_deposit_instructions?: {
    bank_name?: string;
    bank_account_number?: string;
    account_number?: string;
    bank_routing_number?: string;
    routing_number?: string;
    currency?: string;
  };
};

router.get('/virtual-account', async (req: Request, res: Response) => {
  try {
    const bridgeApiKey = (process.env.BRIDGE_API_KEY || '').trim();
    if (!bridgeApiKey) {
      res.json({ available: false, reason: 'not_configured' });
      return;
    }

    // Only emails this session's Privy user actually verified — see the note above.
    const emails = (req.auth?.emails ?? [req.auth?.email ?? '']).filter((e) => EMAIL_REGEX.test(e));
    if (emails.length === 0) {
      res.json({ available: false, reason: 'no_email' });
      return;
    }

    const resolved = await resolveCustomerForEmails(emails);
    const customerId = resolved?.customerId;
    if (!customerId) {
      res.json({ available: false, reason: 'no_customer' });
      return;
    }

    const vaResult = await bridgeApiRequest<{ data?: BridgeVirtualAccount[] }>(
      bridgeApiKey,
      `/customers/${encodeURIComponent(customerId)}/virtual_accounts`,
      { method: 'GET' },
    );
    const va = vaResult.ok ? vaResult.data.data?.[0] : undefined;
    const di = va?.source_deposit_instructions;
    const accountNumber = di?.bank_account_number || di?.account_number || null;
    const routingNumber = di?.bank_routing_number || di?.routing_number || null;
    if (!accountNumber || !routingNumber) {
      res.json({ available: false, reason: 'no_virtual_account' });
      return;
    }

    res.json({
      available: true,
      bankName: di?.bank_name ?? null,
      accountNumber,
      routingNumber,
      accountLast4: accountNumber.slice(-4),
    });
  } catch (error) {
    res.status(200).json({ available: false, reason: error instanceof Error ? error.message : 'error' });
  }
});

/**
 * Map an upstream Bridge status onto one we can safely return.
 *
 * NEVER pass 401/403 through: those are OUR auth codes, and the client reacts to a 401 by clearing
 * the session and telling the member to sign in again. Bridge rejecting our API key would therefore
 * present as "your session expired" — blaming the user for a server-side credential problem.
 */
function upstreamStatus(status: number): number {
  if (status === 401 || status === 403) return 502; // Bridge rejected US, not the caller
  return status >= 400 && status < 500 ? status : 502;
}

/** Emails Privy verified for THIS session — the only addresses we'll look a customer up by. */
function sessionEmails(req: Request): string[] {
  const list = req.auth?.emails ?? (req.auth?.email ? [req.auth.email] : []);
  return list.map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_REGEX.test(e));
}

/** Remember which member this Bridge customer is, so webhooks can be attributed to a wallet. */
function rememberCustomer(req: Request, customerId: string | undefined, email?: string): void {
  const wallet = req.auth?.smartWallet || req.auth?.walletAddress || '';
  if (customerId && wallet) void bridgeCustomerStore.link(customerId, wallet, email);
}

/**
 * GET /api/bridge/status → everything the app needs to decide whether money can move:
 * whether Bridge is configured, whether this member is already a Bridge customer (under ANY of their
 * emails), their KYC state, and their virtual account if one exists. Never creates anything.
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    if (!(process.env.BRIDGE_API_KEY || '').trim()) {
      res.json({ configured: false, verified: false, kycStatus: 'not_started', virtualAccount: null });
      return;
    }
    const emails = sessionEmails(req);
    if (emails.length === 0) {
      res.json({ configured: true, verified: false, kycStatus: 'not_started', virtualAccount: null, reason: 'no_email' });
      return;
    }

    const resolved = await resolveCustomerForEmails(emails);
    if (!resolved) {
      res.json({ configured: true, verified: false, kycStatus: 'not_started', virtualAccount: null, customerId: null });
      return;
    }

    rememberCustomer(req, resolved.customerId, resolved.email);
    const snapshot = await getCustomerSnapshot(resolved.customerId);
    const verified = snapshot?.status === 'active';

    // Only read the virtual account — provisioning is an explicit POST so a status poll never writes.
    let virtualAccount = null as null | Record<string, unknown>;
    if (verified) {
      const wallet = req.auth?.smartWallet || req.auth?.walletAddress || '';
      if (wallet) {
        const va = await ensureVirtualAccount({ customerId: resolved.customerId, walletAddress: wallet });
        if ('account' in va) {
          virtualAccount = {
            accountNumber: va.account.accountNumber,
            routingNumber: va.account.routingNumber,
            bankName: va.account.bankName,
            beneficiary: va.account.beneficiary,
            paymentRails: va.account.paymentRails,
          };
        }
      }
    }

    res.json({
      configured: true,
      customerId: resolved.customerId,
      matchedEmail: resolved.email,
      verified,
      kycStatus: snapshot?.status ?? 'not_started',
      tosAccepted: snapshot?.tosAccepted ?? false,
      baseEndorsement: snapshot?.baseEndorsement ?? 'incomplete',
      payinFiat: snapshot?.payinFiat ?? 'pending',
      payoutFiat: snapshot?.payoutFiat ?? 'pending',
      rejectionReason: snapshot?.rejectionReason ?? null,
      virtualAccount,
    });
  } catch (error) {
    console.error('[bridge/status]', error);
    res.status(500).json({ error: 'Could not read verification status' });
  }
});

/**
 * POST /api/bridge/kyc-link → the hosted Bridge verification URL for this member (ToS first, then
 * KYC). Reuses an existing Bridge customer when any of their emails already maps to one.
 * Body: { fullName, customerType? }
 */
router.post('/kyc-link', async (req: Request, res: Response) => {
  try {
    if (!(process.env.BRIDGE_API_KEY || '').trim()) {
      res.status(501).json({ error: 'Verification is not available yet.', notConfigured: true });
      return;
    }
    const emails = sessionEmails(req);
    if (emails.length === 0) {
      res.status(400).json({ error: 'Add an email to your account before verifying.' });
      return;
    }
    const { fullName, customerType } = req.body as { fullName?: string; customerType?: BridgeCustomerType };
    const normalizedName = String(fullName ?? '').trim();
    if (normalizedName.length < 2) {
      res.status(400).json({ error: 'Your full legal name is required.' });
      return;
    }

    const result = await startKyc({
      emails,
      email: emails[0],
      fullName: normalizedName,
      redirectUri: process.env.BRIDGE_ONBOARDING_REDIRECT_URI?.trim(),
      customerType: customerType === 'business' ? 'business' : 'individual',
    });
    if ('error' in result) {
      console.error('[bridge/kyc-link] upstream failure', { status: result.status, error: result.error });
      res.status(upstreamStatus(result.status)).json({ error: result.error });
      return;
    }
    if (!result.url) {
      res.status(502).json({ error: 'Bridge returned no verification link.' });
      return;
    }
    rememberCustomer(req, result.customerId ?? undefined, emails[0]);
    res.json(result);
  } catch (error) {
    console.error('[bridge/kyc-link]', error);
    res.status(500).json({ error: 'Could not start verification' });
  }
});

/**
 * POST /api/bridge/virtual-account → open (or fetch) this member's USD account, producing their
 * account + routing numbers. Requires an approved Bridge customer; USD pushed here lands as USDC.
 */
router.post('/virtual-account', async (req: Request, res: Response) => {
  try {
    if (!(process.env.BRIDGE_API_KEY || '').trim()) {
      res.status(501).json({ error: 'Bank accounts are not available yet.', notConfigured: true });
      return;
    }
    const emails = sessionEmails(req);
    const resolved = emails.length ? await resolveCustomerForEmails(emails) : null;
    if (!resolved) {
      res.status(409).json({ error: 'Verify your identity to open a USD account.', reason: 'no_customer' });
      return;
    }
    const wallet = req.auth?.smartWallet || req.auth?.walletAddress || '';
    if (!wallet || !isAddress(wallet)) {
      res.status(400).json({ error: 'No wallet on this account to receive deposits.' });
      return;
    }

    rememberCustomer(req, resolved.customerId, resolved.email);
    const result = await ensureVirtualAccount({ customerId: resolved.customerId, walletAddress: wallet });
    if ('error' in result) {
      res.status(409).json({ error: result.error, reason: result.reason });
      return;
    }
    res.json({ available: true, ...result.account, accountLast4: result.account.accountNumber?.slice(-4) ?? null });
  } catch (error) {
    console.error('[bridge/virtual-account]', error);
    res.status(500).json({ error: 'Could not open your USD account' });
  }
});

export default router;
