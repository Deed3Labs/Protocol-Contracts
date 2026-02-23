import type { Pool } from 'pg';
import { getPostgresPool } from '../config/postgres.js';
import {
  decryptSendContact,
  encryptSendContact,
  isSendEncryptionConfigured,
} from '../utils/sendEncryption.js';

export type RecipientType = 'email' | 'phone';
export type SendFundingSource = 'WALLET_USDC' | 'CARD_ONRAMP' | 'BANK_ONRAMP';
export type SendTransferStatus =
  | 'PREPARED'
  | 'LOCK_CONFIRMED'
  | 'CLAIM_STARTED'
  | 'CLAIMED_DEBIT'
  | 'CLAIMED_BANK'
  | 'CLAIMED_WALLET'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'FAILED';
export type SendClaimSessionStatus = 'OTP_SENT' | 'OTP_VERIFIED' | 'LOCKED' | 'COMPLETED' | 'EXPIRED';
export type SendPayoutMethod = 'DEBIT' | 'BANK' | 'WALLET';
export type SendPayoutAttemptStatus = 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'FALLBACK_REQUIRED';

export interface SendTransferRecord {
  id: number;
  transferId: string;
  senderWallet: string;
  recipientType: RecipientType;
  recipientContactEncrypted: string;
  recipientContactHash: string;
  recipientHintHash: string;
  principalUsdc: string;
  sponsorFeeUsdc: string;
  totalLockedUsdc: string;
  fundingSource: SendFundingSource;
  status: SendTransferStatus;
  region: string;
  chainId: number;
  escrowTxHash: string | null;
  claimTokenHash: string | null;
  memo: string | null;
  expiresAt: Date;
  claimedAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SendClaimSessionRecord {
  id: number;
  transferRowId: number;
  sessionTokenHash: string | null;
  otpHash: string;
  otpExpiresAt: Date;
  otpAttempts: number;
  maxAttempts: number;
  resendCount: number;
  lastOtpSentAt: Date;
  verifiedAt: Date | null;
  status: SendClaimSessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SendPayoutAttemptRecord {
  id: number;
  transferRowId: number;
  claimSessionId: number;
  method: SendPayoutMethod;
  provider: string;
  providerReference: string | null;
  status: SendPayoutAttemptStatus;
  failureCode: string | null;
  failureReason: string | null;
  walletTxHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SendClaimSessionWithTransfer {
  claimSession: SendClaimSessionRecord;
  transfer: SendTransferRecord;
}

export interface CreateSendTransferInput {
  transferId: string;
  senderWallet: string;
  recipientType: RecipientType;
  recipientContact: string;
  recipientContactHash: string;
  recipientHintHash: string;
  principalUsdc: string;
  sponsorFeeUsdc: string;
  totalLockedUsdc: string;
  fundingSource: SendFundingSource;
  status: SendTransferStatus;
  region: string;
  chainId: number;
  expiresAt: Date;
  memo?: string | null;
}

export interface CreateClaimSessionInput {
  transferRowId: number;
  sessionTokenHash: string | null;
  otpHash: string;
  otpExpiresAt: Date;
  maxAttempts: number;
  status: SendClaimSessionStatus;
}

export interface CreatePayoutAttemptInput {
  transferRowId: number;
  claimSessionId: number;
  method: SendPayoutMethod;
  provider: string;
  providerReference?: string | null;
  status: SendPayoutAttemptStatus;
  failureCode?: string | null;
  failureReason?: string | null;
  walletTxHash?: string | null;
}

export interface CreateNotificationInput {
  transferRowId: number;
  channel: 'email' | 'sms';
  destinationHash: string;
  provider: string;
  providerMessageId: string;
  status: string;
}

type SendTransferDbRow = {
  id: string | number;
  transfer_id: string;
  sender_wallet: string;
  recipient_type: RecipientType;
  recipient_contact_encrypted: string;
  recipient_contact_hash: string;
  recipient_hint_hash: string;
  principal_usdc: string;
  sponsor_fee_usdc: string;
  total_locked_usdc: string;
  funding_source: SendFundingSource;
  status: SendTransferStatus;
  region: string;
  chain_id: number;
  escrow_tx_hash: string | null;
  claim_token_hash: string | null;
  memo: string | null;
  expires_at: Date | string;
  claimed_at: Date | string | null;
  refunded_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type SendClaimSessionDbRow = {
  id: string | number;
  transfer_row_id: string | number;
  session_token_hash: string | null;
  otp_hash: string;
  otp_expires_at: Date | string;
  otp_attempts: number;
  max_attempts: number;
  resend_count: number;
  last_otp_sent_at: Date | string;
  verified_at: Date | string | null;
  status: SendClaimSessionStatus;
  created_at: Date | string;
  updated_at: Date | string;
};

type SendPayoutAttemptDbRow = {
  id: string | number;
  transfer_row_id: string | number;
  claim_session_id: string | number;
  method: SendPayoutMethod;
  provider: string;
  provider_reference: string | null;
  status: SendPayoutAttemptStatus;
  failure_code: string | null;
  failure_reason: string | null;
  wallet_tx_hash: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ClaimSessionJoinDbRow = {
  cs_id: string | number;
  cs_transfer_row_id: string | number;
  cs_session_token_hash: string | null;
  cs_otp_hash: string;
  cs_otp_expires_at: Date | string;
  cs_otp_attempts: number;
  cs_max_attempts: number;
  cs_resend_count: number;
  cs_last_otp_sent_at: Date | string;
  cs_verified_at: Date | string | null;
  cs_status: SendClaimSessionStatus;
  cs_created_at: Date | string;
  cs_updated_at: Date | string;
  st_id: string | number;
  st_transfer_id: string;
  st_sender_wallet: string;
  st_recipient_type: RecipientType;
  st_recipient_contact_encrypted: string;
  st_recipient_contact_hash: string;
  st_recipient_hint_hash: string;
  st_principal_usdc: string;
  st_sponsor_fee_usdc: string;
  st_total_locked_usdc: string;
  st_funding_source: SendFundingSource;
  st_status: SendTransferStatus;
  st_region: string;
  st_chain_id: number;
  st_escrow_tx_hash: string | null;
  st_claim_token_hash: string | null;
  st_memo: string | null;
  st_expires_at: Date | string;
  st_claimed_at: Date | string | null;
  st_refunded_at: Date | string | null;
  st_created_at: Date | string;
  st_updated_at: Date | string;
};

const TABLE_SEND_TRANSFERS = 'send_transfers';
const TABLE_SEND_CLAIM_SESSIONS = 'send_claim_sessions';
const TABLE_SEND_PAYOUT_ATTEMPTS = 'send_payout_attempts';
const TABLE_SEND_NOTIFICATIONS = 'send_notifications';
const DEFAULT_MAX_ATTEMPTS = 3;

function normalizeWalletAddress(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

function parseNumericId(value: string | number): number {
  return typeof value === 'number' ? value : parseInt(value, 10);
}

function parseDate(value: Date | string | null): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

function encryptionContext(senderWallet: string, recipientContactHash: string): string {
  return `${senderWallet}:${recipientContactHash}`;
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

class SendTransferStore {
  private schemaReadyPromise: Promise<void> | null = null;

  isConfigured(): boolean {
    return Boolean(getPostgresPool()) && isSendEncryptionConfigured();
  }

  async ensureReady(): Promise<void> {
    if (!getPostgresPool()) {
      throw new Error('Postgres is not configured. Set DATABASE_URL for send transfer persistence.');
    }
    if (!isSendEncryptionConfigured()) {
      throw new Error('Send transfer encryption is not configured. Set SEND_CONTACT_ENCRYPTION_KEY.');
    }

    if (!this.schemaReadyPromise) {
      this.schemaReadyPromise = this.ensureSchema();
    }

    return this.schemaReadyPromise;
  }

  async createTransfer(input: CreateSendTransferInput): Promise<SendTransferRecord> {
    await this.ensureReady();
    const pool = this.mustPool();

    const normalizedWallet = normalizeWalletAddress(input.senderWallet);
    const context = encryptionContext(normalizedWallet, input.recipientContactHash);
    const encryptedContact = encryptSendContact(input.recipientContact, context);

    const result = await withRetry(async () => {
      return pool.query<SendTransferDbRow>(
        `
        INSERT INTO ${TABLE_SEND_TRANSFERS} (
          transfer_id,
          sender_wallet,
          recipient_type,
          recipient_contact_encrypted,
          recipient_contact_hash,
          recipient_hint_hash,
          principal_usdc,
          sponsor_fee_usdc,
          total_locked_usdc,
          funding_source,
          status,
          region,
          chain_id,
          expires_at,
          memo
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING *
        `,
        [
          input.transferId,
          normalizedWallet,
          input.recipientType,
          encryptedContact,
          input.recipientContactHash,
          input.recipientHintHash,
          input.principalUsdc,
          input.sponsorFeeUsdc,
          input.totalLockedUsdc,
          input.fundingSource,
          input.status,
          input.region,
          input.chainId,
          input.expiresAt,
          input.memo ?? null,
        ]
      );
    });

    return this.mapTransferRow(result.rows[0]);
  }

  async confirmTransferLockAndSetClaimToken(params: {
    id: number;
    senderWallet: string;
    transferId: string;
    escrowTxHash: string;
    claimTokenHash: string;
  }): Promise<SendTransferRecord | null> {
    await this.ensureReady();
    const pool = this.mustPool();

    const result = await withRetry(async () => {
      return pool.query<SendTransferDbRow>(
        `
        UPDATE ${TABLE_SEND_TRANSFERS}
        SET
          escrow_tx_hash = $1,
          claim_token_hash = $2,
          status = 'LOCK_CONFIRMED',
          updated_at = NOW()
        WHERE id = $3
          AND sender_wallet = $4
          AND transfer_id = $5
          AND status = 'PREPARED'
        RETURNING *
        `,
        [params.escrowTxHash, params.claimTokenHash, params.id, normalizeWalletAddress(params.senderWallet), params.transferId]
      );
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapTransferRow(result.rows[0]);
  }

  async rotateClaimTokenHash(transferRowId: number, claimTokenHash: string): Promise<void> {
    await this.ensureReady();
    const pool = this.mustPool();

    await withRetry(async () => {
      await pool.query(
        `
        UPDATE ${TABLE_SEND_TRANSFERS}
        SET claim_token_hash = $1, updated_at = NOW()
        WHERE id = $2
        `,
        [claimTokenHash, transferRowId]
      );
    });
  }

  async listSenderTransfers(senderWallet: string, limit: number = 50): Promise<SendTransferRecord[]> {
    await this.ensureReady();
    const pool = this.mustPool();

    const normalizedWallet = normalizeWalletAddress(senderWallet);
    const boundedLimit = Math.max(1, Math.min(limit, 100));

    const result = await withRetry(async () => {
      return pool.query<SendTransferDbRow>(
        `
        SELECT *
        FROM ${TABLE_SEND_TRANSFERS}
        WHERE sender_wallet = $1
        ORDER BY created_at DESC
        LIMIT $2
        `,
        [normalizedWallet, boundedLimit]
      );
    });

    return result.rows.map((row) => this.mapTransferRow(row));
  }

  async getSenderTransferById(id: number, senderWallet: string): Promise<SendTransferRecord | null> {
    await this.ensureReady();
    const pool = this.mustPool();

    const result = await withRetry(async () => {
      return pool.query<SendTransferDbRow>(
        `
        SELECT *
        FROM ${TABLE_SEND_TRANSFERS}
        WHERE id = $1 AND sender_wallet = $2
        LIMIT 1
        `,
        [id, normalizeWalletAddress(senderWallet)]
      );
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapTransferRow(result.rows[0]);
  }

  async getTransferByClaimTokenHash(claimTokenHash: string): Promise<SendTransferRecord | null> {
    await this.ensureReady();
    const pool = this.mustPool();

    const result = await withRetry(async () => {
      return pool.query<SendTransferDbRow>(
        `
        SELECT *
        FROM ${TABLE_SEND_TRANSFERS}
        WHERE claim_token_hash = $1
        LIMIT 1
        `,
        [claimTokenHash]
      );
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapTransferRow(result.rows[0]);
  }

  async updateTransferStatus(transferRowId: number, status: SendTransferStatus): Promise<void> {
    await this.ensureReady();
    const pool = this.mustPool();

    await withRetry(async () => {
      await pool.query(
        `
        UPDATE ${TABLE_SEND_TRANSFERS}
        SET status = $1, updated_at = NOW()
        WHERE id = $2
        `,
        [status, transferRowId]
      );
    });
  }

  async markTransferClaimed(transferRowId: number, status: Extract<SendTransferStatus, 'CLAIMED_DEBIT' | 'CLAIMED_BANK' | 'CLAIMED_WALLET'>): Promise<void> {
    await this.ensureReady();
    const pool = this.mustPool();

    await withRetry(async () => {
      await pool.query(
        `
        UPDATE ${TABLE_SEND_TRANSFERS}
        SET status = $1, claimed_at = NOW(), updated_at = NOW()
        WHERE id = $2
        `,
        [status, transferRowId]
      );
    });
  }

  async getSenderPrincipalTotalInWindow(senderWallet: string, windowStart: Date, windowEnd: Date): Promise<bigint> {
    await this.ensureReady();
    const pool = this.mustPool();

    const result = await withRetry(async () => {
      return pool.query<{ total: string }>(
        `
        SELECT COALESCE(SUM(principal_usdc), 0)::text AS total
        FROM ${TABLE_SEND_TRANSFERS}
        WHERE sender_wallet = $1
          AND created_at >= $2
          AND created_at < $3
          AND status <> 'FAILED'
        `,
        [normalizeWalletAddress(senderWallet), windowStart, windowEnd]
      );
    });

    return BigInt(result.rows[0]?.total || '0');
  }

  async createClaimSession(input: CreateClaimSessionInput): Promise<SendClaimSessionRecord> {
    await this.ensureReady();
    const pool = this.mustPool();

    const result = await withRetry(async () => {
      return pool.query<SendClaimSessionDbRow>(
        `
        INSERT INTO ${TABLE_SEND_CLAIM_SESSIONS} (
          transfer_row_id,
          session_token_hash,
          otp_hash,
          otp_expires_at,
          otp_attempts,
          max_attempts,
          resend_count,
          last_otp_sent_at,
          status
        ) VALUES ($1,$2,$3,$4,0,$5,0,NOW(),$6)
        RETURNING *
        `,
        [
          input.transferRowId,
          input.sessionTokenHash,
          input.otpHash,
          input.otpExpiresAt,
          input.maxAttempts,
          input.status,
        ]
      );
    });

    return this.mapClaimSessionRow(result.rows[0]);
  }

  async getClaimSessionWithTransferById(claimSessionId: number): Promise<SendClaimSessionWithTransfer | null> {
    await this.ensureReady();
    const pool = this.mustPool();

    const result = await withRetry(async () => {
      return pool.query<ClaimSessionJoinDbRow>(
        this.claimSessionJoinSql() + ' WHERE cs.id = $1 LIMIT 1',
        [claimSessionId]
      );
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapClaimSessionJoinRow(result.rows[0]);
  }

  async getClaimSessionWithTransferBySessionTokenHash(sessionTokenHash: string): Promise<SendClaimSessionWithTransfer | null> {
    await this.ensureReady();
    const pool = this.mustPool();

    const result = await withRetry(async () => {
      return pool.query<ClaimSessionJoinDbRow>(
        this.claimSessionJoinSql() + ' WHERE cs.session_token_hash = $1 LIMIT 1',
        [sessionTokenHash]
      );
    });

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapClaimSessionJoinRow(result.rows[0]);
  }

  async markClaimSessionOtpAttempt(claimSessionId: number, otpAttempts: number, status: SendClaimSessionStatus): Promise<void> {
    await this.ensureReady();
    const pool = this.mustPool();

    await withRetry(async () => {
      await pool.query(
        `
        UPDATE ${TABLE_SEND_CLAIM_SESSIONS}
        SET otp_attempts = $1, status = $2, updated_at = NOW()
        WHERE id = $3
        `,
        [otpAttempts, status, claimSessionId]
      );
    });
  }

  async verifyClaimSession(claimSessionId: number, sessionTokenHash: string): Promise<void> {
    await this.ensureReady();
    const pool = this.mustPool();

    await withRetry(async () => {
      await pool.query(
        `
        UPDATE ${TABLE_SEND_CLAIM_SESSIONS}
        SET
          session_token_hash = $1,
          verified_at = NOW(),
          status = 'OTP_VERIFIED',
          updated_at = NOW()
        WHERE id = $2
        `,
        [sessionTokenHash, claimSessionId]
      );
    });
  }

  async refreshClaimSessionOtp(params: {
    claimSessionId: number;
    otpHash: string;
    otpExpiresAt: Date;
    resendCount: number;
  }): Promise<void> {
    await this.ensureReady();
    const pool = this.mustPool();

    await withRetry(async () => {
      await pool.query(
        `
        UPDATE ${TABLE_SEND_CLAIM_SESSIONS}
        SET
          otp_hash = $1,
          otp_expires_at = $2,
          otp_attempts = 0,
          resend_count = $3,
          last_otp_sent_at = NOW(),
          status = 'OTP_SENT',
          updated_at = NOW()
        WHERE id = $4
        `,
        [params.otpHash, params.otpExpiresAt, params.resendCount, params.claimSessionId]
      );
    });
  }

  async markClaimSessionCompleted(claimSessionId: number): Promise<void> {
    await this.ensureReady();
    const pool = this.mustPool();

    await withRetry(async () => {
      await pool.query(
        `
        UPDATE ${TABLE_SEND_CLAIM_SESSIONS}
        SET status = 'COMPLETED', updated_at = NOW()
        WHERE id = $1
        `,
        [claimSessionId]
      );
    });
  }

  async createPayoutAttempt(input: CreatePayoutAttemptInput): Promise<SendPayoutAttemptRecord> {
    await this.ensureReady();
    const pool = this.mustPool();

    const result = await withRetry(async () => {
      return pool.query<SendPayoutAttemptDbRow>(
        `
        INSERT INTO ${TABLE_SEND_PAYOUT_ATTEMPTS} (
          transfer_row_id,
          claim_session_id,
          method,
          provider,
          provider_reference,
          status,
          failure_code,
          failure_reason,
          wallet_tx_hash
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *
        `,
        [
          input.transferRowId,
          input.claimSessionId,
          input.method,
          input.provider,
          input.providerReference ?? null,
          input.status,
          input.failureCode ?? null,
          input.failureReason ?? null,
          input.walletTxHash ?? null,
        ]
      );
    });

    return this.mapPayoutAttemptRow(result.rows[0]);
  }

  async updatePayoutAttempt(
    payoutAttemptId: number,
    input: {
      status: SendPayoutAttemptStatus;
      providerReference?: string | null;
      failureCode?: string | null;
      failureReason?: string | null;
      walletTxHash?: string | null;
    }
  ): Promise<void> {
    await this.ensureReady();
    const pool = this.mustPool();

    await withRetry(async () => {
      await pool.query(
        `
        UPDATE ${TABLE_SEND_PAYOUT_ATTEMPTS}
        SET
          status = $1,
          provider_reference = COALESCE($2, provider_reference),
          failure_code = $3,
          failure_reason = $4,
          wallet_tx_hash = COALESCE($5, wallet_tx_hash),
          updated_at = NOW()
        WHERE id = $6
        `,
        [
          input.status,
          input.providerReference ?? null,
          input.failureCode ?? null,
          input.failureReason ?? null,
          input.walletTxHash ?? null,
          payoutAttemptId,
        ]
      );
    });
  }

  async createNotification(input: CreateNotificationInput): Promise<void> {
    await this.ensureReady();
    const pool = this.mustPool();

    await withRetry(async () => {
      await pool.query(
        `
        INSERT INTO ${TABLE_SEND_NOTIFICATIONS} (
          transfer_row_id,
          channel,
          destination_hash,
          provider,
          provider_message_id,
          status
        ) VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          input.transferRowId,
          input.channel,
          input.destinationHash,
          input.provider,
          input.providerMessageId,
          input.status,
        ]
      );
    });
  }

  decryptRecipientContact(record: SendTransferRecord): string {
    const context = encryptionContext(record.senderWallet, record.recipientContactHash);
    return decryptSendContact(record.recipientContactEncrypted, context);
  }

  private claimSessionJoinSql(): string {
    return `
      SELECT
        cs.id AS cs_id,
        cs.transfer_row_id AS cs_transfer_row_id,
        cs.session_token_hash AS cs_session_token_hash,
        cs.otp_hash AS cs_otp_hash,
        cs.otp_expires_at AS cs_otp_expires_at,
        cs.otp_attempts AS cs_otp_attempts,
        cs.max_attempts AS cs_max_attempts,
        cs.resend_count AS cs_resend_count,
        cs.last_otp_sent_at AS cs_last_otp_sent_at,
        cs.verified_at AS cs_verified_at,
        cs.status AS cs_status,
        cs.created_at AS cs_created_at,
        cs.updated_at AS cs_updated_at,
        st.id AS st_id,
        st.transfer_id AS st_transfer_id,
        st.sender_wallet AS st_sender_wallet,
        st.recipient_type AS st_recipient_type,
        st.recipient_contact_encrypted AS st_recipient_contact_encrypted,
        st.recipient_contact_hash AS st_recipient_contact_hash,
        st.recipient_hint_hash AS st_recipient_hint_hash,
        st.principal_usdc AS st_principal_usdc,
        st.sponsor_fee_usdc AS st_sponsor_fee_usdc,
        st.total_locked_usdc AS st_total_locked_usdc,
        st.funding_source AS st_funding_source,
        st.status AS st_status,
        st.region AS st_region,
        st.chain_id AS st_chain_id,
        st.escrow_tx_hash AS st_escrow_tx_hash,
        st.claim_token_hash AS st_claim_token_hash,
        st.memo AS st_memo,
        st.expires_at AS st_expires_at,
        st.claimed_at AS st_claimed_at,
        st.refunded_at AS st_refunded_at,
        st.created_at AS st_created_at,
        st.updated_at AS st_updated_at
      FROM ${TABLE_SEND_CLAIM_SESSIONS} cs
      INNER JOIN ${TABLE_SEND_TRANSFERS} st ON st.id = cs.transfer_row_id
    `;
  }

  private mapTransferRow(row: SendTransferDbRow): SendTransferRecord {
    return {
      id: parseNumericId(row.id),
      transferId: row.transfer_id,
      senderWallet: row.sender_wallet,
      recipientType: row.recipient_type,
      recipientContactEncrypted: row.recipient_contact_encrypted,
      recipientContactHash: row.recipient_contact_hash,
      recipientHintHash: row.recipient_hint_hash,
      principalUsdc: row.principal_usdc,
      sponsorFeeUsdc: row.sponsor_fee_usdc,
      totalLockedUsdc: row.total_locked_usdc,
      fundingSource: row.funding_source,
      status: row.status,
      region: row.region,
      chainId: row.chain_id,
      escrowTxHash: row.escrow_tx_hash,
      claimTokenHash: row.claim_token_hash,
      memo: row.memo,
      expiresAt: parseDate(row.expires_at) ?? new Date(0),
      claimedAt: parseDate(row.claimed_at),
      refundedAt: parseDate(row.refunded_at),
      createdAt: parseDate(row.created_at) ?? new Date(0),
      updatedAt: parseDate(row.updated_at) ?? new Date(0),
    };
  }

  private mapClaimSessionRow(row: SendClaimSessionDbRow): SendClaimSessionRecord {
    return {
      id: parseNumericId(row.id),
      transferRowId: parseNumericId(row.transfer_row_id),
      sessionTokenHash: row.session_token_hash,
      otpHash: row.otp_hash,
      otpExpiresAt: parseDate(row.otp_expires_at) ?? new Date(0),
      otpAttempts: row.otp_attempts,
      maxAttempts: row.max_attempts,
      resendCount: row.resend_count,
      lastOtpSentAt: parseDate(row.last_otp_sent_at) ?? new Date(0),
      verifiedAt: parseDate(row.verified_at),
      status: row.status,
      createdAt: parseDate(row.created_at) ?? new Date(0),
      updatedAt: parseDate(row.updated_at) ?? new Date(0),
    };
  }

  private mapPayoutAttemptRow(row: SendPayoutAttemptDbRow): SendPayoutAttemptRecord {
    return {
      id: parseNumericId(row.id),
      transferRowId: parseNumericId(row.transfer_row_id),
      claimSessionId: parseNumericId(row.claim_session_id),
      method: row.method,
      provider: row.provider,
      providerReference: row.provider_reference,
      status: row.status,
      failureCode: row.failure_code,
      failureReason: row.failure_reason,
      walletTxHash: row.wallet_tx_hash,
      createdAt: parseDate(row.created_at) ?? new Date(0),
      updatedAt: parseDate(row.updated_at) ?? new Date(0),
    };
  }

  private mapClaimSessionJoinRow(row: ClaimSessionJoinDbRow): SendClaimSessionWithTransfer {
    const claimSession: SendClaimSessionRecord = {
      id: parseNumericId(row.cs_id),
      transferRowId: parseNumericId(row.cs_transfer_row_id),
      sessionTokenHash: row.cs_session_token_hash,
      otpHash: row.cs_otp_hash,
      otpExpiresAt: parseDate(row.cs_otp_expires_at) ?? new Date(0),
      otpAttempts: row.cs_otp_attempts,
      maxAttempts: row.cs_max_attempts,
      resendCount: row.cs_resend_count,
      lastOtpSentAt: parseDate(row.cs_last_otp_sent_at) ?? new Date(0),
      verifiedAt: parseDate(row.cs_verified_at),
      status: row.cs_status,
      createdAt: parseDate(row.cs_created_at) ?? new Date(0),
      updatedAt: parseDate(row.cs_updated_at) ?? new Date(0),
    };

    const transfer: SendTransferRecord = {
      id: parseNumericId(row.st_id),
      transferId: row.st_transfer_id,
      senderWallet: row.st_sender_wallet,
      recipientType: row.st_recipient_type,
      recipientContactEncrypted: row.st_recipient_contact_encrypted,
      recipientContactHash: row.st_recipient_contact_hash,
      recipientHintHash: row.st_recipient_hint_hash,
      principalUsdc: row.st_principal_usdc,
      sponsorFeeUsdc: row.st_sponsor_fee_usdc,
      totalLockedUsdc: row.st_total_locked_usdc,
      fundingSource: row.st_funding_source,
      status: row.st_status,
      region: row.st_region,
      chainId: row.st_chain_id,
      escrowTxHash: row.st_escrow_tx_hash,
      claimTokenHash: row.st_claim_token_hash,
      memo: row.st_memo,
      expiresAt: parseDate(row.st_expires_at) ?? new Date(0),
      claimedAt: parseDate(row.st_claimed_at),
      refundedAt: parseDate(row.st_refunded_at),
      createdAt: parseDate(row.st_created_at) ?? new Date(0),
      updatedAt: parseDate(row.st_updated_at) ?? new Date(0),
    };

    return { claimSession, transfer };
  }

  private mustPool(): Pool {
    const pool = getPostgresPool();
    if (!pool) {
      throw new Error('Postgres pool is unavailable');
    }
    return pool;
  }

  private async ensureSchema(): Promise<void> {
    const pool = this.mustPool();
    await withRetry(async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_SEND_TRANSFERS} (
          id BIGSERIAL PRIMARY KEY,
          transfer_id TEXT NOT NULL UNIQUE,
          sender_wallet TEXT NOT NULL,
          recipient_type TEXT NOT NULL,
          recipient_contact_encrypted TEXT NOT NULL,
          recipient_contact_hash TEXT NOT NULL,
          recipient_hint_hash TEXT NOT NULL,
          principal_usdc NUMERIC(38,0) NOT NULL,
          sponsor_fee_usdc NUMERIC(38,0) NOT NULL,
          total_locked_usdc NUMERIC(38,0) NOT NULL,
          funding_source TEXT NOT NULL,
          status TEXT NOT NULL,
          region TEXT NOT NULL DEFAULT 'US',
          chain_id INTEGER NOT NULL,
          escrow_tx_hash TEXT,
          claim_token_hash TEXT UNIQUE,
          memo TEXT,
          expires_at TIMESTAMPTZ NOT NULL,
          claimed_at TIMESTAMPTZ,
          refunded_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${TABLE_SEND_TRANSFERS}_sender_wallet
        ON ${TABLE_SEND_TRANSFERS} (sender_wallet)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${TABLE_SEND_TRANSFERS}_recipient_contact_hash
        ON ${TABLE_SEND_TRANSFERS} (recipient_contact_hash)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${TABLE_SEND_TRANSFERS}_status_expires
        ON ${TABLE_SEND_TRANSFERS} (status, expires_at)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_SEND_CLAIM_SESSIONS} (
          id BIGSERIAL PRIMARY KEY,
          transfer_row_id BIGINT NOT NULL REFERENCES ${TABLE_SEND_TRANSFERS}(id) ON DELETE CASCADE,
          session_token_hash TEXT UNIQUE,
          otp_hash TEXT NOT NULL,
          otp_expires_at TIMESTAMPTZ NOT NULL,
          otp_attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL,
          resend_count INTEGER NOT NULL DEFAULT 0,
          last_otp_sent_at TIMESTAMPTZ NOT NULL,
          verified_at TIMESTAMPTZ,
          status TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${TABLE_SEND_CLAIM_SESSIONS}_transfer_row_id
        ON ${TABLE_SEND_CLAIM_SESSIONS} (transfer_row_id)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_SEND_PAYOUT_ATTEMPTS} (
          id BIGSERIAL PRIMARY KEY,
          transfer_row_id BIGINT NOT NULL REFERENCES ${TABLE_SEND_TRANSFERS}(id) ON DELETE CASCADE,
          claim_session_id BIGINT NOT NULL REFERENCES ${TABLE_SEND_CLAIM_SESSIONS}(id) ON DELETE CASCADE,
          method TEXT NOT NULL,
          provider TEXT NOT NULL,
          provider_reference TEXT,
          status TEXT NOT NULL,
          failure_code TEXT,
          failure_reason TEXT,
          wallet_tx_hash TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${TABLE_SEND_PAYOUT_ATTEMPTS}_transfer_row_id
        ON ${TABLE_SEND_PAYOUT_ATTEMPTS} (transfer_row_id)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_SEND_NOTIFICATIONS} (
          id BIGSERIAL PRIMARY KEY,
          transfer_row_id BIGINT NOT NULL REFERENCES ${TABLE_SEND_TRANSFERS}(id) ON DELETE CASCADE,
          channel TEXT NOT NULL,
          destination_hash TEXT NOT NULL,
          provider TEXT NOT NULL,
          provider_message_id TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${TABLE_SEND_NOTIFICATIONS}_transfer_row_id
        ON ${TABLE_SEND_NOTIFICATIONS} (transfer_row_id)
      `);
    });
  }
}

export const sendTransferStore = new SendTransferStore();
