// @ts-nocheck: reads the section data the API fills, which is untyped, as the sections are.
import { CATALOG, COST_HIST, INCOMING, INPUTS, ORDERS, ORD_W, PR, PRE, RECIPES, RETURNS, SHIST, STK, vars } from './data';

/*
 * Shop's datasets, live (shop2.tsx reads these in place of the reference's when REAL): built from what the
 * API's shop section sends (live/sections.ts fills ./data from it, and vars.shopModel with the redesign's
 * own: COST_BY, FLAT, SUPPLIERS, ON_ORDER, REORDER, BATCHES, PER_ORDER, ORDER_COSTS, POINTS, PICKUP).
 * The products are the store's catalog with Command's costs (a recipe of materials, one flat cost, the
 * old per-item boxes, or none yet); the materials are the inputs library with their average and last
 * price paid; the orders are the shop's Stripe orders. People are only you. What nothing records yet is
 * empty, never the reference's: the shop's fixed costs (docs/ui-redesign-plan.md, gaps).
 */

const DAY = 864e5,
  WEEK = 7 * DAY;
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = (t) => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
const LINES = new Set(['logo', 'graphic', 'layers', 'patch', 'hw']);
const GLY = new Set(['tee', 'gtee', 'ls', 'turtle', 'hood', 'psq', 'pci', 'point', 'tab']);
/** The page's line drawing for a glyph the API names: its own, or the nearest the page has. */
const glyphOf = (g, line) => (GLY.has(g) ? g : g === 'patch' ? 'psq' : g === 'hoodie' ? 'hood' : g === 'turtleneck' ? 'turtle' : g === 'tee-ls' ? 'ls' : line === 'hw' ? 'tab' : line === 'patch' ? 'psq' : line === 'graphic' ? 'gtee' : 'tee');
const OSTATES = new Set(['paid', 'packed', 'shipped', 'ready', 'done', 'picked', 'refund']);
const initials = (n) =>
  (n || '?')
    .split(/[ @.,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
const sum = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);
const qty = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });

