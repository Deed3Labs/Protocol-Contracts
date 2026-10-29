import { sourceOf, umamiClient } from './siteFeed.js';

/*
 * Who's on useclear.org right now, for Growth's Right now panel: Umami's real-time view (the last 30
 * minutes), read when a page asks and kept for a few seconds so many open pages make one call. Someone
 * is on the site now when their last event was in the last five minutes, as Umami's own active count
 * has it. Nothing that tells one person from another leaves here: each person is the page they're on
 * and where they came from, and the feed a page, a source, a country, a device and a time.
 */

type Env = Record<string, string | undefined>;
type XY = { x: string; y: number | string };
interface RealtimeEvent {
  __type?: string;
  sessionId?: string;
  eventName?: string | null;
  createdAt?: string;
  urlPath?: string | null;
  referrerDomain?: string | null;
  country?: string | null;
  device?: string | null;
}
interface Realtime {
  events?: RealtimeEvent[];
  series?: { visitors?: XY[] };
}

/** One person on the site now: the page they're on and the source they came from. */
export interface NowPerson {
  page: string;
  ch: string;
}
/** An arrival in the last 30 minutes. */
export interface NowArrival {
  page: string;
  ch: string;
  from: string;
  place: string;
  dev: string;
  at: number;
}
export interface SiteNow {
  people: NowPerson[];
  /** Visitors each minute for the last 30 minutes, oldest first, this minute last. */
  mins: number[];
  /** On the site at this time last week. */
  wk: number;
  /** The latest arrivals, newest first. */
  feed: NowArrival[];
  at: number;
}

const MIN = 60_000;
/** Active: an event in the last five minutes (Umami's own window for its active count). */
const ACTIVE = 5 * MIN;

/** A page as the panel groups them: no query, a poster page's shop and a product left out. */
export const pageOf = (p: string | null | undefined) => {
  const path = (p || '/').split(/[?#]/)[0] || '/';
  if (/^\/s\//.test(path)) return '/s/:shop';
  const first = path.split('/').filter(Boolean)[0];
  return first ? `/${first}` : '/';
};
const deviceOf = (d: string | null | undefined) => (/mobile|phone/i.test(d ?? '') ? 'Phone' : /tablet/i.test(d ?? '') ? 'Tablet' : d ? 'Desktop' : 'Unknown device');
const regions = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();
const placeOf = (c: string | null | undefined) => {
  if (!c) return 'Somewhere';
  try {
    return regions?.of(c.toUpperCase()) ?? c;
  } catch {
    return c;
  }
};
const at = (s: string | undefined) => (s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`) : NaN);

export function siteNow(env: Env = process.env, f: typeof fetch = fetch, now = () => Date.now()) {
  const umami = umamiClient(env, f);
  const realtime = (extra: Record<string, string> = {}) => umami.get<Realtime>(`/api/realtime/${umami.site}`, { unit: 'minute', timezone: 'UTC', ...extra });
  return {
    off: umami.off,
    async read(): Promise<SiteNow> {
      const t = now();
      const weekAgo = t - 7 * 24 * 60 * MIN;
      // the poster QR's utm_source isn't in the real-time events: the same view, posters only, says which sessions it is
      const [all, posters, wk] = await Promise.all([
        realtime(),
        realtime({ utmSource: 'poster' }),
        umami.website<{ visitors: number | string }>('stats', { startAt: weekAgo - ACTIVE, endAt: weekAgo }),
      ]);
      const fromPoster = new Set((posters.events ?? []).map((e) => e.sessionId).filter(Boolean));
      // each session's first and last event in the window ('session' rows repeat a session's first event)
      const sessions = new Map<string, { first: RealtimeEvent; last: RealtimeEvent; firstAt: number; lastAt: number; times: number[] }>();
      for (const e of all.events ?? []) {
        if (e.__type === 'session' || !e.sessionId) continue;
        const ts = at(e.createdAt);
        if (!Number.isFinite(ts)) continue;
        const s = sessions.get(e.sessionId);
        if (!s) sessions.set(e.sessionId, { first: e, last: e, firstAt: ts, lastAt: ts, times: [ts] });
        else {
          s.times.push(ts);
          if (ts < s.firstAt) Object.assign(s, { first: e, firstAt: ts });
          if (ts >= s.lastAt) Object.assign(s, { last: e, lastAt: ts });
        }
      }
      const chOf = (id: string, ref: string | null | undefined) => (fromPoster.has(id) ? 'Posters' : sourceOf(ref ?? ''));
      const fromOf = (id: string, ref: string | null | undefined) => (fromPoster.has(id) ? 'a poster' : ref ? ref.replace(/^www\./, '') : 'a typed link');
      const list = [...sessions.entries()];
      const people = list.filter(([, s]) => t - s.lastAt <= ACTIVE).map(([id, s]) => ({ page: pageOf(s.last.urlPath), ch: chOf(id, s.first.referrerDomain) }));
      const feed = list
        .sort((a, b) => b[1].firstAt - a[1].firstAt)
        .slice(0, 20)
        .map(([id, s]) => ({ page: pageOf(s.first.urlPath), ch: chOf(id, s.first.referrerDomain), from: fromOf(id, s.first.referrerDomain), place: placeOf(s.first.country), dev: deviceOf(s.first.device), at: s.firstAt }));
      // on the site each minute, in the 30 slots ending this one, by the same five-minute rule as now
      const thisMin = Math.floor(t / MIN) * MIN;
      const slots = Array.from({ length: 30 }, (_, i) => thisMin - (29 - i) * MIN);
      let mins = slots.map((m) => list.filter(([, s]) => s.times.some((x) => x >= m + MIN - ACTIVE && x < m + MIN)).length);
      // Umami sends at most 100 events: past that the oldest minutes are missing, and its own count a minute is closer
      if ((all.events?.length ?? 0) >= 100) {
        const byMin = new Map((all.series?.visitors ?? []).map((p) => [Math.floor(at(p.x) / MIN) * MIN, Number(p.y) || 0]));
        mins = slots.map((m) => byMin.get(m) ?? 0);
      }
      mins[29] = people.length;
      return { people, mins, wk: Number(wk.visitors) || 0, feed, at: t };
    },
  };
}

/** The reader behind GET /growth/now: one Umami read every `keepMs` at most, shared by everyone asking. */
export function cachedSiteNow(reader: Pick<ReturnType<typeof siteNow>, 'off' | 'read'> = siteNow(), keepMs = 15_000, now = () => Date.now()) {
  let kept: { at: number; p: Promise<SiteNow> } | null = null;
  return {
    off: reader.off,
    read(): Promise<SiteNow> {
      const t = now();
      if (kept && t - kept.at < keepMs) return kept.p;
      const p = reader.read();
      kept = { at: t, p };
      // a failed read isn't kept: the next ask tries again
      p.catch(() => {
        if (kept?.p === p) kept = null;
      });
      return p;
    },
  };
}
