import { describe, expect, test } from 'bun:test';
import { categoryForMcc, totalsByCategory, CATEGORY_LABEL } from './mccCategory';

describe('merchant category codes become categories a member recognises', () => {
  test('the codes are the real assignments', () => {
    expect(categoryForMcc(5411)).toBe('grocery'); // grocery stores & supermarkets
    expect(categoryForMcc(5541)).toBe('fuel'); // service stations
    expect(categoryForMcc(5812)).toBe('dining'); // eating places
    expect(categoryForMcc(4814)).toBe('bills'); // telecom
    expect(categoryForMcc(5732)).toBe('shopping'); // electronics
    expect(categoryForMcc(4121)).toBe('transport'); // taxis & rideshare
  });

  test('ranges the standard defines as ranges are handled as ranges', () => {
    expect(categoryForMcc(3007)).toBe('transport'); // an airline
    expect(categoryForMcc(3509)).toBe('transport'); // a hotel
    expect(categoryForMcc(2999)).toBe('other'); // just below the airline range
    expect(categoryForMcc(4000)).toBe('other'); // just above lodging
  });

  test('MCCs travel as strings, because leading zeros are meaningful', () => {
    expect(categoryForMcc('5411')).toBe('grocery');
    expect(categoryForMcc(' 5811 ')).toBe('dining');
  });

  test('an unknown or missing code is Other, not the biggest bucket', () => {
    // Filing an unmapped merchant under Shopping would quietly distort the bar.
    expect(categoryForMcc(null)).toBe('other');
    expect(categoryForMcc(undefined)).toBe('other');
    expect(categoryForMcc('')).toBe('other');
    expect(categoryForMcc('not-a-code')).toBe('other');
    expect(categoryForMcc(9999)).toBe('other');
  });

  test('every category has a label', () => {
    for (const key of ['grocery', 'fuel', 'dining', 'bills', 'shopping', 'transport', 'other'] as const) {
      expect(CATEGORY_LABEL[key]).toBeTruthy();
    }
  });
});

describe('totals for the bar', () => {
  test('largest first, because the bar is about what the month was mostly made of', () => {
    const totals = totalsByCategory([
      { category: 'dining', amount: -20 },
      { category: 'grocery', amount: -100 },
      { category: 'fuel', amount: -50 },
    ]);
    expect(totals.map((t) => t.category)).toEqual(['grocery', 'fuel', 'dining']);
  });

  test('debits are summed by magnitude', () => {
    expect(totalsByCategory([{ category: 'fuel', amount: -52.1 }])[0].total).toBeCloseTo(52.1, 5);
  });

  test('a refund does not shrink a slice', () => {
    // Netting a credit against spending would make the month look smaller than it was, and the bar
    // is a picture of what went out.
    const totals = totalsByCategory([
      { category: 'grocery', amount: -100 },
      { category: 'grocery', amount: 30 },
    ]);
    expect(totals[0].total).toBe(100);
  });

  test('a category with nothing spent does not appear at all', () => {
    expect(totalsByCategory([{ category: 'bills', amount: 0 }])).toEqual([]);
  });
});
