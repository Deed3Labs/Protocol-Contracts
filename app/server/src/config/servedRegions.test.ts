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

  test('covers the Inland Empire, county by county', () => {
    delete process.env.CLEAR_SERVED_ZIP_PREFIXES;
    for (const [zip, place] of [
      ['92373', 'Redlands'], ['92501', 'Riverside'], ['92408', 'San Bernardino'],
      ['91764', 'Ontario'], ['91730', 'Rancho Cucamonga'], ['91786', 'Upland'],
      ['92882', 'Corona'], ['92860', 'Norco'], ['92253', 'La Quinta'],
      ['92392', 'Victorville'], ['92264', 'Palm Springs'], ['92592', 'Temecula'],
    ] as const) {
      expect(isServedZip(zip), `${place} ${zip}`).toBe(true);
    }
  });

  test('does not leak into the counties three-digit prefixes would have caught', () => {
    delete process.env.CLEAR_SERVED_ZIP_PREFIXES;
    // This is why the list is ranges. 917xx also covers Pomona and Claremont in LA County; 928xx
    // also covers Anaheim and Fullerton in Orange County. A prefix list told somebody in Anaheim
    // the co-op was open where they live.
    for (const [zip, place] of [
      ['91766', 'Pomona, LA County'], ['91711', 'Claremont, LA County'],
      ['91750', 'La Verne, LA County'], ['92801', 'Anaheim, Orange County'],
      ['92831', 'Fullerton, Orange County'], ['90210', 'Beverly Hills'],
    ] as const) {
      expect(isServedZip(zip), `${place} ${zip}`).toBe(false);
    }
  });

  test('a shorter configured entry still reads as a prefix', () => {
    // An operator who sets "923" plainly means the 923xx block, not a five-digit ZIP that can
    // never match.
    process.env.CLEAR_SERVED_ZIP_PREFIXES = '923';
    expect(isServedZip('92373')).toBe(true);
    expect(isServedZip('92501')).toBe(false);
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
