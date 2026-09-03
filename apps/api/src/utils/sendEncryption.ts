import crypto from 'crypto';

const SEND_ENCRYPTION_VERSION = 'v1';

let cachedKey: Buffer | null = null;

function decodeKeyMaterial(rawValue: string): Buffer {
  const value = rawValue.trim();
  if (!value) {
    throw new Error('Send encryption key is empty');
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

function getSendEncryptionKey(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  const keyMaterial =
    process.env.SEND_CONTACT_ENCRYPTION_KEY ||
    process.env.SEND_TRANSFER_ENCRYPTION_KEY ||
    '';

  if (!keyMaterial) {
    throw new Error('Send contact encryption is not configured. Set SEND_CONTACT_ENCRYPTION_KEY.');
  }

  const decoded = decodeKeyMaterial(keyMaterial);
  if (decoded.length !== 32) {
    throw new Error('Send contact encryption key must be 32 bytes (AES-256).');
  }

  cachedKey = decoded;
  return decoded;
}

function buildAad(context: string): Buffer {
  return Buffer.from(`send-contact:${context}`, 'utf8');
}

export function isSendEncryptionConfigured(): boolean {
  try {
    getSendEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSendContact(plaintext: string, context: string): string {
  const key = getSendEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(buildAad(context));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    SEND_ENCRYPTION_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSendContact(payload: string, context: string): string {
  const key = getSendEncryptionKey();
  const [version, ivRaw, authTagRaw, ciphertextRaw] = payload.split('.');

  if (version !== SEND_ENCRYPTION_VERSION || !ivRaw || !authTagRaw || !ciphertextRaw) {
    throw new Error('Invalid encrypted payload format');
  }

  const iv = Buffer.from(ivRaw, 'base64url');
  const authTag = Buffer.from(authTagRaw, 'base64url');
  const ciphertext = Buffer.from(ciphertextRaw, 'base64url');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(buildAad(context));
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export function hashSendValue(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
