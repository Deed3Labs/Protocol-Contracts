// @ts-nocheck: ported from the redesign's GOV2 module (design/command-center-ui) with scripts/port/module.cjs; its data is its own.
import { Fragment } from 'react';
import { attrs, css, hasHtml, html } from '../runtime/dom';
import { LIVE as LIVE_APP, REAL } from '../live/env';
import { loadSection, needsData } from '../live/sections';
import { CC } from './cc';
import { openCFlow } from './contracts';
import { LOG, S } from './data';
import { nextBoard, openVFlow } from './governance';
import { governanceLive } from './governanceLive';
import { registerPage, shadowHost } from './pageHost';
import { openItem, render as renderShell, toast } from './shell';

/*
 * Governance (design/command-center-ui, the GOV2 module): proposals from a member's draft to the thing
 * being done, the boards, the entities, the agreements (moved here from Contracts) and the compliance
 * calendar, in six tabs. It lives in its own shadow root (pageHost.tsx) with the g, fm, n, bx and vx
 * sheets adopted. The reference's module body runs against a stand-in `document` (DOCP) that points into
 * the shadow root, as it does there. Links out go through CC.go, so they land on the right page and pane.
 *
 * Live (REAL), its datasets are governanceLive()'s (`LG`: the module has its own L, R and W): the entities,
 * the boards' seats, the meetings, the agenda, the resolutions, the reserved matters, the filings, the
 * related-party log and the latest member vote from the governance section, and the agreements from
 * Build's (contracts), which the page loads beside its own. Proposals as a lifecycle, the forum, tasks and
 * agreement versions aren't kept by the API: those cells say "Not real yet". Changes go through the old
 * page's flows (openVFlow: filings, formation steps, the agenda, the packet, the minutes, decisions,
 * related-party payments, reserved matters, reminders) and Contracts' (openCFlow: signing and renewing an
 * agreement), which save through the API; the reference's own actions with no API are hidden.
 */

