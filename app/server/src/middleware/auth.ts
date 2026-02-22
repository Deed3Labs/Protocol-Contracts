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

type JwtPayload = {
  exp?: number;
  aud?: string | string[];
  projectId?: string;
};

const REOWN_AUTH_BASE_URL = process.env.REOWN_AUTH_BASE_URL || 'https://api.web3modal.org';
const REOWN_PROJECT_ID_ENV =
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

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadPart = parts[1];
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
}

function decodeJwtExpMs(token: string): number | null {
  const payload = decodeJwtPayload(token);
  if (typeof payload?.exp !== 'number') return null;
  return payload.exp * 1000;
}

function readHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() || '';
  }
  return typeof value === 'string' ? value.trim() : '';
}

function resolveProjectId(req: Request, token: string): string {
  const fromHeader =
    readHeaderValue(req.headers['x-reown-project-id']) ||
    readHeaderValue(req.headers['x-appkit-project-id']);

  if (REOWN_PROJECT_ID_ENV) {
    return REOWN_PROJECT_ID_ENV;
  }

  if (fromHeader) {
    return fromHeader;
  }

  const payload = decodeJwtPayload(token);
  if (typeof payload?.aud === 'string' && payload.aud.trim()) {
    return payload.aud.trim();
  }

  if (Array.isArray(payload?.aud)) {
    const aud = payload.aud.find((value) => typeof value === 'string' && value.trim().length > 0);
    if (aud) {
      return aud.trim();
    }
  }

  if (typeof payload?.projectId === 'string' && payload.projectId.trim()) {
    return payload.projectId.trim();
  }

  return '';
}

async function fetchReownSession(token: string, projectId: string): Promise<AuthenticatedWallet | null> {
  if (!projectId) {
    return null;
  }

  const url = new URL(`${REOWN_AUTH_BASE_URL}/auth/v1/me`);
  url.searchParams.set('projectId', projectId);
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

async function validateToken(token: string, projectId: string): Promise<AuthenticatedWallet | null> {
  const cacheKey = `${projectId}:${token}`;
  const now = Date.now();
  const cached = authCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.session;
  }

  const session = await fetchReownSession(token, projectId);
  if (!session) return null;

  const jwtExpMs = decodeJwtExpMs(token);
  const expiresAt = jwtExpMs ? Math.min(jwtExpMs, now + AUTH_CACHE_TTL_MS) : now + AUTH_CACHE_TTL_MS;
  authCache.set(cacheKey, { session, expiresAt });

  return session;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing bearer token',
    });
  }

  const projectId = resolveProjectId(req, token);
  if (!projectId) {
    return res.status(500).json({
      error: 'Authentication misconfigured',
      message: 'REOWN project ID is required (set REOWN_PROJECT_ID or send X-Reown-Project-Id)',
    });
  }

  try {
    const session = await validateToken(token, projectId);
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
  if (typeof walletAddress !== 'string' || walletAddress.trim().length === 0) {
    res.status(400).json({
      error: `Invalid ${fieldName}`,
      message: `${fieldName} must be a non-empty string`,
    });
    return false;
  }

  // Compatibility mode for routes that don't enforce requireAuth middleware.
  // Sensitive routes still mount requireAuth explicitly before handlers.
  if (!req.auth?.walletAddress) {
    return true;
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
