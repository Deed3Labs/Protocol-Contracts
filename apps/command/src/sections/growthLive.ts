// @ts-nocheck: reads the section data the API fills, which is untyped, as the sections are.
import { BOARDS, CITY_V, COHORTS, DESIGNS, HEAT, LANDING, OTHERS, POSTERS, SHOPS, SRC30, W_ACT, W_INV, W_JOIN, W_SRC, vars } from './data';

/*
 * Growth's datasets, live (growth2.tsx reads these in place of the reference's when REAL): built from what
 * the API's growth section sends (live/sections.ts fills ./data from it). What the API doesn't measure yet
 * is zero or empty, never the reference's figures; docs/ui-redesign-plan.md lists each gap:
 * invites, opens and first spends by source, city, shop and design; weekly opens and first spends;
 * bounce and time on page; browsers; campaigns; the apps' usage and errors; the waitlist's people.
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
    PROPS: visits ? [['useclear.org', visits, 'var(--fg)']] : [],
    CHANNELS: SRC30.map(([n, v, j]) => [n, v, 0, v ? Math.round((j / v) * 1000) / 10 : 0, 0, []]),
    PAGES: LANDING.map(([p, e, j]) => [p, 'useclear.org', e, 0, 0, j]),
    DEV: fig['growth.devices'] ?? [],
    BROWSERS: [],
    TF_CITY: Object.entries(CITY_V).map(([n, v]) => [n, v, postersIn(n)]),
    W_CH: Object.fromEntries(Object.entries(W_SRC).map(([k, v]) => [k, [...v]])),
    LIVE: [],
    CAMPS: [],
    FEAT: { member: [], merchant: [] },
    ONB: [
      ['Opened the invite', sum.opened ?? 0],
      ['Funded: bank, $5 or direct deposit', funded],
      ['Active', sum.active ?? 0],
    ],
    ERRS: [],
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
