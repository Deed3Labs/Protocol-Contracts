import crypto from 'crypto';
import type { Pool } from 'pg';
import { getPostgresPool } from '../config/postgres.js';
import {
  decryptMemberPrivateData,
  encryptMemberPrivateData,
  isMemberPrivateDataEncryptionConfigured,
} from '../utils/memberPrivateDataEncryption.js';

export type MemberStatus =
  | 'ONBOARDING'
  | 'BASIC_ACTIVE'
  | 'VERIFICATION_ELIGIBLE'
  | 'VERIFICATION_PENDING'
  | 'VERIFIED'
  | 'RESTRICTED';

export type MemberVerificationStatus =
  | 'NOT_STARTED'
  | 'ELIGIBLE'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESTRICTED';

export type MemberMembershipStatus = 'NONE' | 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
export type MemberMembershipPlan = 'YEARLY' | 'LIFETIME' | null;
export type OnboardingDraftStatus = 'in_progress' | 'submitted' | 'complete';

export interface MemberRecord {
  id: number;
  authSubject: string;
  primaryWallet: string;
  reownProfileUuid: string | null;
  status: MemberStatus;
  verificationStatus: MemberVerificationStatus;
  membershipPlan: MemberMembershipPlan;
  membershipStatus: MemberMembershipStatus;
  residencyCountry: string | null;
  settlementCurrency: string | null;
  membershipRegistryMemberId: number | null;
  membershipChainId: number | null;
  membershipTxHash: string | null;
  membershipSyncedAt: Date | null;
  membershipMetadataHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastAuthenticatedAt: Date;
}

export interface MemberPublicProfile {
  username: string | null;
  displayName: string | null;
  bio: string | null;
  timezone: string | null;
  locale: string | null;
  avatarUrl: string | null;
  notificationsOptIn: boolean;
  updatedAt: Date;
}

export interface MemberPrivateProfile {
  legalName: string | null;
  email: string | null;
  phone: string | null;
  cityRegion: string | null;
}

export interface MemberProfileView {
  publicProfile: MemberPublicProfile;
  privateProfile: MemberPrivateProfile | null;
  privateProfileExists: boolean;
  privateProfileLocked: boolean;
}

