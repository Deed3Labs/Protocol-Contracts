import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { beforeSend, sanitizePath, tracker } from './analytics';

/*
 * The member app's Umami: what an address looks like when it leaves, which tracker and id it accepts,
 * and that page views are only counted inside the signed-in app.
 */

const ID = '11111111-1111-4111-8111-111111111111';

describe('analytics', () => {
  test('ids and tokens never leave in an address', () => {
    expect(sanitizePath('/claim/abc123/x')).toBe('/claim/:token');
    expect(sanitizePath('/approve/ch_9f2')).toBe('/approve/:id');
    expect(sanitizePath('/inbox/thread-42')).toBe('/inbox/:id');
    expect(sanitizePath('/s/rosas-panaderia')).toBe('/s/:id');
    expect(sanitizePath('/savings?amount=40#x')).toBe('/savings');
    expect(sanitizePath('')).toBe('/');
  });

  test('every event leaves without its query, hash or title', () => {
    const out = beforeSend('event', { url: 'https://app.useclear.org/claim/tok?email=a@b.c#h', referrer: 'https://app.useclear.org/send?to=x', title: 'Kai’s balance', name: 'send_completed' });
    expect(out).toEqual({ url: 'https://app.useclear.org/claim/:token', referrer: 'https://app.useclear.org/send', title: 'Clear', name: 'send_completed' });
  });

  test('the tracker only from an https .js address, the id only as a uuid', () => {
    expect(tracker('https://umami.useclear.org/script.js', ID)).toEqual({ src: 'https://umami.useclear.org/script.js', id: ID });
    expect(tracker('http://umami.useclear.org/script.js', ID)).toBeNull();
    expect(tracker('https://umami.useclear.org/script.js?x=1', ID)).toBeNull();
    expect(tracker('https://umami.useclear.org/script.js', 'nope')).toBeNull();
    expect(tracker(undefined, ID)).toBeNull();
  });

  test('page views are counted from the signed-in shell only', () => {
    const shell = readFileSync(new URL('../components/shell/AppShell.tsx', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(shell).toContain('usePageViews()');
    expect(app).not.toContain('usePageViews');
  });
});
