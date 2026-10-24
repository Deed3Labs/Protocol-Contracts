import { DAY } from '@clear/command-types';
import type { Feed } from './feeds.js';

/*
 * Site visits from Umami (Phase 9): useclear.org's analytics, self-hosted on Railway, read through its
 * API every 15 minutes (COMMAND_SITE_MINUTES) into the shapes Growth and Home draw. Command signs in as
 * a view-only Umami user (UMAMI_USERNAME, UMAMI_PASSWORD) for the site UMAMI_WEBSITE_ID at
 * UMAMI_API_URL. Joins are the site's "Join" event, which its form sends when the API has kept the answer.
 *
 * Every visitor falls in one of the prototype's four sources: Posters (a poster's QR carries
 * utm_source=poster), Search and Social by the referring site, and Direct, which is everyone else.
 * Umami's breakdowns count visitors (distinct sessions), so the visits here are visitors.
 * Written against Umami v3.4.
 */

type Env = Record<string, string | undefined>;
type XY = { x: string | null; y: number | string };
type Stats = { pageviews: number | string; visitors: number | string; visits: number | string };

export const SOURCES = ['Posters', 'Direct', 'Social', 'Search'] as const;
const SEARCH = /google|bing|duckduckgo|yahoo|ecosia|brave|baidu|yandex|startpage/i;
const SOCIAL = /instagram|facebook|fb\b|tiktok|nextdoor|twitter|^x$|x\.com|t\.co|reddit|linkedin|youtube|threads|pinterest|snapchat|whatsapp|bluesky/i;
/** A visit's source, as the prototype groups them. */
export const sourceOf = (s: string) => (/poster/i.test(s) ? 'Posters' : SEARCH.test(s) ? 'Search' : SOCIAL.test(s) ? 'Social' : 'Direct');
/** The page's three cities, then everyone else. */
export const TOP_CITIES = ['Redlands', 'San Bernardino', 'Riverside'];

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayMon = (t: number) => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
const dowDay = (t: number) => `${DOW[new Date(t).getUTCDay()]} ${new Date(t).getUTCDate()}`;
const pctDelta = (now: number, prev: number, on: string) => (prev ? `${now >= prev ? '+' : '−'}${Math.abs(((now - prev) / prev) * 100).toFixed(1)}% on ${on}` : `No visits ${on} to compare`);

