import { describe, expect, test } from 'bun:test';
import { centsOf, linkLabel, linkRequest, BLANK_LINK } from './linkModel';

describe('Send a link', () => {
  test("§5's link: the tray, a note, 7 days, over time", () => {
    expect(linkRequest({ ...BLANK_LINK, itemId: 'itm_tray12', note: ' Saturday pickup, 11:30am ' })).toEqual({
      ok: true,
      request: { for: 'item', itemId: 'itm_tray12', quantity: 1, note: 'Saturday pickup, 11:30am', expires: '7d', allowOverTime: true },
    });
  });
  test('a price needs an item; an amount needs at least $0.50', () => {
    expect(linkRequest(BLANK_LINK).ok).toBe(false);
    expect(linkRequest({ ...BLANK_LINK, for: 'amount', amount: '0.49' }).ok).toBe(false);
    expect(linkRequest({ ...BLANK_LINK, for: 'amount', amount: '$25' })).toMatchObject({ ok: true, request: { for: 'amount', amountCents: 2500, note: null } });
  });
  test('amounts as people type them', () => {
    expect(centsOf('161.48')).toBe(16148);
    expect(centsOf('$1,250.5')).toBe(125050);
    expect(centsOf('12.345')).toBeNull();
    expect(centsOf('abc')).toBeNull();
  });
  test('the address as drawn: no scheme', () => {
    expect(linkLabel('https://pay.useclear.org/l/micasa-tray12')).toBe('pay.useclear.org/l/micasa-tray12');
  });
});
