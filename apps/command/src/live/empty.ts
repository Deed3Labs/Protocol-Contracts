import * as DATA from '../sections/data';

/*
 * Real data only (Phase 9): the prototype's figures and rows never show in the live app. At start-up
 * every dataset in sections/data.tsx is emptied, and the API fills what it has; what it doesn't have
 * stays empty and the page says so. The preview with `&empty=1` does the same with no API, which is how
 * every page is checked to render with nothing in it.
 *
 * Kept as they are: what isn't data (labels, colours, icons, layout, which tab is open). Emptied:
 *   - a list (of members, shops, people…) becomes empty;
 *   - a series of numbers becomes zeros, the same length, so a chart keeps its weeks;
 *   - a record keeps its fields with nothing in them (0, '', an empty list);
 *   - a dictionary keyed by id (OWED.mesa, STK.lts…) loses its keys.
 * The co-op's structure stays (the contracts' map, the entities and their boards' seats), as the API
 * writes it with no seed: not formed, no one seated.
 */

/** Not data: the app's own words, colours, icons, layout and UI state. */
const KEEP = new Set([
  'vars', 'P', 'SECTIONS', 'NAMES', 'PLANNED', 'FORMS', 'DL_STATUS', 'S', 'TH_IC', 'demo', 'W_ICON', 'W_VIZ', 'UPD_FROM', 'SPANS', 'GS',
  'ST', 'TODAY', 'DAY', 'MON', 'WEEKS', 'SRC_COL', 'SC_COL', 'PER_PAGE', 'MS', 'M_ST', 'UK', 'UC_CAP', 'UC_STEPS', 'XS', 'CAPS', 'CITY_LL',
  'CM_ST', 'CK', 'CM_K', 'CM_GEO', 'ML_STYLE', 'KST', 'LOGT', 'NEXT_ACT', 'FS', 'OUT', 'NS', 'NW', 'GROUPS', 'CS', 'NOW', 'YEAR', 'AST',
  'AGR_T', 'LAYERS', 'RK', 'VS', 'EST', 'FST', 'FSHORT', 'SEATC', 'AK', 'RPX', 'RPN', 'RPA', 'BODIES', 'MBODY', 'RS', 'DT', 'DONE1', 'DSTAT',
  'COVER_K', 'CV', 'AREAS', 'RESULT', 'TS', 'SECS', 'LV', 'ROLES', 'SS', 'SW', 'SIZES', 'LINES', 'SHELF', 'RETURN_WHY', 'OST', 'PAY',
  'PRE_ST', 'GLY', 'VSEC', 'V_OK', 'V_PERSONAL_TABS', 'SG', 'KEY', 'SHOP_COSTS', 'SHIP_NET', 'gpWeeks', 'REDEEMED_PAID',
  // the co-op's structure, as the API writes it (services/command/structure.ts): the protocol map and the entity tree
  'CTR', 'REL', 'ENT', 'PARENT', 'OWN', 'UNDER', 'ENTF', 'GBOARDS', 'MATTERS',
]);

/** Keyed by id (a shop, a product, a contract, an entity…): emptied of their keys. */
const DICTS = new Set([
  'OWED', 'CITY_V', 'DESIGNS', 'STK', 'SHELF_EV', 'SHIST', 'RELEASES', 'PENDING', 'CTR_NOTE', 'ENTRIES',
  'COVER', 'APPR', 'SIGN_W', 'SHOP_NO', 'SHOP_INFO', 'FEED_FROM', 'NEED',
]);

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const blank = (v: unknown): unknown => (typeof v === 'number' ? 0 : typeof v === 'string' ? '' : typeof v === 'boolean' ? false : Array.isArray(v) ? emptyArray(v) : plain(v) ? zero(v) : null);

/** A list empties; numbers become zeros; a tuple of plain values (a fixed-shape row) keeps its shape, blank. */
function emptyArray(a: unknown[]): unknown[] {
  if (a.every((x) => typeof x === 'number' || x == null)) return a.map((x) => (x == null ? x : 0));
  if (a.length && a.every((x) => x == null || ['string', 'number', 'boolean'].includes(typeof x))) return a.map(blank);
  return [];
}
/** An object's fields kept, each blank: 0, '', an empty list. */
export function zero(o: Record<string, unknown>): Record<string, unknown> {
  for (const k of Object.keys(o)) o[k] = blank(o[k]);
  return o;
}

let done = false;
/** Empties every dataset, in place (the sections hold references to these very objects). */
export function emptyData(): string[] {
  if (done) return [];
  done = true;
  const touched: string[] = [];
  for (const [name, v] of Object.entries(DATA)) {
    if (KEEP.has(name) || typeof v === 'function') continue;
    if (Array.isArray(v)) v.splice(0, v.length, ...emptyArray(v));
    else if (DICTS.has(name) && plain(v)) for (const k of Object.keys(v)) delete v[k];
    else if (plain(v)) zero(v);
    else continue;
    touched.push(name);
  }
  // UI state that carries data: Home's "Needs you" list starts as the prototype's
  DATA.S.waiting.splice(0);
  // the shop's costs are rates, kept; how many orders it shipped is data
  DATA.SHOP_COSTS.shipped4w = 0;
  // the structure keeps its shape only: every entity not formed, every seat empty, no dated notes
  for (const e of DATA.ENT) e[3] = 'planned';
  const facts = DATA.ENTF as Record<string, { tax?: string }>;
  for (const [k, f] of Object.entries(facts)) facts[k] = f.tax ? { tax: f.tax } : {};
  type Seat = [string, string | null, number, number, string?];
  for (const b of DATA.GBOARDS as unknown as [string, string, Seat[], string][])
    b[2] = b[2].map(([cls, , , , note]): Seat => (note && !/\d/.test(note) ? [cls, null, 0, 0, note] : [cls, null, 0, 0]));
  DATA.MATTERS.splice(0, DATA.MATTERS.length, ...DATA.MATTERS.map(([d, roles]) => [d, roles]));
  return touched;
}
