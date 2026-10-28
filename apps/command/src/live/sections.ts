// @ts-nocheck: writes into the sections' untyped data (src/sections/data.tsx).
import { zero } from './empty';
import {
  ACCTS,
  AGENDA,
  AGR,
  ALERTS0,
  APPR,
  AP_BAL,
  AP_REQ,
  BATCH_DATE,
  BOARD,
  BOARDS,
  BONDS,
  BUYERS,
  B_ACT,
  B_OPEN,
  CH,
  CHAIN,
  CH_DONE,
  CITY_V,
  CODE,
  COHORTS,
  COOP_W,
  CATALOG,
  COST_HIST,
  COST_W,
  COVER,
  CTR,
  CTR_NOTE,
  DCOUNT,
  DEADLINES,
  DESIGNS,
  DOCS,
  DSTATE_N,
  EDGES,
  ENT,
  ENTF,
  ENTRIES,
  FILINGS,
  FLEET,
  FLOWS,
  FUNNEL,
  GBOARDS,
  GP_W,
  HEAT,
  INBOX,
  INCOMING,
  INPUTS,
  KEY_ROLES,
  LANDING,
  LATER,
  LINE_COSTS,
  LOG,
  M,
  MATERIALS,
  MATTERS,
  MEETING,
  MEETINGS_HELD,
  MEETS,
  MEMBERS,
  ORDERS,
  ORD_W,
  OTHERS,
  OWED,
  OWN,
  PAID_WITH,
  PARENT,
  PARTNERS,
  PASTV,
  PENDING,
  PEOPLE,
  POSTERS,
  PR,
  PRE,
  PROSPECTS,
  RANGE,
  REFS,
  RECIPES,
  REL,
  RELEASES,
  RESOS,
  RETURNS,
  REV_W,
  RUNS,
  RP,
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
  SIGNERS,
  SIGN_W,
  SIZE_MIX,
  SRC30,
  STK,
  STOPS,
  SW,
  TTL,
  TX,
  TXD,
  TXO,
  UNDER,
  UNSEC,
  VOTE,
  WEEK,
  WEEKS,
  WHO,
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
import { shortId } from './account';
import { api } from './api';
import { LIVE } from './env';
import { setFigures } from './figures';

/*
 * Sections whose rows and figures come from the API (Phase 3). Each one loads the first time it's
 * opened; until then the page shows the prototype's loading state. Sections not listed here still
 * draw the prototype's demo data.
 */
export const SERVED = new Set(['home', 'members', 'growth', 'field', 'merchants', 'money', 'shop', 'contracts', 'governance', 'records']);
const ready = new Set<string>();
let loads = 0;
/** Counts the sections loaded: a redesigned page built from older data is built again (pageHost.tsx). */
export const dataStamp = () => loads;

/** The API's section a page reads: Build is Contracts' (the redesign renamed the page, not the section). */
const sectionOf = (route: string) => (route === 'build' ? 'contracts' : route);
export const needsData = (route: string) => LIVE && SERVED.has(sectionOf(route)) && !ready.has(sectionOf(route));

// what the API doesn't send yet (a figure nothing has written: no seed since Phase 9) empties the list
const replace = (arr, rows) => arr.splice(0, arr.length, ...(rows ?? []));
/** An object the sections import, its keys replaced in place. */
// what the API doesn't send keeps its fields, blank, as the empty preview draws them (a record, say CHAIN, read field by field)
const assign = (obj, value) => {
  if (value == null) return void zero(obj);
  for (const k of Object.keys(obj)) delete obj[k];
  Object.assign(obj, value);
};

/**
 * The member counts several sections send. Home sends funded as {bank, five, deposit} and Growth as
 * {Bank, $5, Deposit}; whichever loaded last, both shapes are there for the pages that read them.
 */
function mergeSummary(sum) {
  const m = { ...vars.memberSummary, ...sum };
  const f = m.funded ?? {};
  const bank = f.bank ?? f.Bank ?? 0,
    five = f.five ?? f.$5 ?? 0,
    deposit = f.deposit ?? f.Deposit ?? 0;
  m.funded = { bank, five, deposit, Bank: bank, $5: five, Deposit: deposit };
  vars.memberSummary = m;
}

/** The batch waiting for approval, keeping Members' full record when Growth only knows its number. */
function nextBatch(n) {
  vars.NEXT_BATCH = n && vars.NEXT_BATCH?.number === n.number ? vars.NEXT_BATCH : n;
}

/** "3", "0.25": up to 4 places. */
const qty = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 });
/** A material at or under its low mark, as one of Home's alerts: it opens Shop's Inventory. */
function lowAlert(m) {
  const on = Number(m.onHand) || 0;
  const left = on > 0 ? `${qty(on)} ${m.unit} left` : on < 0 ? `none left, ${qty(-on)} ${m.unit} short` : 'none left';
  return {
    t: `Low on ${m.name}: ${left}, ${on < m.lowMark ? 'under' : 'at'} its mark of ${qty(m.lowMark)}`,
    sev: on <= 0 ? 'absent' : 'underway',
    area: 'Shop',
    age: 'Materials kept on hand',
    go: 'shop',
    spane: 'inventory',
    fix: 'stock',
  };
}

