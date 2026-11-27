import { describe, expect, test } from 'bun:test';
import { APP_DAYS, FEATURES, appsFeed } from './appsFeed.js';

/*
 * Growth › Apps from Umami's API (a stand-in here): each app's visitors by day, its week, which features
 * its visitors used and the errors it sent, with the site feed's sign-in.
 */

const NOW = Date.parse('2026-10-28T15:30:00Z');
const TODAY = Date.parse('2026-10-28T00:00:00Z');
const MEMBER = '11111111-1111-4111-8111-111111111111';
const MERCHANT = '22222222-2222-4222-8222-222222222222';
const asked: URL[] = [];
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

const umami = async (input: string | URL | Request) => {
  const u = new URL(String(input));
  if (u.pathname === '/api/auth/login') return json({ token: 't' });
  asked.push(u);
  const p = Object.fromEntries(u.searchParams);
  const member = u.pathname.includes(MEMBER);
  if (u.pathname.endsWith('/pageviews')) {
    // two days with visitors: yesterday and today
    return json({ pageviews: [], sessions: [{ x: `${day(TODAY - 86_400_000)}T00:00:00Z`, y: member ? 4 : 2 }, { x: `${day(TODAY)} 00:00:00`, y: member ? 6 : 3 }] });
  }
  if (u.pathname.endsWith('/stats')) {
    if (p.path === '/') return json({ pageviews: 30, visitors: 9, visits: 20 });
    if (p.event === 'charge_approved') return json({ pageviews: 0, visitors: '5', visits: 5 });
    if (p.path || p.event) return json({ pageviews: 0, visitors: 1, visits: 1 });
    return json({ pageviews: 60, visitors: member ? 10 : 3, visits: member ? 40 : 12 });
  }
  if (p.type === 'event')
    return json(
      member
        ? [
            { x: 'Error · /send · TypeError', y: 2 },
            { x: 'charge_approved', y: 7 },
            { x: 'Error · /card · ChunkLoadError', y: 5 },
          ]
        : [],
    );
  return json([]);
};

const env = { UMAMI_API_URL: 'https://umami.test', UMAMI_WEBSITE_ID: '33333333-3333-4333-8333-333333333333', UMAMI_USERNAME: 'command', UMAMI_PASSWORD: 'x' };

describe('the apps feed', () => {
  test('off without the apps’ websites, or without the sign-in', () => {
    expect(appsFeed(env).off()).toContain('UMAMI_MEMBER_WEBSITE_ID');
    expect(appsFeed({ UMAMI_MEMBER_WEBSITE_ID: MEMBER }).off()).toContain('UMAMI_API_URL');
    expect(appsFeed({ ...env, UMAMI_MERCHANT_WEBSITE_ID: MERCHANT }).off()).toBeNull();
  });

  test('each app: visitors by day lined up to the twelve weeks, the week, its features and its errors', async () => {
    const feed = appsFeed({ ...env, UMAMI_MEMBER_WEBSITE_ID: MEMBER, UMAMI_MERCHANT_WEBSITE_ID: MERCHANT }, umami as typeof fetch, () => NOW);
    const { figures } = await feed.sync(null as never, null as never);
    const a = (figures as any)['growth.apps'];
    expect(a.from).toBe(TODAY - (APP_DAYS - 1) * 86_400_000);
    expect(a.member.daily).toHaveLength(APP_DAYS);
    expect(a.member.daily.slice(-3)).toEqual([0, 4, 6]);
    expect(a.merchant.daily.slice(-2)).toEqual([2, 3]);
    expect(a.member.week).toEqual({ visitors: 10, visits: 40 });
    expect(a.member.feats.map((f: [string, number]) => f[0])).toEqual(FEATURES.member.map((f) => f[0]));
    expect(a.member.feats.slice(0, 2)).toEqual([
      ['Check balance', 9, 'Opened the home screen'],
      ['Pay at a shop', 5, 'Approved a charge at a partner'],
    ]);
    // only the errors, most first, without the prefix
    expect(a.member.errors).toEqual([
      ['/card · ChunkLoadError', 5],
      ['/send · TypeError', 2],
    ]);
    expect(a.merchant.errors).toEqual([]);
    // the week's reads are the last 7 days, today included
    const stats = asked.find((u) => u.pathname.endsWith(`${MEMBER}/stats`))!;
    expect(Number(stats.searchParams.get('startAt'))).toBe(TODAY - 6 * 86_400_000);
  });

  test('one app set: the other is null, and never read', async () => {
    asked.length = 0;
    const feed = appsFeed({ ...env, UMAMI_MEMBER_WEBSITE_ID: MEMBER }, umami as typeof fetch, () => NOW);
    const a = ((await feed.sync(null as never, null as never)).figures as any)['growth.apps'];
    expect(a.merchant).toBeNull();
    expect(asked.some((u) => u.pathname.includes(MERCHANT))).toBe(false);
  });
});
