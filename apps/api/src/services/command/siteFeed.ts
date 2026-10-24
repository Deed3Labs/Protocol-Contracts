import { DAY } from '@clear/command-types';
import type { Feed } from './feeds.js';

/*
 * Site visits from Plausible (Phase 7c): useclear.org's analytics, read through the Stats API v2 every
 * 15 minutes (COMMAND_SITE_MINUTES) with PLAUSIBLE_API_KEY, into the shapes Growth and Home draw. Joins
 * are Plausible's "Join" goal, which the site's form sends when the API has kept the answer.
 *
 * Every visit falls in one of the prototype's four sources: Posters (a poster's QR carries
 * utm_source=poster), Search, Social, and Direct, which is everything else. About two dozen queries a
 * sync, well inside Plausible's 600 an hour.
 */

type Env = Record<string, string | undefined>;
type Row = { dimensions: string[]; metrics: number[] };
type Query = { metrics: string[]; date_range: string | [string, string]; dimensions?: string[]; filters?: unknown[]; order_by?: unknown[]; pagination?: { limit: number } };

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
  const key = env.PLAUSIBLE_API_KEY?.trim();
  const site = env.PLAUSIBLE_SITE_ID?.trim() || 'useclear.org';
  const base = (env.PLAUSIBLE_API_URL?.trim() || 'https://plausible.io').replace(/\/+$/, '');
  const q = async (body: Query): Promise<Row[]> => {
    const r = await f(`${base}/api/v2/query`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: site, ...body }) });
    if (!r.ok) throw new Error(`Plausible ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
    return ((await r.json()) as { results: Row[] }).results;
  };
  const JOIN = [['is', 'event:goal', ['Join']]];
  return {
    id: 'site',
    everyMs: (Number(env.COMMAND_SITE_MINUTES) > 0 ? Number(env.COMMAND_SITE_MINUTES) : 15) * 60_000,
    off: () => (!key ? 'PLAUSIBLE_API_KEY isn’t set' : null),
    async sync() {
      const t = now();
      const today = Math.floor(t / DAY) * DAY;
      const days = (from: number, n: number): [string, string] => [iso(from - (n - 1) * DAY), iso(from)];
      const series = async (range: string | [string, string], dim: 'time:hour' | 'time:day', slots: string[]) => {
        const rows = await q({ metrics: ['visits'], date_range: range, dimensions: [dim] });
        const by = new Map(rows.map((r) => [r.dimensions[0].slice(0, dim === 'time:hour' ? 13 : 10), r.metrics[0]]));
        return slots.map((s) => by.get(s) ?? 0);
      };
      const split = async (range: string | [string, string]) => {
        const [src, city, page] = await Promise.all([
          q({ metrics: ['visits'], date_range: range, dimensions: ['visit:source'] }),
          q({ metrics: ['visits'], date_range: range, dimensions: ['visit:city_name'] }),
          q({ metrics: ['visits'], date_range: range, dimensions: ['visit:entry_page'], order_by: [['visits', 'desc']], pagination: { limit: 1 } }),
        ]);
        const s = SOURCES.map((k) => src.filter((r) => sourceOf(r.dimensions[0]) === k).reduce((a, r) => a + r.metrics[0], 0));
        const total = s.reduce((a, b) => a + b, 0);
        const c = TOP_CITIES.map((k) => city.filter((r) => r.dimensions[0] === k).reduce((a, r) => a + r.metrics[0], 0));
        return { src: s, cities: [...c, Math.max(0, total - c.reduce((a, b) => a + b, 0))], page: page[0] ? [page[0].dimensions[0], page[0].metrics[0]] : ['/', 0] };
      };

      // today by the hour so far, against the same day last week
      const hourNow = new Date(t).getUTCHours();
      const hours = (d: number) => Array.from({ length: hourNow + 1 }, (_, h) => `${iso(d)} ${String(h).padStart(2, '0')}`);
      const [todaySpark, todayPrev, todaySplit] = await Promise.all([series(days(today, 1), 'time:hour', hours(today)), series(days(today - 7 * DAY, 1), 'time:hour', hours(today - 7 * DAY)), split('day')]);
      // the last 7 and 30 days by the day, against the period before
      const dayList = (end: number, n: number) => Array.from({ length: n }, (_, i) => iso(end - (n - 1 - i) * DAY));
      const [weekSpark, weekPrev, weekSplit, monthSpark, monthPrev, monthSplit] = await Promise.all([
        series(days(today, 7), 'time:day', dayList(today, 7)),
        series(days(today - 7 * DAY, 7), 'time:day', dayList(today - 7 * DAY, 7)),
        split(days(today, 7)),
        series(days(today, 30), 'time:day', dayList(today, 30)),
        series(days(today - 30 * DAY, 30), 'time:day', dayList(today - 30 * DAY, 30)),
        split(days(today, 30)),
      ]);
      const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
      const weekday = DAYS[new Date(today).getUTCDay()];
      const range = {
        today: { name: 'Today', visits: sum(todaySpark), delta: pctDelta(sum(todaySpark), sum(todayPrev.slice(0, todaySpark.length)), `last ${weekday}`), axis: ['00:00', `${String(Math.floor(hourNow / 2)).padStart(2, '0')}:00`, 'Now'], spark: todaySpark, prev: todayPrev, prevName: `Last ${weekday.slice(0, 3)}`, prevVisits: sum(todayPrev), ...todaySplit },
        week: { name: '7 days', visits: sum(weekSpark), delta: pctDelta(sum(weekSpark), sum(weekPrev), 'the 7 days before'), axis: [dowDay(today - 6 * DAY), dowDay(today - 3 * DAY), dowDay(today)], spark: weekSpark, prev: weekPrev, prevName: '7 days before', prevVisits: sum(weekPrev), ...weekSplit },
        month: { name: '30 days', visits: sum(monthSpark), delta: pctDelta(sum(monthSpark), sum(monthPrev), 'the 30 days before'), axis: [dayMon(today - 29 * DAY), dayMon(today - 15 * DAY), dayMon(today)], spark: monthSpark, prev: monthPrev, prevName: '30 days before', prevVisits: sum(monthPrev), ...monthSplit },
      };

      const last30 = days(today, 30);
      const weeks12: [string, string] = [iso(today - 83 * DAY), iso(today)];
      const [srcAll, srcJoins, cities, refs, landing, landingJoins, devices, pages, heatRows, weekSrc, weekDev, agg] = await Promise.all([
        q({ metrics: ['visits'], date_range: last30, dimensions: ['visit:source'] }),
        q({ metrics: ['visitors'], date_range: last30, dimensions: ['visit:source'], filters: JOIN }),
        q({ metrics: ['visits'], date_range: last30, dimensions: ['visit:city_name'], order_by: [['visits', 'desc']], pagination: { limit: 12 } }),
        q({ metrics: ['visits'], date_range: last30, dimensions: ['visit:referrer'], order_by: [['visits', 'desc']], pagination: { limit: 20 } }),
        q({ metrics: ['visits'], date_range: last30, dimensions: ['visit:entry_page'], order_by: [['visits', 'desc']], pagination: { limit: 8 } }),
        q({ metrics: ['visitors'], date_range: last30, dimensions: ['visit:entry_page'], filters: JOIN }),
        q({ metrics: ['visits'], date_range: last30, dimensions: ['visit:device'] }),
        q({ metrics: ['pageviews'], date_range: last30, dimensions: ['event:page'], order_by: [['pageviews', 'desc']], pagination: { limit: 6 } }),
        q({ metrics: ['visits'], date_range: days(today, 28), dimensions: ['time:hour'] }),
        q({ metrics: ['visits'], date_range: weeks12, dimensions: ['time:week', 'visit:source'] }),
        q({ metrics: ['visits'], date_range: weeks12, dimensions: ['time:week', 'visit:device'] }),
        q({ metrics: ['visitors', 'visits'], date_range: last30 }),
      ]);
      const joinsBy = (rows: Row[], key: (d: string) => string) => rows.reduce((m, r) => m.set(key(r.dimensions[0]), (m.get(key(r.dimensions[0])) ?? 0) + r.metrics[0]), new Map<string, number>());
      const srcJoin = joinsBy(srcJoins, sourceOf);
      const pageJoin = joinsBy(landingJoins, (p) => p);
      // a referrer is its site, not its full address
      const host = (u: string) => {
        try {
          return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '');
        } catch {
          return u;
        }
      };
      const refBy = refs.filter((r) => r.dimensions[0] && !/^Direct/i.test(r.dimensions[0])).reduce((m, r) => m.set(host(r.dimensions[0]), (m.get(host(r.dimensions[0])) ?? 0) + r.metrics[0]), new Map<string, number>());
      // each hour of the week's share of the last 4 weeks' visits, Monday first
      const heatTotal = sum(heatRows.map((r) => r.metrics[0])) || 1;
      const heat = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => ({
        d,
        v: Array.from({ length: 24 }, (_, h) => sum(heatRows.filter((r) => DOW[new Date(r.dimensions[0].replace(' ', 'T') + 'Z').getUTCDay()] === d && Number(r.dimensions[0].slice(11, 13)) === h).map((r) => r.metrics[0])) / heatTotal),
      }));
      const weekStarts = [...new Set(weekSrc.map((r) => r.dimensions[0]).concat(weekDev.map((r) => r.dimensions[0])))].sort().slice(-12);
      const pad = (a: number[]) => [...Array(Math.max(0, 12 - a.length)).fill(0), ...a];
      const bySource = Object.fromEntries(SOURCES.map((k) => [k, pad(weekStarts.map((w) => sum(weekSrc.filter((r) => r.dimensions[0] === w && sourceOf(r.dimensions[1]) === k).map((r) => r.metrics[0]))))]));
      const phoneShare = pad(weekStarts.map((w) => {
        const all = sum(weekDev.filter((r) => r.dimensions[0] === w).map((r) => r.metrics[0]));
        return all ? Math.round((sum(weekDev.filter((r) => r.dimensions[0] === w && /mobile|phone/i.test(r.dimensions[1])).map((r) => r.metrics[0])) / all) * 1000) / 10 : 0;
      }));
      const device = (re: RegExp) => sum(devices.filter((r) => re.test(r.dimensions[0])).map((r) => r.metrics[0]));
      const [visitors, visits] = agg[0]?.metrics ?? [0, 0];

      return {
        figures: {
          range,
          'growth.weekly.visits_by_source': bySource,
          'growth.cities': Object.fromEntries(cities.filter((r) => r.dimensions[0] && r.dimensions[0] !== '(none)').map((r) => [r.dimensions[0], r.metrics[0]])),
          'growth.sources_30d': SOURCES.map((k) => [k, sum(srcAll.filter((r) => sourceOf(r.dimensions[0]) === k).map((r) => r.metrics[0])), srcJoin.get(k) ?? 0, 0]),
          'growth.referrers': [...refBy].sort((a, b) => b[1] - a[1]).slice(0, 6),
          'growth.landing': landing.map((r) => [r.dimensions[0], r.metrics[0], pageJoin.get(r.dimensions[0]) ?? 0]),
          'growth.heat': heat,
          'growth.devices': [['Phone', device(/mobile|phone/i)], ['Desktop', device(/desktop|laptop/i)], ['Tablet', device(/tablet/i)]],
          'growth.phone_share': phoneShare,
          // Plausible keeps no returning visitors: a visit by someone already counted this month is the closest
          'growth.returning': [['New', visitors], ['Returning', Math.max(0, visits - visitors)]],
          'growth.visitors_ratio': visits ? Math.round((visitors / visits) * 100) / 100 : 0,
          'growth.site.pages': pages.map((r) => [r.dimensions[0], r.metrics[0]]),
        },
      };
    },
  };
}