const apply = {
  growth(d) {
    replace(POSTERS, d.POSTERS);
    assign(DESIGNS, d.DESIGNS);
    replace(INBOX, d.INBOX ?? []);
    nextBatch(d.NEXT_BATCH);
    mergeSummary(d.MEMBER_SUMMARY);
    vars.formNamesShown = d.names === 'shown';
    // the datasets Growth draws are stored figures; the derived ones are worked out again from them
    const f = d.figures;
    vars.growthFigures = f;
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
    // the board is the API's from now on, even when it's empty
    vars.boardLoaded = true;
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
    mergeSummary(d.MEMBER_SUMMARY);
    if (d.SET_ASIDE) vars.setAside = d.SET_ASIDE;
    // live, Lithic's card spend and what's moving through Bridge (Phase 6b)
    vars.cardSpend = d.CARD_SPEND ?? null;
    vars.depositRail = d.DEPOSIT_RAIL ?? null;
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
    // what goes into each product (Phase 10): below See the API sends them empty
    replace(INPUTS, d.INPUTS);
    for (const k of Object.keys(RECIPES)) delete RECIPES[k];
    Object.assign(RECIPES, d.RECIPES ?? {});
    assign(MATERIALS, { onHand: [], low: [], makes: {}, covers: {}, ...(d.MATERIALS ?? {}) });
    // the recent production runs (Phase 10c)
    replace(RUNS, d.RUNS);
    // each product's cost at sale, by week (Phase 10d)
    for (const k of Object.keys(COST_HIST)) delete COST_HIST[k];
    Object.assign(COST_HIST, d.COST_HIST ?? {});
    // what the store shows of each catalog product (Phase 11b)
    for (const k of Object.keys(CATALOG)) delete CATALOG[k];
    Object.assign(CATALOG, d.CATALOG ?? {});
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
    // live, the cost of what sold is each sale's recorded cost (Phase 10d), so past margins stay as they were
    replace(COST_W, f['shop.cost_weekly'] ?? SW.map((_, i) => goods.reduce((a, p) => a + p.wk[i] * unitCost(p), 0)));
    assign(SHOP, shopTotals());
    replace(GP_W, gpWeeks());
  },
  contracts(d) {
    replace(AGR, d.AGR);
    replace(CTR, d.CTR);
    assign(CTR_NOTE, d.CTR_NOTE);
    replace(REL, d.REL);
    replace(EDGES, REL.filter((r) => r[4] !== null));
    assign(RELEASES, d.RELEASES);
    assign(PENDING, d.PENDING);
    replace(CH, d.CH);
    replace(CH_DONE, d.CH_DONE);
    // live only, the Code tab: GitHub's commits, pull requests, branches and contributors
    assign(CODE, d.CODE);
    vars.contractsNow = d.NOW;
    // live, the map's contracts the indexer found deployed (null when the section isn't read from the chain)
    vars.contractsDeployed = d.DEPLOYED ?? null;
    replace(SIGNERS, d.SIGNERS);
    const f = d.figures;
    assign(CHAIN, f['contracts.chain']);
    assign(KEY_ROLES, f['contracts.key_roles']);
    replace(TTL, f['contracts.draft_to_live']);
    assign(SIGN_W, f['contracts.signatures_weekly']);
    replace(TXD, f['contracts.registry_adds']);
  },
  governance(d) {
    replace(ENT, d.ENT);
    assign(PARENT, d.PARENT);
    assign(OWN, d.OWN);
    assign(UNDER, d.UNDER);
    assign(ENTF, d.ENTF);
    replace(FILINGS, d.FILINGS);
    replace(GBOARDS, d.GBOARDS);
    replace(AGENDA, d.AGENDA);
    replace(RESOS, d.RESOS);
    replace(PEOPLE, d.PEOPLE);
    if (d.VOTE) assign(VOTE, d.VOTE);
    replace(MEETS, d.MEETS);
    replace(RP, d.RP);
    replace(MATTERS, d.MATTERS);
    const f = d.figures;
    replace(PASTV, f['governance.past_votes']);
    assign(MEETINGS_HELD, f['governance.meetings_held']);
    assign(MEETING, f['governance.next_meeting']);
  },
  records(d) {
    replace(DOCS, d.DOCS);
    const f = d.figures;
    assign(DCOUNT, f['records.doc_counts']);
    assign(DSTATE_N, f['records.doc_states']);
    assign(COVER, f['records.coverage']);
    // the log is the app's own: people get the same short keys Team gives them, the system SY
    const key = (id, name) => (id ? shortId({ id, name }) : 'SY');
    replace(LOG, d.LOG.map((l) => [l.id, l.at, key(l.person, l.who), l.area, l.action, l.detail, l.from, l.result, l.note]));
    replace(WHO, [...new Map([...d.LOG.map((l) => [key(l.person, l.who), l.person ? l.who : 'System']), ['SY', 'System']]).entries()]);
    replace(WEEK, []);
    const appr = {};
    for (const a of d.APPROVALS) {
      const p = key(a.proposer.id, a.proposer.name);
      (appr[p] ??= {})[key(a.approver.id, a.approver.name)] = a.n;
    }
    assign(APPR, appr);
    if (vars.me) vars.meId = shortId(vars.me);
  },
  home(d) {
    mergeSummary(d.MEMBER_SUMMARY);
    assign(OWED, d.OWED);
    vars.shopNames = d.SHOP_NAMES;
    vars.posterCount = d.POSTERS;
    replace(DEADLINES, d.DEADLINES);
    const f = d.figures;
    replace(FUNNEL, f['home.funnel']);
    // the stored alerts, and the shop's materials at or under their low mark (Phase 10c)
    replace(ALERTS0, [...(f['home.alerts'] ?? []), ...(d.LOW_MATERIALS ?? []).map(lowAlert)]);
    if (f['growth.range']) assign(RANGE, f['growth.range']);
  },
  members(d) {
    replace(MEMBERS, d.MEMBERS);
    replace(BATCH_DATE, d.BATCH_DATE);
    replace(B_ACT, d.B_ACT);
    replace(B_OPEN, d.B_OPEN);
    vars.NEXT_BATCH = d.NEXT_BATCH;
    vars.namesShown = d.names === 'shown';
    // the redesigned page's own (sections/membersLive.ts): the waitlist's people, each batch, the join form
    vars.memberNames = d.names;
    vars.membersFigures = d.figures;
    vars.WAITLIST = d.WAITLIST ?? null;
    vars.BATCHES = d.BATCHES ?? null;
    vars.joinForm = d.FORMS ?? null;
  },
};

