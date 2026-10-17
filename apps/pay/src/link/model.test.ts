import { describe, expect, test } from 'bun:test';
import { MI_CASA_LINK } from '../lib/preview';
import { money, onColour, shortDate } from '../lib/format';
import { linkDetail, linkStep } from './model';

describe('the link page (§5)', () => {
  test('reads as drawn: $161.48, the tray and its note, expiring Oct 23', () => {
    expect(money(MI_CASA_LINK.order.totalCents)).toBe('$161.48');
    expect(linkDetail(MI_CASA_LINK)).toBe('Taco tray for 12 · Saturday pickup, 11:30am');
    expect(shortDate(MI_CASA_LINK.expiresAt!)).toBe('Oct 23');
  });
  test('without a note, just the order', () => {
    expect(linkDetail({ ...MI_CASA_LINK, note: null })).toBe('Taco tray for 12');
  });
});

describe('which state it draws', () => {
  test('paid stands, even once the link has expired or been turned off', () => {
    expect(linkStep({ state: 'expired' }, { state: 'paid' }, false)).toBe('paid');
    expect(linkStep({ state: 'inactive' }, { state: 'paid' }, true)).toBe('paid');
  });
  test('turned off, then expired, before anything else', () => {
    expect(linkStep({ state: 'inactive' }, { state: 'open' }, true)).toBe('inactive');
    expect(linkStep({ state: 'expired' }, null, false)).toBe('expired');
    expect(linkStep({ state: 'open' }, { state: 'expired' }, true)).toBe('expired');
  });
  test('waiting only on an open payment', () => {
    expect(linkStep({ state: 'open' }, { state: 'open' }, true)).toBe('waiting');
    expect(linkStep({ state: 'open' }, null, true)).toBe('start');
    expect(linkStep({ state: 'open' }, { state: 'open' }, false)).toBe('start');
  });
});

describe('the shop’s mark', () => {
  test('white on Mi Casa’s terracotta, ink on a pale colour', () => {
    expect(onColour('#B4532A')).toBe('#FFFFFF');
    expect(onColour('#F2D16B')).toBe('#16211D');
  });
});
