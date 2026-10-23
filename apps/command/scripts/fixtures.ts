/**
 * Writes the prototype's rows into packages/command-types/src/fixtures, for the API's seed:
 * `bun scripts/fixtures.ts`. The rows come from src/sections/data.tsx, which is the prototype's own
 * data, so the seeded database holds exactly what the design draws.
 */
import { writeFileSync } from 'node:fs';
import { SEED_NEXT_BATCH, SEED_ROUTE } from '@clear/command-types';

const d = await import('../src/sections/data.tsx');
const out = new URL('../../../packages/command-types/src/fixtures/', import.meta.url);
const write = (name: string, value: unknown) => writeFileSync(new URL(name, out), JSON.stringify(value, null, 1) + '\n');

// Members: the 300 invited, their 12 batches, and batch 13, which Marcus Lee proposed (drawn in the
// prototype's Waitlist and batches pane).
write('members.json', {
  // as the prototype draws them, `left` and `quiet` (counted as of its day) included: the seed
  // ignores those, and the API's tests check its own counting against them
  members: d.MEMBERS,
  batches: d.BATCH_DATE.map((sentAt: number, i: number) => ({ number: i + 1, size: 25, sentAt })),
  proposed: SEED_NEXT_BATCH,
  check: { B_ACT: d.B_ACT, B_OPEN: d.B_OPEN },
});
// Growth: the 102 posters, their three designs and the form inbox are rows; everything else Growth
// draws is a stored figure, written here from the prototype's data and, for the few figures written
// into its drawing code, from those lines (each marked).
const pid = (n: number) => 'P-' + String(n).padStart(3, '0');
write('growth.json', {
  designs: Object.entries(d.DESIGNS).map(([code, x]: [string, any]) => ({ code, name: x.name })),
  posters: d.POSTERS,
  forms: d.INBOX,
});
write('growth-figures.json', {
  'growth.range': d.RANGE,
  'growth.weekly.joined': d.W_JOIN,
  'growth.weekly.invited': d.W_INV,
  'growth.weekly.activated': d.W_ACT,
  'growth.weekly.visits_by_source': d.W_SRC,
  'growth.cities': d.CITY_V,
  'growth.sources_30d': d.SRC30,
  'growth.referrers': d.REFS,
  'growth.landing': d.LANDING,
  'growth.heat': d.HEAT,
  'growth.cohorts': d.COHORTS,
  'growth.shops': d.SHOPS,
  'growth.boards': d.BOARDS,
  'growth.others': d.OTHERS,
  // scans and joins by design, last 30 days (the prototype's totals, not the posters' sums)
  'growth.designs': Object.fromEntries(Object.entries(d.DESIGNS).map(([k, x]: [string, any]) => [k, { scans: x.scans, joined: x.joined }])),
  // from the drawing code
  'growth.waitlist.weeks_to_clear': 20,
  'growth.visitors_ratio': 0.69,
  'growth.phone_share': [70.2, 71.0, 72.4, 73.1, 74.0, 75.2, 75.9, 76.6, 77.1, 77.8, 78.0, 78.4],
  'growth.devices': [['Phone', 28545], ['Desktop', 6590], ['Tablet', 1275]],
  'growth.returning': [['New', 25123], ['Returning', 11287]],
  'growth.site.pages': [['/join', 11904], ['/', 9880], ['/how', 4120], ['/shops', 2310], ['/contribute', 1204], ['/s/rosas-panaderia', 842]],
  'growth.cohorts.since': Date.UTC(2026, 8, 15),
  'growth.cohorts.median_days_to_activate': [11, 10, 9, 8, 7, 7, 6],
  'growth.cohorts.still_in_window': [25, 50, 98, 150, 165, 176],
  'growth.cohorts.by_week_three': 36,
  'growth.cohorts.time_to_activate': [['Same day', 31], ['1–3 days', 27], ['4–7 days', 29], ['1–2 wks', 21], ['2–4 wks', 12], ['4 wks +', 4]],
});

