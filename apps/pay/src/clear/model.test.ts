import { describe, expect, test } from 'bun:test';
import { SOFIA_PAID, SOFIA_QUOTE } from '../lib/preview';
import { approveLabel, cardByLine, cardPointsNote, carryLabel, checkBody, checkTitle, codeDigits, dobMask, dobToIso, doneLine, everydayName, joinDet, joinTitle, money, paidWith, pointsNote, pointsRow, splitLabel } from './model';

describe('the Clear steps read as the spec draws them (§2–§4)', () => {
  test('one screen for everyone, by channel (approved copy)', () => {
    expect(checkTitle('phone')).toBe('Check your phone');
    expect(checkBody('phone')).toBe('We texted you a link and a code. Tap the link, or enter the code here.');
    expect(checkTitle('email')).toBe('Check your email');
    expect(checkBody('email')).toBe('We emailed you a link and a code. Tap the link, or enter the code here.');
  });

  test('Hi Sofia: $185.32, the four splits, carry, points', () => {
    expect(money(18532)).toBe('$185.32');
    expect(SOFIA_QUOTE.splits.map((s) => `${splitLabel(s.installments)} ${money(s.perCycleCents)}`)).toEqual(['In full $189.03', 'In 2 $95.44', 'In 4 $48.65', 'In 12 $17.45']);
    expect(approveLabel(18532, 4)).toBe('Approve $185.32 in 4');
    expect(approveLabel(18532, 1)).toBe('Approve $185.32');
    expect(approveLabel(18532, null)).toBe('Approve $185.32');
    expect(carryLabel(200)).toBe('Carry, whole plan · 2% a cycle');
    expect(pointsNote(SOFIA_QUOTE.points)).toBe('Earns 256 points at Mi Casa · 1.5× for paying with Clear');
    expect(pointsNote(null)).toBeNull();
  });

  test('You’re all set', () => {
    expect(doneLine('Mi Casa Tacos', SOFIA_PAID)).toBe('Mi Casa Tacos has your order. The first of 4 cycles, $48.65, clears Nov 1.');
    expect(doneLine('Mi Casa Tacos', { ...SOFIA_PAID, installments: 1, firstCycle: null })).toBe('Mi Casa Tacos has your order.');
    expect(paidWith(SOFIA_PAID)).toBe('Clear · in 4');
    expect(paidWith({ ...SOFIA_PAID, installments: null })).toBe('Clear');
    expect(paidWith({ ...SOFIA_PAID, method: 'card' })).toBe('Card');
    expect(pointsRow(SOFIA_PAID.points!)).toBe('+256 · now 384');
  });

  test('the shop’s everyday name and the code boxes', () => {
    expect(everydayName('Mi Casa Tacos')).toBe('Mi Casa');
    expect(everydayName('Joe’s')).toBe('Joe’s');
    expect(codeDigits('48 19-07x2')).toBe('481907');
  });
});

describe('new to Clear, and card (§3)', () => {
  test('the Join row reads as drawn when a starting limit covers the order', () => {
    expect(joinTitle({ installments: 4, perCycleCents: 4865 })).toBe('Join Clear and split it');
    expect(joinDet({ installments: 4, perCycleCents: 4865 })).toBe('About 3 minutes · In 4 is about $48.65 a cycle');
  });
  test('and says this one is by card when it doesn’t', () => {
    expect(joinTitle(null)).toBe('Join Clear');
    expect(joinDet(null)).toBe('About 3 minutes · Pay this one by card, split the next');
  });
  test('the card fields’ lines', () => {
    expect(cardByLine('Mi Casa Tacos')).toBe('Secure card fields by Stripe, for Mi Casa Tacos');
    expect(cardPointsNote('Mi Casa Rewards')).toBe('Card payments earn points too, if you join Mi Casa Rewards after.');
    expect(cardPointsNote(null)).toBeNull();
  });
  test('a birthday as people type it', () => {
    expect(dobMask('04121991')).toBe('04 / 12 / 1991');
    expect(dobMask('0412')).toBe('04 / 12');
    expect(dobToIso('04 / 12 / 1991')).toBe('1991-04-12');
    expect(dobToIso('4/12/1991')).toBe('1991-04-12');
    expect(dobToIso('02 / 30 / 1991')).toBeNull();
    expect(dobToIso('04 / 12')).toBeNull();
  });
});
