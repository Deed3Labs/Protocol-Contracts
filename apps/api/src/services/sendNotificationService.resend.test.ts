import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sendNotificationService } from './sendNotificationService.js';

/** Email by Resend: what's sent to its API, and what happens when it refuses. No network: fetch is replaced. */
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }> = [];
let reply: { status: number; body: unknown } = { status: 200, body: { id: 're_123' } };

beforeEach(() => {
  calls = [];
  reply = { status: 200, body: { id: 're_123' } };
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.RESEND_FROM = 'Mike’s Tire via Clear <receipts@useclear.org>';
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
});

describe('email by Resend', () => {
  test('an emailed receipt: from, to, subject and the text', async () => {
    const r = await sendNotificationService.sendReceipt({ recipientType: 'email', recipientContact: 'dana@example.com', merchantName: 'Mike’s Tire', total: '$189.00', receiptUrl: 'https://merchant.useclear.org/r/abc' });
    expect(r).toMatchObject({ provider: 'resend', providerMessageId: 're_123', status: 'sent' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toEqual({
      from: 'Mike’s Tire via Clear <receipts@useclear.org>',
      to: ['dana@example.com'],
      subject: 'Your receipt from Mike’s Tire',
      text: 'Your receipt from Mike’s Tire: $189.00.\n\nhttps://merchant.useclear.org/r/abc',
    });
  });

  test('texts don’t go by Resend', async () => {
    await sendNotificationService.sendReceipt({ recipientType: 'phone', recipientContact: '+19095550177', merchantName: 'x', total: '$1.00', receiptUrl: 'u' });
    expect(calls.filter((c) => c.url.includes('resend'))).toHaveLength(0);
  });

  test('refused: a receipt reports it failed; a statement throws, so the sender is told', async () => {
    reply = { status: 422, body: { message: 'The useclear.org domain is not verified' } };
    expect(await sendNotificationService.sendReceipt({ recipientType: 'email', recipientContact: 'dana@example.com', merchantName: 'x', total: '$1.00', receiptUrl: 'u' })).toBeNull();
    await expect(sendNotificationService.sendStatement({ to: 'books@example.com', subject: 's', body: 'b' })).rejects.toThrow('Resend refused the email (422: The useclear.org domain is not verified)');
  });

  test('configured when the key is set', () => {
    expect(sendNotificationService.emailConfigured()).toBe(true);
  });
});
