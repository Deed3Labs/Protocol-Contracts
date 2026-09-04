import { describe, expect, it } from 'bun:test';
import { chargeCodeFrom } from './clearCode';

describe('reading a merchant code', () => {
  it('takes the code out of the URL the QR actually carries', () => {
    expect(chargeCodeFrom('https://app.useclear.org/c/55DCQ9PR')).toBe('55DCQ9PR');
    expect(chargeCodeFrom('https://demo.useclear.org/c/55DCQ9PR?x=1')).toBe('55DCQ9PR');
    expect(chargeCodeFrom('/c/55DCQ9PR')).toBe('55DCQ9PR');
  });

  it('accepts eight characters typed by hand', () => {
    expect(chargeCodeFrom('55dcq9pr')).toBe('55DCQ9PR');
    expect(chargeCodeFrom(' 55DCQ9PR ')).toBe('55DCQ9PR');
  });

  it('repairs the four letters the alphabet omits', () => {
    // Crockford leaves out I, L, O and U precisely because people mistype them for 1, 0 and V.
    expect(chargeCodeFrom('OI55DCQ9')).toBe('0155DCQ9');
    expect(chargeCodeFrom('UUUUUUUU')).toBe('VVVVVVVV');
  });

  it('refuses anything that is not a code', () => {
    // A counter QR could be wifi, a menu, or a rival's app. Opening an approval screen for a
    // charge that does not exist is worse than not recognising the code.
    expect(chargeCodeFrom('https://example.com/menu')).toBeNull();
    expect(chargeCodeFrom('WIFI:S:shop;T:WPA;P:hunter2;;')).toBeNull();
    expect(chargeCodeFrom('55DCQ9P')).toBeNull();
    expect(chargeCodeFrom('55DCQ9PRX')).toBeNull();
    expect(chargeCodeFrom('')).toBeNull();
  });
});
