import { describe, expect, test } from 'bun:test';
import { cachedSiteNow, pageOf, siteNow } from './siteNow.js';

/*
 * Growth's Right now from Umami's real-time view (a stand-in here): who's on the site in the last five
 * minutes, the 30 minutes before by the minute, this time last week, and the latest arrivals, with
 * nothing that tells one person from another.
 */

const NOW = Date.parse('2026-10-29T16:20:30Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const asked: URL[] = [];
let logins = 0;
let expireOnce = false;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

// four sessions: a poster scan on its shop's page now, an Instagram visit moved on to /join, a typed visit
// gone quiet ten minutes ago, and a Google visit two minutes ago; newest first, as Umami sends them
const EVENTS = [
  { sessionId: 'p1', createdAt: ago(1), urlPath: '/s/rosas-panaderia?utm_source=poster', referrerDomain: '', country: 'US', device: 'mobile' },
  { sessionId: 'g1', createdAt: ago(2), urlPath: '/how', referrerDomain: 'www.google.com', country: 'US', device: 'desktop' },
  { sessionId: 'i1', createdAt: ago(3), urlPath: '/join', referrerDomain: 'useclear.org', country: 'US', device: 'mobile' },
  { sessionId: 'i1', createdAt: ago(4), urlPath: '/', referrerDomain: 'instagram.com', country: 'MX', device: 'mobile' },
  { sessionId: 'd1', createdAt: ago(10), urlPath: '/shop/tote', referrerDomain: null, country: null, device: 'tablet' },
];
const realtime = (u: URL) => {
  const poster = u.searchParams.get('utmSource') === 'poster';
  const ev = poster ? EVENTS.filter((e) => e.sessionId === 'p1') : EVENTS;
  // Umami repeats each session's first event as a 'session' row
  const firsts = [...new Map(ev.map((e) => [e.sessionId, e])).values()].map((e) => ({ __type: 'session', ...e }));
  return { countries: {}, urls: {}, referrers: {}, events: [...firsts, ...ev.map((e) => ({ __type: 'pageview', eventName: null, ...e }))], series: { views: [], visitors: [] }, totals: {}, timestamp: NOW };
};
const umami = (async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  asked.push(u);
  if (u.pathname === '/api/auth/login') {
    logins++;
    return JSON.parse(String(init!.body)).password === 'pw' ? json({ token: `tok${logins}` }) : json({}, 401);
  }
  if (expireOnce) {
    expireOnce = false;
    return json({ error: 'expired' }, 401);
  }
  if (u.pathname === '/api/realtime/site-1') return json(realtime(u));
  if (u.pathname === '/api/websites/site-1/stats') return json({ pageviews: 9, visitors: '6', visits: 7 });
  return json({ error: 'no' }, 404);
}) as typeof fetch;
const ENV = { UMAMI_API_URL: 'https://umami.test/', UMAMI_WEBSITE_ID: 'site-1', UMAMI_USERNAME: 'command', UMAMI_PASSWORD: 'pw' };

describe('the site right now', () => {
  test('without the Umami settings it says which are missing', () => {
    expect(siteNow({}, umami).off()).toBe('UMAMI_API_URL and UMAMI_WEBSITE_ID aren’t set');
    expect(siteNow({ UMAMI_API_URL: 'x', UMAMI_WEBSITE_ID: 'y' }, umami).off()).toBe('UMAMI_USERNAME and UMAMI_PASSWORD aren’t set');
    expect(siteNow(ENV, umami).off()).toBeNull();
  });

  test('who is on the site, the minutes before, last week and the arrivals', async () => {
    asked.length = 0;
    const r = await siteNow(ENV, umami, () => NOW).read();
    // the typed visit's last event was ten minutes ago: gone
    expect(r.people).toEqual([
      { page: '/s/:shop', ch: 'Posters' },
      { page: '/how', ch: 'Search' },
      { page: '/join', ch: 'Social' },
    ]);
    expect(r.mins).toHaveLength(30);
    expect(r.mins[29]).toBe(3);
    // ten minutes ago the typed visit was on, alone; the minute before it nobody
    expect(r.mins[29 - 10]).toBe(1);
    expect(r.mins[29 - 15]).toBe(0);
    expect(r.wk).toBe(6);
    expect(r.feed.map((f) => [f.page, f.ch, f.from, f.place, f.dev])).toEqual([
      ['/s/:shop', 'Posters', 'a poster', 'United States', 'Phone'],
      ['/how', 'Search', 'google.com', 'United States', 'Desktop'],
      ['/', 'Social', 'instagram.com', 'Mexico', 'Phone'],
      ['/shop', 'Direct', 'a typed link', 'Somewhere', 'Tablet'],
    ]);
    expect(r.feed[0].at).toBe(Date.parse(ago(1)));
    // nothing that tells one person from another
    expect(JSON.stringify(r)).not.toMatch(/p1|g1|i1|d1|sessionId/);
    // the real-time view twice (all, posters only), and the five minutes at this time last week
    const rt = asked.filter((u) => u.pathname.startsWith('/api/realtime/'));
    expect(rt.map((u) => u.searchParams.get('utmSource'))).toEqual([null, 'poster']);
    const st = asked.find((u) => u.pathname.endsWith('/stats'))!;
    expect(Number(st.searchParams.get('endAt'))).toBe(NOW - 7 * 86_400_000);
    expect(Number(st.searchParams.get('startAt'))).toBe(NOW - 7 * 86_400_000 - 5 * 60_000);
  });

  test('an expired token signs in again once', async () => {
    const reader = siteNow(ENV, umami, () => NOW);
    await reader.read();
    const before = logins;
    expireOnce = true;
    await reader.read();
    expect(logins).toBe(before + 1);
  });

  test('pages group as the panel draws them', () => {
    expect([pageOf('/s/uptown-barber'), pageOf('/join?x=1'), pageOf(''), pageOf('/shop/hoodie/black'), pageOf(null)]).toEqual(['/s/:shop', '/join', '/', '/shop', '/']);
  });

  test('kept for a few seconds, so many pages make one read; a failed read is not kept', async () => {
    let t = 0,
      reads = 0,
      failNext = false;
    const c = cachedSiteNow(
      {
        off: () => null,
        read: async () => {
          reads++;
          if (failNext) {
            failNext = false;
            throw new Error('down');
          }
          return { people: [], mins: [], wk: 0, feed: [], at: t };
        },
      },
      15_000,
      () => t,
    );
    await Promise.all([c.read(), c.read(), c.read()]);
    expect(reads).toBe(1);
    t = 16_000;
    failNext = true;
    await expect(c.read()).rejects.toThrow('down');
    await c.read();
    expect(reads).toBe(3);
  });
});
