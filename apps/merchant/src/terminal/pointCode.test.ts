import { describe, expect, test } from 'bun:test';
import { pointCodeFrom } from './pointCode';

describe('a Point’s code from its QR (Add a Point, step 1)', () => {
  test('the link on the back of a Point, however it was written', () => {
    expect(pointCodeFrom('https://useclear.org/p/A7K2')).toBe('A7K2');
    expect(pointCodeFrom('USECLEAR.ORG/P/a7k2')).toBe('A7K2');
    expect(pointCodeFrom('useclear.org/p/DOOR')).toBe('D00R');
    expect(pointCodeFrom('https://app.useclear.org/p/T14P?x=1')).toBe('T14P');
  });

  test('four letters on their own', () => {
    expect(pointCodeFrom(' c0n7 ')).toBe('C0N7');
  });

  test('anything else is not a Point', () => {
    expect(pointCodeFrom('https://app.useclear.org/c/55DCQ9PR')).toBeNull();
    expect(pointCodeFrom('https://example.com/menu')).toBeNull();
    expect(pointCodeFrom('WIFI:S:MiCasa;T:WPA;P:x;;')).toBeNull();
    expect(pointCodeFrom('A7K2X')).toBeNull();
    expect(pointCodeFrom('https://useclear.org/p/A7K2/menu')).toBeNull();
  });
});
