// @ts-nocheck: reads the section data the API fills, which is untyped, as the sections are.
import { shortId } from '../live/account';
import { api } from '../live/api';
import { LIVE } from '../live/env';
import { feedList, hasFeeds, loadFeeds } from '../live/feeds';
import { COVER, DCOUNT, DOCS, ENT, ENTF, ROLES, VSEC, vars } from './data';

/*
 * Records, Team and Settings' datasets, live (admin2.tsx reads these in place of the reference's when
 * REAL). Each comes from the API, never the reference's people, figures or dates:
 *
 *   Team      GET /groups and /people (live/account.ts keeps them as `vars.teamRaw`), what waits for a
 *             second person (GET /proposals?area=all) and what was approved in 30 days (&approved=30),
 *             the Ops Safe's owners (GET /safe) for who signs;
 *   Settings  GET /sections/settings: every rule, the change waiting on each, the approved changes with
 *             their old values (HISTORY); the feeds' health (GET /feeds) for Connections;
 *   Records   the records section (documents, counts, coverage), GET /audit (the log, its seq, hash and
 *             the chain's state) and GET /reveals (every reveal; a whole list is an export).
 *
 * What none of them has (connection history and keys, alerts, devices' trust, worth a look, the org
 * profile, backups) is empty here and "Not real yet" on the page; docs/ui-redesign-plan.md lists it.
 *
 * The datasets are made once and refilled in place (`fill`, before every draw; `load` fetches first), so
 * the module's consts stay the ones drawn.
 */

const DAY = 864e5;
/** The page's sections, in the reference's order (admin2.tsx's SECS); the API calls Build contracts and Team access. */
export const SECS13 = ['home', 'growth', 'field', 'members', 'merchants', 'shop', 'money', 'build', 'community', 'governance', 'records', 'team', 'settings'];
const PAGE = {
  home: 'Home',
  growth: 'Growth',
  field: 'Field',
  members: 'Members',
  merchants: 'Merchants',
  shop: 'Shop',
  money: 'Money',
  build: 'Build',
  community: 'Community',
  governance: 'Governance',
  records: 'Records',
  team: 'Team',
  settings: 'Settings',
};
export const apiKey = (k) => (k === 'build' ? 'contracts' : k === 'team' ? 'access' : k);
const routeOf = (area) => (area === 'contracts' ? 'build' : area === 'access' ? 'team' : area);
/** An area of the log as Records colours it (admin2's AREAS); records gets its own. */
const AREA = {
  members: 'members',
  growth: 'field',
  field: 'field',
  merchants: 'field',
  money: 'money',
  shop: 'shop',
  contracts: 'chain',
  governance: 'gov',
  community: 'gov',
  access: 'team',
  settings: 'team',
  records: 'records',
  alert: 'alert',
  home: 'system',
};
/** What each feed is, and the pages that read it: the app's own wiring, not data. */
const FEED = {
  protocol: ['Base Sepolia · the contracts and pools', ['build', 'money', 'home']],
  plaid: ['Bank data · sandbox', ['money']],
  bridge: ['Stablecoin services · sandbox', ['money']],
  lithic: ['Card program · sandbox', ['money', 'merchants']],
  stripe: ['Shop payments · sandbox', ['shop', 'money']],
  shop: ['Orders from useclear.org/shop', ['shop', 'home']],
  catalog: ['The store’s products', ['shop']],
  site: ['useclear.org visits', ['growth']],
};

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const ms = (v) => (v == null ? null : typeof v === 'number' ? v : new Date(v).getTime());
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b),
    m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const money = (n) => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** A setting's value as the page words it (admin2's fmtV). */
const words = (s, v) =>
  v == null
    ? '—'
    : s.kind === 'money'
      ? money(num(v))
      : s.kind === 'pct'
        ? v + '%'
        : s.kind === 'hours'
          ? v + ' hours'
          : s.kind === 'days'
            ? v + ' days'
            : s.kind === 'num'
              ? `${v} ${v === 1 || /le$/.test(s.unit) ? s.unit : s.unit + 's'}`
              : s.kind === 'on'
                ? v
                  ? 'On'
                  : 'Off'
                : v;