export interface MemberOnboardingRecord {
  currentStep: string;
  accessTrack: string;
  accountMethod: string;
  identityModeSelected: string;
  referralSource: string | null;
  inviteCode: string | null;
  incomeSource: string | null;
  reasons: string[];
  goalsNote: string | null;
  recoveryMethod: string | null;
  cardWaitlist: boolean;
  localPools: boolean;
  draftStatus: OnboardingDraftStatus;
  submittedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface MemberSecuritySettings {
  signatureLock: boolean;
  sessionReview: boolean;
  biometricAccess: boolean;
  socialDiscovery: boolean;
  transferAlerts: boolean;
  updatedAt: Date;
}

export interface MemberTermsSummaryItem {
  documentType: string;
  documentVersion: string;
  acceptedAt: Date;
}

export interface MemberVerificationSummary {
  status: MemberVerificationStatus;
  provider: string | null;
  verificationLevel: string | null;
  providerCustomerId: string | null;
  providerCaseId: string | null;
  requirements: unknown;
  resultSummary: unknown;
  submittedAt: Date | null;
  decidedAt: Date | null;
  updatedAt: Date | null;
}

export interface MemberCapabilities {
  canEditProfile: boolean;
  canJoinWaitlists: boolean;
  canStartVerification: boolean;
  canUsePlaid: boolean;
  canUseBridge: boolean;
  canAccessDirectDeposit: boolean;
  canAccessCard: boolean;
  canUseRegulatedTransfers: boolean;
}

export interface MemberAccountCenter {
  member: MemberRecord;
  profile: MemberProfileView;
  onboarding: MemberOnboardingRecord;
  security: MemberSecuritySettings;
  verification: MemberVerificationSummary;
  capabilities: MemberCapabilities;
  terms: MemberTermsSummaryItem[];
}

export interface BootstrapMemberInput {
  authSubject: string;
  primaryWallet: string;
  reownProfileUuid?: string | null;
}

export interface UpdateOnboardingInput {
  currentStep?: string | null;
  accessTrack?: string | null;
  accountMethod?: string | null;
  identityModeSelected?: string | null;
  referralSource?: string | null;
  inviteCode?: string | null;
  incomeSource?: string | null;
  reasons?: string[] | null;
  goalsNote?: string | null;
  recoveryMethod?: string | null;
  cardWaitlist?: boolean;
  localPools?: boolean;
  residencyCountry?: string | null;
  settlementCurrency?: string | null;
}

export interface UpdateProfileInput {
  username?: string | null;
  displayName?: string | null;
  bio?: string | null;
  timezone?: string | null;
  locale?: string | null;
  avatarUrl?: string | null;
  notificationsOptIn?: boolean;
  residencyCountry?: string | null;
  settlementCurrency?: string | null;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  cityRegion?: string | null;
}

export interface UpdateSecuritySettingsInput {
  signatureLock?: boolean;
  sessionReview?: boolean;
  biometricAccess?: boolean;
  socialDiscovery?: boolean;
  transferAlerts?: boolean;
}

export interface AcceptTermsInput {
  documentType: string;
  documentVersion: string;
  walletAddress: string;
  ipHash?: string | null;
  userAgent?: string | null;
}

const TABLE_MEMBERS = 'members';
const TABLE_PROFILE_PUBLIC = 'member_profile_public';
const TABLE_PROFILE_PRIVATE = 'member_profile_private';
const TABLE_ONBOARDING = 'member_onboarding';
const TABLE_TERMS = 'member_terms_acceptances';
const TABLE_SECURITY = 'member_security_settings';
const TABLE_VERIFICATIONS = 'member_verifications';
const DEFAULT_MAX_ATTEMPTS = 3;

type MemberDbRow = {
  id: string | number;
  auth_subject: string;
  primary_wallet: string;
  reown_profile_uuid: string | null;
  status: MemberStatus;
  verification_status: MemberVerificationStatus;
  membership_plan: MemberMembershipPlan;
  membership_status: MemberMembershipStatus;
  residency_country: string | null;
  settlement_currency: string | null;
  membership_registry_member_id: string | number | null;
  membership_chain_id: string | number | null;
  membership_tx_hash: string | null;
  membership_synced_at: Date | string | null;
  membership_metadata_hash: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  last_authenticated_at: Date | string;
};

type MemberPublicProfileDbRow = {
  member_id: string | number;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  timezone: string | null;
  locale: string | null;
  avatar_url: string | null;
  notifications_opt_in: boolean;
  updated_at: Date | string;
};

type MemberPrivateProfileDbRow = {
  member_id: string | number;
  payload_ciphertext: Buffer;
  payload_iv: Buffer;
  payload_auth_tag: Buffer;
  wrapped_data_key_ciphertext: Buffer;
  wrapped_data_key_iv: Buffer;
  wrapped_data_key_auth_tag: Buffer;
  key_version: string;
  email_hash: string | null;
  phone_hash: string | null;
  updated_at: Date | string;
};

type MemberOnboardingDbRow = {
  member_id: string | number;
  current_step: string;
  access_track: string;
  account_method: string;
  identity_mode_selected: string;
  referral_source: string | null;
  invite_code: string | null;
  income_source: string | null;
  reasons: unknown;
  goals_note: string | null;
  recovery_method: string | null;
  card_waitlist: boolean;
  local_pools: boolean;
  draft_status: OnboardingDraftStatus;
  submitted_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
};

type MemberTermsDbRow = {
  document_type: string;
  document_version: string;
  accepted_at: Date | string;
};

type MemberSecurityDbRow = {
  member_id: string | number;
  signature_lock: boolean;
  session_review: boolean;
  biometric_access: boolean;
  social_discovery: boolean;
  transfer_alerts: boolean;
  updated_at: Date | string;
};

type MemberVerificationDbRow = {
  status: string;
  provider: string | null;
  verification_level: string | null;
  provider_customer_id: string | null;
  provider_case_id: string | null;
  requirements: unknown;
  result_summary: unknown;
  submitted_at: Date | string | null;
  decided_at: Date | string | null;
  updated_at: Date | string | null;
};

function normalizeWalletAddress(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

function normalizeOptionalString(value: string | null | undefined, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeUsername(value: string | null | undefined): string | null | undefined {
  const normalized = normalizeOptionalString(value, 32);
  if (normalized == null) return normalized;
  return normalized.toLowerCase();
}

function resolvePatchedString(
  patchValue: string | null | undefined,
  currentValue: string | null,
  maxLength: number
): string | null {
  if (patchValue === undefined) return currentValue;
  return normalizeOptionalString(patchValue, maxLength) ?? null;
}

function resolvePatchedUsername(
  patchValue: string | null | undefined,
  currentValue: string | null
): string | null {
  if (patchValue === undefined) return currentValue;
  return normalizeUsername(patchValue) ?? null;
}

function resolvePatchedEmail(
  patchValue: string | null | undefined,
  currentValue: string | null
): string | null {
  if (patchValue === undefined) return currentValue;
  return normalizeOptionalEmail(patchValue) ?? null;
}

function resolvePatchedPhone(
  patchValue: string | null | undefined,
  currentValue: string | null
): string | null {
  if (patchValue === undefined) return currentValue;
  return normalizeOptionalPhone(patchValue) ?? null;
}

function resolvePatchedArray(
  patchValue: string[] | null | undefined,
  currentValue: string[]
): string[] {
  if (patchValue === undefined) return currentValue;
  return (patchValue ?? []).map((entry) => entry.trim()).filter(Boolean).slice(0, 12);
}

function normalizeOptionalCountry(value: string | null | undefined): string | null | undefined {
  const normalized = normalizeOptionalString(value, 3);
  if (normalized == null) return normalized;
  return normalized.toUpperCase();
}

function normalizeOptionalCurrency(value: string | null | undefined): string | null | undefined {
  const normalized = normalizeOptionalString(value, 12);
  if (normalized == null) return normalized;
  return normalized.toUpperCase();
}

function normalizeOptionalEmail(value: string | null | undefined): string | null | undefined {
  const normalized = normalizeOptionalString(value, 320);
  if (normalized == null) return normalized;
  return normalized.toLowerCase();
}

function normalizeOptionalPhone(value: string | null | undefined): string | null | undefined {
  const normalized = normalizeOptionalString(value, 32);
  if (normalized == null) return normalized;
  return normalized.replace(/\s+/g, '');
}

function parseNumericId(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === 'number' ? value : parseInt(value, 10);
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function encryptionContext(memberId: number): string {
  return `member:${memberId}`;
}

function isRetryablePostgresError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (!code) return false;

  return [
    '40001',
    '40P01',
    '55P03',
    '53300',
    '57P03',
    '08000',
    '08001',
    '08003',
    '08006',
  ].includes(code);
}

function backoffMs(attempt: number): number {
  return Math.pow(2, attempt) * 100;
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts: number = DEFAULT_MAX_ATTEMPTS): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryablePostgresError(error) || attempt === maxAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
    }
  }

  throw lastError;
}

function mapMember(row: MemberDbRow): MemberRecord {
  return {
    id: parseNumericId(row.id) ?? 0,
    authSubject: row.auth_subject,
    primaryWallet: row.primary_wallet,
    reownProfileUuid: row.reown_profile_uuid,
    status: row.status,
    verificationStatus: row.verification_status,
    membershipPlan: row.membership_plan,
    membershipStatus: row.membership_status,
    residencyCountry: row.residency_country,
    settlementCurrency: row.settlement_currency,
    membershipRegistryMemberId: parseNumericId(row.membership_registry_member_id),
    membershipChainId: parseNumericId(row.membership_chain_id),
    membershipTxHash: row.membership_tx_hash,
    membershipSyncedAt: parseDate(row.membership_synced_at),
    membershipMetadataHash: row.membership_metadata_hash,
    createdAt: parseDate(row.created_at) ?? new Date(0),
    updatedAt: parseDate(row.updated_at) ?? new Date(0),
    lastAuthenticatedAt: parseDate(row.last_authenticated_at) ?? new Date(0),
  };
}

function defaultPublicProfile(): MemberPublicProfile {
  return {
    username: null,
    displayName: null,
    bio: null,
    timezone: null,
    locale: null,
    avatarUrl: null,
    notificationsOptIn: true,
    updatedAt: new Date(0),
  };
}

