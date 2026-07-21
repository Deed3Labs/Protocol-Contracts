import type { NextFunction, Request, Response } from 'express';
import { PrivyClient } from '@privy-io/server-auth';

/*
 * Privy JWT auth (replaces the old Reown api.web3modal.org session fetch). The frontend sends the
 * Privy access token (Authorization: Bearer) + its active wallet in X-Wallet-Address. We verify the
 * token (local JWT check), resolve the user's linked wallets via getUser (cached to avoid rate limits),
 * and trust X-Wallet-Address only if it belongs to the verified user. See [[clearpath-privy-migration]].
 */

type AuthenticatedWallet = {
  walletAddress: string;
  chainId?: string | number;
  profileUuid?: string;
  email?: string;
  /** EVERY verified email on the account (email login + google/apple/etc. OAuth), lowercased. */
  emails?: string[];
  smartWallet?: string; // the Privy smart wallet — the CANONICAL primary (where funds live)
  addresses?: string[]; // ALL verified addresses for this user (primary + smart + linked), normalized
  phone?: string; // the Privy account phone (login identity), if any
  token: string;
};

const PRIVY_APP_ID = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID || '';
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || '';
const AUTH_CACHE_TTL_MS = parseInt(process.env.AUTH_CACHE_TTL_MS || '300000', 10); // 5m

let privyClient: PrivyClient | null = null;
function getPrivy(): PrivyClient | null {
  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) return null;
  if (!privyClient) privyClient = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);
  return privyClient;
}

// userId(DID) -> resolved wallets. Cached so we don't call getUser on every request (rate-limited).
type UserWallets = { addresses: Set<string>; smartWallet?: string; email?: string; emails: Set<string>; phone?: string; expiresAt: number };
const userCache = new Map<string, UserWallets>();

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedWallet;
    }
  }
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function readHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() || '';
  return typeof value === 'string' ? value.trim() : '';
}

function sendUnauthorized(res: Response, message: string, code: string) {
  const safeMessage = message.replace(/"/g, '');
  res.setHeader(
    'WWW-Authenticate',
    `Bearer realm="privy", error="invalid_token", error_description="${safeMessage}"`,
  );
  return res.status(401).json({ error: 'Unauthorized', code, message });
}

type CollectedWallets = {
  addresses: Set<string>;
  smartWallet?: string;
  email?: string;
  emails: Set<string>;
  phone?: string;
  hasEmbeddedEoa: boolean;
  hasExternalWallet: boolean;
};

const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function collectWallets(user: { linkedAccounts?: unknown[] }): CollectedWallets {
  const addresses = new Set<string>();
  const emails = new Set<string>();
  let smartWallet: string | undefined;
  let email: string | undefined;
  let phone: string | undefined;
  let hasEmbeddedEoa = false;
  let hasExternalWallet = false;

  const addEmail = (value: unknown) => {
    if (typeof value !== 'string') return;
    const normalized = value.trim().toLowerCase();
    if (EMAILISH.test(normalized)) emails.add(normalized);
  };

  for (const account of user.linkedAccounts ?? []) {
    const acct = account as { type?: string; address?: string; number?: string; chainType?: string; walletClientType?: string; email?: string };
    const isEvmWallet =
      (acct.type === 'wallet' || acct.type === 'smart_wallet') &&
      typeof acct.address === 'string' &&
      (acct.chainType ? acct.chainType === 'ethereum' : true);
    if (isEvmWallet) {
      const addr = normalizeAddress(acct.address as string);
      addresses.add(addr);
      if (acct.type === 'smart_wallet') smartWallet = addr;
      if (acct.type === 'wallet') {
        if (acct.walletClientType === 'privy') hasEmbeddedEoa = true;
        else hasExternalWallet = true;
      }
    }
    if (acct.type === 'email' && typeof acct.address === 'string') {
      email = acct.address;
      addEmail(acct.address);
    }
    // Social logins (google_oauth, apple_oauth, github_oauth, …) carry their own verified email —
    // any of them may be the address the user already onboarded to Bridge with.
    if (typeof acct.type === 'string' && acct.type.endsWith('_oauth')) addEmail(acct.email);
    if (acct.type === 'phone' && typeof acct.number === 'string') phone = acct.number;
  }

  return { addresses, smartWallet, email, emails, phone, hasEmbeddedEoa, hasExternalWallet };
}

async function loadUserWallets(privy: PrivyClient, userId: string): Promise<UserWallets> {
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  let user = await privy.getUser(userId);
  let c = collectWallets(user);

  // GUARANTEE a smart wallet for embedded (email/social) users. The client-side mint can silently
  // fail/skip, leaving them with no wallet at all — so create the embedded EOA + smart wallet
  // server-side via the Privy API. External (MetaMask) users are left alone (they bring their own).
  if (!c.hasExternalWallet && !c.smartWallet) {
    try {
      user = await privy.createWallets({
        userId,
        createEthereumWallet: !c.hasEmbeddedEoa,
        createEthereumSmartWallet: true,
      });
      c = collectWallets(user);
    } catch (error) {
      console.warn('[privy] createWallets failed for', userId, (error as Error)?.message);
    }
  }

  const entry: UserWallets = {
    addresses: c.addresses,
    smartWallet: c.smartWallet,
    email: c.email,
    emails: c.emails,
    phone: c.phone,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  };
  userCache.set(userId, entry);
  return entry;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) {
    return sendUnauthorized(res, 'Missing bearer token', 'AUTH_TOKEN_MISSING');
  }

  const privy = getPrivy();
  if (!privy) {
    return res.status(500).json({
      error: 'Authentication misconfigured',
      message: 'PRIVY_APP_ID and PRIVY_APP_SECRET are required',
    });
  }

  try {
    const claims = await privy.verifyAuthToken(token);
    const userId = claims.userId;

    const { addresses, smartWallet, email, emails, phone } = await loadUserWallets(privy, userId);

    // Trust the frontend's active address only if it belongs to the verified user; else fall back to
    // the smart wallet (email/social funds) or the first linked wallet.
    const claimed = normalizeAddress(readHeaderValue(req.headers['x-wallet-address']));
    const walletAddress =
      claimed && addresses.has(claimed) ? claimed : (smartWallet ?? [...addresses][0] ?? '');

    if (!walletAddress) {
      return sendUnauthorized(res, 'No wallet linked to this account', 'AUTH_NO_WALLET');
    }

    req.auth = { walletAddress, profileUuid: userId, email, emails: [...emails], phone, smartWallet, addresses: [...addresses], token };
    return next();
  } catch (error) {
    console.error('Authentication error:', error);
    return sendUnauthorized(res, 'Invalid or expired authentication token', 'AUTH_TOKEN_INVALID');
  }
}

