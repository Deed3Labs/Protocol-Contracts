import crypto from 'crypto';

const DEFAULT_ACTIVE_KEY_VERSION = 'v1';

type Keyring = {
  activeVersion: string;
  keys: Map<string, Buffer>;
};

export type EncryptedPayload = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedKeyCiphertext: Buffer;
  wrappedKeyIv: Buffer;
  wrappedKeyAuthTag: Buffer;
  keyVersion: string;
};

let cachedKeyring: Keyring | null = null;

function decodeKeyMaterial(rawValue: string): Buffer {
  const value = rawValue.trim();
  if (!value) {
    throw new Error('empty key material');
  }

  if (value.startsWith('base64:')) {
    return Buffer.from(value.slice('base64:'.length), 'base64');
  }

  if (value.startsWith('hex:')) {
    return Buffer.from(value.slice('hex:'.length), 'hex');
  }

  if (/^[a-fA-F0-9]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }

  return Buffer.from(value, 'base64');
}

function assertAes256Key(key: Buffer, keyVersion: string): void {
  if (key.length !== 32) {
    throw new Error(`key version ${keyVersion} must be 32 bytes (AES-256)`);
  }
}

function parseKeyringFromEnv(): Keyring {
  const rawKeyring = process.env.PLAID_TOKEN_KEYRING_JSON || '';
  const activeVersion = (process.env.PLAID_TOKEN_ACTIVE_KEY_VERSION || DEFAULT_ACTIVE_KEY_VERSION).trim() || DEFAULT_ACTIVE_KEY_VERSION;
  const keys = new Map<string, Buffer>();

  if (rawKeyring) {
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(rawKeyring) as Record<string, string>;
    } catch (error) {
      throw new Error('PLAID_TOKEN_KEYRING_JSON must be valid JSON');
    }

    for (const [version, keyMaterial] of Object.entries(parsed)) {
      if (!version || typeof keyMaterial !== 'string') continue;
      const decoded = decodeKeyMaterial(keyMaterial);
      assertAes256Key(decoded, version);
      keys.set(version, decoded);
    }
  }

  if (keys.size === 0) {
    const fallbackMasterKey = process.env.PLAID_TOKEN_MASTER_KEY || '';
    if (!fallbackMasterKey) {
      throw new Error('PLAID token encryption key is not configured');
    }
    const decoded = decodeKeyMaterial(fallbackMasterKey);
    assertAes256Key(decoded, activeVersion);
    keys.set(activeVersion, decoded);
  }

  if (!keys.has(activeVersion)) {
    throw new Error(`active key version "${activeVersion}" is not present in keyring`);
  }

  return { activeVersion, keys };
}

function getKeyring(): Keyring {
  if (cachedKeyring) {
    return cachedKeyring;
  }

  cachedKeyring = parseKeyringFromEnv();
  return cachedKeyring;
}

function buildAad(context: string): Buffer {
  return Buffer.from(`plaid-token:${context}`, 'utf8');
}

export function isEnvelopeEncryptionConfigured(): boolean {
  try {
    getKeyring();
    return true;
  } catch {
    return false;
  }
}

export function encryptWithEnvelope(plaintext: string, context: string): EncryptedPayload {
  const keyring = getKeyring();
  const activeKeyVersion = keyring.activeVersion;
  const wrappingKey = keyring.keys.get(activeKeyVersion);
  if (!wrappingKey) {
    throw new Error(`missing wrapping key for active version "${activeKeyVersion}"`);
  }

  const aad = buildAad(context);
  const dataKey = crypto.randomBytes(32);

  const dataIv = crypto.randomBytes(12);
  const dataCipher = crypto.createCipheriv('aes-256-gcm', dataKey, dataIv);
  dataCipher.setAAD(aad);
  const ciphertext = Buffer.concat([dataCipher.update(plaintext, 'utf8'), dataCipher.final()]);
  const authTag = dataCipher.getAuthTag();

  const wrapIv = crypto.randomBytes(12);
  const wrapCipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, wrapIv);
  wrapCipher.setAAD(Buffer.from(`plaid-datakey:${activeKeyVersion}`, 'utf8'));
  const wrappedKeyCiphertext = Buffer.concat([wrapCipher.update(dataKey), wrapCipher.final()]);
  const wrappedKeyAuthTag = wrapCipher.getAuthTag();

  return {
    ciphertext,
    iv: dataIv,
    authTag,
    wrappedKeyCiphertext,
    wrappedKeyIv: wrapIv,
    wrappedKeyAuthTag,
    keyVersion: activeKeyVersion,
  };
}

export function decryptWithEnvelope(payload: EncryptedPayload, context: string): string {
  const keyring = getKeyring();
  const wrappingKey = keyring.keys.get(payload.keyVersion);
  if (!wrappingKey) {
    throw new Error(`missing wrapping key for version "${payload.keyVersion}"`);
  }

  const unwrapDecipher = crypto.createDecipheriv('aes-256-gcm', wrappingKey, payload.wrappedKeyIv);
  unwrapDecipher.setAAD(Buffer.from(`plaid-datakey:${payload.keyVersion}`, 'utf8'));
  unwrapDecipher.setAuthTag(payload.wrappedKeyAuthTag);
  const dataKey = Buffer.concat([
    unwrapDecipher.update(payload.wrappedKeyCiphertext),
    unwrapDecipher.final(),
  ]);

  const aad = buildAad(context);
  const dataDecipher = crypto.createDecipheriv('aes-256-gcm', dataKey, payload.iv);
  dataDecipher.setAAD(aad);
  dataDecipher.setAuthTag(payload.authTag);
  const plaintext = Buffer.concat([dataDecipher.update(payload.ciphertext), dataDecipher.final()]);

  return plaintext.toString('utf8');
}