export function siteFeed(env: Env = process.env, f: typeof fetch = fetch, now = () => Date.now()): Feed {
  const base = (env.UMAMI_API_URL?.trim() || '').replace(/\/+$/, '');
  const site = env.UMAMI_WEBSITE_ID?.trim();
  const user = env.UMAMI_USERNAME?.trim();
  const pass = env.UMAMI_PASSWORD;
  // one sign-in shared by the calls that run at once
  let token: Promise<string> | null = null;
  const login = async () => {
    const r = await f(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) });
    if (!r.ok) throw new Error(`Umami sign-in ${r.status}`);
    const b = (await r.json()) as { token?: string };
    if (!b.token) throw new Error('Umami gave no token: turn two-factor off for Command’s user');
    return b.token;
  };
  // a token lasts until Umami restarts or the password changes: on a 401, sign in again once
  const get = async <T>(path: string, params: Record<string, string | number | undefined>): Promise<T> => {
    const qs = new URLSearchParams(Object.entries(params).flatMap(([k, v]): [string, string][] => (v == null || v === '' ? [] : [[k, String(v)]])));
    for (let again = true; ; again = false) {
      const signedIn = (token ??= login());
      const t = await signedIn.catch((e) => {
        if (token === signedIn) token = null;
        throw e;
      });
      const r = await f(`${base}/api/websites/${site}/${path}?${qs}`, { headers: { Authorization: `Bearer ${t}` } });
      if (r.status === 401 && again) {
        if (token === signedIn) token = null;
        continue;
      }
      if (!r.ok) throw new Error(`Umami ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
      return (await r.json()) as T;
    }
  };
  const n = (v: number | string | undefined) => Number(v ?? 0) || 0;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  // [from, to): whole UTC days, the end exclusive
  const span = (from: number, to: number) => ({ startAt: from, endAt: to - 1 });
  const JOIN = { event: 'Join' };
  const metrics = (type: string, from: number, to: number, extra: Record<string, string | number> = {}) => get<XY[]>('metrics', { type, ...span(from, to), limit: 500, ...extra });
  const stats = (from: number, to: number, extra: Record<string, string> = {}) => get<Stats>('stats', { ...span(from, to), ...extra });
  /** Visitors per hour or per day, in the slots asked for ("2026-10-24 09", "2026-10-24"). */
  const series = async (from: number, to: number, unit: 'hour' | 'day', slots: string[]) => {
    const { sessions } = await get<{ sessions: XY[] }>('pageviews', { ...span(from, to), unit, timezone: 'UTC' });
    const by = new Map(sessions.map((p) => [String(p.x).replace('T', ' ').slice(0, unit === 'hour' ? 13 : 10), n(p.y)]));
    return slots.map((s) => by.get(s) ?? 0);
  };
  /** Visitors by source, in SOURCES' order: posters by their UTM tag, search and social by the referring site, the rest direct. */
  const sources = async (from: number, to: number, extra: Record<string, string> = {}) => {
    const [st, refs, utm] = await Promise.all([stats(from, to, extra), metrics('referrer', from, to, extra), metrics('utmSource', from, to, extra)]);
    const posters = sum(utm.filter((r) => sourceOf(r.x ?? '') === 'Posters').map((r) => n(r.y)));
    const social = sum(refs.filter((r) => r.x && sourceOf(r.x) === 'Social').map((r) => n(r.y)));
    const search = sum(refs.filter((r) => r.x && sourceOf(r.x) === 'Search').map((r) => n(r.y)));
    return [posters, Math.max(0, n(st.visitors) - posters - social - search), social, search];
  };
  return {
    id: 'site',
    everyMs: (Number(env.COMMAND_SITE_MINUTES) > 0 ? Number(env.COMMAND_SITE_MINUTES) : 15) * 60_000,
    off: () => (!base || !site ? 'UMAMI_API_URL and UMAMI_WEBSITE_ID aren’t set' : !user || !pass ? 'UMAMI_USERNAME and UMAMI_PASSWORD aren’t set' : null),
    async sync() {
      const t = now();
      const today = Math.floor(t / DAY) * DAY;
      const split = async (from: number, to: number) => {
        const [src, city, page] = await Promise.all([sources(from, to), metrics('city', from, to), metrics('entry', from, to, { limit: 1 })]);
        const total = sum(src);
        const c = TOP_CITIES.map((k) => sum(city.filter((r) => r.x === k).map((r) => n(r.y))));
        return { src, cities: [...c, Math.max(0, total - sum(c))], page: page[0] ? [page[0].x ?? '/', n(page[0].y)] : ['/', 0] };
      };

      // today by the hour so far, against the same day last week
      const hourNow = new Date(t).getUTCHours();
      const hours = (d: number) => Array.from({ length: hourNow + 1 }, (_, h) => `${iso(d)} ${String(h).padStart(2, '0')}`);
      const [todaySpark, todayPrev, todaySplit] = await Promise.all([
        series(today, today + DAY, 'hour', hours(today)),
        series(today - 7 * DAY, today - 6 * DAY, 'hour', hours(today - 7 * DAY)),
        split(today, today + DAY),
      ]);
      // the last 7 and 30 days by the day, against the period before
      const dayList = (end: number, k: number) => Array.from({ length: k }, (_, i) => iso(end - (k - 1 - i) * DAY));
      const back = (k: number, before = 0) => [today - (k - 1 + before) * DAY, today + DAY - before * DAY] as const;
      const [weekSpark, weekPrev, weekSplit, monthSpark, monthPrev, monthSplit] = await Promise.all([
        series(...back(7), 'day', dayList(today, 7)),
        series(...back(7, 7), 'day', dayList(today - 7 * DAY, 7)),
        split(...back(7)),
        series(...back(30), 'day', dayList(today, 30)),
        series(...back(30, 30), 'day', dayList(today - 30 * DAY, 30)),
        split(...back(30)),
      ]);
      const weekday = DAYS[new Date(today).getUTCDay()];
      const range = {
        today: { name: 'Today', visits: sum(todaySpark), delta: pctDelta(sum(todaySpark), sum(todayPrev.slice(0, todaySpark.length)), `last ${weekday}`), axis: ['00:00', `${String(Math.floor(hourNow / 2)).padStart(2, '0')}:00`, 'Now'], spark: todaySpark, prev: todayPrev, prevName: `Last ${weekday.slice(0, 3)}`, prevVisits: sum(todayPrev), ...todaySplit },
        week: { name: '7 days', visits: sum(weekSpark), delta: pctDelta(sum(weekSpark), sum(weekPrev), 'the 7 days before'), axis: [dowDay(today - 6 * DAY), dowDay(today - 3 * DAY), dowDay(today)], spark: weekSpark, prev: weekPrev, prevName: '7 days before', prevVisits: sum(weekPrev), ...weekSplit },
        month: { name: '30 days', visits: sum(monthSpark), delta: pctDelta(sum(monthSpark), sum(monthPrev), 'the 30 days before'), axis: [dayMon(today - 29 * DAY), dayMon(today - 15 * DAY), dayMon(today)], spark: monthSpark, prev: monthPrev, prevName: '30 days before', prevVisits: sum(monthPrev), ...monthSplit },
      };

      const [from30, to30] = back(30);
      // the last 12 weeks, each the 7 days to a day of today's week
      const weeks = Array.from({ length: 12 }, (_, i) => back(7, (11 - i) * 7));
      // a join's source and landing page: the Join event's own referrer, UTM tag and page
      const [src30, srcJoins, cities, refs, landing, landingJoins, devices, pages, heatRows, weekSrc, weekDev, agg] = await Promise.all([
        sources(from30, to30),
        sources(from30, to30, JOIN),
        metrics('city', from30, to30, { limit: 12 }),
        metrics('referrer', from30, to30, { limit: 20 }),
        metrics('entry', from30, to30, { limit: 8 }),
        metrics('entry', from30, to30, JOIN),
        metrics('device', from30, to30),
        metrics('path', from30, to30, { limit: 6 }),
        get<{ sessions: XY[] }>('pageviews', { ...span(today - 27 * DAY, today + DAY), unit: 'hour', timezone: 'UTC' }).then((r) => r.sessions),
        Promise.all(weeks.map(([a, b]) => sources(a, b))),
        Promise.all(weeks.map(([a, b]) => metrics('device', a, b))),
        stats(from30, to30),
      ]);
      // each hour of the week's share of the last 4 weeks' visitors, Monday first
      const heatTotal = sum(heatRows.map((r) => n(r.y))) || 1;
      const at = (r: XY) => new Date(String(r.x).replace(' ', 'T').replace(/Z?$/, 'Z'));
      const heat = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => ({
        d,
        v: Array.from({ length: 24 }, (_, h) => sum(heatRows.filter((r) => DOW[at(r).getUTCDay()] === d && at(r).getUTCHours() === h).map((r) => n(r.y))) / heatTotal),
      }));
      const bySource = Object.fromEntries(SOURCES.map((k, i) => [k, weekSrc.map((w) => w[i])]));
      const phone = (rows: XY[]) => sum(rows.filter((r) => /mobile|phone/i.test(r.x ?? '')).map((r) => n(r.y)));
      const phoneShare = weekDev.map((rows) => {
        const all = sum(rows.map((r) => n(r.y)));
        return all ? Math.round((phone(rows) / all) * 1000) / 10 : 0;
      });
      const device = (re: RegExp) => sum(devices.filter((r) => re.test(r.x ?? '')).map((r) => n(r.y)));
      const pageJoin = new Map(landingJoins.map((r) => [r.x, n(r.y)]));
      const visitors = n(agg.visitors),
        visits = n(agg.visits);

      return {
        figures: {
          range,
          'growth.weekly.visits_by_source': bySource,
          'growth.cities': Object.fromEntries(cities.filter((r) => r.x).map((r) => [r.x, n(r.y)])),
          'growth.sources_30d': SOURCES.map((k, i) => [k, src30[i], srcJoins[i], 0]),
          // Umami keeps the referring site already, not its full address
          'growth.referrers': refs.filter((r) => r.x).map((r) => [String(r.x).replace(/^www\./, ''), n(r.y)]).slice(0, 6),
          'growth.landing': landing.map((r) => [r.x ?? '/', n(r.y), pageJoin.get(r.x) ?? 0]),
          'growth.heat': heat,
          'growth.devices': [['Phone', device(/mobile|phone/i)], ['Desktop', device(/desktop|laptop/i)], ['Tablet', device(/tablet/i)]],
          'growth.phone_share': phoneShare,
          // a visit by someone already counted in the 30 days is the closest to returning
          'growth.returning': [['New', visitors], ['Returning', Math.max(0, visits - visitors)]],
          'growth.visitors_ratio': visits ? Math.round((visitors / visits) * 100) / 100 : 0,
          'growth.site.pages': pages.map((r) => [r.x ?? '/', n(r.y)]),
        },
      };
    },
  };
}
