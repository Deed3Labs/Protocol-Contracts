import crypto from 'crypto';
import { sendTransferStore, type RecipientType } from './sendTransferStore.js';

export interface SendNotificationResult {
  provider: string;
  providerMessageId: string;
  destinationHash: string;
  status: string;
}

type NotificationChannel = 'email' | 'sms';
type NotificationKind = 'claim_link' | 'otp';

type GenericWebhookResponse = {
  provider?: string;
  providerMessageId?: string;
  status?: string;
};

type TwilioMessageResponse = {
  sid?: string;
  status?: string;
  message?: string;
  code?: number;
};

function hashDestination(destination: string): string {
  return crypto.createHash('sha256').update(destination, 'utf8').digest('hex');
}

function providerMessageId(channel: NotificationChannel): string {
  return `${channel}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class SendNotificationService {
  private readonly providerMode = (process.env.SEND_NOTIFICATION_PROVIDER || 'mock').trim().toLowerCase();

  async sendClaimLink(params: {
    transferRowId: number;
    recipientType: RecipientType;
    recipientContact: string;
    claimUrl: string;
  }): Promise<SendNotificationResult> {
    const channel: NotificationChannel = params.recipientType === 'email' ? 'email' : 'sms';
    const destinationHash = hashDestination(params.recipientContact.trim().toLowerCase());

    const dispatchResult = await this.dispatchNotification({
      channel,
      kind: 'claim_link',
      destination: params.recipientContact,
      payload: { claimUrl: params.claimUrl },
    });

    await sendTransferStore.createNotification({
      transferRowId: params.transferRowId,
      channel,
      destinationHash,
      provider: dispatchResult.provider,
      providerMessageId: dispatchResult.providerMessageId,
      status: dispatchResult.status,
    });

    return {
      provider: dispatchResult.provider,
      providerMessageId: dispatchResult.providerMessageId,
      destinationHash,
      status: dispatchResult.status,
    };
  }

  async sendOtp(params: {
    transferRowId: number;
    recipientType: RecipientType;
    recipientContact: string;
    otp: string;
  }): Promise<SendNotificationResult> {
    const channel: NotificationChannel = params.recipientType === 'email' ? 'email' : 'sms';
    const destinationHash = hashDestination(params.recipientContact.trim().toLowerCase());

    const dispatchResult = await this.dispatchNotification({
      channel,
      kind: 'otp',
      destination: params.recipientContact,
      payload: { otp: params.otp },
    });

    await sendTransferStore.createNotification({
      transferRowId: params.transferRowId,
      channel,
      destinationHash,
      provider: dispatchResult.provider,
      providerMessageId: dispatchResult.providerMessageId,
      status: dispatchResult.status,
    });

    return {
      provider: dispatchResult.provider,
      providerMessageId: dispatchResult.providerMessageId,
      destinationHash,
      status: dispatchResult.status,
    };
  }

  private async dispatchNotification(params: {
    channel: NotificationChannel;
    kind: NotificationKind;
    destination: string;
    payload: Record<string, string>;
  }): Promise<{ provider: string; providerMessageId: string; status: string }> {
    if (this.providerMode === 'twilio') {
      return this.dispatchTwilio(params);
    }

    if (this.providerMode === 'generic_webhook') {
      return this.dispatchGenericWebhook(params);
    }

    return this.dispatchMock(params);
  }

  private buildSmsMessage(params: {
    kind: NotificationKind;
    payload: Record<string, string>;
  }): string {
    if (params.kind === 'otp') {
      const otp = params.payload.otp || '';
      return `Your claim verification code is ${otp}.`;
    }

    const claimUrl = params.payload.claimUrl || '';
    return `You received funds. Claim here: ${claimUrl}`;
  }

  private async dispatchTwilio(params: {
    channel: NotificationChannel;
    kind: NotificationKind;
    destination: string;
    payload: Record<string, string>;
  }): Promise<{ provider: string; providerMessageId: string; status: string }> {
    if (params.channel !== 'sms') {
      if ((process.env.SEND_NOTIFICATION_WEBHOOK_URL || '').trim()) {
        return this.dispatchGenericWebhook(params);
      }
      throw new Error(
        'Twilio notification provider currently supports SMS recipients only. For email recipients configure SEND_NOTIFICATION_WEBHOOK_URL or use phone recipient.'
      );
    }

    const accountSid = (process.env.SEND_TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID || '').trim();
    const authToken = (process.env.SEND_TWILIO_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || '').trim();
    const messagingServiceSid = (
      process.env.SEND_TWILIO_MESSAGING_SERVICE_SID ||
      process.env.TWILIO_MESSAGING_SERVICE_SID ||
      ''
    ).trim();
    const fromNumber = (process.env.SEND_TWILIO_FROM_PHONE_NUMBER || process.env.TWILIO_FROM_PHONE_NUMBER || '').trim();
    const statusCallbackUrl = (process.env.SEND_TWILIO_STATUS_CALLBACK_URL || '').trim();

    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials are missing. Set SEND_TWILIO_ACCOUNT_SID and SEND_TWILIO_AUTH_TOKEN.');
    }

    if (!messagingServiceSid && !fromNumber) {
      throw new Error(
        'Twilio sender is missing. Set SEND_TWILIO_MESSAGING_SERVICE_SID or SEND_TWILIO_FROM_PHONE_NUMBER.'
      );
    }

    const baseUrl = (process.env.SEND_TWILIO_API_BASE_URL || 'https://api.twilio.com/2010-04-01').trim().replace(/\/+$/, '');
    const url = `${baseUrl}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;

    const timeoutMs = parseIntEnv('SEND_NOTIFICATION_WEBHOOK_TIMEOUT_MS', 12000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body = new URLSearchParams();
      body.set('To', params.destination);
      body.set('Body', this.buildSmsMessage({ kind: params.kind, payload: params.payload }));
      if (messagingServiceSid) {
        body.set('MessagingServiceSid', messagingServiceSid);
      } else if (fromNumber) {
        body.set('From', fromNumber);
      }
      if (statusCallbackUrl) {
        body.set('StatusCallback', statusCallbackUrl);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: controller.signal,
      });

      const twilioBody = (await response.json().catch(() => ({}))) as TwilioMessageResponse;
      if (!response.ok) {
        const details =
          typeof twilioBody.message === 'string'
            ? twilioBody.message
            : `Twilio request failed (${response.status})`;
        throw new Error(details);
      }

      return {
        provider: 'twilio',
        providerMessageId: twilioBody.sid || providerMessageId(params.channel),
        status: twilioBody.status || 'QUEUED',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async dispatchGenericWebhook(params: {
    channel: NotificationChannel;
    kind: NotificationKind;
    destination: string;
    payload: Record<string, string>;
  }): Promise<{ provider: string; providerMessageId: string; status: string }> {
    const webhookUrl = (process.env.SEND_NOTIFICATION_WEBHOOK_URL || '').trim();
    if (!webhookUrl) {
      throw new Error('SEND_NOTIFICATION_WEBHOOK_URL is required for generic_webhook mode');
    }

    const timeoutMs = parseIntEnv('SEND_NOTIFICATION_WEBHOOK_TIMEOUT_MS', 12000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SEND_NOTIFICATION_WEBHOOK_SECRET
            ? { 'X-Send-Webhook-Secret': process.env.SEND_NOTIFICATION_WEBHOOK_SECRET }
            : {}),
        },
        body: JSON.stringify({
          channel: params.channel,
          kind: params.kind,
          destination: params.destination,
          payload: params.payload,
        }),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => ({}))) as GenericWebhookResponse;
      if (!response.ok) {
        throw new Error(`Notification webhook failed (${response.status})`);
      }

      return {
        provider: body.provider || 'generic_webhook',
        providerMessageId: body.providerMessageId || providerMessageId(params.channel),
        status: body.status || 'SENT',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async dispatchMock(params: {
    channel: NotificationChannel;
    kind: NotificationKind;
    destination: string;
    payload: Record<string, string>;
  }): Promise<{ provider: string; providerMessageId: string; status: string }> {
    const messageId = providerMessageId(params.channel);

    if (params.kind === 'otp') {
      const otpValue = params.payload.otp || '';
      console.log(
        `[SendNotification:${params.channel}] mode=mock destination=${params.destination} messageId=${messageId} otp=***${otpValue.slice(-2)}`
      );
    } else {
      console.log(
        `[SendNotification:${params.channel}] mode=mock destination=${params.destination} messageId=${messageId} kind=${params.kind}`
      );
    }

    return {
      provider: 'mock',
      providerMessageId: messageId,
      status: 'SENT',
    };
  }
}

export const sendNotificationService = new SendNotificationService();
