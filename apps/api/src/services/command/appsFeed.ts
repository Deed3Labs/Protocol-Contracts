import { DAY } from '@clear/command-types';
import type { Feed } from './feeds.js';
import { umamiClient } from './siteFeed.js';

/*
 * The apps' own usage, from Umami (Growth › Apps): the member app (app.useclear.org) and the merchant app
 * (merchant.useclear.org), each its own website in the co-op's Umami (UMAMI_MEMBER_WEBSITE_ID,
 * UMAMI_MERCHANT_WEBSITE_ID), read with the site feed's view-only sign-in every 15 minutes. Both apps
 * count page views only once someone is signed in (on shift, for the merchant app), so a day's visitors
 * are the members, or the shop devices, that opened the app that day. Errors arrive as events named
 * "Error · <page> · <kind>", never a message. Counts only.
 */

type Env = Record<string, string | undefined>;
type XY = { x: string | null; y: number | string };
type Stats = { pageviews: number | string; visitors: number | string; visits: number | string };
type Filter = { path: string } | { event: string };

export type AppKey = 'member' | 'merchant';
/** Each feature: its name, what counts as using it, and the page or event that says so. */
export const FEATURES: Record<AppKey, [string, string, Filter][]> = {
  member: [
    ['Check balance', 'Opened the home screen', { path: '/' }],
    ['Pay at a shop', 'Approved a charge at a partner', { event: 'charge_approved' }],
    ['Add money', 'Added money to Clear', { event: 'deposit_completed' }],
    ['Send', 'Sent money to someone', { event: 'send_completed' }],
    ['Savings', 'Opened savings', { path: '/savings' }],
    ['Card', 'Opened the card', { path: '/card' }],
    ['Activity', 'Opened activity', { path: '/activity' }],
  ],
  merchant: [
    ['Take a payment', 'Opened a new charge', { path: '/new' }],
    ['Charges', 'Looked through charges', { path: '/charges' }],
    ['Payouts', 'Opened payouts', { path: '/payouts' }],
    ['Inventory', 'Opened inventory', { path: '/inventory' }],
    ['Close out', 'Closed out a day', { path: '/close' }],
    ['Staff', 'Opened staff', { path: '/staff' }],
    ['Settings', 'Opened settings', { path: '/settings' }],
  ],
};
/** The days the daily counts cover: twelve weeks to today, as Growth draws them. */
export const APP_DAYS = 12 * 7;
const ERROR = /^Error · /;

export interface AppUsage {
  /** Visitors each day, oldest first, the last today. */
  daily: number[];
  /** Visitors and visits in the last 7 days. */
  week: { visitors: number; visits: number };
  /** Each feature: name, visitors in the last 7 days who used it, what it means. */
  feats: [string, number, string][];
  /** Each error in the last 7 days: its page and kind, and how many times. */
  errors: [string, number][];
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function appsFeed(env: Env = process.env, f: typeof fetch = fetch, now = () => Date.now()): Feed {
  const umami = umamiClient(env, f);
  const ids: Record<AppKey, string | undefined> = { member: env.UMAMI_MEMBER_WEBSITE_ID?.trim(), merchant: env.UMAMI_MERCHANT_WEBSITE_ID?.trim() };
  const n = (v: number | string | undefined) => Number(v ?? 0) || 0;

  async function usage(key: AppKey, id: string, today: number): Promise<AppUsage> {
    const site = <T>(path: string, params: Record<string, string | number | undefined>) => umami.get<T>(`/api/websites/${id}/${path}`, params);
    const from = today - (APP_DAYS - 1) * DAY,
      to = today + DAY;
    const wk = { startAt: today - 6 * DAY, endAt: to - 1 };
    const [series, week, events, feats] = await Promise.all([
      site<{ sessions: XY[] }>('pageviews', { startAt: from, endAt: to - 1, unit: 'day', timezone: 'UTC' }),
      site<Stats>('stats', wk),
      site<XY[]>('metrics', { type: 'event', ...wk, limit: 500 }),
      Promise.all(FEATURES[key].map(([, , filter]) => site<Stats>('stats', { ...wk, ...filter }))),
    ]);
    const by = new Map(series.sessions.map((p) => [String(p.x).replace('T', ' ').slice(0, 10), n(p.y)]));
    return {
      daily: Array.from({ length: APP_DAYS }, (_, i) => by.get(iso(from + i * DAY)) ?? 0),
      week: { visitors: n(week.visitors), visits: n(week.visits) },
      feats: FEATURES[key].map(([name, note], i) => [name, n(feats[i].visitors), note]),
      errors: events
        .filter((e) => e.x && ERROR.test(e.x))
        .map((e): [string, number] => [String(e.x).replace(ERROR, ''), n(e.y)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    };
  }

  return {
    id: 'apps',
    everyMs: (Number(env.COMMAND_SITE_MINUTES) > 0 ? Number(env.COMMAND_SITE_MINUTES) : 15) * 60_000,
    off: () => umami.off() ?? (!ids.member && !ids.merchant ? 'UMAMI_MEMBER_WEBSITE_ID and UMAMI_MERCHANT_WEBSITE_ID aren’t set' : null),
    async sync() {
      const today = Math.floor(now() / DAY) * DAY;
      const [member, merchant] = await Promise.all([ids.member ? usage('member', ids.member, today) : null, ids.merchant ? usage('merchant', ids.merchant, today) : null]);
      // the first day the daily counts are for, so the page can line them up with its own days
      return { figures: { 'growth.apps': { from: today - (APP_DAYS - 1) * DAY, member, merchant } } };
    },
  };
}
