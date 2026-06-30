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
type UserWallets = { addresses: Set<string>; smartWallet?: string; email?: string; expiresAt: number };
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
  hasEmbeddedEoa: boolean;
  hasExternalWallet: boolean;
};

function collectWallets(user: { linkedAccounts?: unknown[] }): CollectedWallets {
  const addresses = new Set<string>();
  let smartWallet: string | undefined;
  let email: string | undefined;
  let hasEmbeddedEoa = false;
  let hasExternalWallet = false;

  for (const account of user.linkedAccounts ?? []) {
    const acct = account as { type?: string; address?: string; chainType?: string; walletClientType?: string };
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
    if (acct.type === 'email' && typeof acct.address === 'string') email = acct.address;
  }

  return { addresses, smartWallet, email, hasEmbeddedEoa, hasExternalWallet };
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

    const { addresses, smartWallet, email } = await loadUserWallets(privy, userId);

    // Trust the frontend's active address only if it belongs to the verified user; else fall back to
    // the smart wallet (email/social funds) or the first linked wallet.
    const claimed = normalizeAddress(readHeaderValue(req.headers['x-wallet-address']));
    const walletAddress =
      claimed && addresses.has(claimed) ? claimed : (smartWallet ?? [...addresses][0] ?? '');

    if (!walletAddress) {
      return sendUnauthorized(res, 'No wallet linked to this account', 'AUTH_NO_WALLET');
    }

    req.auth = { walletAddress, profileUuid: userId, email, token };
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
