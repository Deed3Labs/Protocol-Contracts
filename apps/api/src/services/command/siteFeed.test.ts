import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { feedRows, runFeed } from './feeds.js';
import { TOTALS } from './levels.js';
import type { MemberSource } from './memberSource.js';
import { growthSection, homeSection, moneySection } from './sections.js';
import { seedCommand } from './seed.js';
import { siteFeed, sourceOf } from './siteFeed.js';

/*
 * useclear.org's visits from Umami's API (a stand-in here), in the shapes Growth and Home draw, with
 * the forms, the join rate and the activations from Command's own records; and every section's
 * member counts from the member app once Members is live.
 */

const NOW = Date.parse('2026-10-24T15:30:00Z');
const asked: URL[] = [];
const auth: Array<string | null> = [];
let logins = 0;
let expireOnce = false;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const rows = (r: Array<[string | null, number]>) => r.map(([x, y]) => ({ x, y }));
const answer = (u: URL) => {
  const p = Object.fromEntries(u.searchParams);
  const joined = p.event === 'Join';
  const from = Number(p.startAt),
    to = Number(p.endAt) + 1;
  const current = day(to) === '2026-10-25';
  if (u.pathname.endsWith('/stats')) return joined ? { pageviews: 8, visitors: 8, visits: 8 } : { pageviews: '300', visitors: '150', visits: '205' };
  if (u.pathname.endsWith('/pageviews')) {
    const n = Math.round((to - from) / 86_400_000);
    if (p.unit === 'hour' && n > 1) return { pageviews: [], sessions: Array.from({ length: n }, (_, i) => ({ x: `${day(from + i * 86_400_000)}T09:00:00Z`, y: 1 })) };
    if (p.unit === 'hour') return { pageviews: [], sessions: Array.from({ length: 24 }, (_, h) => ({ x: `${day(from)}T${String(h).padStart(2, '0')}:00:00Z`, y: current ? 10 : 5 })) };
    return { pageviews: [], sessions: Array.from({ length: n }, (_, i) => ({ x: `${day(from + i * 86_400_000)}T00:00:00Z`, y: current ? 100 : 80 })) };
  }
  switch (p.type) {
    case 'referrer':
      return joined ? [] : rows([['google.com', 50], ['instagram.com', 20], ['www.someblog.net', 5], [null, 75]]);
    case 'utmSource':
      return rows([['poster', joined ? 6 : 30]]);
    case 'city':
      return rows([['Redlands', 80], ['Riverside', 40], ['Fontana', 10], [null, 3]]);
    case 'entry':
      return joined ? rows([['/join', 8]]) : p.limit === '1' ? rows([['/join', 120]]) : rows([['/join', 120], ['/', 60]]);
    case 'device':
      return rows([['mobile', 150], ['desktop', 50], ['tablet', 5]]);
    case 'path':
      return rows([['/join', 300], ['/how', 40]]);
  }
  return [];
};
const umami = (async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  if (u.pathname === '/api/auth/login') {
    const b = JSON.parse(String(init!.body));
    logins++;
    return b.username === 'command' && b.password === 'pw' ? json({ token: `tok${logins}` }) : json({ error: 'no' }, 401);
  }
  asked.push(u);
  const a = new Headers(init?.headers).get('authorization');
  auth.push(a);
  if (expireOnce) {
    expireOnce = false;
    return json({ error: 'expired' }, 401);
  }
  return json(answer(u));
}) as unknown as typeof fetch;
const ENV = { UMAMI_API_URL: 'https://umami.test/', UMAMI_WEBSITE_ID: 'site-1', UMAMI_USERNAME: 'command', UMAMI_PASSWORD: 'pw' };

let db: Db;
const env = { growth: process.env.PROVIDER_GROWTH, members: process.env.PROVIDER_MEMBERS };
beforeAll(async () => {
  ({ db } = await testDb());
  await seedCommand(db);
});
afterAll(() => {
  for (const [k, v] of Object.entries(env)) v == null ? delete process.env[`PROVIDER_${k.toUpperCase()}`] : (process.env[`PROVIDER_${k.toUpperCase()}`] = v);
});

