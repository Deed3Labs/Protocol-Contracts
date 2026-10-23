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
console.log('fixtures written');