function mapPublicProfile(row: MemberPublicProfileDbRow | null): MemberPublicProfile {
  if (!row) return defaultPublicProfile();
  return {
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    timezone: row.timezone,
    locale: row.locale,
    avatarUrl: row.avatar_url,
    notificationsOptIn: row.notifications_opt_in,
    updatedAt: parseDate(row.updated_at) ?? new Date(0),
  };
}

function defaultOnboarding(): MemberOnboardingRecord {
  return {
    currentStep: 'identity',
    accessTrack: 'basic',
    accountMethod: 'wallet',
    identityModeSelected: 'pseudonymous',
    referralSource: null,
    inviteCode: null,
    incomeSource: null,
    reasons: [],
    goalsNote: null,
    recoveryMethod: null,
    cardWaitlist: false,
    localPools: false,
    draftStatus: 'in_progress',
    submittedAt: null,
    completedAt: null,
    updatedAt: new Date(0),
  };
}

function mapReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
}

function mapOnboarding(row: MemberOnboardingDbRow | null): MemberOnboardingRecord {
  if (!row) return defaultOnboarding();
  return {
    currentStep: row.current_step,
    accessTrack: row.access_track,
    accountMethod: row.account_method,
    identityModeSelected: row.identity_mode_selected,
    referralSource: row.referral_source,
    inviteCode: row.invite_code,
    incomeSource: row.income_source,
    reasons: mapReasons(row.reasons),
    goalsNote: row.goals_note,
    recoveryMethod: row.recovery_method,
    cardWaitlist: row.card_waitlist,
    localPools: row.local_pools,
    draftStatus: row.draft_status,
    submittedAt: parseDate(row.submitted_at),
    completedAt: parseDate(row.completed_at),
    updatedAt: parseDate(row.updated_at) ?? new Date(0),
  };
}

function defaultSecurity(): MemberSecuritySettings {
  return {
    signatureLock: true,
    sessionReview: true,
    biometricAccess: true,
    socialDiscovery: false,
    transferAlerts: true,
    updatedAt: new Date(0),
  };
}

function mapSecurity(row: MemberSecurityDbRow | null): MemberSecuritySettings {
  if (!row) return defaultSecurity();
  return {
    signatureLock: row.signature_lock,
    sessionReview: row.session_review,
    biometricAccess: row.biometric_access,
    socialDiscovery: row.social_discovery,
    transferAlerts: row.transfer_alerts,
    updatedAt: parseDate(row.updated_at) ?? new Date(0),
  };
}

function mapTerms(rows: MemberTermsDbRow[]): MemberTermsSummaryItem[] {
  return rows.map((row) => ({
    documentType: row.document_type,
    documentVersion: row.document_version,
    acceptedAt: parseDate(row.accepted_at) ?? new Date(0),
  }));
}

function mapVerification(
  row: MemberVerificationDbRow | null,
  member: MemberRecord
): MemberVerificationSummary {
  return {
    status: row?.status as MemberVerificationStatus || member.verificationStatus,
    provider: row?.provider ?? null,
    verificationLevel: row?.verification_level ?? null,
    providerCustomerId: row?.provider_customer_id ?? null,
    providerCaseId: row?.provider_case_id ?? null,
    requirements: row?.requirements ?? null,
    resultSummary: row?.result_summary ?? null,
    submittedAt: parseDate(row?.submitted_at),
    decidedAt: parseDate(row?.decided_at),
    updatedAt: parseDate(row?.updated_at),
  };
}

function deriveCapabilities(member: MemberRecord): MemberCapabilities {
  const restricted =
    member.status === 'RESTRICTED' || member.verificationStatus === 'RESTRICTED';
  const verified =
    member.status === 'VERIFIED' || member.verificationStatus === 'APPROVED';
  const verificationPending =
    member.status === 'VERIFICATION_PENDING' || member.verificationStatus === 'PENDING';
  const verificationEligible =
    member.status === 'VERIFICATION_ELIGIBLE'
    || member.verificationStatus === 'ELIGIBLE'
    || verified
    || verificationPending;

  return {
    canEditProfile: !restricted,
    canJoinWaitlists: !restricted,
    canStartVerification: !restricted && verificationEligible && !verified && !verificationPending,
    canUsePlaid: verified,
    canUseBridge: verified,
    canAccessDirectDeposit: verified,
    canAccessCard: verified,
    canUseRegulatedTransfers: verified,
  };
}

function deriveMemberState(input: {
  member: MemberRecord;
  onboarding: MemberOnboardingRecord;
  privateProfile: MemberPrivateProfile | null;
  terms: MemberTermsSummaryItem[];
}): Pick<MemberRecord, 'status' | 'verificationStatus'> {
  const { member, onboarding, privateProfile, terms } = input;
  if (member.status === 'RESTRICTED' || member.verificationStatus === 'RESTRICTED') {
    return { status: 'RESTRICTED', verificationStatus: 'RESTRICTED' };
  }

  if (member.verificationStatus === 'APPROVED' || member.status === 'VERIFIED') {
    return { status: 'VERIFIED', verificationStatus: 'APPROVED' };
  }

  if (member.verificationStatus === 'PENDING' || member.status === 'VERIFICATION_PENDING') {
    return { status: 'VERIFICATION_PENDING', verificationStatus: 'PENDING' };
  }

  const hasSubmittedOnboarding =
    onboarding.draftStatus === 'submitted' || onboarding.draftStatus === 'complete';
  const hasTerms = terms.length > 0;
  const hasEligibilityProfile =
    Boolean(privateProfile?.legalName)
    && Boolean(privateProfile?.email)
    && Boolean(member.residencyCountry);

  if (hasSubmittedOnboarding && hasTerms && hasEligibilityProfile) {
    return { status: 'VERIFICATION_ELIGIBLE', verificationStatus: 'ELIGIBLE' };
  }

  if (hasSubmittedOnboarding && hasTerms) {
    return { status: 'BASIC_ACTIVE', verificationStatus: 'NOT_STARTED' };
  }

  return { status: 'ONBOARDING', verificationStatus: 'NOT_STARTED' };
}

export class MemberStore {
  private schemaReadyPromise: Promise<void> | null = null;

  isConfigured(): boolean {
    return Boolean(getPostgresPool());
  }

  isPrivateDataEncryptionConfigured(): boolean {
    return isMemberPrivateDataEncryptionConfigured();
  }