export function requireWalletMatch(
  req: Request,
  res: Response,
  walletAddress: unknown,
  fieldName: string = 'walletAddress',
): walletAddress is string {
  if (typeof walletAddress !== 'string' || walletAddress.trim().length === 0) {
    res.status(400).json({ error: `Invalid ${fieldName}`, message: `${fieldName} must be a non-empty string` });
    return false;
  }

  // Compatibility mode for routes that don't enforce requireAuth middleware.
  if (!req.auth?.walletAddress) {
    return true;
  }

  if (normalizeAddress(walletAddress) !== req.auth.walletAddress) {
    res.status(403).json({ error: 'Forbidden', message: `${fieldName} does not match authenticated wallet` });
    return false;
  }

  return true;
}

/**
 * Like requireWalletMatch, but accepts ANY of the user's VERIFIED addresses (primary smart wallet OR a
 * linked external wallet from Privy linkedAccounts) — not only the primary. Use for actions that operate
 * on a specific wallet the user owns (e.g. moving USDC FROM a linked wallet). Still strictly scoped to
 * the authenticated user's own addresses, so a relayer can never be steered at a stranger's wallet.
 */
export function requireVerifiedWallet(
  req: Request,
  res: Response,
  walletAddress: unknown,
  fieldName: string = 'walletAddress',
): walletAddress is string {
  if (typeof walletAddress !== 'string' || walletAddress.trim().length === 0) {
    res.status(400).json({ error: `Invalid ${fieldName}`, message: `${fieldName} must be a non-empty string` });
    return false;
  }

  // Compatibility mode for routes that don't enforce requireAuth middleware.
  if (!req.auth?.walletAddress) {
    return true;
  }

  const addr = normalizeAddress(walletAddress);
  const verified = new Set<string>([
    req.auth.walletAddress,
    ...(req.auth.smartWallet ? [normalizeAddress(req.auth.smartWallet)] : []),
    ...((req.auth.addresses ?? []).map((a) => normalizeAddress(a))),
  ]);
  if (!verified.has(addr)) {
    res.status(403).json({ error: 'Forbidden', message: `${fieldName} is not a verified wallet on this account` });
    return false;
  }

  return true;
}

export function requireWalletArrayMatch(
  req: Request,
  res: Response,
  walletAddresses: unknown[],
  fieldName: string,
): walletAddresses is string[] {
  for (const walletAddress of walletAddresses) {
    if (!requireWalletMatch(req, res, walletAddress, fieldName)) {
      return false;
    }
  }
  return true;
}
