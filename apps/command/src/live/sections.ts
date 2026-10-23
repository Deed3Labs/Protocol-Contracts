// @ts-nocheck: writes into the sections' untyped data (src/sections/data.tsx).
import {
  ACCTS,
  AP_BAL,
  AP_REQ,
  BATCH_DATE,
  BOARD,
  BOARDS,
  BONDS,
  BUYERS,
  B_ACT,
  B_OPEN,
  CITY_V,
  COHORTS,
  COOP_W,
  COST_W,
  DESIGNS,
  ENTRIES,
  FLEET,
  FLOWS,
  GP_W,
  HEAT,
  INBOX,
  INCOMING,
  LANDING,
  LATER,
  LINE_COSTS,
  M,
  MEMBERS,
  ORDERS,
  ORD_W,
  OTHERS,
  OWED,
  PAID_WITH,
  PARTNERS,
  POSTERS,
  PR,
  PRE,
  PROSPECTS,
  RANGE,
  REFS,
  RETURNS,
  REV_W,
  RTD_W,
  SHELF_EV,
  SHIP_DAYS,
  SHIST,
  SHOP,
  SHOPS,
  SHOP_COSTS,
  SHOP_INFO,
  SHOP_NO,
  SIGNED,
  SIZE_MIX,
  SRC30,
  STK,
  STOPS,
  SW,
  TX,
  TXO,
  UNSEC,
  WEEKS,
  W_ACT,
  W_INV,
  W_JOIN,
  W_SRC,
  W_VIS,
  W_WAIT,
  XS,
  Y,
  YD,
  Y_ASSETS,
  Y_DEP,
  Y_LENT,
  goods,
  gpWeeks,
  shopTotals,
  vars,
} from '../sections/data';
import { T } from '../sections/merchants';
import { unitCost } from '../sections/shop';
import { api } from './api';
import { LIVE } from './env';
import { setFigures } from './figures';

/*
 * Sections whose rows and figures come from the API (Phase 3). Each one loads the first time it's
 * opened; until then the page shows the prototype's loading state. Sections not listed here still
 * draw the prototype's demo data.
 */
export const SERVED = new Set(['members', 'growth', 'field', 'merchants', 'money', 'shop']);
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
  merchants(d) {
    replace(TX, d.TX);
    replace(TXO, TX.map(T));
    replace(SIGNED, d.SIGNED);
    replace(PROSPECTS, d.PROSPECTS);
    assign(OWED, d.OWED);
    replace(BOARD, d.BOARD);
    replace(FLEET, d.FLEET);
    // the board is built from BOARD the next time it's drawn
    XS.board = null;
  },
  money(d) {
    // YLD is the same object as Y, so assigning Y updates both
    assign(M, d.M);
    assign(Y, d.Y);
    replace(YD, d.YD);
    replace(Y_ASSETS, d.Y_ASSETS);
    replace(Y_LENT, d.Y_LENT);
    replace(Y_DEP, d.Y_DEP);
    replace(AP_BAL, d.AP_BAL);
    replace(UNSEC, d.UNSEC);
    replace(AP_REQ, d.AP_REQ);
    replace(RTD_W, d.RTD_W);
    replace(COOP_W, d.COOP_W);
    replace(FLOWS, d.FLOWS);
    replace(BONDS, d.BONDS);
    replace(ACCTS, d.ACCTS);
    assign(ENTRIES, d.ENTRIES);
    replace(TX, d.TX);
    replace(TXO, TX.map(T));
    vars.memberSummary = { ...vars.memberSummary, ...d.MEMBER_SUMMARY };
    if (d.SET_ASIDE) vars.setAside = d.SET_ASIDE;
  },
  shop(d) {
    replace(PR, d.PR);
    replace(goods, PR.filter((p) => !p.dep));
    assign(STK, d.STK);
    assign(SHELF_EV, d.SHELF_EV);
    assign(SHIST, d.SHIST);
    replace(ORDERS, d.ORDERS);
    replace(PRE, d.PRE);
    replace(INCOMING, d.INCOMING);
    replace(RETURNS, d.RETURNS);
    const f = d.figures;
    replace(ORD_W, f['shop.orders_weekly']);
    assign(SHOP_COSTS, f['shop.costs']);
    replace(LINE_COSTS, f['shop.line_costs']);
    replace(SIZE_MIX, f['shop.size_mix']);
    replace(PARTNERS, f['shop.pickups']);
    replace(SHIP_DAYS, f['shop.ship_days']);
    replace(BUYERS, f['shop.buyers']);
    replace(PAID_WITH, f['shop.paid_with']);
    // the weekly sales and the 4-week totals are worked out again from the rows, as the prototype did
    replace(REV_W, SW.map((_, i) => goods.reduce((a, p) => a + p.wk[i] * p.price, 0)));
    replace(COST_W, SW.map((_, i) => goods.reduce((a, p) => a + p.wk[i] * unitCost(p), 0)));
    assign(SHOP, shopTotals());
    replace(GP_W, gpWeeks());
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