export function shopLive() {
  const M = vars.shopModel ?? {};
  const NOW = M.NOW ?? Date.now();
  const TODAY = Math.floor(NOW / DAY) * DAY;
  const PER = M.PER_ORDER ?? null;
  // the API counts weeks from the epoch's: the last of the eight is this one
  const wk0 = Math.floor(NOW / WEEK) * WEEK;
  const WEEKS = Array.from({ length: 8 }, (_, i) => fmtD(wk0 - (7 - i) * WEEK));

  /* people: only you */
  const me = vars.me;
  const ME = 'me';
  const PPL = { me: { n: me?.name || me?.email || 'You', ini: initials(me?.name || me?.email), staff: true }, viewer: { n: 'Viewer', ini: 'VW' } };

  /* suppliers, and a stand-in for a material with none set */
  const SUPPLIERS = (M.SUPPLIERS ?? []).map((s) => ({
    id: s.id,
    n: s.name,
    city: s.city || '',
    what: s.sells || 'Nothing listed yet',
    lead: s.leadDays,
    terms: s.terms || '—',
    min: s.minimum || 'None',
    breaks: (s.breaks ?? []).length ? s.breaks : [],
    last: s.lastOrder ?? null,
    note: s.note || '',
    inputs: s.inputs ?? [],
  }));
  const SUP = Object.fromEntries(SUPPLIERS.map((s) => [s.id, s]));
  SUP[''] = { id: '', n: 'No supplier set', city: '', what: 'No supplier set', lead: null, terms: '—', min: '—', breaks: [], last: null, none: 1, inputs: [] };

  /* what's on order, by material, and the reorder suggestions */
  const ON_ORDER = M.ON_ORDER ?? [];
  const onOrder = {};
  for (const o of ON_ORDER) {
    const x = (onOrder[o.input] ??= { q: 0, due: null, total: 0, rows: [] });
    x.q += o.quantity;
    x.total += o.total;
    if (o.due != null && (x.due == null || o.due < x.due)) x.due = o.due;
    x.rows.push(o);
  }
  const REORDER = Object.fromEntries((M.REORDER ?? []).map((r) => [r.input, r]));

  /* the materials library: the inputs, archived ones kept for the recipes that still use them */
  const ALL = INPUTS.map((i) => {
    const oo = onOrder[i.id];
    const ps = (i.purchases ?? []).slice().sort((a, b) => a.at - b.at);
    const v = i.var && Object.keys(i.var).length ? i.var : null;
    const avg = i.avg ?? i.unitCost ?? null;
    return {
      id: i.id,
      n: i.name,
      kind: i.type ?? (i.perOrder ? 'order' : i.stocked ? 'stock' : 'mto'),
      ...(i.perOrder && i.stocked ? { stock: 1 } : {}),
      unit: i.unit,
      sup: i.supplier && SUP[i.supplier] ? i.supplier : '',
      avg: avg ?? 0,
      last: i.last ?? avg ?? 0,
      ...(avg == null ? { noCost: 1 } : {}),
      ...(i.stocked || i.perOrder ? { hand: Number(i.onHand) || 0 } : {}),
      ...(v ? { var: v } : {}),
      ...(ps.length ? { buys: ps.map((p) => [p.at, p.quantity, p.total]) } : {}),
      ...(oo ? { incoming: [oo.q, oo.due, oo.total] } : {}),
      ...(i.note ? { note: i.note } : {}),
      ...(i.archived ? { archived: 1 } : {}),
      raw: i,
    };
  });
  const INP = Object.fromEntries(ALL.map((i) => [i.id, i]));
  const MATS = ALL.filter((i) => !i.archived);
  const ARCHIVED = ALL.filter((i) => i.archived);

  /* products: the catalog's, costed from materials, one cost, the old boxes, or not yet */
  const COST_BY = M.COST_BY ?? {},
    FLAT = M.FLAT ?? {};
  const pad8 = (w) => {
    const a = (w ?? []).slice(-8);
    return [...Array(8 - a.length).fill(0), ...a];
  };
  const STK2 = {};
  for (const [pid, o] of Object.entries(STK)) STK2[pid] = Object.fromEntries(Object.entries(o).map(([c, a]) => [c, a.length <= 1 ? [a[0] ?? 0] : SIZES.map((_, i) => a[i] ?? 0)]));
  const PRL = PR.map((p) => {
    const r = RECIPES[p.id],
      fl = FLAT[p.id];
    const src = COST_BY[p.id] ?? (fl ? 'flat' : r?.lines?.length ? 'recipe' : p.c && !p.nc ? 'boxes' : 'none');
    const stk = STK2[p.id];
    const cols = p.cols?.length ? p.cols : stk ? Object.keys(stk) : [''];
    const o = {
      id: p.id,
      n: p.n,
      v: p.v || '',
      line: LINES.has(p.line) ? p.line : 'logo',
      g: glyphOf(p.g, p.line),
      price: Number(p.price) || 0,
      st: ['on', 'off', 'draft', 'arch'].includes(p.st) ? p.st : 'draft',
      cols,
      wk: pad8(p.wk),
      ...(p.why ? { why: p.why } : {}),
      ...(p.dep ? { dep: 1 } : {}),
      // one size: every colour's stock is a single count
      ...(!stk || Object.values(stk).every((a) => a.length <= 1) ? { one: 1 } : {}),
      slug: p.slug,
      src,
    };
    if (src === 'flat' && fl) Object.assign(o, { flat: fl.cost, est: fl.estimate ? 1 : 0, ...(fl.note ? { note: fl.note } : {}) });
    else if (src === 'recipe' && r?.lines?.length)
      o.recipe = r.lines.map((l) => {
        const i = INP[l.input];
        // a line entered as a cost, for an input with no unit cost, has no amount: its cost stands in
        return [l.input, l.amount ?? (i?.avg ? (l.cost ?? 0) / i.avg : 0)];
      });
    else if (src === 'boxes' && p.c) Object.assign(o, { flat: sum(p.c), boxes: 1 });
    else Object.assign(o, { flat: 0, nc: 1 });
    return o;
  });
  const PRO = Object.fromEntries(PRL.map((p) => [p.id, p]));
  // an order's product the catalog no longer has: named, never listed
  for (const r of ORDERS)
    for (const [pid] of r[4] ?? [])
      PRO[pid] ??= { id: pid, n: pid, v: '', line: 'logo', g: 'tee', price: 0, st: 'arch', cols: [''], wk: Array(8).fill(0), flat: 0, nc: 1, gone: 1, one: 1 };
  /** A product's cost as the API works it out for a colour and size (overrides and extras included), or null. */
  function costAt(p, size, col) {
    if (p.recipe) {
      const r = RECIPES[p.id];
      const vs = r?.variants ?? [];
      const v = vs.find((x) => x.option === col && x.size === size) ?? vs.find((x) => x.option === col && !x.size) ?? (p.one ? vs.find((x) => x.option === col) : null);
      return v ? v.cost : (r?.cost ?? null);
    }
    const fl = FLAT[p.id];
    if (fl && p.flat != null) {
      const ov = fl.overrides ?? [];
      const o = ov.find((x) => x.option && x.size && x.option === col && x.size === size) ?? ov.find((x) => !x.option && x.size === size) ?? ov.find((x) => x.option === col && !x.size);
      return o ? o.cost : fl.cost;
    }
    return null;
  }

  /* batches: made, planned, short */
  const BATCHES = (M.BATCHES ?? []).filter((b) => PRO[b.product]).map((b) => [b.id, b.product, b.option, b.units, b.at, b.unitCost ?? 0, b.state, b]);

  /* orders and what each cost once */
  const OS = ORDERS.map((r) => [r[0], r[1], r[2], r[3], r[4] ?? [], r[5], r[6] === 'pickup' ? 'pickup' : 'ship', OSTATES.has(r[8]) ? r[8] : 'done', { pickup: r[7] || '', city: r[9] || '' }]);
  const SHIP = { charged: PER?.charged ?? 0, label: PER?.label ?? null };
  const FEE = PER?.fee ?? { pct: 0, fixed: 0 };
  const POINTS = Object.fromEntries((M.POINTS ?? []).map((p) => [p.id, { n: p.name, city: p.city || '', wk4: p.last4w ?? 0, held: p.held ?? 0, active: p.active }]));
  const PICKUP = M.PICKUP ?? {};
  const PICKUP_AT = Object.fromEntries(Object.entries(PICKUP).filter(([, x]) => x.point).map(([id, x]) => [id, x.point]));
  const RET = Object.fromEntries((RETURNS ?? []).map((r) => [r.order, r]));

  /* cost changes, from the purchases: each buy at a different price from the one before */
  const since = NOW - 56 * DAY;
  const CHANGES = [];
  for (const i of ALL) {
    const ps = (i.raw.purchases ?? []).slice().sort((a, b) => a.at - b.at);
    for (let k = 1; k < ps.length; k++) {
      const a = ps[k - 1].unitCost,
        b = ps[k].unitCost;
      if (ps[k].at < since || a == null || b == null || Math.abs(a - b) < 0.005) continue;
      CHANGES.push([ps[k].at, i.id, a, b, `Bought ${qty(ps[k].quantity)}${ps[k].supplier ? ' from ' + ps[k].supplier : ''}`]);
    }
  }
  CHANGES.sort((a, b) => b[0] - a[0]);

  /* on the way: buys on order, and finished goods coming in */
  const COMING = [
    ...ON_ORDER.filter((o) => INP[o.input]).map((o) => [o.due, `${qty(o.quantity)} × ${INP[o.input].n}`, `${o.supplierName || 'No supplier'} · $${o.total.toFixed(2)}`, `m:${o.input}`]),
    ...INCOMING.map((r) => [null, `${r[0]}${r[1] ? ' · ' + r[1] : ''}`, r[3] ? `Lands ${r[3]}` : 'No date yet', PRO[r[4]] ? `p:${r[4]}` : '']),
  ];

  return {
    NOW,
    TODAY,
    WEEKS,
    ME,
    PPL,
    TARGET: PER?.margin != null ? PER.margin / 100 : 0,
    MIN_WEEKS: PER?.buffer ?? 0,
    BUYCAP: PER?.shopbuy ?? null,
    REFUNDCAP: PER?.refund ?? null,
    HOLD_DAYS: PER?.hold ?? 0,
    PER,
    SUPPLIERS,
    SUP,
    INPUTS: MATS,
    ARCHIVED,
    INP,
    REORDER,
    ON_ORDER,
    onOrder,
    PR: PRL,
    PRO,
    STK: STK2,
    costAt,
    BATCHES,
    SHIP,
    FEE,
    ORDERS: OS,
    ORDER_COSTS: M.ORDER_COSTS ?? {},
    POINTS,
    PICKUP,
    PICKUP_AT,
    RET,
    PRE,
    CHANGES,
    COMING,
    ORD_W: pad8(ORD_W),
    // the shop's fixed costs (samples, photos, software) aren't recorded anywhere yet
    LINE_COSTS: [],
    CATALOG,
    COST_HIST,
    RECIPES,
    FLAT,
    SHIST,
  };
}
