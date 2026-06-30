import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import {
  type CreateMemberWalletLinkChallengeInput,
  type CreateMemberWalletLinkHandoffInput,
  memberStore,
  type AcceptTermsInput,
  type MemberMembershipPlan,
  type UpdateMemberSocialAccountInput,
  type UpdateMemberWalletInput,
  type UpdateOnboardingInput,
  type UpdateProfileInput,
  type UpdateSecuritySettingsInput,
  type UpsertMemberSocialAccountInput,
  type UpsertMemberWalletInput,
} from '../services/memberStore.js';
import { memberBillingService } from '../services/memberBillingService.js';
import { memberAvatarStore } from '../services/memberAvatarStore.js';

const router = Router();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const INVALID = Symbol('invalid');

function resolveRawAuthSubject(req: Request): string {
  const profileUuid = req.auth?.profileUuid?.trim();
  if (profileUuid) return profileUuid;

  const walletAddress = req.auth?.walletAddress?.trim().toLowerCase();
  if (walletAddress) return walletAddress;

  throw new Error('Authenticated subject missing');
}

function buildMemberAuthInput(req: Request) {
  return {
    authSubject: resolveRawAuthSubject(req),
    profileUuid: req.auth?.profileUuid ?? null,
    walletAddress: req.auth?.walletAddress ?? null,
    walletAddresses: req.auth?.addresses ?? null,
    email: req.auth?.email ?? null,
    phone: req.auth?.phone ?? null,
  };
}

async function resolveMemberAuthSubject(req: Request): Promise<string> {
  const rawAuthSubject = resolveRawAuthSubject(req);
  const canonicalAuthSubject = await memberStore.resolveCanonicalAuthSubject(buildMemberAuthInput(req));
  return canonicalAuthSubject ?? rawAuthSubject;
}

function resolveWallet(req: Request): string {
  const walletAddress = req.auth?.walletAddress?.trim().toLowerCase();
  if (!walletAddress) {
    throw new Error('Authenticated wallet missing');
  }
  return walletAddress;
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

function isObjectBody(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hashValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseOptionalString(
  value: unknown,
  fieldName: string,
  maxLength: number,
  res: Response,
  options: { allowNull?: boolean } = {}
): string | null | undefined | typeof INVALID {
  if (value === undefined) return undefined;
  if (value === null) {
    if (options.allowNull) return null;
    res.status(400).json({
      error: `Invalid ${fieldName}`,
      message: `${fieldName} must be a string`,
    });
    return INVALID;
  }
  if (typeof value !== 'string') {
    res.status(400).json({
      error: `Invalid ${fieldName}`,
      message: `${fieldName} must be a string`,
    });
    return INVALID;
  }
  const trimmed = value.trim();
  if (!trimmed) return options.allowNull ? null : '';
  return trimmed.slice(0, maxLength);
}

function parseOptionalBoolean(
  value: unknown,
  fieldName: string,
  res: Response
): boolean | undefined | typeof INVALID {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    res.status(400).json({
      error: `Invalid ${fieldName}`,
      message: `${fieldName} must be a boolean`,
    });
    return INVALID;
  }
  return value;
}

function parseOptionalStringArray(
  value: unknown,
  fieldName: string,
  res: Response
): string[] | null | undefined | typeof INVALID {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    res.status(400).json({
      error: `Invalid ${fieldName}`,
      message: `${fieldName} must be an array of strings`,
    });
    return INVALID;
  }

  return value.map((entry) => entry.trim()).filter(Boolean).slice(0, 12);
}

