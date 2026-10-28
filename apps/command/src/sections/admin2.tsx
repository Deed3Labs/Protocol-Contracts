// @ts-nocheck: ported from the redesign's ADMIN2 module (design/command-center-ui) with scripts/port/module.cjs; its data is its own.
import { Fragment } from 'react';
import { attrs, css, html } from '../runtime/dom';
import { loadTeam, loadWaiting } from '../live/account';
import { saveDownload } from '../live/api';
import { REAL } from '../live/env';
import { loadFeeds } from '../live/feeds';
import { adminApi, adminLive } from './adminLive';
import { CC } from './cc';
import { LOG as LOG_D, S } from './data';
import { pageModFor, registerPage, shadowHost } from './pageHost';
import { openRFlow } from './records';
import { toast, vLevel } from './shell';
import { openTFlow } from './team';

/*
 * Records, Team and Settings (design/command-center-ui, the ADMIN2 module): one module draws the three
 * Admin pages. Records is the archive and the log (Overview, Documents, Audit log, Reveals and exports),
 * Team is who (Overview, People, Groups, Two-person rule), Settings is what (Rules and limits, Security,
 * Connections, Organization). It lives in its own shadow root (pageHost.tsx) and draws the page its
 * route asks for; its inner module reads the root through a document stand-in (DOCP), as the reference
 * has it. Links out go through CC.go, so they land on the right page and pane.
 */

