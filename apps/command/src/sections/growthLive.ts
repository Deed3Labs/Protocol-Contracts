// @ts-nocheck: reads the section data the API fills, which is untyped, as the sections are.
import { BOARDS, CITY_V, COHORTS, DESIGNS, HEAT, LANDING, OTHERS, POSTERS, SHOPS, SRC30, W_ACT, W_INV, W_JOIN, W_SRC, vars } from './data';

/*
 * Growth's datasets, live (growth2.tsx reads these in place of the reference's when REAL): built from what
 * the API's growth section sends (live/sections.ts fills ./data from it). What the API doesn't measure yet
 * is zero or empty, never the reference's figures; docs/ui-redesign-plan.md lists each gap:
 * invites, opens and first spends by source, city, shop and design; weekly opens and first spends;
 * bounce and time on page; browsers; what campaigns cost; the waitlist's people.
 * Traffic's Right now reads GET /growth/now itself (growth2.tsx, pollNow).
 */

/** The days the page draws: twelve weeks to today, as the API's weekly figures count them. */
const DAYS = 12 * 7 - 1;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The batches an invite week came from, as the grid labels it; 0 is an account opened without an invite. */
const batchName = (bs) => {
  const n = bs.filter((b) => b > 0);
  const name = !n.length ? '' : n.length === 1 ? `Batch ${n[0]}` : `Batches ${n[0]}–${n[n.length - 1]}`;
  return bs.includes(0) ? (name ? `${name} + no invite` : 'No invite') : name;
};

/** Cohorts' invite weeks (the API's growth.invite_weeks), as renderCohorts reads them: day indexes against `start`, shares of the activated. */
function cohortsLive(c, start) {
  const pc = (v, of) => (of ? Math.round((v / of) * 1000) / 10 : 0);
  return {
    COH: (c?.weeks ?? []).map((w) => {
      const d = new Date(w.start);
      return {
        d: Math.round((w.start - start.getTime()) / 864e5),
        n: `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`,
        b: batchName(w.batches),
        inv: w.inv,
        act: w.act,
        open: w.open,
        keep: pc(w.keep, w.act),
        spent: pc(w.spent, w.act),
        actBy: w.actBy,
        spentBy: w.spentBy,
      };
    }),
    COH_TT: c?.tt ?? [0, 0, 0, 0, 0, 0],
    // how they funded: label, activated, still active %, colour (the reference's three)
    COH_HOW: (c?.how ?? []).map(([n, a, k], i) => [n === 'Deposit' ? 'Direct deposit' : n === 'Bank' ? 'Connected a bank' : 'Added $5', a, a ? Math.round((k / a) * 100) : 0, ['var(--fg)', 'var(--land)', 'var(--live)'][i]]),
    COH_MEDIAN: c?.medianDays ?? null,
  };
}

/** The apps' own usage (the API's growth.apps, from Umami), as renderApps reads it: day-indexed against `start`, features as shares of the week's visitors. */
function appsLive(a, start) {
  const days = (u) => {
    const out = new Array(DAYS + 1).fill(0);
    (u?.daily ?? []).forEach((v, i) => {
      const d = Math.round((a.from + i * 864e5 - start.getTime()) / 864e5);
      if (d >= 0 && d <= DAYS) out[d] = v;
    });
    return out;
  };
  const week = (u) => u?.week ?? { visitors: 0, visits: 0 };
  const feats = (u) => (u?.feats ?? []).map(([n, v, s]) => [n, u.week.visitors ? Math.min(100, Math.round((v / u.week.visitors) * 100)) : 0, s]);
  // an error as its kind and page ("TypeError on /send"), most first; nobody owns one yet
  const errs = (u, app) =>
    (u?.errors ?? []).map(([t, n]) => {
      const [page, kind] = t.split(' · ');
      return { t: kind ? `${kind} on ${page}` : t, app, n, sev: n >= 10 ? 'absent' : n >= 3 ? 'underway' : 'live', own: null, prog: null };
    });
  return {
    APPS_ON: { member: !!a?.member, merchant: !!a?.merchant },
    AD: { m: days(a?.member), s: days(a?.merchant) },
    AWEEK: { member: week(a?.member), merchant: week(a?.merchant) },
    FEAT: { member: feats(a?.member), merchant: feats(a?.merchant) },
    ERRS: [...errs(a?.member, 'member'), ...errs(a?.merchant, 'merchant')].sort((x, y) => y.n - x.n),
  };
}