  async ensureReady(): Promise<void> {
    if (!getPostgresPool()) {
      throw new Error('Postgres is not configured. Set DATABASE_URL for member persistence.');
    }

    if (!this.schemaReadyPromise) {
      this.schemaReadyPromise = this.ensureSchema();
    }

    return this.schemaReadyPromise;
  }

  async bootstrapMember(input: BootstrapMemberInput): Promise<MemberAccountCenter> {
    await this.ensureReady();
    const pool = this.mustPool();
    const authSubject = input.authSubject.trim();
    const primaryWallet = normalizeWalletAddress(input.primaryWallet);
    const reownProfileUuid = normalizeOptionalString(input.reownProfileUuid ?? null, 255) ?? null;

    const result = await withRetry(async () => {
      return pool.query<MemberDbRow>(
        `
        INSERT INTO ${TABLE_MEMBERS} (
          auth_subject,
          primary_wallet,
          reown_profile_uuid,
          status,
          verification_status,
          membership_status,
          last_authenticated_at
        ) VALUES ($1, $2, $3, 'ONBOARDING', 'NOT_STARTED', 'NONE', NOW())
        ON CONFLICT (auth_subject)
        DO UPDATE SET
          primary_wallet = EXCLUDED.primary_wallet,
          reown_profile_uuid = COALESCE(EXCLUDED.reown_profile_uuid, ${TABLE_MEMBERS}.reown_profile_uuid),
          last_authenticated_at = NOW(),
          updated_at = NOW()
        RETURNING *
        `,
        [authSubject, primaryWallet, reownProfileUuid]
      );
    });

    const member = mapMember(result.rows[0]);
    await this.ensureDefaultRows(member.id);
    await this.refreshDerivedState(member.id);
    return this.getAccountCenterByAuthSubject(authSubject, { includeLockedPrivateProfile: true, requireMember: true });
  }

  async getMemberByAuthSubject(authSubject: string): Promise<MemberRecord | null> {
    await this.ensureReady();
    return this.loadMemberByAuthSubject(authSubject.trim());
  }

  async getCapabilitiesByAuthSubject(authSubject: string): Promise<MemberCapabilities | null> {
    const member = await this.getMemberByAuthSubject(authSubject);
    return member ? deriveCapabilities(member) : null;
  }

  async getOnboardingByAuthSubject(authSubject: string): Promise<MemberOnboardingRecord | null> {
    await this.ensureReady();
    const member = await this.loadMemberByAuthSubject(authSubject.trim());
    if (!member) return null;
    const onboardingRow = await this.loadOnboardingRow(member.id);
    return mapOnboarding(onboardingRow);
  }

  async updateOnboardingByAuthSubject(
    authSubject: string,
    patch: UpdateOnboardingInput
  ): Promise<MemberOnboardingRecord> {
    await this.ensureReady();
    const member = await this.mustMember(authSubject.trim());
    await this.ensureDefaultRows(member.id);
    const current = mapOnboarding(await this.loadOnboardingRow(member.id));

    const next = {
      currentStep: resolvePatchedString(patch.currentStep, current.currentStep, 64) ?? 'identity',
      accessTrack: resolvePatchedString(patch.accessTrack, current.accessTrack, 64) ?? 'basic',
      accountMethod: resolvePatchedString(patch.accountMethod, current.accountMethod, 64) ?? 'wallet',
      identityModeSelected:
        resolvePatchedString(
          patch.identityModeSelected,
          current.identityModeSelected,
          64
        ) ?? 'pseudonymous',
      referralSource: resolvePatchedString(patch.referralSource, current.referralSource, 128),
      inviteCode: resolvePatchedString(patch.inviteCode, current.inviteCode, 128),
      incomeSource: resolvePatchedString(patch.incomeSource, current.incomeSource, 128),
      reasons: resolvePatchedArray(patch.reasons, current.reasons),
      goalsNote: resolvePatchedString(patch.goalsNote, current.goalsNote, 1024),
      recoveryMethod: resolvePatchedString(patch.recoveryMethod, current.recoveryMethod, 128),
      cardWaitlist: patch.cardWaitlist ?? current.cardWaitlist,
      localPools: patch.localPools ?? current.localPools,
    };

    const pool = this.mustPool();
    await withRetry(async () => {
      await pool.query(
        `
        INSERT INTO ${TABLE_ONBOARDING} (
          member_id,
          current_step,
          access_track,
          account_method,
          identity_mode_selected,
          referral_source,
          invite_code,
          income_source,
          reasons,
          goals_note,
          recovery_method,
          card_waitlist,
          local_pools,
          draft_status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)
        ON CONFLICT (member_id)
        DO UPDATE SET
          current_step = EXCLUDED.current_step,
          access_track = EXCLUDED.access_track,
          account_method = EXCLUDED.account_method,
          identity_mode_selected = EXCLUDED.identity_mode_selected,
          referral_source = EXCLUDED.referral_source,
          invite_code = EXCLUDED.invite_code,
          income_source = EXCLUDED.income_source,
          reasons = EXCLUDED.reasons,
          goals_note = EXCLUDED.goals_note,
          recovery_method = EXCLUDED.recovery_method,
          card_waitlist = EXCLUDED.card_waitlist,
          local_pools = EXCLUDED.local_pools,
          updated_at = NOW()
        `,
        [
          member.id,
          next.currentStep,
          next.accessTrack,
          next.accountMethod,
          next.identityModeSelected,
          next.referralSource,
          next.inviteCode,
          next.incomeSource,
          JSON.stringify(next.reasons),
          next.goalsNote,
          next.recoveryMethod,
          next.cardWaitlist,
          next.localPools,
          current.draftStatus,
        ]
      );
    });

    await this.updateMemberResidency(member.id, {
      residencyCountry: normalizeOptionalCountry(patch.residencyCountry),
      settlementCurrency: normalizeOptionalCurrency(patch.settlementCurrency),
    });
    await this.refreshDerivedState(member.id);

    return mapOnboarding(await this.loadOnboardingRow(member.id));
  }

