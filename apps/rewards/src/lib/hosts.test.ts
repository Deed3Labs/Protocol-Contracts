import { describe, expect, test } from 'bun:test';
import { forwardUrl, isClearHost } from './hosts';

describe('hosts (Phase 7)', () => {
  test('Clear’s hosts and previews, and anything else is a shop’s own domain', () => {
    for (const h of ['rewards.useclear.org', 'www.useclear.org', 'useclear.org', 'localhost', 'rewards-git-x.vercel.app']) expect(isClearHost(h)).toBe(true);
    for (const h of ['rewards.micasatacos.com', 'micasatacos.com', 'useclear.org.evil.com']) expect(isClearHost(h)).toBe(false);
  });
  test('a shop’s link forwards to its domain, path and query kept', () => {
    expect(forwardUrl('rewards.micasatacos.com', 'micasa', '/s/micasa', '')).toBe('https://rewards.micasatacos.com/');
    expect(forwardUrl('rewards.micasatacos.com', 'micasa', '/s/micasa/bill/A7K2', '?from=point')).toBe('https://rewards.micasatacos.com/bill/A7K2?from=point');
  });
});
