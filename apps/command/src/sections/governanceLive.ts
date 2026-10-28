// @ts-nocheck: reads the section data the API fills, which is untyped, as the sections are.
import { needsData } from '../live/sections';
import { AGENDA, AGR, BODIES, ENT, ENTF, FILINGS, GBOARDS, MATTERS, MEETS, OWN, PARENT, PEOPLE, RESOS, RP, UNDER, VOTE, vars } from './data';

/*
 * Governance's datasets, live (governance2.tsx reads these in place of the reference's when REAL): built
 * from what the API's governance section sends (live/sections.ts fills ./data from it: the entities and
 * who owns them, each board's seats, the filings, the next meeting's agenda, the resolutions, the board
 * people, the meetings, the related-party log, the reserved matters and the latest member vote) and,
 * for the agreements, Build's (contracts) section, which the page loads beside its own.
 *
 * People are only who the data names: you, and the names the API sends for seats, agenda items and
 * filings (members stay masked, as the API sends them). What nothing records yet is empty, never the
 * reference's: proposals as a lifecycle (drafts, co-signers, the check, tasks), the forum and the
 * Delegate Assembly (docs/ui-redesign-plan.md, gaps).
 *
 * Agreement versions are the governance section's (migration 0068): each agreement's, drafted by one
 * person and adopted with a second, and what the apps record people accepting (TERMS: counts by
 * document@version), joined to the versions linked to them.
 */

const DAY = 864e5;
const initials = (n) =>
  (n || '?')
    .split(/[ @.,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
/** A date the API keeps as a number, a date string ("12 Jun 2026") or nothing: a time, or null. */
const toMs = (v) => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v.trim() + (/\d{4}$/.test(v.trim()) ? ' UTC' : ''));
    return Number.isFinite(t) ? t : null;
  }
  return null;
};
const FST_OK = new Set(['ready', 'draft', 'none', 'later', 'done']);
const EST_OK = new Set(['formed', 'forming', 'planned']);
const AST_OK = new Set(['signed', 'renew', 'draft', 'out', 'sent']);
/** Whoever decides (2), must approve (1) or is told (0) of a reserved matter, by the bodies' names. */
const bodiesAt = (roles, v) => (roles || []).map((x, i) => (x === v ? BODIES[i] : null)).filter(Boolean);

