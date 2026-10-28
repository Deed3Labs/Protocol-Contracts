// @ts-nocheck: reads the section data the API fills, which is untyped, as the sections are.
import { fig } from '../live/figures';
import { BOARD, DESIGNS, FLEET, LATER, OWED, PEOPLE_T, POSTERS, ROLES, SHOP_INFO, SIGNED, STOPS, TODAY, TX, VSEC, vars } from './data';
import { vLevel } from './shell';

/*
 * Field's and Merchants' datasets, live (fm2.tsx reads these in place of the reference's when REAL): built
 * from what the API's field and merchants sections send (live/sections.ts fills ./data and vars from them)
 * and the team (Team's people, when they've loaded). One module draws both pages, so both sections feed it:
 * Field's follow-ups and visits come from the Merchants pipeline, and Merchants' devices from today's route.
 *
 * Names are only the data's: the signed-in person, the team, the route's staff, the pipeline's owners and
 * the shops. Field's own records (migration 0069) are the routes planned for the coming days (`ROUTES`, their
 * stops joining what needs a visit), today's van load (`VAN`) and the shops that said yes to a poster (`YES`).
 * The payout runs, the refurb line, the pre-orders and the shop enquiries are the API's (migration 0067, and
 * the shop's reservations). What nothing records yet is empty, never the reference's (docs/ui-redesign-plan.md,
 * gaps): placement scoring, losses, and devices other than Points.
 */

