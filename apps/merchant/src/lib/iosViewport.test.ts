import { afterEach, describe, expect, test } from 'bun:test';
import { stopIosFieldZoom } from './iosViewport';

const BASE = 'width=device-width, initial-scale=1';
const g = globalThis as unknown as { navigator?: unknown; document?: unknown };
const saved = { navigator: g.navigator, document: g.document };
afterEach(() => {
  g.navigator = saved.navigator;
  g.document = saved.document;
});

function run(nav: { userAgent: string; platform: string; maxTouchPoints: number }, content = BASE): string {
  const meta = { content };
  g.navigator = nav;
  g.document = { querySelector: () => meta };
  stopIosFieldZoom();
  return meta.content;
}

describe('iOS field zoom is stopped on iOS alone', () => {
  test('iPhone and iPad (iPadOS says it is a Mac, with touch): capped, which iOS ignores for pinching', () => {
    expect(run({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })).toBe(`${BASE}, maximum-scale=1`);
    expect(run({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(`${BASE}, maximum-scale=1`);
  });
  test('Android and desktops: untouched, so pinch-to-zoom isn’t capped where the cap would block it', () => {
    expect(run({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(BASE);
    expect(run({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(BASE);
  });
  test('once', () => {
    expect(run({ userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 }, `${BASE}, maximum-scale=1`)).toBe(`${BASE}, maximum-scale=1`);
  });
});