export function growthLive() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - DAYS);
  const W_VIS = W_JOIN.map((_, i) => Object.values(W_SRC).reduce((a, s) => a + (s[i] ?? 0), 0));
  const zeros = W_JOIN.map(() => 0);
  const postersIn = (city) => POSTERS.filter((p) => p.city === city).length;
  // the last four weeks: the 30-day figures' window, near enough for the stages counted by week
  const last4 = (W) => W.slice(-4).reduce((a, v) => a + v, 0);
  const shops = [...SHOPS, ...(BOARDS?.length ? [BOARDS] : []), ...(OTHERS?.length ? [OTHERS] : [])].filter((s) => s.length);
  const sources = SRC30.map(([n, v, j, a]) => ({ n, f: [v, j, 0, 0, a, 0] }));
  // invites aren't counted by source: they're a row of their own, so the funnel's totals stay whole
  const inv = last4(W_INV);
  if (inv) sources.push({ n: 'Not by source', f: [0, 0, inv, 0, 0, 0] });
  const visits = SRC30.reduce((a, r) => a + r[1], 0);
  const fig = vars.growthFigures ?? {};
  const sum = vars.memberSummary ?? {};
  const funded = sum.funded ? (sum.funded.bank ?? 0) + (sum.funded.five ?? 0) + (sum.funded.deposit ?? 0) : 0;
  return {
    TODAY: DAYS,
    D0: [start.getFullYear(), start.getMonth(), start.getDate()],
    W_VIS,
    W_JOIN: [...W_JOIN],
    W_INV: [...W_INV],
    W_ACT: [...W_ACT],
    W_OPEN: zeros,
    W_SPEND: zeros,
    D: {
      source: { name: 'Source', rows: sources },
      city: { name: 'City', rows: Object.entries(CITY_V).map(([n, v]) => ({ n, f: [v, 0, 0, 0, 0, 0], s: postersIn(n) ? `${postersIn(n)} posters` : 'No posters' })) },
      shop: { name: 'Shop', posters: 1, rows: shops.map((s) => ({ n: s[1], s: `${s[7]} · ${s[2]} posters`, f: [s[3], s[4], 0, 0, s[5], s[6]] })) },
      design: {
        name: 'Design',
        posters: 1,
        rows: Object.entries(DESIGNS).map(([code, d]) => ({ n: `${code} · ${d.name}`, s: `${d.posters} posters`, f: [d.scans ?? 0, d.joined ?? 0, 0, 0, 0, 0] })),
      },
      page: { name: 'Page', onlyStep: 0, rows: LANDING.map(([n, e, j]) => ({ n, f: [e, j] })) },
      week: { name: 'Invite week', minStep: 2 },
    },
    COHORT: COHORTS.map((c) => [c[0], c[1], [...c[2]]]),
    ...cohortsLive(fig['growth.invite_weeks'], start),
    ...appsLive(fig['growth.apps'], start),
    PROPS: visits ? [['useclear.org', visits, 'var(--fg)']] : [],
    CHANNELS: SRC30.map(([n, v, j]) => [n, v, 0, v ? Math.round((j / v) * 1000) / 10 : 0, 0, []]),
    PAGES: LANDING.map(([p, e, j]) => [p, 'useclear.org', e, 0, 0, j]),
    DEV: fig['growth.devices'] ?? [],
    BROWSERS: [],
    TF_CITY: Object.entries(CITY_V).map(([n, v]) => [n, v, postersIn(n)]),
    W_CH: Object.fromEntries(Object.entries(W_SRC).map(([k, v]) => [k, [...v]])),
    LIVE: [],
    // until the site feed counts the untagged, all of the 30 days is untagged
    ...campaigns(fig, start, [visits, SRC30.reduce((a, r) => a + r[2], 0)]),
    ONB: [
      ['Opened the invite', sum.opened ?? 0],
      ['Funded: bank, $5 or direct deposit', funded],
      ['Active', sum.active ?? 0],
    ],
    WAIT_NEXT: [],
    WAIT_NEW: [],
    LIVE_POOL: [],
    // the waitlist now (the API counts it from command.waitlist); a median of null is no one invited yet
    // each hour of the week's share of visits, Monday first; visitors per visit
    HEAT: HEAT.map((x) => ({ d: x.d, v: [...x.v] })),
    visitorsRatio: fig['growth.visitors_ratio'] ?? 0,
    WL: { waiting: 0, joined: 0, medianDays: null, ...(fig['growth.waitlist'] ?? {}) },
  };
}

