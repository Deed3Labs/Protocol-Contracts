// @ts-nocheck: ported from the redesign's COMM2 module (design/command-center-ui) with scripts/port/module.cjs; its data is its own.
import { Fragment } from 'react';
import { attrs, css, hasHtml, html } from '../runtime/dom';
import { CC } from './cc';
import { LOG, S } from './data';
import { registerPage, shadowHost } from './pageHost';
import { toast } from './shell';

/*
 * Community (design/command-center-ui, the COMM2 module): where members talk, meet and watch, in four
 * tabs (Overview, Forum, Live, Channel), with side panels for an event and a thread. It lives in its own
 * shadow root (pageHost.tsx); its inner module reads the root through a document stand-in (DOCP), as the
 * reference has it. Links out go through CC.go. There's no backend for it yet, so it's registered with
 * the live gate off: the live app keeps the placeholder, and the prototype preview shows this.
 */

/** The page's skeleton: the reference template's markup. */
function skeleton() {
  return <div className="gw cmw" id="cw"><div className="hdr stack" id="hdr" /><nav className="gtabs" aria-label="Community views"><button data-ctab="overview">Overview</button><button data-ctab="forum">Forum</button><button data-ctab="live">Live</button><button data-ctab="channel">Channel</button></nav><div id="cv" /></div>;
}
function makeCommunity() {
  const { host, R: SR, W, into } = shadowHost('community', skeleton());
  const LIVE = () => host.isConnected && CC.route() === 'community';
  const RO = () => CC.viewing() && CC.level('community') < 3;
  const TOT = () => CC.viewing() && CC.level('community') === 1;
  const meKey = () => {
    const v = S.view;
    if (!v) return 'kai';
    return {
      K: 'kai',
      DR: 'dana'
    }[v.person] || {
      admin: 'kai',
      protocol: 'dana',
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
      history.replaceState(null, '', '#community' + (t === 'overview' ? '' : '/' + t));
    } catch (e) {}
  }
  API = (document => {
    /* ══ Community data — the forum, live events and the co-op's channel on Dial ═══════════════════════════════════
       Demo "today" is Wed 21 Oct 2026, 14:00. Community is where members talk, meet and watch; Governance tracks what
       gets decided. Members are masked here as everywhere in the Command Center; the app shows the name each one picks. */
    const DAY = 864e5,
      TODAY = Date.UTC(2026, 9, 21),
      NOW = TODAY + 14 * 3600e3;
    const D = (m, d, y = 2026) => Date.UTC(y, m - 1, d);
    const H = (m, d, h, mi = 0) => Date.UTC(2026, m - 1, d, h, mi);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmtD = t => `${new Date(t).getUTCDate()} ${MON[new Date(t).getUTCMonth()]}`;
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
    const int = n => Math.round(n).toLocaleString('en-US');
    const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
    const MEMBERS = 188;
    const PPL = {
      kai: {
        n: 'Kai',
        ini: 'K',
        role: 'Admin',
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
        role: 'Member'
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
    const who = k => k === C.me ? 'You' : PPL[k] ? PPL[k].n : `Member M•••${k}`;

    /* the forum */
    const CATS = [['all', 'All'], ['proposals', 'Proposals'], ['ideas', 'Ideas'], ['places', 'Neighborhoods'], ['help', 'Questions'], ['shops', 'Shops'], ['news', 'From Clear']];
    const CAT = Object.fromEntries(CATS);
    const THREADS = [/* id, cat, title, by, replies, readers, last post, flags: pin | hot | answered | locked | staff, proposal */
    {
      id: 'T-412',
      cat: 'proposals',
      t: 'Adopt member agreement v2.2',
      by: 'kai',
      r: 42,
      rd: 131,
      last: H(10, 21, 12, 40),
      pin: 1,
      prop: 'P-012',
      note: 'Open during the vote · text frozen'
    }, {
      id: 'T-438',
      cat: 'help',
      t: 'Does a late payment in my first month count against the $150 limit?',
      by: '2d',
      r: 3,
      rd: 44,
      last: H(10, 21, 11, 5),
      prop: 'P-016'
    }, {
      id: 'T-421',
      cat: 'proposals',
      t: 'Reprint the window posters for Cajon Blvd',
      by: 'a4',
      r: 12,
      rd: 58,
      last: H(10, 21, 9, 30),
      prop: 'P-015',
      hot: 1
    }, {
      id: 'T-436',
      cat: 'ideas',
      t: 'A tool library at the Highland community room',
      by: 'e1',
      r: 8,
      rd: 61,
      last: H(10, 20, 19, 10),
      hot: 1
    }, {
      id: 'T-430',
      cat: 'places',
      t: 'Highland: who’s at the coffee hour today?',
      by: '3c',
      r: 19,
      rd: 47,
      last: H(10, 21, 13, 52)
    }, {
      id: 'T-417',
      cat: 'shops',
      t: 'Rosa’s now takes Clear Pay at the counter, not just the window',
      by: 'b8',
      r: 6,
      rd: 72,
      last: H(10, 20, 16, 30),
      answered: 1
    }, {
      id: 'T-415',
      cat: 'proposals',
      t: 'Raise the starter credit limit to $150.00',
      by: '7c',
      r: 27,
      rd: 96,
      last: H(10, 20, 15, 0),
      prop: 'P-016'
    }, {
      id: 'T-409',
      cat: 'news',
      t: 'October town hall: send your questions',
      by: 'dana',
      r: 17,
      rd: 140,
      last: H(10, 20, 10, 0),
      staff: 1,
      pin: 1
    }, {
      id: 'T-433',
      cat: 'help',
      t: 'How do I move savings into Earn?',
      by: '9b',
      r: 4,
      rd: 29,
      last: H(10, 19, 20, 15),
      answered: 1
    }, {
      id: 'T-402',
      cat: 'places',
      t: 'Uptown Barber launch photos',
      by: 'e1',
      r: 11,
      rd: 84,
      last: H(10, 18, 12, 0)
    }, {
      id: 'T-398',
      cat: 'ideas',
      t: 'Saturday mornings for the annual meeting',
      by: '3c',
      r: 5,
      rd: 33,
      last: H(10, 20, 10, 0),
      prop: 'P-017'
    }, {
      id: 'T-391',
      cat: 'shops',
      t: 'Which shops do term plans?',
      by: '5f',
      r: 9,
      rd: 51,
      last: H(10, 17, 18, 40),
      answered: 1
    }, {
      id: 'T-380',
      cat: 'help',
      t: 'Locked: shared someone’s address',
      by: 'b8',
      r: 2,
      rd: 12,
      last: H(10, 20, 15, 20),
      locked: 1
    }];
    const POSTS_WK = [118, 142, 131, 164, 189, 176, 214],
      WEEKS = ['7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct', '19 Oct'];
    const IDEAS = 23;

    /* what moderators see. Nothing is deleted: hiding is logged with a reason, and the author is told why. */
    const FLAGS = [{
      id: 'F-88',
      thread: 'T-412',
      by: 'b8',
      at: H(10, 20, 15, 20),
      why: 'Shared another member’s address',
      src: 'Caught automatically',
      st: 'hidden',
      mod: 'dana',
      t: '…she lives on 1400 block of…'
    }, {
      id: 'F-91',
      thread: 'T-430',
      by: '6a',
      at: H(10, 21, 13, 40),
      why: 'Selling something',
      src: '2 members reported it',
      st: 'open',
      t: 'Anyone want to buy a couch? DM me, $80'
    }, {
      id: 'F-92',
      thread: 'T-421',
      by: '4f',
      at: H(10, 21, 12, 10),
      why: 'Rude to another member',
      src: '1 member reported it',
      st: 'open',
      t: 'That’s a dumb idea and you know it'
    }, {
      id: 'F-93',
      thread: 'T-438',
      by: '2d',
      at: H(10, 21, 11, 6),
      why: 'Might include an account number',
      src: 'Caught automatically',
      st: 'open',
      t: 'my card ends in •••• and the limit still says $100'
    }, {
      id: 'F-85',
      thread: 'T-402',
      by: 'e1',
      at: H(10, 18, 12, 5),
      why: 'Photo with a child’s face',
      src: 'Caught automatically',
      st: 'kept',
      mod: 'kai',
      t: 'Photo: the launch morning, with the owner’s family'
    }];

    /* live: town halls, audio spaces, presentations, hearings and meetings */
    const KIND = {
      town: ['Town hall', 'Video · questions from members'],
      space: ['Space', 'Audio · anyone can raise a hand'],
      talk: ['Presentation', 'Slides and video'],
      hearing: ['Hearing', 'On a proposal, during its discussion'],
      board: ['Board meeting', 'Open session · the record is in Governance'],
      annual: ['Annual meeting', 'Live · votes are signed in the app']
    };
    const EVENTS = [{
      id: 'E-33',
      kind: 'space',
      t: 'Highland coffee hour',
      host: '3c',
      co: ['dana'],
      at: H(10, 21, 13, 18),
      len: 60,
      st: 'live',
      live: 18,
      peak: 24,
      hands: 3,
      req: true,
      place: 'Highland',
      chan: true
    }, {
      id: 'E-34',
      kind: 'town',
      t: 'October town hall: credit limits and the starter tier',
      host: 'kai',
      co: ['dana'],
      at: H(10, 22, 18),
      len: 60,
      st: 'next',
      rsvp: 54,
      q: 17,
      qSorted: 6,
      prop: 'P-016',
      chan: true,
      prep: [['Slides', 1], ['Questions sorted', '6 of 17'], ['Captions', 'On'], ['On the channel', 'Live at 18:00']]
    }, {
      id: 'E-36',
      kind: 'space',
      t: 'Poster walk: Cajon Blvd',
      host: 'a4',
      at: H(10, 24, 10),
      len: 90,
      st: 'request',
      place: 'Cajon Blvd',
      why: 'Walk the poster route and swap the faded ones, live from the street.',
      prop: 'P-015'
    }, {
      id: 'E-37',
      kind: 'talk',
      t: 'How the AssurancePool works',
      host: 'dana',
      at: H(10, 27, 18),
      len: 40,
      st: 'next',
      rsvp: 21,
      chan: true
    }, {
      id: 'E-38',
      kind: 'board',
      t: 'Co-op board · open session',
      host: 'kai',
      at: H(11, 4, 18),
      len: 90,
      st: 'next',
      rsvp: 12,
      chan: true,
      gov: 'Agenda: P-016 and the 2027 budget'
    }, {
      id: 'E-39',
      kind: 'space',
      t: 'New members: ask anything',
      host: 'a4',
      at: H(10, 29, 19),
      len: 45,
      st: 'request',
      why: 'Monthly drop-in for people who joined this month.'
    }, {
      id: 'E-40',
      kind: 'annual',
      t: 'Annual member meeting',
      host: 'kai',
      at: Date.UTC(2027, 0, 15, 18),
      len: 120,
      st: 'next',
      rsvp: 0,
      chan: true,
      gov: 'Board elections · P-014'
    }, {
      id: 'E-31',
      kind: 'hearing',
      t: 'Hearing: member agreement v2.2',
      host: 'kai',
      co: ['dana'],
      at: H(10, 19, 18),
      len: 55,
      st: 'past',
      came: 46,
      peak: 41,
      q: 22,
      qAns: 19,
      prop: 'P-012',
      rec: 'On the channel · 212 views'
    }, {
      id: 'E-30',
      kind: 'talk',
      t: 'Term plans, start to finish',
      host: 'dana',
      at: H(10, 13, 18),
      len: 35,
      st: 'past',
      came: 29,
      peak: 27,
      q: 9,
      qAns: 9,
      rec: 'On the channel · 148 views'
    }, {
      id: 'E-29',
      kind: 'town',
      t: 'September town hall',
      host: 'kai',
      co: ['dana'],
      at: H(9, 24, 18),
      len: 70,
      st: 'past',
      came: 61,
      peak: 52,
      q: 31,
      qAns: 24,
      rec: 'On the channel · 390 views'
    }];
    const EV = Object.fromEntries(EVENTS.map(e => [e.id, e]));
    /* the live space, minute by minute */
    const LIVE_CURVE = [4, 7, 11, 14, 17, 19, 22, 24, 23, 21, 20, 19, 18, 18];
    /* last town hall: how many were in the room, minute by minute */
    const TH_CURVE = [12, 31, 44, 49, 52, 51, 50, 48, 47, 46, 44, 41, 38];

    /* the channel: Clear on Dial. One station now; a station per community once there are councils. */
    const CH = {
      name: 'Clear',
      num: 'Channel 4',
      call: 'CLR',
      viewers: 23,
      wk: 312,
      comments: 96,
      relay: 'Off · Dial only'
    };
    const SCHED = [/* start hour, length in hours, title, kind: loop | live | replay | show | off */
    [0, 6, 'Off air', 'off'], [6, 3, 'How Clear works', 'loop', 'Five explainers on repeat'], [9, 3, 'Shop spotlights', 'show', 'Rosa’s, Uptown Barber, Highland Hardware'], [12, 1.3, 'Member stories', 'show', 'Three members, three neighborhoods'], [13.3, 1.2, 'Highland coffee hour', 'live', 'From the Space · audio with captions'], [14.5, 1.5, 'Hearing: agreement v2.2', 'replay', 'Recorded Mon 19 Oct'], [16, 2, 'Shop spotlights', 'show', 'Repeat'], [18, 1, 'How the AssurancePool works', 'replay', 'Preview of Tue’s talk'], [19, 3, 'How Clear works', 'loop', 'Five explainers on repeat'], [22, 2, 'Off air', 'off']];
    const LIB = [['Hearing: member agreement v2.2', 'Recording · 55 min', 212, H(10, 19, 19)], ['September town hall', 'Recording · 70 min', 390, H(9, 24, 19)], ['Term plans, start to finish', 'Presentation · 35 min', 148, H(10, 13, 19)], ['How Clear works', 'Explainers · 5 parts', 1240, D(9, 1)], ['Shop spotlight: Rosa’s Panadería', 'Story · 6 min', 301, D(10, 2)], ['Member stories: Highland', 'Story · 12 min', 176, D(10, 9)]];
    const VIEW_HR = [0, 0, 0, 0, 0, 0, 4, 7, 9, 8, 10, 12, 14, 21, 23]; /* viewers by hour, today */

    /* who takes part, by week: wrote in the forum, came to something live, watched the channel (members, not views) */
    const PART = {
      posted: [31, 36, 34, 41, 47, 44, 52],
      came: [18, 0, 29, 22, 0, 29, 46],
      watched: [22, 25, 27, 30, 33, 38, 44],
      any: [48, 51, 55, 60, 66, 71, 78]
    };

    /* ══ Community — where members talk, meet and watch ═══════════════════════════════════════════════════════════
       Overview (what's on and what needs you) · Forum (every thread, and moderation) · Live (town halls, spaces,
       presentations, hearings) · Channel (Clear on Dial). Decisions are tracked in Governance; this is the conversation. */
    const C = {
      tab: 'overview',
      cat: 'all',
      tp: 0,
      ep: 0,
      panel: null,
      me: 'kai',
      ev: 'list',
      mo: 0
    };
    const ICO = {
      chev: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>,
      back: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>,
      x: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>,
      talk: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" /></svg>,
      eye: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></svg>,
      air: <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="1.6" /><path d="M5 5a4.2 4.2 0 0 0 0 6M11 5a4.2 4.2 0 0 1 0 6M3 3a7 7 0 0 0 0 10M13 3a7 7 0 0 1 0 10" /></svg>
    };
    const cell = (cls, title, right, body, foot) => <div className={`cell ${cls}`}><div className="hd"><h2>{title}</h2><div className="r">{right}</div></div>{body}<div className="bk-ft">{foot}</div></div>;
    const lbl = t => <span className="lbl">{t}</span>;
    const band = (cells, first) => <section className="band" {...attrs(first ? ' style="margin-top:0"' : '')}><div className="bento">{cells}</div></section>;
    const pager = (p, n, per, key) => {
      const pages = Math.max(1, Math.ceil(n / per));
      return <span className="pg2"><span>{n ? p * per + 1 : 0}{"–"}{Math.min(n, (p + 1) * per)}{" of "}{n}</span><button {...attrs(`data-${key}="-1"${p === 0 ? ' disabled' : ''}`)} aria-label="Previous">{ICO.back}</button><button {...attrs(`data-${key}="1"${p >= pages - 1 ? ' disabled' : ''}`)} aria-label="Next">{ICO.chev}</button></span>;
    };
    const pagerOr = (p, n, per, key, noun) => n > per ? pager(p, n, per, key) : <span className="quiet">{n}{" "}{noun}</span>;
    const av = k => <span className="av sm" title={who(k)}>{PPL[k] ? PPL[k].ini : k.toUpperCase()}</span>;
    const STAFF = () => !RO() && !!PPL[C.me] && PPL[C.me].staff;
    const kindTag = e => <span className={`cm-kt ${e.kind}`}>{KIND[e.kind][0]}</span>;
    const hrs = n => {
      const h = Math.floor(n),
        m = Math.round((n - h) * 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };
    const nowH = (NOW - TODAY) / 3600e3;
    const live = () => EVENTS.find(e => e.st === 'live');
    const reqs = () => EVENTS.filter(e => e.st === 'request');
    const flagsOpen = () => FLAGS.filter(f => f.st === 'open');

    /* ── header ── */
    function renderHdr() {
      const L = live(),
        wk = EVENTS.filter(e => e.st !== 'past' && e.at >= NOW - DAY && e.at < NOW + 7 * DAY),
        part = PART.any[PART.any.length - 1];
      const B = {
        overview: <>{L ? <><a data-copen={L.id}>{L.t}</a>{" is live with "}{L.live}{" listening. "}</> : ''}{"Tomorrow’s town hall has "}{EV['E-34'].rsvp}{" coming and "}{EV['E-34'].q - EV['E-34'].qSorted}{" questions still to sort."}</>,
        forum: `${POSTS_WK[POSTS_WK.length - 1]} posts this week, the most so far. ${flagsOpen().length} flagged posts are waiting for a moderator.`,
        live: `${reqs().length} members have asked to host something. The last hearing answered ${EV['E-31'].qAns} of ${EV['E-31'].q} questions.`,
        channel: `${CH.name} is on ${CH.num} with ${CH.viewers} watching. Tomorrow at 18:00 the town hall airs live.`
      }[C.tab];
      const segs = (arr, col) => arr.map((x, i) => <i key={i} style={css(`left:${i / Math.max(5, arr.length) * 100}%;width:calc(${100 / Math.max(5, arr.length)}% - 2px);background:${col(x)}`)} />);
      const pw = POSTS_WK,
        pmx = Math.max(...pw);
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />Community · Wed 21 Oct · Demo data</span><p className="brief">{B}</p><div className="strip"><div className="sc" {...attrs(L ? `data-copen="${L.id}"` : '')}><span className="lbl">On air now</span><div className="sc-v">{L ? L.live : 0}{" "}<small>{L ? 'listening' : 'nothing live'}</small></div><div className="mb"><i style={css(`width:${L ? L.live / L.peak * 100 : 0}%;background:var(--absent)`)} /></div><div className="sc-s">{L ? `${L.t} · peak ${L.peak}` : 'Next: tomorrow 18:00'}</div></div><div className="sc" data-ctab="live"><span className="lbl">Next 7 days</span><div className="sc-v">{wk.filter(e => e.st !== 'request').length}{" "}<small>events</small></div><div className="mb">{segs(wk, e => e.st === 'request' ? 'var(--line)' : e.st === 'live' ? 'var(--absent)' : 'var(--fg)')}</div><div className="sc-s">{wk.filter(e => e.st === 'request').length}{" more asked for · "}{EV['E-34'].rsvp}{" coming tomorrow"}</div></div><div className="sc" data-ctab="forum"><span className="lbl">Forum this week</span><div className="sc-v">{pw[pw.length - 1]}{" "}<small>posts</small></div><div className="mb">{pw.map((v, i) => <i key={i} style={css(`left:${i / pw.length * 100}%;width:calc(${100 / pw.length}% - 2px);background:color-mix(in srgb,var(--fg) ${Math.round(18 + v / pmx * 70)}%,transparent)`)} />)}</div><div className="sc-s">{Math.round((pw[6] / pw[5] - 1) * 100)}{"% more than last week · "}{IDEAS}{" ideas"}</div></div><div className="sc" data-cjump="cm-part"><span className="lbl">Taking part</span><div className="sc-v">{part}{" "}<small>{"of "}{MEMBERS}{" members"}</small></div><div className="mb"><i style={css(`width:${part / MEMBERS * 100}%;background:var(--land)`)} /></div><div className="sc-s">{pct(part, MEMBERS)}{" posted, came or watched this week"}</div></div></div></>);
    }

    /* ── shared pieces ── */
    function needsCell() {
      const E3 = EV['E-34'],
        N = [...reqs().map(e => ['underway', `Approve: ${e.t}`, `${who(e.host)} asked to host · ${WD(e.at)} ${fmtD(e.at)} ${hm(e.at)}`, WD(e.at), 'Request', `data-copen="${e.id}"`]), ...(flagsOpen().length ? [['absent', `${flagsOpen().length} flagged posts`, flagsOpen().map(f => f.why.toLowerCase()).join(' · '), ago(Math.min(...flagsOpen().map(f => f.at))).replace(' ago', ''), 'Moderate', 'data-ctab="forum" data-cjump="cm-flags"']] : []), ['live', `Sort questions for ${WD(E3.at)}’s town hall`, `${E3.q - E3.qSorted} of ${E3.q} still to sort · you host it`, 'Tomorrow', 'You host', `data-copen="${E3.id}"`]];
      return cell('s5', 'Needs you', <span className="lbl">{N.length}{" things"}</span>, <div className="gv-nd">{N.map(([sv, t, m, age, own, at], __k) => <button key={__k} className="gv-nd-r" {...attrs(at)}><i style={css(`background:${{
            underway: 'var(--underway)',
            live: 'var(--live)',
            absent: 'var(--absent)',
            line: 'var(--line)'
          }[sv]}`)} /><span className="gv-nd-k"><b>{t}</b><span>{m}</span></span><span className="gv-nd-a"><span className={sv === 'live' ? 'me' : sv === 'absent' ? 'bad' : ''}>{own}</span><span className="mono">{age}</span></span></button>)}</div>, <><span>Members host by request · staff and board approve</span><span /></>);
    }
    function curve(arr, mx, cls = '') {
      return <div className={`cm-cv ${cls}`}>{arr.map((v, i) => <i key={i} style={css(`height:${v / mx * 100}%`)} className={i === arr.length - 1 ? 'now' : ''} />)}</div>;
    }
    function evRow(e, compact) {
      const m = e.st === 'live' ? <b className="cm-on">{e.live}{" listening"}</b> : e.st === 'request' ? <b className="cm-rq">Asked to host</b> : e.st === 'past' ? <b>{e.came}{" came"}</b> : <b>{e.rsvp ? e.rsvp + ' coming' : 'RSVPs open later'}</b>;
      const sub = e.st === 'past' ? `${e.qAns} of ${e.q} questions answered` : e.st === 'live' ? `Peak ${e.peak} · ${e.hands} hands raised` : e.q ? `${e.q} questions in` : e.gov ? e.gov : e.place || '';
      return <button className={`cm-ev st-${e.st}`} data-copen={e.id}>{leaf(e.at)}<span className="cm-ev-k"><span className="cm-ev-h">{kindTag(e)}{e.prop ? <span className="cm-pr mono">{e.prop}</span> : ''}{e.chan && !compact ? <span className="cm-ch" title="On the channel">{ICO.air}</span> : ''}</span><b>{e.t}</b><span>{hm(e.at)}{" · "}{e.len}{" min · "}{who(e.host)}{e.co ? ` with ${e.co.map(who).join(', ')}` : ''}</span></span><span className="cm-ev-m">{m}<span>{sub}</span></span></button>;
    }
    function thRow(t) {
      return <button className={`cm-th ${t.locked ? 'lk' : ''}`} data-cthread={t.id}><span className="cm-th-k"><span className="cm-th-h">{t.pin ? <span className="cm-fl pin">Pinned</span> : ''}{t.answered ? <span className="cm-fl ok">Answered</span> : ''}{t.locked ? <span className="cm-fl lk">Locked</span> : ''}{t.hot ? <span className="cm-fl hot">Busy</span> : ''}{t.prop ? <span className="cm-pr mono">{t.prop}</span> : ''}</span><b>{t.t}</b><span>{CAT[t.cat]}{" · "}{who(t.by)}{" · "}{t.id}</span></span><span className="cm-n">{ICO.talk}{t.r}</span><span className="cm-n">{ICO.eye}{t.rd}</span><span className="cm-th-a">{ago(t.last)}</span></button>;
    }

    /* ══ Overview ══════════════════════════════════════════════════════════════════════════════════════════════ */
    function renderOverview() {
      const L = live(),
        mins = Math.round((NOW - L.at) / 6e4);
      const on = cell('s7', 'On air now', <span className="lbl">{KIND[L.kind][0]}{" · "}{mins}{" min in"}</span>, <div className="cm-live"><div className="cm-live-h"><span className="cm-dot" /><div><b>{L.t}</b><span>{who(L.host)}{" hosts · "}{L.co.map(who).join(', ')}{" moderates · approved request"}</span></div></div><div className="cm-live-f"><div className="m-big">{L.live}{" "}<small>{"listening now · peak "}{L.peak}</small></div>{curve(LIVE_CURVE, L.peak * 1.1, 'red')}</div><div className="led cm-live-l">{[['Hands raised', `${L.hands} waiting to speak`], ['On the channel', 'Airing live on Channel 4, with captions'], ['Recording', 'Saved to the library when it ends']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>, <><span>Run it from Dial’s master control</span><button data-cdial="">Open in Dial ↗</button></>);
      const up = EVENTS.filter(e => e.st === 'next').sort((a, b) => a.at - b.at).slice(0, 4);
      const coming = cell('s7', 'Coming up', <span className="lbl">{EVENTS.filter(e => e.st === 'next').length}{" scheduled"}</span>, <div className="cm-evl">{up.map(e => <Fragment key={e.id}>{evRow(e)}</Fragment>)}</div>, <><span>Hearings and board meetings are tracked in Governance</span><button data-ctab="live">Every event →</button></>);
      const sch = cell('s5', 'On the channel today', <span className="lbl">{CH.num}{" · "}{CH.viewers}{" watching"}</span>, <div className="cm-sl">{SCHED.filter(s => s[3] !== 'off' && s[0] + s[1] > nowH - 1).slice(0, 6).map((s, __k) => {
          const on = s[0] <= nowH && nowH < s[0] + s[1];
          return <div key={__k} className={`cm-sl-r ${on ? 'on' : ''} ${s[3]}`}><span className="mono">{hrs(s[0])}</span><span><b>{s[2]}</b><em>{s[4]}</em></span>{on ? <span className="cm-onair">On air</span> : <span className="cm-sk">{{
                loop: 'Loop',
                show: 'Show',
                replay: 'Replay',
                live: 'Live'
              }[s[3]]}</span>}</div>;
        })}</div>, <><span>Off air 22:00 to 06:00</span><button data-ctab="channel">Channel →</button></>);
      const hot = THREADS.filter(t => !t.locked).sort((a, b) => b.r * 2 + b.rd / 10 - (a.r * 2 + a.rd / 10)).slice(0, 5);
      const forum = cell('s7', 'Busiest in the forum', <span className="lbl">This week</span>, <div className="cm-thl">{hot.map(t => <Fragment key={t.id}>{thRow(t)}</Fragment>)}</div>, <><span>Proposal threads link to Governance</span><button data-ctab="forum">Forum →</button></>);
      const P = PART,
        n = P.any.length - 1,
        mx = Math.max(...P.any);
      const part = cell('s5', 'Who’s taking part', <span className="lbl">Members, by week</span>, <div className="cm-pt" id="cm-part"><div className="m-big">{P.any[n]}{" "}<small>{"of "}{MEMBERS}{" members posted, came or watched this week · "}{pct(P.any[n], MEMBERS)}</small></div><div className="cm-pt-c">{P.any.map((v, i) => <div key={i} className={i === n ? 'now' : ''}><i style={css(`height:${v / mx * 100}%`)} /><s>{WEEKS[i]}</s></div>)}</div><div className="led cm-pt-l">{[['Wrote in the forum', P.posted[n]], ['Came to something live', P.came[n]], ['Watched the channel', P.watched[n]]].map(([k, v], __k) => <div key={__k}><span>{k}</span><span className="cm-pt-b"><i style={css(`width:${v / P.any[n] * 100}%`)} /></span><b>{v}</b></div>)}</div></div>, <><span>Counted once per member, however often</span><span /></>);
      html(document.getElementById('cv'), <>{band(<>{on}{needsCell()}</>, 1)}{band(<>{coming}{sch}</>)}{band(<>{forum}{part}</>)}</>);
    }

    /* ══ Forum ═════════════════════════════════════════════════════════════════════════════════════════════════ */
    function renderForum() {
      const L = THREADS.filter(t => C.cat === 'all' || t.cat === C.cat).sort((a, b) => (b.pin || 0) - (a.pin || 0) || b.last - a.last),
        per = 8;
      C.tp = Math.min(C.tp, Math.max(0, Math.ceil(L.length / per) - 1));
      const list = cell('s12', 'Every thread', <div className="seg sm" role="group" aria-label="Category">{CATS.map(([k, t], __k) => <button key={__k} data-ccat={k} aria-pressed={C.cat === k}>{t}</button>)}</div>, <div className="cm-thl"><div className="cm-th hd2"><span>{lbl('Thread')}</span>{lbl('Replies')}{lbl('Readers')}{lbl('Last post')}</div>{L.length ? L.slice(C.tp * per, C.tp * per + per).map(t => <Fragment key={t.id}>{thRow(t)}</Fragment>) : <div className="gv-e"><span>No threads here yet</span></div>}</div>, <><span>Pinned threads stay on top · proposal threads are tracked in Governance</span>{pagerOr(C.tp, L.length, per, 'ctp', 'threads')}</>);
      const F = FLAGS.slice().sort((a, b) => (a.st === 'open' ? 0 : 1) - (b.st === 'open' ? 0 : 1) || b.at - a.at);
      const flags = cell('s7', 'Flagged', <span className="lbl">{flagsOpen().length}{" waiting"}</span>, <div className="cm-fg" id="cm-flags">{F.map((f, __k) => <div key={__k} className={`cm-fg-r ${f.st}`}>{av(f.by)}<span className="cm-fg-k"><span className="cm-fg-h"><b>{f.why}</b><span className="mono">{f.thread}</span></span><span className="cm-fg-t">{f.st === 'hidden' ? <em>{"Hidden by "}{who(f.mod)}{" · the author was told why"}</em> : `“${f.t}”`}</span><span className="cm-fg-s">{f.src}{" · "}{ago(f.at)}</span></span><span className="cm-fg-a">{f.st === 'open' ? <><button className="btn sm-b" data-ckeep={f.id}>Keep</button><button className="btn sm-b dz" data-chide={f.id}>Hide</button></> : <span className={`fst ${f.st === 'hidden' ? 'warn2' : ''}`}>{f.st === 'hidden' ? 'Hidden' : 'Kept'}</span>}</span></div>)}</div>, <><span>Nothing is deleted · every hide is logged in Records with its reason</span><span /></>);
      const pmx = Math.max(...POSTS_WK);
      const pace = cell('s5', 'Posts a week', <span className="lbl">Last 7 weeks</span>, <div className="cm-pt"><div className="m-big">{POSTS_WK[6]}{" "}<small>{"posts this week, from "}{PART.posted[6]}{" members"}</small></div><div className="cm-pt-c">{POSTS_WK.map((v, i) => <div key={i} className={i === 6 ? 'now' : ''}><i style={css(`height:${v / pmx * 100}%`)} /><s>{WEEKS[i]}</s></div>)}</div><div className="led cm-pt-l2">{[['Questions answered', '81%'], ['First reply', '2.4 h median'], ['Ideas open', IDEAS], ['Hidden this month', '3 posts']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>, <><span>Staff answers count once per question</span><span /></>);
      html(document.getElementById('cv'), <>{band(list, 1)}{band(<>{flags}{pace}</>)}</>);
    }

    /* ── a month as a grid, shared with Governance's calendar ── */
    const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    function monthGrid(items, mo, col) {
      const base = Date.UTC(2026, 9 + mo, 1),
        d0 = new Date(base),
        next = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
      const lead = (d0.getUTCDay() + 6) % 7,
        start = base - lead * DAY,
        weeks = Math.ceil((lead + Math.round((next - base) / DAY)) / 7);
      const cells = Array.from({
        length: weeks * 7
      }, (_, i) => {
        const t = start + i * DAY,
          d = new Date(t),
          out = t < base || t >= next,
          wk = i % 7 >= 5,
          es = items.filter(c => c.t >= t && c.t < t + DAY);
        return <div key={i} className={`gm-d ${out ? 'out' : ''} ${wk ? 'wk' : ''} ${t === TODAY ? 'today' : ''} ${t < TODAY ? 'past' : ''}`}><span className="gm-n">{d.getUTCDate() === 1 ? MON[d.getUTCMonth()] + ' 1' : d.getUTCDate()}</span>{es.slice(0, 3).map((c, __k) => <button key={__k} className={`gm-e ${col(c)[1] || ''}`} {...attrs(c.at)} style={css(`--c:${col(c)[0]}`)} title={c.title}><i /><span>{c.title}</span></button>)}{es.length > 3 ? <span className="gm-more">+{es.length - 3}{" more"}</span> : ''}</div>;
      });
      return <div className="gm"><div className="gm-h">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x, __k) => <span key={__k}>{x}</span>)}</div><div className="gm-g">{cells}</div></div>;
    }
    const monthName = mo => {
      const d = new Date(Date.UTC(2026, 9 + mo, 1));
      return `${MONL[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    };
    const viewSeg = (key, v) => <div className="seg sm gm-sw" role="group" aria-label="View"><button {...attrs(`data-${key}="list"`)} aria-pressed={v === 'list'}>List</button><button {...attrs(`data-${key}="month"`)} aria-pressed={v === 'month'}>Month</button></div>;
    const monthNav = (key, mo, min, max) => <span className="pg2"><span>{monthName(mo)}</span>{mo ? <button className="gm-today" {...attrs(`data-${key}="0"`)}>Today</button> : ''}<button {...attrs(`data-${key}="${mo - 1}"${mo <= min ? ' disabled' : ''}`)} aria-label="Previous month">{ICO.back}</button><button {...attrs(`data-${key}="${mo + 1}"${mo >= max ? ' disabled' : ''}`)} aria-label="Next month">{ICO.chev}</button></span>;

    /* ══ Live ══════════════════════════════════════════════════════════════════════════════════════════════════ */
    function renderLive() {
      const G = [['live', 'Live now'], ['request', 'Asked to host'], ['next', 'Coming up'], ['past', 'Past']];
      const L = G.flatMap(([st]) => EVENTS.filter(e => e.st === st).sort((a, b) => st === 'past' ? b.at - a.at : a.at - b.at));
      const colOf = e => e.st === 'live' ? ['var(--absent)'] : e.st === 'request' ? ['var(--underway)', 'req'] : e.st === 'past' ? ['var(--fg-50)'] : ['var(--fg)'];
      const items = EVENTS.map(e => ({
        t: Date.UTC(new Date(e.at).getUTCFullYear(), new Date(e.at).getUTCMonth(), new Date(e.at).getUTCDate()),
        title: `${hm(e.at)} ${e.t}`,
        at: `data-copen="${e.id}"`,
        e
      }));
      const key = <span className="f-key"><span><i style={css("background:var(--absent)")} />Live</span><span><i style={css("background:var(--fg)")} />Coming up</span><span><i className="cm-req" />Asked to host</span><span><i style={css("background:var(--fg-50)")} />Past</span></span>;
      const all = C.ev === 'month' ? cell('s12', monthName(C.mo), viewSeg('cev', C.ev), <>{monthGrid(items, C.mo, x => colOf(x.e))}<div className="gm-list"><div className="cm-evl">{(ms => ms.length ? ms.map(e => <Fragment key={e.id}>{evRow(e)}</Fragment>) : <div className="gv-e"><span>Nothing this month</span></div>)(EVENTS.filter(e => {
              const m = Date.UTC(2026, 9 + C.mo, 1),
                n = Date.UTC(2026, 10 + C.mo, 1);
              return e.at >= m && e.at < n;
            }).sort((a, b) => a.at - b.at))}</div></div></>, <>{key}{monthNav('cmo', C.mo, -1, 3)}</>) : cell('s12', 'Every event', <div className="gt-cr-h">{viewSeg('cev', C.ev)}<span className="lbl">{EVENTS.length}{" events"}</span></div>, <div className="cm-evl">{G.map(([st, t], __k) => {
          const E = L.filter(e => e.st === st);
          return E.length ? <Fragment key={__k}><div className="gv-g">{lbl(`${t} · ${E.length}`)}</div>{E.map(e => <Fragment key={e.id}>{evRow(e)}</Fragment>)}</Fragment> : '';
        })}</div>, <><span>Every event can air on the channel and is saved to the library</span><span className="quiet">{EVENTS.length}{" events"}</span></>);
      const H1 = EV['E-31'],
        mx = Math.max(...TH_CURVE) * 1.1;
      const last = cell('s7', 'The last hearing', <span className="lbl">{H1.prop}{" · "}{WD(H1.at)}{" "}{fmtD(H1.at)}</span>, <div className="cm-lh"><div className="m-big">{H1.came}{" "}<small>{"members came · peak "}{H1.peak}{" at once · "}{H1.len}{" min"}</small></div>{curve(TH_CURVE, mx)}<div className="cm-lh-x"><span>{hm(H1.at)}</span><span>{hrs(18 + H1.len / 60)}</span></div><div className="led cm-live-l">{[['Questions', `${H1.qAns} of ${H1.q} answered on air`], ['The rest', 'Answered in the thread by staff'], ['Recording', H1.rec], ['The proposal', `${H1.prop} · voting now, in Governance`]].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>, <><span>A hearing runs during a proposal’s discussion step</span><button data-cgov={H1.prop}>Governance →</button></>);
      const R = [['Town hall', 'Staff and board', 'Video, questions sorted ahead'], ['Space', 'Any member, by request', 'Audio, hands raised'], ['Presentation', 'Staff, board or a member by request', 'Slides and video'], ['Hearing', 'Staff, for a proposal', 'During its discussion step'], ['Board meeting', 'The board', 'Open session; private items left out'], ['Annual meeting', 'The board', 'Live; votes signed in the app']];
      const rules = cell('s5', 'Who hosts what', <span className="lbl">Every kind of event</span>, <div className="cm-hr">{R.map(([k, h, s], __k) => <div key={__k}><span><b>{k}</b><em>{s}</em></span><b>{h}</b></div>)}</div>, <><span>Requests go to staff and board to approve</span><span /></>);
      html(document.getElementById('cv'), <>{band(all, 1)}{band(<>{last}{rules}</>)}</>);
    }

    /* ══ Channel ═══════════════════════════════════════════════════════════════════════════════════════════════ */
    function renderChannel() {
      const vmx = Math.max(...VIEW_HR) * 1.15;
      const day = cell('s12', `Today on ${CH.name}`, <span className="lbl">{CH.num}{" · call sign "}{CH.call}</span>, <div className="cm-day"><div className="cm-day-v">{Array.from({
            length: 24
          }, (_, h) => <i key={h} style={css(`height:${VIEW_HR[h] != null ? VIEW_HR[h] / vmx * 100 : 0}%`)} className={h < VIEW_HR.length ? '' : 'f'} />)}</div><div className="cm-day-b">{SCHED.map((s, __k) => <button key={__k} className={`cm-blk ${s[3]} ${s[0] <= nowH && nowH < s[0] + s[1] ? 'on' : ''}`} style={css(`left:${s[0] / 24 * 100}%;width:${s[1] / 24 * 100}%`)} data-cblk={s[2]} title={`${hrs(s[0])} · ${s[2]}`}><b>{s[2]}</b>{s[1] >= 1.5 ? <em>{hrs(s[0])}</em> : ''}</button>)}<span className="cm-now" style={css(`left:${nowH / 24 * 100}%`)}><em>Now</em></span></div><div className="cm-day-x">{[0, 3, 6, 9, 12, 15, 18, 21].map((h, __k) => <span key={__k} style={css(`left:${h / 24 * 100}%`)}>{hrs(h)}</span>)}</div></div>, <><span className="f-key"><span><i style={css("background:var(--absent)")} />Live</span><span><i style={css("background:var(--fg)")} />Show</span><span><i style={css("background:color-mix(in srgb,var(--fg) 45%,transparent)")} />Replay</span><span><i style={css("background:color-mix(in srgb,var(--fg) 18%,transparent)")} />Loop</span><span><i className="cm-off" />Off air</span></span><button data-cdial="">Schedule in Dial ↗</button></>);
      const lib = cell('s7', 'Library', <span className="lbl">Recordings and shows</span>, <div className="cm-lib">{LIB.map(([t, s, v, at], __k) => <div key={__k} className="cm-lib-r">{leaf(at)}<span><b>{t}</b><em>{s}</em></span><span className="cm-n">{ICO.eye}{int(v)}</span><button className="btn sm-b" data-cadd={t}>Add to schedule</button></div>)}</div>, <><span>Every town hall, hearing and talk lands here when it ends</span><span /></>);
      const viewers = cell('s5', 'Watching', <span className="lbl">This week</span>, <div className="cm-pt"><div className="m-big">{CH.viewers}{" "}<small>{"watching now · "}{PART.watched[6]}{" members this week"}</small></div><div className="led cm-pt-l2">{[['Watch hours', `${CH.wk} this week`], ['Comments', `${CH.comments} today`], ['Most watched', 'September town hall'], ['Relays', CH.relay], ['Ads', 'None · it’s the co-op’s channel']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div><p className="bpn-n">One channel for now. Each community gets its own, like a local station, once there are regional councils.</p></div>, <><span>Runs on Dial</span><button data-cdial="">Master control ↗</button></>);
      html(document.getElementById('cv'), <>{band(day, 1)}{band(<>{lib}{viewers}</>)}</>);
    }

    /* ══ Panels ════════════════════════════════════════════════════════════════════════════════════════════════ */
    function ensurePanel() {
      let pn = document.getElementById('cpanel');
      if (!pn) {
        const sc = document.createElement('div');
        sc.id = 'cscrim';
        sc.className = 'scrim';
        document.body.appendChild(sc);
        pn = document.createElement('aside');
        pn.id = 'cpanel';
        pn.className = 'panel cpanel';
        document.body.appendChild(pn);
      }
      return pn;
    }
    function renderPanel() {
      const pn = ensurePanel(),
        P = C.panel;
      if (!P) {
        document.body.classList.remove('pn');
        return;
      }
      document.body.classList.add('pn');
      html(pn, P.ev ? evPanel(EV[P.ev]) : thPanel(THREADS.find(t => t.id === P.th)));
    }
    const phd = k => <div className="pn-hd"><span className="lbl">{k}</span><button className="x" data-cclose="" aria-label="Close">{ICO.x}</button></div>;
    function evPanel(e) {
      const K = KIND[e.kind],
        st = {
          live: 'Live now',
          next: `${WD(e.at)} ${fmtD(e.at)} at ${hm(e.at)}`,
          request: `Asked for ${WD(e.at)} ${fmtD(e.at)} at ${hm(e.at)}`,
          past: `Held ${WD(e.at)} ${fmtD(e.at)}`
        }[e.st];
      const rows = [['Kind', `${K[0]} · ${K[1]}`], ['When', `${WD(e.at)} ${fmtD(e.at)} · ${hm(e.at)} · ${e.len} min`], ['Host', `${who(e.host)}${e.co ? ` with ${e.co.map(who).join(', ')}` : ''}`], ['On the channel', e.chan ? 'Airs live on Channel 4, then goes to the library' : e.st === 'request' ? 'Decided when it’s approved' : 'No'], ...(e.prop ? [['The proposal', <button className="lnk3" data-cgov={e.prop}>{e.prop}{" · tracked in Governance"}</button>]] : []), ...(e.gov ? [['In Governance', e.gov]] : [])];
      let block = '';
      if (e.st === 'live') block = <div>{lbl('Listening, minute by minute')}<div className="cm-pn-c">{curve(LIVE_CURVE, e.peak * 1.1, 'red')}</div><p className="bpn-n">{e.live}{" listening now, peak "}{e.peak}{". "}{e.hands}{" hands raised."}</p></div>;
      if (e.prep) block = <div>{lbl('Getting ready')}<div className="led gv-cl">{e.prep.map(([k, v], __k) => <div key={__k}><span><i className={v === 1 || v === 'On' || /Live/.test(v) ? 'ok' : ''} />{k}</span><b>{v === 1 ? 'Ready' : v}</b></div>)}</div><p className="bpn-n">{e.rsvp}{" members are coming. "}{e.q}{" questions came in through the thread; "}{e.qSorted}{" are sorted for the night."}</p></div>;
      if (e.st === 'request') block = <div>{lbl(`What ${who(e.host)} wants to do`)}<p className="bpn-w"><b>{e.t}.</b>{" "}{e.why}</p><p className="bpn-n">{"Approving it schedules the event, lets "}{who(e.host)}{" host and puts a staff member in as moderator."}</p></div>;
      if (e.st === 'past') block = <div>{lbl('How it went')}<div className="led">{[['Came', `${e.came} · peak ${e.peak}`], ['Questions', `${e.qAns} of ${e.q} answered on air`], ['Recording', e.rec]].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>;
      const ft = !STAFF() ? <span className="small quiet" style={css("margin-right:auto")}>{st}</span> : e.st === 'request' ? <><button className="btn" data-cdecline={e.id}>Decline</button><button className="btn p" data-capprove={e.id}>Approve</button></> : e.st === 'live' ? <><button className="btn" data-cend={e.id}>End it</button><button className="btn p" data-cdial="">Open in Dial ↗</button></> : e.st === 'next' ? <><button className="btn" data-cremind={e.id}>Remind members</button><button className="btn p" data-cdial="">Set up in Dial ↗</button></> : <><span className="small quiet" style={css("margin-right:auto")}>{st}</span><button className="btn" data-cwatch="">Watch the recording ↗</button></>;
      return <>{phd(`${e.id} · ${K[0]}`)}<><div className="pn-b"><div><p className="bpn-t">{e.t}</p><p className={`bpn-s ${e.st === 'live' ? 'cm-red' : ''}`}>{st}</p></div><div className="led">{rows.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{block}</div><div className="pn-ft">{ft}</div></></>;
    }
    function thPanel(t) {
      const sample = [[t.by, t.last - 5 * 3600e3, 'Opening post. ' + (t.note || 'Members can reply, react and quote; staff answers are marked.')], ['dana', t.last - 3 * 3600e3, 'Thanks for raising it. Here’s where this stands, and what happens next.', 1], ['6a', t.last, 'Following this one.']];
      return <>{phd(`${t.id} · ${CAT[t.cat]}`)}<><div className="pn-b"><div><p className="bpn-t">{t.t}</p><p className="bpn-s">{t.r}{" replies · "}{t.rd}{" readers · last post "}{ago(t.last)}</p></div>{t.prop ? <p className="bpn-w"><b>{"This is the thread for "}{t.prop}.</b>{" The proposal itself, its steps and its vote are tracked in Governance. Talk happens here."}</p> : ''}<div className="gv-th">{lbl('Latest')}{sample.map(([k, at, x, s], __k) => <div key={__k} className="gv-tp">{av(k)}<span><span className="gv-f-h"><b>{who(k)}</b>{s ? <span className="gv-staff">Staff</span> : ''}<span className="quiet">{ago(at)}</span></span><span>{x}</span></span></div>)}</div></div><div className="pn-ft">{t.prop ? <button className="btn" data-cgov={t.prop}>{t.prop}{" in Governance →"}</button> : ''}<button className="btn p" data-capp="">Open in the app ↗</button></div></></>;
    }

    /* ══ render + events ═══════════════════════════════════════════════════════════════════════════════════════ */
    function render() {
      document.querySelectorAll('.gtabs [data-ctab]').forEach(b => b.setAttribute('aria-current', b.dataset.ctab === C.tab ? 'page' : 'false'));
      if (!LIVE()) return;
      sync();
      W.classList.toggle('ro', !STAFF());
      W.classList.toggle('tot', TOT());
      renderHdr();
      ({
        overview: renderOverview,
        forum: renderForum,
        live: renderLive,
        channel: renderChannel
      })[C.tab]();
      renderPanel();
      if (TOT()) CC.scrub(W);
      setHash();
    }
    function sync() {
      const k = meKey();
      if (k !== C.me) {
        C.me = k;
        C.panel = null;
      }
    }
    const logIt = (what, detail, res) => {
      try {
        LOG.unshift(['x' + Date.now(), Date.UTC(2026, 9, 21, 14, 30), PPL[C.me].ini, 'gov', what, detail, 'Mac · Redlands', res, res === 'approved' ? 'Second signature' : '']);
      } catch (e) {}
    };
    const closeC = () => {
      C.panel = null;
    };
    document.addEventListener('click', e => {
      if (e.target.id === 'cscrim') {
        closeC();
        return render();
      }
      const t = e.target.closest('button,a,[data-ctab],[data-copen],[data-cjump]');
      if (!t) return;
      const d = t.dataset;
      if (d.ctab) {
        C.tab = d.ctab;
        closeC();
        render();
        if (d.cjump) {
          const el = document.getElementById(d.cjump);
          el && el.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        } else window.scrollTo({
          top: 0
        });
        return;
      }
      if (d.cjump) {
        const el = document.getElementById(d.cjump);
        el && el.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
        return;
      }
      if (d.copen) {
        C.panel = {
          ev: d.copen
        };
        return render();
      }
      if (d.cthread) {
        C.panel = {
          th: d.cthread
        };
        return render();
      }
      if (d.cclose !== undefined) {
        closeC();
        return render();
      }
      if (d.ccat) {
        C.cat = d.ccat;
        C.tp = 0;
        return render();
      }
      if (d.cev) {
        C.ev = d.cev;
        return render();
      }
      if (d.cmo !== undefined) {
        C.mo = Math.max(-1, Math.min(3, +d.cmo));
        return render();
      }
      if (d.ctp) {
        C.tp += +d.ctp;
        return render();
      }
      if (d.chide) {
        const f = FLAGS.find(x => x.id === d.chide);
        logIt(`Hid a post in ${f.thread}`, f.why, 'done');
        f.st = 'hidden';
        f.mod = C.me;
        render();
        return toast('Hidden · the author is told why · logged in Records');
      }
      if (d.ckeep) {
        const f = FLAGS.find(x => x.id === d.ckeep);
        f.st = 'kept';
        f.mod = C.me;
        render();
        return toast('Kept · the reporters are told it stays up');
      }
      if (d.capprove) {
        const ev = EV[d.capprove];
        logIt(`Approved “${ev.t}”`, `${who(ev.host)} hosts · ${WD(ev.at)} ${hm(ev.at)}`, 'approved');
        ev.st = 'next';
        ev.rsvp = 0;
        ev.co = ['dana'];
        ev.chan = true;
        closeC();
        render();
        return toast(`Approved · ${who(ev.host)} hosts ${WD(ev.at)} ${hm(ev.at)} with Dana Ruiz moderating`);
      }
      if (d.cdecline) {
        const ev = EV[d.cdecline];
        EVENTS.splice(EVENTS.indexOf(ev), 1);
        closeC();
        render();
        return toast(`Declined · ${who(ev.host)} gets the reason in the app`);
      }
      if (d.cend) return toast('Ends the space for everyone · the recording goes to the library');
      if (d.cremind) return toast('Reminder goes to everyone who said they’re coming');
      if (d.cdial !== undefined) return toast('Opens Clear’s station in Dial');
      if (d.cgov) {
        closeC();
        // the reference's GOV2.open: Governance's Proposals tab, with that proposal's panel
        return CC.go('governance', `proposals:${d.cgov}`);
      }
      if (d.capp !== undefined) return toast('Opens the thread in the member app');
      if (d.cwatch !== undefined) return toast('Opens the recording on the channel');
      if (d.cadd) return toast(`${d.cadd} · pick a slot in Dial’s schedule`);
      if (d.cblk) return toast(`${d.cblk} · edit it in Dial’s schedule`);
    });
    document.addEventListener('keydown', e => {
      if (!LIVE()) return;
      if (e.key === 'Escape' && C.panel && !document.querySelector('.modal')) {
        closeC();
        render();
      }
    });
    const TABS = ['overview', 'forum', 'live', 'channel'];
    return {
      render,
      tab: () => C.tab,
      setTab(t) {
        if (TABS.includes(t)) C.tab = t;
        closeC();
      },
      close() {
        closeC();
      },
      threadFor: id => (THREADS.find(t => t.prop === id) || {}).id,
      open(k, id) {
        C.panel = {
          [k]: id
        };
      }
    };
  })(DOCP);
  function mount() {
    // the slot is the shell's: the host goes inside it
    if (!into('cx-slot')) return;
    API.render();
  }
  function unmount() {
    if (host.isConnected) return;
    API.close();
    W.classList.remove('pn');
  }
  /*
   * p: a tab; `forum:<P-…>` is the reference's openFor (Governance's "Talk in the forum"), the forum with
   * that proposal's thread open, and `forum:<T-…>` a thread, `live:<E-…>` an event, by id.
   */
  function setTab(p) {
    if (!p) return;
    const [t, id] = String(p).split(':');
    API.setTab(t);
    if (!id) return;
    if (/^P-/.test(id)) {
      const th = API.threadFor(id);
      if (th) API.open('th', th);
    } else if (/^T-/.test(id)) API.open('th', id);
    else if (/^E-/.test(id)) API.open('ev', id);
  }
  return {
    mount,
    unmount,
    setTab: (_r, sub) => setTab(sub),
    tab: () => API.tab(),
    host
  };
}
registerPage(['community'], 'cx-slot', makeCommunity);