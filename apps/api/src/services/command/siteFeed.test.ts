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
 * Phase 7c: useclear.org's visits from Plausible's Stats API (a stand-in here), in the shapes Growth
 * and Home draw, with the forms, the join rate and the activations from Command's own records; and
 * every section's member counts from the member app once Members is live.
 */

const NOW = Date.parse('2026-10-24T15:30:00Z');
const asked: any[] = [];
const auth: Array<string | null> = [];
const JOINED = (b: any) => JSON.stringify(b.filters ?? []).includes('Join');
const results = (b: any): Array<[string[], number[]]> => {
  const d = b.dimensions ?? [];
  const [from, to] = Array.isArray(b.date_range) ? b.date_range : [b.date_range, b.date_range];
  if (!d.length) return [[[], [150, 205]]];
  if (d[0] === 'time:hour') {
    // 4 weeks: one visit at 09:00 every day; a single day: 10 visits an hour (5 the week before)
    if (from !== to) return Array.from({ length: 28 }, (_, i) => [[`${new Date(Date.parse(to) - i * 86_400_000).toISOString().slice(0, 10)} 09:00:00`], [1]]);
    return Array.from({ length: 24 }, (_, h) => [[`${from} ${String(h).padStart(2, '0')}:00:00`], [from === '2026-10-24' ? 10 : 5]]);
  }
  if (d[0] === 'time:day') {
    const n = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    return Array.from({ length: n }, (_, i) => [[new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10)], [to === '2026-10-24' ? 100 : 80]]);
  }
  if (d[0] === 'time:week') return d[1] === 'visit:source' ? [[['2026-10-12', 'poster'], [30]], [['2026-10-19', 'Google'], [50]], [['2026-10-19', 'poster'], [10]]] : [[['2026-10-12', 'Mobile'], [3]], [['2026-10-12', 'Desktop'], [1]], [['2026-10-19', 'Mobile'], [1]]];
  if (d[0] === 'visit:source') return JOINED(b) ? [[['poster'], [6]], [['Direct / None'], [2]]] : [[['Direct / None'], [100]], [['Google'], [50]], [['poster'], [30]], [['Instagram'], [20]], [['Some Blog'], [5]]];
  if (d[0] === 'visit:city_name') return [[['Redlands'], [80]], [['Riverside'], [40]], [['Fontana'], [10]], [['(none)'], [3]]];
  if (d[0] === 'visit:entry_page') return JOINED(b) ? [[['/join'], [8]]] : b.pagination?.limit === 1 ? [[['/join'], [120]]] : [[['/join'], [120]], [['/'], [60]]];
  if (d[0] === 'visit:referrer') return [[['https://www.instagram.com/clear'], [12]], [['instagram.com'], [8]], [['google.com'], [50]], [['Direct / None'], [100]]];
  if (d[0] === 'visit:device') return [[['Mobile'], [150]], [['Desktop'], [50]], [['Tablet'], [5]]];
  if (d[0] === 'event:page') return [[['/join'], [300]], [['/how'], [40]]];
  return [];
};
const plausible = (async (_u: string, init?: RequestInit) => {
  const b = JSON.parse(String(init!.body));
  asked.push(b);
  auth.push(new Headers(init!.headers).get('authorization'));
  return new Response(JSON.stringify({ results: results(b).map(([dimensions, metrics]) => ({ dimensions, metrics })) }));
}) as unknown as typeof fetch;

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
  test('off without a Stats API key', () => {
    expect(siteFeed({}).off()).toBe('PLAUSIBLE_API_KEY isn’t set');
  });

  test('a visit’s source, as the prototype groups them', () => {
    expect(['poster', 'Google', 'DuckDuckGo', 'Instagram', 'Nextdoor', 't.co', 'Direct / None', 'Some Blog'].map(sourceOf)).toEqual(['Posters', 'Search', 'Search', 'Social', 'Social', 'Social', 'Direct', 'Direct']);
  });

  test('reads the site’s visits into Growth’s shapes', async () => {
    expect(await runFeed(db, siteFeed({ PLAUSIBLE_API_KEY: 'key', PLAUSIBLE_SITE_ID: 'useclear.org' }, plausible, () => NOW))).toBe('ok');
    expect(auth.every((a) => a === 'Bearer key')).toBe(true);
    expect(asked.every((b) => b.site_id === 'useclear.org')).toBe(true);
    // two dozen queries or so: well inside the 600 an hour
    expect(asked.length).toBeLessThan(30);
    const f = (await feedRows(db)).get('site')!.figures;
    // today runs to 15:00, at 10 an hour, against 5 an hour the same day last week
    expect(f.range.today).toMatchObject({ name: 'Today', visits: 160, delta: '+100.0% on last Saturday', prevName: 'Last Sat', page: ['/join', 120] });
    expect(f.range.today.spark).toHaveLength(16);
    expect(f.range.week).toMatchObject({ visits: 700, delta: '+25.0% on the 7 days before', axis: ['Sun 18', 'Wed 21', 'Sat 24'], prevVisits: 560 });
    expect(f.range.month.spark).toHaveLength(30);
    // posters, direct (with the blog), social, search; the three cities, then the rest
    expect(f.range.week.src).toEqual([30, 105, 20, 50]);
    expect(f.range.week.cities).toEqual([80, 0, 40, 85]);
    expect(f['growth.sources_30d']).toEqual([['Posters', 30, 6, 0], ['Direct', 105, 2, 0], ['Social', 20, 0, 0], ['Search', 50, 0, 0]]);
    expect(f['growth.referrers']).toEqual([['google.com', 50], ['instagram.com', 20]]);
    expect(f['growth.landing']).toEqual([['/join', 120, 8], ['/', 60, 0]]);
    expect(f['growth.cities']).toEqual({ Redlands: 80, Riverside: 40, Fontana: 10 });
    expect(f['growth.devices']).toEqual([['Phone', 150], ['Desktop', 50], ['Tablet', 5]]);
    expect(f['growth.returning']).toEqual([['New', 150], ['Returning', 55]]);
    // the hour of the week: every visit at 9, so each day's 9 o'clock holds a seventh
    expect(f['growth.heat']).toHaveLength(7);
    expect(f['growth.heat'][0].v[9]).toBeCloseTo(4 / 28, 6);
    expect(f['growth.heat'].reduce((a: number, d: any) => a + d.v.reduce((x: number, y: number) => x + y, 0), 0)).toBeCloseTo(1, 6);
    expect(f['growth.weekly.visits_by_source'].Posters.slice(-2)).toEqual([30, 10]);
    expect(f['growth.phone_share'].slice(-2)).toEqual([75, 100]);
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
    expect(g.figures['growth.referrers']).toEqual([['google.com', 50], ['instagram.com', 20]]);
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
