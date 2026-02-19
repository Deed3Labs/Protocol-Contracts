import type { Pool } from 'pg';
import { getPostgresPool } from '../config/postgres.js';
import {
  decryptWithEnvelope,
  encryptWithEnvelope,
  isEnvelopeEncryptionConfigured,
} from '../utils/envelopeEncryption.js';

export interface PlaidStoredItem {
  access_token: string;
  item_id: string;
}

type PlaidTokenRow = {
  item_id: string;
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_auth_tag: Buffer;
  wrapped_data_key_ciphertext: Buffer;
  wrapped_data_key_iv: Buffer;
  wrapped_data_key_auth_tag: Buffer;
  key_version: string;
};

const DEFAULT_MAX_ATTEMPTS = 3;

function resolveTableName(): string {
  const configured = (process.env.PLAID_TOKEN_STORE_TABLE || 'plaid_linked_items').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(configured)) {
    throw new Error('PLAID_TOKEN_STORE_TABLE must be a valid SQL identifier');
  }
  return configured;
}

const TABLE_NAME = resolveTableName();

function normalizeWalletAddress(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

function normalizeItemId(itemId: string): string {
  return itemId.trim();
}

function encryptionContext(walletAddress: string, itemId: string): string {
  return `${walletAddress}:${itemId}`;
}

function isRetryablePostgresError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (!code) return false;

  return [
    '40001', // serialization_failure
    '40P01', // deadlock_detected
    '55P03', // lock_not_available
    '53300', // too_many_connections
    '57P03', // cannot_connect_now
    '08000', // connection_exception
    '08001', // sqlclient_unable_to_establish_sqlconnection
    '08003', // connection_does_not_exist
    '08006', // connection_failure
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

export class PlaidTokenStore {
  private schemaReadyPromise: Promise<void> | null = null;

  isConfigured(): boolean {
    return Boolean(getPostgresPool()) && isEnvelopeEncryptionConfigured();
  }

  async ensureReady(): Promise<void> {
    if (!getPostgresPool()) {
      throw new Error('Postgres is not configured. Set DATABASE_URL for Plaid token persistence.');
    }
    if (!isEnvelopeEncryptionConfigured()) {
      throw new Error('Plaid token encryption is not configured. Set PLAID_TOKEN_MASTER_KEY or PLAID_TOKEN_KEYRING_JSON.');
    }

    if (!this.schemaReadyPromise) {
      this.schemaReadyPromise = this.ensureSchema();
    }

    return this.schemaReadyPromise;
  }

  async getItems(walletAddress: string): Promise<PlaidStoredItem[]> {
    await this.ensureReady();
    const pool = this.mustPool();
    const wallet = normalizeWalletAddress(walletAddress);

    const rows = await withRetry(async () => {
      const result = await pool.query<PlaidTokenRow>(
        `
        SELECT
          item_id,
          access_token_ciphertext,
          access_token_iv,
          access_token_auth_tag,
          wrapped_data_key_ciphertext,
          wrapped_data_key_iv,
          wrapped_data_key_auth_tag,
          key_version
        FROM ${TABLE_NAME}
        WHERE wallet_address = $1
        ORDER BY created_at ASC
        `,
        [wallet]
      );
      return result.rows;
    });

    const items: PlaidStoredItem[] = [];
    for (const row of rows) {
      try {
        const itemId = normalizeItemId(row.item_id);
        const accessToken = decryptWithEnvelope(
          {
            ciphertext: row.access_token_ciphertext,
            iv: row.access_token_iv,
            authTag: row.access_token_auth_tag,
            wrappedKeyCiphertext: row.wrapped_data_key_ciphertext,
            wrappedKeyIv: row.wrapped_data_key_iv,
            wrappedKeyAuthTag: row.wrapped_data_key_auth_tag,
            keyVersion: row.key_version,
          },
          encryptionContext(wallet, itemId)
        );
        items.push({ item_id: itemId, access_token: accessToken });
      } catch (error) {
        console.error('Failed to decrypt Plaid token row:', {
          walletAddress: wallet,
          itemId: row.item_id,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return items;
  }

  async countItems(walletAddress: string): Promise<number> {
    await this.ensureReady();
    const pool = this.mustPool();
    const wallet = normalizeWalletAddress(walletAddress);

    return withRetry(async () => {
      const result = await pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM ${TABLE_NAME} WHERE wallet_address = $1`,
        [wallet]
      );
      return parseInt(result.rows[0]?.total || '0', 10) || 0;
    });
  }

  async upsertItem(walletAddress: string, itemId: string, accessToken: string): Promise<void> {
    await this.ensureReady();
    const pool = this.mustPool();

    const wallet = normalizeWalletAddress(walletAddress);
    const normalizedItemId = normalizeItemId(itemId);
    const encrypted = encryptWithEnvelope(accessToken, encryptionContext(wallet, normalizedItemId));

    await withRetry(async () => {
      await pool.query(
        `
        INSERT INTO ${TABLE_NAME} (
          wallet_address,
          item_id,
          access_token_ciphertext,
          access_token_iv,
          access_token_auth_tag,
          wrapped_data_key_ciphertext,
          wrapped_data_key_iv,
          wrapped_data_key_auth_tag,
          key_version
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (wallet_address, item_id)
        DO UPDATE SET
          access_token_ciphertext = EXCLUDED.access_token_ciphertext,
          access_token_iv = EXCLUDED.access_token_iv,
          access_token_auth_tag = EXCLUDED.access_token_auth_tag,
          wrapped_data_key_ciphertext = EXCLUDED.wrapped_data_key_ciphertext,
          wrapped_data_key_iv = EXCLUDED.wrapped_data_key_iv,
          wrapped_data_key_auth_tag = EXCLUDED.wrapped_data_key_auth_tag,
          key_version = EXCLUDED.key_version,
          updated_at = NOW()
        `,
        [
          wallet,
          normalizedItemId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          encrypted.wrappedKeyCiphertext,
          encrypted.wrappedKeyIv,
          encrypted.wrappedKeyAuthTag,
          encrypted.keyVersion,
        ]
      );
    });
  }

  async deleteItem(walletAddress: string, itemId: string): Promise<void> {
    await this.ensureReady();
    const pool = this.mustPool();
    const wallet = normalizeWalletAddress(walletAddress);
    const normalizedItemId = normalizeItemId(itemId);

    await withRetry(async () => {
      await pool.query(
        `DELETE FROM ${TABLE_NAME} WHERE wallet_address = $1 AND item_id = $2`,
        [wallet, normalizedItemId]
      );
    });
  }

  async deleteAllItems(walletAddress: string): Promise<void> {
    await this.ensureReady();
    const pool = this.mustPool();
    const wallet = normalizeWalletAddress(walletAddress);

    await withRetry(async () => {
      await pool.query(`DELETE FROM ${TABLE_NAME} WHERE wallet_address = $1`, [wallet]);
    });
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
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          wallet_address TEXT NOT NULL,
          item_id TEXT NOT NULL,
          access_token_ciphertext BYTEA NOT NULL,
          access_token_iv BYTEA NOT NULL,
          access_token_auth_tag BYTEA NOT NULL,
          wrapped_data_key_ciphertext BYTEA NOT NULL,
          wrapped_data_key_iv BYTEA NOT NULL,
          wrapped_data_key_auth_tag BYTEA NOT NULL,
          key_version TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (wallet_address, item_id)
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_wallet
        ON ${TABLE_NAME} (wallet_address)
      `);
    });
  }
}

export const plaidTokenStore = new PlaidTokenStore();
