import { Router, type Request, type Response, type NextFunction } from 'express';
import { isAddress } from 'ethers';
import { requireAuth, requireWalletMatch } from '../middleware/auth.js';
import {
  sendTransferStore,
  type RecipientType,
  type SendClaimSessionWithTransfer,
  type SendFundingSource,
} from '../services/sendTransferStore.js';
import { sendCryptoService } from '../services/sendCryptoService.js';
import { sendClaimService } from '../services/sendClaimService.js';
import { mapBridgeStateToDispatchStatus } from '../services/sendBridgePayoutService.js';
import { sendBridgeWebhookVerifier } from '../services/sendBridgeWebhookVerifier.js';
import { sendPayoutService } from '../services/sendPayoutService.js';
import { sendStripePayoutService } from '../services/sendStripePayoutService.js';
import { sendNotificationService } from '../services/sendNotificationService.js';

const sendRouter = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const E164_REGEX = /^\+[1-9]\d{7,14}$/;
type RequestWithRawBody = Request & { rawBody?: Buffer };

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseUsdcMicros(value: unknown): bigint | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return parseUsdcMicros(value.toString());
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    return null;
  }

  const [wholeRaw, fracRaw = ''] = trimmed.split('.');
  const whole = BigInt(wholeRaw);
  const frac = BigInt(fracRaw.padEnd(6, '0'));
  return whole * 1_000_000n + frac;
}

function formatUsdcMicros(value: string | bigint): string {
  const micros = typeof value === 'bigint' ? value : BigInt(value);
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function parseFundingSource(value: unknown): SendFundingSource | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case 'WALLET_USDC':
    case 'WALLET':
      return 'WALLET_USDC';
    case 'CARD_ONRAMP':
    case 'DEBIT':
    case 'CARD':
      return 'CARD_ONRAMP';
    case 'BANK_ONRAMP':
    case 'BANK':
      return 'BANK_ONRAMP';
    default:
      return null;
  }
}

function normalizeRegion(value: unknown): string {
  if (typeof value !== 'string') {
    return 'US';
  }
  const normalized = value.trim().toUpperCase();
  return normalized || 'US';
}

function enabledRegions(): Set<string> {
  return new Set(
    (process.env.SEND_ENABLED_REGIONS || 'US')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  );
}

function enabledPayoutRegions(method: 'debit' | 'bank' | 'wallet'): Set<string> {
  const envName =
    method === 'debit'
      ? 'SEND_DEBIT_ENABLED_REGIONS'
      : method === 'bank'
      ? 'SEND_BANK_ENABLED_REGIONS'
      : 'SEND_WALLET_ENABLED_REGIONS';

  const fallback = method === 'wallet' ? 'US' : 'US';

  return new Set(
    (process.env[envName] || fallback)
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  );
}

function parseRecipient(input: string): { recipientType: RecipientType; normalizedContact: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      return null;
    }
    return { recipientType: 'email', normalizedContact: email };
  }

  const withoutFormatting = trimmed.replace(/[\s()-]/g, '');
  const digitsOnly = withoutFormatting.replace(/\D/g, '');

  let normalizedPhone = withoutFormatting;
  if (!normalizedPhone.startsWith('+')) {
    if (digitsOnly.length === 10) {
      normalizedPhone = `+1${digitsOnly}`;
    } else {
      normalizedPhone = `+${digitsOnly}`;
    }
  } else {
    normalizedPhone = `+${digitsOnly}`;
  }

  if (!E164_REGEX.test(normalizedPhone)) {
    return null;
  }

  return { recipientType: 'phone', normalizedContact: normalizedPhone };
}

function claimAppBaseUrl(): string {
  return (
    process.env.SEND_CLAIM_APP_URL ||
    process.env.APP_BASE_URL ||
    process.env.VITE_APP_URL ||
    'http://localhost:5173'
  ).replace(/\/+$/, '');
}

function otpBypassEnabled(): boolean {
  return (process.env.SEND_OTP_BYPASS_ENABLED || 'false').trim().toLowerCase() === 'true';
}

function otpBypassCode(): string {
  const raw = (process.env.SEND_OTP_BYPASS_CODE || '000000').trim();
  return /^\d{6}$/.test(raw) ? raw : '000000';
}

function payoutMethodsForRegion(region: string): Array<'DEBIT' | 'BANK' | 'WALLET'> {
  const normalized = region.toUpperCase();
  const methods: Array<'DEBIT' | 'BANK' | 'WALLET'> = [];

  if (enabledPayoutRegions('debit').has(normalized)) {
    methods.push('DEBIT');
  }
  if (enabledPayoutRegions('bank').has(normalized)) {
    methods.push('BANK');
  }
  if (enabledPayoutRegions('wallet').has(normalized)) {
    methods.push('WALLET');
  }

  return methods;
}

function publicTransferView(transfer: {
  id: number;
  transferId: string;
  principalUsdc: string;
  sponsorFeeUsdc: string;
  totalLockedUsdc: string;
  recipientHintHash: string;
  chainId: number;
  expiresAt: Date;
  status: string;
  region: string;
}) {
  return {
    id: transfer.id,
    transferId: transfer.transferId,
    principalUsdc: formatUsdcMicros(transfer.principalUsdc),
    sponsorFeeUsdc: formatUsdcMicros(transfer.sponsorFeeUsdc),
    totalLockedUsdc: formatUsdcMicros(transfer.totalLockedUsdc),
    recipientHintHash: transfer.recipientHintHash,
    chainId: transfer.chainId,
    expiresAt: transfer.expiresAt.toISOString(),
    status: transfer.status,
    region: transfer.region,
    payoutMethods: payoutMethodsForRegion(transfer.region),
  };
}

async function markTransferClaimedFromMethod(
  transferRowId: number,
  method: 'DEBIT' | 'BANK' | 'WALLET'
): Promise<void> {
  if (method === 'DEBIT') {
    await sendTransferStore.markTransferClaimed(transferRowId, 'CLAIMED_DEBIT');
    return;
  }

  if (method === 'BANK') {
    await sendTransferStore.markTransferClaimed(transferRowId, 'CLAIMED_BANK');
    return;
  }

  await sendTransferStore.markTransferClaimed(transferRowId, 'CLAIMED_WALLET');
}

async function ensureSendStoreReady(res: Response): Promise<boolean> {
  if (!sendTransferStore.isConfigured()) {
    res.status(503).json({
      error: 'Send transfer store not configured',
      message: 'Set DATABASE_URL and SEND_CONTACT_ENCRYPTION_KEY',
    });
    return false;
  }

  try {
    await sendTransferStore.ensureReady();
    return true;
  } catch (error) {
    res.status(503).json({
      error: 'Send transfer store unavailable',
      message: error instanceof Error ? error.message : 'Could not initialize send transfer store',
    });
    return false;
  }
}