const DAY = 864e5;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtD = (t) => {
  const d = new Date(t);
  return d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
};
const initials = (n) =>
  (n || '?')
    .replace(/[’'.&]/g, '')
    .split(/[ @]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
const first = (n) => (n || '').split(' ')[0];

/** The outcomes a merchant visit is logged with, in the order the page offers them. */
export const VISIT_OUT = ['Not in', 'Not interested', 'Interested', 'Demo booked', 'Ready to sign', 'Signed'];
const STAGE_T = { prospect: 'Prospect', talking: 'Talking', signing: 'Signing', signed: 'Signed', closed: 'Closed' };
/**
 * A merchant visit is a line in the shop's pipeline log (the card's activity, kind visit): its outcome, the
 * stage it moved the shop between, and the note, in that order. This writes one, and `readVisit` reads it back.
 */
export const visitText = (out, from, to, note) => [out, from && to ? `${STAGE_T[from]} → ${STAGE_T[to]}` : '', note].filter(Boolean).join(' · ');
const readVisit = (text) => {
  const parts = String(text || '').split(' · ');
  const out = VISIT_OUT.includes(parts[0]) ? parts.shift() : null;
  const mv = parts[0] && /^(\w+) → (\w+)$/.exec(parts[0]);
  const key = (t) => Object.keys(STAGE_T).find((k) => STAGE_T[k] === t) ?? null;
  if (mv) parts.shift();
  return { out, from: mv ? key(mv[1]) : null, to: mv ? key(mv[2]) : null, note: parts.join(' · ') };
};
/** The pipeline's source as the old page wrote it, and as the redesign keys it. */
const SRC_IN = { 'Walk-in': 'walkin', Poster: 'poster', Website: 'enquiry', Referral: 'hand' };
export const SRC_OUT = { walkin: 'Walk-in', poster: 'Poster', enquiry: 'Website', hand: 'Referral' };

export function fmLive() {
  const midnight = (t) => {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  /** Days from today: a due date ahead is positive. */
  const daysTo = (t) => (t == null ? null : Math.round((midnight(t) - TODAY) / DAY));
  /** Days since: a visit yesterday is 1. */
  const daysAgo = (t) => (t == null ? null : Math.max(0, Math.round((TODAY - midnight(t)) / DAY)));

  /* ── the team: the signed-in person, Team's people, and whoever else the data names ── */
  const me = vars.me ?? null;
  const meK = vars.meId || 'me';
  const lvl = vLevel('field');
  const TEAM = {};
  const byName = new Map();
  const index = (k, n) => {
    if (!n) return;
    const l = n.toLowerCase();
    if (!byName.has(l)) byName.set(l, k);
    const f = first(l);
    if (f && !byName.has(f)) byName.set(f, k);
  };
  const meName = me ? me.name || me.email || 'You' : 'You';
  TEAM[meK] = { n: meName, ini: initials(meName), role: me?.group?.name || (lvl >= 4 ? 'Admin' : 'You'), field: lvl >= 3, admin: lvl >= 4, uid: me?.id ?? null };
  index(meK, meName);
  const FI = VSEC.indexOf('field');
  for (const p of PEOPLE_T) {
    if (p.off || p.role === 'investors') continue;
    if (me && (p.uid === me.id || p.id === meK)) continue;
    const lv = (p.custom || ROLES[p.role]?.[2] || [])[FI] ?? 0;
    TEAM[p.id] = { n: p.n, ini: initials(p.n), role: p.custom ? 'Custom' : (ROLES[p.role]?.[0] ?? ''), field: lv >= 3, uid: p.uid ?? null };
    index(p.id, p.n);
  }
  // who the data names but the team doesn't list: shown by name, never offered as someone to give work to
  const hidden = (k, v) => Object.defineProperty(TEAM, k, { value: v, enumerable: false, configurable: true });
  hidden('viewer', { n: 'Viewer', ini: 'VW', role: 'Read-only', field: false });
  hidden('none', { n: 'Nobody', ini: '–', role: 'No owner yet', field: false });
  /** A person the data names (a full name, a first name), as a key into TEAM. */
  const keyOf = (n) => {
    if (!n) return 'none';
    const k = byName.get(n.toLowerCase()) ?? byName.get(first(n).toLowerCase());
    if (k) return k;
    const nk = 'n:' + n;
    if (!(nk in TEAM)) hidden(nk, { n, ini: initials(n), role: '', field: false });
    return nk;
  };
  /** A team person by their id (routes name people so), else by the name the data gives. */
  const keyOfId = (uid, n) => Object.keys(TEAM).find((k) => uid && TEAM[k].uid === uid) ?? keyOf(n);
  /** The id a route is saved with: the person's, from Team (or the signed-in person's own). */
  const uidOf = (k) => TEAM[k]?.uid ?? null;

  /* ── Field: today's route, the posters, what was found earlier ── */
  // every design a poster wears has a name (the API sends the designs it has; one it doesn't is named by its code)
  const designs = Object.fromEntries(Object.entries(DESIGNS).map(([k, d]) => [k, { ...d }]));
  for (const p of POSTERS) designs[p.design] ??= { name: 'No name yet', posters: POSTERS.filter((q) => q.design === p.design).length, scans: 0, joined: 0 };
  const ROUTE = { staff: '', staffKey: '', loaded: '', started: '', miles: 0, backBy: '', minutesPerStop: 0, ...(vars.ROUTE ?? {}) };
  const staffK = ROUTE.staff ? keyOf(ROUTE.staff) : 'none';
  const stops = STOPS.map((s) => ({
    ...s,
    // a poster task whose poster isn't in the list is a visit to mark done
    tasks: (s.tasks ?? []).map((t) => (t.kind === 'poster' && !t.p ? { ...t, kind: 'visit' } : { ...t })),
  }));
  const later = LATER.map((l) => ({
    id: 'l:' + l[0],
    shop: l[0],
    city: l[1],
    what: l[6] || l[5] || 'Check the poster',
    why: [l[5], l[7]].filter(Boolean).join(' · '),
    sev: l[3] === 'missing' ? 'absent' : 'underway',
    mins: parseInt(String(l[8] ?? '').replace(/\D/g, ''), 10) || 0,
  }));

  /* ── Merchants: the shops in the merchant app, and the pipeline (Command's own) ── */
  const cards = BOARD.map((c) => ({ ...c, contact: { ...(c.contact ?? {}) } }));
  // a shop's card: the one that names it (its merchant id), else one of the pipeline's own with the shop's name, as a
  // prospect that signed up in the merchant app under the name it had on the board
  const used = new Set();
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const cardOf = (id, name) => {
    const c = cards.find((x) => x.m && x.m === id) ?? cards.find((x) => !x.m && !used.has(x.id) && norm(x.name) === norm(name)) ?? null;
    if (c) used.add(c.id);
    return c;
  };
  const posters = (name) => POSTERS.filter((p) => p.shop === name).length;
  const lastOf = (c) => daysAgo(c?.last ?? null);
  const fromCard = (c) =>
    c
      ? { owner: keyOf(c.owner), next: c.next ?? null, due: daysTo(c.due ?? null), last: lastOf(c), source: SRC_IN[c.source] ?? 'hand', card: c, val: c.val ?? 0 }
      : { owner: 'none', next: null, due: null, last: null, source: 'hand', card: null, val: 0 };
  const MS = [];
  for (const r of TX) {
    const [id, name, kind, city, founding, fee, terms, cap, hits, orig, lost, oct, octN, sept, hw] = r;
    const c = fromCard(cardOf(id, name));
    MS.push({ id, name, kind, city, stage: 'transacting', founding: !!founding, fee: Number(fee) || 0, terms: terms || '', cap: cap ?? null, hits: hits || 0, orig: orig || 0, lost: lost || 0, oct: oct || 0, octN: octN || 0, sept: sept || 0, hw: hw || '–', owed: OWED[id] || 0, posters: posters(name), ...c, val: 0 });
  }
  for (const [id, name, kind, city, st] of SIGNED) {
    const c = fromCard(cardOf(id, name));
    MS.push({ id, name, kind, city, stage: st === 'signing' ? 'signing' : 'signed', founding: st === 'signing' && !!c.card?.founding, owed: OWED[id] || 0, posters: posters(name), hw: 'Poster only', ...c, next: c.next ?? (st === 'signing' ? 'Finish onboarding in the merchant app' : null), val: 0 });
  }
  // the pipeline's own cards: shops that aren't in the merchant app yet
  for (const c of cards.filter((x) => !used.has(x.id)))
    MS.push({ id: c.id, name: c.name, kind: c.kind || 'Shop', city: c.city || '', stage: c.stage, founding: !!c.founding, owed: c.owed || 0, posters: c.posters ?? posters(c.name), hw: '–', ...fromCard(c) });
  const MSBY = Object.fromEntries(MS.map((m) => [m.id, m]));

  // Points are the only devices that check in: the merchant app's own statuses, problems first
  const FLEET_M = Object.fromEntries(FLEET.filter((f) => MSBY[f[0]]).map(([id, kinds, issue, seen]) => [id, { ...(kinds ?? {}), ...(issue ? { note: issue } : {}), seen: seen || '–' }]));

  /* ── follow-ups, visits and what needs a visit: the pipeline's next steps and its visit log ── */
  const LEADS = MS.filter((m) => m.card && m.stage !== 'closed').map((m) => ({
    shop: m.name,
    city: m.city,
    stage: m.stage === 'transacting' ? 'signed' : m.stage,
    owner: m.owner,
    last: m.last,
    next: m.next || 'Check in',
    due: m.due,
    val: m.val || 0,
    id: m.id,
  }));
  const hhmm = (t) => {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const VLOG = [];
  for (const s of stops)
    for (const tk of s.tasks)
      if (tk.done) VLOG.push({ d: 0, t: tk.done, who: staffK, shop: s.name, city: s.city, kind: tk.kind === 'visit' ? 'visit' : tk.kind, what: tk.t, out: tk.out || 'Fixed', note: tk.note || '', photo: !!tk.photo });
  for (const m of MS)
    for (const [at, text, who, kind] of m.card?.log ?? []) {
      if (kind !== 'visit') continue;
      const d = -daysAgo(at);
      if (d < -29) continue;
      const v = readVisit(text);
      VLOG.push({ d, t: hhmm(at), who: keyOf(who), shop: m.name, city: m.city, kind: 'merchant', what: 'Logged a visit', out: v.out || 'Visited', note: v.note, photo: false, from: v.from, to: v.to });
    }
  VLOG.sort((a, b) => b.d - a.d || b.t.localeCompare(a.t));

  const sevOf = (p, d) => (p.status === 'missing' ? 'absent' : p.status === 'faded' || d < 0 ? 'underway' : 'line');
  const onToday = new Set(stops.flatMap((s) => s.tasks.filter((t) => t.p).map((t) => t.p.n)));
  const POOL = [];
  for (const p of POSTERS.filter((p) => !onToday.has(p.n) && (p.status !== 'up' || daysTo(p.swap) <= 12)).sort((a, b) => a.swap - b.swap)) {
    const d = daysTo(p.swap);
    const st = p.status === 'missing' ? 'Missing' : p.status === 'faded' ? 'Faded' : d < 0 ? 'Swap late' : 'Swap due';
    POOL.push({
      id: 'p' + p.n,
      kind: 'poster',
      shop: p.shop,
      city: p.city,
      what: `${st === 'Missing' ? 'Put up a new' : st === 'Faded' ? 'Replace' : 'Swap'} P-${String(p.n).padStart(3, '0')}`,
      why: st === 'Missing' ? 'Gone from the window' : st === 'Faded' ? 'Faded in the sun' : d <= 0 ? `${-d} days late` : `Due ${fmtD(p.swap)}`,
      design: p.design,
      sev: sevOf(p, d),
      mins: 18,
      n: p.n,
    });
  }
  for (const m of MS.filter((m) => m.card && ['prospect', 'talking', 'signing'].includes(m.stage)))
    POOL.push({
      id: 'c:' + m.id,
      kind: 'merchant',
      shop: m.name,
      city: m.city,
      what: m.next || (m.stage === 'prospect' ? 'Walk in' : 'Follow up'),
      why: m.due != null ? (m.due < 0 ? `${-m.due} days overdue` : m.due === 0 ? 'Due today' : `Due ${fmtD(TODAY + m.due * DAY)}`) : m.last == null ? 'Never visited' : `Last visit ${m.last} days ago`,
      stage: m.stage,
      owner: m.owner,
      val: m.val || 0,
      mins: m.stage === 'prospect' ? 15 : 30,
      sev: m.due != null && m.due < 0 ? 'underway' : m.stage === 'signing' ? 'underway' : m.stage === 'talking' ? 'live' : 'line',
    });
  for (const [id, f] of Object.entries(FLEET_M)) {
    const bad = Object.values(f).flat();
    if (!bad.includes('off') && !bad.includes('low')) continue;
    // a fix already on today's route isn't waiting for one
    if (stops.some((s) => s.name === MSBY[id].name && s.tasks.some((t) => t.kind === 'device' && !t.done))) continue;
    POOL.push({ id: 'd:' + id, kind: 'device', shop: MSBY[id].name, city: MSBY[id].city, what: bad.includes('off') ? 'Get the Clear Point back online' : 'Swap the Point’s battery', why: f.note || 'From Merchants', sev: bad.includes('off') ? 'underway' : 'line', mins: 20 });
  }

  /* ── where things are: posters, people waiting and shops taking payments, by city ── */
  const tally = (list, key) => list.reduce((o, x) => (key(x) ? ((o[key(x)] = (o[key(x)] ?? 0) + 1), o) : o), {});
  const WAITING_BY_CITY = tally(vars.WAITLIST ?? [], (w) => w.city);
  const LIVE_BY_CITY = tally(MS.filter((m) => m.stage === 'transacting'), (m) => m.city);
  const SIGNING_BY_CITY = tally(MS.filter((m) => m.stage === 'signing'), (m) => m.city);

  /* ── dates: the next five weekdays (the reference's Thu, Fri, Mon, Tue, Wed after its Wednesday), the two after
     them a new route can also go on, and any day a route is planned for ── */
  const weekday = (d) => ![0, 6].includes(new Date(TODAY + d * DAY).getUTCDay());
  const DAYS = [];
  for (let d = 1; DAYS.length < 5 && d < 14; d++) if (weekday(d)) DAYS.push(d);
  const MORE = [];
  for (let d = DAYS[DAYS.length - 1] + 1; MORE.length < 2 && d < 21; d++) if (weekday(d)) MORE.push(d);

  /* ── Field's own records: the shops that said yes to a poster, the routes planned ahead, today's van ── */
  const YES = (vars.POSTER_YES ?? []).map((y) => ({ ...y }));
  // a yes waiting for its poster is a first poster to put up
  for (const y of YES.filter((y) => !y.placed))
    POOL.push({ id: 'y:' + y.id, kind: 'new', shop: y.shop, city: y.city, what: 'Put up a first poster', why: `From Placement · said yes ${fmtD(y.agreed)}`, sev: 'live', mins: 25, design: y.design || undefined, yes: y.id });
  const KINDS = new Set(['poster', 'new', 'merchant', 'device', 'visit']);
  const when = (t) => {
    if (t == null) return '';
    const d = new Date(t);
    return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}, ${hhmm(t)}`;
  };
  const ROUTES = (vars.PLANS ?? []).map((p) => {
    const d = Math.round((midnight(p.day) - TODAY) / DAY);
    // a planned stop is what needs a visit it came from, while that still needs one; else the stop as it was planned
    for (const s of p.stops)
      if (!POOL.some((x) => x.id === s.ref))
        POOL.push({ id: s.ref, kind: KINDS.has(s.kind) ? s.kind : 'visit', shop: s.shop, city: s.city, what: s.what, why: s.why, mins: s.mins, n: s.n ?? undefined, design: s.design ?? undefined, sev: 'line' });
    if (d > 0 && !DAYS.includes(d)) DAYS.push(d);
    return { id: String(p.id), d, who: keyOfId(p.who, p.whoName), by: keyOfId(p.by, p.byName), ids: p.stops.map((s) => s.ref), status: p.status, changed: p.changed, start: p.start || 'office', sentAt: when(p.sentAt), okAt: when(p.okAt), note: p.note || '' };
  });
  DAYS.sort((a, b) => a - b);
  const VAN = vars.VAN ?? null;

  /* ── a stop can be any shop: the merchant app's and the pipeline's, and where the posters are ── */
  const SHOPLIST = new Map();
  for (const m of MS) if (m.stage !== 'closed') SHOPLIST.set(m.name, [m.city, ['transacting', 'signed'].includes(m.stage) ? 'Partner' : 'Prospect']);
  for (const p of POSTERS) if (!SHOPLIST.has(p.shop)) SHOPLIST.set(p.shop, [p.city, 'Poster']);

  const now = new Date(TODAY);
  const month = { long: MONTH[now.getUTCMonth()], short: MON[now.getUTCMonth()], last: MONTH[(now.getUTCMonth() + 11) % 12], lastShort: MON[(now.getUTCMonth() + 11) % 12] };

  return {
    TODAY,
    DAYS,
    MORE,
    month,
    TEAM,
    meK,
    keyOf,
    uidOf,
    ROUTES,
    VAN,
    YES,
    SHOPLIST: [...SHOPLIST.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    POSTERS,
    DESIGNS: designs,
    ROUTE,
    staffK,
    STOPS: stops,
    SHOP_INFO,
    LATER: later,
    POOL,
    LEADS,
    VLOG,
    WAITING_BY_CITY,
    waitingKnown: Array.isArray(vars.WAITLIST),
    LIVE_BY_CITY,
    SIGNING_BY_CITY,
    MS,
    OWED,
    FLEET: FLEET_M,
    seats: fig('merchants.founding_seats') ?? 5,
    schedule: fig('merchants.payouts.schedule') ?? null,
    /** Last month's sales at each shop, paid now or on plans, and what members repaid (TermIssuer); null until the API reads the chain. */
    collected: vars.collected ?? null,
    /** The monthly payout runs, newest first: each one's proposal, and its record once a second person approved it. */
    runs: vars.merchantRuns ?? [],
    /** The PayoutPool's unpaid claims (each NET-14 shop's payouts, as the chain schedules them); null until the API reads the chain. */
    claims: vars.payoutClaims ?? null,
    /** The refurb line's units, oldest first. */
    refurb: vars.refurb ?? [],
    /** The shops' hardware pre-orders, from the shop's reservations. */
    preorders: vars.preorders ?? [],
    /** The site's shop enquiries, newest first, their contacts masked. */
    enquiries: vars.enquiries ?? [],
    /** The signed-in person's id, as a run's proposer is named (nobody approves their own). */
    meId: me?.id ?? null,
    newest: fig('merchants.newest_partner') ?? null,
  };
}
