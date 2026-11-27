import { describe, expect, test } from 'bun:test';
import { browserRows } from './siteFeed.js';

/* Growth → Traffic → Devices: the browsers visits came in on, from Umami's browser metric. */
describe('browserRows', () => {
  test('names Umami’s keys, folds the same browser together, and keeps the top three with the rest as Other', () => {
    const rows = [{ x: 'ios', y: 40 }, { x: 'safari', y: 20 }, { x: 'chrome', y: 50 }, { x: 'crios', y: 5 }, { x: 'samsung', y: 12 }, { x: 'firefox', y: 3 }, { x: 'edge-chromium', y: 2 }];
    expect(browserRows(rows)).toEqual([['Safari', 60], ['Chrome', 55], ['Samsung Internet', 12], ['Other', 5]]);
  });
  test('three or fewer: no Other; nothing: nothing', () => {
    expect(browserRows([{ x: 'chrome', y: 2 }])).toEqual([['Chrome', 2]]);
    expect(browserRows([])).toEqual([]);
  });
});