  async submitOnboardingByAuthSubject(authSubject: string): Promise<MemberAccountCenter> {
    await this.ensureReady();
    const member = await this.mustMember(authSubject.trim());
    const pool = this.mustPool();
    await this.ensureDefaultRows(member.id);

    await withRetry(async () => {
      await pool.query(
        `
        UPDATE ${TABLE_ONBOARDING}
        SET
          draft_status = 'submitted',
          submitted_at = COALESCE(submitted_at, NOW()),
          completed_at = COALESCE(completed_at, NOW()),
          current_step = 'complete',
          updated_at = NOW()
        WHERE member_id = $1
        `,
        [member.id]
      );
    });

    await this.refreshDerivedState(member.id);
    return this.getAccountCenterByAuthSubject(authSubject, { includeLockedPrivateProfile: true, requireMember: true });
  }

  async getProfileByAuthSubject(
    authSubject: string,
    options: { includeLockedPrivateProfile?: boolean } = {}
  ): Promise<MemberProfileView | null> {
    await this.ensureReady();
    const member = await this.loadMemberByAuthSubject(authSubject.trim());
    if (!member) return null;
    return this.loadProfileView(member.id, Boolean(options.includeLockedPrivateProfile));
  }

  async updateProfileByAuthSubject(authSubject: string, patch: UpdateProfileInput): Promise<MemberProfileView> {
    await this.ensureReady();
    const member = await this.mustMember(authSubject.trim());
    await this.ensureDefaultRows(member.id);
    const currentPublic = mapPublicProfile(await this.loadPublicProfileRow(member.id));
    const currentPrivateResult = await this.loadPrivateProfile(member.id, true);
    const currentPrivate = currentPrivateResult.privateProfile;

    const nextPublic = {
      username: resolvePatchedUsername(patch.username, currentPublic.username),
      displayName: resolvePatchedString(patch.displayName, currentPublic.displayName, 120),
      bio: resolvePatchedString(patch.bio, currentPublic.bio, 512),
      timezone: resolvePatchedString(patch.timezone, currentPublic.timezone, 64),
      locale: resolvePatchedString(patch.locale, currentPublic.locale, 16),
      avatarUrl: resolvePatchedString(patch.avatarUrl, currentPublic.avatarUrl, 2048),
      notificationsOptIn: patch.notificationsOptIn ?? currentPublic.notificationsOptIn,
    };

    const pool = this.mustPool();
    await withRetry(async () => {
      await pool.query(
        `
        INSERT INTO ${TABLE_PROFILE_PUBLIC} (
          member_id,
          username,
          display_name,
          bio,
          timezone,
          locale,
          avatar_url,
          notifications_opt_in
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (member_id)
        DO UPDATE SET
          username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          bio = EXCLUDED.bio,
          timezone = EXCLUDED.timezone,
          locale = EXCLUDED.locale,
          avatar_url = EXCLUDED.avatar_url,
          notifications_opt_in = EXCLUDED.notifications_opt_in,
          updated_at = NOW()
        `,
        [
          member.id,
          nextPublic.username,
          nextPublic.displayName,
          nextPublic.bio,
          nextPublic.timezone,
          nextPublic.locale,
          nextPublic.avatarUrl,
          nextPublic.notificationsOptIn,
        ]
      );
    });

    const hasPrivatePatch =
      patch.legalName !== undefined
      || patch.email !== undefined
      || patch.phone !== undefined
      || patch.cityRegion !== undefined;

    if (hasPrivatePatch) {
      if (!this.isPrivateDataEncryptionConfigured()) {
        throw new Error(
          'Member private data encryption is not configured. Set MEMBER_PRIVATE_DATA_MASTER_KEY or MEMBER_PRIVATE_DATA_KEYRING_JSON.'
        );
      }

      const nextPrivate: MemberPrivateProfile = {
        legalName: resolvePatchedString(patch.legalName, currentPrivate?.legalName ?? null, 160),
        email: resolvePatchedEmail(patch.email, currentPrivate?.email ?? null),
        phone: resolvePatchedPhone(patch.phone, currentPrivate?.phone ?? null),
        cityRegion: resolvePatchedString(patch.cityRegion, currentPrivate?.cityRegion ?? null, 160),
      };

      const encrypted = encryptMemberPrivateData(
        JSON.stringify(nextPrivate),
        encryptionContext(member.id)
      );
      const emailHash = nextPrivate.email ? sha256Hex(nextPrivate.email) : null;
      const phoneHash = nextPrivate.phone ? sha256Hex(nextPrivate.phone) : null;

      await withRetry(async () => {
        await pool.query(
          `
          INSERT INTO ${TABLE_PROFILE_PRIVATE} (
            member_id,
            payload_ciphertext,
            payload_iv,
            payload_auth_tag,
            wrapped_data_key_ciphertext,
            wrapped_data_key_iv,
            wrapped_data_key_auth_tag,
            key_version,
            email_hash,
            phone_hash
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (member_id)
          DO UPDATE SET
            payload_ciphertext = EXCLUDED.payload_ciphertext,
            payload_iv = EXCLUDED.payload_iv,
            payload_auth_tag = EXCLUDED.payload_auth_tag,
            wrapped_data_key_ciphertext = EXCLUDED.wrapped_data_key_ciphertext,
            wrapped_data_key_iv = EXCLUDED.wrapped_data_key_iv,
            wrapped_data_key_auth_tag = EXCLUDED.wrapped_data_key_auth_tag,
            key_version = EXCLUDED.key_version,
            email_hash = EXCLUDED.email_hash,
            phone_hash = EXCLUDED.phone_hash,
            updated_at = NOW()
          `,
          [
            member.id,
            encrypted.ciphertext,
            encrypted.iv,
            encrypted.authTag,
            encrypted.wrappedKeyCiphertext,
            encrypted.wrappedKeyIv,
            encrypted.wrappedKeyAuthTag,
            encrypted.keyVersion,
            emailHash,
            phoneHash,
          ]
        );
      });
    }

    await this.updateMemberResidency(member.id, {
      residencyCountry: normalizeOptionalCountry(patch.residencyCountry),
      settlementCurrency: normalizeOptionalCurrency(patch.settlementCurrency),
    });
    await this.refreshDerivedState(member.id);

    return (await this.loadProfileView(member.id, true));
  }

  async getSecurityByAuthSubject(authSubject: string): Promise<MemberSecuritySettings | null> {
    await this.ensureReady();
    const member = await this.loadMemberByAuthSubject(authSubject.trim());
    if (!member) return null;
    return mapSecurity(await this.loadSecurityRow(member.id));
  }

