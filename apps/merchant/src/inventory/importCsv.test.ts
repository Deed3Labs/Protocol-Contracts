import { describe, expect, test } from 'bun:test';
import { cents, guessFields, itemKey, parseCsv, rowsFor, whole } from './importCsv';

describe('reading a spreadsheet', () => {
  test('quotes, doubled quotes, commas and line breaks inside quotes, CRLF, a BOM, blank lines', () => {
    const csv = '﻿Item,Size,Retail\r\n"Goodyear, Assurance","17"" rim",162.00\r\n\r\n"Two\nlines",,5\n';
    expect(parseCsv(csv)).toEqual([
      ['Item', 'Size', 'Retail'],
      ['Goodyear, Assurance', '17" rim', '162.00'],
      ['Two\nlines', '', '5'],
    ]);
  });

  test('columns guessed from their headers, each field once', () => {
    expect(guessFields(['Item', 'Size', 'Retail', 'Cost', 'Qty'])).toEqual(['name', 'detail', 'price', 'cost', 'quantity']);
    expect(guessFields(['Product name', 'Category', 'Price', 'Unit cost', 'On hand', 'Reorder point', 'Barcode'])).toEqual(['name', 'category', 'price', 'cost', 'quantity', 'reorderAt', 'skip']);
    expect(guessFields(['Price', 'Sell price'])).toEqual(['price', 'skip']);
  });

  test('money and whole numbers, as people type them', () => {
    expect(cents('$1,234.50')).toBe(123450);
    expect(cents('162')).toBe(16200);
    expect(cents('12.345')).toBeNull();
    expect(cents('')).toBeNull();
    expect(whole('1,200')).toBe(1200);
    expect(whole('2.5')).toBeNull();
  });

  test('rows for the API; unnamed rows left out; matching ignores case and spacing', () => {
    const rows = rowsFor(
      [
        ['Goodyear', '215/55R17', '$162.00', '118', '8'],
        ['', '', '5', '', ''],
      ],
      ['name', 'detail', 'price', 'cost', 'quantity'],
    );
    expect(rows).toEqual([{ name: 'Goodyear', detail: '215/55R17', category: null, priceCents: 16200, costCents: 11800, quantity: 8, reorderAt: null }]);
    expect(itemKey(' Michelin  Defender2 ', '225/65r17')).toBe(itemKey('michelin defender2', '225/65R17'));
  });
});
