import { describe, expect, test } from 'bun:test';
import { SOFIA_PAID, SOFIA_QUOTE } from '../lib/preview';
import { approveLabel, carryLabel, checkBody, checkTitle, codeDigits, doneLine, everydayName, money, paidWith, pointsNote, pointsRow, splitLabel } from './model';

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
