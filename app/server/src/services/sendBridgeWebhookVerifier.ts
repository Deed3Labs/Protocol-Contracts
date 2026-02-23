import crypto from 'crypto';

export interface BridgeWebhookVerificationInput {
  rawBody: Buffer | string | undefined;
  signatureHeader: string | undefined;
}

export interface BridgeWebhookVerificationResult {
  valid: boolean;
  reason?: string;
  timestamp?: number;
}

type ParsedBridgeSignature = {
  timestampRaw: string;
  timestamp: number;
  signature: string;
};

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePublicKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) return '';

  if (trimmed.includes('BEGIN PUBLIC KEY')) {
    return trimmed;
  }

  // Bridge may provide the key as raw base64 DER.
  const compact = trimmed.replace(/\s+/g, '');
  const lines = compact.match(/.{1,64}/g) ?? [compact];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

function configuredPublicKeys(): string[] {
  const single = (process.env.SEND_BRIDGE_WEBHOOK_PUBLIC_KEY || '').trim();
  const csv = (process.env.SEND_BRIDGE_WEBHOOK_PUBLIC_KEYS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const keys = [single, ...csv]
    .map((value) => normalizePublicKey(value))
    .filter(Boolean);

  return Array.from(new Set(keys));
}

function parseSignatureHeader(header: string): ParsedBridgeSignature | null {
  const parts = header
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  let timestampRaw: string | null = null;
  let timestamp: number | null = null;
  let signature: string | null = null;

  for (const part of parts) {
    const [rawKey, ...rawValueParts] = part.split('=');
    const key = rawKey?.trim().toLowerCase();
    const value = rawValueParts.join('=').trim();

    if (!key || !value) continue;

    if (key === 't') {
      const parsed = parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        timestampRaw = value;
        timestamp = parsed;
      }
      continue;
    }

    if (key === 'v0') {
      signature = value;
      continue;
    }
  }

  if (!timestampRaw || !timestamp || !signature) {
    return null;
  }

  return { timestampRaw, timestamp, signature };
}

function verifyDigestSignature(digestHex: string, signatureBase64: string, publicKey: string): boolean {
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(digestHex);
    verifier.end();
    return verifier.verify(publicKey, signatureBase64, 'base64');
  } catch {
    return false;
  }
}

class SendBridgeWebhookVerifier {
  verify(input: BridgeWebhookVerificationInput): BridgeWebhookVerificationResult {
    const keys = configuredPublicKeys();
    if (keys.length === 0) {
      return {
        valid: false,
        reason: 'Bridge webhook public key is not configured',
      };
    }

    if (!input.signatureHeader || input.signatureHeader.trim().length === 0) {
      return {
        valid: false,
        reason: 'Missing X-Webhook-Signature header',
      };
    }

    const parsed = parseSignatureHeader(input.signatureHeader);
    if (!parsed) {
      return {
        valid: false,
        reason: 'Invalid X-Webhook-Signature format',
      };
    }

    const rawBodyText =
      typeof input.rawBody === 'string'
        ? input.rawBody
        : input.rawBody instanceof Buffer
          ? input.rawBody.toString('utf8')
          : '';

    if (!rawBodyText) {
      return {
        valid: false,
        reason: 'Raw request body is required for Bridge webhook verification',
      };
    }

    const eventTimestampMs = parsed.timestamp > 1_000_000_000_000 ? parsed.timestamp : parsed.timestamp * 1000;
    const nowMs = Date.now();
    const maxAgeSeconds = parseIntEnv('SEND_BRIDGE_WEBHOOK_MAX_AGE_SECONDS', 300);
    if (Math.abs(nowMs - eventTimestampMs) > maxAgeSeconds * 1000) {
      return {
        valid: false,
        reason: 'Bridge webhook signature timestamp is outside tolerance',
      };
    }

    const signedPayload = `${parsed.timestampRaw}.${rawBodyText}`;
    const digestHex = crypto.createHash('sha256').update(signedPayload).digest('hex');

    for (const key of keys) {
      if (verifyDigestSignature(digestHex, parsed.signature, key)) {
        return {
          valid: true,
          timestamp: parsed.timestamp,
        };
      }
    }

    return {
      valid: false,
      reason: 'Bridge webhook signature verification failed',
    };
  }
}

export const sendBridgeWebhookVerifier = new SendBridgeWebhookVerifier();