  async updateSecurityByAuthSubject(
    authSubject: string,
    patch: UpdateSecuritySettingsInput
  ): Promise<MemberSecuritySettings> {
    await this.ensureReady();
    const member = await this.mustMember(authSubject.trim());
    await this.ensureDefaultRows(member.id);
    const current = mapSecurity(await this.loadSecurityRow(member.id));
    const next = {
      signatureLock: patch.signatureLock ?? current.signatureLock,
      sessionReview: patch.sessionReview ?? current.sessionReview,
      biometricAccess: patch.biometricAccess ?? current.biometricAccess,
      socialDiscovery: patch.socialDiscovery ?? current.socialDiscovery,
      transferAlerts: patch.transferAlerts ?? current.transferAlerts,
    };

    const pool = this.mustPool();
    await withRetry(async () => {
      await pool.query(
        `
        INSERT INTO ${TABLE_SECURITY} (
          member_id,
          signature_lock,
          session_review,
          biometric_access,
          social_discovery,
          transfer_alerts
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (member_id)
        DO UPDATE SET
          signature_lock = EXCLUDED.signature_lock,
          session_review = EXCLUDED.session_review,
          biometric_access = EXCLUDED.biometric_access,
          social_discovery = EXCLUDED.social_discovery,
          transfer_alerts = EXCLUDED.transfer_alerts,
          updated_at = NOW()
        `,
        [
          member.id,
          next.signatureLock,
          next.sessionReview,
          next.biometricAccess,
          next.socialDiscovery,
          next.transferAlerts,
        ]
      );
    });

    return mapSecurity(await this.loadSecurityRow(member.id));
  }

  async acceptTermsByAuthSubject(
    authSubject: string,
    input: AcceptTermsInput
  ): Promise<MemberTermsSummaryItem[]> {
    await this.ensureReady();
    const member = await this.mustMember(authSubject.trim());
    const pool = this.mustPool();

    await withRetry(async () => {
      await pool.query(
        `
        INSERT INTO ${TABLE_TERMS} (
          member_id,
          document_type,
          document_version,
          wallet_address,
          ip_hash,
          user_agent
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (member_id, document_type, document_version)
        DO UPDATE SET
          accepted_at = NOW(),
          wallet_address = EXCLUDED.wallet_address,
          ip_hash = EXCLUDED.ip_hash,
          user_agent = EXCLUDED.user_agent
        `,
        [
          member.id,
          input.documentType,
          input.documentVersion,
          normalizeWalletAddress(input.walletAddress),
          input.ipHash ?? null,
          input.userAgent ?? null,
        ]
      );
    });

    await this.refreshDerivedState(member.id);
    return this.loadTermsSummary(member.id);
  }

  async getVerificationByAuthSubject(authSubject: string): Promise<MemberVerificationSummary | null> {
    await this.ensureReady();
    const member = await this.loadMemberByAuthSubject(authSubject.trim());
    if (!member) return null;
    const row = await this.loadVerificationRow(member.id);
    return mapVerification(row, member);
  }

  async startVerificationByAuthSubject(
    authSubject: string,
    input: { provider?: string | null; verificationLevel?: string | null } = {}
  ): Promise<MemberAccountCenter> {
    await this.ensureReady();
    const member = await this.mustMember(authSubject.trim());
    const currentAccount = await this.getAccountCenterByAuthSubject(authSubject, {
      includeLockedPrivateProfile: true,
      requireMember: true,
    });

    if (!currentAccount.capabilities.canStartVerification) {
      throw new Error('Member is not eligible to start verification');
    }

    const pool = this.mustPool();
    const provider = normalizeOptionalString(input.provider ?? null, 64) ?? 'manual_review';
    const verificationLevel =
      normalizeOptionalString(input.verificationLevel ?? null, 64) ?? 'BASIC_KYC';

    await withRetry(async () => {
      await pool.query(
        `
        UPDATE ${TABLE_MEMBERS}
        SET
          status = 'VERIFICATION_PENDING',
          verification_status = 'PENDING',
          updated_at = NOW()
        WHERE id = $1
        `,
        [member.id]
      );

      await pool.query(
        `
        INSERT INTO ${TABLE_VERIFICATIONS} (
          member_id,
          provider,
          verification_level,
          status,
          submitted_at,
          updated_at
        ) VALUES ($1,$2,$3,'PENDING',NOW(),NOW())
        ON CONFLICT (member_id, provider, verification_level)
        DO UPDATE SET
          status = 'PENDING',
          submitted_at = COALESCE(${TABLE_VERIFICATIONS}.submitted_at, NOW()),
          decided_at = NULL,
          updated_at = NOW()
        `,
        [member.id, provider, verificationLevel]
      );
    });

    return this.getAccountCenterByAuthSubject(authSubject, { includeLockedPrivateProfile: true, requireMember: true });
  }

  async getAccountCenterByAuthSubject(
    authSubject: string,
    options: { includeLockedPrivateProfile?: boolean; requireMember?: boolean } = {}
  ): Promise<MemberAccountCenter> {
    await this.ensureReady();
    const member = await this.loadMemberByAuthSubject(authSubject.trim());
    if (!member) {
      if (options.requireMember) {
        throw new Error('Member record not found');
      }
      throw new Error('Member record not found');
    }

    await this.ensureDefaultRows(member.id);

    const [profile, onboardingRow, securityRow, terms, verificationRow] = await Promise.all([
      this.loadProfileView(member.id, Boolean(options.includeLockedPrivateProfile)),
      this.loadOnboardingRow(member.id),
      this.loadSecurityRow(member.id),
      this.loadTermsSummary(member.id),
      this.loadVerificationRow(member.id),
    ]);

    const refreshedMember = (await this.loadMemberByAuthSubject(authSubject.trim())) ?? member;

    return {
      member: refreshedMember,
      profile,
      onboarding: mapOnboarding(onboardingRow),
      security: mapSecurity(securityRow),
      verification: mapVerification(verificationRow, refreshedMember),
      capabilities: deriveCapabilities(refreshedMember),
      terms,
    };
  }

  private mustPool(): Pool {
    const pool = getPostgresPool();
    if (!pool) {
      throw new Error('Postgres pool is unavailable');
    }
    return pool;
  }

