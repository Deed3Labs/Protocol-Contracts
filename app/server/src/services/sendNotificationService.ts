import crypto from 'crypto';
import { sendTransferStore, type RecipientType } from './sendTransferStore.js';

export interface SendNotificationResult {
  provider: string;
  providerMessageId: string;
  destinationHash: string;
  status: string;
}

function hashDestination(destination: string): string {
  return crypto.createHash('sha256').update(destination, 'utf8').digest('hex');
}

class SendNotificationService {
  async sendClaimLink(params: {
    transferRowId: number;
    recipientType: RecipientType;
    recipientContact: string;
    claimUrl: string;
  }): Promise<SendNotificationResult> {
    const channel = params.recipientType === 'email' ? 'email' : 'sms';
    const provider = this.getProvider(channel);
    const providerMessageId = this.providerMessageId(channel);
    const destinationHash = hashDestination(params.recipientContact.trim().toLowerCase());

    // Provider integration point (SES/Twilio/etc). v1 uses internal simulation logs.
    console.log(
      `[SendNotification:${channel}] transfer=${params.transferRowId} provider=${provider} messageId=${providerMessageId} claimUrl=${params.claimUrl}`
    );

    await sendTransferStore.createNotification({
      transferRowId: params.transferRowId,
      channel,
      destinationHash,
      provider,
      providerMessageId,
      status: 'SENT',
    });

    return {
      provider,
      providerMessageId,
      destinationHash,
      status: 'SENT',
    };
  }

  async sendOtp(params: {
    transferRowId: number;
    recipientType: RecipientType;
    recipientContact: string;
    otp: string;
  }): Promise<SendNotificationResult> {
    const channel = params.recipientType === 'email' ? 'email' : 'sms';
    const provider = this.getProvider(channel);
    const providerMessageId = this.providerMessageId(channel);
    const destinationHash = hashDestination(params.recipientContact.trim().toLowerCase());

    // OTP must never be returned from API responses. Logging only partial marker in server logs.
    console.log(
      `[SendNotification:${channel}] transfer=${params.transferRowId} provider=${provider} messageId=${providerMessageId} otp=***${params.otp.slice(-2)}`
    );

    await sendTransferStore.createNotification({
      transferRowId: params.transferRowId,
      channel,
      destinationHash,
      provider,
      providerMessageId,
      status: 'SENT',
    });

    return {
      provider,
      providerMessageId,
      destinationHash,
      status: 'SENT',
    };
  }

  private getProvider(channel: 'email' | 'sms'): string {
    if (channel === 'email') {
      return process.env.SEND_EMAIL_PROVIDER || 'mock-email';
    }
    return process.env.SEND_SMS_PROVIDER || 'mock-sms';
  }

  private providerMessageId(channel: 'email' | 'sms'): string {
    return `${channel}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }
}

export const sendNotificationService = new SendNotificationService();