function handleMemberRouteError(res: Response, error: unknown): void {
  const pgCode = (error as { code?: string })?.code;
  if (pgCode === '23505') {
    res.status(409).json({
      error: 'Conflict',
      message: 'A member record with one of those unique fields already exists',
    });
    return;
  }

  if (error instanceof Error) {
    if (
      error.message.includes('Stripe membership billing is not configured')
      || error.message.includes('STRIPE_SECRET_KEY is not configured')
      || error.message.includes('Stripe price is not configured')
    ) {
      res.status(503).json({
        error: 'Stripe billing unavailable',
        message: error.message,
      });
      return;
    }

    if (
      error.message.includes('Stripe request failed')
      || error.message.startsWith('No such price:')
      || error.message.startsWith('No such customer:')
      || error.message.startsWith('No such subscription:')
    ) {
      res.status(502).json({
        error: 'Stripe request failed',
        message: error.message,
      });
      return;
    }

    if (error.message === 'Member record not found') {
      res.status(404).json({
        error: 'Member not found',
        message: 'Bootstrap the member account before using this route',
      });
      return;
    }

    if (
      error.message.includes('not eligible')
      || error.message.includes('private data encryption')
      || error.message.includes('Authenticated')
      || error.message.includes('Primary wallet')
      || error.message.includes('already linked')
      || error.message.includes('Wallet link challenge')
      || error.message.includes('Wallet link handoff')
      || error.message.includes('Invalid wallet link signature')
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

  console.error('Members route error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}

function parseMembershipPlan(
  value: unknown,
  fieldName: string,
  res: Response
): MemberMembershipPlan | undefined | typeof INVALID {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    res.status(400).json({
      error: `Invalid ${fieldName}`,
      message: `${fieldName} must be a string`,
    });
    return INVALID;
  }

  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'YEARLY' || normalized === 'LIFETIME') {
    return normalized;
  }

  res.status(400).json({
    error: `Invalid ${fieldName}`,
    message: `${fieldName} must be YEARLY or LIFETIME`,
  });
  return INVALID;
}

function parseIdParam(value: string | undefined, fieldName: string, res: Response): number | typeof INVALID {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    res.status(400).json({
      error: `Invalid ${fieldName}`,
      message: `${fieldName} must be a positive integer`,
    });
    return INVALID;
  }
  return parsed;
}

router.put('/me/bootstrap', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;

  try {
    const account = await memberStore.bootstrapMember({
      // The Privy smart wallet is the CANONICAL primary (where funds live). Prefer it so a member who
      // first joined via an external wallet (pre-migration) self-heals to the smart wallet as primary.
      authSubject: resolveRawAuthSubject(req),
      primaryWallet: req.auth?.smartWallet ?? resolveWallet(req),
      reownProfileUuid: req.auth?.profileUuid ?? null,
      email: req.auth?.email ?? null,
      phone: req.auth?.phone ?? null,
      walletAddresses: req.auth?.addresses ?? null,
    });

    res.json({
      member: account.member,
      capabilities: account.capabilities,
      onboarding: account.onboarding,
    });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.get('/me', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const member = await memberStore.getMemberByAuthSubject(authSubject);
    if (!member) {
      return res.status(404).json({
        error: 'Member not found',
        message: 'Bootstrap the member account before using this route',
      });
    }

    res.json({ member });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.get('/me/account-center', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const account = await memberStore.getAccountCenterByAuthSubject(authSubject, {
      includeLockedPrivateProfile: true,
      requireMember: true,
    });
    res.json(account);
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.get('/me/capabilities', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const capabilities = await memberStore.getCapabilitiesByAuthSubject(authSubject);
    if (!capabilities) {
      return res.status(404).json({
        error: 'Member not found',
        message: 'Bootstrap the member account before using this route',
      });
    }

    res.json({ capabilities });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.get('/me/membership', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const member = await memberStore.getMemberByAuthSubject(authSubject);
    if (!member) {
      return res.status(404).json({
        error: 'Member not found',
        message: 'Bootstrap the member account before using this route',
      });
    }

    const billing = memberBillingService.isConfigured()
      ? await memberBillingService.getMembershipSummaryForMember(member.id)
      : {
          customer: null,
          latestCheckoutSession: null,
          subscription: null,
          latestPayment: null,
        };

    res.json({ member, billing });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.get('/me/onboarding', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const onboarding = await memberStore.getOnboardingByAuthSubject(authSubject);
    if (!onboarding) {
      return res.status(404).json({
        error: 'Member not found',
        message: 'Bootstrap the member account before using this route',
      });
    }

    res.json({ onboarding });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.patch('/me/onboarding', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const body = req.body;
  const currentStep = parseOptionalString(body.currentStep, 'currentStep', 64, res, { allowNull: true });
  if (currentStep === INVALID) return;
  const accessTrack = parseOptionalString(body.accessTrack, 'accessTrack', 64, res, { allowNull: true });
  if (accessTrack === INVALID) return;
  const accountMethod = parseOptionalString(body.accountMethod, 'accountMethod', 64, res, { allowNull: true });
  if (accountMethod === INVALID) return;
  const identityModeSelected = parseOptionalString(
    body.identityModeSelected,
    'identityModeSelected',
    64,
    res,
    { allowNull: true }
  );
  if (identityModeSelected === INVALID) return;
  const referralSource = parseOptionalString(body.referralSource, 'referralSource', 128, res, { allowNull: true });
  if (referralSource === INVALID) return;
  const inviteCode = parseOptionalString(body.inviteCode, 'inviteCode', 128, res, { allowNull: true });
  if (inviteCode === INVALID) return;
  const incomeSource = parseOptionalString(body.incomeSource, 'incomeSource', 128, res, { allowNull: true });
  if (incomeSource === INVALID) return;
  const reasons = parseOptionalStringArray(body.reasons, 'reasons', res);
  if (reasons === INVALID) return;
  const goalsNote = parseOptionalString(body.goalsNote, 'goalsNote', 1024, res, { allowNull: true });
  if (goalsNote === INVALID) return;
  const recoveryMethod = parseOptionalString(body.recoveryMethod, 'recoveryMethod', 128, res, { allowNull: true });
  if (recoveryMethod === INVALID) return;
  const residencyCountry = parseOptionalString(body.residencyCountry, 'residencyCountry', 120, res, { allowNull: true });
  if (residencyCountry === INVALID) return;
  const settlementCurrency = parseOptionalString(
    body.settlementCurrency,
    'settlementCurrency',
    12,
    res,
    { allowNull: true }
  );
  if (settlementCurrency === INVALID) return;
  const membershipPlan = parseMembershipPlan(body.membershipPlan, 'membershipPlan', res);
  if (membershipPlan === INVALID) return;
  const cardWaitlist = parseOptionalBoolean(body.cardWaitlist, 'cardWaitlist', res);
  if (cardWaitlist === INVALID) return;
  const localPools = parseOptionalBoolean(body.localPools, 'localPools', res);
  if (localPools === INVALID) return;

  const patch: UpdateOnboardingInput = {
    currentStep,
    accessTrack,
    accountMethod,
    identityModeSelected,
    referralSource,
    inviteCode,
    incomeSource,
    reasons,
    goalsNote,
    recoveryMethod,
    residencyCountry,
    settlementCurrency,
    membershipPlan,
    cardWaitlist,
    localPools,
  };

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const onboarding = await memberStore.updateOnboardingByAuthSubject(authSubject, patch);
    const capabilities = await memberStore.getCapabilitiesByAuthSubject(authSubject);
    res.json({ onboarding, capabilities });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.post('/me/onboarding/submit', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const account = await memberStore.submitOnboardingByAuthSubject(authSubject);
    res.json(account);
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.get('/me/profile', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const profile = await memberStore.getProfileByAuthSubject(authSubject, {
      includeLockedPrivateProfile: true,
    });
    if (!profile) {
      return res.status(404).json({
        error: 'Member not found',
        message: 'Bootstrap the member account before using this route',
      });
    }

    res.json({ profile });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.patch('/me/profile', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const body = req.body;
  const username = parseOptionalString(body.username, 'username', 32, res, { allowNull: true });
  if (username === INVALID) return;
  const displayName = parseOptionalString(body.displayName, 'displayName', 120, res, { allowNull: true });
  if (displayName === INVALID) return;
  const bio = parseOptionalString(body.bio, 'bio', 512, res, { allowNull: true });
  if (bio === INVALID) return;
  const timezone = parseOptionalString(body.timezone, 'timezone', 64, res, { allowNull: true });
  if (timezone === INVALID) return;
  const locale = parseOptionalString(body.locale, 'locale', 16, res, { allowNull: true });
  if (locale === INVALID) return;
  const avatarUrl = parseOptionalString(body.avatarUrl, 'avatarUrl', 2048, res, { allowNull: true });
  if (avatarUrl === INVALID) return;
  const residencyCountry = parseOptionalString(body.residencyCountry, 'residencyCountry', 120, res, { allowNull: true });
  if (residencyCountry === INVALID) return;
  const settlementCurrency = parseOptionalString(
    body.settlementCurrency,
    'settlementCurrency',
    12,
    res,
    { allowNull: true }
  );
  if (settlementCurrency === INVALID) return;
  const legalName = parseOptionalString(body.legalName, 'legalName', 160, res, { allowNull: true });
  if (legalName === INVALID) return;
  const email = parseOptionalString(body.email, 'email', 320, res, { allowNull: true });
  if (email === INVALID) return;
  if (typeof email === 'string' && email.length > 0 && !EMAIL_REGEX.test(email)) {
    return res.status(400).json({
      error: 'Invalid email',
      message: 'email must be a valid email address',
    });
  }
  const phone = parseOptionalString(body.phone, 'phone', 32, res, { allowNull: true });
  if (phone === INVALID) return;
  const cityRegion = parseOptionalString(body.cityRegion, 'cityRegion', 160, res, { allowNull: true });
  if (cityRegion === INVALID) return;
  const notificationsOptIn = parseOptionalBoolean(body.notificationsOptIn, 'notificationsOptIn', res);
  if (notificationsOptIn === INVALID) return;

  const hasPrivateFields =
    legalName !== undefined || email !== undefined || phone !== undefined || cityRegion !== undefined;

  if (hasPrivateFields && !memberStore.isPrivateDataEncryptionConfigured()) {
    return res.status(503).json({
      error: 'Member private data encryption not configured',
      message:
        'Set MEMBER_PRIVATE_DATA_MASTER_KEY or MEMBER_PRIVATE_DATA_KEYRING_JSON before storing private profile data',
    });
  }

  const patch: UpdateProfileInput = {
    username,
    displayName,
    bio,
    timezone,
    locale,
    avatarUrl,
    notificationsOptIn,
    residencyCountry,
    settlementCurrency,
    legalName,
    email,
    phone,
    cityRegion,
  };

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const profile = await memberStore.updateProfileByAuthSubject(authSubject, patch);
    const capabilities = await memberStore.getCapabilitiesByAuthSubject(authSubject);
    res.json({ profile, capabilities });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.get('/me/wallets', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const wallets = await memberStore.listWalletsByAuthSubject(authSubject);
    if (!wallets) {
      return res.status(404).json({
        error: 'Member not found',
        message: 'Bootstrap the member account before using this route',
      });
    }

    res.json({ wallets });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.post('/me/wallets', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const body = req.body;
  const label = parseOptionalString(body.label, 'label', 120, res, { allowNull: true });
  if (label === INVALID) return;
  const description = parseOptionalString(body.description, 'description', 280, res, { allowNull: true });
  if (description === INVALID) return;
  const walletAddress = parseOptionalString(body.walletAddress, 'walletAddress', 255, res);
  if (walletAddress === INVALID) return;
  if (walletAddress == null || walletAddress === '') {
    return res.status(400).json({
      error: 'Invalid walletAddress',
      message: 'walletAddress is required',
    });
  }
  const kind = parseOptionalString(body.kind, 'kind', 32, res, { allowNull: true });
  if (kind === INVALID) return;
  const status = parseOptionalString(body.status, 'status', 32, res, { allowNull: true });
  if (status === INVALID) return;

  const input: UpsertMemberWalletInput = {
    label,
    description,
    walletAddress,
    kind: (kind ?? undefined) as UpsertMemberWalletInput['kind'],
    status: (status ?? undefined) as UpsertMemberWalletInput['status'],
  };

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const wallets = await memberStore.addWalletByAuthSubject(authSubject, input);
    res.json({ wallets });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.patch('/me/wallets/:id', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const walletId = parseIdParam(req.params.id, 'wallet id', res);
  if (walletId === INVALID) return;

  const body = req.body;
  const label = parseOptionalString(body.label, 'label', 120, res, { allowNull: true });
  if (label === INVALID) return;
  const description = parseOptionalString(body.description, 'description', 280, res, { allowNull: true });
  if (description === INVALID) return;
  const walletAddress = parseOptionalString(body.walletAddress, 'walletAddress', 255, res, { allowNull: true });
  if (walletAddress === INVALID) return;
  const kind = parseOptionalString(body.kind, 'kind', 32, res, { allowNull: true });
  if (kind === INVALID) return;
  const status = parseOptionalString(body.status, 'status', 32, res, { allowNull: true });
  if (status === INVALID) return;

  const input: UpdateMemberWalletInput = {
    label,
    description,
    walletAddress,
    kind: (kind ?? undefined) as UpdateMemberWalletInput['kind'],
    status: (status ?? undefined) as UpdateMemberWalletInput['status'],
  };

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const wallets = await memberStore.updateWalletByAuthSubject(authSubject, walletId, input);
    res.json({ wallets });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.delete('/me/wallets/:id', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  const walletId = parseIdParam(req.params.id, 'wallet id', res);
  if (walletId === INVALID) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const wallets = await memberStore.removeWalletByAuthSubject(authSubject, walletId);
    res.json({ wallets });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.post('/me/wallet-link-handoffs', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const body = req.body;
  const label = parseOptionalString(body.label, 'label', 120, res, { allowNull: true });
  if (label === INVALID) return;
  if (!label) {
    return res.status(400).json({
      error: 'Invalid label',
      message: 'label is required',
    });
  }
  const description = parseOptionalString(body.description, 'description', 280, res, { allowNull: true });
  if (description === INVALID) return;

  const input: CreateMemberWalletLinkHandoffInput = {
    label,
    description,
  };

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const handoff = await memberStore.createWalletLinkHandoffByAuthSubject(authSubject, input);
    res.json({ handoff });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.post('/me/wallet-links/challenge', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const body = req.body;
  const walletAddress = parseOptionalString(body.walletAddress, 'walletAddress', 255, res);
  if (walletAddress === INVALID) return;
  if (!walletAddress) {
    return res.status(400).json({
      error: 'Invalid walletAddress',
      message: 'walletAddress is required',
    });
  }
  const label = parseOptionalString(body.label, 'label', 120, res, { allowNull: true });
  if (label === INVALID) return;
  const description = parseOptionalString(body.description, 'description', 280, res, { allowNull: true });
  if (description === INVALID) return;
  const kind = parseOptionalString(body.kind, 'kind', 32, res, { allowNull: true });
  if (kind === INVALID) return;

  const input: CreateMemberWalletLinkChallengeInput = {
    walletAddress,
    label,
    description,
    kind: (kind ?? undefined) as CreateMemberWalletLinkChallengeInput['kind'],
  };

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const challenge = await memberStore.createWalletLinkChallengeByAuthSubject(authSubject, input);
    res.json({ challenge });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.post('/me/wallet-links/verify', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const challengeId = typeof req.body.challengeId === 'number'
    ? req.body.challengeId
    : Number.parseInt(String(req.body.challengeId ?? ''), 10);
  if (!Number.isFinite(challengeId) || challengeId <= 0) {
    return res.status(400).json({
      error: 'Invalid challengeId',
      message: 'challengeId must be a positive integer',
    });
  }

  const signature = parseOptionalString(req.body.signature, 'signature', 4096, res);
  if (signature === INVALID) return;
  if (!signature) {
    return res.status(400).json({
      error: 'Invalid signature',
      message: 'signature is required',
    });
  }

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const wallets = await memberStore.completeWalletLinkChallengeByAuthSubject(
      authSubject,
      challengeId,
      signature
    );
    res.json({ wallets });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.get('/me/socials', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const socialAccounts = await memberStore.listSocialAccountsByAuthSubject(authSubject);
    if (!socialAccounts) {
      return res.status(404).json({
        error: 'Member not found',
        message: 'Bootstrap the member account before using this route',
      });
    }

    res.json({ socialAccounts });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.post('/me/socials', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const body = req.body;
  const platform = parseOptionalString(body.platform, 'platform', 64, res);
  if (platform === INVALID) return;
  if (platform == null || platform === '') {
    return res.status(400).json({
      error: 'Invalid platform',
      message: 'platform is required',
    });
  }
  const handle = parseOptionalString(body.handle, 'handle', 255, res);
  if (handle === INVALID) return;
  if (handle == null || handle === '') {
    return res.status(400).json({
      error: 'Invalid handle',
      message: 'handle is required',
    });
  }
  const visibility = parseOptionalString(body.visibility, 'visibility', 32, res, { allowNull: true });
  if (visibility === INVALID) return;
  const status = parseOptionalString(body.status, 'status', 32, res, { allowNull: true });
  if (status === INVALID) return;

  const input: UpsertMemberSocialAccountInput = {
    platform,
    handle,
    visibility: (visibility ?? undefined) as UpsertMemberSocialAccountInput['visibility'],
    status: (status ?? undefined) as UpsertMemberSocialAccountInput['status'],
  };

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const socialAccounts = await memberStore.addSocialAccountByAuthSubject(authSubject, input);
    res.json({ socialAccounts });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.patch('/me/socials/:id', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const socialId = parseIdParam(req.params.id, 'social id', res);
  if (socialId === INVALID) return;

  const body = req.body;
  const platform = parseOptionalString(body.platform, 'platform', 64, res, { allowNull: true });
  if (platform === INVALID) return;
  const handle = parseOptionalString(body.handle, 'handle', 255, res, { allowNull: true });
  if (handle === INVALID) return;
  const visibility = parseOptionalString(body.visibility, 'visibility', 32, res, { allowNull: true });
  if (visibility === INVALID) return;
  const status = parseOptionalString(body.status, 'status', 32, res, { allowNull: true });
  if (status === INVALID) return;

  const input: UpdateMemberSocialAccountInput = {
    platform,
    handle,
    visibility: (visibility ?? undefined) as UpdateMemberSocialAccountInput['visibility'],
    status: (status ?? undefined) as UpdateMemberSocialAccountInput['status'],
  };

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const socialAccounts = await memberStore.updateSocialAccountByAuthSubject(authSubject, socialId, input);
    res.json({ socialAccounts });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.delete('/me/socials/:id', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  const socialId = parseIdParam(req.params.id, 'social id', res);
  if (socialId === INVALID) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const socialAccounts = await memberStore.removeSocialAccountByAuthSubject(authSubject, socialId);
    res.json({ socialAccounts });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.post('/me/membership/checkout', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const body = req.body;
  const plan = parseMembershipPlan(body.plan, 'plan', res);
  if (plan === INVALID) return;
  if (!plan) {
    return res.status(400).json({
      error: 'Invalid plan',
      message: 'plan is required',
    });
  }

  const successUrl = parseOptionalString(body.successUrl, 'successUrl', 2048, res);
  if (successUrl === INVALID) return;
  if (!successUrl) {
    return res.status(400).json({
      error: 'Invalid successUrl',
      message: 'successUrl is required',
    });
  }

  const cancelUrl = parseOptionalString(body.cancelUrl, 'cancelUrl', 2048, res);
  if (cancelUrl === INVALID) return;
  if (!cancelUrl) {
    return res.status(400).json({
      error: 'Invalid cancelUrl',
      message: 'cancelUrl is required',
    });
  }

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const account = await memberStore.getAccountCenterByAuthSubject(authSubject, {
      includeLockedPrivateProfile: true,
      requireMember: true,
    });
    const session = await memberBillingService.createCheckoutSession({
      member: account.member,
      email: account.profile.privateProfile?.email ?? req.auth?.email ?? null,
      displayName: account.profile.publicProfile.displayName ?? null,
      plan,
      successUrl,
      cancelUrl,
    });
    const billing = memberBillingService.isConfigured()
      ? await memberBillingService.getMembershipSummaryForMember(account.member.id)
      : null;

    res.json({ session, billing });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.get('/me/security', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const security = await memberStore.getSecurityByAuthSubject(authSubject);
    if (!security) {
      return res.status(404).json({
        error: 'Member not found',
        message: 'Bootstrap the member account before using this route',
      });
    }

    res.json({ security });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.patch('/me/security', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const body = req.body;
  const signatureLock = parseOptionalBoolean(body.signatureLock, 'signatureLock', res);
  if (signatureLock === INVALID) return;
  const sessionReview = parseOptionalBoolean(body.sessionReview, 'sessionReview', res);
  if (sessionReview === INVALID) return;
  const biometricAccess = parseOptionalBoolean(body.biometricAccess, 'biometricAccess', res);
  if (biometricAccess === INVALID) return;
  const socialDiscovery = parseOptionalBoolean(body.socialDiscovery, 'socialDiscovery', res);
  if (socialDiscovery === INVALID) return;
  const transferAlerts = parseOptionalBoolean(body.transferAlerts, 'transferAlerts', res);
  if (transferAlerts === INVALID) return;

  const patch: UpdateSecuritySettingsInput = {
    signatureLock,
    sessionReview,
    biometricAccess,
    socialDiscovery,
    transferAlerts,
  };

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const security = await memberStore.updateSecurityByAuthSubject(authSubject, patch);
    res.json({ security });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.post('/me/terms/accept', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const body = req.body;
  const documentType = parseOptionalString(body.documentType, 'documentType', 64, res);
  if (documentType === INVALID) return;
  if (documentType === undefined || documentType === null || documentType === '') {
    return res.status(400).json({
      error: 'Invalid documentType',
      message: 'documentType is required',
    });
  }
  const documentVersion = parseOptionalString(body.documentVersion, 'documentVersion', 64, res);
  if (documentVersion === INVALID) return;
  if (documentVersion === undefined || documentVersion === null || documentVersion === '') {
    return res.status(400).json({
      error: 'Invalid documentVersion',
      message: 'documentVersion is required',
    });
  }

  const payload: AcceptTermsInput = {
    documentType,
    documentVersion,
    walletAddress: resolveWallet(req),
    ipHash: hashValue(req.ip),
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
  };

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const terms = await memberStore.acceptTermsByAuthSubject(authSubject, payload);
    const capabilities = await memberStore.getCapabilitiesByAuthSubject(authSubject);
    res.json({ terms, capabilities });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.get('/me/verification', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const verification = await memberStore.getVerificationByAuthSubject(authSubject);
    if (!verification) {
      return res.status(404).json({
        error: 'Member not found',
        message: 'Bootstrap the member account before using this route',
      });
    }

    res.json({ verification });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.post('/me/verification/start', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  if (!isObjectBody(req.body)) {
    return res.status(400).json({
      error: 'Invalid body',
      message: 'Request body must be an object',
    });
  }

  const body = req.body;
  const provider = parseOptionalString(body.provider, 'provider', 64, res, { allowNull: true });
  if (provider === INVALID) return;
  const verificationLevel = parseOptionalString(
    body.verificationLevel,
    'verificationLevel',
    64,
    res,
    { allowNull: true }
  );
  if (verificationLevel === INVALID) return;

  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const account = await memberStore.startVerificationByAuthSubject(authSubject, {
      provider,
      verificationLevel,
    });
    res.json(account);
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

// Upload the member's avatar (compressed data URL) — stored as a Postgres blob, served publicly via
// /api/avatars/:memberId; the short URL is saved to avatar_url (fits the 2048-char cap).
router.post('/me/avatar', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const member = await memberStore.getMemberByAuthSubject(authSubject);
    if (!member) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }
    const dataUrl = typeof (req.body as { dataUrl?: unknown })?.dataUrl === 'string' ? (req.body as { dataUrl: string }).dataUrl : '';
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl);
    if (!match) {
      res.status(400).json({ error: 'Invalid image' });
      return;
    }
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > 600_000) {
      res.status(413).json({ error: 'Image too large' });
      return;
    }
    await memberAvatarStore.put(member.id, buffer, match[1]);
    const host = process.env.RAILWAY_PUBLIC_DOMAIN || req.get('host');
    const avatarUrl = `https://${host}/api/avatars/${member.id}?v=${Date.now()}`;
    await memberStore.updateProfileByAuthSubject(authSubject, { avatarUrl });
    res.json({ avatarUrl });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

router.delete('/me/avatar', async (req: Request, res: Response) => {
  if (!(await ensureMemberStoreReady(res))) return;
  try {
    const authSubject = await resolveMemberAuthSubject(req);
    const member = await memberStore.getMemberByAuthSubject(authSubject);
    if (member) await memberAvatarStore.remove(member.id);
    await memberStore.updateProfileByAuthSubject(authSubject, { avatarUrl: null });
    res.json({ ok: true });
  } catch (error) {
    handleMemberRouteError(res, error);
  }
});

export default router;