type LocalRateLimiterOptions = {
  windowMs: number;
  maxRequests: number;
  keyFn?: (req: Request) => string;
};

function createLocalRateLimiter(options: LocalRateLimiterOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const baseKey = options.keyFn ? options.keyFn(req) : req.ip || 'unknown';
    const key = `${req.path}:${baseKey}`;

    const bucket = hits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (bucket.count >= options.maxRequests) {
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded for this endpoint',
        retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
      });
    }

    bucket.count += 1;
    return next();
  };
}

const claimStartRateLimiter = createLocalRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 10,
  keyFn: (req) => `${req.ip || 'unknown'}:${String((req.body as { claimToken?: unknown })?.claimToken || '')}`,
});

const otpVerifyRateLimiter = createLocalRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 20,
  keyFn: (req) => `${req.ip || 'unknown'}:${String((req.body as { claimSessionId?: unknown })?.claimSessionId || '')}`,
});

const otpResendRateLimiter = createLocalRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 12,
  keyFn: (req) => `${req.ip || 'unknown'}:${String((req.body as { claimSessionId?: unknown })?.claimSessionId || '')}`,
});

const payoutRateLimiter = createLocalRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 20,
  keyFn: (req) => `${req.ip || 'unknown'}:${String((req.body as { claimSessionToken?: unknown })?.claimSessionToken || '')}`,
});

const senderRouter = Router();
senderRouter.use(requireAuth);

