// @ts-nocheck: reads the section data the API fills, which is untyped, as the sections are.
import { api } from '../live/api';
import { LIVE } from '../live/env';
import { ago, feedLate, feedOf, hasFeeds, loadFeeds } from '../live/feeds';
import { fig } from '../live/figures';
import { reloadSection } from '../live/sections';
import { ACCTS, AP_BAL, BONDS, COOP_W, DAY, FLOWS, M, PEOPLE_T, RTD_W, TODAY, UNSEC, Y, Y_DEP, vars } from './data';

/*
 * Money's datasets, live (money2.tsx reads these in place of the reference's when REAL): built from what
 * the API's money section sends (live/sections.ts fills ./data from it), the feeds' freshness, the Ops
 * Safe (GET /safe) and what waits for a second person in Money (GET /proposals?area=money). What the API
 * doesn't have is zero or empty, never the reference's figures; docs/ui-redesign-plan.md lists each gap:
 * the next 30 days of payments, credit for the month (opening, aging, losses, limits), autopay, and the
 * moves that ran on their own.
 */

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const SRC_NAME = { protocol: 'Protocol', plaid: 'Plaid', bridge: 'Bridge', lithic: 'Lithic', stripe: 'Stripe' };
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const initials = (n) =>
  (n || '?')
    .split(/[ @.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMon = (t) => `${new Date(t).getUTCDate()} ${MONS[new Date(t).getUTCMonth()]}`;
/** Days from today (UTC midnight) to a time: 0 today, -1 yesterday. */
const dayOf = (t) => Math.floor((new Date(t).getTime() - TODAY) / DAY);

/** A source as the page labels it: its name, how old its figures are, and 'late' when they're behind. */
function source(k) {
  const f = hasFeeds() ? feedOf(k) : null;
  const name = SRC_NAME[k] ?? f?.name ?? k;
  if (!f) return [name, 'not synced yet'];
  return [name, f.health === 'off' ? 'off' : f.behindMs != null ? ago(f.behindMs) : 'not synced yet', feedLate(k) ? 'late' : ''];
}

/** What a money proposal moves, from where to where, as the Moves tab lists it. */
function moveOf(p) {
  const a = p.payload ?? {},
    b = a.body ?? {};
  const [kind, from, to] = { top: ['topup', 'The Ops Safe', 'Payout pool'], vote: ['vote', 'Co-op balance', 'A member vote'] }[a.kind] ?? [a.kind ?? 'change', '', ''];
  return { id: p.id, kind, t: p.summary, from, to, amt: num(b.amount), by: p.proposedBy };
}

export function moneyLive() {
  const bond = ACCTS.find((a) => a[0] === 'bond');
  const MM = {
    savings: 0, cash: 0, payout: 0, assurance: 0, coop: 0, credit: 0, savingsBacked: 0, unsecured: 0, limits: 0, lost: 0, owed14: 0, dueMembers: 0, bonds: 0, floor: 0, rtd: 0, room: 0, short: 0,
    ...Object.fromEntries(Object.entries(M).map(([k, v]) => [k, num(v)])),
  };
  // BondVault's balance is the chain's (M.vault), else its account's
  MM.bv = M.vault != null ? num(M.vault) : num(bond?.[5]);
  MM.members = num(vars.memberSummary?.active);
  // how many members repay on autopay: the chain's (RevolvingIssuer), once the API reads the credit book
  MM.autopay = M.autopay != null ? num(M.autopay) : null;
  const cb = vars.credit;

  const curve = Y.curve && Y.curve.kink > 0 ? { ...Y.curve } : { base: 0, s1: 0, s2: 0, kink: 1 };
  const YY = {
    assets: 0, principal: 0, lent: 0, depositors: 0, pledged: 0, queued: 0, cash: 0, util: 0, earned: 0, borrowBps: 0, supplyBps: 0, apy: 0, apr: 0, toPayout: 0, utilAfter: 0, apyAfter: 0,
    ...Object.fromEntries(Object.entries(Y).filter(([k]) => !['curve', 'opened'].includes(k)).map(([k, v]) => [k, num(v)])),
    opened: Y.opened || '—',
    cycleDays: num(Y.cycleDays) || 30,
    curve,
  };
  YY.price = num(Y.price) || 1;

  // the accounts as the API sends them; BondVault's id is the reference's, and a series always has two points to draw
  const ACC = ACCTS.map(([id, n, why, g, src, bal, wk, col]) => {
    const s = (wk ?? []).map(num);
    if (!s.length) s.push(num(bal));
    if (s.length < 2) s.unshift(s[0]);
    // the weeks it really has, after the colour (a series of one is drawn flat from now)
    return [id === 'bond' ? 'bv' : id, n, why, g, src, num(bal), s, col, (wk ?? []).length];
  });
  // read as the page draws, so the feeds' health is current (it loads after the section does)
  const SRC = Object.defineProperties({}, Object.fromEntries([...new Set(['protocol', 'plaid', 'bridge', 'lithic', ...ACC.map((a) => a[4])])].map((k) => [k, { get: () => source(k), enumerable: true }])));

  // bonds: days to maturity from today goes in at 4, as the reference has it; the time it matures last
  const BD = BONDS.map((b) => {
    const at = b[7] != null ? num(b[7]) : null;
    return [b[0], num(b[1]), b[2], b[3], at == null ? Infinity : Math.round((at - TODAY) / DAY), num(b[4]), num(b[5]), b[6] ?? '', at];
  });
  const bvFig = fig('money.bondvault');

  const sp = vars.cardSpend;
  const PPL0 = {};
  const PPL = new Proxy(PPL0, {
    get: (t, k) => (typeof k !== 'string' || k in t ? t[k] : (t[k] = person(k))),
  });
  /** Someone on the team by their id, as the page names them; the signed-in person first. */
  function person(id) {
    const me = vars.me && vars.me.id === id ? vars.me : null;
    const p = PEOPLE_T.find((x) => x.uid === id);
    const n = me?.name || me?.email || p?.n || 'Someone';
    return { n, f: n === 'Someone' ? 'someone' : n.split(/[ @]/)[0], ini: initials(n), role: p ? 'Team' : '', sign: false, code: p?.id ?? '' };
  }
  const meId = vars.me?.id ?? 'viewer';
  if (!vars.me) PPL0.viewer = { n: 'Viewer', f: 'Viewer', ini: 'VW', role: 'Read-only', sign: false, code: '' };

  const L = {
    TODAY,
    me: () => vars.me?.id ?? 'viewer',
    M: MM,
    Y: YY,
    // a label for each week of the AssurancePool's history, the last one this week
    NW: AP_BAL.map((_, i) => dayMon(TODAY - (AP_BAL.length - 1 - i) * 7 * DAY)),
    AP_BAL: AP_BAL.map(num),
    UNSEC: UNSEC.map(num),
    RTD_W: RTD_W.map((v) => (v == null ? null : num(v))),
    COOP_W: COOP_W.map(num),
    // where the co-op's balance is held (the Ops Safe, else TermIssuer's fee recipient), and its USDC and CLRUSD; null until the chain is read
    COOP: vars.coop ?? null,
    // the next 30 days, from today
    FLOWS: FLOWS.filter((f) => f[0] >= 0 && f[0] <= 30)
      .map((f) => [num(f[0]), f[1], num(f[2]), f[3] ?? '', f[4] ?? ''])
      .sort((a, b) => a[0] - b[0]),
    BONDS: BD,
    ACCTS: ACC,
    ASIDE: [
      ['Sales tax held', num(vars.setAside?.salesTax), 'Shop · paid with the quarterly return'],
      ['Pre-order deposits', num(vars.setAside?.preorderDeposits), 'Hardware · refundable until made'],
    ],
    SRC,
    // credit for the month: the chain's book (spent, carry, repaid, how late, losses, limits), with where cards were used from Lithic
    CR: cb
      ? {
          start: num(cb.start),
          spent: num(cb.spent),
          carry: num(cb.carry),
          repaid: num(cb.repaid),
          aging: (cb.aging ?? []).map(([k, v]) => [k, num(v)]),
          losses: (cb.losses ?? []).map(([d, n, id, v]) => [num(d), n, id, num(v)]),
          limits: (cb.limits ?? []).map(([k, v]) => [k, num(v)]),
          shops: [...(cb.shops ?? []).map(([n, v, l]) => [n, num(v), l]), ...(sp?.merchants ?? []).map((m) => [`${m.name} · card`, num(m.amount), 0])].sort((a, b) => b[1] - a[1]),
          month: cb.month,
          members: num(cb.members),
          late: num(cb.late),
          owing: num(cb.owing),
          poolPaid: num(cb.poolPaid),
        }
      : {
      start: 0,
      spent: num(sp?.spent),
      aging: [],
      losses: [],
      limits: [],
      shops: (sp?.merchants ?? []).map((m) => [m.name, num(m.amount), 0]),
      month: sp?.month ? new Date(`${sp.month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }) : null,
    },
    /** Whether the credit book is the chain's: the API read it (it may be all zeros, which is real). */
    creditReal: !!cb,
    Y_DEP: Y_DEP.map(([id, w, since, pl]) => {
      const e = YY.assets ? (num(w) * YY.earned) / YY.assets : 0;
      return { id, w: num(w), since, pl: num(pl), e, d: num(w) - e };
    }),
    PPL,
    MOVES: [],
    DONE: [],
    // what BondVault keeps back for bondholders, and what the Safe may take: the contract's own reads
    bvNeed: num(bvFig?.required),
    bvRule: bvFig ? `Due within ${bvFig.windowDays} days, or ${bvFig.floorPct}% of all owed` : 'What BondVault keeps back isn’t read yet',
    reserve: fig('money.reserve') ?? null,
    // the AssurancePool's tiers as the chain has them: the RTD counts the primary reserve alone
    pool: fig('money.rtd') ?? null,
    // the Ops Safe: its owners and how many must sign, once GET /safe has answered
    safe: null,
    signers: [],
    /** Whether the 30-day schedule is read: the PayoutPool's claims and members' repayments, sent with the credit book (empty is real). */
    flowsReal: !!cb || FLOWS.length > 0,
    /** Loads what waits in Money and what was approved in 30 days, and the Ops Safe's signers. */
    async load() {
      if (!LIVE) return;
      const [, waiting, approved, safe] = await Promise.all([
        // the feeds load with every section, after it: the sources' ages are drawn again once they're in
        hasFeeds() ? null : loadFeeds().catch(() => undefined),
        api('GET', '/proposals?area=money').then((r) => r.proposals, () => []),
        api('GET', '/proposals?area=money&approved=30').then((r) => r.proposals, () => []),
        vars.safe ? Promise.resolve(vars.safe) : import('../live/safe').then((m) => m.loadSafe().then(() => vars.safe)).catch(() => null),
      ]);
      L.MOVES = waiting.map((p) => ({ ...moveOf(p), d: dayOf(p.createdAt), why: '', st: 'waiting' }));
      L.DONE = approved
        .slice()
        .reverse()
        .map((p) => ({ ...moveOf(p), d: dayOf(p.approvedAt), ok: p.approvedBy, tx: null }));
      if (safe?.configured) {
        L.safe = safe;
        L.signers = safe.owners.map((o) => {
          const k = o.you ? meId : (o.person?.id ?? o.address);
          const n = o.you ? PPL[meId].n : o.person?.name || short(o.address);
          PPL0[k] = { ...PPL[k], n, f: n.split(/[ @]/)[0], ini: o.person || o.you ? initials(n) : '0x', role: o.you ? 'Signer · you' : o.person ? 'Signer' : 'Not linked to anyone here', sign: true };
          return k;
        });
      }
    },
  };
  return L;
}

/** Approves or declines (your own: takes back) a move waiting in Money, then loads Money again. */
export async function settleMove(id, how) {
  const r = await api('POST', `/proposals/${id}/${how}`);
  await reloadSection('money');
  await import('../live/account').then((m) => m.loadWaiting()).catch(() => undefined);
  return r;
}
