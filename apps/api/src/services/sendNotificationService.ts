import crypto from 'crypto';
import { sendTransferStore, type RecipientType } from './sendTransferStore.js';

export interface SendNotificationResult {
  provider: string;
  providerMessageId: string;
  destinationHash: string;
  status: string;
}

type NotificationChannel = 'email' | 'sms';
type NotificationKind = 'claim_link' | 'otp' | 'charge_alert' | 'refund_alert' | 'receipt' | 'statement';

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

  /**
   * The text a member gets when a merchant raises a charge.
   *
   * On this service rather than a second one because the transport is the transport -- provider
   * mode, Twilio wiring, webhook fallback and the mock are all here, and a charge alert that went
   * out through its own copy would be a second thing to configure and a second thing to forget.
   * The class name is now narrower than what it does; that is worth less than one dispatcher.
   *
   * Best-effort by design: the in-app notification and Web Push have already been emitted by the
   * time this runs, so a Twilio outage must not fail the charge. It is reported, not thrown.
   */
  async sendChargeAlert(params: {
    recipientType: RecipientType;
    recipientContact: string;
    merchantName: string;
    amount: string;
    approveUrl: string;
  }): Promise<SendNotificationResult | null> {
    const channel: NotificationChannel = params.recipientType === 'email' ? 'email' : 'sms';
    try {
      const dispatchResult = await this.dispatchNotification({
        channel,
        kind: 'charge_alert',
        destination: params.recipientContact,
        payload: {
          merchantName: params.merchantName,
          amount: params.amount,
          approveUrl: params.approveUrl,
        },
      });
      return {
        provider: dispatchResult.provider,
        providerMessageId: dispatchResult.providerMessageId,
        destinationHash: hashDestination(params.recipientContact.trim().toLowerCase()),
        status: dispatchResult.status,
      };
    } catch (error) {
      console.error('[charge] alert dispatch failed', error instanceof Error ? error.message : error);
      return null;
    }
  }

  async sendRefundAlert(params: {
    recipientType: RecipientType;
    recipientContact: string;
    merchantName: string;
    amount: string;
  }): Promise<SendNotificationResult | null> {
    const channel: NotificationChannel = params.recipientType === 'email' ? 'email' : 'sms';
    try {
      const dispatchResult = await this.dispatchNotification({
        channel,
        kind: 'refund_alert',
        destination: params.recipientContact,
        payload: { merchantName: params.merchantName, amount: params.amount },
      });
      return {
        provider: dispatchResult.provider,
        providerMessageId: dispatchResult.providerMessageId,
        destinationHash: hashDestination(params.recipientContact.trim().toLowerCase()),
        status: dispatchResult.status,
      };
    } catch (error) {
      console.error('[refund] alert dispatch failed', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /** Whether email can go out at all: Resend's key, or a webhook that takes email. */
  emailConfigured(): boolean {
    return Boolean((process.env.RESEND_API_KEY || '').trim() || (process.env.SEND_NOTIFICATION_WEBHOOK_URL || '').trim() || this.providerMode === 'mock');
  }

  /**
   * A month's statement, to an accountant: the subject and the statement as plain text. Throws when
   * it can't go, so the one sending it is told (unlike an alert, nothing else carries it).
   */
  async sendStatement(params: { to: string; subject: string; body: string }): Promise<SendNotificationResult> {
    const r = await this.dispatchNotification({ channel: 'email', kind: 'statement', destination: params.to, payload: { subject: params.subject, body: params.body } });
    return { provider: r.provider, providerMessageId: r.providerMessageId, destinationHash: hashDestination(params.to.trim().toLowerCase()), status: r.status };
  }

  /** A shop's receipt, by text or email: who, how much, and the link to the whole of it. */
  async sendReceipt(params: {
    recipientType: RecipientType;
    recipientContact: string;
    merchantName: string;
    total: string;
    receiptUrl: string;
  }): Promise<SendNotificationResult | null> {
    const channel: NotificationChannel = params.recipientType === 'email' ? 'email' : 'sms';
    try {
      const dispatchResult = await this.dispatchNotification({
        channel,
        kind: 'receipt',
        destination: params.recipientContact,
        payload: { merchantName: params.merchantName, total: params.total, receiptUrl: params.receiptUrl },
      });
      return {
        provider: dispatchResult.provider,
        providerMessageId: dispatchResult.providerMessageId,
        destinationHash: hashDestination(params.recipientContact.trim().toLowerCase()),
        status: dispatchResult.status,
      };
    } catch (error) {
      console.error('[receipt] dispatch failed', error instanceof Error ? error.message : error);
      return null;
    }
  }

  private async dispatchNotification(params: {
    channel: NotificationChannel;
    kind: NotificationKind;
    destination: string;
    payload: Record<string, string>;
  }): Promise<{ provider: string; providerMessageId: string; status: string }> {
    // Email goes by Resend whenever its key is set, whatever carries the texts.
    if (params.channel === 'email' && (process.env.RESEND_API_KEY || '').trim()) {
      return this.dispatchResend(params);
    }
    if (this.providerMode === 'twilio') {
      return this.dispatchTwilio(params);
    }

    if (this.providerMode === 'generic_webhook') {
      return this.dispatchGenericWebhook(params);
    }

    return this.dispatchMock(params);
  }

  /** An email's subject and plain-text body: the text message's words, with a subject line. */
  buildEmail(params: { kind: NotificationKind; payload: Record<string, string> }): { subject: string; text: string } {
    const p = params.payload;
    if (params.kind === 'statement') return { subject: p.subject || 'Your statement', text: p.body || '' };
    const subject =
      params.kind === 'receipt'
        ? `Your receipt from ${p.merchantName || 'the shop'}`
        : params.kind === 'charge_alert'
          ? `${p.merchantName || 'A shop'} is charging ${p.amount || ''} to your Clear account`
          : params.kind === 'refund_alert'
            ? `${p.merchantName || 'A shop'} refunded ${p.amount || ''}`
            : params.kind === 'otp'
              ? 'Your Clear verification code'
              : 'You received funds on Clear';
    return { subject, text: this.buildSmsMessage(params) };
  }

  /**
   * Email by Resend (https://resend.com/docs/api-reference/emails/send-email). The sender is
   * RESEND_FROM, on a domain verified in Resend; plain text, which every mail client reads.
   */
  private async dispatchResend(params: {
    channel: NotificationChannel;
    kind: NotificationKind;
    destination: string;
    payload: Record<string, string>;
  }): Promise<{ provider: string; providerMessageId: string; status: string }> {
    const key = (process.env.RESEND_API_KEY || '').trim();
    const from = (process.env.RESEND_FROM || 'Clear <receipts@useclear.org>').trim();
    const { subject, text } = this.buildEmail(params);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), parseIntEnv('RESEND_TIMEOUT_MS', 12000));
    try {
      const response = await fetch((process.env.RESEND_API_BASE_URL || 'https://api.resend.com').replace(/\/+$/, '') + '/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [params.destination.trim()], subject, text }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok) throw new Error(`Resend refused the email (${response.status}${body.message ? `: ${body.message}` : ''})`);
      return { provider: 'resend', providerMessageId: body.id || providerMessageId(params.channel), status: 'sent' };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildSmsMessage(params: {
    kind: NotificationKind;
    payload: Record<string, string>;
  }): string {
    if (params.kind === 'otp') {
      const otp = params.payload.otp || '';
      return `Your claim verification code is ${otp}.`;
    }

    if (params.kind === 'refund_alert') {
      // Says the thing a refunded member most needs to know — that the payments stop — because
      // otherwise they keep budgeting for instalments that are no longer coming.
      const { merchantName = '', amount = '' } = params.payload;
      return `${merchantName} refunded ${amount} to your Clear account.\n\nIt has been taken off what you owe. Nothing more is due on it.`;
    }

    if (params.kind === 'receipt') {
      const { merchantName = '', total = '', receiptUrl = '' } = params.payload;
      return `Your receipt from ${merchantName}: ${total}.\n\n${receiptUrl}`;
    }

    if (params.kind === 'charge_alert') {
      // The reference's own wording. "You have not been charged yet" is the whole message — it is
      // what makes the rest safe to read on a lock screen — so it is not shortened to fit a
      // segment count.
      const { merchantName = '', amount = '', approveUrl = '' } = params.payload;
      return `${merchantName} is charging ${amount} to your Clear account.\n\nApprove or decline: ${approveUrl}\n\nYou have not been charged yet.`;
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