describe('the site feed', () => {
  test('off until Umami is set up', () => {
    expect(siteFeed({}).off()).toBe('UMAMI_API_URL and UMAMI_WEBSITE_ID aren’t set');
    expect(siteFeed({ UMAMI_API_URL: 'https://umami.test', UMAMI_WEBSITE_ID: 'site-1' }).off()).toBe('UMAMI_USERNAME and UMAMI_PASSWORD aren’t set');
    expect(siteFeed(ENV).off()).toBeNull();
  });

  test('a visit’s source, as the prototype groups them', () => {
    expect(['poster', 'google.com', 'duckduckgo.com', 'instagram.com', 'nextdoor.com', 't.co', '', 'someblog.net'].map(sourceOf)).toEqual(['Posters', 'Search', 'Search', 'Social', 'Social', 'Social', 'Direct', 'Direct']);
  });

  test('reads the site’s visits into Growth’s shapes, signing in again when the token lapses', async () => {
    expireOnce = true;
    expect(await runFeed(db, siteFeed(ENV, umami, () => NOW))).toBe('ok');
    // one sign-in shared by the calls at once, and one more after the 401
    expect(logins).toBe(2);
    expect(auth).toContain('Bearer tok2');
    expect(asked.every((u) => u.origin === 'https://umami.test' && u.pathname.startsWith('/api/websites/site-1/'))).toBe(true);
    const f = (await feedRows(db)).get('site')!.figures;
    // today runs to 15:00, at 10 an hour, against 5 an hour the same day last week
    expect(f.range.today).toMatchObject({ name: 'Today', visits: 160, delta: '+100.0% on last Saturday', prevName: 'Last Sat', page: ['/join', 120] });
    expect(f.range.today.spark).toHaveLength(16);
    expect(f.range.week).toMatchObject({ visits: 700, delta: '+25.0% on the 7 days before', axis: ['Sun 18', 'Wed 21', 'Sat 24'], prevVisits: 560 });
    expect(f.range.month.spark).toHaveLength(30);
    // posters by their tag, search and social by the referring site, the rest direct; the three cities, then the rest
    expect(f.range.week.src).toEqual([30, 50, 20, 50]);
    expect(f.range.week.cities).toEqual([80, 0, 40, 30]);
    expect(f['growth.sources_30d']).toEqual([['Posters', 30, 6, 0], ['Direct', 50, 2, 0], ['Social', 20, 0, 0], ['Search', 50, 0, 0]]);
    expect(f['growth.referrers']).toEqual([['google.com', 50], ['instagram.com', 20], ['someblog.net', 5]]);
    expect(f['growth.landing']).toEqual([['/join', 120, 8], ['/', 60, 0]]);
    expect(f['growth.cities']).toEqual({ Redlands: 80, Riverside: 40, Fontana: 10 });
    expect(f['growth.devices']).toEqual([['Phone', 150], ['Desktop', 50], ['Tablet', 5]]);
    expect(f['growth.returning']).toEqual([['New', 150], ['Returning', 55]]);
    expect(f['growth.site.pages']).toEqual([['/join', 300], ['/how', 40]]);
    // the hour of the week: every visit at 9, so each day's 9 o'clock holds a seventh
    expect(f['growth.heat']).toHaveLength(7);
    expect(f['growth.heat'][0].v[9]).toBeCloseTo(4 / 28, 6);
    expect(f['growth.heat'].reduce((a: number, d: any) => a + d.v.reduce((x: number, y: number) => x + y, 0), 0)).toBeCloseTo(1, 6);
    expect(f['growth.weekly.visits_by_source'].Posters).toEqual(Array(12).fill(30));
    expect(f['growth.phone_share'].slice(-2)).toEqual([73.2, 73.2]);
  });
});

