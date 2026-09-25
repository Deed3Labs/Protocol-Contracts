import { describe, expect, test } from 'bun:test';
import { mockReader, mockReaders } from './mock';
import { kindsFor, offlineFor } from './platform';
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
