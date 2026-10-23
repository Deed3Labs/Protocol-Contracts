// @ts-nocheck: writes into the sections' untyped data (src/sections/data.tsx).
import {
  BATCH_DATE,
  BOARDS,
  B_ACT,
  B_OPEN,
  CITY_V,
  COHORTS,
  DESIGNS,
  HEAT,
  INBOX,
  LANDING,
  LATER,
  MEMBERS,
  OTHERS,
  POSTERS,
  RANGE,
  REFS,
  SHOPS,
  SHOP_INFO,
  SHOP_NO,
  SRC30,
  STOPS,
  W_ACT,
  W_INV,
  W_JOIN,
  W_SRC,
  W_VIS,
  W_WAIT,
  WEEKS,
  vars,
} from '../sections/data';
import { api } from './api';
import { LIVE } from './env';
import { setFigures } from './figures';

/*
 * Sections whose rows and figures come from the API (Phase 3). Each one loads the first time it's
 * opened; until then the page shows the prototype's loading state. Sections not listed here still
 * draw the prototype's demo data.
 */
export const SERVED = new Set(['members', 'growth', 'field']);
const ready = new Set<string>();

export const needsData = (route: string) => LIVE && SERVED.has(route) && !ready.has(route);

const replace = (arr, rows) => arr.splice(0, arr.length, ...rows);
/** An object the sections import, its keys replaced in place. */
const assign = (obj, value) => {
  for (const k of Object.keys(obj)) delete obj[k];
  Object.assign(obj, value);
};

/** The batch waiting for approval, keeping Members' full record when Growth only knows its number. */
function nextBatch(n) {
  vars.NEXT_BATCH = n && vars.NEXT_BATCH?.number === n.number ? vars.NEXT_BATCH : n;
}

const apply = {
  growth(d) {
    replace(POSTERS, d.POSTERS);
    assign(DESIGNS, d.DESIGNS);
    replace(INBOX, d.INBOX ?? []);
    nextBatch(d.NEXT_BATCH);
    vars.memberSummary = d.MEMBER_SUMMARY;
    vars.formNamesShown = d.names === 'shown';
    // the datasets Growth draws are stored figures; the derived ones are worked out again from them
    const f = d.figures;
    assign(RANGE, f['growth.range']);
    replace(W_JOIN, f['growth.weekly.joined']);
    replace(W_INV, f['growth.weekly.invited']);
    replace(W_ACT, f['growth.weekly.activated']);
    assign(W_SRC, f['growth.weekly.visits_by_source']);
    replace(W_VIS, WEEKS.map((_, i) => Object.values(W_SRC).reduce((a, s) => a + s[i], 0)));
    let c = 0;
    replace(W_WAIT, W_JOIN.map((j, i) => (c += j - W_INV[i])));
    assign(CITY_V, f['growth.cities']);
    replace(SRC30, f['growth.sources_30d']);
    replace(REFS, f['growth.referrers']);
    replace(LANDING, f['growth.landing']);
    replace(HEAT, f['growth.heat']);
    replace(COHORTS, f['growth.cohorts']);
    replace(SHOPS, f['growth.shops']);
    replace(BOARDS, f['growth.boards']);
    replace(OTHERS, f['growth.others']);
    assign(SHOP_NO, Object.fromEntries(SHOPS.map((s, i) => [s[0], i + 1])));
  },
  field(d) {
    replace(POSTERS, d.POSTERS);
    assign(DESIGNS, d.DESIGNS);
    // each task points at its poster, as the prototype's start-up linked them
    replace(STOPS, d.STOPS.map((s) => ({ ...s, tasks: s.tasks.map((t) => (t.n ? { ...t, p: POSTERS.find((p) => p.n === t.n) } : t)) })));
    replace(LATER, d.LATER);
    assign(SHOP_INFO, d.SHOP_INFO);
    vars.ROUTE = d.ROUTE;
  },
  members(d) {
    replace(MEMBERS, d.MEMBERS);
    replace(BATCH_DATE, d.BATCH_DATE);
    replace(B_ACT, d.B_ACT);
    replace(B_OPEN, d.B_OPEN);
    vars.NEXT_BATCH = d.NEXT_BATCH;
    vars.namesShown = d.names === 'shown';
  },
};

export async function loadSection(route: string, opts: { reveal?: boolean } = {}) {
  const d = await api('GET', `/sections/${route}${opts.reveal ? '?reveal=1' : ''}`);
  apply[route](d);
  setFigures(d.figures);
  vars.asOf = d.asOf;
  ready.add(route);
}

/** Signing out forgets what was loaded, so the next person's view loads their own. */
export const forgetSections = () => ready.clear();
