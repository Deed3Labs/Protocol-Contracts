import crypto from 'crypto';

export interface OtpConfig {
  expiryMs: number;
  maxAttempts: number;
  resendCooldownMs: number;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class SendClaimService {
  private readonly tokenPepper: string;
  private readonly otpPepper: string;

  constructor() {
    this.tokenPepper = process.env.SEND_TOKEN_PEPPER || '';
    this.otpPepper = process.env.SEND_OTP_PEPPER || '';
  }

  getOtpConfig(): OtpConfig {
    return {
      expiryMs: parseIntEnv('SEND_OTP_EXPIRY_MS', 10 * 60 * 1000),
      maxAttempts: parseIntEnv('SEND_OTP_MAX_ATTEMPTS', 5),
      resendCooldownMs: parseIntEnv('SEND_OTP_RESEND_COOLDOWN_MS', 60 * 1000),
    };
  }

  generateClaimToken(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  generateSessionToken(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  generateOtp(): string {
    const value = crypto.randomInt(0, 1_000_000);
    return value.toString().padStart(6, '0');
  }

  hashClaimToken(token: string): string {
    return this.sha256Hex(`claim:${token}:${this.tokenPepper}`);
  }

  hashSessionToken(sessionToken: string): string {
    return this.sha256Hex(`session:${sessionToken}:${this.tokenPepper}`);
  }

  hashRecipientContact(contact: string): string {
    return this.sha256Hex(`recipient:${contact}`);
  }

  hashOtp(otp: string, claimSessionId: number): string {
    return this.sha256Hex(`otp:${claimSessionId}:${otp}:${this.otpPepper}`);
  }

  calculateOtpExpiry(fromDate: Date = new Date()): Date {
    return new Date(fromDate.getTime() + this.getOtpConfig().expiryMs);
  }

  verifyOtp(candidateOtp: string, expectedHash: string, claimSessionId: number): boolean {
    const hashedCandidate = this.hashOtp(candidateOtp, claimSessionId);

    const candidateBuffer = Buffer.from(hashedCandidate, 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    if (candidateBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
  }

  maskContact(contact: string, recipientType: 'email' | 'phone'): string {
    if (recipientType === 'email') {
      const [localPart, domain = ''] = contact.split('@');
      if (!localPart) return `***@${domain}`;
      const prefix = localPart.slice(0, 2);
      return `${prefix}***@${domain}`;
    }

    if (contact.length <= 4) {
      return `***${contact}`;
    }

    return `${'*'.repeat(Math.max(0, contact.length - 4))}${contact.slice(-4)}`;
  }

  private sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }
}

export const sendClaimService = new SendClaimService();