senderRouter.post('/transfers/prepare', async (req: Request, res: Response) => {
  if (!(await ensureSendStoreReady(res))) return;

  try {
    const senderWallet = req.auth?.walletAddress;
    if (!senderWallet) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing authenticated wallet',
      });
    }

    const body = req.body as {
      recipient?: unknown;
      amount?: unknown;
      fundingSource?: unknown;
      memo?: unknown;
      region?: unknown;
      senderWallet?: unknown;
      chainId?: unknown;
    };

    if (body.senderWallet != null && !requireWalletMatch(req, res, body.senderWallet, 'senderWallet')) {
      return;
    }

    if (typeof body.recipient !== 'string') {
      return res.status(400).json({
        error: 'Invalid recipient',
        message: 'recipient must be a valid email or phone number',
      });
    }

    const parsedRecipient = parseRecipient(body.recipient);
    if (!parsedRecipient) {
      return res.status(400).json({
        error: 'Invalid recipient',
        message: 'recipient must be a valid email or E.164 phone number',
      });
    }

    const principalMicros = parseUsdcMicros(body.amount);
    if (!principalMicros || principalMicros <= 0n) {
      return res.status(400).json({
        error: 'Invalid amount',
        message: 'amount must be a positive USD value with up to 6 decimals',
      });
    }

    const fundingSource = parseFundingSource(body.fundingSource);
    if (!fundingSource) {
      return res.status(400).json({
        error: 'Invalid funding source',
        message: 'fundingSource must be wallet, card, or bank',
      });
    }

    const region = normalizeRegion(body.region);
    if (!enabledRegions().has(region)) {
      return res.status(403).json({
        error: 'Region not enabled',
        message: `Send funds is not enabled in region ${region}`,
      });
    }

    const chainIdValue = typeof body.chainId === 'number' ? body.chainId : parseInt(String(body.chainId || ''), 10);
    const chainId = Number.isFinite(chainIdValue) && chainIdValue > 0 ? chainIdValue : parseIntEnv('SEND_DEFAULT_CHAIN_ID', 8453);

    const allowedChainIds = new Set(
      (process.env.SEND_ALLOWED_CHAIN_IDS || '8453')
        .split(',')
        .map((value) => parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0)
    );
    if (!allowedChainIds.has(chainId)) {
      return res.status(400).json({
        error: 'Unsupported chain',
        message: `chainId ${chainId} is not enabled for send funds`,
      });
    }

    const maxTransferMicros = BigInt(parseIntEnv('SEND_MAX_TRANSFER_USDC_MICROS', 10_000_000_000));
    if (principalMicros > maxTransferMicros) {
      return res.status(400).json({
        error: 'Amount exceeds limit',
        message: `Maximum transfer amount is ${formatUsdcMicros(maxTransferMicros)} USDC`,
      });
    }

    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const dailyTotal = await sendTransferStore.getSenderPrincipalTotalInWindow(senderWallet, dayStart, dayEnd);

    const dailyCapMicros = BigInt(parseIntEnv('SEND_DAILY_CAP_USDC_MICROS', 25_000_000_000));
    if (dailyTotal + principalMicros > dailyCapMicros) {
      return res.status(400).json({
        error: 'Daily limit exceeded',
        message: `Daily cap is ${formatUsdcMicros(dailyCapMicros)} USDC`,
      });
    }

    const sponsorFeeMicros =
      parseUsdcMicros(process.env.SEND_SPONSOR_FEE_USDC || '0.50') ||
      500_000n;

    const totalMicros = principalMicros + sponsorFeeMicros;
    const expiresInDays = parseIntEnv('SEND_TRANSFER_EXPIRY_DAYS', 7);
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

    const recipientContactHash = sendClaimService.hashRecipientContact(parsedRecipient.normalizedContact);
    const recipientHintHash = sendCryptoService.computeRecipientHintHash(recipientContactHash);
    const transferId = sendCryptoService.generateTransferId({
      senderWallet,
      recipientContactHash,
      principalUsdc: principalMicros.toString(),
    });

    const transfer = await sendTransferStore.createTransfer({
      transferId,
      senderWallet,
      recipientType: parsedRecipient.recipientType,
      recipientContact: parsedRecipient.normalizedContact,
      recipientContactHash,
      recipientHintHash,
      principalUsdc: principalMicros.toString(),
      sponsorFeeUsdc: sponsorFeeMicros.toString(),
      totalLockedUsdc: totalMicros.toString(),
      fundingSource,
      status: 'PREPARED',
      region,
      chainId,
      expiresAt,
      memo: typeof body.memo === 'string' ? body.memo.trim().slice(0, 256) : null,
    });

    return res.json({
      transfer: publicTransferView(transfer),
      recipient: {
        type: parsedRecipient.recipientType,
        masked: sendClaimService.maskContact(parsedRecipient.normalizedContact, parsedRecipient.recipientType),
      },
      limits: {
        dailyCapUsdc: formatUsdcMicros(dailyCapMicros),
        dailyUsedUsdc: formatUsdcMicros(dailyTotal + principalMicros),
      },
    });
  } catch (error) {
    console.error('Send prepare error:', error);
    return res.status(500).json({
      error: 'Failed to prepare send transfer',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

senderRouter.post('/transfers/:id/confirm-lock', async (req: Request, res: Response) => {
  if (!(await ensureSendStoreReady(res))) return;

  try {
    const senderWallet = req.auth?.walletAddress;
    if (!senderWallet) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing authenticated wallet',
      });
    }

    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        error: 'Invalid transfer id',
        message: 'Route parameter :id must be a positive integer',
      });
    }

    const body = req.body as {
      escrowTxHash?: unknown;
      transferId?: unknown;
      senderWallet?: unknown;
    };

    if (body.senderWallet != null && !requireWalletMatch(req, res, body.senderWallet, 'senderWallet')) {
      return;
    }

    if (typeof body.escrowTxHash !== 'string' || !sendCryptoService.isValidTxHash(body.escrowTxHash)) {
      return res.status(400).json({
        error: 'Invalid escrow transaction hash',
        message: 'escrowTxHash must be a valid transaction hash',
      });
    }

    if (typeof body.transferId !== 'string' || !sendCryptoService.isValidBytes32(body.transferId)) {
      return res.status(400).json({
        error: 'Invalid transfer id',
        message: 'transferId must be a bytes32 hex string',
      });
    }

    const existingTransfer = await sendTransferStore.getSenderTransferById(id, senderWallet);
    if (!existingTransfer) {
      return res.status(404).json({
        error: 'Transfer not found',
        message: 'No transfer found for this sender and id',
      });
    }

    if (existingTransfer.status !== 'PREPARED') {
      return res.status(409).json({
        error: 'Transfer already finalized',
        message: `Transfer is already in status ${existingTransfer.status}`,
      });
    }

    if (existingTransfer.transferId.toLowerCase() !== body.transferId.toLowerCase()) {
      return res.status(400).json({
        error: 'Transfer mismatch',
        message: 'transferId does not match prepared transfer record',
      });
    }

    const verification = await sendCryptoService.verifyEscrowLockTransaction({
      txHash: body.escrowTxHash,
      expectedSenderWallet: senderWallet,
      chainId: existingTransfer.chainId,
    });

    if (!verification.valid) {
      return res.status(400).json({
        error: 'Escrow lock verification failed',
        message: verification.reason || 'Could not verify lock transaction',
      });
    }

    const claimToken = sendClaimService.generateClaimToken();
    const claimTokenHash = sendClaimService.hashClaimToken(claimToken);
    const claimUrl = `${claimAppBaseUrl()}/claim/${encodeURIComponent(claimToken)}`;

    const updatedTransfer = await sendTransferStore.confirmTransferLockAndSetClaimToken({
      id,
      senderWallet,
      transferId: body.transferId,
      escrowTxHash: body.escrowTxHash,
      claimTokenHash,
    });

    if (!updatedTransfer) {
      return res.status(409).json({
        error: 'Transfer update conflict',
        message: 'Transfer state changed before confirm-lock completed',
      });
    }

    let notificationWarning: string | null = null;
    try {
      const recipientContact = sendTransferStore.decryptRecipientContact(updatedTransfer);
      await sendNotificationService.sendClaimLink({
        transferRowId: updatedTransfer.id,
        recipientType: updatedTransfer.recipientType,
        recipientContact,
        claimUrl,
      });
    } catch (error) {
      notificationWarning = error instanceof Error ? error.message : 'Failed to dispatch claim notification';
      console.error('Claim link notification error:', error);
    }

    return res.json({
      transfer: publicTransferView(updatedTransfer),
      claimUrl,
      ...(notificationWarning ? { notificationWarning } : {}),
    });
  } catch (error) {
    console.error('Send confirm-lock error:', error);
    return res.status(500).json({
      error: 'Failed to confirm transfer lock',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

senderRouter.get('/transfers', async (req: Request, res: Response) => {
  if (!(await ensureSendStoreReady(res))) return;

  try {
    const senderWallet = req.auth?.walletAddress;
    if (!senderWallet) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing authenticated wallet',
      });
    }

    const limitQuery = parseInt(String(req.query.limit || '50'), 10);
    const limit = Number.isFinite(limitQuery) && limitQuery > 0 ? limitQuery : 50;

    const transfers = await sendTransferStore.listSenderTransfers(senderWallet, limit);

    return res.json({
      transfers: transfers.map((transfer) => publicTransferView(transfer)),
    });
  } catch (error) {
    console.error('List send transfers error:', error);
    return res.status(500).json({
      error: 'Failed to list transfers',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

senderRouter.get('/transfers/:id', async (req: Request, res: Response) => {
  if (!(await ensureSendStoreReady(res))) return;

  try {
    const senderWallet = req.auth?.walletAddress;
    if (!senderWallet) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing authenticated wallet',
      });
    }

    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        error: 'Invalid transfer id',
        message: 'Route parameter :id must be a positive integer',
      });
    }

    const transfer = await sendTransferStore.getSenderTransferById(id, senderWallet);
    if (!transfer) {
      return res.status(404).json({
        error: 'Transfer not found',
        message: 'No transfer found for this sender and id',
      });
    }

    return res.json({
      transfer: publicTransferView(transfer),
    });
  } catch (error) {
    console.error('Get send transfer detail error:', error);
    return res.status(500).json({
      error: 'Failed to fetch transfer',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

sendRouter.use(senderRouter);

sendRouter.post('/claim/start', claimStartRateLimiter, async (req: Request, res: Response) => {
  if (!(await ensureSendStoreReady(res))) return;

  try {
    const body = req.body as { claimToken?: unknown };
    if (typeof body.claimToken !== 'string' || body.claimToken.trim().length < 16) {
      return res.status(400).json({
        error: 'Invalid claim token',
        message: 'claimToken is required',
      });
    }

    const claimTokenHash = sendClaimService.hashClaimToken(body.claimToken.trim());
    const transfer = await sendTransferStore.getTransferByClaimTokenHash(claimTokenHash);

    if (!transfer) {
      return res.status(404).json({
        error: 'Claim not found',
        message: 'Claim token is invalid or expired',
      });
    }

    if (!['LOCK_CONFIRMED', 'CLAIM_STARTED'].includes(transfer.status)) {
      return res.status(409).json({
        error: 'Claim unavailable',
        message: `Transfer is in status ${transfer.status}`,
      });
    }

    const now = new Date();
    if (now.getTime() > transfer.expiresAt.getTime()) {
      await sendTransferStore.updateTransferStatus(transfer.id, 'EXPIRED');
      return res.status(410).json({
        error: 'Transfer expired',
        message: 'This claim link has expired',
      });
    }

    const otpConfig = sendClaimService.getOtpConfig();
    const otp = otpBypassEnabled() ? otpBypassCode() : sendClaimService.generateOtp();
    const otpExpiry = sendClaimService.calculateOtpExpiry(now);

    const createdSession = await sendTransferStore.createClaimSession({
      transferRowId: transfer.id,
      sessionTokenHash: null,
      otpHash: sendClaimService.hashOtp(otp, 0),
      otpExpiresAt: otpExpiry,
      maxAttempts: otpConfig.maxAttempts,
      status: 'OTP_SENT',
    });

    // Re-hash OTP with real session id (id is only known after insert)
    const sessionOtpHash = sendClaimService.hashOtp(otp, createdSession.id);
    await sendTransferStore.refreshClaimSessionOtp({
      claimSessionId: createdSession.id,
      otpHash: sessionOtpHash,
      otpExpiresAt: otpExpiry,
      resendCount: createdSession.resendCount,
    });

    let transferForResponse = transfer;
    if (transfer.status === 'LOCK_CONFIRMED') {
      await sendTransferStore.updateTransferStatus(transfer.id, 'CLAIM_STARTED');
      transferForResponse = { ...transfer, status: 'CLAIM_STARTED' };
    }

    const recipientContact = sendTransferStore.decryptRecipientContact(transfer);
    if (otpBypassEnabled()) {
      console.warn(`[SendFunds] OTP bypass enabled for claimSessionId=${createdSession.id}.`);
    } else {
      await sendNotificationService.sendOtp({
        transferRowId: transfer.id,
        recipientType: transfer.recipientType,
        recipientContact,
        otp,
      });
    }

    return res.json({
      claimSessionId: createdSession.id,
      otpExpiresAt: otpExpiry.toISOString(),
      maxAttempts: otpConfig.maxAttempts,
      resendCooldownSeconds: Math.floor(otpConfig.resendCooldownMs / 1000),
      recipientMasked: sendClaimService.maskContact(recipientContact, transfer.recipientType),
      transfer: publicTransferView(transferForResponse),
    });
  } catch (error) {
    console.error('Claim start error:', error);
    return res.status(500).json({
      error: 'Failed to start claim session',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

sendRouter.post('/claim/verify-otp', otpVerifyRateLimiter, async (req: Request, res: Response) => {
  if (!(await ensureSendStoreReady(res))) return;

  try {
    const body = req.body as { claimSessionId?: unknown; otp?: unknown };
    const claimSessionId = parseInt(String(body.claimSessionId || ''), 10);

    if (!Number.isFinite(claimSessionId) || claimSessionId <= 0) {
      return res.status(400).json({
        error: 'Invalid claimSessionId',
        message: 'claimSessionId must be a positive integer',
      });
    }

    if (typeof body.otp !== 'string' || !/^\d{6}$/.test(body.otp.trim())) {
      return res.status(400).json({
        error: 'Invalid OTP',
        message: 'otp must be a 6-digit code',
      });
    }

    const sessionContext = await sendTransferStore.getClaimSessionWithTransferById(claimSessionId);
    if (!sessionContext) {
      return res.status(404).json({
        error: 'Claim session not found',
        message: 'No claim session found for this id',
      });
    }

    const { claimSession, transfer } = sessionContext;

    if (claimSession.status === 'LOCKED') {
      return res.status(423).json({
        error: 'Claim session locked',
        message: 'Maximum OTP attempts reached',
      });
    }

    if (claimSession.status === 'COMPLETED') {
      return res.status(409).json({
        error: 'Claim already completed',
        message: 'This claim session has already been used',
      });
    }

    const now = new Date();
    if (now.getTime() > claimSession.otpExpiresAt.getTime()) {
      await sendTransferStore.markClaimSessionOtpAttempt(claimSession.id, claimSession.otpAttempts, 'EXPIRED');
      return res.status(410).json({
        error: 'OTP expired',
        message: 'Please request a new OTP code',
      });
    }

    const providedOtp = body.otp.trim();
    const bypassMatched = otpBypassEnabled() && providedOtp === otpBypassCode();
    const isValidOtp = bypassMatched || sendClaimService.verifyOtp(providedOtp, claimSession.otpHash, claimSession.id);
    if (!isValidOtp) {
      const nextAttempts = claimSession.otpAttempts + 1;
      const isLocked = nextAttempts >= claimSession.maxAttempts;

      await sendTransferStore.markClaimSessionOtpAttempt(claimSession.id, nextAttempts, isLocked ? 'LOCKED' : 'OTP_SENT');

      return res.status(isLocked ? 423 : 400).json({
        error: isLocked ? 'Claim session locked' : 'Invalid OTP',
        message: isLocked ? 'Maximum OTP attempts reached' : 'OTP did not match',
        remainingAttempts: Math.max(0, claimSession.maxAttempts - nextAttempts),
      });
    }

    const claimSessionToken = sendClaimService.generateSessionToken();
    await sendTransferStore.verifyClaimSession(claimSession.id, sendClaimService.hashSessionToken(claimSessionToken));

    return res.json({
      claimSessionToken,
      transfer: publicTransferView(transfer),
      payoutMethods: payoutMethodsForRegion(transfer.region),
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({
      error: 'Failed to verify OTP',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

sendRouter.post('/claim/resend-otp', otpResendRateLimiter, async (req: Request, res: Response) => {
  if (!(await ensureSendStoreReady(res))) return;

  try {
    const body = req.body as { claimSessionId?: unknown };
    const claimSessionId = parseInt(String(body.claimSessionId || ''), 10);

    if (!Number.isFinite(claimSessionId) || claimSessionId <= 0) {
      return res.status(400).json({
        error: 'Invalid claimSessionId',
        message: 'claimSessionId must be a positive integer',
      });
    }

    const sessionContext = await sendTransferStore.getClaimSessionWithTransferById(claimSessionId);
    if (!sessionContext) {
      return res.status(404).json({
        error: 'Claim session not found',
        message: 'No claim session found for this id',
      });
    }

    const { claimSession, transfer } = sessionContext;

    if (claimSession.status === 'LOCKED') {
      return res.status(423).json({
        error: 'Claim session locked',
        message: 'Maximum OTP attempts reached',
      });
    }

    if (claimSession.status === 'COMPLETED') {
      return res.status(409).json({
        error: 'Claim already completed',
        message: 'This claim session has already been used',
      });
    }

    const otpConfig = sendClaimService.getOtpConfig();
    const now = Date.now();
    const cooldownUntil = claimSession.lastOtpSentAt.getTime() + otpConfig.resendCooldownMs;

    if (now < cooldownUntil) {
      return res.status(429).json({
        error: 'OTP resend cooldown',
        message: 'Please wait before requesting a new OTP',
        retryAfterSeconds: Math.ceil((cooldownUntil - now) / 1000),
      });
    }

    const otp = otpBypassEnabled() ? otpBypassCode() : sendClaimService.generateOtp();
    const otpExpiresAt = sendClaimService.calculateOtpExpiry(new Date(now));

    await sendTransferStore.refreshClaimSessionOtp({
      claimSessionId: claimSession.id,
      otpHash: sendClaimService.hashOtp(otp, claimSession.id),
      otpExpiresAt,
      resendCount: claimSession.resendCount + 1,
    });

    const recipientContact = sendTransferStore.decryptRecipientContact(transfer);
    if (otpBypassEnabled()) {
      console.warn(`[SendFunds] OTP bypass enabled for claimSessionId=${claimSession.id} (resend).`);
    } else {
      await sendNotificationService.sendOtp({
        transferRowId: transfer.id,
        recipientType: transfer.recipientType,
        recipientContact,
        otp,
      });
    }

    return res.json({
      success: true,
      resendCount: claimSession.resendCount + 1,
      otpExpiresAt: otpExpiresAt.toISOString(),
      resendCooldownSeconds: Math.floor(otpConfig.resendCooldownMs / 1000),
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    return res.status(500).json({
      error: 'Failed to resend OTP',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

type VerifiedClaimSessionContextResult =
  | { error: { status: number; body: { error: string; message: string } } }
  | { sessionContext: SendClaimSessionWithTransfer };

async function getVerifiedClaimSessionContext(claimSessionToken: unknown): Promise<VerifiedClaimSessionContextResult> {
  if (typeof claimSessionToken !== 'string' || claimSessionToken.trim().length < 16) {
    return { error: { status: 400, body: { error: 'Invalid claimSessionToken', message: 'claimSessionToken is required' } } };
  }

  const sessionContext = await sendTransferStore.getClaimSessionWithTransferBySessionTokenHash(
    sendClaimService.hashSessionToken(claimSessionToken.trim())
  );

  if (!sessionContext) {
    return { error: { status: 404, body: { error: 'Claim session not found', message: 'Invalid session token' } } };
  }

  if (sessionContext.claimSession.status !== 'OTP_VERIFIED') {
    return {
      error: {
        status: 409,
        body: {
          error: 'Claim session is not verified',
          message: `Session status is ${sessionContext.claimSession.status}`,
        },
      },
    };
  }

  if (!['CLAIM_STARTED', 'LOCK_CONFIRMED'].includes(sessionContext.transfer.status)) {
    return {
      error: {
        status: 409,
        body: {
          error: 'Transfer not claimable',
          message: `Transfer status is ${sessionContext.transfer.status}`,
        },
      },
    };
  }

  if (Date.now() > sessionContext.transfer.expiresAt.getTime()) {
    await sendTransferStore.updateTransferStatus(sessionContext.transfer.id, 'EXPIRED');
    return {
      error: {
        status: 410,
        body: {
          error: 'Transfer expired',
          message: 'This transfer has expired',
        },
      },
    };
  }

  return { sessionContext };
}

sendRouter.post('/claim/payout/debit', payoutRateLimiter, async (req: Request, res: Response) => {
  if (!(await ensureSendStoreReady(res))) return;

  try {
    const body = req.body as {
      claimSessionToken?: unknown;
      bridgeFullName?: unknown;
      bridgeEmail?: unknown;
    };
    const resolved = await getVerifiedClaimSessionContext(body.claimSessionToken);
    if ('error' in resolved) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const { transfer, claimSession } = resolved.sessionContext;

    if (!enabledPayoutRegions('debit').has(transfer.region.toUpperCase())) {
      return res.status(403).json({
        error: 'Debit payout unavailable',
        message: `Debit payout is not enabled in ${transfer.region}`,
        fallbackMethod: 'BANK',
      });
    }

    const payoutAttempt = await sendTransferStore.createPayoutAttempt({
      transferRowId: transfer.id,
      claimSessionId: claimSession.id,
      method: 'DEBIT',
      provider: process.env.SEND_DEBIT_PROVIDER || 'mock-debit',
      status: 'PROCESSING',
    });

    const recipientContact = sendTransferStore.decryptRecipientContact(transfer);
    const payoutResult = await sendPayoutService.executeDebitPayout(transfer, {
      recipientType: transfer.recipientType,
      recipientContact,
      bridgeFullName: typeof body.bridgeFullName === 'string' ? body.bridgeFullName.trim() : undefined,
      bridgeEmail: typeof body.bridgeEmail === 'string' ? body.bridgeEmail.trim().toLowerCase() : undefined,
    });

    if (payoutResult.status === 'ACTION_REQUIRED') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'FAILED',
        provider: payoutResult.provider,
        failureCode: payoutResult.failureCode || 'RECIPIENT_ONBOARDING_REQUIRED',
        failureReason: payoutResult.failureReason || 'Recipient payout onboarding is required',
      });

      return res.status(200).json({
        success: false,
        status: 'ACTION_REQUIRED',
        reason: payoutResult.failureReason || 'Complete payout onboarding before retrying debit payout',
        action: payoutResult.action || 'BRIDGE_ONBOARDING',
        onboardingUrl: payoutResult.onboardingUrl,
        bridgeCustomerId: payoutResult.bridgeCustomerId,
        bridgeExternalAccountId: payoutResult.bridgeExternalAccountId,
      });
    }

    if (payoutResult.status === 'FALLBACK_REQUIRED') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'FALLBACK_REQUIRED',
        provider: payoutResult.provider,
        providerReference: payoutResult.providerReference,
        failureCode: payoutResult.failureCode,
        failureReason: payoutResult.failureReason,
      });

      return res.status(200).json({
        success: false,
        status: 'DEBIT_FALLBACK_REQUIRED',
        fallbackMethod: payoutResult.fallbackMethod || 'BANK',
        reason: payoutResult.failureReason,
      });
    }

    if (payoutResult.status === 'FAILED') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'FAILED',
        provider: payoutResult.provider,
        failureCode: payoutResult.failureCode,
        failureReason: payoutResult.failureReason,
      });

      return res.status(502).json({
        error: 'Debit payout failed',
        message: payoutResult.failureReason || 'Debit payout provider rejected request',
      });
    }

    if (payoutResult.status === 'PROCESSING') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'PROCESSING',
        provider: payoutResult.provider,
        providerReference: payoutResult.providerReference,
        walletTxHash: payoutResult.treasuryTxHash,
      });
      await sendTransferStore.markClaimSessionCompleted(claimSession.id);

      return res.json({
        success: true,
        status: 'PROCESSING',
        method: 'DEBIT',
        provider: payoutResult.provider,
        providerReference: payoutResult.providerReference,
        treasuryTxHash: payoutResult.treasuryTxHash,
      });
    }

    await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
      status: 'SUCCESS',
      provider: payoutResult.provider,
      providerReference: payoutResult.providerReference,
      walletTxHash: payoutResult.treasuryTxHash,
    });
    await sendTransferStore.markTransferClaimed(transfer.id, 'CLAIMED_DEBIT');
    await sendTransferStore.markClaimSessionCompleted(claimSession.id);

    return res.json({
      success: true,
      method: 'DEBIT',
      provider: payoutResult.provider,
      providerReference: payoutResult.providerReference,
      treasuryTxHash: payoutResult.treasuryTxHash,
    });
  } catch (error) {
    console.error('Debit payout error:', error);
    return res.status(500).json({
      error: 'Debit payout failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

sendRouter.post('/claim/payout/bank', payoutRateLimiter, async (req: Request, res: Response) => {
  if (!(await ensureSendStoreReady(res))) return;

  try {
    const body = req.body as {
      claimSessionToken?: unknown;
      bridgeFullName?: unknown;
      bridgeEmail?: unknown;
    };
    const resolved = await getVerifiedClaimSessionContext(body.claimSessionToken);
    if ('error' in resolved) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const { transfer, claimSession } = resolved.sessionContext;

    if (!enabledPayoutRegions('bank').has(transfer.region.toUpperCase())) {
      return res.status(403).json({
        error: 'Bank payout unavailable',
        message: `Bank payout is not enabled in ${transfer.region}`,
      });
    }

    const payoutAttempt = await sendTransferStore.createPayoutAttempt({
      transferRowId: transfer.id,
      claimSessionId: claimSession.id,
      method: 'BANK',
      provider: process.env.SEND_BANK_PROVIDER || 'mock-bank',
      status: 'PROCESSING',
    });

    const recipientContact = sendTransferStore.decryptRecipientContact(transfer);
    const payoutResult = await sendPayoutService.executeBankPayout(transfer, {
      recipientType: transfer.recipientType,
      recipientContact,
      bridgeFullName: typeof body.bridgeFullName === 'string' ? body.bridgeFullName.trim() : undefined,
      bridgeEmail: typeof body.bridgeEmail === 'string' ? body.bridgeEmail.trim().toLowerCase() : undefined,
    });

    if (payoutResult.status === 'ACTION_REQUIRED') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'FAILED',
        provider: payoutResult.provider,
        failureCode: payoutResult.failureCode || 'RECIPIENT_ONBOARDING_REQUIRED',
        failureReason: payoutResult.failureReason || 'Recipient payout onboarding is required',
      });

      return res.status(200).json({
        success: false,
        status: 'ACTION_REQUIRED',
        reason: payoutResult.failureReason || 'Complete payout onboarding before retrying bank payout',
        action: payoutResult.action || 'BRIDGE_ONBOARDING',
        onboardingUrl: payoutResult.onboardingUrl,
        bridgeCustomerId: payoutResult.bridgeCustomerId,
        bridgeExternalAccountId: payoutResult.bridgeExternalAccountId,
      });
    }

    if (payoutResult.status === 'FAILED') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'FAILED',
        provider: payoutResult.provider,
        providerReference: payoutResult.providerReference,
        failureCode: payoutResult.failureCode,
        failureReason: payoutResult.failureReason,
      });

      return res.status(502).json({
        error: 'Bank payout failed',
        message: payoutResult.failureReason || 'Bank payout failed',
      });
    }

    if (payoutResult.status === 'PROCESSING') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'PROCESSING',
        provider: payoutResult.provider,
        providerReference: payoutResult.providerReference,
        walletTxHash: payoutResult.treasuryTxHash,
      });
      await sendTransferStore.markClaimSessionCompleted(claimSession.id);

      return res.json({
        success: true,
        status: 'PROCESSING',
        method: 'BANK',
        provider: payoutResult.provider,
        providerReference: payoutResult.providerReference,
        treasuryTxHash: payoutResult.treasuryTxHash,
        eta: payoutResult.eta,
      });
    }

    await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
      status: 'SUCCESS',
      provider: payoutResult.provider,
      providerReference: payoutResult.providerReference,
      walletTxHash: payoutResult.treasuryTxHash,
    });
    await sendTransferStore.markTransferClaimed(transfer.id, 'CLAIMED_BANK');
    await sendTransferStore.markClaimSessionCompleted(claimSession.id);

    return res.json({
      success: true,
      method: 'BANK',
      provider: payoutResult.provider,
      providerReference: payoutResult.providerReference,
      treasuryTxHash: payoutResult.treasuryTxHash,
      eta: payoutResult.eta,
    });
  } catch (error) {
    console.error('Bank payout error:', error);
    return res.status(500).json({
      error: 'Bank payout failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

sendRouter.post('/claim/payout/wallet', payoutRateLimiter, async (req: Request, res: Response) => {
  if (!(await ensureSendStoreReady(res))) return;

  try {
    const body = req.body as { claimSessionToken?: unknown; recipientWallet?: unknown };
    const resolved = await getVerifiedClaimSessionContext(body.claimSessionToken);
    if ('error' in resolved) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const { transfer, claimSession } = resolved.sessionContext;

    if (!enabledPayoutRegions('wallet').has(transfer.region.toUpperCase())) {
      return res.status(403).json({
        error: 'Wallet payout unavailable',
        message: `Wallet payout is not enabled in ${transfer.region}`,
      });
    }

    if (typeof body.recipientWallet !== 'string' || !isAddress(body.recipientWallet.trim())) {
      return res.status(400).json({
        error: 'Invalid recipient wallet',
        message: 'recipientWallet must be a valid EVM address',
      });
    }

    const recipientWallet = body.recipientWallet.trim();

    const payoutAttempt = await sendTransferStore.createPayoutAttempt({
      transferRowId: transfer.id,
      claimSessionId: claimSession.id,
      method: 'WALLET',
      provider: 'send-relayer',
      status: 'PROCESSING',
    });

    const payoutResult = await sendPayoutService.executeWalletPayout(transfer, recipientWallet);
    if (payoutResult.status === 'FAILED') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'FAILED',
        provider: payoutResult.provider,
        failureCode: payoutResult.failureCode,
        failureReason: payoutResult.failureReason,
      });

      return res.status(502).json({
        error: 'Wallet payout failed',
        message: payoutResult.failureReason || 'Wallet claim failed',
      });
    }

    await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
      status: 'SUCCESS',
      provider: payoutResult.provider,
      providerReference: payoutResult.providerReference,
      walletTxHash: payoutResult.walletTxHash,
    });
    await sendTransferStore.markTransferClaimed(transfer.id, 'CLAIMED_WALLET');
    await sendTransferStore.markClaimSessionCompleted(claimSession.id);

    return res.json({
      success: true,
      method: 'WALLET',
      provider: payoutResult.provider,
      providerReference: payoutResult.providerReference,
      walletTxHash: payoutResult.walletTxHash,
    });
  } catch (error) {
    console.error('Wallet payout error:', error);
    return res.status(500).json({
      error: 'Wallet payout failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

sendRouter.post('/webhooks/payout', async (req: Request, res: Response) => {
  if (!(await ensureSendStoreReady(res))) return;

  try {
    const expectedSecret = (process.env.SEND_PAYOUT_WEBHOOK_SECRET || '').trim();
    if (expectedSecret) {
      const providedSecretHeader = req.headers['x-send-webhook-secret'];
      const providedSecret = Array.isArray(providedSecretHeader)
        ? providedSecretHeader[0]
        : providedSecretHeader || '';

      if (providedSecret !== expectedSecret) {
        return res.status(401).json({
          error: 'Unauthorized webhook',
          message: 'Invalid webhook secret',
        });
      }
    }

    const body = req.body as {
      provider?: unknown;
      providerReference?: unknown;
      status?: unknown;
      failureCode?: unknown;
      failureReason?: unknown;
      walletTxHash?: unknown;
    };

    if (typeof body.provider !== 'string' || body.provider.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid provider',
        message: 'provider is required',
      });
    }

    if (typeof body.providerReference !== 'string' || body.providerReference.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid providerReference',
        message: 'providerReference is required',
      });
    }

    const normalizedStatus = String(body.status || '').trim().toUpperCase();
    if (!['PROCESSING', 'SUCCESS', 'FAILED', 'FALLBACK_REQUIRED'].includes(normalizedStatus)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'status must be PROCESSING, SUCCESS, FAILED, or FALLBACK_REQUIRED',
      });
    }

    const payoutAttempt = await sendTransferStore.getPayoutAttemptByProviderReference(
      body.provider.trim(),
      body.providerReference.trim()
    );

    if (!payoutAttempt) {
      return res.status(404).json({
        error: 'Payout attempt not found',
        message: 'No payout attempt matched provider + reference',
      });
    }

    if (normalizedStatus === 'PROCESSING') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'PROCESSING',
        provider: body.provider.trim(),
        failureCode: null,
        failureReason: null,
        walletTxHash: typeof body.walletTxHash === 'string' ? body.walletTxHash : undefined,
      });

      return res.json({ success: true, updated: 'PROCESSING' });
    }

    if (normalizedStatus === 'FALLBACK_REQUIRED') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'FALLBACK_REQUIRED',
        provider: body.provider.trim(),
        failureCode: typeof body.failureCode === 'string' ? body.failureCode : 'FALLBACK_REQUIRED',
        failureReason:
          typeof body.failureReason === 'string'
            ? body.failureReason
            : 'Provider requested payout fallback',
      });

      return res.json({ success: true, updated: 'FALLBACK_REQUIRED' });
    }

    if (normalizedStatus === 'FAILED') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'FAILED',
        provider: body.provider.trim(),
        failureCode: typeof body.failureCode === 'string' ? body.failureCode : 'PAYOUT_FAILED',
        failureReason: typeof body.failureReason === 'string' ? body.failureReason : 'Payout failed',
        walletTxHash: typeof body.walletTxHash === 'string' ? body.walletTxHash : undefined,
      });
      await sendTransferStore.updateTransferStatus(payoutAttempt.transferRowId, 'FAILED');
      await sendTransferStore.markClaimSessionCompleted(payoutAttempt.claimSessionId);

      return res.json({ success: true, updated: 'FAILED' });
    }

    await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
      status: 'SUCCESS',
      provider: body.provider.trim(),
      failureCode: null,
      failureReason: null,
      walletTxHash: typeof body.walletTxHash === 'string' ? body.walletTxHash : undefined,
    });

    await markTransferClaimedFromMethod(payoutAttempt.transferRowId, payoutAttempt.method);
    await sendTransferStore.markClaimSessionCompleted(payoutAttempt.claimSessionId);

    return res.json({ success: true, updated: 'SUCCESS' });
  } catch (error) {
    console.error('Payout webhook error:', error);
    return res.status(500).json({
      error: 'Payout webhook processing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

sendRouter.post('/webhooks/bridge-transfer', async (req: Request, res: Response) => {
  if (!(await ensureSendStoreReady(res))) return;

  try {
    const signatureHeaderValue = req.headers['x-webhook-signature'];
    const signatureHeader = Array.isArray(signatureHeaderValue)
      ? signatureHeaderValue[0]
      : signatureHeaderValue;

    const hasBridgeWebhookPublicKey =
      (process.env.SEND_BRIDGE_WEBHOOK_PUBLIC_KEY || '').trim().length > 0 ||
      (process.env.SEND_BRIDGE_WEBHOOK_PUBLIC_KEYS || '').trim().length > 0;

    if (hasBridgeWebhookPublicKey) {
      const verification = sendBridgeWebhookVerifier.verify({
        rawBody: (req as RequestWithRawBody).rawBody,
        signatureHeader: typeof signatureHeader === 'string' ? signatureHeader : undefined,
      });

      if (!verification.valid) {
        return res.status(401).json({
          error: 'Unauthorized webhook',
          message: verification.reason || 'Bridge webhook signature verification failed',
        });
      }
    } else {
      const expectedLegacySecret = (process.env.SEND_BRIDGE_WEBHOOK_SECRET || '').trim();
      if (!expectedLegacySecret) {
        return res.status(503).json({
          error: 'Bridge webhook verification not configured',
          message: 'Set SEND_BRIDGE_WEBHOOK_PUBLIC_KEY (preferred) or SEND_BRIDGE_WEBHOOK_SECRET (legacy)',
        });
      }

      const providedSecretHeader =
        req.headers['x-send-bridge-webhook-secret'] || req.headers['x-bridge-webhook-secret'];
      const providedSecret = Array.isArray(providedSecretHeader)
        ? providedSecretHeader[0]
        : providedSecretHeader || '';

      if (providedSecret !== expectedLegacySecret) {
        return res.status(401).json({
          error: 'Unauthorized webhook',
          message: 'Invalid Bridge webhook secret',
        });
      }
    }

    const body = req.body as {
      id?: unknown;
      transfer_id?: unknown;
      transferId?: unknown;
      state?: unknown;
      status?: unknown;
      data?: {
        id?: unknown;
        transfer_id?: unknown;
        state?: unknown;
        status?: unknown;
      };
      message?: unknown;
      error?: unknown;
      reason?: unknown;
      failureReason?: unknown;
      failureCode?: unknown;
    };

    const providerReferenceCandidate =
      body.id ??
      body.transfer_id ??
      body.transferId ??
      body.data?.id ??
      body.data?.transfer_id;

    if (typeof providerReferenceCandidate !== 'string' || providerReferenceCandidate.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid Bridge webhook payload',
        message: 'Missing transfer reference id',
      });
    }

    const providerReference = providerReferenceCandidate.trim();
    const bridgeStatus = mapBridgeStateToDispatchStatus(
      body.state ?? body.status ?? body.data?.state ?? body.data?.status
    );
    const bridgeProvider = (process.env.SEND_BRIDGE_PAYOUT_PROVIDER_NAME || 'bridge').trim() || 'bridge';
    const payoutProviderMode = (process.env.SEND_PAYOUT_PROVIDER || 'mock').trim().toLowerCase();
    const bridgeOnlyMode = payoutProviderMode === 'bridge_only' || payoutProviderMode === 'bridge';

    const payoutAttempt = await sendTransferStore.getPayoutAttemptByProviderReference(
      bridgeProvider,
      providerReference
    );
    if (!payoutAttempt) {
      return res.status(404).json({
        error: 'Payout attempt not found',
        message: 'No payout attempt matched bridge provider + transfer id',
      });
    }

    if (bridgeStatus === 'PROCESSING') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'PROCESSING',
        provider: bridgeProvider,
        providerReference,
      });

      return res.json({ success: true, updated: 'PROCESSING' });
    }

    if (bridgeStatus === 'FAILED') {
      const failureReasonCandidate =
        body.failureReason ??
        body.reason ??
        body.message ??
        (typeof body.error === 'string' ? body.error : undefined);

      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'FAILED',
        provider: bridgeProvider,
        providerReference,
        failureCode:
          typeof body.failureCode === 'string' ? body.failureCode : 'BRIDGE_TRANSFER_FAILED',
        failureReason:
          typeof failureReasonCandidate === 'string'
            ? failureReasonCandidate
            : 'Bridge transfer failed',
      });
      await sendTransferStore.updateTransferStatus(payoutAttempt.transferRowId, 'FAILED');
      await sendTransferStore.markClaimSessionCompleted(payoutAttempt.claimSessionId);

      return res.json({ success: true, updated: 'FAILED' });
    }

    const transfer = await sendTransferStore.getTransferById(payoutAttempt.transferRowId);
    if (!transfer) {
      return res.status(404).json({
        error: 'Transfer not found',
        message: 'No transfer matched payout attempt',
      });
    }

    if (payoutAttempt.method === 'WALLET' || bridgeOnlyMode) {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'SUCCESS',
        provider: bridgeProvider,
        providerReference,
      });
      await markTransferClaimedFromMethod(payoutAttempt.transferRowId, payoutAttempt.method);
      await sendTransferStore.markClaimSessionCompleted(payoutAttempt.claimSessionId);
      return res.json({ success: true, updated: 'SUCCESS' });
    }

    const recipientContact = sendTransferStore.decryptRecipientContact(transfer);
    const stripeResult = await sendStripePayoutService.createRecipientPayout({
      method: payoutAttempt.method,
      transfer,
      bridgeTransferReference: providerReference,
      recipientContext: {
        recipientType: transfer.recipientType,
        recipientContact,
      },
    });

    if (stripeResult.status === 'FAILED') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'FAILED',
        provider: stripeResult.provider,
        providerReference: stripeResult.providerReference,
        failureCode: stripeResult.failureCode || 'STRIPE_PAYOUT_FAILED',
        failureReason: stripeResult.failureReason || 'Stripe payout failed after bridge conversion',
      });
      await sendTransferStore.updateTransferStatus(payoutAttempt.transferRowId, 'FAILED');
      await sendTransferStore.markClaimSessionCompleted(payoutAttempt.claimSessionId);

      return res.status(502).json({
        error: 'Stripe payout failed',
        message: stripeResult.failureReason || 'Stripe payout failed after bridge conversion',
      });
    }

    if (stripeResult.status === 'FALLBACK_REQUIRED') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'FALLBACK_REQUIRED',
        provider: stripeResult.provider,
        providerReference: stripeResult.providerReference,
        failureCode: stripeResult.failureCode || 'STRIPE_FALLBACK_REQUIRED',
        failureReason: stripeResult.failureReason || 'Stripe payout fallback required',
      });

      return res.json({ success: true, updated: 'FALLBACK_REQUIRED' });
    }

    if (stripeResult.status === 'ACTION_REQUIRED') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'FAILED',
        provider: stripeResult.provider,
        providerReference: stripeResult.providerReference,
        failureCode: stripeResult.failureCode || 'STRIPE_ONBOARDING_REQUIRED_AFTER_SETTLEMENT',
        failureReason:
          stripeResult.failureReason ||
          'Recipient onboarding became required after Bridge conversion settlement',
      });
      await sendTransferStore.updateTransferStatus(payoutAttempt.transferRowId, 'FAILED');
      await sendTransferStore.markClaimSessionCompleted(payoutAttempt.claimSessionId);

      return res.status(409).json({
        error: 'Recipient onboarding required',
        message:
          stripeResult.failureReason ||
          'Recipient onboarding became required after Bridge conversion settlement',
      });
    }

    if (stripeResult.status === 'PROCESSING') {
      await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
        status: 'PROCESSING',
        provider: stripeResult.provider,
        providerReference: stripeResult.providerReference,
      });

      return res.json({ success: true, updated: 'PROCESSING' });
    }

    await sendTransferStore.updatePayoutAttempt(payoutAttempt.id, {
      status: 'SUCCESS',
      provider: stripeResult.provider,
      providerReference: stripeResult.providerReference,
    });
    await markTransferClaimedFromMethod(payoutAttempt.transferRowId, payoutAttempt.method);
    await sendTransferStore.markClaimSessionCompleted(payoutAttempt.claimSessionId);

    return res.json({ success: true, updated: 'SUCCESS' });
  } catch (error) {
    console.error('Bridge transfer webhook error:', error);
    return res.status(500).json({
      error: 'Bridge webhook processing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default sendRouter;