describe('Growth and Home, live', () => {
  beforeAll(async () => {
    process.env.PROVIDER_GROWTH = 'live';
    // the form submissions this week and the week before
    const add = (form: string, at: string) =>
      db.query(`INSERT INTO command.form_submissions (first_name, last_name, email, form, city, source, received_at, status, live) VALUES ('A', 'B', 'a@b.test', $1, 'Redlands', 'Website', $2, 'New', true)`, [form, at]);
    await add('Waitlist', '2026-10-24T10:00:00Z');
    await add('Waitlist', '2026-10-22T10:00:00Z');
    await add('Shop enquiry', '2026-10-21T10:00:00Z');
    await add('Waitlist', '2026-10-15T10:00:00Z');
    await add('Waitlist', '2026-10-14T10:00:00Z');
    await db.query(`INSERT INTO command.waitlist (email, name, joined_at) VALUES ('w1@x.test', 'W', '2026-10-22T10:00:00Z'), ('w2@x.test', 'W', '2026-10-01T10:00:00Z')`);
  });
  const read = () => growthSection(db, { level: TOTALS, reveal: false, now: new Date(NOW) }) as Promise<any>;

  test('the ranges: the site’s visits, with Command’s forms, poster scans and the join rate before', async () => {
    const g = await read();
    const r = g.figures['growth.range'];
    expect(r.week).toMatchObject({ visits: 700, forms: [2, 1, 0, 0], scans: 30, top: [], act: 0 });
    // 2 joins in the 560 visits of the 7 days before
    expect(r.week.joinPrev).toBe(0.4);
    expect(r.today.forms).toEqual([1, 0, 0, 0]);
    expect(r.week.prevVisits).toBeUndefined();
    expect(g.figures['growth.referrers']).toEqual([['google.com', 50], ['instagram.com', 20], ['someblog.net', 5]]);
    // the seed's sample submissions aren't counted or listed: only what the site sent
    const listed: any = await growthSection(db, { level: 2 as any, reveal: false, now: new Date(NOW) });
    expect(listed.INBOX).toHaveLength(5);
  });

  test('the weeks of joins are the waitlist’s', async () => {
    const g = await read();
    expect(g.figures['growth.weekly.joined'].reduce((a: number, b: number) => a + b, 0)).toBe(2);
    expect(g.figures['growth.weekly.joined'].at(-1)).toBe(1);
  });

  test('Home draws the same ranges', async () => {
    const h: any = await homeSection(db, { level: TOTALS, reveal: false, now: new Date(NOW) });
    expect(h.figures['growth.range'].week).toMatchObject({ visits: 700, forms: [2, 1, 0, 0] });
  });

  test('with Members live, every section counts the member app’s members', async () => {
    process.env.PROVIDER_MEMBERS = 'live';
    const memberSource: MemberSource = {
      roster: async () => [
        { id: 1, createdAt: NOW - 86_400_000, lastSeen: null, inviteCode: null, wallets: ['0x1'], name: null, city: 'Redlands' },
        { id: 2, createdAt: NOW - 86_400_000, lastSeen: null, inviteCode: null, wallets: ['0x2'], name: null, city: 'Redlands' },
      ],
      milestones: async () => new Map([['0x1', { funded: { at: NOW - 3600e3, with: 'bank' as const } }]]),
    };
    const o = { level: TOTALS, reveal: false, now: new Date(NOW), memberSource } as const;
    const h: any = await homeSection(db, o);
    expect(h.MEMBER_SUMMARY).toEqual({ invited: 2, active: 1, opened: 1, notOpened: 0, funded: { bank: 1, five: 0, deposit: 0 } });
    expect(h.figures['members.first_spends.poster_ten']).toBe(0);
    const g: any = await growthSection(db, o);
    expect(g.MEMBER_SUMMARY).toEqual({ invited: 2, opened: 1, active: 1, funded: { Bank: 1, $5: 0, Deposit: 0 } });
    expect(g.figures['growth.range'].today.act).toBe(1);
    delete process.env.PROVIDER_MEMBERS;
    const m: any = await moneySection(db, { ...o, level: 1 as any });
    expect(m.MEMBER_SUMMARY.active).toBeGreaterThan(0);
  });
});