  private async ensureDefaultRows(memberId: number): Promise<void> {
    const pool = this.mustPool();
    await withRetry(async () => {
      await pool.query(
        `INSERT INTO ${TABLE_PROFILE_PUBLIC} (member_id) VALUES ($1) ON CONFLICT (member_id) DO NOTHING`,
        [memberId]
      );
      await pool.query(
        `INSERT INTO ${TABLE_ONBOARDING} (member_id) VALUES ($1) ON CONFLICT (member_id) DO NOTHING`,
        [memberId]
      );
      await pool.query(
        `INSERT INTO ${TABLE_SECURITY} (member_id) VALUES ($1) ON CONFLICT (member_id) DO NOTHING`,
        [memberId]
      );
    });
  }

  private async loadMemberByAuthSubject(authSubject: string): Promise<MemberRecord | null> {
    const pool = this.mustPool();
    const result = await withRetry(async () => {
      return pool.query<MemberDbRow>(
        `SELECT * FROM ${TABLE_MEMBERS} WHERE auth_subject = $1 LIMIT 1`,
        [authSubject]
      );
    });
    return result.rows[0] ? mapMember(result.rows[0]) : null;
  }

  private async mustMember(authSubject: string): Promise<MemberRecord> {
    const member = await this.loadMemberByAuthSubject(authSubject);
    if (!member) {
      throw new Error('Member record not found');
    }
    return member;
  }

  private async loadPublicProfileRow(memberId: number): Promise<MemberPublicProfileDbRow | null> {
    const pool = this.mustPool();
    const result = await withRetry(async () => {
      return pool.query<MemberPublicProfileDbRow>(
        `SELECT * FROM ${TABLE_PROFILE_PUBLIC} WHERE member_id = $1 LIMIT 1`,
        [memberId]
      );
    });
    return result.rows[0] ?? null;
  }

  private async loadPrivateProfile(
    memberId: number,
    includeLockedPrivateProfile: boolean
  ): Promise<{
    privateProfile: MemberPrivateProfile | null;
    privateProfileExists: boolean;
    privateProfileLocked: boolean;
  }> {
    const pool = this.mustPool();
    const result = await withRetry(async () => {
      return pool.query<MemberPrivateProfileDbRow>(
        `SELECT * FROM ${TABLE_PROFILE_PRIVATE} WHERE member_id = $1 LIMIT 1`,
        [memberId]
      );
    });

    const row = result.rows[0];
    if (!row) {
      return {
        privateProfile: null,
        privateProfileExists: false,
        privateProfileLocked: false,
      };
    }

    if (!this.isPrivateDataEncryptionConfigured()) {
      return {
        privateProfile: null,
        privateProfileExists: true,
        privateProfileLocked: includeLockedPrivateProfile,
      };
    }

    const plaintext = decryptMemberPrivateData(
      {
        ciphertext: row.payload_ciphertext,
        iv: row.payload_iv,
        authTag: row.payload_auth_tag,
        wrappedKeyCiphertext: row.wrapped_data_key_ciphertext,
        wrappedKeyIv: row.wrapped_data_key_iv,
        wrappedKeyAuthTag: row.wrapped_data_key_auth_tag,
        keyVersion: row.key_version,
      },
      encryptionContext(memberId)
    );

    const parsed = JSON.parse(plaintext) as Partial<MemberPrivateProfile> | null;
    return {
      privateProfile: {
        legalName: normalizeOptionalString(parsed?.legalName ?? null, 160) ?? null,
        email: normalizeOptionalEmail(parsed?.email ?? null) ?? null,
        phone: normalizeOptionalPhone(parsed?.phone ?? null) ?? null,
        cityRegion: normalizeOptionalString(parsed?.cityRegion ?? null, 160) ?? null,
      },
      privateProfileExists: true,
      privateProfileLocked: false,
    };
  }

  private async loadProfileView(
    memberId: number,
    includeLockedPrivateProfile: boolean
  ): Promise<MemberProfileView> {
    const [publicRow, privateProfileResult] = await Promise.all([
      this.loadPublicProfileRow(memberId),
      this.loadPrivateProfile(memberId, includeLockedPrivateProfile),
    ]);

    return {
      publicProfile: mapPublicProfile(publicRow),
      privateProfile: privateProfileResult.privateProfile,
      privateProfileExists: privateProfileResult.privateProfileExists,
      privateProfileLocked: privateProfileResult.privateProfileLocked,
    };
  }

  private async loadOnboardingRow(memberId: number): Promise<MemberOnboardingDbRow | null> {
    const pool = this.mustPool();
    const result = await withRetry(async () => {
      return pool.query<MemberOnboardingDbRow>(
        `SELECT * FROM ${TABLE_ONBOARDING} WHERE member_id = $1 LIMIT 1`,
        [memberId]
      );
    });
    return result.rows[0] ?? null;
  }

  private async loadSecurityRow(memberId: number): Promise<MemberSecurityDbRow | null> {
    const pool = this.mustPool();
    const result = await withRetry(async () => {
      return pool.query<MemberSecurityDbRow>(
        `SELECT * FROM ${TABLE_SECURITY} WHERE member_id = $1 LIMIT 1`,
        [memberId]
      );
    });
    return result.rows[0] ?? null;
  }

  private async loadTermsSummary(memberId: number): Promise<MemberTermsSummaryItem[]> {
    const pool = this.mustPool();
    const result = await withRetry(async () => {
      return pool.query<MemberTermsDbRow>(
        `
        SELECT DISTINCT ON (document_type)
          document_type,
          document_version,
          accepted_at
        FROM ${TABLE_TERMS}
        WHERE member_id = $1
        ORDER BY document_type, accepted_at DESC
        `,
        [memberId]
      );
    });
    return mapTerms(result.rows);
  }

  private async loadVerificationRow(memberId: number): Promise<MemberVerificationDbRow | null> {
    const pool = this.mustPool();
    const result = await withRetry(async () => {
      return pool.query<MemberVerificationDbRow>(
        `
        SELECT
          status,
          provider,
          verification_level,
          provider_customer_id,
          provider_case_id,
          requirements,
          result_summary,
          submitted_at,
          decided_at,
          updated_at
        FROM ${TABLE_VERIFICATIONS}
        WHERE member_id = $1
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1
        `,
        [memberId]
      );
    });
    return result.rows[0] ?? null;
  }

