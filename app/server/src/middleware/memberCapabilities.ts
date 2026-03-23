import type { NextFunction, Request, Response } from 'express';
import { memberStore, type MemberCapabilities } from '../services/memberStore.js';

const TRANSIENT_POSTGRES_CODES = new Set([
  '53300', // too_many_connections
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08006', // connection_failure
]);

function isTransientPostgresError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return Boolean(code && TRANSIENT_POSTGRES_CODES.has(code));
}

function resolveRawAuthSubject(req: Request): string {
  const profileUuid = req.auth?.profileUuid?.trim();
  if (profileUuid) return profileUuid;

  const walletAddress = req.auth?.walletAddress?.trim().toLowerCase();
  if (walletAddress) return walletAddress;

  throw new Error('Authenticated subject missing');
}

async function resolveMemberAuthSubject(req: Request): Promise<string> {
  const rawAuthSubject = resolveRawAuthSubject(req);
  const canonicalAuthSubject = await memberStore.resolveCanonicalAuthSubject({
    authSubject: rawAuthSubject,
    profileUuid: req.auth?.profileUuid ?? null,
    walletAddress: req.auth?.walletAddress ?? null,
    email: req.auth?.email ?? null,
  });
  return canonicalAuthSubject ?? rawAuthSubject;
}

export type MemberCapabilityKey = keyof MemberCapabilities;

export function requireMemberCapability(capability: MemberCapabilityKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!memberStore.isConfigured()) {
      return res.status(503).json({
        error: 'Member store not configured',
        message: 'Set DATABASE_URL to enable member capability checks',
      });
    }

    try {
      await memberStore.ensureReady();
      const authSubject = await resolveMemberAuthSubject(req);
      const capabilities = await memberStore.getCapabilitiesByAuthSubject(authSubject);
      if (!capabilities) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Complete account onboarding before using this feature',
        });
      }

      if (!capabilities[capability]) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `This feature requires the ${capability} member capability`,
        });
      }

      return next();
    } catch (error) {
      console.error('Member capability check failed:', error);
      if (isTransientPostgresError(error)) {
        res.setHeader('Retry-After', '2');
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Member capability checks are temporarily unavailable. Please retry shortly.',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to check member capabilities',
      });
    }
  };
}
