import { describe, expect, test } from 'bun:test';
import { cardTransactionRow } from './activityMapping';
import type { CardTransaction } from '@/utils/apiClient';

const tx = (over: Partial<CardTransaction> = {}): CardTransaction => ({
  id: 'tx1',
  name: 'HARBOR FREIGHT',
  at: '2026-09-17T04:35:00.000Z',
  amountCents: 500,
  mcc: '5251',
  city: 'Riverside',
  state: 'CA',
  draws: [{ source: 'cash', amountCents: 500 }],
  cardToken: 'card1',
  ...over,
});

describe('a card purchase as an activity row', () => {
  test('the funding tag is the tier that actually paid', () => {
    // Not a guess, unlike the chain mapping: an authorization carries its draws.
    expect(cardTransactionRow(tx()).source).toBe('cash');
    expect(cardTransactionRow(tx({ draws: [{ source: 'asset', amountCents: 500 }] })).source).toBe('credit');
  });

  test('a split across cash and credit reads as credit', () => {
    // The credit half is the part a member needs to see — it is what sets the rate.
    const row = cardTransactionRow(
      tx({ draws: [{ source: 'cash', amountCents: 200 }, { source: 'asset', amountCents: 300 }] }),
    );
    expect(row.source).toBe('credit');
    expect(row.paidFromLabel).toBe('Credit');
  });

  test('spending is negative, and keeps what the merchant asked for', () => {
    expect(cardTransactionRow(tx()).amount).toBe(-5);
    expect(cardTransactionRow(tx()).kind).toBe('spending');
  });

  test('a reversed charge keeps its figure and carries the mark', () => {
    // Totals count heldCents; the row is what the member reconciles against their memory.
    const row = cardTransactionRow(tx({ reversed: true, heldCents: 0 }));
    expect(row.amount).toBe(-5);
    expect(row.reversed).toBe(true);
  });

  test('location is built from what was sent, and omitted when nothing was', () => {
    expect(cardTransactionRow(tx()).location).toBe('Riverside, CA');
    expect(cardTransactionRow(tx({ city: null, state: null })).location).toBeUndefined();
  });

  test('the card is named only when the caller knows which one', () => {
    // Activity lists every card, so it has no single last four to show.
    expect(cardTransactionRow(tx()).cardLast4).toBeUndefined();
    expect(cardTransactionRow(tx(), '8691').cardLast4).toBe('8691');
  });
});