// Field: Marcus Lee's route for the day, its stops and tasks (a check at a shop names its first
// poster, as the prototype resolves it), the shops due later, and the route's own facts.
write('field.json', {
  route: SEED_ROUTE,
  stops: d.STOPS.map((s: any) => ({
    ...s,
    tasks: s.tasks.map(({ p: _p, ...t }: any) => {
      if (t.kind !== 'poster') return t;
      const p = t.n ? d.POSTERS.find((x: any) => x.n === t.n) : d.POSTERS.find((x: any) => x.shop === t.shop);
      if (!t.shop) return t;
      const { shop: _shop, ...rest } = t;
      return { ...rest, n: p.n, t: `Check ${pid(p.n)}` };
    }),
  })),
  later: d.LATER,
  shopInfo: d.SHOP_INFO,
});
// Merchants: the partners and their numbers, the signed shops, the prospects, what's owed in $10
// redemptions, the pipeline board as the prototype builds it, the hardware fleet and the map's cities.
const merchants = await import('../src/sections/merchants.tsx');
merchants.kbInit();
write('merchants.json', {
  tx: d.TX,
  signed: d.SIGNED,
  prospects: d.PROSPECTS,
  owed: d.OWED,
  board: d.XS.board,
  fleet: d.FLEET,
  cities: d.CITY_LL,
});
// Figures written into Merchants' drawing code (the prototype's own numbers, each marked there).
const D = (m: number, day: number) => Date.UTC(2026, m - 1, day);
write('merchants-figures.json', {
  'merchants.founding_seats': 5,
  'merchants.newest_partner': { name: 'Uptown Barber', joined: D(10, 21) },
  'merchants.weekly.transacting': [0, 0, 1, 2, 3, 4, 5, 7, 8, 10, 11],
  'merchants.weekly.cleared': [0, 120, 480, 1100, 2300, 3900, 6100, 8800, 11900, 14600, 17300],
  'merchants.weekly.next_run': [0, 0, 0, 0, 310, 310, 310, 310, 3980, 3980, 3980],
  'merchants.weekly.loss_rate': [0, 0, 0, 0, 0, 0, 0, 1.2, 1.4, 1.2, 1.1],
  'merchants.pipeline.owners': [['Marcus Lee', 9], ['Dana Ruiz', 4], ['Kai', 3]],
  'merchants.pipeline.kinds': [['Auto and tires', 8], ['Furniture and mattresses', 2], ['Veterinary', 2], ['Optical', 1], ['Dental', 1], ['HVAC', 1], ['Appliances', 1]],
  'merchants.payouts.schedule': {
    underway: { id: 'rosas', date: D(10, 22) },
    monthly: D(11, 2),
    net14: D(11, 4),
    net14Next: { date: D(11, 18), estimate: 1140.8 },
    collectedBy: D(10, 30),
    calendarStart: D(10, 19),
  },
  'merchants.payouts.collected_share': 0.842,
  'merchants.payouts.collected_series': [0, 8, 19, 31, 42, 52, 61, 69, 75, 80, 83, 84.2],
  'merchants.payouts.owed_series': [0, 0, 40, 90, 150, 200, 250, 300, 340, 380, 410],
  'merchants.payouts.fees_series': [0, 0, 0, 0, 0, 8, 14, 20, 28, 36, 44],
  'merchants.hardware.devices_series': [0, 0, 2, 4, 6, 8, 10, 13, 15, 17, 19],
  'merchants.hardware.online_series': [100, 100, 100, 95, 100, 100, 94, 100, 95, 90, 95],
  'merchants.hardware.preorders': { devices: 19, shops: 7, series: [0, 0, 0, 0, 2, 2, 5, 8, 11, 14, 17, 19] },
  'merchants.hardware.unit_cost': { repaired: 61, fresh: 189, series: [88, 84, 80, 76, 74, 71, 69, 66, 64, 63, 62, 61] },
});
// Money: the accounts and their seven weeks of balances, each account's recent activity (written in the
// prototype's drawing code), the bonds, and the yield pool's depositors. The prototype's M and Y (what
// Money computes from these) go in too, as the answer key for the API's tests.
const day = (s: string) => Date.UTC(2026, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(s.split(' ')[1]), Number(s.split(' ')[0]));
write('money.json', {
  accounts: d.ACCTS.map((a: any[]) => ({ id: a[0], name: a[1], why: a[2], group: a[3], source: a[4], weeks: a[6], swatch: a[7] })),
  weeks: d.NW.map((w: string) => day(w)),
  entries: d.ENTRIES,
  bonds: d.BONDS,
  depositors: d.Y_DEP,
  check: { M: d.M, Y: d.Y, ACCTS: d.ACCTS, AP_BAL: d.AP_BAL, UNSEC: d.UNSEC, AP_REQ: d.AP_REQ, RTD_W: d.RTD_W, Y_ASSETS: d.Y_ASSETS, Y_LENT: d.Y_LENT },
});
write('money-figures.json', {
  // the credit book (Phase 5 reads it from the contracts)
  'money.book': { credit: d.M.credit, savingsBacked: d.M.savingsBacked, unsecured: d.M.unsecured, limits: d.M.limits, lost: d.M.lost },
  'money.payouts_due': { owed14: d.M.owed14, dueMembers: d.M.dueMembers },
  'money.floor': d.M.floor,
  'money.yield.pool': { principal: d.Y.principal, queued: d.Y.queued, opened: d.Y.opened, cycleDays: d.Y.cycleDays, curve: d.Y.curve },
  'money.yield.history': { days: d.YD, assets: d.Y_ASSETS.slice(0, -1), lent: d.Y_LENT.slice(0, -1) },
  'money.ap.balance_weeks': d.AP_BAL.slice(0, -1),
  'money.credit.unsecured_weeks': d.UNSEC.slice(0, -1),
  'money.coop.weekly': d.COOP_W,
  'money.flows': d.FLOWS,
  // from the drawing code
  'money.reserve': { ratio: '1 : 1', checked: '2 min ago' },
  'money.ap.losses': 3,
  'money.ap.lent_out': 0,
  'money.payout.queue': [[day('22 Oct'), 'Rosa’s Panadería', 412.6], [day('2 Nov'), 'Monthly run · 11 shops', 9510.65], [day('4 Nov'), 'Arrowhead Nails', 732.0], [day('4 Nov'), 'Cajon Phone Repair', 2184.0]],
  'money.yield.since_opened': [[day('15 Oct'), 'Opened', '14 founding members', 8062.1], [day('18 Oct'), 'Withdrawal', '1 member · paid at once', -250], [day('20 Oct'), 'Deposits', '4 new members', 1150]],
  'money.yield.joined_this_week': 4,
  'money.credit.outstanding_weeks': [0, 900, 3100, 6200, 9400, 12100],
  'money.credit.limits_weeks': [0, 8000, 15400, 24600, 31800, 37200],
  'money.credit.owed_month_start': 7040.0,
  'money.credit.autopay': 98,
  'money.credit.aging': [['Current', 12480.2], ['1–30 d', 1310.4], ['31–60 d', 421.8]],
  'money.credit.limit_sizes': [['$100', 38], ['$250', 46], ['$500', 28], ['$1,000+', 12]],
  'money.credit.limit_range': { smallest: 100, largest: 1500 },
  'money.credit.recovered': 0,
});
// Shop: the catalog, stock, shelf periods and product history, the recent orders, hardware pre-orders,
// what's on the way and the returns are rows; each product's weekly sales, the weekly orders, what
// selling costs and the 4-week breakdowns are figures. Times at the prototype's "now" (21 Oct, 14:00)
// are written as null: still on the shelf, or planned from today. The prototype's SHOP and the
// set-aside amounts Money shows go in as the answer key.
const now = (t: number) => (t === d.NOW ? null : t);
write('shop.json', {
  products: d.PR.map(({ wk, ...p }: any) => p),
  stock: d.STK,
  shelf: Object.fromEntries(Object.entries(d.SHELF_EV).map(([id, ev]: [string, any]) => [id, ev.map(([st, a, b]: any[]) => [st, now(a), now(b)])])),
  history: d.SHIST,
  orders: d.ORDERS,
  preorders: d.PRE,
  incoming: d.INCOMING.map((r: any[]) => [r[0], r[1], r[2].map(([k, a, b]: any[]) => [k, now(a), now(b)]), r[3], r[4]]),
  returns: d.RETURNS,
  check: { SHOP: d.SHOP, GP_W: d.GP_W, SET_ASIDE: { salesTax: d.SHOP.tax, preorderDeposits: d.PRE.filter((r: any[]) => r[5] === 'held').reduce((a: number, r: any[]) => a + d.PR.find((x: any) => x.id === r[2]).price * r[4], 0) } },
});
write('shop-figures.json', {
  'shop.units_weekly': Object.fromEntries(d.PR.map((p: any) => [p.id, p.wk])),
  'shop.orders_weekly': d.ORD_W,
  'shop.costs': d.SHOP_COSTS,
  'shop.line_costs': d.LINE_COSTS,
  'shop.size_mix': d.SIZE_MIX,
  'shop.pickups': d.PARTNERS,
  'shop.ship_days': d.SHIP_DAYS,
  'shop.buyers': d.BUYERS,
  'shop.paid_with': d.PAID_WITH,
});
// Contracts: every agreement (the merchant ones built by the same function the app runs at start),
// the contracts and how they connect, their releases, the changes in flight and done, and the Safe's
// signers. Events at the prototype's "now" are written as null.
const { merchantAgreements } = await import('../src/sections/contracts.tsx');
const evNow = (ev: any[]) => ev.map((e: any[]) => e.map((v) => (v === d.NOW ? null : v)));
const change = (c: any) => ({ ...c, ev: evNow(c.ev) });
write('contracts.json', {
  agreements: [...d.AGR, ...merchantAgreements()].map((a: any) => (a.ev ? { ...a, ev: evNow(a.ev) } : a)),
  contracts: d.CTR,
  notes: d.CTR_NOTE,
  links: d.REL,
  releases: d.RELEASES,
  pending: d.PENDING,
  changes: d.CH.map(change),
  done: d.CH_DONE.map(change),
  signers: d.SIGNERS,
});
write('contracts-figures.json', {
  'contracts.chain': d.CHAIN,
  'contracts.key_roles': d.KEY_ROLES,
  'contracts.draft_to_live': d.TTL,
  'contracts.signatures_weekly': d.SIGN_W,
  // the days shops were added to MerchantRegistry (Phase 5 reads them from its events)
  'contracts.registry_adds': d.TXD,
});
// Governance: the entities and their facts, filings, boards and seats, the next agenda, resolutions,
// who sits where, the open member vote, every body's meetings, related-party deals and who decides what.
write('governance.json', {
  entities: d.ENT.map((e: any[]) => ({ row: e, parent: d.PARENT[e[0]] ?? null, owned: d.OWN[e[0]] ?? null, under: d.UNDER[e[0]] ?? null, facts: d.ENTF[e[0]] ?? null })),
  filings: d.FILINGS,
  boards: d.GBOARDS,
  agenda: d.AGENDA,
  resolutions: d.RESOS,
  people: d.PEOPLE,
  vote: d.VOTE,
  meetings: d.MEETS,
  related: d.RP,
  matters: d.MATTERS,
});
write('governance-figures.json', {
  'governance.past_votes': d.PASTV,
  'governance.meetings_held': d.MEETINGS_HELD,
  'governance.next_meeting': d.MEETING,
});
// Records: the documents. Counts by kind and state cover every document, not only the latest listed,
// so they're figures, as is each entity's paperwork. The log, approvals and sign-ins are the app's own
// (command.audit_log, proposals, sign_ins) and never seeded.
write('records.json', { documents: d.DOCS });
write('records-figures.json', { 'records.doc_counts': d.DCOUNT, 'records.doc_states': d.DSTATE_N, 'records.coverage': d.COVER });
// Home: what it shows that no other section counts.
write('home-figures.json', { 'home.funnel': d.FUNNEL, 'home.alerts': d.ALERTS0, 'home.redeemed_paid': d.REDEEMED_PAID });
console.log('fixtures written');