export function governanceLive() {
  const NOW = Date.now();
  const TODAY = Math.floor(NOW / DAY) * DAY;
  const me = vars.me;
  /** Your levels, when signed in; the empty preview has no one signed in, so it shows the controls (nothing runs there). */
  const can = () => !me || Number(me.levels?.governance ?? 0) >= 3;

  /* people: you, and the names the data gives */
  const PPL = {
    me: me ? { n: me.name || me.email, ini: initials(me.name || me.email), role: 'You', staff: true } : { n: 'You', ini: 'ME', role: 'You', staff: true },
  };

  /* entities: id, name, kind, status, what it does */
  const ENTL = ENT.map((e) => [e[0], e[1], e[2] || '', EST_OK.has(e[3]) ? e[3] : 'planned', e[4] || '']);
  const ids = new Set(ENTL.map((e) => e[0]));
  const PAR = Object.fromEntries(ENTL.map((e) => [e[0], PARENT[e[0]] && ids.has(PARENT[e[0]]) ? PARENT[e[0]] : null]));
  // how much the parent owns: the API's own, else what it says the entity sits under ("Holdings 100%" is 100%)
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const OWNL = {};
  for (const e of ENTL) {
    if (!PAR[e[0]]) continue;
    const u = UNDER[e[0]] ? cap(String(UNDER[e[0]]).replace(/^\S+\s+/, '')) : '';
    OWNL[e[0]] = OWN[e[0]] || u || 'Owned';
  }
  const ENTFL = {};
  for (const e of ENTL) {
    const f = ENTF[e[0]] || {};
    ENTFL[e[0]] = {
      tax: f.tax || 'Not recorded',
      // the date it formed, or the API's words for it ("Before the co-op")
      formed: toMs(f.formed) ?? (typeof f.formed === 'string' && f.formed.trim() ? f.formed : null),
      ein: f.ein || 'Not recorded',
      officers: f.officers || 'Not recorded',
      steps: Array.isArray(f.steps) && f.steps.length ? f.steps.map((s) => [String(s[0]), s[1] ? 1 : 0]) : null,
      due: toMs(f.due),
      agr: Array.isArray(f.agr) ? f.agr : [],
    };
  }

  /* boards: id (the entity it governs), name, who it answers to (the API's note), seats, off */
  const GB = GBOARDS.map(([name, ent, seats, note]) => [ent || name, name, note || '', (seats || []).map(([c, h, a, b, n]) => [c, h || null, Number(a) || 0, Number(b) || 0, ...(n ? [n] : [])]), false]);
  const boardBy = (name) => GB.find((b) => b[1] === name);

  /* meetings: each board's, held and next, from the API's timeline per body */
  const MT = [];
  const MEMBER_EVENTS = [];
  for (const [body, evs] of MEETS) {
    const b = boardBy(body);
    if (!b) {
      // the members' own (the annual meeting): on the calendar, not a board's meeting
      for (const e of evs || []) if (e[0] === 'next' && e[1] >= TODAY) MEMBER_EVENTS.push({ t: e[1], title: e[2] || `${body} meet` });
      continue;
    }
    const held = [];
    for (const e of evs || []) {
      if (e[0] !== 'held' && e[0] !== 'next') continue;
      const next = e[0] === 'next' && e[1] >= TODAY;
      const row = [`${b[0]}-${e[1]}`, b[0], e[1], e[2] || (next ? 'Next meeting' : 'Meeting'), next ? 'next' : 'held', null];
      MT.push(row);
      if (!next) held.push(row);
    }
    // minutes still to approve: the API marks them due, after the last meeting held
    const due = (evs || []).filter((e) => e[0] === 'due');
    if (due.length && held.length) {
      const last = held.sort((x, y) => y[2] - x[2])[0];
      if (due.some((d) => d[1] >= last[2])) last[5] = 'approve';
    }
  }
  MT.sort((a, b) => (a[4] === b[4] ? (a[4] === 'next' ? a[2] - b[2] : b[2] - a[2]) : a[4] === 'next' ? -1 : 1));
  const NEXT = MT.find((m) => m[4] === 'next' && m[1] === 'coop') ?? MT.find((m) => m[4] === 'next') ?? null;

  /* the next meeting's agenda: item, minutes, owner, kind */
  const AG = AGENDA.map(([t, m, o, k]) => [t, Number(m) || 0, o || '—', ['vote', 'report', 'discuss'].includes(k) ? k : 'discuss']);

  /* resolutions: date, board (its id), title, votes by seat, no proposal (proposals aren't kept); and where it is in the old list */
  const RS = RESOS.map((r, i) => [r[0], boardBy(r[1])?.[0] ?? r[1], r[2], Array.isArray(r[3]) ? r[3].map((x) => (['y', 'n', 'r', 'a'].includes(x) ? x : 'a')) : [], null, i]);

  /* who decides what: the reserved matters, by body */
  const DECIDES = MATTERS.map(([d, roles, open], i) => ({ d, i, decides: bodiesAt(roles, 2), approve: bodiesAt(roles, 1), told: bodiesAt(roles, 0), open: open || '' }));
  const RESERVED = DECIDES.map((m) => [m.d, m.decides.includes('Members') ? 'Needs a member vote' : m.decides.join(' and ') || '—']);

  /* filings: id, entity, title, due, status, owner */
  const FL = FILINGS.filter((f) => f[3]).map((f) => [f[0], f[1], f[2], f[3], FST_OK.has(f[4]) ? f[4] : 'none', f[5] || '—']);

  /* the latest member vote */
  const days = Array.isArray(VOTE.days) ? VOTE.days.map(Number) : [];
  const V =
    VOTE.t && VOTE.open && VOTE.close
      ? {
          t: VOTE.t,
          open: VOTE.open,
          close: VOTE.close,
          elig: Number(VOTE.elig) || 0,
          q: Number(VOTE.quorum) || 0,
          days,
          cast: days.length ? days[days.length - 1] : (VOTE.yes || 0) + (VOTE.no || 0) + (VOTE.abs || 0),
          yes: VOTE.yes || 0,
          no: VOTE.no || 0,
          abs: VOTE.abs || 0,
          closed: VOTE.close <= NOW,
        }
      : null;

  /* agreements, from Build's section: the API's shape, with the statuses the page names */
  // live, Build's section loads with the page (the empty preview has nothing to load)
  const AG_LOADED = !needsData('contracts');
  const AGRL = AGR.map((a) => ({ id: a.id, name: a.name || 'Agreement', party: a.party || '—', type: a.type || 'provider', st: AST_OK.has(a.st) ? a.st : 'draft', a: a.a || null, b: a.b || null, ver: a.ver || '—', note: a.note || '', ...(a.sent ? { sent: a.sent } : {}), ...(a.roll ? { roll: 1 } : {}) }));

  /* agreement versions: by agreement, oldest first, each [version, status, when, who adopts it, changes, terms, …] as
     the reference's VERS has them (in · old · draft), with who asked, who approved and when it was replaced */
  const gv = vars.govVersions ?? { VERS: {}, TERMS: [] };
  const VST_OK = new Set(['in', 'old', 'draft']);
  const VERSL = {};
  for (const [id, list] of Object.entries(gv.VERS || {}))
    if (Array.isArray(list) && list.length)
      VERSL[id] = list.map((v) => ({
        v: String(v.v || '—'),
        st: VST_OK.has(v.st) ? v.st : 'draft',
        at: Number(v.at) || NOW,
        replaced: v.replaced || null,
        by: v.by || '',
        changes: Array.isArray(v.changes) ? v.changes.map(String) : [],
        terms: v.terms || null,
        adoptedBy: v.adoptedBy || '',
        approvedBy: v.approvedBy || '',
        draftedBy: v.draftedBy || '',
      }));
  /* what the apps record as accepted: document@version, how many, the first and last; and which version each is */
  const TERMS = (Array.isArray(gv.TERMS) ? gv.TERMS : []).map((t) => ({ key: t.key, doc: t.doc, version: t.version, n: Number(t.n) || 0, first: t.first || null, last: t.last || null, who: t.who }));
  const linked = new Set(Object.values(VERSL).flatMap((V) => V.map((v) => v.terms).filter(Boolean)));
  const UNLINKED = TERMS.filter((t) => !linked.has(t.key));

  /* related-party deals: payer, payee, what, payments, amount, on an agenda */
  const RPL = RP.map((r, i) => ({ i, from: r[0], to: r[1], what: r[2], paid: Array.isArray(r[3]) ? r[3] : [], amt: Number(r[4]) || 0, agenda: r[5] || null }));

  return {
    NOW,
    TODAY,
    me: 'me',
    can,
    PPL,
    ENT: ENTL,
    PARENT: PAR,
    OWN: OWNL,
    ENTF: ENTFL,
    GBOARDS: GB,
    MEETINGS: MT,
    NEXT,
    MEMBER_EVENTS,
    AGENDA: AG,
    RESOS: RS,
    RESERVED,
    DECIDES,
    FILINGS: FL,
    VOTE: V,
    AGR: AGRL,
    AG_LOADED,
    VERS: VERSL,
    TERMS,
    UNLINKED,
    RP: RPL,
    PEOPLE: PEOPLE.map(([n, b, note]) => [n, b || [], note || '']),
  };
}
