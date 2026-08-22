import { afterEach, describe, expect, test } from 'bun:test';
import { isServedZip, servedZipPrefixes } from './servedRegions.js';

const original = process.env.CLEAR_SERVED_ZIP_PREFIXES;
afterEach(() => {
  if (original === undefined) delete process.env.CLEAR_SERVED_ZIP_PREFIXES;
  else process.env.CLEAR_SERVED_ZIP_PREFIXES = original;
});

describe('served regions', () => {
  test('defaults to the counties the reference names', () => {
    delete process.env.CLEAR_SERVED_ZIP_PREFIXES;
    // 92373 is Redlands, which is the ZIP the reference itself uses as a served example.
    expect(isServedZip('92373')).toBe(true);
  });

  test('sends somewhere else to the waitlist', () => {
    delete process.env.CLEAR_SERVED_ZIP_PREFIXES;
    // 43215 is Columbus, which is the reference's unserved example.
    expect(isServedZip('43215')).toBe(false);
  });

  test('opening a region is configuration, not a deploy', () => {
    // The reference says regions open when enough people are waiting, so this has to change
    // without the app changing.
    process.env.CLEAR_SERVED_ZIP_PREFIXES = '432';
    expect(servedZipPrefixes()).toEqual(['432']);
    expect(isServedZip('43215')).toBe(true);
    expect(isServedZip('92373')).toBe(false);
  });

  test('refuses a ZIP too short to be one', () => {
    delete process.env.CLEAR_SERVED_ZIP_PREFIXES;
    // Somebody who typed four digits should be asked again, not waved through on a prefix that
    // happened to match.
    expect(isServedZip('923')).toBe(false);
    expect(isServedZip('')).toBe(false);
  });

  test('ignores formatting somebody typed', () => {
    delete process.env.CLEAR_SERVED_ZIP_PREFIXES;
    expect(isServedZip(' 92373-1234 ')).toBe(true);
  });
});