/**
 * Campaigns, live: each poster design (Command's own posters and waitlist) and each tagged link the site
 * feed counted (utm_campaign), on the page's day grid, with Untagged the rest. What it cost is what people recorded
 * (growth.campaign_costs) plus, for a poster design, the $10 offers its people spent at the poster's shop; a
 * campaign with neither has no known cost (costs empty, offers null). A step nothing measures is null.
 */
function campaigns(fig, start, all) {
  const DAY = 864e5;
  const dayOf = (t) => {
    const d = new Date(t);
    return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / DAY);
  };
  // a site feed day ('2026-10-24', UTC) on the local grid
  const isoDay = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Math.round((new Date(y, m - 1, d) - start) / DAY);
  };
  const today = dayOf(Date.now());
  const none = { print: null, offer: null, ads: null, credit: null };
  // each recorded cost on the day grid, by campaign
  const costs = (key) => (fig['growth.campaign_costs'] ?? []).filter((c) => c.campaign === key).map((c) => ({ ...c, d: dayOf(c.on) }));
  const posters = (fig['growth.poster_campaigns'] ?? []).map((c) => ({
    id: `d:${c.code}`,
    key: `design:${c.code}`,
    costs: costs(`design:${c.code}`),
    offers: c.offers ? c.offers.map(dayOf) : null,
    code: c.code,
    n: c.name,
    sub: `Poster design ${c.code}`,
    type: 'Posters',
    start: dayOf(c.first),
    end: null,
    posters: c.posters,
    ...none,
    f: [c.visits, c.joins, c.invited, c.opened, c.active, c.spent],
    utm: `utm_source=poster · design ${c.code}`,
    note: '',
  }));
  const tagged = (fig['growth.campaigns'] ?? [])
    .filter((c) => c.first)
    .map((c, i) => {
      const last = isoDay(c.last);
      return {
        id: `u:${i}`,
        key: `utm:${c.name}`,
        costs: costs(`utm:${c.name}`),
        offers: null,
        n: c.name,
        sub: [c.source, c.medium].filter(Boolean).join(' · ') || 'Tagged links',
        type: c.type,
        start: isoDay(c.first),
        // nobody from it in a week: it has ended
        end: today - last > 7 ? last : null,
        posters: 0,
        ...none,
        f: [c.visits, c.joins, null, null, null, null],
        utm: ['campaign=' + c.name, c.source && 'source=' + c.source, c.medium && 'medium=' + c.medium].filter(Boolean).join(' · '),
        note: '',
      };
    });
  const [uv, uj] = fig['growth.untagged'] ?? all;
  return { CAMPS: [...posters, ...tagged], UNTAGGED: { n: 'Untagged', sub: 'Direct, search and links without tags', f: [uv, uj, null, null, null, null] } };
}