/** A section's answer from the API, written into the datasets the page draws from. */
export function applySection(route: string, d) {
  apply[route](d);
  setFigures(d.figures);
  vars.asOf = d.asOf;
}

/** Loads a section; with `reveal`, its names in full, for the reason given (an empty one is a rush, which the server flags). */
export async function loadSection(page: string, opts: { reveal?: boolean; reason?: string } = {}) {
  const route = sectionOf(page);
  const why = opts.reason?.trim() ? `&reason=${encodeURIComponent(opts.reason.trim())}` : '&rush=1';
  const d = await api('GET', `/sections/${route}${opts.reveal ? `?reveal=1${why}` : ''}`);
  applySection(route, d);
  // Contracts' signers and their queue come from the Ops Safe, when one is configured
  if (route === 'contracts') await import('./safe').then((m) => m.loadSafe().then(m.loadSafeQueue)).catch(() => undefined);
  ready.add(route);
  loads++;
  // the feeds' health rides along with every section (Phase 6a)
  void import('./feeds').then((m) => m.loadFeeds()).catch(() => undefined);
}

/** Signing out forgets what was loaded, so the next person's view loads their own. */
export const forgetSections = () => ready.clear();

/** Loads a section again after it changed, if it's one the API serves and it was already loaded. */
export async function reloadSection(page: string) {
  const route = sectionOf(page);
  if (!LIVE || !SERVED.has(route)) return;
  // a change shows elsewhere too (a poster on Home, a refund in Money): every other section loads afresh when next opened
  ready.clear();
  await loadSection(route);
}
