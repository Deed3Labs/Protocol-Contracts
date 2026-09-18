import { describe, expect, test } from 'bun:test';
import { allocateRepaidOldestFirst } from './cardTransactionsService.js';

describe('which credit purchases are repaid', () => {
  const purchases = [
    { id: 'mikes', creditCents: 17500 },
    { id: 'coffee', creditCents: 2500 },
    { id: 'garage', creditCents: 2500 },
  ];

  test('nothing owed: every credit purchase is repaid in full', () => {
    const r = allocateRepaidOldestFirst(purchases, 22500);
    expect([...r.values()]).toEqual([17500, 2500, 2500]);
  });

  test('part repaid: the oldest is repaid first', () => {
    const r = allocateRepaidOldestFirst(purchases, 18000);
    expect(r.get('mikes')).toBe(17500);
    expect(r.get('coffee')).toBe(500);
    expect(r.get('garage')).toBe(0);
  });

  test('a cash purchase is never "repaid" — it never drew credit', () => {
    const r = allocateRepaidOldestFirst([{ id: 'cash', creditCents: 0 }, ...purchases], 22500);
    expect(r.get('cash')).toBe(0);
    expect(r.get('mikes')).toBe(17500);
  });
});
