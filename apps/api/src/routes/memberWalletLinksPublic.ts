import { Router, type Request, type Response } from 'express';
import { memberStore } from '../services/memberStore.js';

const router = Router();

function isObjectBody(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOptionalString(
  value: unknown,
  fieldName: string,
  maxLength: number,
  res: Response,
  options: { allowNull?: boolean } = {}
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return options.allowNull ? null : undefined;
  if (typeof value !== 'string') {
    res.status(400).json({
      error: `Invalid ${fieldName}`,
      message: `${fieldName} must be a string`,
    });
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) return options.allowNull ? null : '';
  return trimmed.slice(0, maxLength);
}

async function ensureMemberStoreReady(res: Response): Promise<boolean> {
  if (!memberStore.isConfigured()) {
    res.status(503).json({
      error: 'Member store not configured',
      message: 'Set DATABASE_URL to enable member persistence',
    });
    return false;
  }

  try {
    await memberStore.ensureReady();
    return true;
  } catch (error) {
    res.status(503).json({
      error: 'Member store unavailable',
      message: error instanceof Error ? error.message : 'Could not initialize member store',
    });
    return false;
  }
}

function handleWalletLinkPublicError(res: Response, error: unknown): void {
  if (error instanceof Error) {
    if (
      error.message.includes('required')
      || error.message.includes('expired')
      || error.message.includes('already been used')
      || error.message.includes('already linked')
      || error.message.includes('Invalid wallet link signature')
      || error.message.includes('Wallet link handoff')
    ) {
      res.status(409).json({
        error: 'Request rejected',
        message: error.message,
      });
      return;
    }

    if (error.message.includes('not found')) {
      res.status(404).json({
        error: 'Not found',
        message: error.message,
      });
      return;
    }
  }

  console.error('Wallet-link public route error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}

router.post('/wallet-link-handoffs/prepare', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const token = parseOptionalString(req.body.token, 'token', 255, res);
  if (token === undefined) return;
  const walletAddress = parseOptionalString(req.body.walletAddress, 'walletAddress', 255, res);
  if (walletAddress === undefined) return;
  if (!token || !walletAddress) {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'token and walletAddress are required',
    });
  }

  try {
    const prepared = await memberStore.prepareWalletLinkHandoff(token, walletAddress);
    res.json(prepared);
  } catch (error) {
    handleWalletLinkPublicError(res, error);
  }
});

router.post('/wallet-link-handoffs/complete', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const token = parseOptionalString(req.body.token, 'token', 255, res);
  if (token === undefined) return;
  const walletAddress = parseOptionalString(req.body.walletAddress, 'walletAddress', 255, res);
  if (walletAddress === undefined) return;
  const signature = parseOptionalString(req.body.signature, 'signature', 4096, res);
  if (signature === undefined) return;
  const kind = parseOptionalString(req.body.kind, 'kind', 32, res, { allowNull: true });
  if (kind === undefined && req.body.kind !== undefined) return;

  if (!token || !walletAddress || !signature) {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'token, walletAddress, and signature are required',
    });
  }

  try {
    const wallets = await memberStore.completeWalletLinkHandoff(
      token,
      walletAddress,
      signature,
      (kind ?? undefined) as 'PRIMARY' | 'HARDWARE' | 'SMART' | 'EMBEDDED' | undefined
    );
    res.json({ wallets });
  } catch (error) {
    handleWalletLinkPublicError(res, error);
  }
});

export default router;