/** On and off are 1 and 0 on the page, as the reference has them; the API's are booleans. */
const onOff = (s, v) => (s.kind === 'on' ? (v ? 1 : 0) : v);

/** What the API last answered, kept across the module being built again. */
const RAW = { audit: null, chain: null, reveals: null, waiting: null, approved: null };

/** Fills an array or object the module holds, in place. */
function into(target, src) {
  if (Array.isArray(target)) target.splice(0, target.length, ...src);
  else {
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, src);
  }
}

export function adminLive() {
  const NOW = Date.now();
  const d0 = new Date(NOW);
  const TODAY = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
  const D = {
    GROUPS: {},
    GKEYS: [],
    PEOPLE: [],
    INVITES: [],
    PPL: {},
    NAMES: {},
    RULES: [],
    CAN: [],
    APPR: {},
    APPR_ROWS: [],
    APPR_COLS: [],
    WAITING: [],
    SI: {},
    ENDS: [],
    SETS: [],
    SETO: {},
    PEND: [],
    SET_HIST: [],
    CONN: [],
    ENT: [],
    ENTO: {},
    DOCS: [],
    DCOUNT: {},
    COVER: {},
    LOG: [],
    ENTRY: {},
    WHO: [],
    LW: [],
    WEEK: [],
    REVEALS: [],
    EXPORTS: [],
    CHAIN: null,
    SAFE: null,
  };
  const L = {
    ...D,
    NOW,
    TODAY,
    ME: 'VW',
    MEMBERS_N: 0,
    /** The signed-in person's level on one of the page's sections. */
    myLevel: (sec) => num(vars.me?.levels?.[apiKey(sec)]),
    /** Whether the API has answered for Settings (the empty preview never has). */
    hasSettings: false,
    load,
    /** Draws the datasets again from what's held (a flow elsewhere loaded the team or a section afresh). */
    fill,
  };

  function fill() {
    const me = vars.me;
    // the team: the API's groups (every section's level), else the app's own list of them (the empty preview)
    const raw = vars.teamRaw?.groups ?? null;
    const lv13 = (o) => SECS13.map((k) => num(o?.[apiKey(k)]));
    const GROUPS = {};
    if (raw) for (const g of raw) GROUPS[g.key] = g.auto ? [g.name, g.description, lv13(g.levels), 1] : [g.name, g.description, lv13(g.levels)];
    else
      for (const [k, [n, d, a, auto]] of Object.entries(ROLES)) {
        const o = Object.fromEntries(VSEC.map((s, i) => [s === 'team' ? 'access' : s, a[i]]));
        // as migration 0056 filled them: Community from Governance, Settings from Team
        o.community = o.governance;
        o.settings = o.access;
        GROUPS[k] = auto ? [n, d, lv13(o), 1] : [n, d, lv13(o)];
      }
    if (!GROUPS.members) GROUPS.members = ['Members', 'Everyone with a Clear account', SECS13.map(() => 0), 1];
    const people = vars.teamRaw?.people ?? [];
    const safe = vars.safe?.configured ? vars.safe : null;
    const signers = new Set((safe?.owners ?? []).map((o) => o.person?.id).filter(Boolean));
    const key = (p) => shortId({ id: p.id, name: p.name || p.email });
    const NAMES = {};
    const active = people.filter((p) => !p.off && (p.lastSignIn || !p.invited));
    const PEOPLE = active.map((p) => {
      const id = key(p);
      NAMES[id] = p.name || p.email || 'Someone';
      let g = p.group;
      // custom access: a group of their own, which the Groups tab doesn't list
      if (!g || !GROUPS[g]) {
        g = `~${id}`;
        GROUPS[g] = ['Custom access', 'Levels set for this person', lv13(p.custom)];
      }
      const city = (label) => p.signIns.find((s) => s.device === label)?.city;
      return {
        id,
        uid: p.id,
        email: p.email || '',
        n: NAMES[id],
        g,
        title: p.title || GROUPS[g][1] || GROUPS[g][0],
        since: ms(p.since),
        last: ms(p.lastSignIn),
        passkey: p.passkey ? 1 : 0,
        signer: signers.has(p.id) ? 1 : 0,
        // a device that has signed in; whether it's trusted isn't recorded
        dev: p.devices.map((d) => [[d.label, city(d.label)].filter(Boolean).join(' · '), ms(d.lastSeen), 1]),
        ...(p.expiresAt ? { until: ms(p.expiresAt) } : {}),
      };
    });
    const INVITES = people
      .filter((p) => !p.off && !p.lastSignIn && p.invited)
      .map((p) => {
        const id = key(p);
        NAMES[id] = p.name || p.email || 'Someone';
        return {
          id,
          uid: p.id,
          n: NAMES[id],
          email: p.email || '',
          g: GROUPS[p.group] ? p.group : 'members',
          title: p.title || 'Invited',
          sent: ms(p.since),
          exp: ms(p.invited.expiresAt),
          by: '',
          ok: '',
        };
      });
    const byUuid = new Map([...PEOPLE, ...INVITES].map((p) => [p.uid, p.id]));
    const ME = me ? shortId({ id: me.id, name: me.name || me.email }) : 'VW';
    if (me) NAMES[ME] = me.name || me.email || 'You';
    /** Someone by name (Settings' changes and the log name people): their key on the team, else one of their own. */
    const byName = new Map(PEOPLE.map((p) => [p.n, p.id]));
    const keyOfName = (n) => {
      if (!n) return '';
      if (byName.has(n)) return byName.get(n);
      const k = shortId({ id: `name:${n}`, name: n });
      NAMES[k] = n;
      return k;
    };
    const keyOf = (uuid, name) => {
      if (!uuid) return 'SY';
      if (byUuid.has(uuid)) return byUuid.get(uuid);
      const k = shortId({ id: uuid, name: name || 'Someone' });
      NAMES[k] ??= name || 'Someone';
      return k;
    };

    // who can approve where: on the team, at Approve on the section (their group's or their own levels)
    const at = (p, sec) => GROUPS[p.g][2][SECS13.indexOf(sec)];
    const can = (sec, lv) => PEOPLE.filter((p) => at(p, sec) >= lv).map((p) => p.id);
    const approved = RAW.approved ?? [];
    const waiting = RAW.waiting ?? [];
    const hrs = (p) => (ms(p.approvedAt) - ms(p.createdAt)) / 3600e3;
    const kindOf = (p) => p.payload?.kind ?? '';
    // the two-person rules the API enforces, each with its area and which of its proposals are its
    const RULE = [
      ['money', 'Money moves', 'Top-ups and any move out of a co-op account', 'money', () => true, 'money'],
      ['shopbuy', 'Shop buys and reorders', 'Supplier orders and recorded buys', 'shop', (p) => !/refund/.test(kindOf(p)), 'shopbuy'],
      ['refund', 'Shop refunds', 'Back the way the member paid', 'shop', (p) => /refund/.test(kindOf(p)), 'refund'],
      ['chain', 'On-chain changes', 'Upgrades, caps and shop terms, in the Ops Safe', 'contracts', () => true, 'safe'],
      ['invites', 'Invite batches', 'Each batch, oldest on the waitlist first', 'members', (p) => kindOf(p) === 'batch', 'batch'],
      ['access', 'Access changes', 'Giving Approve anywhere, or a change from below Approve on Team', 'access', () => true, 'access'],
      ['settings', 'Settings changes', 'Any number on the Settings page', 'settings', () => true, 'settings'],
    ];
    const RULES = RULE.map(([id, t, c, area, mine, set]) => {
      const done = approved.filter((p) => p.area === area && mine(p));
      return { id, t, c, who: can(routeOf(area), 4), n30: done.length, med: median(done.map(hrs)), set, area, mine };
    });
    const ruleOf = (p) => RULES.find((r) => r.area === p.area && r.mine(p));
    const lvMe = (sec) => num(me?.levels?.[apiKey(sec)]);
    const WAITING = waiting.map((p) => {
      const by = keyOf(p.proposedBy),
        r = ruleOf(p);
      const on = p.proposedBy === me?.id ? '' : lvMe(routeOf(p.area)) >= 4 ? ME : '';
      return [p.summary, PAGE[routeOf(p.area)] ?? 'Change', by, on, Math.max(0, Math.round((NOW - ms(p.createdAt)) / 3600e3)), r?.med ?? 0, r?.id ?? p.area, p.id];
    });
    // proposer → approver, last 30 days
    const APPR = {};
    for (const p of approved) {
      if (!p.approvedBy) continue;
      const a = keyOf(p.proposedBy),
        b = keyOf(p.approvedBy);
      (APPR[a] ??= {})[b] = (APPR[a][b] ?? 0) + 1;
    }
    const first = (id) => (NAMES[id] || id).split(/[ @]/)[0];
    const APPR_ROWS = Object.keys(APPR).map((id) => [id, NAMES[id] || id]);
    const APPR_COLS = [...new Set(Object.values(APPR).flatMap((r) => Object.keys(r)))].map((id) => [id, first(id)]);
    const CAN = [
      ['Start a money move', can('money', 3)],
      ['Propose an on-chain change', can('build', 3)],
      ...(safe ? [['Sign in the Ops Safe', PEOPLE.filter((p) => p.signer).map((p) => p.id)]] : []),
      ['Reveal personal details', can('members', 4)],
      ['Add a document', can('records', 3)],
      ['Invite or turn off a person', can('team', 3)],
      ['Propose a settings change', can('settings', 3)],
    ];
    // sign-ins on each of the last 7 days (UTC, as the page labels them)
    const days = Array.from({ length: 7 }, (_, i) => TODAY - (6 - i) * DAY);
    const SI = Object.fromEntries(active.map((p) => [key(p), days.map((t) => p.signIns.filter((s) => ms(s.at) >= t && ms(s.at) < t + DAY).length)]));
    // access that ends in the next 90 days: invites and anyone with an end date
    const ENDS = [
      ...INVITES.map((i) => [i.exp, `${i.n}’s invite expires`, 'Resend it, or it lapses', `i:${i.id}`]),
      ...PEOPLE.filter((p) => p.until).map((p) => [p.until, `${p.n}’s access ends`, GROUPS[p.g][0], `p:${p.id}`]),
    ]
      .filter(([t]) => t >= TODAY && t <= TODAY + 90 * DAY)
      .sort((a, b) => a[0] - b[0]);

    // settings
    const sets = vars.SETTINGS ?? null;
    const SETS = (sets ?? []).map((s) => ({
      id: s.id,
      sec: s.sec,
      t: s.t,
      d: s.d,
      kind: s.kind,
      v: onOff(s, s.value),
      unit: s.unit,
      opts: s.opts,
      why: s.why,
      where: s.where,
      used: s.used ?? [],
      enforced: s.enforced ?? null,
    }));
    const SETO = Object.fromEntries(SETS.map((s) => [s.id, s]));
    const PEND = (sets ?? [])
      .filter((s) => s.pending && SETO[s.id])
      .map((s) => {
        const by = keyOfName(s.pending.by) || 'VW';
        const mine = !!me && (by === ME || s.pending.by === (me.name || me.email));
        return {
          id: s.pending.id,
          set: s.id,
          from: SETO[s.id].v,
          to: onOff(s, s.pending.to),
          by: mine ? ME : by,
          at: ms(s.pending.at),
          why: s.pending.why,
          need: !mine && lvMe('settings') >= 4 ? ME : '',
        };
      });
    const SET_HIST = (vars.SETTINGS_HISTORY ?? [])
      .filter((h) => SETO[h.set])
      .map((h) => [h.id.slice(0, 8), ms(h.at), h.set, words(SETO[h.set], onOff(SETO[h.set], h.from)), words(SETO[h.set], onOff(SETO[h.set], h.to)), keyOfName(h.by), keyOfName(h.approvedBy)]);

    // connections: the feeds' health now; no hourly history, no keys
    const CONN = feedList().map((f) => {
      const st = f.health === 'synced' ? 'ok' : f.health === 'behind' || f.health === 'failing' ? 'behind' : 'off';
      const age =
        f.behindMs == null
          ? null
          : f.behindMs < 90e3
            ? `${Math.max(1, Math.round(f.behindMs / 1e3))} seconds`
            : f.behindMs < 90 * 60e3
              ? `${Math.round(f.behindMs / 60e3)} min`
              : `${Math.round(f.behindMs / 3600e3)} hours`;
      const note =
        f.health === 'off'
          ? `Off · ${f.offReason || 'not set up'}`
          : f.health === 'failing'
            ? `Not reached · ${(f.error || 'no answer').slice(0, 80)}`
            : f.health === 'never'
              ? 'Not synced yet'
              : age
                ? `${age} behind`
                : 'Synced';
      return {
        id: f.id,
        n: f.name,
        what: FEED[f.id]?.[0] ?? 'A feed',
        st,
        stLabel: f.health === 'off' ? 'Off' : f.health === 'never' ? 'Not yet' : '',
        note,
        last: f.syncedAt ?? f.asOf ?? null,
        by: '',
        key: '',
        keyNote: f.health === 'off' ? 'Not set up' : 'Key kept on the server',
        used: FEED[f.id]?.[1] ?? [],
        hrs: [],
        idle: 0,
      };
    });

    // the co-op's entities (its structure) and their papers
    const ENTS = ENT.map((e) => [
      e[0],
      e[1],
      e[2],
      e[3],
      String(ENTF[e[0]]?.ein ?? '')
        .replace(/\D/g, '')
        .slice(-4),
    ]);
    const ENTO = Object.fromEntries(ENTS.map((e) => [e[0], e]));
    const DOCS2 = DOCS.filter((d) => ENTO[d[3]]).map((d) => d.slice(0, 9));
    const KINDS = ['agreement', 'minutes', 'filing', 'policy', 'bond', 'report'];
    const DCOUNT2 = Object.fromEntries(KINDS.map((k) => [k, DCOUNT[k] != null ? num(DCOUNT[k]) : DOCS2.filter((d) => d[2] === k).length]));
    const COVER2 = Object.fromEntries(Object.entries(COVER).filter(([id, c]) => ENTO[id] && Array.isArray(c) && c.length === 6));

    // the audit log, newest first: who by their key on the team, the area as Records colours it
    const ENTRY = {};
    const LOG = (RAW.audit ?? []).map((e) => {
      const id = String(e.id);
      ENTRY[id] = { id: e.id, seq: num(e.seq), hash: e.hash || '', prev: e.prev_hash || '', corrects: e.corrects ?? null };
      const who = e.person_id ? keyOf(e.person_id, e.who) : 'SY';
      const result = { done: 'done', waiting: 'waiting', approved: 'approved', declined: 'declined', refused: 'refused' }[e.result] ?? 'done';
      return [
        id,
        ms(e.at),
        who,
        AREA[e.area] ?? 'system',
        e.action,
        e.detail || '',
        e.from_where || '',
        result,
        e.approver ? `Approved by ${e.approver}` : result === 'waiting' ? 'Needs a second person' : '',
      ];
    });
    const week = TODAY - 6 * DAY;
    const WHO = [...new Map([...LOG.filter((l) => l[1] >= week && l[2] !== 'SY').map((l) => [l[2], NAMES[l[2]] || l[2]]), ['SY', 'System']]).entries()];
    const LW = [['all', 'Everyone'], ...WHO.map(([k, n]) => [k, k === 'SY' ? 'System' : n.split(/[ @]/)[0]])];

    // reveals: one person's details; a whole list that was shown is an export
    const whole = (r) => r.subject === '*' || num(r.rows) > 1;
    const field = (f) => (f ? f.charAt(0).toUpperCase() + f.slice(1) : 'Details');
    const REVEALS = (RAW.reveals ?? [])
      .filter((r) => !whole(r))
      .map((r) => [ms(r.at), keyOf(r.person_id, r.who), r.subject, field(r.field), r.reason || '', PAGE[routeOf(r.section)] ?? r.section, r.flagged]);
    const EXPORTS = (RAW.reveals ?? [])
      .filter(whole)
      .map((r) => [
        ms(r.at),
        keyOf(r.person_id, r.who),
        `${PAGE[routeOf(r.section)] ?? r.section} · ${r.field} for the whole list${r.reason ? ` · “${r.reason}”` : ' · no reason given'}`,
        num(r.rows),
        '',
        'done',
        'None yet · not asked for',
      ]);

    const PPL = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));
    into(L.GROUPS, GROUPS);
    into(
      L.GKEYS,
      Object.keys(GROUPS).filter((k) => !GROUPS[k][3] && !k.startsWith('~')),
    );
    into(L.PEOPLE, PEOPLE);
    into(L.INVITES, INVITES);
    into(L.PPL, PPL);
    into(L.NAMES, NAMES);
    into(L.RULES, RULES);
    into(L.CAN, CAN);
    into(L.APPR, APPR);
    into(L.APPR_ROWS, APPR_ROWS);
    into(L.APPR_COLS, APPR_COLS);
    into(L.WAITING, WAITING);
    into(L.SI, SI);
    into(L.ENDS, ENDS);
    into(L.SETS, SETS);
    into(L.SETO, SETO);
    into(L.PEND, PEND);
    into(L.SET_HIST, SET_HIST);
    into(L.CONN, CONN);
    into(L.ENT, ENTS);
    into(L.ENTO, ENTO);
    into(L.DOCS, DOCS2);
    into(L.DCOUNT, DCOUNT2);
    into(L.COVER, COVER2);
    into(L.LOG, LOG);
    into(L.ENTRY, ENTRY);
    into(L.WHO, WHO);
    into(L.LW, LW);
    into(L.REVEALS, REVEALS);
    into(L.EXPORTS, EXPORTS);
    L.CHAIN = RAW.chain;
    L.SAFE = safe ? { threshold: num(safe.threshold), owners: (safe.owners ?? []).length } : null;
    L.ME = ME;
    L.MEMBERS_N = num(vars.memberSummary?.active);
    L.hasSettings = !!sets;
  }

  /** Everything the page draws, from the API, then the datasets refilled. Each part only where you can see it. */
  async function load() {
    if (!LIVE) return;
    const lv = (k) => num(vars.me?.levels?.[k]);
    const get = (ok, path) => (ok ? api('GET', path).catch(() => null) : Promise.resolve(null));
    const any = Object.values(vars.me?.levels ?? {}).some((v) => v >= 2);
    const [groups, people, settings, audit, reveals, waiting, approved] = await Promise.all([
      get(lv('access') >= 2, '/groups'),
      get(lv('access') >= 2, '/people'),
      get(lv('settings') >= 1, '/sections/settings'),
      get(lv('records') >= 2, '/audit'),
      get(lv('records') >= 2, '/reveals'),
      get(any, '/proposals?area=all'),
      get(any, '/proposals?area=all&approved=30'),
      hasFeeds() ? null : loadFeeds().catch(() => undefined),
      lv('contracts') >= 2 && !vars.safe ? import('../live/safe').then((m) => m.loadSafe()).catch(() => undefined) : null,
    ]);
    if (groups?.groups && people?.people) vars.teamRaw = { groups: groups.groups, people: people.people };
    if (settings?.SETTINGS) {
      vars.SETTINGS = settings.SETTINGS;
      vars.SETTINGS_HISTORY = settings.HISTORY ?? [];
    }
    if (audit) {
      RAW.audit = audit.entries ?? [];
      RAW.chain = audit.chain ?? null;
    }
    if (reveals) RAW.reveals = reveals.reveals ?? [];
    if (waiting) RAW.waiting = waiting.proposals ?? [];
    if (approved) RAW.approved = approved.proposals ?? [];
    fill();
  }

  fill();
  return L;
}

/** The page's actions, through the API. Each resolves to its answer; the page loads again after. */
export const adminApi = {
  /** A group's levels, all thirteen sections (PATCH /groups/:key; Approve somewhere new waits for a second admin). */
  group: (key, lv) => api('PATCH', `/groups/${key}`, { levels: Object.fromEntries(SECS13.map((k, i) => [apiKey(k), lv[i]])) }),
  /** Someone's access: a group, off, or levels of their own. */
  access: (uid, body) => api('PATCH', `/people/${uid}/access`, body),
  resend: (uid) => api('POST', `/invites/${uid}/resend`),
  signOut: (uid) => api('POST', `/people/${uid}/sign-out`),
  /** A setting's new value: always waits for a second person (202). */
  setting: (id, value, why) => api('POST', '/actions/settings/change', { id, value, why }),
  settle: (id, how) => api('POST', `/proposals/${id}/${how}`),
  correct: (id, note) => api('POST', `/audit/${id}/correct`, { note }),
};
