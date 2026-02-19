import type { NextFunction, Request, Response } from 'express';

type AuthenticatedWallet = {
  walletAddress: string;
  chainId?: string | number;
  profileUuid?: string;
  email?: string;
  token: string;
};

type ReownSessionAccount = {
  address: string;
  chainId?: string | number;
  profileUuid?: string;
  email?: string;
  exp?: number;
};

type CachedAuth = {
  session: AuthenticatedWallet;
  expiresAt: number;
};

const REOWN_AUTH_BASE_URL = process.env.REOWN_AUTH_BASE_URL || 'https://api.web3modal.org';
const REOWN_PROJECT_ID =
  process.env.REOWN_PROJECT_ID ||
  process.env.APPKIT_PROJECT_ID ||
  process.env.VITE_APPKIT_PROJECT_ID ||
  '';
const REOWN_SDK_TYPE = process.env.REOWN_SDK_TYPE || 'appkit';
const REOWN_SDK_VERSION = process.env.REOWN_SDK_VERSION || 'html-wagmi-4.2.2';
const AUTH_CACHE_TTL_MS = parseInt(process.env.AUTH_CACHE_TTL_MS || '300000', 10); // 5m

const authCache = new Map<string, CachedAuth>();

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

function decodeJwtExpMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadPart = parts[1];
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { exp?: number };
    if (typeof payload.exp !== 'number') return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

async function fetchReownSession(token: string): Promise<AuthenticatedWallet | null> {
  if (!REOWN_PROJECT_ID) {
    return null;
  }

  const url = new URL(`${REOWN_AUTH_BASE_URL}/auth/v1/me`);
  url.searchParams.set('projectId', REOWN_PROJECT_ID);
  url.searchParams.set('st', REOWN_SDK_TYPE);
  url.searchParams.set('sv', REOWN_SDK_VERSION);
  url.searchParams.set('includeAppKitAccount', 'true');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const account = (await response.json()) as ReownSessionAccount;
  if (!account?.address || typeof account.address !== 'string') {
    return null;
  }

  return {
    walletAddress: normalizeAddress(account.address),
    chainId: account.chainId,
    profileUuid: account.profileUuid,
    email: account.email,
    token,
  };
}

async function validateToken(token: string): Promise<AuthenticatedWallet | null> {
  const now = Date.now();
  const cached = authCache.get(token);
  if (cached && cached.expiresAt > now) {
    return cached.session;
  }

  const session = await fetchReownSession(token);
  if (!session) return null;

  const jwtExpMs = decodeJwtExpMs(token);
  const expiresAt = jwtExpMs ? Math.min(jwtExpMs, now + AUTH_CACHE_TTL_MS) : now + AUTH_CACHE_TTL_MS;
  authCache.set(token, { session, expiresAt });

  return session;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!REOWN_PROJECT_ID) {
    return res.status(500).json({
      error: 'Authentication misconfigured',
      message: 'REOWN_PROJECT_ID (or APPKIT_PROJECT_ID) is required on the server',
    });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing bearer token',
    });
  }

  try {
    const session = await validateToken(token);
    if (!session) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired authentication token',
      });
    }

    req.auth = session;
    return next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication failed',
    });
  }
}

export function requireWalletMatch(
  req: Request,
  res: Response,
  walletAddress: unknown,
  fieldName: string = 'walletAddress'
): walletAddress is string {
  if (!req.auth?.walletAddress) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authenticated wallet context missing',
    });
    return false;
  }

  if (typeof walletAddress !== 'string' || walletAddress.trim().length === 0) {
    res.status(400).json({
      error: `Invalid ${fieldName}`,
      message: `${fieldName} must be a non-empty string`,
    });
    return false;
  }

  if (normalizeAddress(walletAddress) !== req.auth.walletAddress) {
    res.status(403).json({
      error: 'Forbidden',
      message: `${fieldName} does not match authenticated wallet`,
    });
    return false;
  }

  return true;
}

export function requireWalletArrayMatch(
  req: Request,
  res: Response,
  walletAddresses: unknown[],
  fieldName: string
): walletAddresses is string[] {
  for (const walletAddress of walletAddresses) {
    if (!requireWalletMatch(req, res, walletAddress, fieldName)) {
      return false;
    }
  }

  return true;
}
