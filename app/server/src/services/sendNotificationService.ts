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
    if (this.providerMode === 'generic_webhook') {
      return this.dispatchGenericWebhook(params);
    }

    return this.dispatchMock(params);
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