/** The page's skeleton: the reference template's markup, drawn once into the shadow root. */
function skeleton() {
  return <div className="gw" id="gw"><div className="hdr stack" id="hdr" /><nav className="gtabs" aria-label="Governance views"><button data-gtab="overview">Overview</button><button data-gtab="proposals">Proposals</button><button data-gtab="boards">Boards</button><button data-gtab="entities">Entities</button><button data-gtab="agreements">Agreements</button><button data-gtab="calendar">Calendar</button></nav><div id="gv" /></div>;
}
function makeGovernance() {
  const { host, R: SR, W, into } = shadowHost('governance', skeleton());
  const LG = REAL ? governanceLive() : null;
  const LIVE = () => host.isConnected && CC.route() === 'governance';
  const RO = () => CC.viewing() && CC.level('governance') < 3;
  const TOT = () => CC.viewing() && CC.level('governance') === 1;
  const meKey = () => {
    // live, the signed-in person (the prototype's view picks one of its demo people)
    if (LG) return LG.me;
    const v = S.view;
    if (!v) return 'kai';
    return {
      K: 'kai',
      DR: 'dana'
    }[v.person] || {
      admin: 'kai',
      protocol: 'dana',
      board: 'm1',
      members: 'mem'
    }[v.g] || 'viewer';
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
    const [r, sub] = path.split('/');
    return CC.go(r, sub);
  }
  let API = null;
  function setHash() {
    if (!LIVE()) return;
    const t = API.tab();
    try {
      history.replaceState(null, '', '#governance' + (t === 'overview' ? '' : '/' + t));
    } catch (e) {}
  }
  API = (document => {
    /* ══ Governance data — proposals, who decides what, discussion ══════════════════════════════════════════════
       Demo "today" is Wed 21 Oct 2026, 14:00. 188 members can vote. A proposal reaches a vote once 10 members co-sign it
       (2% of members or 10, whichever is more). Member ballots are sealed until the vote closes; board votes are on the record. */
    const DAY = 864e5,
      TODAY = LG ? LG.TODAY : Date.UTC(2026, 9, 21),
      NOW = LG ? LG.NOW : TODAY + 14 * 3600e3;
    /* the calendar's first month and the year dates are written without: the reference's October 2026, live today's */
    const Y0 = LG ? new Date(TODAY).getUTCFullYear() : 2026,
      M0 = LG ? new Date(TODAY).getUTCMonth() : 9;
    const D = (m, d, y = 2026) => Date.UTC(y, m - 1, d);
    const H = (m, d, h, mi = 0) => Date.UTC(2026, m - 1, d, h, mi);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmtD = t => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
    /* a date, or the API's words for one ("Before the co-op") */
    const fD = t => typeof t === 'number' ? fmtD(t) : t;
    const WD = t => new Date(t).toLocaleDateString('en-US', {
      weekday: 'short',
      timeZone: 'UTC'
    });
    const hm = t => new Date(t).toISOString().slice(11, 16);
    const leaf = t => <span className="leaf"><span>{WD(t)}</span><b>{new Date(t).getUTCDate()}</b><span>{MON[new Date(t).getUTCMonth()]}</span></span>;
    const ago = t => {
      const m = Math.round((NOW - t) / 6e4);
      if (m < 60) return `${Math.max(1, m)} min ago`;
      const h = Math.round(m / 60);
      if (h < 24) return `${h} h ago`;
      const d = Math.round(h / 24);
      return d === 1 ? 'yesterday' : `${d} days ago`;
    };
    const left = t => {
      const d = Math.ceil((t - NOW) / DAY);
      return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
    };
    const int = n => Math.round(n).toLocaleString('en-US');
    const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
    const MEMBERS = LG ? LG.VOTE ? LG.VOTE.elig : 0 : 188,
      SPONSORS = Math.max(10, Math.ceil(MEMBERS * 0.02));

    /* people. Members are masked here as everywhere in the Command Center; the forum in the app shows the name each member picks. */
    const PPL = LG ? LG.PPL : {
      kai: {
        n: 'Kai',
        ini: 'K',
        role: 'Admin · co-op board',
        board: true,
        staff: true
      },
      dana: {
        n: 'Dana Ruiz',
        ini: 'DR',
        role: 'Ops',
        staff: true
      },
      m1: {
        n: 'Member M•••a4',
        ini: 'A4',
        role: 'Co-op board',
        board: true
      },
      m2: {
        n: 'Member M•••7c',
        ini: '7C',
        role: 'Co-op board',
        board: true
      },
      mem: {
        n: 'Member',
        ini: 'ME',
        role: 'Member'
      },
      viewer: {
        n: 'Viewer',
        ini: 'VW',
        role: 'Read-only'
      }
    };
    const who = k => k === G.me ? 'You' : PPL[k] ? PPL[k].n : k;
    const mm = id => `Member M•••${id}`;

    /* the stages a proposal moves through. Discussion runs alongside every one of them. */
    const STAGES = [['draft', 'Draft', 'Written with co-authors'], ['sponsor', 'Co-signing', `Needs ${SPONSORS} members to reach a vote`], ['check', 'Check', 'Who votes and what it takes'], ['vote', 'Voting', 'Text frozen · ballots sealed'], ['decided', 'Decided', 'Passed or failed'], ['done', 'Carried out', 'Tasks with owners and dates']];
    const STG = Object.fromEntries(STAGES.map(s => [s[0], s]));

    /* who decides what: type → who votes, what it takes to pass, turnout needed (quorum), how long the vote runs */
    const RULES = {
      spend: {
        t: 'Spending the co-op balance',
        body: 'Members',
        pass: 'More yes than no',
        q: 0.10,
        days: 7,
        note: 'The co-op balance is held for a member vote'
      },
      bylaw: {
        t: 'Co-op agreement or bylaws',
        body: 'Members, after the board',
        pass: 'Two-thirds yes',
        q: 0.20,
        days: 14,
        note: 'The board reviews it first; it can’t block it'
      },
      elect: {
        t: 'Board elections',
        body: 'Members · the Assembly elects a third',
        pass: 'Most votes per seat',
        q: 0.10,
        days: 14,
        note: 'Nominations open 6 weeks before the meeting'
      },
      policy: {
        t: 'Policies and day-to-day decisions',
        body: 'Co-op board',
        pass: 'Majority of seats filled',
        q: null,
        days: null,
        note: 'At a meeting or by written consent'
      },
      setting: {
        t: 'Network settings',
        body: 'Co-op board',
        pass: 'Majority of seats filled',
        q: null,
        days: null,
        note: 'Then signed in the Ops Safe, in Build'
      },
      reserved: {
        t: 'Holdings reserved matters',
        body: 'Holdings board, then the co-op',
        pass: 'The co-op’s yes',
        q: null,
        days: null,
        note: 'Selling land or going under the 25% floor needs a member vote'
      },
      assembly: {
        t: 'Delegate Assembly matters',
        body: 'Council chairs',
        pass: 'Majority of chairs',
        q: null,
        days: null,
        note: 'Switches on at 5 communities · 1 today',
        off: true
      }
    };
    const PETITION = 'Members can take any board decision to a member vote with the same 10 co-signers.';

    /* proposals. st: draft | sponsor | check | vote | decided | done | withdrawn | expired */
    const PROPS = LG ? [] : [{
      id: 'P-012',
      type: 'bylaw',
      t: 'Adopt member agreement v2.2',
      by: 'kai',
      st: 'vote',
      opened: D(9, 22),
      ver: 3,
      frozen: D(10, 15),
      sum: 'Plain-language rewrite of the member agreement. Adds the hardship pause, the 90-day window to activate, and how member votes are counted.',
      sponsors: SPONSORS,
      voteOpen: D(10, 15),
      voteClose: H(10, 29, 23, 59),
      cast: 61,
      castBy: [9, 21, 30, 38, 47, 55, 61],
      boardRec: 'for',
      boardVote: [3, 0],
      posts: 42,
      hidden: 1,
      mine: false,
      live: 'Hearing held Mon 19 Oct · 46 came · recording in Community'
    }, {
      id: 'P-015',
      type: 'spend',
      t: 'Reprint the window posters for Cajon Blvd',
      by: 'a4',
      st: 'sponsor',
      opened: D(10, 14),
      ver: 2,
      amt: 300,
      sum: '$300.00 from the co-op balance for 60 reprints. The first run faded in the sun; three shops asked for new ones.',
      sponsors: 7,
      sponsorBy: D(11, 13),
      posts: 12,
      coauth: ['3c']
    }, {
      id: 'P-016',
      type: 'setting',
      t: 'Raise the starter credit limit to $150.00',
      by: '7c',
      st: 'check',
      opened: D(10, 6),
      ver: 2,
      sum: 'Starter limits go from $100.00 to $150.00 for members past their first full cycle with no late payments.',
      sponsors: 13,
      checker: 'kai',
      checkDue: D(10, 23),
      checks: [['Type', 'Network setting · the board decides', 1], ['Fits the agreement', 'Section 6, credit limits', 1], ['Money', 'Room under the 20% RTD floor: $1,527.60', 0], ['Conflicts', 'None found yet', 0]],
      posts: 27,
      live: 'On the agenda of Thu’s town hall · 22 Oct, 18:00'
    }, {
      id: 'P-017',
      type: 'policy',
      t: 'Hold the annual meeting on a Saturday',
      by: '3c',
      st: 'draft',
      opened: D(10, 19),
      ver: 1,
      coauth: ['a4', 'e1'],
      sum: 'Move the annual member meeting from a weekday evening to a Saturday morning, with the online option kept.',
      posts: 5
    }, {
      id: 'P-014',
      type: 'elect',
      t: 'Elect three co-op board seats',
      by: 'kai',
      st: 'check',
      opened: D(10, 1),
      ver: 1,
      sum: 'Three seats are on the ballot at the annual meeting on 15 Jan. Nominations are open until 4 Dec.',
      sponsors: null,
      checker: 'dana',
      checkDue: D(12, 4),
      nominations: 4,
      checks: [['Type', 'Board election', 1], ['Seats', '3 of 5', 1], ['Nominations', '4 so far · open to 4 Dec', 0]],
      posts: 9
    }, {
      id: 'P-013',
      type: 'setting',
      t: 'Register The Deed & Title Co. as a validator',
      by: 'kai',
      st: 'done',
      opened: D(9, 28),
      ver: 2,
      decidedAt: D(10, 12),
      result: 'passed',
      boardVote: [3, 0],
      sum: 'Lets D&T Co. review title before a deed is minted. It signs as a validator in ValidatorRegistry.',
      posts: 8,
      tasks: [['Form The Deed & Title Co.', 'Governance · Entities', 'dana', D(11, 30), 'doing'], ['Sign the change in the Ops Safe', 'Build · Ops Safe', 'kai', D(12, 7), 'waits', 'Waits on formation']]
    }, {
      id: 'P-009',
      type: 'reserved',
      t: 'Name the co-op’s second reserved seat on the Holdings board',
      by: 'kai',
      st: 'done',
      opened: D(9, 15),
      ver: 1,
      decidedAt: D(10, 2),
      result: 'passed',
      boardVote: [3, 0],
      sum: 'The co-op holds two reserved seats on the Holdings board. This names who sits in the second one.',
      posts: 6,
      tasks: [['Pick the appointee', 'Co-op board', 'kai', D(10, 15), 'late'], ['Record the appointment', 'Governance · Boards', 'dana', D(10, 22), 'waits', 'Waits on the pick']]
    }, {
      id: 'P-007',
      type: 'policy',
      t: 'Adopt the hardship pause',
      by: 'm1',
      st: 'done',
      opened: D(8, 25),
      ver: 2,
      decidedAt: D(9, 10),
      result: 'passed',
      boardVote: [3, 0],
      sum: 'A member who loses income can pause repayments for one cycle without it counting as late.',
      posts: 19,
      tasks: [['Add the pause to the member app', 'Build · Member app', 'kai', D(9, 30), 'done'], ['Write it into agreement v2.2', 'Governance · Proposals', 'kai', D(10, 15), 'done']]
    }, {
      id: 'P-010',
      type: 'spend',
      t: 'Put $100.00 toward the Uptown Barber launch',
      by: 'e1',
      st: 'decided',
      opened: D(9, 8),
      ver: 1,
      amt: 100,
      decidedAt: D(10, 4),
      result: 'quorum',
      sum: 'Coffee and printing for the launch morning at Uptown Barber.',
      sponsors: SPONSORS,
      voteOpen: D(9, 27),
      voteClose: D(10, 4),
      cast: 16,
      tally: [13, 2, 1],
      boardRec: null,
      posts: 11
    }, {
      id: 'P-018',
      type: 'policy',
      t: 'Move the co-op’s bank account',
      by: '9b',
      st: 'withdrawn',
      opened: D(10, 9),
      ver: 1,
      endedAt: D(10, 17),
      why: 'Withdrawn by the author · Clear Financial Co. holds member funds, not the co-op',
      sum: 'Move the co-op’s operating account to a credit union.',
      posts: 14
    }, {
      id: 'P-011',
      type: 'spend',
      t: 'Sponsor a youth soccer team',
      by: '5f',
      st: 'expired',
      opened: D(9, 1),
      ver: 1,
      endedAt: D(10, 1),
      sponsors: 4,
      why: 'Expired with 4 of 10 co-signers',
      sum: '$400.00 toward jerseys for the Highland youth league.',
      posts: 7
    }];
    const PROP = Object.fromEntries(PROPS.map(p => [p.id, p]));

    /* the forum. Posts belong to a proposal (or to Ideas, before there is one). */
    const POSTS = LG ? [] : [{
      p: 'P-012',
      by: 'kai',
      at: H(10, 21, 12, 40),
      t: 'Turnout is 32% with eight days left. The two-thirds bar counts only yes and no, not abstentions.',
      staff: true
    }, {
      p: 'P-016',
      by: '2d',
      at: H(10, 21, 11, 5),
      t: 'Does the higher limit apply if I was late once in my first month but not since?',
      r: 3
    }, {
      p: 'P-015',
      by: 'a4',
      at: H(10, 21, 9, 30),
      t: 'Added photos of the faded posters at Rosa’s and the laundromat. Three more co-signers and it goes to a vote.',
      r: 5
    }, {
      p: 'idea',
      by: 'e1',
      at: H(10, 20, 19, 10),
      t: 'Idea: a tool library at the Highland community room, paid from the co-op balance.',
      r: 8
    }, {
      p: 'P-012',
      by: '7c',
      at: H(10, 20, 17, 0),
      t: 'Section 9 now says votes are counted at the close, not as they come in. That answers the question from last week.',
      r: 2
    }, {
      p: 'P-012',
      by: 'b8',
      at: H(10, 20, 15, 20),
      hidden: 'Dana Ruiz · shared another member’s address'
    }, {
      p: 'P-017',
      by: '3c',
      at: H(10, 20, 10, 0),
      t: 'Draft is up. Saturday 10am, with the stream kept for anyone who can’t come.',
      r: 4
    }];
    const IDEAS = LG ? 0 : 23;

    /* ── entities: who owns what. The Foundation sits outside the tree and answers to no one. ── */
    const ENT = LG ? LG.ENT : [/* id, name, kind, status, what it does */
    ['coop', 'Clear Co-op', 'Wyoming LLC · co-op', 'formed', 'The parent. One member, one vote. Taxed as a corporation.'], ['fin', 'Clear Financial Co.', 'Wyoming LLC', 'formed', 'Runs the card and money programs. Holds member funds for their benefit.'], ['dt', 'The Deed & Title Co.', 'Wyoming LLC', 'forming', 'Keeps title records and will review deeds as a validator. Does not hold escrow.'], ['hold', 'Clear Capital Holdings', 'Wyoming C-corp', 'formed', 'Holds the economics of both funds. The co-op holds its governance class.'], ['labs', 'ClearLabs Inc.', 'Wyoming C-corp', 'formed', 'Research and development. Maintains the protocol for the Foundation.'], ['mgr', 'Manager LLC', 'Wyoming LLC', 'forming', 'Manages both funds and holds a small share of Clear Properties Co. Owned by Holdings.'], ['prop', 'Clear Properties Co.', 'Wyoming LLC · partnership', 'planned', 'Takes property contributions for OP units.'], ['lend', 'Clear Lending Co.', 'Wyoming LLC', 'planned', 'The credit book, bond series and pool shares.'], ['fdn', 'Clear Foundation', 'Wyoming foundation', 'forming', 'Holds the protocol. Ownerless, outside the tree.']];
    const ENTO = Object.fromEntries(ENT.map(e => [e[0], e]));
    const EST = {
      formed: ['Formed', 'var(--fg)'],
      forming: ['Forming', 'var(--underway)'],
      planned: ['Planned', 'var(--line)']
    };
    const PARENT = LG ? LG.PARENT : {
      coop: null,
      fin: 'coop',
      dt: 'coop',
      hold: 'coop',
      labs: 'coop',
      mgr: 'hold',
      lend: 'hold',
      prop: 'hold',
      fdn: null
    };
    const OWN = LG ? LG.OWN : {
      fin: '100%',
      dt: '100%',
      hold: '100%',
      labs: 'Majority',
      mgr: '100%',
      lend: '100%',
      prop: 'Majority, shrinking as contributors join'
    };
    const ENTF = LG ? LG.ENTF : {
      coop: {
        formed: D(6, 12),
        tax: 'Corporation, by election',
        ein: '••-•••4821',
        officers: 'Kai, president',
        agr: ['coop-oa', 'psa', 'mem21', 'ics']
      },
      fin: {
        formed: D(2, 3),
        tax: 'Disregarded',
        ein: '••-•••1907',
        officers: 'Kai, manager',
        agr: ['psa', 'lithic', 'bridge', 'plaid']
      },
      dt: {
        tax: 'Disregarded',
        steps: [['Name reserved', 1], ['Operating agreement', 1], ['Articles filed', 0], ['EIN', 0], ['Bank account', 0]],
        due: D(11, 30),
        agr: []
      },
      hold: {
        formed: D(7, 20),
        tax: 'C-corp',
        ein: '••-•••6630',
        officers: 'Kai, president',
        agr: ['ics']
      },
      labs: {
        formed: D(8, 5),
        tax: 'C-corp',
        ein: '••-•••3315',
        officers: 'Kai, CEO · Dana Ruiz, protocol lead',
        agr: ['pma']
      },
      mgr: {
        tax: 'Disregarded',
        steps: [['Name reserved', 1], ['Articles filed', 1], ['Operating agreement', 0], ['EIN', 0], ['Bank account', 0]],
        due: D(12, 15),
        agr: []
      },
      prop: {
        tax: 'Partnership',
        steps: [['Name reserved', 0], ['Articles filed', 0], ['Operating agreement', 0], ['EIN', 0], ['First contribution', 0]],
        agr: []
      },
      lend: {
        tax: 'Disregarded',
        steps: [['Name reserved', 0], ['Articles filed', 0], ['Operating agreement', 0], ['EIN', 0], ['Bank account', 0]],
        agr: []
      },
      fdn: {
        tax: 'Not taxed as a business',
        steps: [['Charter drafted', 1], ['Founder’s letter', 0], ['Filed with the state', 0], ['First council', 0]],
        due: D(12, 15),
        agr: ['pma']
      }
    };
    const RESERVED = LG ? LG.RESERVED : [['Selling or transferring land', 'Needs a member vote'], ['New share classes, or the co-op under its 25% floor', 'Needs a member vote'], ['Changing the charter or its purpose', 'Co-op board'], ['Selling, merging or closing Holdings', 'Co-op board'], ['Replacing the Manager', 'Co-op board'], ['Related-party deals over $25,000.00', 'Co-op board'], ['Borrowing over $250,000.00', 'Co-op board']];

    /* ── boards: seats as fractions, terms, meetings, resolutions ── */
    const SEATC = {
      c: ['Chair', 'var(--live)'],
      m: ['Member-elected', 'var(--fg)'],
      a: ['Elected by the Assembly', 'color-mix(in srgb,var(--fg) 60%,transparent)'],
      r: ['Co-op reserved', 'var(--land)'],
      i: ['Investor', 'color-mix(in srgb,var(--fg) 45%,transparent)'],
      n: ['Neutral', 'var(--underway)'],
      f: ['Open seat', 'var(--line)'],
      t: ['Team', 'color-mix(in srgb,var(--fg) 45%,transparent)']
    };
    const GBOARDS = LG ? LG.GBOARDS : [/* id, name, who it answers to, seats: [class, holder, from, to, note] */
    ['coop', 'Co-op board', 'Member-elected · the Assembly elects a third once it’s switched on', [['m', 'kai', D(6, 12), Date.UTC(2028, 0, 15)], ['m', 'm1', D(8, 20), Date.UTC(2028, 0, 15)], ['m', 'm2', D(8, 20), Date.UTC(2027, 0, 15)], ['m', null, 0, 0, 'Elected 15 Jan'], ['m', null, 0, 0, 'Elected 15 Jan']]], ['hold', 'Holdings board', 'The co-op holds reserved seats, the chair and a veto on reserved matters', [['c', null, 0, 0, 'Elected directly'], ['r', 'kai', D(7, 20), Date.UTC(2028, 6, 20)], ['r', null, 0, 0, 'P-009 · pick is late'], ['i', null, 0, 0, 'After the financial class sells'], ['i', null, 0, 0, 'After the financial class sells'], ['n', null, 0, 0, 'Picked jointly'], ['f', null, 0, 0, 'Open to anyone']]], ['labs', 'ClearLabs board', 'Majority owned by the co-op', [['r', 'kai', D(8, 5), Date.UTC(2028, 7, 5)], ['r', 'dana', D(8, 5), Date.UTC(2028, 7, 5)], ['t', null, 0, 0, 'When a protocol lead joins']]], ['asm', 'Delegate Assembly', 'Council chairs · switches on at 5 communities', [['a', null, 0, 0, 'Highland council'], ['a', null, 0, 0, 'Switches on at 5'], ['a', null, 0, 0, 'Switches on at 5'], ['a', null, 0, 0, 'Switches on at 5'], ['a', null, 0, 0, 'Switches on at 5']], true]];
    const MEETINGS = LG ? LG.MEETINGS : [/* id, board, when, kind, status, minutes */
    ['M-14', 'coop', H(11, 4, 18), 'Open session · broadcast in Community', 'next', null], ['M-13', 'coop', H(10, 7, 18), 'Open session', 'held', 'approve'], ['M-12', 'hold', H(9, 16, 17), 'First meeting', 'held', 'approved'], ['M-11', 'labs', H(10, 7, 16), 'Regular', 'held', 'approved'], ['M-10', 'coop', H(9, 2, 18), 'Open session', 'held', 'approved']];
    const AGENDA = LG ? LG.AGENDA : [/* item, minutes, owner, kind, link */
    ['Approve the 7 Oct minutes', 5, 'kai', 'vote'], ['P-016 · raise the starter credit limit', 15, 'kai', 'vote', 'P-016'], ['Result of the vote on agreement v2.2', 10, 'kai', 'report', 'P-012'], ['Q3 money review', 15, 'dana', 'report'], ['Intercompany pricing policy', 15, 'kai', 'vote'], ['Pick the Holdings appointee', 10, 'kai', 'vote', 'P-009'], ['Open seats and the annual meeting', 10, 'kai', 'discuss', 'P-014']];
    const AK = {
      vote: ['Vote', 'var(--fg)'],
      report: ['Report', 'var(--land)'],
      discuss: ['Discuss', 'var(--line)']
    };
    const RESOS = LG ? LG.RESOS : [/* date, board, title, votes by seat, proposal */
    [D(10, 12), 'coop', 'Register The Deed & Title Co. as a validator', ['y', 'y', 'y'], 'P-013'], [D(10, 7), 'coop', 'Member fee schedule', ['y', 'y', 'y']], [D(10, 7), 'labs', 'Protocol maintenance terms', ['r', 'y']], [D(10, 2), 'coop', 'Name the second reserved Holdings seat', ['y', 'y', 'y'], 'P-009'], [D(9, 16), 'hold', 'Adopt the bylaws', ['y']], [D(9, 10), 'coop', 'Adopt the hardship pause', ['y', 'y', 'y'], 'P-007'], [D(9, 2), 'coop', 'Issue ClearLabs shares to the co-op', ['r', 'y', 'y']]];
    const VOTEC = {
      y: ['Yes', 'var(--fg)'],
      n: ['No', 'var(--absent)'],
      r: ['Recused', 'var(--line)'],
      a: ['Absent', 'transparent']
    };

    /* ── agreements: moved here from Contracts ── */
    const AGR_T = [['company', 'Between our companies'], ['provider', 'Providers'], ['member', 'Members'], ['merchant', 'Shops']];
    const AGR = LG ? LG.AGR : [{
      id: 'coop-oa',
      name: 'Cooperative operating agreement',
      party: 'Clear Co-op',
      type: 'company',
      st: 'signed',
      a: D(6, 12),
      b: null,
      ver: 'v1.0',
      next: 'v1.1',
      note: 'Adopted by the founding members. Changes need a member vote.'
    }, {
      id: 'psa',
      name: 'Program services agreement',
      party: 'Clear Financial Co.',
      type: 'company',
      st: 'renew',
      a: D(1, 1),
      b: Date.UTC(2027, 0, 1),
      ver: 'v1.0',
      note: 'Clear Financial Co. runs the card and money programs for the co-op.'
    }, {
      id: 'pma',
      name: 'Protocol maintenance',
      party: 'ClearLabs Inc.',
      type: 'company',
      st: 'renew',
      a: Date.UTC(2025, 11, 15),
      b: D(12, 15),
      ver: 'v1.0',
      next: 'v1.1',
      note: 'ClearLabs maintains the protocol for the Foundation, which can hire other maintainers too.'
    }, {
      id: 'ics',
      name: 'Intercompany services',
      party: 'Clear Capital Holdings',
      type: 'company',
      st: 'draft',
      a: null,
      b: null,
      ver: 'v0.3',
      note: 'Pricing for services between the co-op and Holdings, at arm’s length. On the 4 Nov agenda.'
    }, {
      id: 'lithic',
      name: 'Card program agreement',
      party: 'Lithic',
      type: 'provider',
      st: 'signed',
      a: D(3, 2),
      b: Date.UTC(2027, 2, 1),
      ver: 'v2.0',
      note: 'Cards and authorizations.'
    }, {
      id: 'bridge',
      name: 'Stablecoin services',
      party: 'Bridge',
      type: 'provider',
      st: 'signed',
      a: D(7, 18),
      b: Date.UTC(2027, 6, 18),
      ver: 'v1.0',
      note: 'USDC on and off ramps. Holds the reserve behind member savings.'
    }, {
      id: 'plaid',
      name: 'Bank data',
      party: 'Plaid',
      type: 'provider',
      st: 'renew',
      a: Date.UTC(2025, 10, 12),
      b: D(11, 12),
      ver: 'v1.0',
      note: 'Bank links for members and the business account.'
    }, {
      id: 'print',
      name: 'Poster printing',
      party: 'Inland Print Co.',
      type: 'provider',
      st: 'renew',
      a: Date.UTC(2025, 10, 30),
      b: D(11, 30),
      ver: 'v1.0',
      note: 'Window posters, printed in batches of 25.'
    }, {
      id: 'esign',
      name: 'E-signature',
      party: 'E-signature tool',
      type: 'provider',
      st: 'signed',
      a: D(8, 1),
      b: null,
      roll: 1,
      ver: '—',
      note: 'Month to month. Signed copies come back here.'
    }, {
      id: 'mem21',
      name: 'Member agreement',
      party: 'Every member',
      type: 'member',
      st: 'signed',
      a: D(8, 14),
      b: null,
      ver: 'v2.1',
      next: 'v2.2',
      note: 'Every member accepts it when they open an account. v2.2 is being voted on as P-012.',
      prop: 'P-012'
    }, {
      id: 'shops',
      name: 'Merchant partner agreement',
      party: '12 shops',
      type: 'merchant',
      st: 'signed',
      a: D(8, 3),
      b: null,
      ver: 'v1.1',
      note: 'NET-30 or NET-14, a fee of up to 2.5% and a cap per sale, set per shop in MerchantRegistry.'
    }, {
      id: 'icw',
      name: 'Merchant partner agreement',
      party: 'Inland Cycle Works',
      type: 'merchant',
      st: 'out',
      a: null,
      b: null,
      sent: D(10, 18),
      ver: 'v1.1',
      note: 'They signed 20 Oct. Founding seat 4 of 5 once you sign; the shop is added in the Ops Safe after.'
    }];
    const AST = {
      signed: ['Signed', 'var(--fg)'],
      renew: ['Renew soon', 'var(--underway)'],
      draft: ['Drafting', 'var(--line)'],
      out: ['Waiting on you', 'var(--live)'],
      vote: ['Being voted on', 'var(--live)']
    };
    // live, Contracts' renewals go out for signature (contracts/renew)
    if (LG) AST.sent = ['Out for signature', 'var(--underway)'];

    /* ── the calendar: filings, meetings and votes across every entity ── */
    const FILINGS = LG ? LG.FILINGS : [/* id, entity, title, due, status, owner */
    ['f1', 'labs', 'Annual report', D(11, 1), 'ready', 'kai'], ['f2', 'coop', 'Board minutes · 7 Oct', D(11, 4), 'draft', 'kai'], ['f3', 'coop', 'Statement of Information', D(11, 15), 'none', 'Accountant'], ['f4', 'dt', 'Formation filing', D(11, 30), 'draft', 'Accountant'], ['f5', 'fdn', 'Foundation charter', D(12, 15), 'draft', 'Counsel'], ['f6', 'fin', 'Program review', D(12, 31), 'none', 'dana'], ['f16', 'coop', 'Sales tax return · Q3', D(10, 31), 'ready', 'dana'], ['f7', 'coop', 'Annual member meeting', Date.UTC(2027, 0, 15), 'none', 'kai'], ['f15', 'coop', 'Sales tax return · Q4', Date.UTC(2027, 0, 31), 'later', 'Accountant'], ['f8', 'fin', 'Annual report', Date.UTC(2027, 2, 1), 'later', 'Accountant'], ['f9', 'fin', 'Program review', Date.UTC(2027, 2, 31), 'later', 'dana'], ['f10', 'coop', 'Federal return', Date.UTC(2027, 3, 15), 'later', 'Accountant'], ['f11', 'hold', 'Federal return', Date.UTC(2027, 3, 15), 'later', 'Accountant'], ['f12', 'labs', 'Federal return', Date.UTC(2027, 3, 15), 'later', 'Accountant'], ['f13', 'coop', 'Annual report', Date.UTC(2027, 5, 1), 'later', 'Accountant'], ['f14', 'hold', 'Annual report', Date.UTC(2027, 6, 1), 'later', 'Accountant'], ['f0', 'coop', 'Board minutes · 2 Sep', D(9, 30), 'done', 'kai'], ['f00', 'hold', 'Bylaws filed', D(9, 30), 'done', 'Accountant']];
    const FST = {
      ready: ['Ready to file', 'var(--settled)'],
      draft: ['Drafting', 'var(--underway)'],
      none: ['Not started', 'var(--absent)'],
      later: ['Later', 'var(--line)'],
      done: ['Filed', 'var(--fg)']
    };
    const ESHORT = {
      coop: 'Co-op',
      fin: 'Financial',
      dt: 'D&T Co.',
      hold: 'Holdings',
      labs: 'ClearLabs',
      mgr: 'Manager',
      prop: 'Properties',
      lend: 'Lending',
      fdn: 'Foundation'
    };

    /* ── versions of the standard agreements. st: in (in force) · old (replaced) · vote · draft. Changes: + added · ~ changed · − removed ── */
    const VERS = LG ? {} : {
      'coop-oa': [['v1.0', D(6, 12), 'in', 'Founding members', ['+ One member, one vote', '+ Taxed as a corporation, by election', '+ Changes need a member vote']], ['v1.1', Date.UTC(2027, 0, 15), 'draft', 'Goes to a member vote at the annual meeting', ['+ The Delegate Assembly, switched on at 5 communities', '+ Members can take a board decision to a vote with 10 co-signers', '~ Board seats written as fractions, not counts']]],
      'mem21': [['v1.0', D(3, 1), 'old', 'Clear Financial Co., before the co-op', ['+ Savings account and card', '+ Bank links through Plaid']], ['v2.0', D(6, 12), 'old', 'Adopted with the co-op', ['~ Members join the co-op, not a company', '+ One member, one vote', '+ Savings reserved 1 : 1']], ['v2.1', D(8, 14), 'in', 'Co-op board · 12 Aug', ['+ Savings-backed credit', '+ Clear Pay at partner shops', '~ Fees move to a schedule the board sets']], ['v2.2', H(10, 29, 23, 59), 'vote', 'P-012 · member vote, closes 29 Oct', ['+ Hardship pause, one cycle (from P-007)', '+ 90 days to activate a new account', '+ How member votes are counted, sealed until the close', '~ Sections 1 to 6 rewritten in plain language', '− The paper statement fee']]],
      'shops': [['v1.0', D(8, 3), 'old', 'Standard terms · Kai', ['+ NET-30 payouts', '+ A fee of up to 2.5%', '+ A cap per sale']], ['v1.1', D(9, 15), 'in', 'Co-op board · 2 Sep', ['+ NET-14 for small tickets', '+ Clear Pay at the counter', '~ Founding partner terms written in']]],
      'pma': [['v1.0', Date.UTC(2025, 11, 15), 'in', 'ClearLabs board', ['+ ClearLabs maintains the protocol', '+ Hourly, billed monthly']], ['v1.1', D(12, 15), 'draft', 'For the 15 Dec renewal', ['~ The Foundation can hire other maintainers too', '~ A fixed monthly fee instead of hourly', '+ Security reviews before every upgrade']]],
      'psa': [['v1.0', D(1, 1), 'in', 'Clear Financial Co. and the co-op', ['+ Clear Financial Co. runs the card and money programs', '+ Member funds held for their benefit']]],
      'ics': [['v0.3', D(11, 4), 'draft', 'On the 4 Nov board agenda', ['+ Prices for shared staff and systems', '+ An arm’s-length test, checked every year', '~ Related-party deals over $25,000.00 go to the co-op board']]]
    };
    /* who is on which version, where people accept it one by one */
    const VUSE = LG ? {} : {
      'mem21': [['v2.1', 188]],
      'shops': [['v1.0', 3], ['v1.1', 9]]
    };
    const VST = {
      in: ['In force', 'var(--fg)'],
      old: ['Replaced', 'var(--line)'],
      vote: ['Being voted on', 'var(--live)'],
      draft: ['Drafting', 'var(--underway)']
    };

    /* ══ Governance — the other tabs. Functions only: they're called after everything above has loaded. ══════════ */

    const ownerName = k => PPL[k] ? who(k) : /^[0-9a-f]{2}$/.test(k) ? mm(k) : k;
    /* every dated thing across governance: filings, meetings, votes, tasks and renewals */
    function calItems() {
      if (LG) return calItemsLive();
      const out = [];
      FILINGS.forEach(f => out.push({
        t: f[3],
        kind: f[2].startsWith('Annual member') ? 'meeting' : 'filing',
        title: f[2],
        ent: f[1],
        st: f[4],
        owner: f[5],
        at: `data-gfile="${f[0]}"`
      }));
      MEETINGS.filter(m => m[4] === 'next').forEach(m => out.push({
        t: m[2],
        kind: 'meeting',
        title: `${GBOARDS.find(b => b[0] === m[1])[1]} meets`,
        ent: m[1] === 'coop' ? 'coop' : m[1],
        st: 'next',
        owner: 'kai',
        at: `data-gmt="${m[0]}"`
      }));
      PROPS.forEach(p => {
        if (p.st === 'vote' && !p.board) out.push({
          t: p.voteClose,
          kind: 'vote',
          title: `${p.id} closes · ${p.t}`,
          ent: 'coop',
          st: 'next',
          owner: 'Members',
          at: `data-gopen="${p.id}"`
        });
        if (p.st === 'check') out.push({
          t: p.checkDue,
          kind: 'vote',
          title: `${p.id} ${p.type === 'elect' ? 'nominations close' : 'check due'} · ${p.t}`,
          ent: 'coop',
          st: 'next',
          owner: p.checker,
          at: `data-gopen="${p.id}"`
        });
        if (p.st === 'sponsor') out.push({
          t: p.sponsorBy,
          kind: 'vote',
          title: `${p.id} co-signing ends · ${p.t}`,
          ent: 'coop',
          st: 'next',
          owner: p.by,
          at: `data-gopen="${p.id}"`
        });
        (p.tasks || []).filter(x => x[4] !== 'done').forEach(x => out.push({
          t: x[3],
          kind: 'task',
          title: `${x[0]} · ${p.id}`,
          ent: 'coop',
          st: x[4] === 'late' ? 'late' : 'next',
          owner: x[2],
          at: `data-gopen="${p.id}"`
        }));
      });
      AGR.filter(a => a.st === 'renew').forEach(a => out.push({
        t: a.b,
        kind: 'renew',
        title: `${a.name} renews · ${a.party}`,
        ent: a.type === 'company' ? 'coop' : 'fin',
        st: 'next',
        owner: 'kai',
        at: `data-gagr="${a.id}"`
      }));
      return out.sort((a, b) => a.t - b.t);
    }
    const CALK = {
      filing: ['Filing', 'var(--fg)'],
      meeting: ['Meeting', 'var(--live)'],
      vote: ['Proposal', 'color-mix(in srgb,var(--live) 55%,transparent)'],
      task: ['Task', 'var(--settled)'],
      renew: ['Renewal', 'var(--underway)']
    };
    function calStatus(c) {
      if (c.kind === 'filing') return <span className={`gt-st ${c.st === 'later' ? 'later' : ''}`} style={css(`--c:${FST[c.st][1]}`)}>{FST[c.st][0]}</span>;
      if (c.st === 'late') return <span className="gt-st bad" style={css("--c:var(--absent)")}>{Math.round((NOW - c.t) / DAY)}{" d late"}</span>;
      return <span className="gt-st" style={css(`--c:${CALK[c.kind][1]}`)}>{CALK[c.kind][0]}</span>;
    }
    /* a list of dated rows; rows that share a date hang off the first with a tie */
    function calList(items, cls = '') {
      let prev = null;
      return <div className={`gt-cl ${cls}`}>{items.map((c, __k) => {
          const day = Math.floor(c.t / DAY),
            same = day === prev;
          prev = day;
          return <button key={__k} className={`gt-cr ${same ? 'same' : ''} ${c.st === 'late' ? 'late' : ''} ${c.st === 'done' ? 'done' : ''}`} {...attrs(c.at)}>{same ? <span className="gt-tie"><i /></span> : leaf(c.t)}<span className="gt-ck"><b>{c.title}</b><span>{ESHORT[c.ent] || c.ent}{" · "}{ownerName(c.owner)}</span></span>{calStatus(c)}</button>;
        })}</div>;
    }
    const stageChip = p => {
      const i = STAGES.findIndex(s => s[0] === p.st);
      return <span className={`gt-sg ${p.st}`}><span className="gv-rn">{i + 1}</span>{STG[p.st][1]}</span>;
    };
    function seatChips(b, small) {
      return <span className={`gt-seats ${small ? 'sm' : ''}`}>{b[3].map((s, __k) => {
          const C = SEATC[s[0]] || SEATC.f;
          return <span key={__k} className={`gt-seat ${s[1] ? '' : 'open'}`} style={css(`--c:${C[1]}`)} title={`${C[0]}${s[1] ? ' · ' + who(s[1]) : ''}`}>{small ? '' : <><i /><b>{s[1] ? s[1] === 'kai' ? 'Kai' : who(s[1]).replace('Member ', '') : 'Open'}</b><em>{s[1] ? s[3] ? `to ${MON[new Date(s[3]).getUTCMonth()]} ${new Date(s[3]).getUTCFullYear()}` : 'No end date' : s[4] || C[0]}</em></>}</span>;
        })}</span>;
    }
    const votesDots = v => <span className="gt-vd">{v.map((x, __k) => <i key={__k} className={x} title={VOTEC[x][0]} />)}</span>;

    /* ══ Overview ══════════════════════════════════════════════════════════════════════════════════════════════ */
    function renderOverview() {
      if (LG) return renderOverviewLive();
      const ORD = {
        vote: 0,
        check: 1,
        sponsor: 2,
        draft: 3,
        done: 4
      };
      const open = PROPS.filter(isOpen).sort((a, b) => ORD[a.st] - ORD[b.st]).slice(0, 6);
      const deciding = cell('s7', 'Being decided', <span className="lbl">{PROPS.filter(isOpen).length}{" open proposals"}</span>, <div className="gt-dl">{open.map((p, __k) => <button key={__k} className={`gt-dr ${p.tasks && p.tasks.some(t => t[4] === 'late') ? 'late' : ''}`} data-gopen={p.id}>{stageChip(p)}<span className="gt-dk"><b>{p.t}</b><span><span className="mono">{p.id}</span>{" · "}{RULES[p.type].body}</span></span>{nextOf(p)}</button>)}</div>, <><span>Discussion happens in Community · decisions are tracked here</span><button data-gtab="proposals">Every proposal →</button></>);
      const up = calItems().filter(c => c.t >= TODAY && c.st !== 'done').slice(0, 7);
      const coming = cell('s7', 'Coming up', <span className="lbl">{"Next "}{Math.ceil((up[up.length - 1].t - TODAY) / DAY)}{" days"}</span>, calList(up), <><span>Filings, meetings, votes and renewals</span><button data-gtab="calendar">Calendar →</button></>);
      const boards = cell('s5', 'Boards', <span className="lbl">Seats filled</span>, <div className="gt-bl">{GBOARDS.map((b, __k) => <button key={__k} className={`gt-br ${b[4] ? 'off' : ''}`} data-gtab="boards"><span className="gt-bk"><b>{b[1]}</b><span>{b[4] ? 'Switches on at 5 communities' : `${b[3].filter(s => s[1]).length} of ${b[3].length} seats filled`}</span></span>{seatChips(b, 1)}</button>)}</div>, <><span>{"Next: co-op board, "}{WD(MEETINGS[0][2])}{" "}{fmtD(MEETINGS[0][2])}</span><button data-gtab="boards">Boards →</button></>);
      const recent = cell('s7', 'Recently decided', <span className="lbl">Every vote on the record</span>, <div className="gt-rl">{RESOS.slice(0, 5).map(r => resoRow(r))}</div>, <><span>Board votes are on the record by name</span><button data-gtab="boards">Resolutions →</button></>);
      const f = ENT.filter(e => e[3] === 'formed').length,
        fg = ENT.filter(e => e[3] === 'forming'),
        pl = ENT.filter(e => e[3] === 'planned').length,
        nf = ENT.filter(e => e[3] !== 'formed');
      const ents = cell('s5', 'Entities', <span className="lbl">{f}{" of "}{ENT.length}{" formed"}</span>, <div className="gt-eo"><div className="gt-eb">{ENT.map((e, __k) => <i key={__k} className={e[3]} title={`${e[1]} · ${EST[e[3]][0]}`} />)}</div><div className="gt-el">{nf.map((e, __k) => {
            const S = ENTF[e[0]].steps,
              d = S.filter(s => s[1]).length;
            return <button key={__k} className={`gt-er ${e[3]}`} data-gent={e[0]}><span><b>{e[1]}</b><em>{d}{" of "}{S.length}{" steps · "}{ENTF[e[0]].due ? 'due ' + fmtD(ENTF[e[0]].due) : 'when it’s needed'}</em></span><span className="gt-steps">{S.map((s, __k) => <i key={__k} className={s[1] ? 'on' : ''} />)}</span></button>;
          })}</div></div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />{"Formed "}{f}</span><span><i style={css("background:var(--underway)")} />{"Forming "}{fg.length}</span><span><i className="hx" />{"Planned "}{pl}</span></span><span /></>);
      html(document.getElementById('gv'), <>{band(<>{deciding}{needsCell()}</>, 1)}{band(<>{coming}{boards}</>)}{band(<>{recent}{ents}</>)}</>);
    }
    function resoRow(r) {
      const b = GBOARDS.find(x => x[0] === r[1]),
        y = r[3].filter(x => x === 'y').length,
        n = r[3].filter(x => x === 'n').length;
      // live, a board's resolution opens the old page's record of it (who voted how), by its place in the API's list
      return <div className="gt-rr" {...attrs(LG && b ? `data-greso="${r[5]}" role="button" tabindex="0"` : '')}>{leaf(r[0])}<span className="gt-rk"><b>{r[2]}</b><span>{b ? b[1] : r[1]}{r[4] ? <>{" · "}<button className="lnk3 mono" data-gopen={r[4]}>{r[4]}</button></> : ''}</span></span><span className="gt-rv">{votesDots(r[3])}<em>{LG && !r[3].length ? 'Not recorded by seat' : <>{y}{" yes"}{n ? ` · ${n} no` : ''}{r[3].includes('r') ? LG ? ` · ${r[3].filter(x => x === 'r').length} recused` : ' · 1 recused' : ''}</>}</em></span></div>;
    }

    /* ══ Boards ════════════════════════════════════════════════════════════════════════════════════════════════ */
    function renderBoards() {
      if (LG) return renderBoardsLive();
      const seats = cell('s12', 'Every seat', <span className="lbl">{GBOARDS.filter(b => !b[4]).reduce((a, b) => a + b[3].length, 0)}{" seats · 3 boards"}</span>, <div className="gt-sl">{GBOARDS.map((b, __k) => <div key={__k} className={`gt-sr ${b[4] ? 'off' : ''}`}><span className="gt-sk"><b>{b[1]}</b><em>{b[2]}</em></span>{seatChips(b)}<span className="gt-sn"><b>{b[4] ? '0' : b[3].filter(s => s[1]).length}</b><em>{"of "}{b[3].length}</em></span></div>)}</div>, <><span className="f-key">{['m', 'r', 'c', 'i', 'n'].map((k, __k) => <span key={__k}><i style={css(`background:${SEATC[k][1]}`)} />{SEATC[k][0]}</span>)}<span><i className="hx" />Open</span></span><span /></>);
      const M = MEETINGS[0],
        tot = AGENDA.reduce((a, x) => a + x[1], 0);
      const next = cell('s7', 'Next meeting', <span className="lbl">{"Co-op board · "}{WD(M[2])}{" "}{fmtD(M[2])}{" · "}{hm(M[2])}</span>, <div className="gt-ag"><div className="gt-ag-b">{AGENDA.map((x, __k) => <i key={__k} style={css(`flex:${x[1]};background:${AK[x[3]][1]}`)} title={x[0]} />)}</div><div className="gt-ag-l">{AGENDA.map((x, i) => <div key={i} className="gt-ag-r"><span className="mono">{i + 1}</span><span className="gt-ag-k"><b>{x[0]}</b><em>{who(x[2])}{" · "}{x[1]}{" min"}</em></span>{x[4] ? <button className="lnk3 mono" data-gopen={x[4]}>{x[4]}</button> : <span />}<span className="gt-st" style={css(`--c:${AK[x[3]][1]}`)}>{AK[x[3]][0]}</span></div>)}</div></div>, <><span>{tot}{" min · open session, broadcast in Community"}</span><button data-gcomm="">Community →</button></>);
      const mtgs = cell('s5', 'Meetings', <span className="lbl">Minutes and records</span>, <div className="gt-ml">{MEETINGS.map((m, __k) => {
          const b = GBOARDS.find(x => x[0] === m[1]);
          return <button key={__k} className={`gt-mr ${m[4]}`} data-gmt={m[0]}>{leaf(m[2])}<span className="gt-ck"><b>{b[1]}</b><span>{m[3]}</span></span><span className="gt-st" style={css(`--c:${m[4] === 'next' ? 'var(--live)' : m[5] === 'approve' ? 'var(--underway)' : 'var(--fg)'}`)}>{m[4] === 'next' ? 'Next' : m[5] === 'approve' ? 'Minutes to approve' : 'Minutes approved'}</span></button>;
        })}</div>, <><span>Minutes are filed in Records once approved</span><span /></>);
      const resos = cell('s12', 'Resolutions', <span className="lbl">{RESOS.length}{" this quarter"}</span>, <div className="gt-rl wide">{RESOS.map(r => resoRow(r))}</div>, <><span className="f-key">{['y', 'n', 'r'].map((k, __k) => <span key={__k}><i style={css(`background:${VOTEC[k][1]}`)} />{VOTEC[k][0]}</span>)}<span><i className="gt-ab" />Absent</span></span><span>Every board vote is on the record by name</span></>);
      html(document.getElementById('gv'), <>{band(seats, 1)}{band(<>{next}{mtgs}</>)}{band(resos)}</>);
    }

    /* ══ Entities ══════════════════════════════════════════════════════════════════════════════════════════════ */
    const ENTXY = {
      coop: [50, 14],
      fdn: [12, 14],
      labs: [12, 46],
      fin: [37, 46],
      hold: [63, 46],
      dt: [88, 46],
      mgr: [40, 77],
      prop: [63, 77],
      lend: [86, 77]
    };
    function entFoot(id) {
      const e = ENTO[id],
        F = ENTF[id];
      const r = e[3] === 'formed' ? F.formed ? typeof F.formed === 'number' ? `Since ${fmtD(F.formed)}` : F.formed : 'Date not recorded' : F.steps ? `${F.steps.filter(x => x[1]).length} of ${F.steps.length} steps${F.due ? ' · ' + fmtD(F.due) : ''}` : '';
      return <span className="gt-nf"><em style={css(`--c:${EST[e[3]][1]}`)}>{EST[e[3]][0]}</em><span>{e[3] === 'planned' && !F.due ? 'When needed' : r}</span></span>;
    }
    function entMap() {
      const seatsOf = id => {
        const b = GBOARDS.find(x => x[0] === id);
        return b ? <span className="gt-ns" title={`${b[1]}: ${b[3].filter(s => s[1]).length} of ${b[3].length} seats filled`}>{b[3].map((st, __k) => <i key={__k} className={st[1] ? 'on' : ''} />)}</span> : '';
      };
      const box = id => {
        const e = ENTO[id],
          [x, y] = ENTXY[id];
        return <button className={`gt-n ${e[3]} ${id === 'fdn' ? 'own0' : ''}`} style={css(`left:${x}%;top:${y}%`)} data-gent={id}><span className="gt-nh"><b>{e[1]}</b><span className="gt-nk"><span>{e[2]}</span>{seatsOf(id)}</span></span>{entFoot(id)}</button>;
      };
      const H = 9.6; /* half a box's height (46px of 480), in % of the map */
      const lines = Object.entries(PARENT).filter(([k, p]) => p && ENTXY[k] && ENTXY[p]).map(([k, p], __k) => {
        const [x1, y1] = ENTXY[p],
          [x2, y2] = ENTXY[k],
          my = (y1 + H + y2 - H) / 2;
        return <path key={__k} className="gt-ln" d={`M${x1} ${y1 + H} V${my} H${x2} V${y2 - H}`} />;
      });
      const bus = 93.5,
        [mx] = ENTXY.mgr,
        my2 = ENTXY.mgr[1] + H;
      const manages = <path className="gt-ln mg" d={`M${mx} ${my2} V${bus} H${ENTXY.lend[0]} V${my2} M${ENTXY.prop[0]} ${bus} V${my2}`} />;
      const labels = Object.entries(OWN).filter(([k]) => ENTXY[k]).map(([k, v], __k) => {
        const [x, y] = ENTXY[k];
        return <span key={__k} className="gt-own" style={css(`left:${x}%;top:${y - H - 1.2}%`)}>{v.split(',')[0]}</span>;
      });
      const cx = ENTXY.fdn[0] - 6;
      return <><div className="gt-map"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{lines}{manages}<path className="gt-ln ct" d={`M${cx} ${ENTXY.fdn[1] + H} V${ENTXY.labs[1] - H}`} /></svg>{labels}<span className="gt-own gt-tl" style={css(`left:${ENTXY.coop[0]}%;top:${ENTXY.coop[1] - H - 1.5}%`)}>Owned by the members</span><span className="gt-own gt-tl" style={css(`left:${ENTXY.fdn[0]}%;top:${ENTXY.fdn[1] - H - 1.5}%`)}>Outside the tree</span><span className="gt-own ct" style={css(`left:${cx}%;top:${(ENTXY.fdn[1] + ENTXY.labs[1]) / 2}%`)}>Maintains for</span><span className="gt-own ct mg" style={css(`left:${(ENTXY.prop[0] + ENTXY.lend[0]) / 2}%;top:${bus}%`)}>Manages</span>{Object.keys(ENTXY).filter(k => ENTO[k]).map(box)}</div><div className="gt-mapl">{['coop', 'fin', 'dt', 'hold', 'mgr', 'prop', 'lend', 'labs', 'fdn'].map(k => ENTO[k]).filter(Boolean).map((e, __k) => {
            const depth = e[0] === 'coop' || e[0] === 'fdn' ? 0 : ['fin', 'dt', 'hold', 'labs'].includes(e[0]) ? 1 : 2;
            const b = GBOARDS.find(x => x[0] === e[0]);
            return <button key={__k} className={`gt-ml-r d${depth} ${e[3]}`} data-gent={e[0]}><i /><span><b>{e[1]}</b><em>{e[0] === 'fdn' ? 'Outside the tree · ownerless · ClearLabs maintains for it' : e[0] === 'mgr' && !LG ? '100% owned by Clear Capital Holdings · manages both funds' : PARENT[e[0]] ? `${OWN[e[0]].split(',')[0]} owned by ${ENTO[PARENT[e[0]]][1]}` : e[2]}</em></span>{b ? <span className="gt-ns">{b[3].map((st, __k) => <i key={__k} className={st[1] ? 'on' : ''} />)}</span> : <span />}<span className="gt-st" style={css(`--c:${EST[e[3]][1]}`)}>{EST[e[3]][0]}</span></button>;
          })}</div></>;
    }
    function renderEntities() {
      if (LG) return renderEntitiesLive();
      const map = cell('s12', 'Who owns what', <span className="lbl">{ENT.filter(e => e[3] === 'formed').length}{" of "}{ENT.length}{" formed"}</span>, <div className="gt-mapw">{entMap()}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Formed</span><span><i style={css("background:var(--underway)")} />Forming</span><span><i className="hx" />Planned</span><span><i className="gt-dash" />Ownerless</span></span><span>The co-op owns everything inside the tree</span></>);
      const F = ENT.filter(e => e[3] !== 'formed');
      const forming = cell('s7', 'Forming', <span className="lbl">{F.length}{" entities"}</span>, <div className="gt-fl">{F.map((e, __k) => {
          const S = ENTF[e[0]].steps,
            d = S.filter(s => s[1]).length,
            nx = S.find(s => !s[1]);
          return <button key={__k} className={`gt-fr ${e[3]}`} data-gent={e[0]}><span className="gt-ck"><b>{e[1]}</b><span>{nx ? `Next: ${nx[0].toLowerCase()}` : 'Done'}{ENTF[e[0]].due ? ` · due ${fmtD(ENTF[e[0]].due)}` : ' · when it’s needed'}</span></span><span className="gt-fs">{S.map((s, i) => <i key={i} className={s[1] ? 'on' : i === d ? 'nx' : ''} title={s[0]} />)}</span><span className="gt-fn">{d}{" of "}{S.length}</span></button>;
        })}</div>, <><span>Planned entities form when they’re needed, not before</span><span /></>);
      const res = cell('s5', 'Reserved matters', <span className="lbl">The co-op’s veto at Holdings</span>, <div className="gt-rm">{RESERVED.map(([t, w], __k) => <div key={__k}><span>{t}</span><b className={/member/.test(w) ? 'mv' : ''}>{w}</b></div>)}</div>, <><span>A veto doesn’t shrink as the board grows</span><span /></>);
      html(document.getElementById('gv'), <>{band(map, 1)}{band(<>{forming}{res}</>)}</>);
    }

    /* ══ Agreements ════════════════════════════════════════════════════════════════════════════════════════════ */
    function waitOf(a) {
      return ['out', 'draft'].includes(a.st) || (VERS[a.id] || []).some(v => v[2] === 'vote');
    }
    function nextV(a) {
      return (VERS[a.id] || []).find(v => v[2] === 'vote' || v[2] === 'draft');
    }
    function renderAgreements() {
      if (LG) return renderAgreementsLive();
      const F = [['all', 'All'], ['wait', 'Waiting'], ['renew', 'Renewing'], ['signed', 'Signed']];
      const ok = a => G.ag === 'all' || (G.ag === 'wait' ? waitOf(a) : a.st === G.ag);
      const L = AGR.filter(ok);
      const list = cell('s12', 'Every agreement', <div className="seg sm" role="group" aria-label="Which agreements">{F.map(([k, t], __k) => <button key={__k} data-gag={k} aria-pressed={G.ag === k}>{t}{" "}{k === 'all' ? AGR.length : AGR.filter(a => k === 'wait' ? waitOf(a) : a.st === k).length}</button>)}</div>, <div className="gt-al">{L.length ? AGR_T.map(([k, t], __k) => {
          const A = L.filter(a => a.type === k);
          return A.length ? <Fragment key={__k}><div className="gv-g">{lbl(`${t} · ${A.length}`)}</div>{A.map((a, __k) => <button key={__k} className={`gt-ar st-${a.st}`} data-gagr={a.id}><span className="gt-ck"><b>{a.name}</b><span>{a.party}</span></span><span className="gt-avw"><span className="mono gt-av">{a.ver}</span>{nextV(a) && nextV(a)[0] !== a.ver ? <em className={`gt-nx ${nextV(a)[2]}`}>{nextV(a)[0]}{" · "}{nextV(a)[2] === 'vote' ? 'vote' : 'draft'}</em> : ''}</span><span className="gt-ad">{a.st === 'out' ? `Sent ${fmtD(a.sent)}` : a.a ? `Signed ${fmtD(a.a)}${new Date(a.a).getUTCFullYear() < 2026 ? ' ' + new Date(a.a).getUTCFullYear() : ''}` : a.st === 'vote' ? 'Not adopted yet' : 'Not signed'}<em>{a.b ? `${a.st === 'renew' ? 'Renews' : 'Runs to'} ${fmtD(a.b)}${new Date(a.b).getUTCFullYear() > 2026 ? ' ' + new Date(a.b).getUTCFullYear() : ''}` : a.roll ? 'Month to month' : a.st === 'signed' ? 'No end date' : ''}</em></span><span className="gt-st" style={css(`--c:${AST[a.st][1]}`)}>{AST[a.st][0]}</span><span className="gv-go">{ICO.chev}</span></button>)}</Fragment> : '';
        }) : <div className="gv-e"><span>Nothing here right now</span></div>}</div>, <><span>Signed copies come back from the e-signature tool and are kept in Records</span><span className="quiet">{L.length}{" agreements"}</span></>);
      const R = AGR.filter(a => a.st === 'renew').sort((a, b) => a.b - b.b);
      const renew = cell('s7', 'Renewing', <span className="lbl">Next 90 days</span>, calList(R.map(a => ({
        t: a.b,
        kind: 'renew',
        title: `${a.name} · ${a.party}`,
        ent: a.type === 'company' ? 'coop' : 'fin',
        st: 'next',
        owner: 'kai',
        at: `data-gagr="${a.id}"`
      }))), <><span>Renewals go to the board when terms change</span><span /></>);
      const W = AGR.filter(waitOf);
      const wait = cell('s5', 'Waiting on someone', <span className="lbl">{W.length}{" agreements"}</span>, <div className="gt-wl">{W.map((a, __k) => <button key={__k} className={`gt-wr st-${a.st}`} data-gagr={a.id}><i style={css(`background:${a.st === 'out' ? AST.out[1] : nextV(a) && nextV(a)[2] === 'vote' ? 'var(--live)' : AST[a.st][1]}`)} /><span className="gt-ck"><b>{a.party}</b><span>{a.name}{" "}{nextV(a) && a.st !== 'out' ? nextV(a)[0] : a.ver}</span></span><span className="gt-wn">{a.st === 'out' ? 'You' : nextV(a) && nextV(a)[2] === 'vote' ? 'Members' : 'Kai · counsel'}</span></button>)}</div>, <><span>The member agreement changes by member vote</span><span /></>);
      /* versions of the standard agreements, on one timeline */
      const t0 = D(1, 1),
        t1 = Date.UTC(2027, 1, 1),
        X = t => (Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) * 100).toFixed(2);
      const fam = Object.keys(VERS).map(id => AGR.find(a => a.id === id)).filter(Boolean);
      const ticks = [D(1, 1), D(3, 1), D(5, 1), D(7, 1), D(9, 1), D(11, 1), Date.UTC(2027, 0, 1)];
      const vers = cell('s12', 'Versions', <span className="lbl">Standard agreements · 2026</span>, <div className="gt-vl"><div className="gt-vr hd2"><span>{lbl('Agreement')}</span><span className="gt-vt">{ticks.map((t, __k) => <span key={__k} style={css(`left:${X(t)}%`)}>{MON[new Date(t).getUTCMonth()]}</span>)}<span className="now" style={css(`left:${X(NOW)}%`)}>Today</span></span>{lbl('In force')}{lbl('Who’s on it')}</div>{fam.map((a, __k) => {
          const V = VERS[a.id],
            cur = V.filter(v => v[2] === 'in').pop(),
            nx = V.find(v => v[2] === 'vote' || v[2] === 'draft'),
            U = VUSE[a.id],
            ut = U ? U.reduce((s, u) => s + u[1], 0) : 0;
          return <button key={__k} className="gt-vr" data-gagr={a.id}><span className="gt-ck"><b>{a.name}</b><span>{a.party}</span></span><span className="gt-vt"><i className="g" style={css(`left:${X(NOW)}%`)} /><i className="ln" style={css(`left:${X(V[0][1])}%;right:${100 - X(NOW)}%`)} />{nx ? <i className="ln f" style={css(`left:${X(NOW)}%;right:${100 - X(nx[1])}%`)} /> : ''}{V.map((v, __k) => <i key={__k} className={`dot ${v[2]}`} style={css(`left:${X(v[1])}%`)} title={`${v[0]} · ${VST[v[2]][0]}`}><em>{v[0]}</em></i>)}</span><span className="gt-vc"><b className="mono">{cur ? cur[0] : '—'}</b><em>{nx ? `${nx[0]} · ${VST[nx[2]][0].toLowerCase()}` : 'No changes planned'}</em></span><span className="gt-vu">{U ? <><span className="gt-vb">{U.map((u, i) => <i key={i} style={css(`flex:${u[1]};background:${u[0] === cur[0] ? 'var(--fg)' : 'color-mix(in srgb,var(--fg) 30%,transparent)'}`)} title={`${u[0]} · ${u[1]}`} />)}</span><em>{U.map(u => `${u[1]} on ${u[0]}`).join(' · ')}</em></> : <em>{a.type === 'company' ? 'Both companies sign each version' : 'Everyone, once adopted'}</em>}</span></button>;
        })}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />In force</span><span><i className="gt-ko" />Replaced</span><span><i className="gt-ko vote" />On the ballot</span><span><i className="hx" />In draft</span></span><span>Every version is kept, with what changed and who approved it</span></>);
      html(document.getElementById('gv'), <>{band(list, 1)}{band(vers)}{band(<>{renew}{wait}</>)}</>);
    }

    /* ── a month as a grid: Monday first, today marked, up to three things a day ── */
    function monthGrid(items, mo, col, more) {
      const base = Date.UTC(Y0, M0 + mo, 1),
        d0 = new Date(base),
        y = d0.getUTCFullYear(),
        m = d0.getUTCMonth(),
        next = Date.UTC(y, m + 1, 1);
      const lead = (d0.getUTCDay() + 6) % 7,
        start = base - lead * DAY,
        weeks = Math.ceil((lead + Math.round((next - base) / DAY)) / 7);
      const cells = Array.from({
        length: weeks * 7
      }, (_, i) => {
        const t = start + i * DAY,
          d = new Date(t),
          out = t < base || t >= next,
          wk = i % 7 >= 5;
        const es = items.filter(c => c.t >= t && c.t < t + DAY);
        return <div key={i} className={`gm-d ${out ? 'out' : ''} ${wk ? 'wk' : ''} ${t === TODAY ? 'today' : ''} ${t < TODAY ? 'past' : ''}`}><span className="gm-n">{d.getUTCDate() === 1 ? MON[d.getUTCMonth()] + ' 1' : d.getUTCDate()}</span>{es.slice(0, 3).map((c, __k) => <button key={__k} className={`gm-e ${col(c)[1] || ''}`} {...attrs(c.at)} style={css(`--c:${col(c)[0]}`)} title={c.title}><i /><span>{c.title}</span></button>)}{es.length > 3 ? <span className="gm-more">+{es.length - 3}{" more"}</span> : ''}</div>;
      });
      return <div className="gm"><div className="gm-h">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x, __k) => <span key={__k}>{x}</span>)}</div><div className="gm-g">{cells}</div></div>;
    }
    const monthName = mo => {
      const d = new Date(Date.UTC(Y0, M0 + mo, 1));
      return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    };
    const viewSeg = (key, v) => <div className="seg sm gm-sw" role="group" aria-label="View"><button {...{ [`data-${key}`]: 'list' }} aria-pressed={v === 'list'}>List</button><button {...{ [`data-${key}`]: 'month' }} aria-pressed={v === 'month'}>Month</button></div>;
    const monthNav = (key, mo, max) => <span className="pg2"><span>{monthName(mo)}</span>{mo ? <button className="gm-today" {...{ [`data-${key}`]: '0' }}>Today</button> : ''}<button {...{ [`data-${key}`]: `${mo - 1}` }} disabled={mo <= 0} aria-label="Previous month">{ICO.back}</button><button {...{ [`data-${key}`]: `${mo + 1}` }} disabled={mo >= max} aria-label="Next month">{ICO.chev}</button></span>;

    /* ══ Calendar ══════════════════════════════════════════════════════════════════════════════════════════════ */
    function renderCalendar() {
      const E = [['all', 'All'], ['coop', 'Co-op'], ['fin', 'Financial'], ['hold', 'Holdings'], ['labs', 'ClearLabs'], ['dt', 'D&T Co.'], ['fdn', 'Foundation']];
      const all = calItems().filter(c => c.t >= Date.UTC(Y0, M0, 1) && (G.cal === 'all' || c.ent === G.cal));
      const months = Array.from({
        length: 12
      }, (_, i) => Date.UTC(Y0, M0 + i, 1));
      const colOf = c => c.kind === 'filing' ? [FST[c.st][1], c.st === 'later' ? 'later' : ''] : c.st === 'late' ? ['var(--absent)'] : [CALK[c.kind][1]];
      const strip = <div className="gt-ms">{months.map((m, i) => {
          const n = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth() + 1, 1),
            I = all.filter(c => c.t >= m && c.t < n);
          return <button key={i} className={`gt-m ${m <= NOW && NOW < n ? 'now' : ''} ${G.cv === 'month' && G.mo === i ? 'on' : ''}`} data-gmo={i} data-gmv="1"><span className="lbl">{MON[new Date(m).getUTCMonth()]}</span><b>{I.length || ''}</b><span className="gt-mq">{I.map((c, __k) => <i key={__k} style={css(`background:${colOf(c)[0]}`)} className={c.st === 'later' ? 'hxl' : ''} />)}</span></button>;
        })}</div>;
      const right = <>{viewSeg('gcv', G.cv)}<div className="seg sm" role="group" aria-label="Entity">{E.map(([k, t], __k) => <button key={__k} data-gcal={k} aria-pressed={G.cal === k}>{t}</button>)}</div></>;
      const key = <span className="f-key"><span><i style={css("background:var(--settled)")} />Ready</span><span><i style={css("background:var(--underway)")} />Drafting</span><span><i style={css("background:var(--absent)")} />Not started</span><span><i className="hx" />Later</span><span><i style={css("background:var(--live)")} />Meeting</span></span>;
      let cal;
      if (G.cv === 'month') {
        const m = months[G.mo],
          n = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth() + 1, 1),
          I = all.filter(c => c.t >= m && c.t < n);
        cal = cell('s12', monthName(G.mo), <div className="gt-cr-h">{right}</div>, <>{strip}{monthGrid(all, G.mo, colOf)}<div className="gm-list">{I.length ? calList(I, 'flat') : <div className="gv-e"><span>{"Nothing in "}{monthName(G.mo).split(' ')[0]}</span></div>}</div></>, <>{key}{monthNav('gmo', G.mo, 11)}</>);
      } else {
        const groups = months.map((m, __k) => {
          const n = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth() + 1, 1),
            I = all.filter(c => c.t >= m && c.t < n);
          return I.length ? <Fragment key={__k}><div className="gv-g">{lbl(`${MON[new Date(m).getUTCMonth()]} ${new Date(m).getUTCFullYear()} · ${I.length}`)}</div>{calList(I, 'flat')}</Fragment> : '';
        });
        cal = cell('s12', 'Next 12 months', <div className="gt-cr-h">{right}</div>, <>{strip}<div className="gt-cal">{groups.some(Boolean) ? groups : <div className="gv-e"><span>Nothing due for this entity</span></div>}</div></>, <>{key}<span className="quiet">{all.length}{" dates"}</span></>);
      }
      html(document.getElementById('gv'), band(cal, 1));
    }

    /* ══ Panels ════════════════════════════════════════════════════════════════════════════════════════════════ */
    function entPanel(id) {
      const e = ENTO[id],
        F = ENTF[id],
        kids = Object.keys(PARENT).filter(k => PARENT[k] === id),
        fil = FILINGS.filter(f => f[1] === id && f[4] !== 'done');
      const rows = [['Kind', e[2]], ['Status', EST[e[3]][0]], ['Owned by', id === 'fdn' ? 'No one · it’s ownerless' : PARENT[id] ? `${ENTO[PARENT[id]][1]} · ${OWN[id]}` : 'Its members · one member, one vote'], ...(kids.length ? [['Owns', kids.map((k, i) => <Fragment key={i}>{i ? ', ' : ''}<button className="lnk3" data-gent={k}>{ENTO[k][1]}</button></Fragment>)]] : []), ['Taxed as', F.tax], ...(F.formed ? [['Formed', fD(F.formed)], ['EIN', F.ein], ['Officers', F.officers]] : [])];
      return <><div className="pn-hd"><span className="lbl">Entity</span><button className="x" data-gclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div><p className="bpn-t">{e[1]}</p><p className="bpn-s">{e[4]}</p></div><div className="led">{rows.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{F.steps ? <div>{lbl(`Forming${F.due ? ` · due ${fmtD(F.due)}` : ''}`)}<div className="led gv-cl">{F.steps.map(([k, ok], __k) => <div key={__k}><span><i className={ok ? 'ok' : ''} />{k}</span><b>{ok ? 'Done' : 'To do'}</b></div>)}</div></div> : ''}{F.agr.length ? <div>{lbl('Agreements')}<div className="led">{F.agr.map((a, __k) => {
                const x = AGR.find(y => y.id === a);
                return x ? <div key={__k}><span><button className="lnk3" data-gagr={x.id}>{x.name}</button></span><b>{AST[x.st][0]}</b></div> : '';
              })}</div></div> : ''}{fil.length ? <div>{lbl('Due')}{calList(fil.map(f => ({
              t: f[3],
              kind: 'filing',
              title: f[2],
              ent: f[1],
              st: f[4],
              owner: f[5],
              at: `data-gfile="${f[0]}"`
            })), 'pn')}</div> : ''}</div><div className="pn-ft">{LG && STAFF() ? <>{F.steps && F.steps.some(s => !s[1]) ? <span className="small quiet" style={css("margin-right:auto")}>{"Next: "}{F.steps.find(s => !s[1])[0].toLowerCase()}</span> : <span className="small quiet" style={css("margin-right:auto")}>Documents are kept in Records</span>}<button className="btn" data-gflow="log" data-gid={id}>Log a decision</button>{F.steps && F.steps.some(s => !s[1]) ? <button className="btn p" data-gflow="form" data-gid={id}>Mark it done</button> : ''}</> : <><span className="small quiet" style={css("margin-right:auto")}>Documents are kept in Records</span><button className="btn" data-gclose="">Close</button></>}</div></>;
    }
    function agrPanel(id) {
      const a = AGR.find(x => x.id === id),
        ents = Object.entries(ENTF).filter(([k, f]) => f.agr.includes(id)).map(([k]) => k);
      const rows = [['With', a.party], ['Kind', (AGR_T.find(t => t[0] === a.type) || [, a.type])[1]], ['Version', a.ver], ['Status', AST[a.st][0]], ...(a.a ? [['Signed', fmtD(a.a) + (LG && new Date(a.a).getUTCFullYear() !== Y0 ? ' ' + new Date(a.a).getUTCFullYear() : '')]] : []), ...(a.sent ? [['Sent', fmtD(a.sent)]] : []), ['Runs to', a.b ? fmtD(a.b) + ' ' + new Date(a.b).getUTCFullYear() : a.roll ? 'Month to month' : 'No end date'], ...(ents.length ? [['Our side', ents.map((k, i) => <Fragment key={i}>{i ? ', ' : ''}<button className="lnk3" data-gent={k}>{ENTO[k][1]}</button></Fragment>)]] : []), ...(a.prop ? [['The vote', <button className="lnk3" data-gopen={a.prop}>{a.prop}{" · voting now"}</button>]] : [])];
      const ft = LG ? STAFF() && a.st === 'out' ? <><button className="btn" data-gclose="">Not now</button><button className="btn p" data-gsign={a.id}>Sign it</button></> : STAFF() && a.st === 'renew' ? <><button className="btn" data-gclose="">Not now</button><button className="btn p" data-grenew={a.id}>Start the renewal</button></> : <><span className="small quiet" style={css("margin-right:auto")}>{AST[a.st][0]}</span><button className="btn" data-gclose="">Close</button></> : a.st === 'out' && STAFF() ? <><button className="btn" data-gclose="">Not now</button><button className="btn p" data-gsign={a.id}>Sign it</button></> : VERS[a.id] && STAFF() ? <><button className="btn" data-gcompare={a.id}>Compare versions</button><button className="btn p" data-gdraft={a.id}>Start a new version</button></> : <><span className="small quiet" style={css("margin-right:auto")}>{AST[a.st][0]}</span><button className="btn" data-gclose="">Close</button></>;
      return <><div className="pn-hd"><span className="lbl">Agreement</span><button className="x" data-gclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div><p className="bpn-t">{a.name}</p><p className={`bpn-s ${a.st === 'out' ? 'me' : ''}`}>{a.party}</p></div><p className="bpn-n">{a.note}</p><div className="led">{rows.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{a.st === 'out' ? LG && a.type !== 'merchant' ? <p className="bpn-w"><b>Your signature makes it final.</b>{" You sign in the e-signature tool, and it comes back here marked signed."}</p> : <p className="bpn-w"><b>Your signature makes it final.</b>{" Then the shop is added to MerchantRegistry through the Ops Safe, in Build."}</p> : ''}{VERS[a.id] ? <div className="gt-vh">{lbl(`Versions · ${VERS[a.id].length}`)}{VERS[a.id].slice().reverse().map((v, i) => <div key={i} className={`gt-vh-r ${v[2]}`}><span className="gt-vh-d"><i /></span><span className="gt-vh-k"><span className="gt-vh-t"><b className="mono">{v[0]}</b><span className="gt-st" style={css(`--c:${VST[v[2]][1]}`)}>{VST[v[2]][0]}</span><span className="quiet">{v[2] === 'in' || v[2] === 'old' ? fmtD(v[1]) + (new Date(v[1]).getUTCFullYear() < 2026 ? ' ' + new Date(v[1]).getUTCFullYear() : '') : v[2] === 'vote' ? 'Closes ' + fmtD(v[1]) : 'For ' + fmtD(v[1])}</span></span><em>{v[3]}</em><ul className="gt-chg">{v[4].map((c, __k) => <li key={__k} className={c[0] === '+' ? 'add' : c[0] === '~' ? 'chg' : 'del'}><span>{c[0] === '+' ? '+' : c[0] === '~' ? '~' : '−'}</span>{c.slice(2)}</li>)}</ul></span></div>)}</div> : ''}</div><div className="pn-ft">{ft}</div></>;
    }
    function mtPanel(id) {
      if (LG) return mtPanelLive(id);
      const m = MEETINGS.find(x => x[0] === id),
        b = GBOARDS.find(x => x[0] === m[1]);
      return <><div className="pn-hd"><span className="lbl">{b[1]}{" · meeting"}</span><button className="x" data-gclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div><p className="bpn-t">{WD(m[2])}{" "}{fmtD(m[2])}{" · "}{hm(m[2])}</p><p className="bpn-s">{m[3]}</p></div>{m[4] === 'next' ? <><div>{lbl('Agenda')}<div className="led">{AGENDA.map((x, __k) => <div key={__k}><span>{x[0]}</span><b>{x[1]}{" min · "}{AK[x[3]][0]}</b></div>)}</div></div><p className="bpn-n">Members can watch the open session live in Community. Private items, like a named member’s account, are taken in closed session and left out.</p></> : <div className="led">{[['Minutes', m[5] === 'approve' ? 'Drafted · approved at the next meeting' : 'Approved and filed in Records'], ['Seats present', `${b[3].filter(s => s[1]).length} of ${b[3].filter(s => s[1]).length}`], ['Decided', `${RESOS.filter(r => r[1] === m[1] && Math.abs(r[0] - Date.UTC(new Date(m[2]).getUTCFullYear(), new Date(m[2]).getUTCMonth(), new Date(m[2]).getUTCDate())) < DAY).length} resolutions`]].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>}</div><div className="pn-ft">{m[4] === 'next' ? <><button className="btn" data-gcomm="">Broadcast · Community</button><button className="btn p" data-gclose="">Done</button></> : <><span className="small quiet" style={css("margin-right:auto")}>{m[5] === 'approve' ? 'Minutes to approve' : 'Minutes approved'}</span><button className="btn" data-gclose="">Close</button></>}</div></>;
    }

    /* ══ Governance — Proposals first ══════════════════════════════════════════════════════════════════════════════
       Every decision the co-op makes, from a member's draft to the thing actually being done. Discussion runs alongside
       every step; the text freezes when voting opens; member ballots stay sealed until the close. */
    const G = {
      tab: 'overview',
      cal: 'all',
      ag: 'all',
      cv: 'list',
      mo: 0,
      set: 'open',
      st: null,
      panel: null,
      me: 'kai',
      pp: 0,
      back: false
    };
    const ICO = {
      chev: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>,
      back: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>,
      x: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>,
      arrow: <svg viewBox="0 0 8 12" aria-hidden="true"><path d="M1.5 1.5 6.5 6l-5 4.5" /></svg>,
      talk: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" /></svg>
    };
    const cell = (cls, title, right, body, foot) => <div className={`cell ${cls}`}><div className="hd"><h2>{title}</h2><div className="r">{right}</div></div>{body}<div className="bk-ft">{foot}</div></div>;
    const lbl = t => <span className="lbl">{t}</span>;
    const band = (cells, first) => <section className="band" {...attrs(first ? ' style="margin-top:0"' : '')}><div className="bento">{cells}</div></section>;
    const pager = (p, n, per, key) => {
      const pages = Math.max(1, Math.ceil(n / per));
      return <span className="pg2"><span>{n ? p * per + 1 : 0}–{Math.min(n, (p + 1) * per)}{" of "}{n}</span><button {...{ [`data-${key}`]: '-1' }} disabled={p === 0} aria-label="Previous">{ICO.back}</button><button {...{ [`data-${key}`]: '1' }} disabled={p >= pages - 1} aria-label="Next">{ICO.chev}</button></span>;
    };
    const av = k => <span className="av sm" title={PPL[k] ? PPL[k].n : mm(k)}>{PPL[k] ? PPL[k].ini : k.toUpperCase()}</span>;
    const byName = k => PPL[k] ? who(k) : mm(k);
    const STAFF = () => LG ? !RO() && LG.can() : !RO() && !!PPL[G.me] && (PPL[G.me].staff || PPL[G.me].board);

    /* where a proposal stands */
    const tasksOpen = p => (p.tasks || []).filter(t => t[4] !== 'done');
    const isOpen = p => ['draft', 'sponsor', 'check', 'vote'].includes(p.st) || p.st === 'done' && tasksOpen(p).length;
    const quorumN = p => RULES[p.type].q ? Math.ceil(MEMBERS * RULES[p.type].q) : null;
    const stateTxt = p => ({
      draft: () => `Draft v${p.ver}${p.coauth ? ` · ${p.coauth.length} co-author${p.coauth.length > 1 ? 's' : ''}` : ''}`,
      sponsor: () => `${p.sponsors} of ${SPONSORS} co-signers · ${SPONSORS - p.sponsors} more by ${fmtD(p.sponsorBy)}`,
      check: () => p.type === 'elect' ? `Nominations open · ${p.nominations} so far` : `${p.checker === G.me ? 'You’re checking it' : `Being checked by ${who(p.checker)}`} · due ${WD(p.checkDue)} ${fmtD(p.checkDue)}`,
      vote: () => p.board ? `On the board’s agenda for ${fmtD(p.board)}` : `${p.cast} of ${MEMBERS} voted · closes ${fmtD(p.voteClose)}`,
      decided: () => p.result === 'passed' ? `Passed ${fmtD(p.decidedAt)}` : p.result === 'quorum' ? `Didn’t count · ${p.cast} voted, ${quorumN(p)} needed` : `Failed ${fmtD(p.decidedAt)}`,
      done: () => tasksOpen(p).length ? `Passed ${fmtD(p.decidedAt)} · ${tasksOpen(p).length} of ${p.tasks.length} tasks left` : `Carried out · all ${p.tasks.length} tasks done`,
      withdrawn: () => p.why,
      expired: () => p.why
    })[p.st]();

    /* the progress mark each row carries: one bar, a caption under it, the figure that matters on the right */
    function prog(p) {
      const bar = (f, cls = '', tick) => <span className={`gv-bar ${cls}`}><i style={css(`width:${Math.min(100, f * 100)}%`)} />{tick != null ? <s style={css(`left:${Math.min(100, tick * 100)}%`)} /> : ''}</span>;
      const cap = (l, r, rc = '') => <span className="gv-cap"><span>{l}</span><b className={rc}>{r}</b></span>;
      if (p.st === 'sponsor') return <>{bar(p.sponsors / SPONSORS, 'gb-sp')}{cap(`${p.sponsors} co-signers`, `${SPONSORS} needed`)}</>;
      if (p.st === 'vote' && !p.board) return <>{bar(p.cast / MEMBERS, 'gb-vt', RULES[p.type].q)}{cap(`${p.cast} voted`, p.cast >= quorumN(p) ? 'Enough to count' : `${quorumN(p)} needed`, p.cast >= quorumN(p) ? 'ok' : '')}</>;
      if (p.st === 'vote') return <>{bar(0, 'gb-hx')}{cap('Board vote', fmtD(p.board))}</>;
      if (p.st === 'check') return p.checks ? <>{bar(p.checks.filter(c => c[2]).length / p.checks.length, 'gb-ck')}{cap(`${p.checks.filter(c => c[2]).length} of ${p.checks.length} checks`, p.type === 'elect' ? `${p.nominations} nominated` : `${who(p.checker)}`)}</> : '';
      if (p.st === 'done') {
        const n = p.tasks.length,
          d = p.tasks.filter(t => t[4] === 'done').length,
          late = p.tasks.filter(t => t[4] === 'late').length;
        return <><span className="gv-tk">{p.tasks.map((t, __k) => <i key={__k} className={t[4]} />)}</span>{cap(`${d} of ${n} tasks done`, late ? `${late} late` : d === n ? 'Done' : 'On time', late ? 'bad' : d === n ? 'ok' : '')}</>;
      }
      if (p.st === 'decided') return <>{bar(p.cast / MEMBERS, 'gb-off', RULES[p.type].q)}{cap(`${p.cast} voted`, p.result === 'quorum' ? `${quorumN(p)} needed` : p.result === 'passed' ? 'Passed' : 'Failed', p.result === 'passed' ? 'ok' : 'bad')}</>;
      if (p.st === 'draft') return <>{bar(0, 'gb-hx')}{cap(`Version ${p.ver}`, p.coauth ? `${p.coauth.length} co-authors` : 'Solo')}</>;
      return <>{bar(0)}{cap(p.st === 'withdrawn' ? 'Withdrawn' : `${p.sponsors} of ${SPONSORS} co-signers`, p.st === 'withdrawn' ? 'By the author' : 'Expired')}</>;
    }
    /* what happens next, and when */
    function nextOf(p) {
      const t = p.st === 'vote' ? p.board ? ['Board meets', p.board] : ['Closes', p.voteClose] : p.st === 'check' ? [p.type === 'elect' ? 'Nominations end' : 'Check due', p.checkDue] : p.st === 'sponsor' ? ['Expires', p.sponsorBy] : p.st === 'draft' ? ['Started', p.opened] : p.st === 'done' ? (() => {
        const o = p.tasks.filter(x => x[4] !== 'done').sort((a, b) => a[3] - b[3])[0];
        return o ? ['Next task due', o[3], o[4] === 'late'] : ['Done by', Math.max(...p.tasks.map(x => x[3]))];
      })() : p.st === 'decided' ? ['Decided', p.decidedAt] : ['Ended', p.endedAt];
      return <span className={`gv-n ${t[2] ? 'bad' : ''}`}>{lbl(t[0])}<b>{WD(t[1])}{" "}{fmtD(t[1])}</b></span>;
    }

    /* ── header ── */
    function renderHdr() {
      if (LG) return renderHdrLive();
      const v = PROPS.filter(p => p.st === 'vote' && !p.board),
        v0 = v[0],
        pipe = PROPS.filter(p => ['draft', 'sponsor', 'check'].includes(p.st)),
        T = PROPS.flatMap(p => (p.tasks || []).map(t => [p, t])),
        late = T.filter(([p, t]) => t[4] === 'late');
      const soon = calItems().filter(c => c.t >= TODAY && c.t < TODAY + 25 * DAY && c.kind === 'filing' && c.st !== 'done');
      const brief = {
        overview: <>{"Members are voting on "}<a data-gopen={v0.id}>{v0.t.replace(/^Adopt /, '')}</a>{", and enough have voted for it to count. "}{late.length ? <>{"One passed decision is "}<a data-gopen={late[0][0].id}>running late</a>.</> : 'Every passed decision is on time.'}</>,
        proposals: <>{PROPS.filter(isOpen).length}{" proposals are open. "}{pipe.length}{" are on the way to a vote and "}<a data-gopen={v0.id}>{v0.id}</a>{" closes "}{WD(v0.voteClose)}{" "}{fmtD(v0.voteClose)}.</>,
        boards: <>{"The co-op board meets "}<a data-gmt="M-14">{WD(MEETINGS[0][2])}{" "}{fmtD(MEETINGS[0][2])}</a>{" with "}{AGENDA.length}{" items. "}{GBOARDS.filter(b => !b[4]).reduce((a, b) => a + b[3].filter(s => !s[1]).length, 0)}{" seats are open across three boards."}</>,
        entities: <>{ENT.filter(e => e[3] === 'formed').length}{" of "}{ENT.length}{" entities are formed. "}<a data-gent="dt">The Deed & Title Co.</a>{" files to form by "}{fmtD(ENTF.dt.due)}.</>,
        agreements: <><a data-gagr="icw">Inland Cycle Works</a>{" signed and waits on you. "}{AGR.filter(a => a.st === 'renew' && a.b < TODAY + 60 * DAY).length}{" agreements renew in the next 60 days."}</>,
        calendar: `${soon.length} filings are due by ${fmtD(TODAY + 25 * DAY)}. ${soon.filter(c => c.st === 'ready').length} are ready to file.`
      }[G.tab];
      const segs = (arr, col) => arr.map((x, i) => <i key={i} style={css(`left:${i / Math.max(6, arr.length) * 100}%;width:calc(${100 / Math.max(6, arr.length)}% - 2px);background:${col(x)}`)} />);
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />Governance · Wed 21 Oct · Demo data</span><p className="brief">{brief}</p><div className="strip"><div className="sc" data-gopen={v0.id}><span className="lbl">Voting now</span><div className="sc-v">{v0.cast}{" "}<small>{"of "}{MEMBERS}{" voted"}</small></div><div className="mb"><i style={css(`width:${v0.cast / MEMBERS * 100}%;background:var(--live)`)} /><s className="nflr" style={css(`left:${RULES[v0.type].q * 100}%`)} /></div><div className="sc-s">{v0.id}{" · needs "}{quorumN(v0)}{" · closes "}{fmtD(v0.voteClose)}</div></div><div className="sc" data-gst="all"><span className="lbl">On the way</span><div className="sc-v">{pipe.length}{" "}<small>proposals</small></div><div className="mb">{segs(pipe, p => ({
                draft: 'var(--line)',
                sponsor: 'var(--underway)',
                check: 'var(--fg)'
              })[p.st])}</div><div className="sc-s">{['draft', 'sponsor', 'check'].map(s => `${pipe.filter(p => p.st === s).length} ${STG[s][1].toLowerCase()}`).join(' · ')}</div></div><div className="sc" data-gjump="gv-done"><span className="lbl">Carried out</span><div className="sc-v">{T.filter(([p, t]) => t[4] === 'done').length}{" "}<small>{"of "}{T.length}{" tasks"}</small></div><div className="mb">{segs(T, ([p, t]) => ({
                done: 'var(--fg)',
                doing: 'var(--settled)',
                waits: 'var(--line)',
                late: 'var(--absent)'
              })[t[4]])}</div><div className="sc-s">{late.length}{" late · "}{T.filter(([p, t]) => t[4] === 'waits').length}{" waiting on another step"}</div></div><div className="sc" data-gjump="gv-talk"><span className="lbl">In the forum</span><div className="sc-v">{IDEAS}{" "}<small>ideas</small></div><div className="mb"><i style={css(`width:${3 / IDEAS * 100}%;background:var(--land)`)} /><i style={css(`left:${3 / IDEAS * 100}%;width:${(IDEAS - 3) / IDEAS * 100}%;background:color-mix(in srgb,var(--fg) 22%,transparent)`)} /></div><div className="sc-s">3 new this week</div></div></div></>);
    }

    /* ── needs you: shared by Overview and Proposals ── */
    function needsCell() {
      if (LG) return needsLive();
      const v = PROPS.find(p => p.st === 'vote' && !p.board);
      const N = !STAFF() ? [['live', `Vote on ${v.id}`, `${v.t} · you haven’t voted yet`, left(v.voteClose).replace('in ', ''), 'Vote in the app', `data-gopen="${v.id}"`], ['underway', 'Co-sign P-015', 'Reprint the window posters · 3 more co-signers needed', fmtD(PROP['P-015'].sponsorBy), 'Your call', 'data-gopen="P-015"'], ['line', 'Comment on P-017', 'Hold the annual meeting on a Saturday · a draft', '2 d', 'Draft', 'data-gopen="P-017"']] : [['live', `Vote on ${v.id}`, `${v.t} · you haven’t voted yet`, left(v.voteClose).replace('in ', ''), 'Vote in the app', `data-gopen="${v.id}"`], ...PROPS.filter(p => p.st === 'check' && p.checker === G.me).map(p => ['underway', `Check ${p.id}`, `${p.t} · ${p.checks.filter(c => !c[2]).length} checks left`, WD(p.checkDue), 'You check it', `data-gopen="${p.id}"`]), ...PROPS.flatMap(p => (p.tasks || []).filter(t => t[4] === 'late' && t[2] === G.me).map(t => ['absent', t[0], `${p.id} passed ${fmtD(p.decidedAt)} · due ${fmtD(t[3])}`, `${Math.round((NOW - t[3]) / DAY)} d late`, 'Your task', `data-gopen="${p.id}"`])), ...AGR.filter(x => x.st === 'out').map(x => ['live', `Sign: ${x.party}`, `${x.name} · they signed ${fmtD(x.sent + 2 * DAY)}`, '1 d', 'Your signature', `data-gagr="${x.id}"`]), ['line', 'A post was hidden in P-012', 'Dana Ruiz · it shared another member’s address', '1 d', 'Logged', `data-gopen="P-012" data-gthread="1"`]];
      return cell('s5', 'Needs you', <span className="lbl">{N.length}{" things"}</span>, <div className="gv-nd">{N.map(([sv, t, m, age, own, at], __k) => <button key={__k} className="gv-nd-r" {...attrs(at)}><i style={css(`background:${{
            underway: 'var(--underway)',
            live: 'var(--live)',
            absent: 'var(--absent)',
            line: 'var(--line)'
          }[sv]}`)} /><span className="gv-nd-k"><b>{t}</b><span>{m}</span></span><span className="gv-nd-a"><span className={sv === 'live' ? 'me' : sv === 'absent' ? 'bad' : ''}>{own}</span><span className="mono">{age}</span></span></button>)}</div>, <><span>Votes are cast in the member app</span><span /></>);
    }

    /* ══ Proposals ══════════════════════════════════════════════════════════════════════════════════════════════ */
    function renderProposals() {
      if (LG) return renderProposalsLive();
      const ORD = {
          vote: 0,
          check: 1,
          sponsor: 2,
          draft: 3,
          done: 4,
          decided: 5,
          withdrawn: 6,
          expired: 6
        },
        per = 7;
      const inSet = p => G.set === 'all' || (G.set === 'open' ? isOpen(p) : !isOpen(p));
      const L = PROPS.filter(p => G.st ? p.st === G.st : inSet(p)).sort((a, b) => ORD[a.st] - ORD[b.st] || b.opened - a.opened);
      G.pp = Math.min(G.pp, Math.max(0, Math.ceil(L.length / per) - 1));
      const SET = [['open', 'Open', PROPS.filter(isOpen).length], ['closed', 'Closed', PROPS.filter(p => !isOpen(p)).length], ['all', 'All', PROPS.length]];
      const rail = <div className="gv-rail">{STAGES.map(([k, t, s], i) => {
          const n = PROPS.filter(p => p.st === k).length;
          return <button key={i} className={`gv-rs ${k} ${G.st === k ? 'on' : ''} ${n ? '' : 'z'}`} data-gst={k} aria-pressed={G.st === k}><span className="gv-rh"><span className="gv-rn">{i + 1}</span><b>{t}</b>{i < 5 ? <span className="gv-ra"><i />{ICO.arrow}</span> : ''}</span><span className="gv-rc">{n}</span><span className="gv-rd">{s}</span></button>;
        })}</div>;
      const GRP = st => st === 'withdrawn' || st === 'expired' ? 'Ended' : STG[st][1];
      let prev = null;
      const rows = L.slice(G.pp * per, G.pp * per + per).map((p, __k) => {
        const R = RULES[p.type],
          g = GRP(p.st),
          h = !G.st && g !== prev ? <div className="gv-g">{lbl(`${g} · ${L.filter(x => GRP(x.st) === g).length}`)}</div> : '';
        prev = g;
        return <Fragment key={__k}>{h}<button className={`gv-r st-${p.st} ${p.tasks && p.tasks.some(t => t[4] === 'late') ? 'late' : ''}`} data-gopen={p.id}><span className="gv-k"><b>{p.t}</b><span><span className="mono">{p.id}</span>{" · "}{R.t}{" · "}{byName(p.by)}</span></span><span className="gv-p">{prog(p)}</span>{nextOf(p)}<span className="gv-c">{ICO.talk}{p.posts}</span><span className="gv-go">{ICO.chev}</span></button></Fragment>;
      });
      const list = cell('s12', 'Every proposal', <div className="seg sm" role="group" aria-label="Which proposals">{SET.map(([k, t, n], __k) => <button key={__k} data-gset={k} aria-pressed={!G.st && G.set === k}>{t}{" "}{n}</button>)}</div>, <>{rail}<div className="gv-l">{rows.length ? rows : <div className="gv-e"><span>{"Nothing "}{G.st ? `is in ${STG[G.st][1].toLowerCase()}` : 'here'}{" right now"}</span></div>}</div></>, <><span>{G.st ? <>{"Showing "}{STG[G.st][1].toLowerCase()}{" · "}<button className="lnk3" data-gset={G.set}>Show every step</button></> : 'Discussion stays open at every step · the text freezes when voting opens'}</span>{L.length > per ? pager(G.pp, L.length, per, 'gpp') : <span className="quiet">{L.length}{" "}{L.length === 1 ? 'proposal' : 'proposals'}</span>}</>);

      /* the vote that's running */
      const v = PROPS.find(p => p.st === 'vote' && !p.board),
        q = quorumN(v),
        days = v.castBy,
        dmx = Math.max(days[days.length - 1], q) * 1.1;
      const span = Math.round((v.voteClose - v.voteOpen) / DAY),
        today = days.length;
      const vote = cell('s7', 'Voting now', <span className="lbl">{v.id}{" · closes "}{WD(v.voteClose)}{" "}{fmtD(v.voteClose)}</span>, <div className="gv-v"><div className="gv-vh"><div className="m-big">{v.cast}{" "}<small>{"of "}{MEMBERS}{" members have voted · "}{pct(v.cast, MEMBERS)}</small></div><span className="fst">Enough voted</span></div><div className="gv-vc">{Array.from({
            length: span
          }, (_, i) => {
            const n = days[i];
            return <div key={i} className={`${i < today ? '' : 'f'} ${i === today - 1 ? 'now' : ''}`}><i style={css(`height:${n != null ? n / dmx * 100 : 0}%`)} /><s>{i === 0 ? fmtD(v.voteOpen) : i === today - 1 ? 'Today' : i === span - 1 ? fmtD(v.voteClose) : ''}</s></div>;
          })}<span className="gv-q" style={css(`bottom:${q / dmx * 100}%`)}><em>{q}{" needed to count · "}{RULES[v.type].q * 100}%</em></span></div><div className="led gv-vl">{[['Results', 'Sealed until the vote closes'], ['To pass', `${RULES[v.type].pass} of those voting yes or no`], ['The board', 'Recommends yes · 3 to 0, on the record'], ['Each voter', 'Gets a receipt to check their vote was counted']].map(([k, x], __k) => <div key={__k}><span>{k}</span><b>{x}</b></div>)}</div></div>, <><span>{MEMBERS - v.cast}{" haven’t voted · "}{Math.ceil((v.voteClose - NOW) / DAY)}{" days left"}</span><button data-gremind={v.id}>Remind them →</button></>);

      /* the forum */
      const talk = cell('s7', 'Discussion', <span className="lbl">From Community · latest first</span>, <div className="gv-f" id="gv-talk">{POSTS.map((x, __k) => <button key={__k} className={`gv-f-r ${x.hidden ? 'hid' : ''}`} data-gopen={x.p === 'idea' ? '' : x.p} {...attrs(x.p === 'idea' ? 'data-gidea' : '')}>{av(x.by)}<span className="gv-f-k"><span className="gv-f-h"><b>{byName(x.by)}</b>{x.staff ? <span className="gv-staff">Staff</span> : ''}<span className="gv-tag mono">{x.p === 'idea' ? 'Idea' : x.p}</span></span>{x.hidden ? <em>{"Hidden by "}{x.hidden}</em> : <span className="gv-f-t">{x.t}</span>}</span><span className="gv-f-a"><span>{ago(x.at)}</span>{x.r ? <span>{ICO.talk}{x.r}</span> : ''}</span></button>)}</div>, <><span>The talk happens in Community · decisions are tracked here</span><button data-gforum="">Community →</button></>);

      /* carried out */
      const D2 = PROPS.filter(p => p.st === 'done');
      const done = cell('s5', 'Carried out', <span className="lbl">Passed, then done</span>, <div className="gv-d" id="gv-done">{D2.map((p, __k) => <div key={__k} className="gv-d-p"><button className="gv-d-h" data-gopen={p.id}><span className="mono">{p.id}</span><b>{p.t}</b></button>{p.tasks.map((t, __k) => <div key={__k} className={`gv-d-t ${t[4]}`}><i /><span><b>{t[0]}</b><em>{t[1]}{" · "}{who(t[2])}{t[5] ? ' · ' + t[5].toLowerCase() : ''}</em></span><span className="gv-d-s">{{
                done: 'Done',
                doing: 'Under way',
                waits: 'Waiting',
                late: `${Math.round((NOW - t[3]) / DAY)} d late`
              }[t[4]]}</span></div>)}</div>)}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Done</span><span><i style={css("background:var(--settled)")} />Under way</span><span><i className="hx" />Waiting</span><span><i style={css("background:var(--absent)")} />Late</span></span><span /></>);

      /* who decides what */
      const rules = cell('s12', 'Who decides what', <span className="lbl">From the co-op agreement</span>, <div className="gv-rt"><div className="gv-rt-r hd2">{lbl('Kind of decision')}{lbl('Who decides')}{lbl('To pass')}{lbl('Turnout to count')}{lbl('Vote runs')}</div>{Object.entries(RULES).map(([k, r], __k) => <div key={__k} className={`gv-rt-r ${r.off ? 'off' : ''}`}><span className="gv-rt-k"><b>{r.t}</b><em>{r.note}</em></span><span>{r.body}</span><span>{r.pass}</span><span>{r.q ? `${r.q * 100}% · ${Math.ceil(MEMBERS * r.q)} members` : <span className="quiet">A meeting’s quorum</span>}</span><span>{r.days ? `${r.days} days` : <span className="quiet">At a meeting</span>}</span></div>)}</div>, <><span>{PETITION}</span><span /></>);
      html(document.getElementById('gv'), <>{band(list, 1)}{band(<>{vote}{needsCell()}</>)}{band(<>{talk}{done}</>)}{band(rules)}</>);
    }

    /* ══ Panel ══════════════════════════════════════════════════════════════════════════════════════════════════ */
    function ensurePanel() {
      let pn = document.getElementById('gpanel');
      if (!pn) {
        const sc = document.createElement('div');
        sc.id = 'gscrim';
        sc.className = 'scrim';
        document.body.appendChild(sc);
        pn = document.createElement('aside');
        pn.id = 'gpanel';
        pn.className = 'panel gpanel';
        document.body.appendChild(pn);
      }
      return pn;
    }
    function renderPanel() {
      const pn = ensurePanel(),
        P = G.panel;
      if (!P) {
        document.body.classList.remove('pn');
        return;
      }
      // live, a panel for something the data doesn't have (a proposal, from an old link) doesn't open
      if (LG && (P.id || P.ent && !ENTO[P.ent] || P.agr && !AGR.find(x => x.id === P.agr) || P.mt && !MEETINGS.find(x => x[0] === P.mt))) {
        G.panel = null;
        document.body.classList.remove('pn');
        return;
      }
      document.body.classList.add('pn');
      html(pn, P.id ? propPanel(PROP[P.id]) : P.ent ? entPanel(P.ent) : P.agr ? agrPanel(P.agr) : P.mt ? mtPanel(P.mt) : '');
      if (P.thread) {
        const el = pn.querySelector('.gv-th');
        el && el.scrollIntoView({
          block: 'start'
        });
      }
    }
    function track(p) {
      const order = ['draft', 'sponsor', 'check', 'vote', 'decided', 'done'],
        at = p.st === 'withdrawn' || p.st === 'expired' ? -1 : order.indexOf(p.st);
      const T = RULES[p.type].q ? STAGES : STAGES.map(s => s[0] === 'sponsor' ? [s[0], 'Co-signing'] : s[0] === 'vote' ? [s[0], 'Board vote'] : s);
      return <div className="bd-tk">{T.map(([k, t], i) => <span key={i} className={at < 0 ? '' : i < at ? 'done' : i === at ? p.tasks && p.tasks.some(x => x[4] === 'late') ? 'late' : 'now' : ''}><i />{t}</span>)}</div>;
    }
    function propPanel(p) {
      const R = RULES[p.type],
        q = quorumN(p),
        mine = STAFF();
      const rows = [['Kind', R.t], ['Who decides', R.body], ['To pass', R.pass], ...(q ? [['Turnout to count', `${R.q * 100}% · ${q} of ${MEMBERS} members`]] : []), ...(R.days ? [['Vote runs', `${R.days} days`]] : []), ['Written by', `${byName(p.by)}${p.coauth ? ` with ${p.coauth.length} co-author${p.coauth.length > 1 ? 's' : ''}` : ''}`], ['Text', `Version ${p.ver}${p.decidedAt || p.endedAt ? ' · final' : p.frozen ? ` · frozen ${fmtD(p.frozen)}` : ' · can still change'}`], ...(p.amt ? [['From the co-op balance', `$${p.amt.toFixed(2)} of $476.20`]] : []), ...(p.live ? [['Live', p.live]] : []), ...(p.boardVote ? [[p.st === 'vote' ? 'The board recommends' : 'The board voted', `${p.st === 'vote' ? 'Yes · ' : ''}${p.boardVote[0]} to ${p.boardVote[1]}, on the record`]] : [])];
      let block = '';
      if (p.st === 'sponsor') block = <div>{lbl('Co-signers')}<div className="gv-pb"><span className="gv-bar gb-sp"><i style={css(`width:${p.sponsors / SPONSORS * 100}%`)} /></span><b>{p.sponsors}{" of "}{SPONSORS}</b></div><p className="bpn-n">{"It goes to a vote once "}{SPONSORS}{" members co-sign · expires "}{fmtD(p.sponsorBy)}{" if not, and the thread stays."}</p></div>;
      if (p.st === 'check') block = <div>{lbl(`The check · ${who(p.checker)} · due ${fmtD(p.checkDue)}`)}<div className="led gv-cl">{p.checks.map(([k, s, ok], __k) => <div key={__k}><span><i className={ok ? 'ok' : ''} />{k}</span><b>{s}</b></div>)}</div><p className="bpn-n">The check decides who votes and what it takes. It can send a proposal back with a reason, never stop it for being unpopular.</p>{G.back ? <label>{lbl('Why it goes back')}<textarea id="gback" className="vin" rows="3" placeholder="What needs to change before it can go forward" /></label> : ''}</div>;
      if (p.st === 'vote' && !p.board) block = <div>{lbl('Turnout')}<div className="gv-pb"><span className="gv-bar gb-vt"><i style={css(`width:${p.cast / MEMBERS * 100}%`)} /><s style={css(`left:${R.q * 100}%`)} /></span><b>{p.cast}{" of "}{MEMBERS}</b></div><p className="bpn-w"><b>{"Results are sealed until "}{WD(p.voteClose)}{" "}{fmtD(p.voteClose)}{" at 23:59."}</b>{" Nobody sees how the vote is going, staff included. At the close the tally is counted, signed and written on-chain, and each voter can check their receipt."}</p></div>;
      if (p.st === 'decided') block = <div>{lbl('Result')}<div className="gv-pb"><span className="gv-bar gb-vt"><i style={css(`width:${p.cast / MEMBERS * 100}%`)} /><s style={css(`left:${R.q * 100}%`)} /></span><b>{p.cast}{" of "}{MEMBERS}</b></div><p className="bpn-n">{p.result === 'quorum' ? `${p.tally[0]} yes, ${p.tally[1]} no, ${p.tally[2]} abstained, but only ${p.cast} voted and ${q} were needed for it to count. It can come back as a new proposal.` : ''}</p></div>;
      if (p.tasks) block = <div>{lbl('Carrying it out')}<div className="gv-d gv-d-pn">{p.tasks.map((t, i) => <div key={i} className={`gv-d-t ${t[4]}`}><i /><span><b>{t[0]}</b><em>{t[1]}{" · "}{who(t[2])}{" · due "}{fmtD(t[3])}{t[5] ? ' · ' + t[5].toLowerCase() : ''}</em></span>{t[2] === G.me && (t[4] === 'doing' || t[4] === 'late') ? <button className="btn sm-b" data-gtask={`${p.id}:${i}`}>Mark done</button> : <span className="gv-d-s">{{
                done: 'Done',
                doing: 'Under way',
                waits: 'Waiting',
                late: 'Late'
              }[t[4]]}</span>}</div>)}</div></div>;
      const th = POSTS.filter(x => x.p === p.id);
      const thread = <div className="gv-th">{lbl(`Discussion · ${p.posts} posts${p.st === 'vote' ? ' · open during the vote' : ''}`)}{th.length ? th.map((x, __k) => <div key={__k} className={`gv-tp ${x.hidden ? 'hid' : ''}`}>{av(x.by)}<span><span className="gv-f-h"><b>{byName(x.by)}</b>{x.staff ? <span className="gv-staff">Staff</span> : ''}<span className="quiet">{ago(x.at)}</span></span>{x.hidden ? <em>{"Hidden by "}{x.hidden}{" · logged in Records"}</em> : <span>{x.t}</span>}</span></div>) : <p className="bpn-n">Older posts are in the forum.</p>}{p.frozen ? <div className="gv-ver"><i />{"Text frozen at version "}{p.ver}{" · "}{fmtD(p.frozen)}</div> : ''}</div>;
      const ft = !mine ? <><span className="small quiet" style={css("margin-right:auto")}>{"Read-only · "}{stateTxt(p)}</span><button className="btn" data-gforum="">Thread in Community →</button></> : p.st === 'check' && p.checker === G.me ? G.back ? <><button className="btn" data-gbackx="">Back</button><button className="btn dz" data-gsend={p.id}>Send it back</button></> : <><button className="btn" data-gbacko="">Send back</button><button className="btn p" data-gpass={p.id}>{p.type === 'elect' ? 'Close nominations' : 'Checked · send it on'}</button></> : p.st === 'vote' && !p.board ? <><button className="btn" data-gremind={p.id}>{"Remind the "}{MEMBERS - p.cast}</button><button className="btn p" data-gapp="">Vote in the app ↗</button></> : p.st === 'sponsor' ? <><button className="btn" data-gforum="">Thread in Community →</button><button className="btn p" data-gshare="">Share the co-sign link</button></> : <><span className="small quiet" style={css("margin-right:auto")}>{stateTxt(p)}</span><button className="btn" data-gforum="">Thread in Community →</button></>;
      return <><div className="pn-hd"><span className="lbl">{p.id}{" · "}{R.t}</span><button className="x" data-gclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div><p className="bpn-t">{p.t}</p><p className={`bpn-s ${p.st === 'vote' ? 'me' : ''}`}>{stateTxt(p)}</p></div>{track(p)}<p className="bpn-n">{p.sum}</p><div className="led">{rows.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{block}{thread}</div><div className="pn-ft">{ft}</div></>;
    }

    /* ══ Live (REAL): what the API has, in the reference's cells; what it doesn't says "Not real yet" ══════════════ */
    const notReal = (cls, title, need) => cell(cls, title, lbl('Not real yet'), <><div className="bk-empty hatch" style={css("min-height:120px;opacity:.5")} /><div className="bk-empty">{need}</div></>, <span />);
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const usd = n => '$' + Number(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const bname = id => (GBOARDS.find(b => b[0] === id) || [, id])[1];
    const bLow = s => String(s).replace(/^Co-op/, 'co-op');
    const vq = v => Math.ceil(v.elig * v.q);
    const mtWhen = t => `${WD(t)} ${fmtD(t)}${hm(t) !== '00:00' ? ' · ' + hm(t) : ''}`;
    /* the old page's agenda, packet and minutes flows are the co-op board's next meeting's */
    const coopNext = m => !!m && m === LG.NEXT && m[1] === 'coop' && !!nextBoard();

    /* every dated thing the API has: filings, the boards' next meetings, the members' own, the vote's close, renewals */
    function calItemsLive() {
      const out = [];
      FILINGS.forEach(f => out.push({
        t: f[3],
        kind: f[2].startsWith('Annual member') ? 'meeting' : 'filing',
        title: f[2],
        ent: f[1],
        st: f[4],
        owner: f[5],
        at: `data-gfile="${f[0]}"`
      }));
      MEETINGS.filter(m => m[4] === 'next').forEach(m => out.push({
        t: m[2],
        kind: 'meeting',
        title: `${bname(m[1])} meets`,
        ent: m[1],
        st: 'next',
        owner: 'The board',
        at: `data-gmt="${m[0]}"`
      }));
      LG.MEMBER_EVENTS.forEach(x => out.push({
        t: x.t,
        kind: 'meeting',
        title: x.title,
        ent: 'coop',
        st: 'next',
        owner: 'Members',
        at: 'data-gtab="boards"'
      }));
      const v = LG.VOTE;
      if (v && !v.closed) out.push({
        t: v.close,
        kind: 'vote',
        title: `Member vote closes · ${v.t}`,
        ent: 'coop',
        st: 'next',
        owner: 'Members',
        at: 'data-gvote=""'
      });
      AGR.filter(a => a.st === 'renew' && a.b).forEach(a => out.push({
        t: a.b,
        kind: 'renew',
        title: `${a.name} renews · ${a.party}`,
        ent: a.type === 'company' ? 'coop' : 'fin',
        st: 'next',
        owner: a.party,
        at: `data-gagr="${a.id}"`
      }));
      return out.filter(c => c.t).sort((a, b) => a.t - b.t);
    }

    /* ── header ── */
    function renderHdrLive() {
      const v = LG.VOTE,
        M = LG.NEXT,
        n = AGENDA.length;
      const formed = ENT.filter(e => e[3] === 'formed').length,
        fdue = ENT.filter(e => e[3] !== 'formed' && ENTF[e[0]].due).sort((a, b) => ENTF[a[0]].due - ENTF[b[0]].due)[0];
      const soon = calItems().filter(c => c.t >= TODAY && c.t < TODAY + 25 * DAY && c.kind === 'filing' && c.st !== 'done'),
        ready = soon.filter(c => c.st === 'ready').length;
      const out = AGR.filter(a => a.st === 'out'),
        ren = AGR.filter(a => a.st === 'renew' && a.b && a.b < TODAY + 60 * DAY);
      const openSeats = GBOARDS.reduce((a, b) => a + b[3].filter(s => !s[1]).length, 0);
      const voteTxt = !v ? 'No member vote has been held yet.' : v.closed ? <>{"The last member vote, "}<a data-gvote="">{v.t}</a>{`, closed ${fmtD(v.close)}: ${v.yes} yes and ${v.no} no.`}</> : <>{"Members are voting on "}<a data-gvote="">{v.t}</a>{v.cast >= vq(v) ? ', and enough have voted for it to count.' : `: ${v.cast} of ${v.elig} have voted, and ${vq(v) - v.cast} more ${vq(v) - v.cast === 1 ? 'is' : 'are'} needed for it to count.`}</>;
      const mtTxt = M ? <>{`The ${bLow(bname(M[1]))} meets `}<a data-gmt={M[0]}>{WD(M[2])}{" "}{fmtD(M[2])}</a>{` with ${plural(n, 'item', 'items')} on the agenda.`}</> : 'No board meeting is set.';
      const brief = {
        overview: <>{voteTxt}{" "}{mtTxt}</>,
        proposals: <>{"Proposals from a draft to a vote aren’t kept here yet. "}{voteTxt}</>,
        boards: <>{mtTxt}{` ${plural(openSeats, 'seat is', 'seats are')} open across ${plural(GBOARDS.length, 'board', 'boards')}.`}</>,
        entities: <>{`${formed} of ${plural(ENT.length, 'entity is', 'entities are')} formed.`}{fdue ? <>{" "}<a data-gent={fdue[0]}>{fdue[1]}</a>{` files to form by ${fmtD(ENTF[fdue[0]].due)}.`}</> : ''}</>,
        agreements: !LG.AG_LOADED ? 'The agreements are Build’s, and they haven’t loaded.' : !AGR.length ? 'No agreements are recorded yet.' : <>{out.length ? <><a data-gagr={out[0].id}>{out[0].party}</a>{out.length > 1 ? ` and ${plural(out.length - 1, 'other waits', 'others wait')} on your signature. ` : ' waits on your signature. '}</> : 'Nothing waits on your signature. '}{`${plural(ren.length, 'agreement renews', 'agreements renew')} in the next 60 days.`}</>,
        calendar: `${plural(soon.length, 'filing is', 'filings are')} due by ${fmtD(TODAY + 25 * DAY)}. ${ready} ${ready === 1 ? 'is' : 'are'} ready to file.`
      }[G.tab];
      const segs = (arr, col) => arr.map((x, i) => <i key={i} style={css(`left:${i / Math.max(6, arr.length) * 100}%;width:calc(${100 / Math.max(6, arr.length)}% - 2px);background:${col(x)}`)} />);
      const recent = RESOS.filter(r => r[0] >= TODAY - 90 * DAY);
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />{`Governance · ${WD(NOW)} ${fmtD(NOW)}`}</span><p className="brief">{brief}</p><div className="strip"><div className="sc" data-gtab="proposals"><span className="lbl">{v && v.closed ? 'Last vote' : 'Voting now'}</span>{v ? <><div className="sc-v">{v.cast}{" "}<small>{"of "}{v.elig}{" voted"}</small></div><div className="mb"><i style={css(`width:${v.elig ? Math.min(100, v.cast / v.elig * 100) : 0}%;background:var(--live)`)} />{v.q ? <s className="nflr" style={css(`left:${v.q * 100}%`)} /> : ''}</div><div className="sc-s">{v.closed ? `${v.yes} yes · ${v.no} no · closed ${fmtD(v.close)}` : `needs ${vq(v)} · closes ${fmtD(v.close)}`}</div></> : <><div className="sc-v">0{" "}<small>open</small></div><div className="mb" /><div className="sc-s">No member vote yet</div></>}</div><div className="sc" data-gtab="boards"><span className="lbl">Board agenda</span><div className="sc-v">{n}{" "}<small>{n === 1 ? 'item' : 'items'}</small></div><div className="mb">{segs(AGENDA, x => AK[x[3]][1])}</div><div className="sc-s">{M ? `${bname(M[1])} · ${WD(M[2])} ${fmtD(M[2])}` : 'No meeting set'}</div></div><div className="sc" data-gtab="boards"><span className="lbl">Decided</span><div className="sc-v">{recent.length}{" "}<small>in 90 days</small></div><div className="mb">{segs(recent, () => 'var(--fg)')}</div><div className="sc-s">{`${plural(RESOS.length, 'resolution', 'resolutions')} on the record`}</div></div><div className="sc"><span className="lbl">In the forum</span><div className="sc-v">—</div><div className="mb hatch" /><div className="sc-s">Not real yet · needs Community’s forum</div></div></div></>);
    }

    /* ── needs you: what the data says is due or waiting ── */
    function needsLive() {
      const v = LG.VOTE,
        M = LG.NEXT,
        N = [];
      AGR.filter(a => a.st === 'out').forEach(a => N.push(['live', `Sign: ${a.party}`, `${a.name}${a.sent ? ` · sent ${fmtD(a.sent)}` : ''}`, a.sent ? ago(a.sent).replace(' ago', '') : '—', 'Your signature', `data-gagr="${a.id}"`]));
      FILINGS.filter(f => f[4] !== 'done' && f[4] !== 'later' && f[3] < TODAY + 30 * DAY).sort((a, b) => a[3] - b[3]).forEach(f => N.push([f[3] < TODAY ? 'absent' : f[4] === 'ready' ? 'underway' : f[4] === 'none' ? 'absent' : 'line', `${f[4] === 'ready' ? 'File' : f[4] === 'none' ? 'Start' : 'Finish'}: ${f[2]}`, `${ESHORT[f[1]] || f[1]} · ${ownerName(f[5])} · due ${fmtD(f[3])}`, f[3] < TODAY ? `${Math.round((TODAY - f[3]) / DAY)} d late` : left(f[3]).replace('in ', ''), FST[f[4]][0], `data-gfile="${f[0]}"`]));
      if (v && !v.closed) N.push(['live', `Member vote: ${v.t}`, `${v.cast} of ${v.elig} voted · ${v.cast >= vq(v) ? 'enough to count' : `${vq(v)} needed`}`, left(v.close).replace('in ', ''), 'Members vote', 'data-gvote=""']);
      if (M && M[2] < TODAY + 14 * DAY) N.push(['line', `${bname(M[1])} meets ${WD(M[2])} ${fmtD(M[2])}`, `${plural(AGENDA.length, 'item', 'items')} on the agenda`, left(M[2]).replace('in ', ''), 'The meeting', `data-gmt="${M[0]}"`]);
      LG.DECIDES.filter(m => m.open).forEach(m => N.push(['underway', m.d, m.open, '—', 'Reserved matter', `data-gmatter="${m.i}"`]));
      return cell('s5', 'Needs you', <span className="lbl">{plural(N.length, 'thing', 'things')}</span>, <div className="gv-nd">{N.length ? N.map(([sv, t, m, age, own, at], __k) => <button key={__k} className="gv-nd-r" {...attrs(at)}><i style={css(`background:${{
            underway: 'var(--underway)',
            live: 'var(--live)',
            absent: 'var(--absent)',
            line: 'var(--line)'
          }[sv]}`)} /><span className="gv-nd-k"><b>{t}</b><span>{m}</span></span><span className="gv-nd-a"><span className={sv === 'live' ? 'me' : sv === 'absent' ? 'bad' : ''}>{own}</span><span className="mono">{age}</span></span></button>) : <div className="gv-e"><span>Nothing needs you right now</span></div>}</div>, <><span>Signatures, filings due in 30 days, the vote and the next meeting</span><span /></>);
    }

    /* ══ Overview ══ */
    function renderOverviewLive() {
      const v = LG.VOTE,
        M = LG.NEXT;
      const DL = [...(v && !v.closed ? [['vote', 'Voting', v.t, `Members · ${v.cast} of ${v.elig} voted`, ['Closes', v.close], 'data-gvote=""']] : []), ...AGENDA.filter(x => x[3] === 'vote').map(x => ['check', 'Board vote', x[0], `${M ? bname(M[1]) : 'The board'} · ${who(x[2])}`, M ? ['Meets', M[2]] : null, M ? `data-gmt="${M[0]}"` : 'data-gtab="boards"'])];
      const deciding = cell('s7', 'Being decided', <span className="lbl">{plural(DL.length, 'vote', 'votes')}{" coming"}</span>, <div className="gt-dl">{DL.length ? DL.map(([st, sl, t, sub, nx, at], __k) => <button key={__k} className="gt-dr" {...attrs(at)}><span className={`gt-sg ${st}`}>{sl}</span><span className="gt-dk"><b>{t}</b><span>{sub}</span></span>{nx ? <span className="gv-n">{lbl(nx[0])}<b>{WD(nx[1])}{" "}{fmtD(nx[1])}</b></span> : <span />}</button>) : <div className="gv-e"><span>Nothing is being voted on</span></div>}</div>, <><span>The member vote and the board’s agenda · proposals aren’t kept yet</span><button data-gtab="proposals">Proposals →</button></>);
      const up = calItems().filter(c => c.t >= TODAY && c.st !== 'done').slice(0, 7);
      const coming = cell('s7', 'Coming up', <span className="lbl">{up.length ? `Next ${Math.max(1, Math.ceil((up[up.length - 1].t - TODAY) / DAY))} days` : 'Nothing dated'}</span>, up.length ? calList(up) : <div className="gv-e"><span>Nothing is due</span></div>, <><span>Filings, meetings, votes and renewals</span><button data-gtab="calendar">Calendar →</button></>);
      const boards = cell('s5', 'Boards', <span className="lbl">Seats filled</span>, <div className="gt-bl">{GBOARDS.map((b, __k) => <button key={__k} className="gt-br" data-gtab="boards"><span className="gt-bk"><b>{b[1]}</b><span>{`${b[3].filter(s => s[1]).length} of ${b[3].length} seats filled`}</span></span>{seatChips(b, 1)}</button>)}</div>, <><span>{M ? `Next: ${bLow(bname(M[1]))}, ${WD(M[2])} ${fmtD(M[2])}` : 'No board meeting is set'}</span><button data-gtab="boards">Boards →</button></>);
      const recent = cell('s7', 'Recently decided', <span className="lbl">Every vote on the record</span>, RESOS.length ? <div className="gt-rl">{RESOS.slice(0, 5).map(r => resoRow(r))}</div> : <div className="gv-e"><span>No resolutions are on the record yet</span></div>, <><span>Board votes are on the record by seat</span><button data-gtab="boards">Resolutions →</button></>);
      const f = ENT.filter(e => e[3] === 'formed').length,
        fg = ENT.filter(e => e[3] === 'forming'),
        pl = ENT.filter(e => e[3] === 'planned').length,
        nf = ENT.filter(e => e[3] !== 'formed');
      const ents = cell('s5', 'Entities', <span className="lbl">{f}{" of "}{ENT.length}{" formed"}</span>, <div className="gt-eo"><div className="gt-eb">{ENT.map((e, __k) => <i key={__k} className={e[3]} title={`${e[1]} · ${EST[e[3]][0]}`} />)}</div><div className="gt-el">{nf.map((e, __k) => {
            const S = ENTF[e[0]].steps || [],
              d = S.filter(s => s[1]).length;
            return <button key={__k} className={`gt-er ${e[3]}`} data-gent={e[0]}><span><b>{e[1]}</b><em>{S.length ? `${d} of ${S.length} steps · ` : 'No steps recorded · '}{ENTF[e[0]].due ? 'due ' + fmtD(ENTF[e[0]].due) : 'when it’s needed'}</em></span><span className="gt-steps">{S.map((s, __k) => <i key={__k} className={s[1] ? 'on' : ''} />)}</span></button>;
          })}</div></div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />{"Formed "}{f}</span><span><i style={css("background:var(--underway)")} />{"Forming "}{fg.length}</span><span><i className="hx" />{"Planned "}{pl}</span></span><span /></>);
      html(document.getElementById('gv'), <>{band(<>{deciding}{needsCell()}</>, 1)}{band(<>{coming}{boards}</>)}{band(<>{recent}{ents}</>)}</>);
    }

    /* ══ Proposals: the latest member vote is real; the lifecycle around it isn't kept yet ══ */
    function voteLive(v) {
      const q = vq(v),
        days = v.days,
        span = Math.max(1, Math.round((v.close - v.open) / DAY)),
        today = Math.min(span, Math.max(1, days.length)),
        dmx = Math.max(days.length ? days[days.length - 1] : 0, q, 1) * 1.1,
        rest = Math.max(0, Math.ceil((v.close - NOW) / DAY));
      return cell('s7', v.closed ? 'Last vote' : 'Voting now', <span className="lbl">{v.closed ? 'Closed' : 'Closes'}{" "}{WD(v.close)}{" "}{fmtD(v.close)}</span>, <div className="gv-v"><div className="gv-vh"><div className="m-big">{v.cast}{" "}<small>{"of "}{v.elig}{" members have voted · "}{pct(v.cast, v.elig)}</small></div>{q && v.cast >= q ? <span className="fst">Enough voted</span> : ''}</div><div className="gv-vc">{Array.from({
            length: span
          }, (_, i) => {
            const n = days[i];
            return <div key={i} className={`${i < today ? '' : 'f'} ${i === today - 1 && !v.closed ? 'now' : ''}`}><i style={css(`height:${n != null ? n / dmx * 100 : 0}%`)} /><s>{i === 0 ? fmtD(v.open) : i === today - 1 && !v.closed ? 'Today' : i === span - 1 ? fmtD(v.close) : ''}</s></div>;
          })}{q ? <span className="gv-q" style={css(`bottom:${q / dmx * 100}%`)}><em>{q}{" needed to count · "}{Math.round(v.q * 100)}%</em></span> : ''}</div><div className="led gv-vl">{[['The vote', v.t], [v.closed ? 'Result' : 'So far', `${v.yes} yes · ${v.no} no · ${v.abs} abstained`], ['Opened', `${WD(v.open)} ${fmtD(v.open)}`], ['Turnout to count', v.q ? `${Math.round(v.q * 100)}% · ${q} of ${v.elig} members` : 'Not set']].map(([k, x], __k) => <div key={__k}><span>{k}</span><b>{x}</b></div>)}</div></div>, <><span>{v.closed ? `${v.elig - v.cast} didn’t vote` : `${v.elig - v.cast} haven’t voted · ${plural(rest, 'day', 'days')} left`}</span>{!v.closed && STAFF() ? <button data-gflow="remind">Remind them →</button> : <button data-gvote="">The ballot →</button>}</>);
    }
    function renderProposalsLive() {
      const v = LG.VOTE;
      // the redesign's list, with nothing in it: the API keeps no proposals yet, only the latest member vote
      const STL = STAGES.map(st => st[0] === 'sponsor' ? [st[0], st[1], 'Co-signers bring it to a vote'] : st);
      const rail = <div className="gv-rail">{STL.map(([k, t, s], i) => <button key={i} className={`gv-rs ${k} ${G.st === k ? 'on' : ''} z`} data-gst={k} aria-pressed={G.st === k}><span className="gv-rh"><span className="gv-rn">{i + 1}</span><b>{t}</b>{i < 5 ? <span className="gv-ra"><i />{ICO.arrow}</span> : ''}</span><span className="gv-rc">0</span><span className="gv-rd">{s}</span></button>)}</div>;
      const list = cell('s12', 'Every proposal', <div className="seg sm" role="group" aria-label="Which proposals">{[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([k, t], __k) => <button key={__k} data-gset={k} aria-pressed={!G.st && G.set === k}>{t}{" 0"}</button>)}</div>, <>{rail}<div className="gv-l"><div className="gv-e"><span>{G.st ? `Nothing is in ${STG[G.st][1].toLowerCase()}` : 'No proposals yet'}</span></div></div></>, <><span>{G.st ? <>{"Showing "}{STG[G.st][1].toLowerCase()}{" · "}<button className="lnk3" data-gset={G.set}>Show every step</button></> : 'Not real yet · needs proposals, draft to done'}</span><span className="quiet">0 proposals</span></>);
      const vote = v ? voteLive(v) : cell('s7', 'Voting now', lbl('None open'), <div className="gv-e"><span>No member vote has been held yet</span></div>, <><span>Member votes are kept as they’re held</span><span /></>);
      const talk = cell('s7', 'Discussion', <span className="lbl">From Community · latest first</span>, <div className="gv-f" id="gv-talk"><div className="gv-e"><span>No discussion yet</span></div></div>, <><span>Not real yet · needs the forum</span><button data-gforum="">Community →</button></>);
      const done = cell('s5', 'Carried out', <span className="lbl">Passed, then done</span>, <div className="gv-d" id="gv-done"><div className="gv-e"><span>Nothing carried out yet</span></div></div>, <><span>Not real yet · needs each decision’s tasks</span><span /></>);
      const D2 = LG.DECIDES;
      const rules = cell('s12', 'Who decides what', <span className="lbl">Reserved matters</span>, <div className="gv-rt"><div className="gv-rt-r hd2">{lbl('Decision')}{lbl('Decides')}{lbl('Must approve')}{lbl('Is told')}{lbl('Open now')}</div>{D2.length ? D2.map((m, __k) => <div key={__k} className="gv-rt-r"><span className="gv-rt-k"><b>{m.d}</b></span><span>{m.decides.join(', ') || <span className="quiet">No one</span>}</span><span>{m.approve.join(', ') || <span className="quiet">No one</span>}</span><span>{m.told.join(', ') || <span className="quiet">No one</span>}</span><span>{m.open || <span className="quiet">Nothing</span>}</span></div>) : <div className="gv-e"><span>No reserved matters are recorded</span></div>}</div>, <><span>Who decides, who must approve and who’s told, for each reserved matter</span><span /></>);
      html(document.getElementById('gv'), <>{band(list, 1)}{band(<>{vote}{needsCell()}</>)}{band(<>{talk}{done}</>)}{band(rules)}</>);
    }

    /* ══ Boards ══ */
    function renderBoardsLive() {
      const seats = cell('s12', 'Every seat', <span className="lbl">{plural(GBOARDS.reduce((a, b) => a + b[3].length, 0), 'seat', 'seats')}{" · "}{plural(GBOARDS.length, 'board', 'boards')}</span>, GBOARDS.length ? <div className="gt-sl">{GBOARDS.map((b, __k) => <div key={__k} className="gt-sr"><span className="gt-sk"><b>{b[1]}</b><em>{b[2]}</em></span>{seatChips(b)}<span className="gt-sn"><b>{b[3].filter(s => s[1]).length}</b><em>{"of "}{b[3].length}</em></span></div>)}</div> : <div className="gv-e"><span>No boards are recorded</span></div>, <><span className="f-key">{['m', 'r', 'c', 'i', 'n'].map((k, __k) => <span key={__k}><i style={css(`background:${SEATC[k][1]}`)} />{SEATC[k][0]}</span>)}<span><i className="hx" />Open</span></span><span /></>);
      const M = LG.NEXT,
        tot = AGENDA.reduce((a, x) => a + x[1], 0);
      const next = cell('s7', 'Next meeting', <span className="lbl">{M ? `${bname(M[1])} · ${mtWhen(M[2])}` : 'None set'}</span>, AGENDA.length ? <div className="gt-ag"><div className="gt-ag-b">{AGENDA.map((x, __k) => <i key={__k} style={css(`flex:${Math.max(1, x[1])};background:${AK[x[3]][1]}`)} title={x[0]} />)}</div><div className="gt-ag-l">{AGENDA.map((x, i) => <div key={i} className="gt-ag-r"><span className="mono">{i + 1}</span><span className="gt-ag-k"><b>{x[0]}</b><em>{who(x[2])}{" · "}{x[1]}{" min"}</em></span><span /><span className="gt-st" style={css(`--c:${AK[x[3]][1]}`)}>{AK[x[3]][0]}</span></div>)}</div></div> : <div className="gv-e"><span>{M ? 'Nothing is on the agenda yet' : 'No board meeting is set'}</span></div>, <><span>{AGENDA.length ? `${tot} min · ${plural(AGENDA.length, 'item', 'items')}` : 'Items are added one by one'}</span>{STAFF() && coopNext(M) ? <button data-gflow="item">Add an item →</button> : <span />}</>);
      const mtgs = cell('s5', 'Meetings', <span className="lbl">Minutes and records</span>, MEETINGS.length ? <div className="gt-ml">{MEETINGS.map((m, __k) => <button key={__k} className={`gt-mr ${m[4]}`} data-gmt={m[0]}>{leaf(m[2])}<span className="gt-ck"><b>{bname(m[1])}</b><span>{m[3]}</span></span><span className="gt-st" style={css(`--c:${m[4] === 'next' ? 'var(--live)' : m[5] === 'approve' ? 'var(--underway)' : 'var(--fg)'}`)}>{m[4] === 'next' ? 'Next' : m[5] === 'approve' ? 'Minutes to approve' : 'Held'}</span></button>)}</div> : <div className="gv-e"><span>No meetings are recorded yet</span></div>, <><span>Minutes are filed in Records once approved</span><span /></>);
      const resos = cell('s12', 'Resolutions', <span className="lbl">{RESOS.length}{" on the record"}</span>, RESOS.length ? <div className="gt-rl wide">{RESOS.map(r => resoRow(r))}</div> : <div className="gv-e"><span>No resolutions are on the record yet</span></div>, <><span className="f-key">{['y', 'n', 'r'].map((k, __k) => <span key={__k}><i style={css(`background:${VOTEC[k][1]}`)} />{VOTEC[k][0]}</span>)}<span><i className="gt-ab" />Absent</span></span>{STAFF() ? <button data-gflow="log">Log a decision →</button> : <span>Every board vote is on the record by seat</span>}</>);
      html(document.getElementById('gv'), <>{band(seats, 1)}{band(<>{next}{mtgs}</>)}{band(resos)}</>);
    }

    /* ══ Entities ══ */
    function renderEntitiesLive() {
      const map = cell('s12', 'Who owns what', <span className="lbl">{ENT.filter(e => e[3] === 'formed').length}{" of "}{ENT.length}{" formed"}</span>, <div className="gt-mapw">{entMap()}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Formed</span><span><i style={css("background:var(--underway)")} />Forming</span><span><i className="hx" />Planned</span><span><i className="gt-dash" />Ownerless</span></span><span>The co-op owns everything inside the tree</span></>);
      const F = ENT.filter(e => e[3] !== 'formed');
      const forming = cell('s7', 'Forming', <span className="lbl">{plural(F.length, 'entity', 'entities')}</span>, F.length ? <div className="gt-fl">{F.map((e, __k) => {
          const S = ENTF[e[0]].steps || [],
            d = S.filter(s => s[1]).length,
            nx = S.find(s => !s[1]);
          return <button key={__k} className={`gt-fr ${e[3]}`} data-gent={e[0]}><span className="gt-ck"><b>{e[1]}</b><span>{!S.length ? 'No formation steps recorded' : nx ? `Next: ${nx[0].toLowerCase()}` : 'Done'}{ENTF[e[0]].due ? ` · due ${fmtD(ENTF[e[0]].due)}` : ' · when it’s needed'}</span></span><span className="gt-fs">{S.map((s, i) => <i key={i} className={s[1] ? 'on' : i === d ? 'nx' : ''} title={s[0]} />)}</span><span className="gt-fn">{S.length ? `${d} of ${S.length}` : '–'}</span></button>;
        })}</div> : <div className="gv-e"><span>Every entity is formed</span></div>, <><span>Planned entities form when they’re needed, not before</span><span /></>);
      const res = cell('s5', 'Reserved matters', <span className="lbl">Who decides</span>, RESERVED.length ? <div className="gt-rm">{RESERVED.map(([t, w], i) => <div key={i} data-gmatter={String(i)} role="button" tabIndex={0}><span>{t}</span><b className={/member/.test(w) ? 'mv' : ''}>{w}</b></div>)}</div> : <div className="gv-e"><span>No reserved matters are recorded</span></div>, <><span>Open one for who must approve and who’s told</span><span /></>);
      const rp = cell('s12', 'Between our companies', <span className="lbl">{plural(LG.RP.length, 'related-party deal', 'related-party deals')}</span>, LG.RP.length ? <div className="gt-fl">{LG.RP.map((r, __k) => <button key={__k} className="gt-fr" data-gflow="rp" data-gid={String(r.i)}><span className="gt-ck"><b>{r.what}</b><span>{`${(ENTO[r.from] || [, r.from])[1]} → ${(ENTO[r.to] || [, r.to])[1]}`}{r.agenda ? ` · on the agenda ${fmtD(r.agenda)}` : r.paid.length ? ` · last paid ${fmtD(r.paid[r.paid.length - 1])}` : ' · nothing paid yet'}</span></span><span className="gt-fs" /><span className="gt-fn">{r.amt ? usd(r.amt) : '–'}</span></button>)}</div> : <div className="gv-e"><span>No related-party deals are recorded</span></div>, <><span>Each payment is logged by hand · a new deal goes to the board</span><span /></>);
      html(document.getElementById('gv'), <>{band(map, 1)}{band(<>{forming}{res}</>)}{band(rp)}</>);
    }

    /* ══ Agreements: Build's section's; their versions aren't kept yet ══ */
    function renderAgreementsLive() {
      const F = [['all', 'All'], ['wait', 'Waiting'], ['renew', 'Renewing'], ['signed', 'Signed']];
      const wt = a => ['out', 'sent', 'draft'].includes(a.st);
      const ok = a => G.ag === 'all' || (G.ag === 'wait' ? wt(a) : a.st === G.ag);
      const Ls = AGR.filter(ok);
      const yr = t => new Date(t).getUTCFullYear() !== Y0 ? ' ' + new Date(t).getUTCFullYear() : '';
      const TY = [...AGR_T, ...[...new Set(Ls.map(a => a.type))].filter(k => !AGR_T.some(t => t[0] === k)).map(k => [k, k])];
      const list = cell('s12', 'Every agreement', <div className="seg sm" role="group" aria-label="Which agreements">{F.map(([k, t], __k) => <button key={__k} data-gag={k} aria-pressed={G.ag === k}>{t}{" "}{k === 'all' ? AGR.length : AGR.filter(a => k === 'wait' ? wt(a) : a.st === k).length}</button>)}</div>, <div className="gt-al">{!LG.AG_LOADED ? <div className="gv-e"><span>The agreements are Build’s, and they haven’t loaded</span></div> : Ls.length ? TY.map(([k, t], __k) => {
          const A = Ls.filter(a => a.type === k);
          return A.length ? <Fragment key={__k}><div className="gv-g">{lbl(`${t} · ${A.length}`)}</div>{A.map((a, __k) => <button key={__k} className={`gt-ar st-${a.st}`} data-gagr={a.id}><span className="gt-ck"><b>{a.name}</b><span>{a.party}</span></span><span className="gt-avw"><span className="mono gt-av">{a.ver}</span></span><span className="gt-ad">{a.st === 'out' || a.st === 'sent' ? a.sent ? `Sent ${fmtD(a.sent)}${yr(a.sent)}` : 'Not signed yet' : a.a ? `Signed ${fmtD(a.a)}${yr(a.a)}` : 'Not signed'}<em>{a.b ? `${a.st === 'renew' ? 'Renews' : 'Runs to'} ${fmtD(a.b)}${yr(a.b)}` : a.roll ? 'Month to month' : a.st === 'signed' ? 'No end date' : ''}</em></span><span className="gt-st" style={css(`--c:${AST[a.st][1]}`)}>{AST[a.st][0]}</span><span className="gv-go">{ICO.chev}</span></button>)}</Fragment> : '';
        }) : <div className="gv-e"><span>{AGR.length ? 'Nothing here right now' : 'No agreements are recorded yet'}</span></div>}</div>, <><span>Signed copies come back from the e-signature tool and are kept in Records</span><span className="quiet">{plural(Ls.length, 'agreement', 'agreements')}</span></>);
      const R = AGR.filter(a => a.st === 'renew' && a.b).sort((a, b) => a.b - b.b);
      const renew = cell('s7', 'Renewing', <span className="lbl">By renewal date</span>, R.length ? calList(R.map(a => ({
        t: a.b,
        kind: 'renew',
        title: `${a.name} · ${a.party}`,
        ent: a.type === 'company' ? 'coop' : 'fin',
        st: 'next',
        owner: (AGR_T.find(t => t[0] === a.type) || [, a.type])[1],
        at: `data-gagr="${a.id}"`
      }))) : <div className="gv-e"><span>Nothing is up for renewal</span></div>, <><span>Renewals go to the board when terms change</span><span /></>);
      const Wt = AGR.filter(wt);
      const wait = cell('s5', 'Waiting on someone', <span className="lbl">{plural(Wt.length, 'agreement', 'agreements')}</span>, Wt.length ? <div className="gt-wl">{Wt.map((a, __k) => <button key={__k} className={`gt-wr st-${a.st}`} data-gagr={a.id}><i style={css(`background:${AST[a.st][1]}`)} /><span className="gt-ck"><b>{a.party}</b><span>{a.name}{" "}{a.ver}</span></span><span className="gt-wn">{a.st === 'out' ? 'You' : a.st === 'sent' ? 'The other side' : 'Being drafted'}</span></button>)}</div> : <div className="gv-e"><span>Nothing waits on anyone</span></div>, <><span>Signing happens in the e-signature tool</span><span /></>);
      const vers = notReal('s12', 'Versions', 'Needs each agreement’s versions: when each was adopted or replaced, what changed, who approved it, and who has accepted which.');
      html(document.getElementById('gv'), <>{band(list, 1)}{band(vers)}{band(<>{renew}{wait}</>)}</>);
    }

    /* ── a meeting: the next one's agenda and its flows (the item, the packet, the minutes), or a held one's record ── */
    function mtPanelLive(id) {
      const m = MEETINGS.find(x => x[0] === id),
        b = GBOARDS.find(x => x[0] === m[1]) || [m[1], m[1], '', []];
      const filled = b[3].filter(s => s[1]).length,
        day = Math.floor(m[2] / DAY) * DAY,
        dec = RESOS.filter(r => r[1] === m[1] && Math.abs(r[0] - day) < DAY).length,
        flows = STAFF() && coopNext(m);
      return <><div className="pn-hd"><span className="lbl">{b[1]}{" · meeting"}</span><button className="x" data-gclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div><p className="bpn-t">{mtWhen(m[2])}</p><p className="bpn-s">{m[3]}</p></div>{m === LG.NEXT ? AGENDA.length ? <div>{lbl('Agenda')}<div className="led">{AGENDA.map((x, __k) => <div key={__k}><span>{x[0]}</span><b>{x[1]}{" min · "}{AK[x[3]][0]}</b></div>)}</div></div> : <p className="bpn-n">Nothing is on the agenda yet.</p> : m[4] === 'next' ? <p className="bpn-n">The agenda kept here is the next meeting’s, the {bLow(bname(LG.NEXT[1]))} on {fmtD(LG.NEXT[2])}.</p> : <div className="led">{[['Minutes', m[5] === 'approve' ? 'Drafted · approved at the next meeting' : 'In Records once approved'], ['Seats filled', `${filled} of ${b[3].length}`], ['Decided that day', plural(dec, 'resolution', 'resolutions')]].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>}</div><div className="pn-ft">{flows ? <><button className="btn" data-gflow="item">Add an item</button><button className="btn" data-gflow="minutes">Start the minutes</button><button className="btn p" data-gflow="packet">Send the packet</button></> : m[4] === 'held' && STAFF() ? <><span className="small quiet" style={css("margin-right:auto")}>{m[5] === 'approve' ? 'Minutes to approve' : 'Held'}</span><button className="btn p" data-gflow="log">Log a decision</button></> : <><span className="small quiet" style={css("margin-right:auto")}>{m[4] === 'next' ? 'Next' : m[5] === 'approve' ? 'Minutes to approve' : 'Held'}</span><button className="btn" data-gclose="">Close</button></>}</div></>;
    }

    /* ══ render + events ════════════════════════════════════════════════════════════════════════════════════════ */
    function render() {
      document.querySelectorAll('.gtabs [data-gtab]').forEach(b => b.setAttribute('aria-current', b.dataset.gtab === G.tab ? 'page' : 'false'));
      if (!LIVE()) return;
      sync();
      W.classList.toggle('ro', !STAFF());
      W.classList.toggle('tot', TOT());
      renderHdr();
      ({
        overview: renderOverview,
        proposals: renderProposals,
        boards: renderBoards,
        entities: renderEntities,
        agreements: renderAgreements,
        calendar: renderCalendar
      })[G.tab]();
      renderPanel();
      if (TOT()) CC.scrub(W);
      setHash();
    }
    function sync() {
      const k = meKey();
      if (k !== G.me) {
        G.me = k;
        G.panel = null;
      }
      const a = AGR.find(x => x.id === 'icw');
      if (!LG && a.st === 'out' && !S.waiting.some(w => w.id === 'agreement')) {
        a.st = 'signed';
        a.a = NOW;
      }
    }
    const logIt = (what, detail, res) => {
      try {
        LOG.unshift(['x' + Date.now(), Date.UTC(2026, 9, 21, 14, 30), PPL[G.me].ini, 'gov', what, detail, 'Mac · Redlands', res, res === 'approved' ? 'Second signature' : '']);
      } catch (e) {}
    };
    const closeG = () => {
      G.panel = null;
      G.back = false;
    };
    document.addEventListener('click', e => {
      if (e.target.id === 'gscrim') {
        closeG();
        return render();
      }
      const t = e.target.closest('button,a,[data-gopen],[data-gst],[data-gjump],[data-gent],[data-gagr],[data-gmt],[data-gmo],[data-gtab],[data-gvote],[data-greso],[data-gmatter]');
      if (!t) return;
      const d = t.dataset;
      // live, changes go through the old page's flows and Contracts' (they save through the API, then the page is built again)
      if (LG) {
        if (d.gvote !== undefined) return LG.VOTE ? openVFlow('ballot') : undefined;
        if (d.gflow) return openVFlow(d.gflow, d.gid || undefined);
        if (d.gfile) return openVFlow('filing', d.gfile);
        if (d.greso) return openVFlow('reso', d.greso);
        if (d.gmatter) return openVFlow('matter', d.gmatter);
        if (d.gsign) return openCFlow('esign', d.gsign);
        if (d.grenew) return openCFlow('renew', d.grenew);
      }
      if (d.gtab) {
        G.tab = d.gtab;
        closeG();
        render();
        window.scrollTo({
          top: 0
        });
        return;
      }
      if (d.gset) {
        G.set = d.gset;
        G.st = null;
        G.pp = 0;
        return render();
      }
      if (d.gst) {
        G.tab = 'proposals';
        G.st = d.gst === 'all' || G.st === d.gst ? null : d.gst;
        if (d.gst === 'all') G.set = 'open';
        G.pp = 0;
        return render();
      }
      if (d.gjump) {
        const el = document.getElementById(d.gjump);
        el && el.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
        return;
      }
      if (d.gidea !== undefined) {
        closeG();
        return goOut('community/forum');
      }
      if (d.gopen) {
        G.panel = {
          id: d.gopen,
          thread: d.gthread
        };
        G.back = false;
        return render();
      }
      if (d.gent) {
        G.panel = {
          ent: d.gent
        };
        return render();
      }
      if (d.gagr) {
        G.panel = {
          agr: d.gagr
        };
        return render();
      }
      if (d.gmt) {
        G.panel = {
          mt: d.gmt
        };
        return render();
      }
      if (d.gcal) {
        G.cal = d.gcal;
        return render();
      }
      if (d.gcv) {
        G.cv = d.gcv;
        return render();
      }
      if (d.gmo !== undefined) {
        G.mo = Math.max(0, Math.min(11, +d.gmo));
        if (d.gmv) G.cv = 'month';
        return render();
      }
      if (d.gag) {
        G.ag = d.gag;
        return render();
      }
      if (d.gsign === 'icw' && S.waiting.some(w => w.id === 'agreement')) {
        closeG();
        render();
        return openItem('agreement');
      }
      if (d.gsign) {
        const a = AGR.find(x => x.id === d.gsign);
        logIt(`Signed the ${a.name.toLowerCase()} · ${a.party}`, a.ver, 'signed');
        a.st = 'signed';
        a.a = NOW;
        a.b = NOW + 365 * DAY;
        closeG();
        render();
        return toast(`Signed · ${a.party} is added in the Ops Safe next, in Build`);
      }
      if (d.gcomm !== undefined) {
        closeG();
        return goOut('community/live');
      }
      if (d.gcompare) return toast('Opens the two versions side by side, with every change marked');
      if (d.gdraft) {
        const a = AGR.find(x => x.id === d.gdraft),
          V = VERS[a.id],
          last = V[V.length - 1];
        return toast(last[2] === 'draft' || last[2] === 'vote' ? `${last[0]} is already open · edit it instead` : `Drafts the next version from ${last[0]} · it goes to ${a.type === 'member' ? 'a member vote' : 'the board'} before it’s in force`);
      }
      if (d.gfile) return toast('Opens the filing checklist');
      if (d.gclose !== undefined) {
        closeG();
        return render();
      }
      if (d.gpp) {
        G.pp += +d.gpp;
        return render();
      }
      if (d.gbacko !== undefined) {
        G.back = true;
        return render();
      }
      if (d.gbackx !== undefined) {
        G.back = false;
        return render();
      }
      if (d.gsend) {
        const p = PROP[d.gsend],
          why = (document.getElementById('gback') || {}).value || 'No reason given';
        logIt(`Sent ${p.id} back to its author`, why, 'done');
        p.st = 'draft';
        p.ver += 1;
        closeG();
        render();
        return toast(`Sent back to ${byName(p.by)} · the reason is posted in the thread`);
      }
      if (d.gpass) {
        const p = PROP[d.gpass];
        logIt(`Checked ${p.id} · ${p.t}`, RULES[p.type].q ? 'Voting opens now' : 'On the board’s agenda', 'done');
        p.checks.forEach(c => c[2] = 1);
        if (RULES[p.type].q) {
          p.st = 'vote';
          p.voteOpen = NOW;
          p.voteClose = NOW + RULES[p.type].days * DAY;
          p.cast = 0;
          p.castBy = [0];
          p.frozen = NOW;
        } else {
          p.st = 'vote';
          p.board = D(11, 4);
          p.frozen = NOW;
        }
        closeG();
        render();
        return toast(p.board ? `Checked · on the board’s agenda for 4 Nov · text frozen` : `Checked · voting opens now`);
      }
      if (d.gtask) {
        const [id, i] = d.gtask.split(':'),
          p = PROP[id];
        logIt(`Marked done: ${p.tasks[+i][0]}`, `${p.id} · ${p.t}`, 'done');
        p.tasks[+i][4] = 'done';
        if (p.tasks[+i + 1] && p.tasks[+i + 1][4] === 'waits') p.tasks[+i + 1][4] = 'doing';
        render();
        return toast('Marked done · logged in Records');
      }
      if (d.gremind) return toast(`Reminder sent to ${MEMBERS - PROP[d.gremind].cast} members · in the app and by email`);
      if (d.gapp !== undefined) return toast('Opens your ballot in the member app');
      if (d.gshare !== undefined) return toast('Co-sign link copied');
      if (d.gforum !== undefined) {
        const id = G.panel && G.panel.id;
        closeG();
        // the reference's COMM2.openFor: Community opens this proposal's own thread
        return CC.go('community', id ? `forum:${id}` : 'forum');
      }
    });
    document.addEventListener('keydown', e => {
      if (!LIVE()) return;
      if (e.key === 'Escape' && G.panel && !document.querySelector('.modal')) {
        closeG();
        render();
      }
    });
    const TABS = ['overview', 'proposals', 'boards', 'entities', 'agreements', 'calendar'],
      OLD = {
        votes: 'proposals'
      };
    return {
      render,
      tab: () => G.tab,
      setTab(t) {
        t = OLD[t] || t;
        if (TABS.includes(t)) G.tab = t;
        closeG();
      },
      close() {
        closeG();
      },
      open(k, id) {
        G.panel = {
          [k]: id
        };
      }
    };
  })(DOCP);
  // live, the agreements are Build's (the contracts section): loaded beside the page's own, once, then the shell draws again
  let loadingAgr = false;
  function mount() {
    // the slot is the shell's: the host goes inside it
    if (!into('vx-slot')) return;
    if (LG && LIVE_APP && needsData('contracts') && !loadingAgr) {
      loadingAgr = true;
      loadSection('contracts').then(
        () => {
          loadingAgr = false;
          if (CC.route() === 'governance') renderShell();
        },
        () => undefined,
      );
    }
    API.render();
  }
  function unmount() {
    if (host.isConnected) return;
    API.close();
    W.classList.remove('pn');
  }
  /*
   * p: a tab (`votes` is Proposals, as old links have it), or a panel to open on its tab: `id:P-012` (a
   * proposal), `ent:dt` (an entity), `agr:icw` (an agreement), `mt:M-14` (a meeting). The reference's
   * GOV2.open / openEnt / openAgr are CC.go('governance', 'id:…' / 'ent:…' / 'agr:…') here.
   */
  const PANES = { id: 'proposals', ent: 'entities', agr: 'agreements', mt: 'boards' };
  function setTab(p) {
    if (!p) return;
    const [k, x] = String(p).split(':');
    if (PANES[k] && x) {
      API.setTab(PANES[k]);
      API.open(k, x);
    } else if (k === 'proposals' && x) {
      // Community links a proposal as proposals:P-012: its tab with its panel open
      API.setTab('proposals');
      API.open('id', x);
    } else API.setTab(k);
  }
  return {
    mount,
    unmount,
    setTab: (_r, sub) => setTab(sub),
    tab: () => API.tab(),
    host
  };
}
registerPage(['governance'], 'vx-slot', makeGovernance, { live: true });
