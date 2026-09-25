import { describe, expect, test } from 'bun:test';
import { mockReader, mockReaders } from './mock';
import { kindsFor, offlineFor } from './platform';
import { serverSmartReaders } from './server';
import type { CollectEvent } from './types';

describe('which readers a device can drive', () => {
  test('a browser: smart readers only; the installed app: the M2 and Tap to Pay too', () => {
    expect(kindsFor('web')).toEqual(['smart']);
    expect(kindsFor('ios')).toEqual(['smart', 'bluetooth', 'tapToPay']);
    expect(kindsFor('android')).toEqual(['smart', 'bluetooth', 'tapToPay']);
    expect(mockReaders('web').map((r) => r.kind)).toEqual(['smart']);
  });

  test('store-and-forward is off until the offline plugin exists, and never on Tap to Pay', () => {
    expect(offlineFor('bluetooth')).toBe(false);
    expect(offlineFor('tapToPay')).toBe(false);
    expect(offlineFor('smart')).toBe(false);
  });
});

describe('collecting a card', () => {
  test('walks the card screen through ready, reading, approved', async () => {
    const seen: CollectEvent['state'][] = [];
    const result = await mockReader('ios', { step: 1 }).collect(92752, (e) => seen.push(e.state));
    expect(seen).toEqual(['ready', 'reading', 'approved']);
    expect(result).toEqual({ outcome: 'approved', card: 'Visa ending 4242' });
  });

  test('a decline ends on declined', async () => {
    const seen: CollectEvent['state'][] = [];
    const result = await mockReader('ios', { step: 1, decline: true }).collect(92752, (e) => seen.push(e.state));
    expect(seen).toEqual(['ready', 'reading', 'declined']);
    expect(result.outcome).toBe('declined');
  });

  test('cancelling stops it where it is', async () => {
    const reader = mockReader('ios', { step: 50 });
    const seen: CollectEvent['state'][] = [];
    const done = reader.collect(92752, (e) => seen.push(e.state));
    await reader.cancel();
    expect(await done).toEqual({ outcome: 'cancelled' });
    expect(seen).toEqual(['ready']);
  });
});

describe('a smart reader driven from the server', () => {
  type Status = 'pending' | 'authorised' | 'declined' | 'cancelled';
  function fakeBackend(outcomes: Status[], opts: { cancelRefusedOnce?: boolean } = {}) {
    const calls: string[] = [];
    let n = 0;
    let refuse = opts.cancelRefusedOnce ?? false;
    const tender = (status: Status) =>
      ({ id: 'tnd_1', orderId: 'ord_1', method: 'card', amountCents: 9300, tipCents: 0, status, refundedCents: 0, cardBrand: 'visa', cardLast4: '4242', readerId: 'rdr_1', clearChargeCode: null, handedOverCents: null, changeCents: null, createdAt: '2026-09-24T12:00:00Z' }) as const;
    const backend = {
      connectionToken: async () => ({ secret: 's', locationId: 'tml_1' }),
      readers: async () => [
        { id: 'rdr_1', shop: '0x1', provider: 'stripe' as const, type: 'smart' as const, externalReaderId: 'tmr_1', label: 'Front counter', locationId: 'tml_1', lastSeenAt: null },
        { id: 'rdr_2', shop: '0x1', provider: 'stripe' as const, type: 'm2' as const, externalReaderId: 'STRM2', label: 'Bay M2', locationId: 'tml_1', lastSeenAt: null },
      ],
      recordReader: async () => {
        throw new Error('unused');
      },
      startCardTender: async (orderId: string, input: { amountCents: number; readerId: string }) => {
        calls.push(`start ${orderId} ${input.amountCents} ${input.readerId}`);
        return { tenderId: 'tnd_1', clientSecret: 'x', offlineLimitCents: null };
      },
      present: async (id: string) => {
        calls.push(`present ${id}`);
      },
      sync: async () => tender(outcomes[Math.min(n++, outcomes.length - 1)]!),
      cancelTender: async (id: string) => {
        if (refuse) {
          refuse = false;
          throw new Error('The reader is busy with another payment.');
        }
        calls.push(`cancel ${id}`);
      },
    };
    return { backend, calls };
  }
  const order = { orderId: 'ord_1', tipCents: 0 };

  test('lists only smart readers, from the server', async () => {
    const { backend } = fakeBackend(['pending']);
    const smart = serverSmartReaders(backend, { pollMs: 1 });
    expect((await smart.discover()).map((r) => r.id)).toEqual(['rdr_1']);
  });

  test('starts the tender, sends it to the reader, and follows it to approved without capturing', async () => {
    const { backend, calls } = fakeBackend(['pending', 'pending', 'authorised']);
    const smart = serverSmartReaders(backend, { pollMs: 1 });
    const [reader] = await smart.discover();
    const seen: CollectEvent['state'][] = [];
    const r = await smart.collect(reader!, 9300, (e) => seen.push(e.state), order);
    expect(r).toEqual({ outcome: 'approved', card: 'Visa ending 4242' });
    expect(seen).toEqual(['ready', 'approved']);
    expect(calls).toEqual(['start ord_1 9300 rdr_1', 'present tnd_1']);
  });

  test('a decline says only that it was declined', async () => {
    const { backend } = fakeBackend(['pending', 'declined']);
    const smart = serverSmartReaders(backend, { pollMs: 1 });
    const [reader] = await smart.discover();
    const events: CollectEvent[] = [];
    const r = await smart.collect(reader!, 9300, (e) => events.push(e), order);
    expect(r.outcome).toBe('declined');
    expect(events.at(-1)).toEqual({ state: 'declined', message: 'Declined' });
  });

  test('cancelling voids it; if the server refuses mid-authorisation, it keeps following', async () => {
    const { backend, calls } = fakeBackend(['pending', 'pending', 'pending', 'authorised'], { cancelRefusedOnce: true });
    const smart = serverSmartReaders(backend, { pollMs: 5 });
    const [reader] = await smart.discover();
    const done = smart.collect(reader!, 9300, () => undefined, order);
    await new Promise((r) => setTimeout(r, 2));
    await expect(smart.cancel()).rejects.toThrow('busy');
    // Still following: the card went through, and the screen says so.
    expect((await done).outcome).toBe('approved');
    expect(calls).not.toContain('cancel tnd_1');
  });

  test('a reader gone silent is voided after the backstop', async () => {
    const { backend, calls } = fakeBackend(['pending']);
    const smart = serverSmartReaders(backend, { pollMs: 1, giveUpMs: 20 });
    const [reader] = await smart.discover();
    const r = await smart.collect(reader!, 9300, () => undefined, order);
    expect(r).toEqual({ outcome: 'cancelled', message: 'The reader stopped waiting for the card.' });
    expect(calls).toContain('cancel tnd_1');
  });

  test('without an order, cards aren’t on yet', async () => {
    const { backend } = fakeBackend(['pending']);
    const smart = serverSmartReaders(backend, { pollMs: 1 });
    const [reader] = await smart.discover();
    await expect(smart.collect(reader!, 9300, () => undefined)).rejects.toThrow('aren’t switched on');
  });
});