/** The page's skeleton: the reference template's markup. */
function skeleton() {
  return <div className="gw" id="aw"><div className="hdr stack" id="hdr" /><nav className="gtabs" id="atabs" aria-label="Views" /><div id="av" /></div>;
}
function makeAdmin() {
  // records, team and settings share their chain of sheets (pageHost's CHAIN)
  const { host, R: SR, W, into } = shadowHost('records', skeleton());
  // live, every dataset comes from the API (adminLive.ts); the reference's stay for the prototype
  const AL = REAL ? adminLive() : null;
  const LIVE = () => host.isConnected && ['records', 'team', 'settings'].includes(CC.route());
  let API = null;
  const RO = () => CC.viewing() && vLevel(API ? API.page() : CC.route()) < 3;
  const TOT = () => CC.viewing() && vLevel(API ? API.page() : CC.route()) === 1;
  const meKey = () => {
    if (AL) return AL.ME;
    const v = S.view;
    if (!v) return 'K';
    return {
      K: 'K',
      DR: 'DR',
      ML: 'ML',
      BS: 'BS',
      AC: 'AC',
      LP: 'LP'
    }[v.person] || {
      admin: 'K',
      protocol: 'DR',
      field: 'ML',
      board: 'BS',
      outside: 'AC',
      investors: 'LP'
    }[v.g] || 'VW';
  };
  const ROOT_EV = new Set(['click', 'input', 'change']);
  const DOCP = {
    getElementById: id => SR.getElementById(id),
    querySelector: q => SR.querySelector(q) || (q === '.modal' ? document.querySelector(q) : null),
    querySelectorAll: q => SR.querySelectorAll(q),
    createElement: t => document.createElement(t),
    get body() {
      return W;
    },
    get documentElement() {
      return document.documentElement;
    },
    addEventListener: (t, f, o) => (ROOT_EV.has(t) ? SR : document).addEventListener(t, f, o)
  };
  function goOut(path) {
    const i = path.indexOf('/'),
      r = i < 0 ? path : path.slice(0, i),
      sub = i < 0 ? undefined : path.slice(i + 1);
    if (sub && sub.includes(':')) {
      CC.go(r);
      return CC.go(r, sub);
    }
    return CC.go(r, sub);
  }
  const HOME = {
    team: 'overview',
    settings: 'rules',
    records: 'overview'
  };
  function setHash() {
    if (!LIVE()) return;
    const p = API.page(),
      t = API.tab(p);
    try {
      history.replaceState(null, '', '#' + p + (t === HOME[p] ? '' : '/' + t));
    } catch (e) {}
  }
  API = (document => {
    /* ══ Admin data — Team (who), Settings (what) and Records (the archive and the log) ════════════════════════════════
       Demo "today" is Wed 21 Oct 2026, 14:00. Permissions are set per group, never per person. Settings hold the numbers
       every page enforces; changing one needs a second person and lands in the audit log. */
    const DAY = 864e5,
      TODAY = AL ? AL.TODAY : Date.UTC(2026, 9, 21),
      NOW = AL ? AL.NOW : TODAY + 14 * 3600e3;
    const D = (m, d, y = 2026) => Date.UTC(y, m - 1, d);
    const H = (m, d, h, mi = 0) => Date.UTC(2026, m - 1, d, h, mi),
      H2 = H;
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmtD = t => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
    const WD = t => new Date(t).toLocaleDateString('en-US', {
      weekday: 'short',
      timeZone: 'UTC'
    });
    const hm = t => new Date(t).toISOString().slice(11, 16);
    const leaf = t => <span className="leaf"><span>{WD(t)}</span><b>{new Date(t).getUTCDate()}</b><span>{MON[new Date(t).getUTCMonth()]}</span></span>;
    const ago = t => {
      if (AL && !t) return 'Not yet';
      const m = Math.round((NOW - t) / 6e4);
      if (m < 60) return `${Math.max(1, m)} min ago`;
      const h = Math.round(m / 60);
      if (h < 24) return `${h} h ago`;
      const d = Math.round(h / 24);
      return d === 1 ? 'yesterday' : `${d} days ago`;
    };
    const money = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const int = n => Math.round(n).toLocaleString('en-US');
    function rng(seed) {
      let s = seed;
      return () => (s = s * 16807 % 2147483647, (s - 1) / 2147483646);
    }

    /* ── who: sections, levels, groups, people ─────────────────────────────────────────────────────────────────────── */
    const SECS = [['home', 'Home'], ['growth', 'Growth'], ['field', 'Field'], ['members', 'Members'], ['merchants', 'Merchants'], ['shop', 'Shop'], ['money', 'Money'], ['build', 'Build'], ['community', 'Community'], ['governance', 'Governance'], ['records', 'Records'], ['team', 'Team'], ['settings', 'Settings']];
    const SEC_GROUP = [['Grow', 0, 5], ['Hold', 6, 6], ['Rules', 7, 9], ['Admin', 10, 12]];
    const LV = [['None', 'Not in their menu'], ['Totals', 'Co-op numbers, no names or personal details'], ['See', 'Everything on the page, can’t change it'], ['Propose', 'Can start a change · someone else approves'], ['Approve', 'Can be the second person']];
    const GROUPS = AL ? AL.GROUPS : {
      /* name, who it's for, a level per section, everyone */
      members: ['Members', 'Everyone with a Clear account', [0, 1, 0, 0, 1, 1, 1, 2, 2, 2, 2, 0, 0], 1],
      admin: ['Admin', 'Runs the co-op day to day', [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]],
      protocol: ['Protocol', 'Contracts and the money they hold', [2, 2, 0, 4, 2, 1, 4, 4, 2, 2, 2, 4, 4]],
      field: ['Field', 'Shops, posters and the route', [2, 3, 4, 2, 3, 3, 1, 2, 2, 2, 2, 0, 0]],
      board: ['Board', 'Signs for the co-op board', [2, 1, 0, 0, 1, 1, 2, 4, 3, 4, 2, 0, 4]],
      outside: ['Outside', 'Read-only, for an accountant or counsel', [0, 1, 0, 0, 1, 2, 2, 2, 0, 2, 2, 0, 0]],
      investors: ['Investors', 'Data room for investors, lenders and property contributors', [0, 1, 0, 0, 1, 1, 2, 2, 0, 2, 2, 0, 0]]
    };
    const GKEYS = AL ? AL.GKEYS : Object.keys(GROUPS).filter(k => !GROUPS[k][3]);
    const PEOPLE = AL ? AL.PEOPLE : [{
      id: 'K',
      email: 'kai@useclear.org',
      n: 'Kai',
      g: 'admin',
      title: 'Founder',
      since: D(6, 12),
      last: H(10, 21, 13, 58),
      passkey: 1,
      signer: 1,
      dev: [['Mac · Redlands', H(10, 21, 13, 58), 1], ['iPhone · Redlands', H(10, 21, 7, 58), 1]]
    }, {
      id: 'DR',
      email: 'dana@useclear.org',
      n: 'Dana Ruiz',
      g: 'protocol',
      title: 'Protocol lead · ClearLabs',
      since: D(8, 5),
      last: H(10, 21, 13, 40),
      passkey: 1,
      signer: 1,
      dev: [['Laptop · Riverside', H(10, 21, 13, 40), 1]]
    }, {
      id: 'ML',
      email: 'marcus@useclear.org',
      n: 'Marcus Lee',
      g: 'field',
      title: 'Partnerships and field',
      since: D(8, 18),
      last: H(10, 21, 12, 47),
      passkey: 1,
      signer: 0,
      dev: [['iPhone · Redlands', H(10, 21, 12, 47), 1], ['Old iPhone', H(10, 12, 18, 0), 1]]
    }, {
      id: 'BS',
      email: 'board@useclear.org',
      n: 'Board signer',
      g: 'board',
      title: 'Co-op board',
      since: D(9, 1),
      last: H(10, 18, 20, 10),
      passkey: 1,
      signer: 1,
      dev: [['Laptop · Redlands', H(10, 18, 20, 10), 1]]
    }, {
      id: 'AC',
      email: 'books@ledgerline.co',
      n: 'Outside accountant',
      g: 'outside',
      title: 'Ledgerline · Money and Records',
      since: D(10, 2),
      last: H(10, 20, 16, 30),
      passkey: 0,
      signer: 0,
      dev: [['Laptop · Ontario', H(10, 20, 16, 30), 1]]
    }, {
      id: 'LP',
      email: 'lena@harborcap.com',
      n: 'Lena Park',
      g: 'investors',
      title: 'Harbor Capital · data room',
      since: D(10, 14),
      last: H(10, 20, 11, 5),
      passkey: 0,
      signer: 0,
      until: D(11, 21),
      dev: [['Laptop · Irvine', H(10, 20, 11, 5), 1]]
    }];
    const INVITES = AL ? AL.INVITES : [{
      id: 'PS',
      n: 'Priya Shah',
      email: 'priya@useclear.org',
      g: 'field',
      title: 'Riverside route',
      sent: D(10, 19),
      exp: D(10, 26),
      by: 'K',
      ok: 'DR'
    }];
    const PPL = AL ? AL.PPL : Object.fromEntries(PEOPLE.map(p => [p.id, p]));
    const pName = id => id === 'SY' ? 'System' : AL && AL.NAMES[id] ? AL.NAMES[id] : (PPL[id] || INVITES.find(i => i.id === id) || {
      n: id
    }).n;
    /** Who something waits on: you, a first name, or (live, when it isn't you) a second person. */
    const onWho = (id, full) => id === A.me ? 'you' : AL && !PPL[id] && !AL.NAMES[id] ? 'a second person' : full ? pName(id) : pName(id).split(' ')[0];
    const NUMW = n => NUM[n] ?? String(n);
    const MEMBERS_N = AL ? AL.MEMBERS_N : 188;

    /* ── what: the rules every page enforces. Team shows who can approve each; Settings holds the numbers ─────────────── */
    const RULES = AL ? AL.RULES : [/* id, rule, what it covers, approvers (groups at Approve), last 30 days, median hours to a second person, setting it reads */
    {
      id: 'money',
      t: 'Money moves',
      c: 'Top-ups, payout runs, bond issues, sales tax',
      who: ['K', 'DR'],
      n30: 6,
      med: 4.2,
      set: 'money'
    }, {
      id: 'shopbuy',
      t: 'Shop buys and reorders',
      c: 'Blanks, prints and packing from suppliers',
      who: ['K', 'DR'],
      n30: 2,
      med: 1.1,
      set: 'shopbuy'
    }, {
      id: 'refund',
      t: 'Shop refunds',
      c: 'Back the way the member paid',
      who: ['K', 'DR'],
      n30: 0,
      med: 0,
      set: 'refund'
    }, {
      id: 'chain',
      t: 'On-chain changes',
      c: 'Upgrades, caps and shop terms, in the Ops Safe',
      who: ['K', 'DR', 'BS'],
      n30: 9,
      med: 7.8,
      set: 'safe'
    }, {
      id: 'invites',
      t: 'Invite batches',
      c: 'Each batch, oldest on the waitlist first',
      who: ['K', 'DR'],
      n30: 3,
      med: 2.1,
      set: 'batch'
    }, {
      id: 'exports',
      t: 'Member data exports',
      c: 'Any list with names, emails or phone numbers',
      who: ['K', 'DR'],
      n30: 2,
      med: 0.5,
      set: 'exports'
    }, {
      id: 'access',
      t: 'Access changes',
      c: 'Inviting, turning off, or changing a group',
      who: ['K', 'DR'],
      n30: 1,
      med: 3.0,
      set: 'access'
    }, {
      id: 'settings',
      t: 'Settings changes',
      c: 'Any number on the Settings page',
      who: ['K', 'DR', 'BS'],
      n30: 1,
      med: 6.5,
      set: 'settings'
    }];
    const CAN = AL ? AL.CAN : [/* things a person does, not approves: who can */
    ['Start a money move', ['K', 'DR']], ['Sign in the Ops Safe', ['K', 'DR', 'BS']], ['Deploy a contract', ['DR']], ['Reveal personal details', ['K', 'DR']], ['Sign agreements for the co-op', ['K']], ['File for an entity', ['K']], ['Invite or turn off a person', ['K']], ['Confirm a new device', ['K', 'DR']]];
    const APPR = AL ? AL.APPR : {
      /* proposer → approver, last 30 days */K: {
        DR: 6,
        BS: 1
      },
      DR: {
        K: 5,
        BS: 1
      },
      ML: {
        K: 3,
        DR: 4
      }
    };
    const WAITING = AL ? AL.WAITING : [/* what, from, proposed by, waiting on, hours, usual hours, rule */
    ['PayoutPool top-up · $1,116.89', 'Money', 'K', 'DR', 20, 4.2, 'money'], ['AssurancePool v1.3', 'Build', 'DR', 'K', 30, 7.8, 'chain'], ['Refund · order #1079 · $98.00', 'Shop', 'K', 'DR', 3, 1.6, 'refund'], ['Shop buys over $500.00', 'Settings', 'K', 'DR', 5, 6.5, 'settings']];

    /* ── settings ───────────────────────────────────────────────────────────────────────────────────────────────────── */
    /* kind: money | num | pct | hours | days | choice | on | lock. lock: set somewhere else (a vote, the bylaws, the law) */
    const SETS = AL ? AL.SETS : [{
      id: 'money',
      sec: 'money',
      t: 'Second person on money moves',
      d: 'Every move out of a co-op account, any amount',
      kind: 'lock',
      v: 'Always',
      why: 'Set by the two-person rule policy v1.2',
      where: 'records/docs:d15',
      used: ['money']
    }, {
      id: 'shopbuy',
      sec: 'money',
      t: 'Shop buys need a second person over',
      d: 'Supplier orders and recorded buys',
      kind: 'money',
      v: 250,
      used: ['shop', 'money'],
      pend: 'C-07'
    }, {
      id: 'refund',
      sec: 'money',
      t: 'Shop refunds need a second person over',
      d: 'Smaller refunds go back right away',
      kind: 'money',
      v: 50,
      used: ['shop']
    }, {
      id: 'spend',
      sec: 'money',
      t: 'Spending the co-op balance',
      d: 'Member discounts collected at partner shops',
      kind: 'lock',
      v: 'Member vote',
      why: 'Set by the co-op agreement',
      where: 'governance/proposals',
      used: ['money', 'governance']
    }, {
      id: 'safe',
      sec: 'chain',
      t: 'Ops Safe signatures',
      d: 'Upgrades, caps and shop terms',
      kind: 'lock',
      v: '2 of 3',
      why: 'Changed by a board vote, then in the Ops Safe',
      where: 'governance/proposals',
      used: ['build']
    }, {
      id: 'wait',
      sec: 'chain',
      t: 'Wait before a change goes live',
      d: 'After the last signature',
      kind: 'hours',
      v: 24,
      used: ['build']
    }, {
      id: 'cap',
      sec: 'chain',
      t: 'Starting cap for a new shop',
      d: 'What a partner can extend before a raise',
      kind: 'money',
      v: 100,
      used: ['merchants', 'build']
    }, {
      id: 'batch',
      sec: 'members',
      t: 'Invite batch size',
      d: 'Oldest on the waitlist first',
      kind: 'num',
      v: 25,
      unit: 'people',
      used: ['members']
    }, {
      id: 'exports',
      sec: 'members',
      t: 'Data exports need a second person',
      d: 'Any list with names, emails or phone numbers',
      kind: 'lock',
      v: 'Always',
      why: 'Set by the privacy policy',
      where: 'records/docs:d15',
      used: ['members', 'records']
    }, {
      id: 'margin',
      sec: 'shop',
      t: 'Target margin',
      d: 'Products under it are flagged',
      kind: 'pct',
      v: 60,
      used: ['shop']
    }, {
      id: 'buffer',
      sec: 'shop',
      t: 'Reorder buffer',
      d: 'On top of the supplier’s lead time',
      kind: 'num',
      v: 1,
      unit: 'week',
      used: ['shop']
    }, {
      id: 'hold',
      sec: 'shop',
      t: 'Pickup hold',
      d: 'Then we message the member',
      kind: 'days',
      v: 14,
      used: ['shop']
    }, {
      id: 'ship',
      sec: 'shop',
      t: 'Flat shipping charged',
      d: 'The label costs $7.40 on average',
      kind: 'money',
      v: 6,
      used: ['shop']
    }, {
      id: 'cosign',
      sec: 'gov',
      t: 'Co-signers to take a board decision to a vote',
      d: 'Any member can start one',
      kind: 'lock',
      v: '10 members',
      why: 'Set by the bylaws',
      where: 'governance/proposals',
      used: ['governance', 'community']
    }, {
      id: 'quiet',
      sec: 'gov',
      t: 'Discussion before a vote opens',
      d: 'Proposals stay open for comment',
      kind: 'days',
      v: 7,
      used: ['governance', 'community']
    }, /* security */
    {
      id: 'passkey',
      sec: 'signin',
      t: 'Passkey for anyone who can propose or approve',
      d: 'Read-only people can use an emailed code',
      kind: 'on',
      v: 1,
      used: ['team']
    }, {
      id: 'session',
      sec: 'signin',
      t: 'Stay signed in for',
      d: 'On a trusted device',
      kind: 'hours',
      v: 12,
      used: ['team']
    }, {
      id: 'again',
      sec: 'signin',
      t: 'Ask again before money moves and signing',
      d: 'Passkey every time',
      kind: 'on',
      v: 1,
      used: ['money', 'build']
    }, {
      id: 'rotate',
      sec: 'signin',
      t: 'Rotate connection keys every',
      d: 'A reminder, then a second person swaps it',
      kind: 'days',
      v: 90,
      used: ['settings']
    }, {
      id: 'newdev',
      sec: 'signin',
      t: 'New devices need a confirmation',
      d: 'From someone who can confirm devices',
      kind: 'on',
      v: 1,
      used: ['team']
    }, {
      id: 'mask',
      sec: 'privacy',
      t: 'Personal details masked everywhere',
      d: 'Names, emails, phones and addresses',
      kind: 'lock',
      v: 'Always',
      why: 'The server enforces it on every request',
      where: 'records/reveals',
      used: ['members', 'merchants', 'records']
    }, {
      id: 'reason',
      sec: 'privacy',
      t: 'Ask for a reason on every reveal',
      d: 'Skipping it is allowed in a rush, then flagged',
      kind: 'on',
      v: 1,
      used: ['members', 'records']
    }, {
      id: 'revealers',
      sec: 'privacy',
      t: 'Who can reveal',
      d: 'Groups at Approve on Members',
      kind: 'lock',
      v: 'Admin, Protocol',
      why: 'Follows the Members column in Team',
      where: 'team/groups',
      used: ['members']
    }, {
      id: 'retain',
      sec: 'records',
      t: 'Keep records for',
      d: 'Documents, the audit log and reveals',
      kind: 'lock',
      v: '7 years',
      why: 'Required for the co-op and the money program',
      where: 'records/docs',
      used: ['records']
    }, {
      id: 'digest',
      sec: 'notify',
      t: 'Daily digest',
      d: 'What’s waiting, alerts and the day’s numbers',
      kind: 'choice',
      v: '07:00',
      opts: ['06:00', '07:00', '08:00', 'Off'],
      used: ['home']
    }];
    const SETO = AL ? AL.SETO : Object.fromEntries(SETS.map(s => [s.id, s]));
    const SEC_T = {
      money: ['Money', 'Second person and spending'],
      chain: ['On-chain', 'The Ops Safe and the wait'],
      members: ['Members', 'Invites and lists'],
      shop: ['Shop', 'Costing, stock and pickups'],
      gov: ['Governance', 'Votes and discussion'],
      signin: ['Sign-in', 'Passkeys, sessions and devices'],
      privacy: ['Personal details', 'Masking and reveals'],
      records: ['Records', 'How long things are kept'],
      notify: ['Notifications', 'Who hears about what']
    };
    const PEND = AL ? AL.PEND : [/* setting changes waiting on a second person */
    {
      id: 'C-07',
      set: 'shopbuy',
      label: 'Raising the shop buy limit to $500.00',
      from: 250,
      to: 500,
      by: 'K',
      at: H(10, 21, 9, 10),
      why: 'Blank orders for the holiday run are mostly $300 to $900, so every one waits.',
      need: 'DR'
    }];
    const SET_HIST = AL ? AL.SET_HIST : [/* id, when, setting, from, to, by, approved by */
    ['C-06', H(10, 9, 15, 0), 'cap', '$75.00', '$100.00', 'DR', 'K'], ['C-05', H(10, 2, 10, 30), 'margin', '55%', '60%', 'K', 'DR'], ['C-04', H(9, 28, 9, 0), 'hold', '10 days', '14 days', 'K', 'DR'], ['C-03', H(9, 14, 11, 0), 'session', '24 hours', '12 hours', 'DR', 'K'], ['C-02', H(9, 1, 12, 0), 'batch', '20 people', '25 people', 'K', 'DR']];
    const ALERTS = AL ? [] : [/* alert, when, who hears it */['Something is waiting on you', 'As soon as it’s yours to approve', []], ['A connection falls behind', 'Over an hour behind', ['K', 'DR']], ['A device goes offline', 'A Clear Point stops reporting', ['ML', 'K']], ['A reveal without a reason', 'Within the hour', ['K']], ['A sign-in from a new device', 'Until someone confirms it', ['K', 'DR']]];

    /* connections: status ok | behind | off; hourly health for the last 24 hours (1 ok, 0.5 slow, 0 down) */
    const CONN = AL ? AL.CONN : [{
      id: 'plaid',
      n: 'Plaid',
      what: 'Bank data · 12 bank links',
      st: 'behind',
      note: '3 hours behind · 7 of 12 links refreshed',
      last: H(10, 21, 11, 0),
      by: 'K',
      key: '4f2a',
      used: ['money', 'members'],
      rot: 41,
      hrs: [...Array(21).fill(1), 0.5, 0.5, 0.5]
    }, {
      id: 'lithic',
      n: 'Lithic',
      what: 'Card program',
      st: 'ok',
      note: 'Events every few seconds',
      last: H(10, 21, 13, 58),
      by: 'K',
      key: '91c0',
      used: ['money', 'merchants'],
      rot: 12,
      hrs: Array(24).fill(1)
    }, {
      id: 'bridge',
      n: 'Bridge',
      what: 'Stablecoin services',
      st: 'ok',
      note: 'Last transfer 13:12',
      last: H(10, 21, 13, 12),
      by: 'K',
      key: 'e7d3',
      used: ['money'],
      rot: 63,
      hrs: Array(24).fill(1)
    }, {
      id: 'base',
      n: 'Base Sepolia',
      what: 'Testnet · contracts and pools',
      st: 'ok',
      note: '1 second behind the chain',
      last: H(10, 21, 13, 59),
      by: 'DR',
      key: '@rpc',
      used: ['build', 'money'],
      hrs: [...Array(9).fill(1), 0.5, ...Array(14).fill(1)]
    }, {
      id: 'safe',
      n: 'Ops Safe',
      what: '2 of 3 signers',
      st: 'ok',
      note: '2 changes waiting to be signed',
      last: H(10, 21, 10, 0),
      by: 'DR',
      key: '@safe',
      used: ['build', 'money'],
      hrs: Array(24).fill(1)
    }, {
      id: 'esign',
      n: 'E-signature',
      what: 'Agreements and minutes',
      st: 'ok',
      note: '1 envelope out · Inland Cycle Works',
      last: H(10, 20, 9, 0),
      by: 'K',
      key: '2b88',
      used: ['governance', 'records'],
      rot: 84,
      hrs: Array(24).fill(1)
    }, {
      id: 'opencast',
      n: 'Opencast',
      what: 'Live streams for Community',
      st: 'ok',
      note: 'Next stream Thu 22 Oct, 18:00',
      last: H(10, 19, 20, 0),
      by: 'K',
      key: 'c4d1',
      used: ['community'],
      rot: 20,
      hrs: Array(24).fill(1)
    }, {
      id: 'store',
      n: 'Shop software',
      what: 'useclear.org/shop',
      st: 'ok',
      note: '5 orders today',
      last: H(10, 21, 12, 40),
      by: 'K',
      key: '77ab',
      used: ['shop'],
      rot: 30,
      hrs: Array(24).fill(1)
    }, {
      id: 'email',
      n: 'Email',
      what: 'Invites, receipts and the digest',
      st: 'ok',
      note: '99.6% delivered this week',
      last: H(10, 21, 13, 30),
      by: 'K',
      key: '05fe',
      used: ['members', 'home'],
      rot: 97,
      hrs: Array(24).fill(1)
    }, {
      id: 'printer',
      n: 'Label printer',
      what: 'Thermal, at the studio',
      st: 'off',
      note: 'Asleep since 18:00 yesterday · wakes when a label prints',
      last: H(10, 20, 18, 0),
      by: 'K',
      key: '',
      used: ['shop'],
      hrs: [...Array(4).fill(1), ...Array(20).fill(0)],
      idle: 1
    }];

    /* organization */
    const ENT = AL ? AL.ENT : [/* id, name, kind, status, tax id last 4, state filed */
    ['coop', 'Clear Co-op', 'Wyoming LLC · co-op', 'formed', '4417'], ['fin', 'Clear Financial Co.', 'Wyoming LLC', 'formed', '8820'], ['dt', 'The Deed & Title Co.', 'Wyoming LLC', 'forming', ''], ['hold', 'Clear Capital Holdings', 'Wyoming C-corp', 'formed', '3051'], ['labs', 'ClearLabs Inc.', 'Wyoming C-corp', 'formed', '6602'], ['mgr', 'Manager LLC', 'Wyoming LLC', 'forming', ''], ['fdn', 'Clear Foundation', 'Wyoming foundation', 'forming', '']];
    const ENTO = AL ? AL.ENTO : Object.fromEntries(ENT.map(e => [e[0], e]));
    const PROFILE = [['Name', 'Clear Co-op'], ['Website', 'useclear.org'], ['Help email', 'help@useclear.org'], ['Time zone', 'Pacific · Los Angeles'], ['Fiscal year', 'January to December'], ['Currency', 'US dollars']];

    /* ── records: documents ─────────────────────────────────────────────────────────────────────────────────────────── */
    const DT = {
      agreement: ['Agreements', 'var(--fg)'],
      minutes: ['Minutes', 'var(--land)'],
      filing: ['Filings', 'color-mix(in srgb,var(--fg) 50%,transparent)'],
      policy: ['Policies', 'var(--underway)'],
      bond: ['Bonds', 'var(--live)'],
      report: ['Payout reports', 'color-mix(in srgb,var(--fg) 25%,transparent)']
    };
    const DSTAT = {
      signed: ['Signed', 'var(--fg)'],
      filed: ['Filed', 'var(--settled)'],
      draft: ['Draft', 'var(--underway)'],
      waiting: ['Waiting on a signature', 'var(--live)'],
      final: ['Final', 'var(--fg)']
    };
    const DOCS = AL ? AL.DOCS : [/* id, title, type, entity, date, status, version, by, pages, governance link */
    ['d1', 'Merchant partner agreement · Inland Cycle Works', 'agreement', 'coop', D(10, 20), 'waiting', 'v1.1', 'Inland Cycle Works', 6, 'icw'], ['d2', 'Minutes · Co-op board, 7 Oct', 'minutes', 'coop', D(10, 8), 'draft', 'v0.2', 'Kai', 4], ['d19', 'Shop returns and refunds · policy', 'policy', 'coop', D(9, 28), 'final', 'v1.0', 'Kai', 2], ['d3', 'RevolvingIssuer v1.3 · audit notes', 'policy', 'labs', D(10, 19), 'final', 'v1.0', 'Dana Ruiz', 9], ['d4', 'Merchant partner agreement · Uptown Barber', 'agreement', 'coop', D(10, 20), 'signed', 'v1.1', 'Uptown Barber · Kai', 6], ['d5', 'Bond certificate · BB-0006', 'bond', 'hold', D(10, 15), 'signed', 'v1.0', 'Kai · Dana Ruiz', 2], ['d6', 'Payout report · September', 'report', 'fin', D(10, 2), 'final', 'v1.0', 'System', 3], ['d7', 'Minutes · ClearLabs board, 7 Oct', 'minutes', 'labs', D(10, 8), 'signed', 'v1.0', 'Kai', 3], ['d8', 'Annual report · ClearLabs Inc.', 'filing', 'labs', D(10, 16), 'draft', 'v1.0', 'Kai', 2], ['d9', 'Intercompany pricing policy', 'policy', 'hold', D(10, 12), 'draft', 'v0.3', 'Kai', 5], ['d10', 'Program services agreement', 'agreement', 'fin', D(1, 1), 'signed', 'v1.0', 'Kai', 14, 'psa'], ['d11', 'Minutes · Holdings board, 16 Sep', 'minutes', 'hold', D(9, 17), 'signed', 'v1.0', 'Kai', 5], ['d12', 'Holdings bylaws', 'policy', 'hold', D(9, 16), 'final', 'v1.0', 'Holdings board', 22], ['d13', 'Cooperative operating agreement', 'agreement', 'coop', D(6, 12), 'signed', 'v1.0', 'Founding members', 31, 'coop-oa'], ['d14', 'Articles of organization · Manager LLC', 'filing', 'mgr', D(10, 9), 'filed', 'v1.0', 'Accountant', 3], ['d15', 'Two-person rule', 'policy', 'coop', D(8, 1), 'final', 'v1.2', 'Co-op board', 4]];
    const DCOUNT = AL ? AL.DCOUNT : {
      agreement: 41,
      minutes: 12,
      filing: 7,
      policy: 9,
      bond: 6,
      report: 14
    };
    const COVER_K = ['Formation papers', 'Operating rules', 'EIN letter', 'Board minutes', 'Annual report', 'Bank resolution'];
    const COVER = AL ? AL.COVER : {
      /* f on file · d draft · m missing · n not needed yet */
      coop: ['f', 'f', 'f', 'd', 'n', 'f'],
      fin: ['f', 'f', 'f', 'n', 'f', 'f'],
      dt: ['d', 'f', 'm', 'n', 'n', 'm'],
      hold: ['f', 'f', 'f', 'f', 'n', 'f'],
      labs: ['f', 'f', 'f', 'f', 'd', 'f'],
      mgr: ['f', 'd', 'm', 'n', 'n', 'm'],
      fdn: ['d', 'n', 'n', 'n', 'n', 'n']
    };
    const CV = {
      f: ['On file', 'var(--fg)'],
      d: ['Draft', 'var(--underway)'],
      m: ['Missing', 'var(--absent)'],
      n: ['Not needed yet', '']
    };

    /* ── records: the audit log ─────────────────────────────────────────────────────────────────────────────────────── */
    const AREAS = {
      chain: ['On-chain', 'var(--fg)'],
      money: ['Money', 'var(--underway)'],
      members: ['Members', 'var(--land)'],
      field: ['Shops and field', 'color-mix(in srgb,var(--fg) 50%,transparent)'],
      shop: ['Shop', 'var(--settled)'],
      gov: ['Governance', 'color-mix(in srgb,var(--fg) 25%,transparent)'],
      team: ['Team and settings', 'var(--live)'],
      system: ['System', 'var(--line)'],
      alert: ['Alert', 'var(--absent)']
    };
    // live, Records' own entries (adding a document, accepting the data room's terms) have their own colour
    if (AL) AREAS.records = ['Records', 'color-mix(in srgb,var(--fg) 70%,transparent)'];
    const LOG = AL ? AL.LOG : LOG_D;
    const WHO = AL ? AL.WHO : [['K', 'Kai'], ['DR', 'Dana Ruiz'], ['ML', 'Marcus Lee'], ['SY', 'System']];
    const LOG0 = [/* id, time, who, area, action, detail, from, result, approver */
    ['n0', H2(10, 21, 13, 40), 'DR', 'money', 'Proposed paying the Q3 sales tax', '$351.58 from operating cash to CDTFA, due 31 Oct.', 'Laptop · Riverside', 'waiting', 'Needs a second person'], ['a2', H2(10, 21, 13, 10), 'K', 'money', 'Drafted the PayoutPool top-up', '$1,116.89 from operating cash, due 30 Oct.', 'Mac · Redlands', 'waiting', 'Needs a second person'], ['s1', H2(10, 21, 11, 20), 'K', 'shop', 'Proposed a refund on order #1079', '$98.00 · Hoodie, wrong size. Needs a second person.', 'Mac · Redlands', 'waiting', 'Needs a second person'], ['a3', H2(10, 21, 10, 0), 'SY', 'chain', 'RevolvingIssuer v1.3 went live', 'After the 24-hour wait. Signed by Dana Ruiz and Kai.', 'Ops Safe', 'done', ''], ['c7', H2(10, 21, 9, 10), 'K', 'team', 'Proposed raising shop buys to $500.00', 'Setting C-07 · from $250.00. Blank orders for the holiday run are mostly $300 to $900.', 'Mac · Redlands', 'waiting', 'Needs a second person'], ['a4', H2(10, 21, 9, 12), 'ML', 'field', 'Replaced poster P-012 at Uptown Barber', 'Photo attached. Next swap 20 Dec.', 'iPhone · Redlands', 'done', ''], ['a5', H2(10, 21, 8, 40), 'SY', 'alert', 'Orange St. Point went offline', 'Counter device stopped reporting.', 'Device', 'alert', ''], ['a6', H2(10, 20, 22, 41), 'SY', 'system', 'Plaid re-sync started', '7 of 12 bank links refreshed so far.', 'Plaid', 'running', ''], ['a7', H2(10, 20, 18, 0), 'DR', 'chain', 'Signed “Raise Rosa’s cap to $150.00”', 'First of two signatures. Waiting on you.', 'Laptop · Riverside', 'signed', 'Marcus Lee proposed'], ['a8', H2(10, 20, 16, 0), 'ML', 'field', 'Drafted “Add Inland Cycle Works”', 'Waits on the merchant agreement.', 'iPhone · Redlands', 'waiting', ''], ['s2', H2(10, 20, 11, 0), 'K', 'shop', 'Put Graphic Tee · Two Ten Overpass on the shelf', 'Photos, price and stock checked.', 'Mac · Redlands', 'done', ''], ['a9', H2(10, 20, 10, 0), 'K', 'chain', 'Signed RevolvingIssuer v1.3', 'Second of two signatures.', 'Mac · Redlands', 'approved', 'Dana Ruiz proposed'], ['a10', H2(10, 20, 9, 0), 'DR', 'chain', 'Signed AssurancePool v1.3', 'First of two. Waiting on you.', 'Laptop · Riverside', 'signed', ''], ['t2', H2(10, 19, 10, 5), 'DR', 'team', 'Approved inviting Priya Shah to Field', 'Kai proposed. The invite expires 26 Oct.', 'Laptop · Riverside', 'approved', 'Kai proposed'], ['a11', H2(10, 19, 12, 0), 'DR', 'field', 'Approved “Add Uptown Barber”', 'Second signature on Marcus Lee’s change.', 'Laptop · Riverside', 'approved', 'Marcus Lee proposed'], ['a12', H2(10, 19, 9, 30), 'ML', 'system', 'Signed in from a new device', 'iPhone. Confirmed by Kai at 09:41.', 'iPhone · Redlands', 'confirmed', ''], ['a13', H2(10, 18, 15, 0), 'K', 'gov', 'Sent the Inland Cycle Works agreement', 'Out for signature in the e-signature tool.', 'Mac · Redlands', 'done', ''], ['a14', H2(10, 18, 11, 0), 'DR', 'members', 'Approved invite batch 12', '25 people, oldest first. Kai proposed.', 'Laptop · Riverside', 'approved', 'Kai proposed'], ['a15', H2(10, 15, 9, 0), 'K', 'gov', 'Opened the member vote on v2.2', '188 members can vote until 29 Oct.', 'Mac · Redlands', 'done', ''], ['a16', H2(10, 14, 18, 0), 'DR', 'money', 'Approved issuing BB-0006', '$5,000.00 face value. Kai proposed.', 'Laptop · Riverside', 'approved', 'Kai proposed']];
    if (!AL) LOG0.forEach(x => {
      if (!LOG.some(y => y[0] === x[0])) LOG.push(x);
    });
    const RESULT = {
      approved: ['Approved', 'var(--settled)'],
      waiting: ['Waiting', 'var(--underway)'],
      done: ['Done', 'var(--fg)'],
      alert: ['Alert', 'var(--absent)'],
      running: ['Running', 'var(--live)'],
      signed: ['Signed', 'var(--fg)'],
      confirmed: ['Confirmed', 'var(--fg)']
    };
    // the API's results the reference doesn't have
    if (AL) Object.assign(RESULT, {
      declined: ['Declined', 'var(--line)'],
      refused: ['Refused', 'var(--absent)']
    });
    /* everyday actions, so the week reads true to life */
    const WEEK = AL ? AL.WEEK : (() => {
      const r = rng(2026),
        out = [],
        prof = {
          K: [['chain', 2], ['money', 2], ['members', 2], ['gov', 2], ['field', 1], ['shop', 1]],
          DR: [['chain', 4], ['money', 3], ['members', 1]],
          ML: [['field', 6], ['members', 1]],
          SY: [['system', 3], ['money', 1], ['chain', 1], ['shop', 2]]
        };
      for (let d = 0; d < 7; d++) WHO.forEach(([w]) => {
        const dw = new Date(H2(10, 15 + d, 0)).getUTCDay(),
          we = dw === 0 || dw === 6;
        const n = w === 'SY' ? we ? 3 : 5 : w === 'ML' ? we ? 3 : 7 : we ? 1 : 5;
        for (let i = 0; i < n; i++) {
          const pool = prof[w].flatMap(([a, k]) => Array(k).fill(a));
          out.push([H2(10, 15 + d, 8 + Math.floor(r() * 12), Math.floor(r() * 60)), w, pool[Math.floor(r() * pool.length)]]);
        }
      });
      return out;
    })();

    /* reveals and exports: personal details are masked; every reveal and every list that leaves is here */
    const REVEALS = AL ? AL.REVEALS : [/* time, who, member, what, reason, where */
    [H(10, 21, 12, 5), 'K', 'M-0412', 'Email', 'Their card was declined twice; writing back about the hold', 'Members'], [H(10, 21, 10, 40), 'DR', 'M-0388', 'Phone', 'Confirming a payout to a new bank link', 'Members'], [H(10, 20, 15, 20), 'K', 'M-0157', 'Email and phone', 'Hardship pause request, from the help inbox', 'Members'], [H(10, 20, 9, 55), 'K', 'Rosa’s Panadería', 'Owner phone', 'Cap raise call, before signing', 'Merchants'], [H(10, 19, 17, 30), 'DR', 'M-0921', 'Address', 'Returned card, checking where it was sent', 'Members'], [H(10, 19, 11, 10), 'K', 'M-0044', 'Email', '', 'Members'], [H(10, 17, 14, 0), 'K', 'Inland Cycle Works', 'Owner email', 'Sending the agreement for signature', 'Merchants']];
    const EXPORTS = AL ? AL.EXPORTS : [/* time, who, what, rows, approved by, state */
    [H(10, 21, 8, 15), 'K', 'Members who can vote on v2.2 · ids only', 188, '', 'done', 'Ids only · not needed'], [H(10, 19, 16, 0), 'K', 'Waitlist · Redlands, for poster batch 14', 312, 'DR', 'approved', ''], [H(10, 16, 10, 0), 'AC', 'Payout report · September', 3, '', 'done', 'Totals only'], [H(10, 12, 9, 30), 'DR', 'Bondholders · BB-0001 to BB-0006', 6, 'K', 'approved', ''], [H(10, 21, 13, 50), 'ML', 'Shop owners on the Riverside route · phone numbers', 14, '', 'waiting', 'Needs a second person']];

    /* ══ Team, Settings and Records ═════════════════════════════════════════════════════════════════════════════════════
       Team is who: people, the groups they're in, what each group can do, and who can be the second person.
       Settings is what: the numbers every page enforces, sign-in and privacy, connections, the organization.
       Records is the archive and the log: every filed document, every action, every reveal and every export. */
    const A = {
      page: 'team',
      tab: {
        team: 'overview',
        settings: 'rules',
        records: 'overview'
      },
      panel: null,
      me: 'K',
      lw: 'all',
      lr: 'all',
      lp: 0,
      df: 'all',
      gd: null
    };
    const TABS = {
      team: [['overview', 'Overview'], ['people', 'People'], ['groups', 'Groups'], ['rule', 'Two-person rule']],
      settings: [['rules', 'Rules and limits'], ['security', 'Security'], ['connections', 'Connections'], ['org', 'Organization']],
      records: [['overview', 'Overview'], ['docs', 'Documents'], ['log', 'Audit log'], ['reveals', 'Reveals and exports']]
    };
    const ICO = {
      chev: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>,
      back: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>,
      x: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>,
      lock: <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7.5" width="9" height="6" /><path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2" /></svg>
    };
    const cell = (cls, title, right, body, foot) => <div className={`cell ${cls}`}><div className="hd"><h2>{title}</h2><div className="r">{right}</div></div>{body}<div className="bk-ft">{foot}</div></div>;
    const lbl = t => <span className="lbl">{t}</span>;
    const band = (cells, first) => <section className="band" {...attrs(first ? ' style="margin-top:0"' : '')}><div className="bento">{cells}</div></section>;
    const seg = (key, opts, v, aria) => <div className="seg sm" role="group" aria-label={aria}>{opts.map(([k, t]) => <button key={k} {...{ [`data-${key}`]: k }} aria-pressed={v === k}>{t}</button>)}</div>;
    const secRow = (t, r = '') => <div className="ad-sec"><span>{t}</span>{r ? <em>{r}</em> : ''}</div>;
    const rest = () => <div className="ad-rest" aria-hidden="true" />;
    const pager = (p, n, per, key) => {
      const pages = Math.max(1, Math.ceil(n / per));
      return <span className="pg2"><span>{n ? p * per + 1 : 0}–{Math.min(n, (p + 1) * per)} of {n}</span><button {...{ [`data-${key}`]: '-1' }} disabled={p === 0} aria-label="Previous">{ICO.back}</button><button {...{ [`data-${key}`]: '1' }} disabled={p >= pages - 1} aria-label="Next">{ICO.chev}</button></span>;
    };
    const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
    const segs = (arr, col, n) => arr.map((x, i) => <i key={i} style={css(`left:${i / Math.max(n || 0, arr.length) * 100}%;width:calc(${100 / Math.max(n || 0, arr.length)}% - 2px);background:${col(x)}`)} />);
    const sq = (id, cls = '') => <i className={`ad-av ${id === A.me ? 'me' : ''} ${id === 'SY' ? 'sys' : ''} ${cls}`} title={pName(id)}>{id}</i>;
    const lvSq = v => <i className={`ad-lv lv${v}`} title={LV[v][0]} />;
    const secIx = k => SECS.findIndex(s => s[0] === k);
    const lvlOf = (id, sec) => AL && id === A.me ? AL.myLevel(sec) : PPL[id] ? GROUPS[PPL[id].g][2][secIx(sec)] : 0;
    const CAN_ACT = () => !RO() && lvlOf(A.me, A.page) >= 3;
    const GCOL = {
      admin: 'var(--fg)',
      protocol: 'var(--land)',
      field: 'color-mix(in srgb,var(--fg) 50%,transparent)',
      board: 'var(--live)',
      outside: 'var(--line)',
      investors: 'var(--line)'
    };
    const LAB = {
      merchants: 'Merch.',
      community: 'Comm.',
      governance: 'Gov.'
    };
    const SHORT = {
      home: 'Ho',
      growth: 'Gr',
      field: 'Fi',
      members: 'Me',
      merchants: 'Mc',
      shop: 'Sh',
      money: 'Mo',
      build: 'Bu',
      community: 'Co',
      governance: 'Go',
      records: 'Re',
      team: 'Te',
      settings: 'Se'
    };
    const PAGE_N = Object.fromEntries(SECS);
    const ENT_SH = {
      coop: 'Co-op',
      fin: 'Financial',
      dt: 'D&T Co.',
      hold: 'Holdings',
      labs: 'ClearLabs',
      mgr: 'Manager',
      fdn: 'Foundation'
    };

    /* settings, formatted */
    const unitOf = s => s.v === 1 || /le$/.test(s.unit) ? s.unit : s.unit + 's';
    const fmtV = (s, v = s.v) => s.kind === 'money' ? money(v) : s.kind === 'pct' ? v + '%' : s.kind === 'hours' ? v + ' hours' : s.kind === 'days' ? v + ' days' : s.kind === 'num' ? `${v} ${v === 1 || /le$/.test(s.unit) ? s.unit : s.unit + 's'}` : s.kind === 'on' ? v ? 'On' : 'Off' : v;
    const pendOf = id => PEND.find(p => p.set === id);
    const ruleNum = r => {
      // live: a change in Team waits for a second admin when it gives Approve somewhere new (or comes from below Approve)
      if (AL && r.set === 'access') return 'When it gives Approve';
      const s = SETO[r.set];
      if (!s) return 'Every change';
      return {
        money: 'Every amount',
        shopbuy: `Over ${money(s.v)}`,
        refund: `Over ${money(s.v)}`,
        safe: AL ? AL.SAFE ? `${AL.SAFE.threshold} of ${AL.SAFE.owners} in the Ops Safe` : 'In the Ops Safe' : '2 of 3 in the Ops Safe',
        batch: `Every batch of ${s.v}`,
        exports: 'Every list'
      }[r.set] || fmtV(s);
    };
    const second = () => A.me === 'DR' ? 'K' : 'DR';

    /* ── header ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
    const sc = (go, k, v, small, bar, sub) => <div className="sc" {...attrs(go)}><span className="lbl">{k}</span><div className="sc-v">{v}{" "}<small>{small}</small></div><div className="mb">{bar}</div><div className="sc-s">{sub}</div></div>;
    const weekN = () => LOG.filter(l => l[1] >= (AL ? days7()[0] : H2(10, 15, 0))).length + WEEK.length;
    /** The reveals of the last 7 days (the reference's are all this week). */
    const weekRv = () => AL ? REVEALS.filter(r => r[0] >= days7()[0]) : REVEALS;
    const noReason = () => weekRv().filter(r => !r[4]);
    function renderHdr() {
      const P = A.page;
      let brief = '',
        strip = '';
      if (P === 'team' && AL) {
        // live: worked out from the team, the invites and what's waiting
        const ones = CAN.filter(c => c[1].length === 1),
          inv = INVITES.slice().sort((a, b) => a.exp - b.exp)[0],
          wmax = Math.max(0, ...WAITING.map(w => w[4])),
          nopk = PEOPLE.filter(p => !p.passkey),
          sg = PEOPLE.filter(p => p.signer),
          ro2 = nopk.filter(p => !GROUPS[p.g][2].some(v => v >= 3)),
          left = inv ? Math.round((inv.exp - TODAY) / DAY) : 0;
        brief = <>{ones.length ? <>{NUMW(ones.length)}{ones.length === 1 ? ' thing only one person can do.' : ' things only one person can do.'}</> : 'Nothing rests on one person alone.'}{inv ? <>{" "}<a data-aopen={`i:${inv.id}`}>{inv.n}’s invite</a>{" to "}{GROUPS[inv.g][0]}{left > 0 ? ` expires in ${left} day${left === 1 ? '' : 's'}.` : ' expires today.'}</> : ''}</>;
        strip = <>{sc('data-atab="people"', 'On the team', PEOPLE.length, `+${INVITES.length} invited`, segs(PEOPLE, p => GCOL[p.g] || 'var(--line)'), MEMBERS_N ? `${MEMBERS_N} members get the read-only view` : 'Every member gets the read-only view')}{AL.SAFE ? sc('data-atab="rule"', 'Safe signers', sg.length, `of ${AL.SAFE.owners}`, segs(sg, () => 'var(--fg)', AL.SAFE.owners), sg.length ? sg.map(p => p.n.split(' ')[0]).join(', ') : 'None linked to anyone here') : sc('data-atab="rule"', 'Safe signers', '—', 'not read', segs([], () => 'var(--fg)', 3), 'The Ops Safe isn’t read yet')}{sc('data-atab="people"', 'Without a passkey', nopk.length, nopk.length ? `${ro2.length} read-only` : 'everyone has one', segs(PEOPLE, p => p.passkey ? 'var(--fg)' : 'var(--underway)'), nopk.length ? nopk.map(p => p.n).join(', ') : 'Every sign-in used a passkey')}{sc('data-atab="overview"', 'Waiting on a second person', WAITING.length, WAITING.length ? `longest ${wmax} h` : 'nothing', segs(WAITING, w => w[5] && w[4] > w[5] * 2 ? 'var(--underway)' : 'var(--live)'), `${WAITING.filter(w => w[3] === A.me).length} on you`)}</>;
      } else if (P === 'team') {
        const ones = CAN.filter(c => c[1].length < 2),
          inv = INVITES[0],
          wmax = Math.max(...WAITING.map(w => w[4])),
          nopk = PEOPLE.filter(p => !p.passkey);
        brief = <>{NUM[ones.length]}{" things only one person can do. "}<a data-aopen={`i:${inv.id}`}>{inv.n}’s invite</a>{" to "}{GROUPS[inv.g][0]}{" expires in "}{Math.round((inv.exp - TODAY) / DAY)}{" days."}</>;
        strip = <>{sc('data-atab="people"', 'On the team', PEOPLE.length, `+${INVITES.length} invited`, segs(PEOPLE, p => GCOL[p.g]), `${MEMBERS_N} members get the read-only view`)}{sc('data-atab="rule"', 'Safe signers', PEOPLE.filter(p => p.signer).length, 'of 3', segs(PEOPLE.filter(p => p.signer), () => 'var(--fg)', 3), PEOPLE.filter(p => p.signer).map(p => p.n.split(' ')[0]).join(', '))}{sc('data-atab="people"', 'Without a passkey', nopk.length, 'both read-only', segs(PEOPLE, p => p.passkey ? 'var(--fg)' : 'var(--underway)'), nopk.map(p => p.n).join(', '))}{sc('data-atab="overview"', 'Waiting on a second person', WAITING.length, `longest ${wmax} h`, segs(WAITING, w => w[4] > w[5] * 2 ? 'var(--underway)' : 'var(--live)'), `${WAITING.filter(w => w[3] === A.me).length} on you`)}</>;
      }
      if (P === 'settings' && AL) {
        // live: the API's rules, what waits on each, the approved changes and the feeds
        const ok = CONN.filter(c => c.st === 'ok').length,
          p = PEND[0],
          lock = SETS.filter(s => s.kind === 'lock').length,
          last = SET_HIST[0],
          behind = CONN.filter(c => c.st !== 'ok');
        brief = <>Every change here needs a second person and lands in Records.{p ? <>{" "}<a data-aopen={`s:${p.set}`}>{`Changing ${SETO[p.set].t.toLowerCase()} to ${fmtV(SETO[p.set], p.to)}`}</a>{" is waiting on "}{onWho(p.need, 1)}.</> : ''}</>;
        strip = <>{sc('data-atab="rules"', 'Settings', SETS.length, `${lock} set elsewhere`, segs(SETS, s => s.kind === 'lock' ? 'var(--line)' : 'var(--fg)'), 'Locked ones follow a vote, the bylaws or the law')}{sc('data-atab="rules"', 'Waiting', PEND.length, PEND.length === 1 ? 'change' : 'changes', segs(PEND, () => 'var(--underway)', 4), PEND.length ? `On ${[...new Set(PEND.map(x => onWho(x.need, 1)))].join(', ')}` : 'Nothing waiting')}{sc('data-atab="connections"', 'Connections', CONN.length ? `${ok} of ${CONN.length}` : '—', CONN.length ? 'healthy' : 'not read yet', segs(CONN, c => c.st === 'behind' ? 'var(--underway)' : c.st === 'off' ? 'var(--line)' : 'var(--fg)'), CONN.length ? behind.length > 2 ? `${behind.length} not synced or behind · ${behind.slice(0, 2).map(c => c.n).join(', ')}…` : behind.map(c => `${c.n} is ${c.note.split(' · ')[0].toLowerCase()}`).join(', ') || 'All synced' : 'The feeds haven’t answered')}{last ? sc('data-atab="rules"', 'Last change', fmtD(last[1]), last[0], segs(SET_HIST.slice(0, 6), (_, i) => `color-mix(in srgb,var(--fg) ${90 - i * 14}%,transparent)`, 6), `${SETO[last[2]].t} · ${last[3]} → ${last[4]}`) : sc('data-atab="rules"', 'Last change', '—', 'none yet', segs([], () => 'var(--fg)', 6), 'Every rule is at its first value')}</>;
      } else if (P === 'settings') {
        const ok = CONN.filter(c => c.st === 'ok' || c.idle).length,
          p = PEND[0],
          lock = SETS.filter(s => s.kind === 'lock').length,
          last = SET_HIST[0];
        brief = <>Every change here needs a second person and lands in Records.{p ? <>{" "}<a data-aopen={`s:${p.set}`}>{p.label || `Changing ${SETO[p.set].t.toLowerCase()} to ${fmtV(SETO[p.set], p.to)}`}</a>{" is waiting on "}{p.need === A.me ? 'you' : pName(p.need)}.</> : ''}</>;
        strip = <>{sc('data-atab="rules"', 'Settings', SETS.length, `${lock} set elsewhere`, segs(SETS, s => s.kind === 'lock' ? 'var(--line)' : 'var(--fg)'), 'Locked ones follow a vote, the bylaws or the law')}{sc('data-atab="rules"', 'Waiting', PEND.length, PEND.length === 1 ? 'change' : 'changes', segs(PEND, () => 'var(--underway)', 4), PEND.length ? `On ${PEND.map(x => x.need === A.me ? 'you' : pName(x.need)).join(', ')}` : 'Nothing waiting')}{sc('data-atab="connections"', 'Connections', `${ok} of ${CONN.length}`, 'healthy', segs(CONN, c => c.st === 'behind' ? 'var(--underway)' : c.st === 'off' && !c.idle ? 'var(--absent)' : c.idle ? 'var(--line)' : 'var(--fg)'), CONN.filter(c => c.st === 'behind').map(c => `${c.n} is ${c.note.split(' · ')[0]}`).join(', ') || 'All synced')}{sc('data-atab="rules"', 'Last change', fmtD(last[1]), last[0], segs(SET_HIST, (_, i) => `color-mix(in srgb,var(--fg) ${90 - i * 14}%,transparent)`, 6), `${SETO[last[2]].t} · ${last[3]} → ${last[4]}`)}</>;
      }
      if (P === 'records' && AL) {
        // live: the log, the papers on file and the reveals, counted from their rows
        const miss = Object.values(COVER).flat().filter(x => x === 'm').length,
          wait = LOG.filter(l => l[7] === 'waiting'),
          nr = noReason(),
          rv = weekRv(),
          onfile = Object.values(DCOUNT).reduce((a, b) => a + b, 0),
          worst = Object.entries(COVER).map(([id, c]) => [id, c.filter(x => x === 'm').length]).sort((a, b) => b[1] - a[1])[0],
          days = days7(),
          dn = days.map(t => LOG.filter(l => l[1] >= t && l[1] < t + DAY).length),
          dm = Math.max(1, ...dn);
        brief = <>{miss ? <>{NUMW(miss)}{miss === 1 ? ' document is missing' : ' documents are missing'}{worst && worst[1] && worst[1] < miss ? <>{", "}{NUMW(worst[1]).toLowerCase()}{" for "}<a data-adoc-ent={worst[0]}>{ENTO[worst[0]][1]}</a></> : worst && worst[1] ? <>{", for "}<a data-adoc-ent={worst[0]}>{ENTO[worst[0]][1]}</a></> : ''}{worst && worst[1] && /\.$/.test(ENTO[worst[0]][1]) ? '' : '.'}</> : 'No papers are marked missing.'}{nr.length ? <>{" "}{NUMW(nr.length)}{nr.length === 1 ? ' reveal this week has ' : ' reveals this week have '}<a data-atab="reveals">no reason</a>.</> : ''}</>;
        strip = <>{sc('data-atab="log"', 'Actions this week', weekN(), `${fmtD(days[0])}–${fmtD(days[6])}`, segs(dn, v => `color-mix(in srgb,var(--fg) ${Math.round(25 + v / dm * 65)}%,transparent)`), `${LOG.length} in the log${AL.CHAIN ? AL.CHAIN.ok ? ' · the chain holds' : ' · the chain is broken' : ''}`)}{sc('data-atab="log"', 'Waiting on a second person', wait.length, 'in the log', segs(wait, () => 'var(--underway)', 6), wait.length ? `Oldest ${ago(Math.min(...wait.map(l => l[1])))}` : 'Nothing waiting')}{sc('data-atab="docs"', 'Documents', onfile, 'on file', segs(Object.keys(DCOUNT), k => DT[k][1]), `${miss} missing · ${Object.values(COVER).flat().filter(x => x === 'd').length} in draft`)}{sc('data-atab="reveals"', 'Reveals this week', rv.length, `${nr.length} without a reason`, segs(rv, r => r[4] ? 'var(--fg)' : 'var(--absent)'), `${EXPORTS.length} ${EXPORTS.length === 1 ? 'list' : 'lists'} shown in full`)}</>;
      } else if (P === 'records') {
        const miss = Object.values(COVER).flat().filter(x => x === 'm').length,
          wait = LOG.filter(l => l[7] === 'waiting'),
          nr = noReason(),
          onfile = Object.values(DCOUNT).reduce((a, b) => a + b, 0);
        brief = <>{NUM[miss]}{" documents are missing, two for "}<a data-adoc-ent="dt">The Deed & Title Co.</a>{nr.length ? <>{" "}{NUM[nr.length]}{" reveal this week has "}<a data-atab="reveals">no reason</a>.</> : ''}</>;
        const days = Array.from({
            length: 7
          }, (_, d) => H2(10, 15 + d, 0)),
          dn = days.map(t => WEEK.filter(e => e[0] >= t && e[0] < t + DAY).length + LOG.filter(l => l[1] >= t && l[1] < t + DAY).length),
          dm = Math.max(...dn);
        strip = <>{sc('data-atab="log"', 'Actions this week', weekN(), '15–21 Oct', segs(dn, v => `color-mix(in srgb,var(--fg) ${Math.round(25 + v / dm * 65)}%,transparent)`), `${LOG.filter(l => l[1] >= days[0]).length} key actions, the rest everyday`)}{sc('data-atab="log"', 'Waiting on a second person', wait.length, 'in the log', segs(wait, () => 'var(--underway)', 6), `Oldest ${ago(Math.min(...wait.map(l => l[1])))}`)}{sc('data-atab="docs"', 'Documents', onfile, 'on file', segs(Object.keys(DCOUNT), k => DT[k][1]), `${miss} missing · ${Object.values(COVER).flat().filter(x => x === 'd').length} in draft`)}{sc('data-atab="reveals"', 'Reveals this week', REVEALS.length, `${nr.length} without a reason`, segs(REVEALS, r => r[4] ? 'var(--fg)' : 'var(--absent)'), `${EXPORTS.length} exports · ${EXPORTS.filter(e => e[5] === 'waiting').length} waiting`)}</>;
      }
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />{{
            team: 'Team · who can do what',
            settings: 'Settings · admin only',
            records: 'Records · kept seven years'
          }[P]}{AL ? '' : " · Demo data"}</span><p className="brief">{brief}</p><div className="strip">{strip}</div></>);

      html(document.getElementById('atabs'), TABS[P].map(([k, t], __k) => <button key={__k} data-atab={k} aria-current={A.tab[P] === k ? 'page' : 'false'}>{t}</button>));
      document.getElementById('atabs').setAttribute('aria-label', `${PAGE_N[P]} views`);
    }

    /* ══ Team ═════════════════════════════════════════════════════════════════════════════════════════════════════════ */
    const mxHead = (first = 'Person') => <><div className="ad-mx-r ad-mx-g"><span />{SEC_GROUP.map(([g, a, b], __k) => <span key={__k} style={css(`grid-column:span ${b - a + 1}`)}>{g}</span>)}</div><div className="ad-mx-r ad-mx-h"><span className="ad-mx-f">{first}</span>{SECS.map(([k, t], __k) => <span key={__k} title={t}><b>{LAB[k] || t}</b><i>{SHORT[k]}</i></span>)}</div></>;
    const mxRow = (at, av, name, sub, lv, cls = '') => <button className={`ad-mx-r ${cls}`} {...attrs(at)}><span className="ad-mx-k">{av}<span className="gt-ck"><b>{name}</b><span>{sub}</span></span></span>{lv.map((v, __k) => <span key={__k} className="ad-mx-c">{lvSq(v)}</span>)}</button>;
    const lvKey = () => <span className="f-key">{LV.map(([t], i) => <span key={i}>{lvSq(i)}{t}</span>)}</span>;
    function teamOverview() {
      const rows = <>{mxRow('data-aopen="g:members"', <i className="ad-av grp">{MEMBERS_N}</i>, 'Every member', 'Read-only, with a Clear account', GROUPS.members[2], 'all')}{PEOPLE.map(p => <Fragment key={p.id}>{mxRow(`data-aopen="p:${p.id}"`, sq(p.id), p.n + (p.id === A.me ? ' · you' : ''), `${GROUPS[p.g][0]} · ${p.title}`, GROUPS[p.g][2])}</Fragment>)}{INVITES.map(i => <Fragment key={i.id}>{mxRow(`data-aopen="i:${i.id}"`, sq(i.id, 'dash'), i.n, `Invited · ${GROUPS[i.g][0]} · until ${fmtD(i.exp)}`, GROUPS[i.g][2], 'inv')}</Fragment>)}</>;
      const mx = cell('s12', 'Who can do what', <span className="lbl">Set per group, never per person</span>, <div className="ad-mx">{mxHead()}{rows}</div>, <>{lvKey()}<button data-ainvite="">Invite someone</button></>);
      const wmax = Math.max(1, ...WAITING.map(w => w[4]));
      const wait = cell('s7', 'Waiting on a second person', <span className="lbl">{WAITING.length}{" now"}</span>, <div className="ad-wl">{WAITING.slice().sort((a, b) => b[4] - a[4]).map(([t, from, by, on, h, u, r], __k) => <button key={__k} className="ad-wr" {...attrs(from === 'Settings' ? `data-aopen="s:${PEND[0] ? PEND[0].set : 'shopbuy'}"` : `data-aout="${from}"`)}><span className="gt-ck"><b>{t}</b><span>{from}{" · "}{pName(by)}{" proposed"}</span></span><span className="ad-wb"><span className="ad-wb-t"><i className={u && h > u * 2 ? 'late' : ''} style={css(`width:${h / wmax * 100}%`)} /><s style={css(`left:${u / wmax * 100}%`)} /></span></span><span className="ad-wo"><b>{h}{" h"}</b><em>{'on ' + onWho(on)}</em></span></button>)}{rest()}</div>, <><span className="f-key"><span><i style={css("background:var(--live)")} />Hours waiting</span><span><i style={css("background:var(--underway)")} />Over twice the usual</span><span><i className="ad-tick" />Usual wait</span></span><button data-atab="rule">Two-person rule →</button></>);
      const one = cell('s5', 'Only one person can do it', <span className="lbl">Worth a backup</span>, <div className="ad-cl">{CAN.slice().sort((a, b) => a[1].length - b[1].length).map(([t, ids], __k) => <div key={__k} className={`ad-cr ${ids.length < 2 ? 'one' : ''}`}><span>{t}</span><span className="ad-avs">{ids.map(id => sq(id))}{Array.from({
              length: Math.max(0, 3 - ids.length)
            }, (_, __k) => <i key={__k} className="ad-av none" />)}</span></div>)}{rest()}</div>, <><span className="f-key"><span><i style={css("background:var(--underway)")} />Only one person</span></span><button data-atab="groups">Groups →</button></>);
      return <>{band(mx, 1)}{band(<>{wait}{one}</>)}</>;
    }
    function teamPeople() {
      const pRow = p => {
        const d = p.dev.filter(x => x[2]).length;
        return <button className="ad-pr" data-aopen={`p:${p.id}`}>{sq(p.id)}<span className="gt-ck"><b>{p.n}{p.id === A.me ? ' · you' : ''}</b><span>{p.title}</span></span><span className="ad-pg"><i style={css(`background:${GCOL[p.g] || 'var(--line)'}`)} />{GROUPS[p.g][0]}</span><span className="mono ad-em">{p.email}</span><span className={`ad-pk ${p.passkey ? '' : 'no'}`}><b>{p.passkey ? 'Passkey' : 'Emailed code'}</b><em>{d}{AL ? " device" : " trusted device"}{d === 1 ? '' : 's'}</em></span><span className="ad-pl"><b>{ago(p.last)}</b><em>{p.until ? `Access ends ${fmtD(p.until)}` : `Since ${fmtD(p.since)}`}</em></span><span className="gv-go">{ICO.chev}</span></button>;
      };
      const order = PEOPLE.slice().sort((a, b) => GKEYS.indexOf(a.g) - GKEYS.indexOf(b.g));
      const list = <>{secRow('On the team', `${PEOPLE.length} people · ${PEOPLE.filter(p => !p.passkey).length} ${AL ? 'without a passkey' : 'read-only'}`)}{order.map(pRow)}{secRow('Invited', `${INVITES.length} waiting to accept`)}{INVITES.map((i, __k) => <button key={__k} className="ad-pr inv" data-aopen={`i:${i.id}`}>{sq(i.id, 'dash')}<span className="gt-ck"><b>{i.n}</b><span>{i.title}</span></span><span className="ad-pg"><i style={css(`background:${GCOL[i.g] || 'var(--line)'}`)} />{GROUPS[i.g][0]}</span><span className="mono ad-em">{i.email}</span><span className="ad-pk"><b>Not set up</b><em>Passkey on first sign-in</em></span><span className="ad-pl"><b>{"Sent "}{fmtD(i.sent)}</b><em>{"Expires "}{fmtD(i.exp)}</em></span><span className="gv-go">{ICO.chev}</span></button>)}</>;
      const people = cell('s12', 'Everyone with access', <span className="lbl">{PEOPLE.length}{" people · "}{INVITES.length}{" invited"}</span>, <div className="ad-pl-l"><div className="ad-pr hd2"><span />{lbl('Person')}{lbl('Group')}{lbl('Email')}{lbl('Sign-in')}{lbl('Last active')}<span /></div>{list}</div>, <><span>{AL ? 'Giving someone Approve needs a second admin · every change is logged' : 'Inviting, turning someone off or changing a group needs a second person'}</span><button data-ainvite="">Invite someone</button></>);
      const ends = AL ? AL.ENDS : [[INVITES[0].exp, `${INVITES[0].n}’s invite expires`, 'Resend it, or it lapses', 'i:PS'], [PPL.LP.until, 'Lena Park’s data room access ends', 'Harbor Capital · investor', 'p:LP'], [D(1, 2, 2027), 'Quarterly access review', 'Every person and group, with a second person', 'g:outside']];
      const end = cell('s7', 'Access that ends', <span className="lbl">Next 90 days</span>, <div className="gt-cl">{ends.map(([t, a, b, o], __k) => <button key={__k} className="gt-cr" data-aopen={o}>{leaf(t)}<span className="gt-ck"><b>{a}</b><span>{b}</span></span><span className="gt-st" style={css(`--c:${(t - TODAY) / DAY < 7 ? 'var(--underway)' : 'var(--line)'}`)}>{Math.round((t - TODAY) / DAY)}{" days"}</span></button>)}{rest()}</div>, <><span>{AL ? 'Invites last 7 days · investors’ access ends 30 days after their first sign-in' : 'Read-only access for outside people always has an end date'}</span><span /></>);
      const days = days7(),
        SI = AL ? AL.SI : {
          K: [3, 2, 1, 1, 4, 3, 3],
          DR: [2, 2, 0, 0, 3, 2, 2],
          ML: [2, 3, 2, 2, 3, 1, 2],
          BS: [0, 1, 0, 0, 0, 1, 0],
          AC: [0, 1, 0, 0, 1, 1, 0],
          LP: [0, 0, 0, 0, 1, 1, 0]
        },
        si0 = [0, 0, 0, 0, 0, 0, 0],
        smx = AL ? Math.max(1, ...Object.values(SI).flat()) : 4;
      const si = cell('s5', 'Sign-ins', <span className="lbl">Last 7 days</span>, <div className="ad-si">{PEOPLE.map((p, __k) => <div key={__k} className="ad-si-r"><span>{p.n}</span><span className="ad-si-b">{(SI[p.id] || si0).map((v, i) => <i key={i} className={i === 6 ? 'now' : ''} style={css(`height:${v ? Math.max(12, v / smx * 100) : 0}%`)} />)}</span><b>{(SI[p.id] || si0).reduce((a, b) => a + b, 0)}</b></div>)}<div className="ad-si-r ad-si-x"><span /><span className="ad-si-b">{days.map((t, i) => <span key={i}>{i === 6 ? 'Today' : WD(t)}</span>)}</span><b /></div></div>, <><span>{AL ? 'By passkey or an emailed code, each day' : 'A new device needs a confirmation'}</span><button data-ago="settings/security">Security →</button></>);
      return <>{band(people, 1)}{band(<>{end}{si}</>)}</>;
    }
    function teamGroups() {
      const rows = [['members', <i className="ad-av grp">{MEMBERS_N}</i>]].concat(GKEYS.map((g, __k) => [g, <span className="ad-avs">{PEOPLE.filter(p => p.g === g).map(p => sq(p.id))}{INVITES.filter(i => i.g === g).map(i => sq(i.id, 'dash'))}</span>]));
      const gl = cell('s12', 'Groups', <span className="lbl">{GKEYS.length}{" groups, and every member"}</span>, <div className="ad-mx ad-gx">{mxHead('Group')}{rows.map(([g, av], __k) => <button key={__k} className={`ad-mx-r ${g === 'members' ? 'all' : ''}`} data-aopen={`g:${g}`}><span className="ad-mx-k ad-gk"><span className="gt-ck"><b>{GROUPS[g][0]}</b><span>{GROUPS[g][1]}</span></span>{av}</span>{GROUPS[g][2].map((v, __k) => <span key={__k} className="ad-mx-c">{lvSq(v)}</span>)}</button>)}</div>, <>{lvKey()}<span>{AL ? 'Giving a group Approve somewhere new needs a second admin' : 'Changing a group needs a second person'}</span></>);
      // live, each level's example is a real group at that level somewhere
      const EX = AL ? LV.map((_, i) => ['members', ...GKEYS].flatMap(g => SECS.map(([, t], j) => GROUPS[g][2][j] === i ? `${GROUPS[g][0]} on ${t}` : null)).find(Boolean) || '') : ['Not in their menu at all', 'Members see co-op totals on Money', 'Outside sees Money and Records', 'Field proposes a new shop', 'Dana approves an invite batch'];
      const lv = cell('s7', 'What each level means', <span className="lbl">The same five on every page</span>, <div className="ad-lvl">{LV.map(([t, d], i) => <div key={i} className="ad-lvr">{lvSq(i)}<span className="gt-ck"><b>{t}</b><span>{d}</span></span><em>{EX[i]}</em></div>)}</div>, <><span>The server checks the level on every request, not just the menu</span><span /></>);
      const rv = GKEYS.filter(g => GROUPS[g][2][secIx('members')] === 4);
      const who = cell('s5', 'Who can reveal personal details', <span className="lbl">Approve on Members</span>, <div className="ad-cl">{rv.map((g, __k) => <div key={__k} className="ad-cr"><span>{GROUPS[g][0]}</span><span className="ad-avs">{PEOPLE.filter(p => p.g === g).map(p => sq(p.id))}</span></div>)}<div className="ad-cr q"><span>Everyone else</span><span className="ad-avs"><em>Sees masked details only</em></span></div>{rest()}</div>, <><span>{AL && SETO.reason && !SETO.reason.v ? 'Reveals don’t ask for a reason right now' : 'Every reveal needs a reason'}</span><button data-ago="records/reveals">Reveals →</button></>);
      return <>{band(gl, 1)}{band(<>{lv}{who}</>)}</>;
    }
    function teamRule() {
      const list = cell('s12', 'The two-person rule', <span className="lbl">Nobody approves their own</span>, <div className="ad-rl"><div className="ad-rr hd2"><span>{lbl('Rule')}</span>{lbl('When it applies')}{lbl('Second person')}{lbl('30 days')}{lbl('Usual wait')}<span /></div>{RULES.map((r, __k) => {
          const p = pendOf(r.set);
          return <button key={__k} className="ad-rr" data-aopen={`r:${r.id}`}><span className="gt-ck"><b>{r.t}</b><span>{r.c}</span></span><span className="ad-rn"><b>{ruleNum(r)}</b>{p ? <em className="ad-pd">{fmtV(SETO[p.set], p.to)}{" waiting"}</em> : SETO[r.set] && SETO[r.set].kind !== 'lock' ? <em>Set in Settings</em> : <em>Always</em>}</span><span className="ad-avs">{r.who.map(id => sq(id))}</span><b className="num">{r.n30}</b><span className="num">{r.med ? r.med.toFixed(1) + ' h' : '–'}</span><span className="gv-go">{ICO.chev}</span></button>;
        })}</div>, <><span>Team sets who can be the second person · Settings sets the numbers</span><button data-ago="settings/rules">Settings →</button></>);
      // live, the people who proposed and approved in 30 days
      const ppl = AL ? AL.APPR_ROWS : [['K', 'Kai'], ['DR', 'Dana Ruiz'], ['ML', 'Marcus Lee']],
        appr = AL ? AL.APPR_COLS : [['K', 'Kai'], ['DR', 'Dana'], ['ML', 'Marcus'], ['BS', 'Board']],
        mxv = AL ? Math.max(1, ...Object.values(APPR).flatMap(r => Object.values(r))) : 6;
      const am = cell('s7', 'Who approves whom', <span className="lbl">Last 30 days</span>, <div className="ad-am"><div className="ad-am-r hd2"><span>{lbl('Proposed by')}</span>{appr.map(a => lbl(a[1]))}{lbl('Total')}</div>{ppl.map(([p, n], __k) => {
          const row = APPR[p] || {},
            tot = Object.values(row).reduce((a, b) => a + b, 0);
          return <div key={__k} className="ad-am-r"><span>{n}</span>{appr.map(([a], __k) => a === p ? <i key={__k} className="ad-amc self" title="Can’t approve your own" /> : <i key={__k} className="ad-amc" style={css(`--v:${(row[a] || 0) / mxv}`)}><b className={(row[a] || 0) / mxv > .5 ? 'inv' : ''}>{row[a] || ''}</b></i>)}<b className="num">{tot}</b></div>;
        })}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />More approvals</span><span><i className="ad-self" />Can’t approve your own</span></span><span /></>);
      const rs = RULES.filter(r => r.n30),
        mx = Math.max(...rs.map(r => r.med));
      const sp = cell('s5', 'How long a second person takes', <span className="lbl">Usual wait</span>, <div className="ad-hb">{rs.sort((a, b) => b.med - a.med).map((r, __k) => <button key={__k} className="ad-hb-r" data-aopen={`r:${r.id}`}><span>{r.t}</span><span className="ad-hb-b"><i style={css(`width:${r.med / mx * 100}%`)} /></span><b>{r.med.toFixed(1)}{" h"}</b></button>)}</div>, <><span>{AL ? 'From proposed to approved, last 30 days' : 'Over a day, the app nudges the second person'}</span><span /></>);

      return <>{band(list, 1)}{band(<>{am}{sp}</>)}</>;
    }

    /* ══ Settings ═════════════════════════════════════════════════════════════════════════════════════════════════════ */
    const usedTxt = s => s.used.map(k => PAGE_N[k]).join(', ');
    /** Where a setting shows: live, a stored one nothing enforces yet says so. */
    const usedLine = s => AL && s.enforced === false ? 'Stored · nothing enforces it yet' : `Used in ${usedTxt(s)}`;
    /** A cell with no source yet: hatched, with what it needs (docs/ui-redesign-plan.md, gaps). */
    const notReal = (cls, title, need) => cell(cls, title, lbl('Not real yet'), <><div className="bk-empty hatch" style={css("min-height:120px;opacity:.5")} /><div className="bk-empty">{need}</div></>, <span />);
    function setRow(s) {
      const p = pendOf(s.id),
        lock = s.kind === 'lock';
      return <button className={`ad-sr ${lock ? 'lock' : ''}`} data-aopen={`s:${s.id}`}><span className="gt-ck"><b>{s.t}</b><span>{s.d}</span></span><span className="ad-sv">{lock ? <><b>{ICO.lock}{s.v}</b><em>{s.why}</em></> : <><b>{fmtV(s)}</b>{p ? <em className="ad-pd">{"→ "}{fmtV(s, p.to)}{" · waiting on "}{onWho(p.need)}</em> : <em>{usedLine(s)}</em>}</>}</span><span className="gv-go">{ICO.chev}</span></button>;
    }
    const setCell = (sec, w, foot) => {
      const L = SETS.filter(s => s.sec === sec);
      return cell(w, SEC_T[sec][0], lbl(SEC_T[sec][1]), <div className="ad-sl">{L.map(setRow)}{rest()}</div>, foot || <><span>{L.filter(s => s.kind !== 'lock').length}{" you can change · "}{L.filter(s => s.kind === 'lock').length}{" set elsewhere"}</span><span /></>);
    };
    function setRules() {
      const hist = cell('s12', 'Changes', <span className="lbl">Each one had a second person</span>, <div className="gt-cl">{PEND.map((p, __k) => {
          const s = SETO[p.set];
          return <button key={__k} className="gt-cr ad-pend" data-aopen={`s:${s.id}`}>{leaf(p.at)}<span className="gt-ck"><b>{s.t}</b><span>{fmtV(s, p.from)}{" → "}{fmtV(s, p.to)}{" · "}{pName(p.by)}{" proposed"}</span></span><span className="gt-st" style={css("--c:var(--underway)")}>{"Waiting on "}{onWho(p.need)}</span></button>;
        })}{SET_HIST.map(([id, t, k, a, b, by, ok], __k) => <button key={__k} className="gt-cr" data-aopen={`s:${k}`}>{leaf(t)}<span className="gt-ck"><b>{SETO[k].t}</b><span>{a}{" → "}{b}{" · "}{by ? pName(by).split(' ')[0] : 'Someone'}{" and "}{ok ? pName(ok).split(' ')[0] : 'someone else'}</span></span><span className="mono ad-id">{id}</span></button>)}{rest()}</div>, <><span>Every change is in the audit log</span><button data-ago="records/log">Audit log →</button></>);
      return <>{band(<>{setCell('money', 's6')}{setCell('shop', 's6')}</>, 1)}{band(<>{setCell('chain', 's4')}{setCell('members', 's4')}{setCell('gov', 's4')}</>)}{band(hist)}</>;
    }
    function setSecurity() {
      const devs = PEOPLE.flatMap(p => p.dev.map((d, i) => ({
        p,
        d,
        i
      }))).sort((a, b) => b.d[1] - a.d[1]);
      const dv = cell('s7', 'Devices', <span className="lbl">{AL ? `${devs.length} seen` : `${devs.filter(x => x.d[2]).length} trusted`}</span>, <div className="ad-dl">{devs.map(({
          p,
          d,
          i
        }, __k) => <div key={__k} className={`ad-dr ${NOW - d[1] > 7 * DAY ? 'stale' : ''}`}>{sq(p.id)}<span className="gt-ck"><b>{d[0]}</b><span>{p.n}{NOW - d[1] > 7 * DAY ? ` · not seen in ${Math.round((NOW - d[1]) / DAY)} days` : ''}</span></span><span className="ad-dt"><b>{ago(d[1])}</b><em>{p.passkey ? 'Passkey' : 'Emailed code'}</em></span>{CAN_ACT() && !AL ? <button className={`ad-so ${NOW - d[1] > 7 * DAY ? 'on' : ''}`} data-asignout={`${p.id}:${i}`}>Sign out</button> : <span />}</div>)}{rest()}</div>, <><span>{AL ? 'Signing someone out everywhere is in their panel in Team' : 'Signing a device out ends its session right away'}</span><span /></>);
      const ev = [[H(10, 19, 9, 41), 'Marcus Lee’s new iPhone, confirmed', 'Kai confirmed it 11 minutes after', 'p:ML', 'var(--fg)', 'Confirmed'], [H(10, 19, 11, 10), 'A reveal with no reason', 'Kai showed M-0044’s email', 'x:reveals', 'var(--absent)', 'Look'], [H(10, 12, 18, 0), 'Marcus Lee’s old iPhone went quiet', 'Still trusted · sign it out', 'p:ML', 'var(--underway)', 'Sign out'], [H(10, 2, 9, 0), 'The outside accountant joined', 'Read-only, emailed code', 'p:AC', 'var(--line)', 'Read-only']];
      const se = cell('s5', 'Worth a look', <span className="lbl">Last 30 days</span>, <div className="gt-cl">{ev.map(([t, a, b, o, c, s], __k) => <button key={__k} className="gt-cr" {...attrs(o === 'x:reveals' ? 'data-ago="records/reveals"' : `data-aopen="${o}"`)}>{leaf(t)}<span className="gt-ck"><b>{a}</b><span>{b}</span></span><span className="gt-st" style={css(`--c:${c}`)}>{s}</span></button>)}{rest()}</div>, <><span>Alerts go to Kai and Dana Ruiz</span><span /></>);
      const se2 = AL ? notReal('s5', 'Worth a look', 'Needs the sign-in and reveal events marked for a look: a new device and who confirmed it, a reveal with no reason, a device gone quiet, someone new joining. Records → Reveals has the reveals.') : se;
      return <>{band(<>{setCell('signin', 's6')}{setCell('privacy', 's6')}</>, 1)}{band(<>{dv}{se2}</>)}</>;
    }
    const keyTxt = c => c.keyNote != null ? c.keyNote : c.key === '@rpc' ? 'Public RPC' : c.key === '@safe' ? 'Signers’ own keys' : c.key ? `Key ••••${c.key}` : 'No key';
    function connHrs(c, big) {
      return <span className={`ad-hr ${big ? 'big' : ''}`}>{c.hrs.map((h, i) => <i key={i} className={h === 1 ? '' : h === 0 ? c.idle ? 'idle' : 'down' : 'slow'} title={`${24 - i} h ago`} />)}</span>;
    }
    const CST = c => c.st === 'behind' ? ['Behind', 'var(--underway)'] : AL && c.stLabel ? [c.stLabel, 'var(--line)'] : c.idle ? ['Asleep', 'var(--line)'] : c.st === 'off' && AL ? ['Off', 'var(--line)'] : c.st === 'off' ? ['Down', 'var(--absent)'] : ['Healthy', 'var(--settled)'];
    function setConnections() {
      const list = cell('s12', 'Connections', <span className="lbl">{CONN.length}{" services"}</span>, <div className="ad-cn"><div className="ad-cnr hd2"><span>{lbl('Service')}</span>{lbl('Last 24 hours')}{lbl('Last heard')}{lbl('Status')}<span /></div>{CONN.map((c, __k) => <button key={__k} className="ad-cnr" data-aopen={`c:${c.id}`}><span className="gt-ck"><b>{c.n}</b><span>{c.what}{" · "}{c.note}</span></span>{connHrs(c)}<span className="ad-dt"><b>{ago(c.last)}</b><em>{keyTxt(c)}</em></span><span className="gt-st" style={css(`--c:${CST(c)[1]}`)}>{CST(c)[0]}</span><span className="gv-go">{ICO.chev}</span></button>)}</div>, <><span className="f-key"><span><i style={css("background:color-mix(in srgb,var(--fg) 38%,transparent)")} />Working</span><span><i style={css("background:var(--underway)")} />Slow or behind</span><span><i style={css("background:var(--absent)")} />Down</span><span><i className="ad-idle" />Asleep</span></span><span>{AL ? 'No hourly history yet · keys stay on the server' : 'Keys are never shown, only their last four'}</span></>);
      const pages = ['home', 'members', 'merchants', 'shop', 'money', 'build', 'community', 'governance', 'records'];
      const use = cell('s7', 'Where each one is used', <span className="lbl">If it goes down, these pages notice</span>, <div className="ad-ux"><div className="ad-ux-r hd2"><span />{pages.map((k, __k) => <span key={__k} title={PAGE_N[k]}><b>{LAB[k] || PAGE_N[k]}</b><i>{SHORT[k]}</i></span>)}</div>{CONN.map((c, __k) => <div key={__k} className="ad-ux-r"><span>{c.n}</span>{pages.map((k, __k) => <span key={__k}>{c.used.includes(k) ? <i className={c.st === 'behind' ? 'warn' : ''} /> : ''}</span>)}</div>)}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Used here</span><span><i style={css("background:var(--underway)")} />Behind right now</span></span><span /></>);
      const rot = SETO.rotate ? SETO.rotate.v : 90,
        ks = CONN.filter(c => c.rot).sort((a, b) => b.rot - a.rot),
        rmx = Math.max(rot * 1.15, ...ks.map(c => c.rot));
      const keys = cell('s5', 'Key age', <span className="lbl">{"Rotate every "}{rot}{" days"}</span>, <div className="ad-hb">{ks.map((c, __k) => <button key={__k} className="ad-hb-r" data-aopen={`c:${c.id}`}><span>{c.n}</span><span className="ad-hb-b ad-kb"><i className={c.rot > rot ? 'late' : c.rot > rot - 14 ? 'soon' : ''} style={css(`width:${c.rot / rmx * 100}%`)} /><s style={css(`left:${rot / rmx * 100}%`)} /></span><b className={c.rot > rot ? 'bad' : ''}>{c.rot}{" d"}</b></button>)}</div>, <><span className="f-key"><span><i style={css("background:var(--underway)")} />Due in two weeks</span><span><i style={css("background:var(--absent)")} />Overdue</span></span><span /></>);
      const keys2 = AL ? notReal('s5', 'Key age', 'Needs when each connection’s key was set and who swapped it last: the keys are kept on the server, which doesn’t record their age.') : keys;
      return <>{band(list, 1)}{band(<>{use}{keys2}</>)}</>;
    }
    function setOrg() {
      const prof = AL ? notReal('s6', 'Profile', 'Needs the organization’s profile kept in the API: its name, website, help email, time zone, fiscal year and currency.') : cell('s6', 'Profile', <span className="lbl">Shown to members</span>, <><div className="led ad-led">{PROFILE.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{rest()}</>, <><span>Changes here need a second person too</span><span /></>);
      const net = cell('s6', 'Network', <span className="lbl">Where the contracts run</span>, <div className="ad-net"><div className="ad-net-r on"><span className="gt-ck"><b>Base Sepolia · testnet</b><span>Every contract, pool and payout today. Test money only.</span></span><span className="gt-st" style={css("--c:var(--settled)")}>Now</span></div><div className="ad-net-r next"><span className="gt-ck"><b>Base · mainnet</b><span>Real money. Needs the audits closed, a board vote, then the Ops Safe.</span></span><span className="gt-st" style={css("--c:var(--line)")}>Not yet</span></div>{AL ? '' : <div className="ad-net-c">{[['Audits closed', '2 of 3', 'labs'], ['Board vote', 'Not started', 'gov'], ['Ops Safe', 'After the vote', 'safe']].map(([a, b], __k) => <span key={__k}><b>{a}</b><em>{b}</em></span>)}</div>}</div>, <><span>{ICO.lock}{" Set by a board vote, not here"}</span><button data-aout="Governance">Governance →</button></>);
      const ent = cell('s12', 'Entities', <span className="lbl">{ENT.length}{" entities · tax IDs masked"}</span>, <div className="ad-en"><div className="ad-enr hd2"><span>{lbl('Entity')}</span>{lbl('Tax ID')}{lbl('Papers on file')}{lbl('Status')}<span /></div>{ENT.map(([id, n, k, st, tax], __k) => {
          const c = COVER[id] || [],
            f = c.filter(x => x === 'f').length,
            need = c.filter(x => x !== 'n').length,
            m = c.filter(x => x === 'm').length;
          return <button key={__k} className="ad-enr" data-adoc-ent={id}><span className="gt-ck"><b>{n}</b><span>{k}</span></span>{tax ? <span className="mono ad-tax">••-•••{tax}</span> : <span className="ad-tax q">{AL ? 'Not on file' : 'Applied for'}</span>}<span className="ad-pp"><span className="ad-pp-b">{c.map((x, __k) => <i key={__k} className={x} title={CV[x][0]} />)}</span><em className={m ? 'bad' : ''}>{f}{" of "}{need}{m ? ` · ${m} missing` : ''}</em></span><span className="gt-st" style={css(`--c:${st === 'formed' ? 'var(--settled)' : AL && st === 'planned' ? 'var(--line)' : 'var(--underway)'}`)}>{st === 'formed' ? 'Formed' : AL && st === 'planned' ? 'Planned' : 'Forming'}</span><span className="gv-go">{ICO.chev}</span></button>;
        })}</div>, <><span className="f-key"><span><i style={css("background:color-mix(in srgb,var(--fg) 30%,transparent)")} />On file</span><span><i style={css("background:color-mix(in srgb,var(--underway) 55%,transparent)")} />Draft</span><span><i style={css("background:var(--absent)")} />Missing</span><span><i className="ad-nn" />Not needed yet</span></span><button data-aout="Governance">Entities in Governance →</button></>);
      // live: the chain's state as GET /audit checks it; no backup is recorded, so it isn't drawn
      const ch = AL ? AL.CHAIN : null;
      const rec = cell('s6', 'Records', <span className="lbl">How things are kept</span>, <div className="ad-sl">{SETO.retain ? setRow(SETO.retain) : ''}<div className="ad-sr st"><span className="gt-ck"><b>The audit log can’t be edited</b><span>Each entry is chained to the one before it</span></span><span className="ad-sv"><b>{ICO.lock}Always</b><em>{AL ? ch ? ch.ok ? `The chain holds · ${ch.entries} entries` : `Broken at entry #${ch.brokenAt}` : 'The chain isn’t read yet' : 'Checked nightly'}</em></span><span /></div>{AL ? '' : <div className="ad-sr st"><span className="gt-ck"><b>Backups</b><span>Documents, the log and settings</span></span><span className="ad-sv"><b>Nightly</b><em>Last at 02:00 today</em></span><span /></div>}{rest()}</div>, <><span>{AL ? 'Whole lists need Approve and a reason · no second person yet' : 'Exports need a second person'}</span><button data-ago="records/reveals">Exports →</button></>);
      const nt = cell('s6', 'Notifications', <span className="lbl">Who hears about what</span>, <div className="ad-sl">{AL ? <div className="ad-sr st"><span className="gt-ck"><b>Alerts</b><span>Who hears about what isn’t stored yet</span></span><span className="ad-sv"><b>Not real yet</b><em>Needs alert rules and who each goes to</em></span><span /></div> : ''}{ALERTS.map(([a, b, ids], __k) => <div key={__k} className="ad-sr st"><span className="gt-ck"><b>{a}</b><span>{b}</span></span><span className="ad-avs">{ids.length ? ids.map(id => sq(id)) : <em>Whoever it’s waiting on</em>}</span><span /></div>)}{SETO.digest ? setRow(SETO.digest) : ''}{rest()}</div>, <><span>{AL ? 'Needs you shows what’s waiting on each person' : 'Each person can mute their own, not anyone else’s'}</span><span /></>);
      return <>{band(<>{prof}{nt}</>, 1)}{band(<>{net}{rec}</>)}{band(ent)}</>;
    }

    /* ══ Records ══════════════════════════════════════════════════════════════════════════════════════════════════════ */
    const days7 = () => Array.from({
      length: 7
    }, (_, d) => AL ? TODAY - (6 - d) * DAY : H2(10, 15 + d, 0));
    function lanes() {
      const days = days7(),
        order = Object.keys(AREAS);
      const cellOf = (w, t) => {
        const e = t + DAY;
        return {
          keys: LOG.filter(l => l[2] === w && l[1] >= t && l[1] < e),
          evs: WEEK.filter(x => x[1] === w && x[0] >= t && x[0] < e)
        };
      };
      const max = Math.max(1, ...WHO.flatMap(([w]) => days.map(t => {
        const c = cellOf(w, t);
        return c.keys.length + c.evs.length;
      })));
      return <div className="ad-wk"><div className="ad-wk-r hd2"><span />{days.map((t, i) => lbl(i === 6 ? 'Today' : `${WD(t)} ${new Date(t).getUTCDate()}`))}<span /></div>{WHO.map(([w, n], __k) => {
          const tot = days.reduce((a, t) => {
            const c = cellOf(w, t);
            return a + c.keys.length + c.evs.length;
          }, 0);
          return <div key={__k} className="ad-wk-r"><span className="ad-wk-p">{sq(w)}<b>{n}</b></span>{days.map((t, i) => {
              const {
                  keys,
                  evs
                } = cellOf(w, t),
                cnt = keys.length + evs.length;
              const mix = order.map(a => [a, evs.filter(x => x[2] === a).length + keys.filter(l => l[3] === a).length]).filter(x => x[1]);
              return <button key={i} className={`ad-wt ${i === 6 ? 'now' : ''}`} data-alog={w} style={css(`--v:${(cnt / max).toFixed(2)}`)} title={`${n} · ${WD(t)} ${new Date(t).getUTCDate()} · ${cnt} actions`}><b>{cnt}</b><span className="ad-wt-m">{mix.map(([a, k], __k) => <i key={__k} style={css(`flex:${k};background:${AREAS[a][1]}`)} />)}</span>{keys.length ? <span className="ad-wt-k">{keys.map((_, __k) => <i key={__k} />)}</span> : ''}</button>;
            })}<b className="num">{tot}</b></div>;
        })}</div>;
    }
    const resChip = r => <span className="gt-st" style={css(`--c:${RESULT[r][1]}`)}>{RESULT[r][0]}</span>;
    function recOverview() {
      const wk = cell('s12', 'This week', <span className="lbl">{AL ? `${fmtD(days7()[0])}–${fmtD(days7()[6])} · ` : "15–21 Oct · "}{weekN()}{" actions"}</span>, lanes(), <><span className="f-key"><span><i className="ad-shade" />Darker is busier</span><span><i className="ad-kk" />A key action</span><span><i className="ad-mixk" />The strip is the kind of work, coloured as below</span></span><button data-atab="log">Audit log →</button></>);
      const keys = cell('s7', 'Key actions', <span className="lbl">Newest first</span>, <div className="ad-ll">{LOG.slice().sort((a, b) => b[1] - a[1]).slice(0, 7).map(logRow)}</div>, <><span>{LOG.filter(l => l[7] === 'waiting').length}{" still waiting on someone"}</span><button data-atab="log">{"All "}{LOG.length}{" →"}</button></>);
      const from = days7()[0],
        order = Object.keys(AREAS),
        by = order.map(a => [a, WEEK.filter(e => e[2] === a).length + LOG.filter(l => l[3] === a && l[1] >= from).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]),
        bm = by.length ? by[0][1] : 1;
      const kind = cell('s5', 'Kind of work', <span className="lbl">This week</span>, <div className="ad-hb">{by.map(([a, v], __k) => <button key={__k} className="ad-hb-r" data-alr-area={a}><span>{AREAS[a][0]}</span><span className="ad-hb-b"><i style={css(`width:${v / bm * 100}%;background:${AREAS[a][1]}`)} /></span><b>{v}</b></button>)}</div>, <><span>{by.length ? <>{Math.round(by[0][1] / weekN() * 100)}{"% was "}{AREAS[by[0][0]][0].toLowerCase()}</> : 'Nothing in the log this week'}</span><span /></>);
      return <>{band(wk, 1)}{band(<>{keys}{kind}</>)}{band(paperCell())}</>;
    }
    function paperCell() {
      const ids = Object.keys(COVER),
        all = Object.values(COVER).flat(),
        f = all.filter(x => x === 'f').length,
        need = all.filter(x => x !== 'n').length;
      return cell('s12', 'Paperwork by entity', <span className="lbl">{f}{" of "}{need}{" on file"}</span>, <div className="ad-pw"><div className="ad-pw-r hd2"><span />{COVER_K.map(k => lbl(k))}</div>{ids.map((id, __k) => <div key={__k} className="ad-pw-r"><span className="gt-ck"><b>{ENTO[id][1]}</b><span>{ENTO[id][2]}</span></span>{COVER[id].map((x, i) => <button key={i} className={`ad-pt ${x}`} {...attrs(x === 'm' || x === 'd' ? `data-amiss="${id}:${i}"` : '')} title={`${COVER_K[i]} · ${CV[x][0]}`}>{x === 'm' ? 'Missing' : x === 'd' ? 'Draft' : ''}</button>)}</div>)}</div>, <><span className="f-key"><span><i style={css("background:color-mix(in srgb,var(--fg) 30%,transparent)")} />On file</span><span><i style={css("background:color-mix(in srgb,var(--underway) 55%,transparent)")} />Draft</span><span><i className="ad-miss" />Missing</span><span><i className="ad-nn" />Not needed yet</span></span><button data-aadd="">Add a document</button></>);
    }
    const DONE1 = {
      agreement: 'Agreement',
      minutes: 'Minutes',
      filing: 'Filing',
      policy: 'Policy',
      bond: 'Bond',
      report: 'Payout report'
    };
    const DF = [['all', 'All'], ['agreement', 'Agreements'], ['minutes', 'Minutes'], ['filing', 'Filings'], ['policy', 'Policies'], ['bond', 'Bonds'], ['report', 'Reports']];
    function recDocs() {
      const L = DOCS.filter(d => A.df === 'all' || d[2] === A.df).sort((a, b) => b[4] - a[4]);
      const monOf = t => AL ? new Date(t).getUTCFullYear() === new Date(TODAY).getUTCFullYear() ? new Date(t).toLocaleString('en-US', {
        month: 'long',
        timeZone: 'UTC'
      }) : String(new Date(t).getUTCFullYear()) : t >= D(10, 1) ? 'October' : t >= D(9, 1) ? 'September' : 'Earlier this year';
      const docRow = d => <button className="gt-cr ad-dcr" data-aopen={`d:${d[0]}`}>{leaf(d[4])}<span className="gt-ck"><b>{d[1]}</b><span>{ENTO[d[3]][1]}{" · "}{d[6]}{" · "}{d[7]}{" · "}{d[8]}{" pages"}</span></span><span className="ad-dk">{DONE1[d[2]]}</span><span className="gt-st" style={css(`--c:${DSTAT[d[5]][1]}`)}>{DSTAT[d[5]][0]}</span></button>;
      const list = cell('s12', 'Documents', seg('adf', DF, A.df, 'Which documents'), <div className="gt-cl flat"><div className="gt-cr ad-dcr hd2">{lbl('Filed')}{lbl('Document')}{lbl('Kind')}{lbl('Status')}</div>{(() => {
          let last = null;
          return L.map((d, __k) => {
            const k = monOf(d[4]);
            const h = k !== last ? secRow(k, `${L.filter(x => monOf(x[4]) === k).length}`) : '';
            last = k;
            return <Fragment key={__k}>{h}{docRow(d)}</Fragment>;
          });
        })()}{L.length ? '' : <div className="gv-e"><span>Nothing here</span></div>}</div>, <><span>{"The "}{L.length}{" newest · "}{A.df === 'all' ? Object.values(DCOUNT).reduce((a, b) => a + b, 0) : DCOUNT[A.df]}{" on file"}</span><button data-aadd="">Add a document</button></>);
      const mx = Math.max(1, ...Object.values(DCOUNT));
      const kinds = cell('s7', 'On file by kind', <span className="lbl">{Object.values(DCOUNT).reduce((a, b) => a + b, 0)}{" documents"}</span>, <div className="ad-hb">{Object.keys(DCOUNT).map((k, __k) => {
          const dr = DOCS.filter(d => d[2] === k && d[5] === 'draft').length,
            wt = DOCS.filter(d => d[2] === k && d[5] === 'waiting').length,
            done = DCOUNT[k] - dr - wt;
          return <button key={__k} className="ad-hb-r" data-adf={k}><span>{DT[k][0]}</span><span className="ad-hb-b ad-stk"><i style={css(`width:${done / mx * 100}%;background:${DT[k][1]}`)} />{dr ? <i style={css(`width:${dr / mx * 100}%;background:var(--underway)`)} /> : ''}{wt ? <i className="hx" style={css(`width:${wt / mx * 100}%`)} /> : ''}</span><b>{DCOUNT[k]}</b></button>;
        })}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Final or signed</span><span><i style={css("background:var(--underway)")} />Draft</span><span><i className="hx" />Waiting on a signature</span></span><span /></>);
      const miss = Object.entries(COVER).flatMap(([id, c]) => c.map((x, i) => x === 'm' ? [id, i] : null).filter(Boolean));
      const ms = cell('s5', 'Missing', <span className="lbl">{miss.length}{" papers"}</span>, <div className="ad-cl">{miss.map(([id, i], __k) => <button key={__k} className="ad-cr one" data-amiss={`${id}:${i}`}><span className="gt-ck"><b>{COVER_K[i]}</b><span>{ENTO[id][1]}</span></span><span className="lnk3">Add it</span></button>)}{rest()}</div>, <><span>{AL ? miss.length ? `Across ${new Set(miss.map(m => m[0])).size} of ${ENT.length} entities` : 'Nothing marked missing' : 'Both entities are still forming'}</span><button data-atab="overview">Paperwork →</button></>);
      return <>{band(list, 1)}{band(<>{kinds}{ms}</>)}</>;
    }
    function logRow(l) {
      return <button className="ad-lr" data-aopen={`l:${l[0]}`}><span className="mono ad-lt">{hm(l[1])}</span>{sq(l[2])}<span className="gt-ck"><b>{l[4]}</b><span>{l[5]}</span></span><span className="ad-la">{AREAS[l[3]][0]}</span>{resChip(l[7])}</button>;
    }
    const LW = AL ? AL.LW : [['all', 'Everyone'], ['K', 'Kai'], ['DR', 'Dana'], ['ML', 'Marcus'], ['SY', 'System']],

      LR = [['all', 'All'], ['waiting', 'Waiting'], ['approved', 'Approved'], ['alert', 'Alerts']];
    function recLog() {
      const L = LOG.filter(l => (A.lw === 'all' || l[2] === A.lw) && (A.lr === 'all' || l[7] === A.lr) && (!A.la || l[3] === A.la)).sort((a, b) => b[1] - a[1]),
        per = 10,
        pg = L.slice(A.lp * per, A.lp * per + per);
      const dayOf = t => Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate());
      let last = null;
      const rows = pg.map((l, __k) => {
        const d = dayOf(l[1]);
        const n = L.filter(x => dayOf(x[1]) === d).length;
        const h = d !== last ? secRow(`${WD(d)} ${fmtD(d)}${d === TODAY ? ' · today' : ''}`, `${n} key action${n === 1 ? '' : 's'}`) : '';
        last = d;
        return <Fragment key={__k}>{h}{logRow(l)}</Fragment>;
      });
      const list = cell('s12', 'Audit log', <div className="ad-segs">{seg('alw', LW, A.lw, 'Who')}{seg('alr', LR, A.lr, 'Result')}</div>, <div className="ad-ll"><div className="ad-lr hd2">{lbl('Time')}<span />{lbl('Action')}{lbl('Area')}{lbl('Result')}</div>{A.la ? <div className="ad-fl"><span>{"Only "}{AREAS[A.la][0]}</span><button className="lnk3" data-alr-area="">Show everything</button></div> : ''}{rows.length ? rows : <div className="gv-e"><span>Nothing matches</span></div>}</div>, <><span>{ICO.lock}{" Can’t be edited or deleted · kept 7 years"}{AL && AL.CHAIN ? AL.CHAIN.ok ? ` · chain holds, ${AL.CHAIN.entries} entries` : ` · chain broken at #${AL.CHAIN.brokenAt}` : ''}</span>{pager(A.lp, L.length, per, 'alp')}</>);
      return band(list, 1);
    }
    function recReveals() {
      const rv = cell('s7', 'Reveals', <span className="lbl">{AL ? 'Newest first · ' : "This week · "}{REVEALS.length}</span>, <div className="gt-cl">{REVEALS.map(([t, w, m, what, why, where], __k) => <div key={__k} className={`gt-cr ad-rvr ${why ? '' : 'bad'}`}>{leaf(t)}<span className="gt-ck"><b>{pName(w)}{" showed "}{m}{"’s "}{what.toLowerCase()}</b><span className={why ? '' : 'bad'}>{why || 'No reason given'}</span></span><span className="ad-dt"><b>{hm(t)}</b><em>{where}</em></span></div>)}{rest()}</div>, <><span>{ICO.lock}{" Details stay masked until someone reveals them with a reason"}</span><button data-ago="settings/security">Privacy →</button></>);
      const by = (AL ? [...new Set(REVEALS.map(r => r[1]))] : ['K', 'DR']).map(id => [id, REVEALS.filter(r => r[1] === id).length, REVEALS.filter(r => r[1] === id && !r[4]).length]),
        bm = Math.max(1, ...by.map(b => b[1]));
      const KINDS = (AL ? [['Name', r => /name/i.test(r[3])], ['Email', r => /email/i.test(r[3])], ['Phone', r => /phone/i.test(r[3])], ['Address', r => /address/i.test(r[3])]] : [['Email', r => /email/i.test(r[3])], ['Phone', r => /phone/i.test(r[3])], ['Address', r => /address/i.test(r[3])]]).map(([k, f]) => [k, REVEALS.filter(f).length]),
        km = Math.max(1, ...KINDS.map(k => k[1]));
      const rvg = GKEYS.filter(g => GROUPS[g][2][secIx('members')] === 4).map(g => GROUPS[g][0]);
      const bp = cell('s5', 'Who and what', <span className="lbl">{AL ? rvg.length ? `Only ${rvg.join(' and ')} can` : 'Approve on the section' : 'Only Admin and Protocol can'}</span>, <>{secRow('Who revealed', `${REVEALS.length} ${AL ? 'in all' : 'this week'}`)}
<div className="ad-hb ad-up">{by.map(([id, n, bad], __k) => <div key={__k} className="ad-hb-r"><span>{pName(id)}</span><span className="ad-hb-b ad-stk"><i style={css(`width:${(n - bad) / bm * 100}%`)} />{bad ? <i style={css(`width:${bad / bm * 100}%;background:var(--absent)`)} /> : ''}</span><b>{n}</b></div>)}</div>{secRow('What was shown', `${REVEALS.filter(r => r[5] === 'Members').length} members · ${REVEALS.filter(r => r[5] === 'Merchants').length} shop owners`)}<div className="ad-hb ad-up">{KINDS.map(([k, n], __k) => <div key={__k} className="ad-hb-r"><span>{k}</span><span className="ad-hb-b"><i style={css(`width:${n / km * 100}%;background:color-mix(in srgb,var(--fg) 45%,transparent)`)} /></span><b>{n}</b></div>)}</div>{rest()}</>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />With a reason</span><span><i style={css("background:var(--absent)")} />Without</span></span><span /></>);
      const ESt = {
        done: ['Done', 'var(--fg)'],
        approved: ['Approved', 'var(--settled)'],
        waiting: ['Waiting', 'var(--underway)'],
        // live only: an approved export its asker didn't use within its day
        lapsed: ['Lapsed', 'var(--line)']
      };
      const ex = cell('s12', 'Exports', <span className="lbl">Every list that left the app</span>, <div className="ad-xl"><div className="ad-xr hd2"><span />{lbl('List')}{lbl('Rows')}{lbl('Second person')}{lbl('Status')}</div>{EXPORTS.slice().sort((a, b) => b[0] - a[0]).map(([t, w, what, n, ok, st, note], __k) => <div key={__k} className={`ad-xr ${st === 'waiting' ? 'pend' : ''}`}>{leaf(t)}<span className="gt-ck"><b>{what}</b><span>{pName(w)}{" · "}{hm(t)}</span></span><b className="num">{int(n)}</b><span className="ad-xo">{ok ? <>{sq(ok)}<em>{pName(ok)}</em></> : <em>{note}</em>}</span><span className="gt-st" style={css(`--c:${ESt[st][1]}`)}>{ESt[st][0]}</span></div>)}</div>, <><span>{AL ? 'A whole list needs a second person · its asker can use it once, within a day' : 'Lists with names, emails or phone numbers need a second person'}</span><button data-ago="settings/rules">The rule →</button></>);
      return <>{band(<>{rv}{bp}</>, 1)}{band(ex)}</>;
    }

    /* ══ Panels ═══════════════════════════════════════════════════════════════════════════════════════════════════════ */
    function ensurePanel() {
      let pn = document.getElementById('apanel');
      if (!pn) {
        const sc2 = document.createElement('div');
        sc2.id = 'ascrim';
        sc2.className = 'scrim';
        document.body.appendChild(sc2);
        pn = document.createElement('aside');
        pn.id = 'apanel';
        pn.className = 'panel apanel';
        document.body.appendChild(pn);
      }
      return pn;
    }
    const phd = k => <div className="pn-hd"><span className="lbl">{k}</span><button className="x" data-aclose="" aria-label="Close">{ICO.x}</button></div>;
    const ro = () => CAN_ACT() ? '' : 'disabled';
    const foot = btns => <div className="pn-ft">{CAN_ACT() ? btns : <><span className="small quiet" style={css("margin-right:auto")}>Read-only</span><button className="btn" data-aclose="">Close</button></>}</div>;
    function renderPanel() {
      const pn = ensurePanel(),
        P = A.panel;
      if (!P) {
        document.body.classList.remove('pn');
        return;
      }
      const i = P.indexOf(':'),
        k = P.slice(0, i),
        id = P.slice(i + 1);
      const fn = {
        p: personPanel,
        i: invitePanel,
        g: groupPanel,
        r: rulePanel,
        s: setPanel,
        c: connPanel,
        d: docPanel,
        l: logPanel
      }[k];
      if (!fn) {
        A.panel = null;
        return;
      }
      // live, what a panel was opened on can go (someone turned off, a change approved): it closes
      const has = AL && {
        p: () => PPL[id],
        i: () => INVITES.find(x => x.id === id),
        g: () => GROUPS[id],
        r: () => RULES.find(x => x.id === id),
        s: () => SETO[id],
        c: () => CONN.find(x => x.id === id),
        d: () => DOCS.find(x => x[0] === id),
        l: () => LOG.find(x => x[0] === id)
      }[k];
      if (has && !has()) {
        A.panel = null;
        document.body.classList.remove('pn');
        return;
      }
      document.body.classList.add('pn');
      html(pn, fn(id));
    }
    function personPanel(id) {
      const p = PPL[id],
        G = GROUPS[p.g];
      const can = SECS.map(([k, t], i) => [t, G[2][i]]).filter(x => x[1] >= 3);
      return <>{phd(`Team · ${G[0]}`)}<div className="pn-b"><div className="ad-ph">{sq(p.id, 'lg')}<div><p className="bpn-t">{p.n}</p><p className="bpn-s">{p.title}{" · "}<span className="mono">{p.email}</span></p></div></div><div className="led">{[['Group', `${G[0]} · ${G[1]}`], ['Sign-in', p.passkey ? 'Passkey' : AL ? 'Emailed code' : 'Emailed code · read-only'], ['Signer in the Ops Safe', AL && !AL.SAFE ? 'The Ops Safe isn’t read yet' : p.signer ? 'Yes' : 'No'], ['On the team since', fmtD(p.since)], ['Last active', ago(p.last)], ...(p.until ? [['Access ends', fmtD(p.until)]] : [])].map(([a, b], __k) => <div key={__k}><span>{a}</span><b>{b}</b></div>)}</div><div>{lbl('Their level on each page')}<div className="ad-lvs">{SECS.map(([k, t], i) => <span key={i} title={`${t} · ${LV[G[2][i]][0]}`}>{lvSq(G[2][i])}<em>{SHORT[k]}</em></span>)}</div><p className="bpn-n">{can.length ? `Can propose or approve on ${can.map(x => x[0]).join(', ')}.` : 'Read-only everywhere.'}{AL && p.g.startsWith('~') ? ' These levels are set for them alone.' : <>{" Levels come from the group, so changing them changes everyone in "}{G[0]}.</>}</p></div><div>{lbl(`Devices · ${p.dev.length}`)}<div className="led">{p.dev.map((d, i) => <div key={i}><span>{d[0]}{d[2] ? '' : ' · not trusted'}</span><b>{ago(d[1])}{CAN_ACT() && !AL ? <>{" · "}<button className="lnk3" data-asignout={`${p.id}:${i}`}>Sign out</button></> : ''}</b></div>)}</div></div>{CAN_ACT() ? <div>{lbl('Move to another group')}<div className="ad-mv"><select className="vin" id="agsel" defaultValue={p.g}>{GKEYS.map((g, __k) => <option key={__k} value={g}>{GROUPS[g][0]}</option>)}</select><button className="btn sm-b" data-achg={p.id}>Propose</button></div></div> : ''}<button className="lnk3 ad-out" data-alog={p.id}>Their actions in the audit log →</button></div>{foot(<>{AL && p.id !== A.me ? <button className="btn" data-asignall={p.id}>Sign out everywhere</button> : ''}{p.id !== A.me ? <button className="btn" data-aoff={p.id}>Turn off access</button> : ''}<button className="btn p" data-aclose="">Done</button></>)}</>;
    }
    function invitePanel(id) {
      const v = INVITES.find(x => x.id === id),
        G = GROUPS[v.g];
      return <>{phd('Invite')}<div className="pn-b"><div className="ad-ph">{sq(v.id, 'lg dash')}<div><p className="bpn-t">{v.n}</p><p className="bpn-s">{v.title}{" · "}<span className="mono">{v.email}</span></p></div></div><div className="ad-tl">{(AL ? [['Invited', fmtD(v.sent), 1], [`${v.n.split(/[ @]/)[0]} accepts and signs in`, `by ${fmtD(v.exp)}`, 0]] : [['Kai invited them', fmtD(v.sent), 1], ['Dana Ruiz approved it', fmtD(v.sent), 1], [`${v.n.split(' ')[0]} accepts and sets a passkey`, `by ${fmtD(v.exp)}`, 0], ['A device is confirmed', 'after that', 0]]).map(([a, b, d], __k) => <div key={__k} className={d ? 'done' : 'next'}><i /><span><b>{a}</b><em>{b}</em></span></div>)}</div><div className="led">{[['Group', G[0]], ['Expires', `${fmtD(v.exp)} · ${Math.round((v.exp - TODAY) / DAY)} days`]].map(([a, b], __k) => <div key={__k}><span>{a}</span><b>{b}</b></div>)}</div><p className="bpn-n">{"Until they accept, the invite shows what "}{G[0]}{" can do but grants nothing."}</p></div>{foot(<>{AL ? '' : <button className="btn" data-acancel={v.id}>Cancel the invite</button>}<button className="btn p" data-aresend={v.id}>Resend it</button></>)}</>;
    }
    function groupPanel(g) {
      const G = GROUPS[g];
      if (!A.gd || A.gd.g !== g) A.gd = {
        g,
        lv: [...G[2]]
      };
      const d = A.gd,
        changed = d.lv.some((v, i) => v !== G[2][i]),
        ppl = PEOPLE.filter(p => p.g === g);
      return <>{phd(g === 'members' ? 'Every member' : 'Group')}<div className="pn-b"><div><p className="bpn-t">{G[0]}</p><p className="bpn-s">{G[1]}{g === 'members' ? ` · ${MEMBERS_N} members` : ppl.length ? ` · ${ppl.map(p => p.n).join(', ')}` : ''}</p></div><div className="ad-ge">{SEC_GROUP.map(([gn, a, b], __k) => <div key={__k} className="ad-geg">{lbl(gn)}{SECS.slice(a, b + 1).map(([k, t], j) => {
                const i = a + j;
                return <div key={j} className={`ad-ger ${d.lv[i] !== G[2][i] ? 'chg' : ''}`}><span>{t}</span><div className="ad-lvp" role="group" aria-label={t}>{LV.map(([n], v) => <button key={v} data-agl={`${i}:${v}`} aria-pressed={d.lv[i] === v} title={n} {...attrs(ro())} {...attrs(g === 'members' && v > 2 ? 'disabled' : '')}>{lvSq(v)}</button>)}</div><em>{LV[d.lv[i]][0]}</em></div>;
              })}</div>)}</div><p className="bpn-n">{g === 'members' ? 'Members never go above See: they act in the Clear app, not here.' : AL ? 'It applies to everyone in the group: at once, or once a second admin approves it if it gives Approve somewhere new.' : 'A change applies to everyone in the group once a second person approves it.'}</p></div>{foot(<><button className="btn" data-agreset="" {...attrs(changed ? '' : 'disabled')}>Undo</button><button className="btn p" data-agprop={g} {...attrs(changed ? '' : 'disabled')}>Propose the change</button></>)}</>;
    }
    function rulePanel(id) {
      const r = RULES.find(x => x.id === id),
        s = SETO[r.set],
        p = pendOf(r.set);
      return <>{phd('Two-person rule')}<><div className="pn-b"><div><p className="bpn-t">{r.t}</p><p className="bpn-s">{r.c}</p></div><div className="ad-big"><span><b>{ruleNum(r)}</b><em>{s ? s.kind === 'lock' ? s.why : 'Set in Settings' : 'Every change, always'}</em></span>{p ? <span className="ad-pd">{fmtV(s, p.to)}{" waiting on "}{pName(p.need)}</span> : ''}</div><div>{lbl('Who can be the second person')}<div className="led">{r.who.map((id, __k) => <div key={__k}><span>{sq(id)}{" "}{pName(id)}</span><b>{GROUPS[PPL[id].g][0]}</b></div>)}</div></div><div className="led">{[['Last 30 days', `${r.n30} approvals`], ['Usual wait', r.med ? `${r.med.toFixed(1)} hours` : 'None yet'], ['Approved their own', 'Never · the app won’t allow it']].map(([a, b], __k) => <div key={__k}><span>{a}</span><b>{b}</b></div>)}</div></div><div className="pn-ft">{s && s.kind !== 'lock' ? <button className="btn" data-aopen={`s:${s.id}`}>Change the number</button> : ''}<button className="btn p" data-aclose="">Done</button></div></></>;
    }
    function setPanel(id) {
      const s = SETO[id],
        p = pendOf(id),
        lock = s.kind === 'lock',
        hist = SET_HIST.filter(h => h[2] === id);
      const input = s.kind === 'on' ? <div className="seg sm" role="group">{[[1, 'On'], [0, 'Off']].map(([v, t], __k) => <button key={__k} data-asv={v} aria-pressed={(A.sv ?? s.v) == v} {...attrs(ro())}>{t}</button>)}</div> : s.kind === 'choice' ? <select className="vin" id="asnew" defaultValue={s.v} {...attrs(ro())}>{s.opts.map((o, __k) => <option key={__k}>{o}</option>)}</select> : <><input className="vin ad-in" id="asnew" inputMode="decimal" defaultValue={s.v} {...attrs(ro())} /><span className="ad-u">{s.kind === 'money' ? 'dollars' : s.kind === 'pct' ? 'percent' : s.kind === 'hours' ? 'hours' : s.kind === 'days' ? 'days' : unitOf(s)}</span></>;
      return <>{phd(`Settings · ${SEC_T[s.sec][0]}`)}<div className="pn-b"><div><p className="bpn-t">{s.t}</p><p className="bpn-s">{s.d}</p></div><div className="ad-big"><span><b>{lock ? ICO.lock : ''}{fmtV(s)}</b><em>{lock ? s.why : AL && s.enforced === false ? 'Now · stored, nothing enforces it yet' : `Now · used in ${usedTxt(s)}`}</em></span></div>{p ? <div className="ad-pc"><div className="ad-pc-h">{lbl(AL ? 'Change · waiting' : `Change ${p.id} · waiting`)}<span className="gt-st" style={css("--c:var(--underway)")}>{"On "}{onWho(p.need, 1)}</span></div><p><b>{fmtV(s, p.from)}{" → "}{fmtV(s, p.to)}</b>{" · "}{p.by === A.me && AL ? 'You' : pName(p.by)}{" proposed "}{ago(p.at)}</p>{AL && !p.why ? '' : <p className="bpn-n">“{p.why}”</p>}{AL ? <p className="bpn-n">{p.by === A.me ? 'You proposed it, so someone else has to approve it.' : p.need === A.me ? 'You can be the second person.' : 'It needs someone at Approve on Settings.'}</p> : ''}</div> : ''}{lock ? <p className="bpn-n">{"This one isn’t set here. "}{s.where.startsWith('governance') ? 'It changes with a proposal in Governance.' : s.where.startsWith('team') ? 'It follows the Members column in Team.' : 'The policy is in Records.'}</p> : !p ? <div>{lbl('Change it to')}<div className="ad-ni">{input}</div><label className="ad-why">{lbl('Why')}<textarea className="vin" id="aswhy" rows="2" placeholder="Shown to the second person and kept in the log" {...attrs(ro())} /></label></div> : ''}{hist.length ? <div>{lbl('Before')}<div className="led">{hist.map(([hid, t,, a, b, by, ok], __k) => <div key={__k}><span>{fmtD(t)}{" · "}{a}{" → "}{b}</span><b>{pName(by).split(' ')[0]}{", approved by "}{pName(ok).split(' ')[0]}</b></div>)}</div></div> : ''}</div>{lock ? <div className="pn-ft">{s.where ? <button className="btn" data-ago={s.where}>{s.where.startsWith('governance') ? 'Governance' : s.where.startsWith('team') ? 'Team' : 'Records'}{" →"}</button> : ''}<button className="btn p" data-aclose="">Done</button></div> : p ? foot(p.need === A.me ? <><button className="btn" data-adecline={p.id}>Decline</button><button className="btn p" data-aapprove={p.id}>Approve</button></> : p.by === A.me ? <><button className="btn" data-awithdraw={p.id}>Withdraw</button><button className="btn p" data-aclose="">Done</button></> : <button className="btn p" data-aclose="">Done</button>) : foot(<><button className="btn" data-aclose="">Cancel</button><button className="btn p" data-apropose={s.id}>Propose the change</button></>)}</>;
    }
    function connPanel(id) {
      const c = CONN.find(x => x.id === id);
      return <>{phd(`Connection · ${CST(c)[0]}`)}<div className="pn-b"><div><p className="bpn-t">{c.n}</p><p className="bpn-s">{c.what}{" · "}{c.note}</p></div><div>{lbl('Last 24 hours')}{connHrs(c, true)}<div className="ad-hr-x"><span>24 h ago</span><span>Now</span></div></div><div className="led">{(AL ? [['Used in', usedTxt(c) || '—'], ['Status', c.note], ['Key', keyTxt(c)], ['Last heard', c.last ? `${fmtD(c.last)}, ${hm(c.last)}` : 'Not yet']] : [['Used in', usedTxt(c)], ['Connected by', pName(c.by)], ['Key', c.rot ? `${keyTxt(c)} · ${c.rot} days old` : keyTxt(c)], ['Last heard', `${fmtD(c.last)}, ${hm(c.last)}`]]).map(([a, b], __k) => <div key={__k}><span>{a}</span><b>{b}</b></div>)}</div>{c.st === 'behind' ? <p className="bpn-w"><b>{c.note}.</b>{AL ? ' What it feeds is as old as its last sync until it catches up.' : " Balances on Money may be up to 3 hours old until it catches up."}</p> : ''}<p className="bpn-n">{AL ? 'Its keys are set on the server and never shown here.' : 'Swapping a key or disconnecting needs a second person. The old key keeps working until they approve.'}</p></div>{foot(<>{c.rot ? <button className="btn" data-arotate={c.id}>Swap the key</button> : ''}<button className="btn p" data-async={c.id}>{c.idle ? 'Wake it' : 'Check now'}</button></>)}</>;
    }
    function docPanel(id) {
      const d = DOCS.find(x => x[0] === id);
      return <>{phd(`Records · ${DONE1[d[2]]}`)}<><div className="pn-b"><div><p className="bpn-t">{d[1]}</p><p className="bpn-s">{DSTAT[d[5]][0]}{" · "}{d[6]}</p></div><div className="led">{[['Entity', ENTO[d[3]][1]], ['Date', fmtD(d[4])], ['By', d[7]], ['Pages', d[8]], ['Kept until', `${fmtD(d[4]).replace(/\d{4}/, '')} ${new Date(d[4]).getUTCFullYear() + 7}`]].map(([a, b], __k) => <div key={__k}><span>{a}</span><b>{b}</b></div>)}</div>{d[9] ? <p className="bpn-n">This is the filed copy. Versions, redlines and who signed which one are in Governance.</p> : ''}{d[5] === 'waiting' ? AL ? <p className="bpn-w"><b>Waiting on a signature.</b></p> : <p className="bpn-w"><b>Waiting on Inland Cycle Works’ signature.</b>{" It files itself here once they sign."}</p> : ''}</div><div className="pn-ft">{d[9] ? <button className="btn" data-aout="Governance">Versions in Governance →</button> : ''}{AL && CAN_ACT() ? <><button className="btn" data-ashare={d[0]}>Share a link</button><button className="btn" data-aversion={d[0]}>New version</button></> : ''}<button className="btn p" data-adl={d[0]}>Download</button></div></></>;
    }
    function logPanel(id) {
      const l = LOG.find(x => x[0] === id);
      return <>{phd(`Audit log · ${AREAS[l[3]][0]}`)}<><div className="pn-b"><div><p className="bpn-t">{l[4]}</p><p className="bpn-s">{l[5]}</p></div><div className="led">{[['Who', pName(l[2])], ['When', `${WD(l[1])} ${fmtD(l[1])}, ${hm(l[1])}`], ['From', l[6]], ['Result', RESULT[l[7]][0]], ...(l[8] ? [['Second person', l[8]]] : []), ...(AL ? entRows(id) : [['Entry', `#${id} · chained to the one before`]])].map(([a, b], __k) => <div key={__k}><span>{a}</span><b>{b}</b></div>)}</div>{AL && CAN_ACT() ? <label className="ad-why">{lbl('What was wrong, and what’s right')}<textarea className="vin" id="acnote" rows="2" placeholder="Kept as a new entry that points back to this one" /></label> : ''}<p className="bpn-n">{ICO.lock}{" Entries can’t be edited or deleted. A correction is a new entry that points back to this one."}</p></div><div className="pn-ft">{AL && CAN_ACT() ? <button className="btn" data-acorrect={id}>Correct it</button> : ''}<button className="btn p" data-aclose="">Done</button></div></></>;
    }
    /** Live, an entry's place in the chain: its seq and hash, the one before, and what it corrects. */
    function entRows(id) {
      const e = AL.ENTRY[id];
      if (!e) return [];
      const c = e.corrects != null ? AL.ENTRY[String(e.corrects)] : null;
      return [['Entry', `#${e.seq} · ${e.hash.slice(0, 12)}`], ['Chained to', e.prev ? `#${e.seq - 1} · ${e.prev.slice(0, 12)}` : 'Nothing: it’s the first'], ...(e.corrects != null ? [['Corrects', c ? `#${c.seq}` : `Entry ${e.corrects}`]] : []), ...(AL.CHAIN ? [['The chain', AL.CHAIN.ok ? `Holds · ${AL.CHAIN.entries} entries` : `Broken at #${AL.CHAIN.brokenAt}`]] : [])];
    }


    /* ══ render + events ══════════════════════════════════════════════════════════════════════════════════════════════ */
    let loaded = false;
    function render() {
      if (!LIVE()) return;
      if (AL) {
        AL.fill();
        // the first draw fetches the log, the reveals, Settings and what's waiting, then draws again
        if (!loaded) {
          loaded = true;
          AL.load().then(() => render(), () => undefined);
        }
      }
      sync();
      W.classList.toggle('ro', !CAN_ACT());
      W.classList.toggle('tot', TOT());
      renderHdr();
      const T = A.tab[A.page];
      html(document.getElementById('av'), {
        team: {
          overview: teamOverview,
          people: teamPeople,
          groups: teamGroups,
          rule: teamRule
        },
        settings: {
          rules: setRules,
          security: setSecurity,
          connections: setConnections,
          org: setOrg
        },
        records: {
          overview: recOverview,
          docs: recDocs,
          log: recLog,
          reveals: recReveals
        }
      }[A.page][T]());
      renderPanel();
      syncNav();
      fitRest();
      if (TOT()) CC.scrub(W);
      setHash();
    }
    function sync() {
      const k = meKey();
      if (k !== A.me) {
        A.me = k;
        closeA();
      }
    }
    function fitRest() {
      document.querySelectorAll('.ad-rest').forEach(r => {
        r.classList.remove('thin');
        if (r.getBoundingClientRect().height < 12) r.classList.add('thin');
      });
    }
    window.addEventListener('resize', () => {
      clearTimeout(fitRest.t);
      fitRest.t = setTimeout(fitRest, 120);
    });
    function syncNav() {
      return;
      document.querySelectorAll('.nav[data-apage]').forEach(b => {
        if (b.dataset.apage === A.page) b.setAttribute('aria-current', 'page');else b.removeAttribute('aria-current');
      });
    }
    const closeA = () => {
      A.panel = null;
      A.gd = null;
      A.sv = undefined;
    };
    const logIt = (what, detail, res, area = 'team') => {
      LOG.unshift(['x' + Date.now(), NOW + LOG.length % 7 * 60e3, A.me, area, what, detail, A.me === 'K' ? 'Mac · Redlands' : 'Laptop · Riverside', res, res === 'waiting' ? 'Needs a second person' : '']);
    };
    function goIn(path) {
      const [pg, rest2] = path.split('/'),
        [tab, op] = (rest2 || '').split(':');
      if (!TABS[pg]) return goOut(path);
      closeA();
      if (tab && TABS[pg].some(t => t[0] === tab)) A.tab[pg] = tab;
      if (op) {
        if (pg === 'records' && tab === 'docs') A.panel = 'd:' + op;
        if (pg === 'settings') A.panel = 's:' + op;
      }
      if (A.page === pg) {
        render();
        window.scrollTo({
          top: 0
        });
        return;
      }
      CC.go(pg);
    }
    document.addEventListener('click', e => {
      if (e.target.id === 'ascrim') {
        closeA();
        return render();
      }
      const t = e.target.closest('button,a,[data-atab],[data-aopen]');
      if (!t) return;
      const d = t.dataset;
      if (AL && liveAct(d)) return;
      if (d.apage) {
        closeA();
        A.page = d.apage;
        render();
        window.scrollTo({
          top: 0
        });
        return;
      }
      if (d.atab) {
        closeA();
        A.tab[A.page] = d.atab;
        A.lp = 0;
        render();
        window.scrollTo({
          top: 0
        });
        return;
      }
      if (d.ago) return goIn(d.ago);
      if (d.aout) {
        closeA();
        return goOut(d.aout.toLowerCase());
      }
      if (d.aopen) {
        const k = d.aopen.split(':')[0];
        if (A.panel !== d.aopen) {
          A.gd = null;
          A.sv = undefined;
        }
        A.panel = d.aopen;
        if (k === 'i' || k === 'p' || k === 'g' || k === 'r') {
          if (A.page !== 'team') return CC.go('team');
        }
        if (k === 's' && A.page !== 'settings') {
          A.page = 'settings';
          A.tab.settings = ['signin', 'privacy'].includes((SETO[d.aopen.slice(2)] || {}).sec) ? 'security' : ['records', 'notify'].includes((SETO[d.aopen.slice(2)] || {}).sec) ? 'org' : 'rules';
          return CC.go('settings');
        }
        return renderPanel();
      }
      if (d.aclose !== undefined) {
        closeA();
        return render();
      }
      if (d.alog) {
        closeA();
        A.tab.records = 'log';
        A.lw = d.alog;
        A.lr = 'all';
        A.la = null;
        A.lp = 0;
        if (A.page === 'records') {
          render();
          return;
        }
        return CC.go('records');
      }
      if (d.alrArea !== undefined) {
        closeA();
        A.tab.records = 'log';
        A.la = d.alrArea || null;
        A.lw = 'all';
        A.lr = 'all';
        A.lp = 0;
        if (A.page === 'records') {
          render();
          return;
        }
        return CC.go('records');
      }
      if (d.alw) {
        A.lw = d.alw;
        A.lp = 0;
        return render();
      }
      if (d.alr) {
        A.lr = d.alr;
        A.lp = 0;
        return render();
      }
      if (d.alp) {
        A.lp = Math.max(0, A.lp + +d.alp);
        return render();
      }
      if (d.adf) {
        A.df = d.adf;
        if (A.tab.records !== 'docs') {
          A.tab.records = 'docs';
        }
        return render();
      }
      if (d.adocEnt) {
        closeA();
        A.tab.records = 'overview';
        if (A.page !== 'records') CC.go('records');else render();
        const el = document.querySelector('.ad-pw');
        if (el) el.scrollIntoView({
          block: 'center'
        });
        return;
      }
      if (d.amiss) {
        const [id, i] = d.amiss.split(':');
        return toast(`Add the ${COVER_K[+i].toLowerCase()} for ${ENTO[id][1]} · it files under ${ENT_SH[id]}`);
      }
      if (d.aadd !== undefined) return toast('Opens an upload: pick the entity and kind, and it files with today’s date');
      if (d.ainvite !== undefined) return toast('Opens an invite: name, email and group · it needs a second person');
      if (d.agl) {
        const [i, v] = d.agl.split(':').map(Number);
        A.gd.lv[i] = v;
        return renderPanel();
      }
      if (d.agreset !== undefined) {
        A.gd = null;
        return renderPanel();
      }
      if (d.agprop) {
        const g = d.agprop,
          ch = A.gd.lv.map((v, i) => [i, v]).filter(([i, v]) => v !== GROUPS[g][2][i]);
        logIt(`Proposed changing ${GROUPS[g][0]}`, ch.map(([i, v]) => `${SECS[i][1]}: ${LV[GROUPS[g][2][i]][0]} → ${LV[v][0]}`).join(' · '), 'waiting');
        WAITING.push([`${GROUPS[g][0]} · ${ch.length} page${ch.length > 1 ? 's' : ''}`, 'Team', A.me, second(), 0, 3.0, 'access']);
        closeA();
        render();
        return toast(`Proposed · ${GROUPS[g][0]} changes once ${pName(second())} approves · logged in Records`);
      }
      if (d.achg) {
        const p = PPL[d.achg],
          g = document.getElementById('agsel').value;
        if (g === p.g) return toast('Pick a different group');
        logIt(`Proposed moving ${p.n} to ${GROUPS[g][0]}`, `From ${GROUPS[p.g][0]}.`, 'waiting');
        closeA();
        render();
        return toast(`Proposed · ${p.n} moves to ${GROUPS[g][0]} once ${pName(second())} approves`);
      }
      if (d.aoff) {
        const p = PPL[d.aoff];
        logIt(`Proposed turning off ${p.n}`, 'Their sessions end once approved.', 'waiting');
        closeA();
        render();
        return toast(`Proposed · ${p.n}’s access turns off once ${pName(second())} approves`);
      }
      if (d.asignout) {
        const [id, i] = d.asignout.split(':'),
          p = PPL[id],
          dv = p.dev[+i];
        p.dev.splice(+i, 1);
        logIt(`Signed out ${p.n}’s ${dv[0]}`, 'The session ended right away.', 'done');
        render();
        return toast(`Signed out · ${dv[0]} · logged in Records`);
      }
      if (d.aresend) return toast('Resent · the link works for 7 more days');
      if (d.acancel) {
        logIt(`Cancelled ${INVITES[0].n}’s invite`, 'Nothing was granted.', 'done');
        INVITES.splice(0, 1);
        closeA();
        render();
        return toast('Invite cancelled · logged in Records');
      }
      if (d.asv !== undefined) {
        A.sv = +d.asv;
        return renderPanel();
      }
      if (d.apropose) {
        const s = SETO[d.apropose],
          el = document.getElementById('asnew'),
          why = (document.getElementById('aswhy') || {}).value || '';
        let v = s.kind === 'on' ? A.sv ?? s.v : s.kind === 'choice' ? el.value : parseFloat(el.value);
        if (s.kind !== 'choice' && s.kind !== 'on' && (isNaN(v) || v < 0)) return toast('Enter a number');
        if (v === s.v) return toast('That’s what it is now');
        if (!why.trim()) return toast('Add a reason · the second person sees it');
        const id = 'C-0' + (8 + SET_HIST.length - 5 + PEND.length),
          need = second();
        PEND.push({
          id,
          set: s.id,
          from: s.v,
          to: v,
          by: A.me,
          at: NOW,
          why,
          need
        });
        logIt(`Proposed ${s.t.toLowerCase()} ${fmtV(s, v)}`, `Setting ${id} · from ${fmtV(s)}. ${why}`, 'waiting');
        WAITING.push([`${s.t} · ${fmtV(s, v)}`, 'Settings', A.me, need, 0, 6.5, 'settings']);
        render();
        return toast(`Proposed · ${s.t.toLowerCase()} becomes ${fmtV(s, v)} once ${pName(need)} approves · logged in Records`);
      }
      if (d.aapprove) {
        const p = PEND.find(x => x.id === d.aapprove),
          s = SETO[p.set];
        SET_HIST.unshift([p.id, NOW, p.set, fmtV(s, p.from), fmtV(s, p.to), p.by, A.me]);
        s.v = p.to;
        PEND.splice(PEND.indexOf(p), 1);
        const w = WAITING.findIndex(x => x[1] === 'Settings');
        if (w >= 0) WAITING.splice(w, 1);
        logIt(`Approved ${p.id} · ${s.t} ${fmtV(s)}`, `${pName(p.by)} proposed.`, 'approved');
        render();
        return toast(`Approved · ${s.t} ${fmtV(s)} · in use on ${usedTxt(s)} now`);
      }
      if (d.adecline || d.awithdraw) {
        const p = PEND.find(x => x.id === (d.adecline || d.awithdraw)),
          s = SETO[p.set];
        PEND.splice(PEND.indexOf(p), 1);
        const w = WAITING.findIndex(x => x[1] === 'Settings');
        if (w >= 0) WAITING.splice(w, 1);
        logIt(`${d.adecline ? 'Declined' : 'Withdrew'} ${p.id} · ${s.t.toLowerCase()}`, `Stays at ${fmtV(s)}.`, 'done');
        render();
        return toast(`${d.adecline ? 'Declined' : 'Withdrawn'} · ${s.t} stays ${fmtV(s)}`);
      }
      if (d.async) {
        const c = CONN.find(x => x.id === d.async);
        return toast(c.st === 'behind' ? `${c.n} is catching up · 9 of 12 links now` : `${c.n} answered in 0.4 seconds`);
      }
      if (d.arotate) {
        const c = CONN.find(x => x.id === d.arotate);
        logIt(`Proposed swapping the ${c.n} key`, `••••${c.key} is ${c.rot} days old.`, 'waiting');
        return toast(`Proposed · the new ${c.n} key goes live once ${pName(second())} approves`);
      }
      if (d.adl) {
        const doc = DOCS.find(x => x[0] === d.adl);
        logIt(`Downloaded ${doc[1]}`, `${doc[6]} · ${doc[8]} pages`, 'done', 'gov');
        return toast('Downloaded · logged in Records');
      }
    });
    /* ── live: the page's actions, through the API (adminLive.ts's adminApi and the old pages' flows) ─────────────────── */
    /** Loads what changed (the team, or what's waiting), then this page's data, and draws it. */
    async function refresh(team) {
      if (team) await loadTeam().catch(() => undefined);else await loadWaiting().catch(() => undefined);
      await AL.load().catch(() => undefined);
      render();
    }
    /** Sends a change; on its answer, says what happened (a proposal waits for a second person), closes the panel unless kept, and loads again. */
    function send(pr, msg, team, keep) {
      pr.then(r => {
        toast(typeof msg === 'function' ? msg(r || {}) : msg);
        if (!keep) closeA();
        return refresh(team);
      }, e => toast(e.message));
      return true;
    }
    const waits = (r, then, now) => r.proposal ? `Sent for a second admin · ${then}` : now;
    function liveAct(d) {
      const ro = () => (toast('You can see this but not change it'), true);
      if (d.ainvite !== undefined) {
        if (!CAN_ACT()) return ro();
        openTFlow('invite');
        return true;
      }
      if (d.aadd !== undefined || d.amiss) {
        if (RO() || lvlOf(A.me, 'records') < 3) return ro();
        openRFlow('upload');
        return true;
      }
      if (d.ashare) return openRFlow('share', d.ashare), true;
      if (d.aversion) return openRFlow('version', d.aversion), true;
      if (d.adl) {
        const doc = DOCS.find(x => x[0] === d.adl);
        saveDownload(`/documents/${d.adl}/file`, doc ? doc[1] : 'Document').then(() => (toast('Downloaded · logged in Records'), refresh()), e => toast(e.message));
        return true;
      }
      if (d.agprop) {
        const g = d.agprop;
        return send(adminApi.group(g, A.gd.lv.slice()), r => waits(r, `${GROUPS[g][0]} changes once they approve`, `${GROUPS[g][0]} changed · logged in Records`), 1);
      }
      if (d.achg) {
        const p = PPL[d.achg],
          g = document.getElementById('agsel').value;
        if (g === p.g) return toast('Pick a different group'), true;
        return send(adminApi.access(p.uid, {
          group: g
        }), r => waits(r, `${p.n} moves to ${GROUPS[g][0]} once they approve`, `${p.n} is in ${GROUPS[g][0]} now · logged in Records`), 1);
      }
      if (d.aoff) {
        const p = PPL[d.aoff];
        return send(adminApi.access(p.uid, {
          off: true
        }), r => waits(r, `${p.n}’s access turns off once they approve`, `${p.n}’s access is off · logged in Records`), 1);
      }
      if (d.asignall) {
        const p = PPL[d.asignall];
        return send(adminApi.signOut(p.uid), r => `Signed ${p.n} out everywhere · ${r.ended ?? 0} session${r.ended === 1 ? '' : 's'} ended · logged in Records`, 1);
      }
      if (d.aresend) {
        const v = INVITES.find(x => x.id === d.aresend);
        return send(adminApi.resend(v.uid), 'Sent again · the link works for 7 days', 1);
      }
      // no API yet: cancelling an invite, signing out one device, swapping a key (hidden live; docs/ui-redesign-plan.md)
      if (d.acancel || d.asignout || d.arotate) return true;
      if (d.apropose) {
        const s = SETO[d.apropose],
          el = document.getElementById('asnew'),
          why = ((document.getElementById('aswhy') || {}).value || '').trim();
        const v = s.kind === 'on' ? A.sv ?? s.v : s.kind === 'choice' ? el.value : parseFloat(el.value);
        if (s.kind !== 'choice' && s.kind !== 'on' && (isNaN(v) || v < 0)) return toast('Enter a number'), true;
        if (v === s.v) return toast('That’s what it is now'), true;
        if (!why) return toast('Add a reason · the second person sees it'), true;
        return send(adminApi.setting(s.id, s.kind === 'on' ? !!v : v, why), () => `Proposed · ${s.t.toLowerCase()} becomes ${fmtV(s, v)} once someone else approves · logged in Records`, 0, 1);
      }
      if (d.aapprove) {
        const p = PEND.find(x => x.id === d.aapprove),
          s = SETO[p.set];
        return send(adminApi.settle(p.id, 'approve'), () => `Approved · ${s.t} is ${fmtV(s, p.to)} now · logged in Records`, 0, 1);
      }
      if (d.adecline || d.awithdraw) {
        const p = PEND.find(x => x.id === (d.adecline || d.awithdraw)),
          s = SETO[p.set];
        return send(adminApi.settle(p.id, 'decline'), () => `${d.adecline ? 'Declined' : 'Withdrawn'} · ${s.t} stays ${fmtV(s)}`, 0, 1);
      }
      if (d.async) {
        loadFeeds().then(() => refresh()).then(() => {
          const c = CONN.find(x => x.id === d.async);
          toast(c ? `${c.n} · ${c.note}` : 'Checked');
        }, e => toast(e.message));
        return true;
      }
      if (d.acorrect) {
        const note = ((document.getElementById('acnote') || {}).value || '').trim(),
          en = AL.ENTRY[d.acorrect];
        if (!note) return toast('Say what was wrong and what’s right'), true;
        return send(adminApi.correct(en.id, note), 'Corrected · a new entry points back to this one');
      }
      return false;
    }
    document.addEventListener('keydown', e => {
      if (!LIVE()) return;
      if (e.key === 'Escape' && A.panel && !document.querySelector('.modal')) {
        closeA();
        render();
      }
    });
    const OLD = {
      roles: 'groups',
      people: 'people',
      rule: 'rule',
      docs: 'docs',
      log: 'log'
    };
    return {
      render,
      page: () => A.page,
      tab: p => A.tab[p || A.page],
      setPage(p) {
        if (TABS[p]) A.page = p;
      },
      setTab(p, t) {
        // a tab, an old pane name, or tab:item as the module's own links have it (records/docs:d15, settings/rules:shopbuy)
        const [t0, op] = String(t || '').split(/[:,]/);
        t = OLD[t0] || t0;
        if (TABS[p] && TABS[p].some(x => x[0] === t)) A.tab[p] = t;
        closeA();
        if (op) {
          if (p === 'records' && t === 'docs') A.panel = 'd:' + op;
          if (p === 'records' && t === 'log') A.panel = 'l:' + op;
          if (p === 'settings' && SETO[op]) A.panel = 's:' + op;
        }
      },
      close() {
        closeA();
      },
      open(k) {
        A.panel = k;
      },
      setting: id => SETO[id]?.v,
      addReveal(m, what) {
        // live, the server logged it: the page loads its reveals again
        if (AL) return void AL.load().then(() => render(), () => undefined);
        REVEALS.unshift(
[Date.now() > NOW ? NOW + 10 * 60e3 : Date.now(), meKey(), m, what || 'Contact details', '', 'Members']);
      }
    };
  })(DOCP);
  function mount(r) {
    // the slot is the shell's (keyed by route): the host goes inside it, and draws the route's page
    if (!into('ax-slot')) return;
    API.setPage(r);
    API.render();
  }
  function unmount() {
    if (host.isConnected) return;
    API.close();
    W.classList.remove('pn');
  }
  function open(r, tab, k) {
    if (tab) API.setTab(r, tab);
    API.open(k);
    CC.go(r);
  }
  return {
    mount,
    unmount,
    open,
    setTab: (r, t) => API.setTab(r, t),
    tab: r => API.tab(r),
    home: r => HOME[r],
    render: () => API.render(),
    addReveal: (m, w) => API.addReveal(m, w),
    setting: id => API.setting(id),
    host
  };
}
registerPage(['records', 'team', 'settings'], 'ax-slot', makeAdmin, { live: true });

/* What other pages call on the reference's ADMIN2: live, the real values and the real log. */

const admin = () => pageModFor('records');
/** Logs a reveal in Records → Reveals (Members' "Show" calls it, as the reference's ADMIN2.addReveal). */
export function addReveal(member: string, what?: string) {
  admin()?.addReveal(member, what);
}
/** A setting's value (Shop's buy limit reads `shopbuy`, as the reference's ADMIN2.setting); undefined when the page isn't the redesign. */
export function adminSetting(id: string) {
  return admin()?.setting(id);
}
/** Opens a page on a tab with a panel (p:K, d:d15, l:a3), as the reference's ADMIN2.open; false when the page isn't the redesign. */
export function adminOpen(route: string, tab: string, panel: string) {
  const m = pageModFor(route);
  if (!m) return false;
  m.open(route, tab, panel);
  return true;
}