  private async updateMemberResidency(
    memberId: number,
    patch: { residencyCountry?: string | null; settlementCurrency?: string | null }
  ): Promise<void> {
    const updates: string[] = [];
    const values: Array<string | number | null> = [memberId];

    if (patch.residencyCountry !== undefined) {
      values.push(patch.residencyCountry);
      updates.push(`residency_country = $${values.length}`);
    }

    if (patch.settlementCurrency !== undefined) {
      values.push(patch.settlementCurrency);
      updates.push(`settlement_currency = $${values.length}`);
    }

    if (updates.length === 0) {
      return;
    }

    const pool = this.mustPool();
    updates.push('updated_at = NOW()');
    await withRetry(async () => {
      await pool.query(
        `
        UPDATE ${TABLE_MEMBERS}
        SET ${updates.join(', ')}
        WHERE id = $1
        `,
        values
      );
    });
  }

  private async refreshDerivedState(memberId: number): Promise<void> {
    const pool = this.mustPool();
    const memberResult = await withRetry(async () => {
      return pool.query<MemberDbRow>(
        `SELECT * FROM ${TABLE_MEMBERS} WHERE id = $1 LIMIT 1`,
        [memberId]
      );
    });
    const memberRow = memberResult.rows[0];
    if (!memberRow) return;

    const member = mapMember(memberRow);
    const onboarding = mapOnboarding(await this.loadOnboardingRow(memberId));
    const privateProfileResult = await this.loadPrivateProfile(memberId, false);
    const terms = await this.loadTermsSummary(memberId);
    const nextState = deriveMemberState({
      member,
      onboarding,
      privateProfile: privateProfileResult.privateProfile,
      terms,
    });

    if (nextState.status === member.status && nextState.verificationStatus === member.verificationStatus) {
      return;
    }

    await withRetry(async () => {
      await pool.query(
        `
        UPDATE ${TABLE_MEMBERS}
        SET
          status = $2,
          verification_status = $3,
          updated_at = NOW()
        WHERE id = $1
        `,
        [memberId, nextState.status, nextState.verificationStatus]
      );
    });
  }

  private async ensureSchema(): Promise<void> {
    const pool = this.mustPool();
    await withRetry(async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_MEMBERS} (
          id BIGSERIAL PRIMARY KEY,
          auth_subject TEXT NOT NULL UNIQUE,
          primary_wallet TEXT NOT NULL UNIQUE,
          reown_profile_uuid TEXT,
          status TEXT NOT NULL DEFAULT 'ONBOARDING',
          verification_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
          membership_plan TEXT,
          membership_status TEXT NOT NULL DEFAULT 'NONE',
          residency_country TEXT,
          settlement_currency TEXT,
          membership_registry_member_id BIGINT,
          membership_chain_id INTEGER,
          membership_tx_hash TEXT,
          membership_synced_at TIMESTAMPTZ,
          membership_metadata_hash TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_authenticated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_PROFILE_PUBLIC} (
          member_id BIGINT PRIMARY KEY REFERENCES ${TABLE_MEMBERS}(id) ON DELETE CASCADE,
          username TEXT UNIQUE,
          display_name TEXT,
          bio TEXT,
          timezone TEXT,
          locale TEXT,
          avatar_url TEXT,
          notifications_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_PROFILE_PRIVATE} (
          member_id BIGINT PRIMARY KEY REFERENCES ${TABLE_MEMBERS}(id) ON DELETE CASCADE,
          payload_ciphertext BYTEA NOT NULL,
          payload_iv BYTEA NOT NULL,
          payload_auth_tag BYTEA NOT NULL,
          wrapped_data_key_ciphertext BYTEA NOT NULL,
          wrapped_data_key_iv BYTEA NOT NULL,
          wrapped_data_key_auth_tag BYTEA NOT NULL,
          key_version TEXT NOT NULL,
          email_hash TEXT,
          phone_hash TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_ONBOARDING} (
          member_id BIGINT PRIMARY KEY REFERENCES ${TABLE_MEMBERS}(id) ON DELETE CASCADE,
          current_step TEXT NOT NULL DEFAULT 'identity',
          access_track TEXT NOT NULL DEFAULT 'basic',
          account_method TEXT NOT NULL DEFAULT 'wallet',
          identity_mode_selected TEXT NOT NULL DEFAULT 'pseudonymous',
          referral_source TEXT,
          invite_code TEXT,
          income_source TEXT,
          reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
          goals_note TEXT,
          recovery_method TEXT,
          card_waitlist BOOLEAN NOT NULL DEFAULT FALSE,
          local_pools BOOLEAN NOT NULL DEFAULT FALSE,
          draft_status TEXT NOT NULL DEFAULT 'in_progress',
          submitted_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_TERMS} (
          id BIGSERIAL PRIMARY KEY,
          member_id BIGINT NOT NULL REFERENCES ${TABLE_MEMBERS}(id) ON DELETE CASCADE,
          document_type TEXT NOT NULL,
          document_version TEXT NOT NULL,
          accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          wallet_address TEXT NOT NULL,
          ip_hash TEXT,
          user_agent TEXT,
          UNIQUE(member_id, document_type, document_version)
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${TABLE_TERMS}_member_id
        ON ${TABLE_TERMS} (member_id)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_SECURITY} (
          member_id BIGINT PRIMARY KEY REFERENCES ${TABLE_MEMBERS}(id) ON DELETE CASCADE,
          signature_lock BOOLEAN NOT NULL DEFAULT TRUE,
          session_review BOOLEAN NOT NULL DEFAULT TRUE,
          biometric_access BOOLEAN NOT NULL DEFAULT TRUE,
          social_discovery BOOLEAN NOT NULL DEFAULT FALSE,
          transfer_alerts BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_VERIFICATIONS} (
          id BIGSERIAL PRIMARY KEY,
          member_id BIGINT NOT NULL REFERENCES ${TABLE_MEMBERS}(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          verification_level TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'NOT_STARTED',
          provider_customer_id TEXT,
          provider_case_id TEXT,
          requirements JSONB,
          result_summary JSONB,
          submitted_at TIMESTAMPTZ,
          decided_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(member_id, provider, verification_level)
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${TABLE_MEMBERS}_wallet
        ON ${TABLE_MEMBERS} (primary_wallet)
      `);
    });
  }
}

export const memberStore = new MemberStore();
