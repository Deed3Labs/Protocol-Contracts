// @ts-nocheck: ported from the redesign's MONEY2 module (design/command-center-ui) with scripts/port/module.cjs; its data is its own.
import { Fragment } from 'react';
import { attrs, css, hasHtml, html } from '../runtime/dom';
import { CC } from './cc';
import { LOG, S } from './data';
import { registerPage, shadowHost } from './pageHost';
import { openItem, toast, vLevel } from './shell';

/*
 * Money (design/command-center-ui, the MONEY2 module): one question per tab (Overview: is everything
 * covered; Cash flow: the next 30 days; Credit: the book; Pools: AssurancePool, Payout, Yield, Bonds;
 * Moves: propose, approve, history). It lives in its own shadow root (pageHost.tsx). As the reference has
 * it, the module's code runs against a stand-in `document` (DOCP) that reads inside the shadow root, so
 * its lookups and its click/input listeners stay on the page. Links out go through CC.go.
 */

/** The page's skeleton: the reference template's markup. */
function skeleton() {
  return <div className="gw nw" id="nw"><div className="hdr stack" id="hdr" /><nav className="gtabs" aria-label="Money views"><button data-ntab="overview">Overview</button><button data-ntab="cash">Cash flow</button><button data-ntab="credit">Credit</button><button data-ntab="pools">Pools</button><button data-ntab="moves">Moves</button></nav><div id="nv" /></div>;
}
function makeMoney() {
  const { host, R: SR, W, into } = shadowHost('money', skeleton());
  const LIVE = () => host.isConnected && CC.route() === 'money';
  const RO = () => CC.viewing() && vLevel('money') < 3;
  const TOT = () => CC.viewing() && vLevel('money') === 1;
  const meKey = () => {
    const v = S.view;
    if (!v) return 'kai';
    return {
      K: 'kai',
      DR: 'dana',
      BS: 'board',
      ML: 'marcus'
    }[v.person] || {
      admin: 'kai',
      protocol: 'dana',
      board: 'board',
      field: 'marcus'
    }[v.g] || 'viewer';
  };
  const TABS = ['overview', 'cash', 'credit', 'pools', 'moves'];
  const MAP = {
    overview: ['overview'],
    cash: ['cash'],
    schedule: ['cash'],
    credit: ['credit'],
    pools: ['pools'],
    reserves: ['pools', 'ap'],
    yield: ['pools', 'yield'],
    bonds: ['pools', 'bonds'],
    moves: ['moves']
  };
  const ROOT_EV = new Set(['click', 'input', 'change']);
  const DOCP = {
    getElementById: id => SR.getElementById(id),
    querySelector: q => SR.querySelector(q),
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
      history.replaceState(null, '', '#money' + (t === 'overview' ? '' : '/' + t));
    } catch (e) {}
  }
  API = (document => {
    /* ══ Money data — the Command Center's own figures (Money page, v5), so every number matches ══════════════
       Demo "today" is Wed 21 Oct 2026. Day offsets count from today. */
    const money = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const money0 = n => '$' + Math.round(n).toLocaleString('en-US');
    const pct = (a, b, d = 1) => (b ? a / b * 100 : 0).toFixed(d) + '%';
    const TODAY = Date.UTC(2026, 9, 21),
      DAY = 864e5;
    const dOf = d => new Date(TODAY + d * DAY);
    const WD = d => dOf(d).toLocaleDateString('en-US', {
      weekday: 'short',
      timeZone: 'UTC'
    });
    const MON = d => dOf(d).toLocaleDateString('en-US', {
      month: 'short',
      timeZone: 'UTC'
    });
    const MONL = d => dOf(d).toLocaleDateString('en-US', {
      month: 'long',
      timeZone: 'UTC'
    });
    const DD = d => dOf(d).getUTCDate();
    const dayD = d => `${DD(d)} ${MON(d)}`;
    const leaf = (d, month = true) => <span className="leaf"><span>{WD(d)}</span><b>{DD(d)}</b>{month ? <span>{MON(d)}</span> : ''}</span>;
    const rel = d => d === 0 ? 'today' : d === 1 ? 'tomorrow' : d === -1 ? 'yesterday' : d > 0 ? `in ${d} days` : `${-d} days ago`;
    const M = {
      savings: 38940.20,
      cash: 21480.75,
      payout: 10240.00,
      assurance: 1420.00,
      coop: 476.20,
      credit: 14212.40,
      savingsBacked: 8640.00,
      unsecured: 5572.40,
      limits: 41600.00,
      lost: 612.00,
      owed14: 12839.25,
      dueMembers: 1482.36,
      bonds: 25000.00,
      bv: 25000.00,
      floor: 0.20,
      members: 124,
      autopay: 98
    };
    /* the yield pool (LendingPool, ERC-4626): funds unsecured credit, takes its first loss. Rates follow the contract's curve. */
    const Y = {
      assets: 9000.00,
      principal: 8962.10,
      lent: M.unsecured,
      depositors: 18,
      pledged: 1200.00,
      queued: 0,
      opened: '15 Oct',
      cycleDays: 30,
      curve: {
        base: 25,
        s1: 75,
        s2: 900,
        kink: 0.80
      }
    };
    Y.cash = Y.assets - Y.lent;
    Y.util = Y.lent / Y.assets;
    Y.earned = Y.assets - Y.principal;
    Y.price = Y.assets / Y.principal;
    const yBorrowBps = u => u <= Y.curve.kink ? Y.curve.base + Y.curve.s1 * u / Y.curve.kink : Y.curve.base + Y.curve.s1 + Y.curve.s2 * (u - Y.curve.kink) / (1 - Y.curve.kink);
    const yApr = bps => bps / 10000 * 365 / Y.cycleDays;
    const yApy = bps => Math.pow(1 + bps / 10000, 365 / Y.cycleDays) - 1;
    Y.borrowBps = yBorrowBps(Y.util);
    Y.supplyBps = Y.borrowBps * Y.util;
    Y.apy = yApy(Y.supplyBps);
    Y.apr = yApr(Y.borrowBps);
    M.rtd = M.assurance / M.unsecured;
    M.room = M.assurance / M.floor - M.unsecured;
    M.short = Math.max(0, M.owed14 - M.payout - M.dueMembers);
    Y.toPayout = Math.min(M.short, Y.cash);
    Y.utilAfter = (Y.lent + Y.toPayout) / Y.assets;
    Y.apyAfter = yApy(yBorrowBps(Y.utilAfter) * Y.utilAfter);

    /* weekly history, 8 Sep → 20 Oct */
    const NW = ['8 Sep', '15 Sep', '22 Sep', '29 Sep', '6 Oct', '13 Oct', '20 Oct'];
    const AP_BAL = [0, 400, 520, 690, 860, 1110, M.assurance],
      UNSEC = [0, 900, 2050, 3450, 4400, 5100, M.unsecured];
    const RTD_W = AP_BAL.map((v, i) => UNSEC[i] ? v / UNSEC[i] : null);
    const COOP_W = [22.40, 39.40, 78.40, 109.20, 126.80, 100.00];

    /* the next 30 days, day 0 = 21 Oct: [day, in|out, amount, what, detail, from|to] */
    const FLOWS = [[1, 'out', 412.60, 'Rosa’s Panadería', 'NET-14 payout'], [3, 'in', 592.94, 'Member repayments', 'Autopay batch'], [9, 'in', 889.42, 'Member repayments', 'Autopay batch'], [12, 'out', 9510.65, 'Monthly run', '11 shops · NET-30'], [14, 'out', 732.00, 'Arrowhead Nails', 'NET-14 payout'], [14, 'out', 2184.00, 'Cajon Phone Repair', 'NET-14 payout'], [16, 'in', 2310.20, 'Member repayments', 'Autopay batch'], [28, 'out', 1140.80, 'NET-14 shops', 'Next NET-14 round · estimate']];
    const BONDS = [/* id, face, issued, matures, months to maturity from today, term in months, internal rate, holder */
    ['BB-0001', 2500, '14 Aug', '14 Dec', 54, 4, 6.0, 'Member'], ['BB-0002', 5000, '21 Aug', '21 Jan', 92, 5, 6.5, 'Founding lender'], ['BB-0003', 2500, '2 Sep', '2 Mar', 132, 6, 7.0, 'Member'], ['BB-0004', 2500, '9 Sep', '9 Mar', 139, 6, 7.0, 'Member'], ['BB-0005', 7500, '1 Oct', '1 Jun', 223, 8, 7.5, 'Founding lender'], ['BB-0006', 5000, '15 Oct', '15 Sep', 329, 11, 8.0, 'Member']];
    /* every account, in the order the bar draws them: whose money it is decides the bracket */
    const ACCTS = [/* id, name, what it's for, group, source, balance, 7 weeks, colour */
    ['sav', 'Member savings', 'CLRUSD, backed 1:1 by USDC at Bridge', 'members', 'bridge', M.savings, [0, 2100, 6400, 13900, 22800, 31200, M.savings], 'var(--fg)'], ['yld', 'Yield pool', 'Members’ deposits not lent out yet', 'members', 'protocol', Y.cash, [0, 0, 0, 0, 0, 2180, Y.cash], 'color-mix(in srgb,var(--live) 60%,transparent)'], ['pay', 'Payout pool', 'Pays shops for financed sales, oldest first', 'set', 'protocol', M.payout, [0, 1200, 3900, 5200, 7800, 9600, M.payout], 'color-mix(in srgb,var(--fg) 45%,transparent)'], ['ap', 'AssurancePool', 'Covers unsecured losses after the yield pool', 'set', 'protocol', M.assurance, AP_BAL, 'var(--underway)'], ['bv', 'BondVault', 'Bond buyers’ money · paid back at maturity', 'set', 'protocol', M.bv, [10000, 12500, 12500, 12500, 20000, 20000, M.bv], 'color-mix(in srgb,var(--fg) 28%,transparent)'], ['ops', 'Operating cash', 'Business checking · the co-op’s own money', 'coop', 'plaid', M.cash, [16800, 17900, 18600, 19800, 20400, 21100, M.cash], 'var(--land)'], ['coop', 'Co-op balance', 'Discounts on member purchases, held for a vote', 'coop', 'protocol', M.coop, [0, 22.40, 61.80, 140.20, 249.40, 376.20, M.coop], 'color-mix(in srgb,var(--land) 45%,transparent)']];
    const GROUPS = {
      members: ['Members’ money', 'Owed back to members on request'],
      set: ['Set aside', 'Only for shops, losses and bondholders'],
      coop: ['The co-op’s', 'Ours to run on']
    };
    const ASIDE = [['Sales tax held', 351.58, 'Shop · paid with the quarterly return'], ['Pre-order deposits', 460.00, 'Hardware · refundable until made']];
    const SRC = {
      protocol: ['Protocol', '12 s'],
      bridge: ['Bridge', '2 min'],
      plaid: ['Plaid', '3 h', 'late'],
      lithic: ['Lithic', '1 min']
    };
    const srcTxt = k => SRC[k][0] + ' · ' + SRC[k][1];
    const acctOf = id => ACCTS.find(a => a[0] === id);

    /* credit, October */
    const CR = {
      start: 7040.00,
      spent: 19825.70,
      aging: [['Current', 12480.20], ['1–30 days', 1310.40], ['31–60 days', 421.80], ['Over 60', 0]],
      losses: [[-29, 'Redlands Tire & Lube', 'tire', 204], [-15, 'Citrus Bowl Café', 'citrus', 204], [-7, 'Cajon Phone Repair', 'phone', 204]],
      limits: [['$100', 38], ['$250', 46], ['$500', 28], ['$1,000+', 12]],
      shops: [['Redlands Tire & Lube', 7940.00, 1], ['Cajon Phone Repair', 3120.00, 1], ['Highland Hardware', 2310.40, 0], ['Rosa’s Panadería', 1284.40, 0], ['Arrowhead Nails', 1036.00, 0], ['Mesa Laundry', 968.10, 0], ['6 more shops', 3166.80, 0]]
    };
    CR.repaid = CR.start + CR.spent - M.credit;
    CR.sched = FLOWS.filter(f => f[1] === 'in' && f[0] <= 9).reduce((a, f) => a + f[2], 0);
    CR.due = CR.repaid + CR.sched;

    /* depositors, masked; earned split pro rata so rows reconcile to the pool */
    const Y_DEP = [['4f', 1500, '15 Oct', 600], ['a2', 1000, '15 Oct', 400], ['c9', 1000, '15 Oct', 0], ['17', 750, '15 Oct', 0], ['e0', 600, '15 Oct', 200], ['5b', 500, '15 Oct', 0], ['9d', 500, '15 Oct', 0], ['b3', 500, '20 Oct', 0], ['61', 400, '15 Oct', 0], ['2e', 350, '15 Oct', 0], ['d8', 300, '15 Oct', 0], ['7a', 300, '15 Oct', 0], ['f4', 250, '15 Oct', 0], ['0c', 250, '20 Oct', 0], ['8b', 200, '15 Oct', 0], ['3f', 200, '15 Oct', 0], ['c1', 200, '20 Oct', 0], ['6e', 200, '20 Oct', 0]].map(([id, w, since, pl]) => {
      const e = w * Y.earned / Y.assets;
      return {
        id,
        w,
        since,
        pl,
        e,
        d: w - e
      };
    });

    /* the people who can move money: the Ops Safe, two of three signers */
    const PPL = {
      kai: {
        n: 'Kai',
        f: 'Kai',
        ini: 'KK',
        role: 'Admin',
        sign: true,
        code: 'K'
      },
      dana: {
        n: 'Dana Ruiz',
        f: 'Dana',
        ini: 'DR',
        role: 'Protocol',
        sign: true,
        code: 'DR'
      },
      board: {
        n: 'Board signer',
        f: 'the board signer',
        ini: 'BS',
        role: 'Co-op board',
        sign: true,
        code: 'BS'
      },
      marcus: {
        n: 'Marcus Lee',
        f: 'Marcus',
        ini: 'ML',
        role: 'Field',
        sign: false,
        code: 'ML'
      },
      viewer: {
        n: 'Viewer',
        f: 'Viewer',
        ini: 'VW',
        role: 'Read-only',
        sign: false,
        code: 'K'
      }
    };
    /* money moves: [id, kind, what, from, to, amount, proposed by, day proposed, approver (null = any other signer), note, status, link] */
    const MOVES = [{
      id: 'mv-tax',
      kind: 'bill',
      t: 'Pay the Q3 sales tax return',
      from: 'ops',
      to: 'CDTFA',
      amt: 351.58,
      by: 'dana',
      d: 0,
      why: 'Q3 return is due 31 Oct. This is the amount held from Shop sales.',
      due: 10,
      st: 'waiting'
    }, {
      id: 'mv-top',
      kind: 'topup',
      t: 'Top up the payout pool',
      from: 'ops',
      to: 'Payout pool',
      amt: 1116.89,
      by: 'kai',
      d: 0,
      why: 'Covers the 4 Nov gap from operating cash, so the co-op earns the interest instead of the yield pool.',
      due: 9,
      st: 'waiting',
      wait: 'dana'
    }, {
      id: 'mv-rosa',
      kind: 'payout',
      t: 'Rosa’s Panadería · NET-14 payout',
      from: 'pay',
      to: 'Rosa’s Panadería',
      amt: 412.60,
      by: 'dana',
      d: -1,
      why: 'September sales on NET-14 terms.',
      due: 1,
      st: 'merchants'
    }];
    const DONE = [{
      d: -3,
      t: 'Yield pool withdrawal',
      from: 'Yield pool',
      to: 'A member',
      amt: 250.00,
      auto: 'Paid at once by the contract',
      tx: '0x9c1e…41d2'
    }, {
      d: -6,
      t: 'BB-0006 issued',
      from: 'A member',
      to: 'BondVault',
      amt: 5000.00,
      by: 'kai',
      ok: 'dana',
      tx: '0x5b07…aa19'
    }, {
      d: -7,
      t: 'Loss absorbed · Cajon Phone Repair',
      from: 'AssurancePool',
      to: 'Credit ledger',
      amt: 204.00,
      auto: 'Member 90 days late',
      tx: '0x77d0…0e3c'
    }, {
      d: -8,
      t: 'Top up the payout pool',
      from: 'Operating cash',
      to: 'Payout pool',
      amt: 2600.00,
      by: 'dana',
      ok: 'kai',
      tx: '0x3a92…c1f7'
    }, {
      d: -15,
      t: 'Loss absorbed · Citrus Bowl Café',
      from: 'AssurancePool',
      to: 'Credit ledger',
      amt: 204.00,
      auto: 'Member 90 days late',
      tx: '0xe41b…7d20'
    }, {
      d: -19,
      t: 'Monthly run · August',
      from: 'Payout pool',
      to: '4 shops',
      amt: 1904.10,
      by: 'dana',
      ok: 'kai',
      tx: '0x18f3…92be'
    }, {
      d: -20,
      t: 'BB-0005 issued',
      from: 'Founding lender',
      to: 'BondVault',
      amt: 7500.00,
      by: 'kai',
      ok: 'board',
      tx: '0xc8a0…3f55'
    }, {
      d: -21,
      t: 'Top up the payout pool',
      from: 'Operating cash',
      to: 'Payout pool',
      amt: 3000.00,
      by: 'kai',
      ok: 'dana',
      tx: '0x2d6c…b804'
    }, {
      d: -26,
      t: 'Rejected · move $5,000.00 to the yield pool',
      from: 'Operating cash',
      to: 'Yield pool',
      amt: 5000.00,
      by: 'dana',
      no: 'kai',
      why: 'The co-op shouldn’t be a depositor in its own pool',
      tx: null
    }, {
      d: -29,
      t: 'Loss absorbed · Redlands Tire & Lube',
      from: 'AssurancePool',
      to: 'Credit ledger',
      amt: 204.00,
      auto: 'Member 90 days late',
      tx: '0x60fd…e2a1'
    }, {
      d: -30,
      t: 'Top up the payout pool',
      from: 'Operating cash',
      to: 'Payout pool',
      amt: 2500.00,
      by: 'dana',
      ok: 'kai',
      tx: '0x91b4…5c0e'
    }];
    /* what someone can propose */
    const KINDS = {
      topup: {
        t: 'Top up the payout pool',
        from: 'ops',
        to: 'pay',
        amt: () => M.short,
        why: 'Cover the 4 Nov gap from operating cash instead of borrowing it from the yield pool.'
      },
      bondvault: {
        t: 'Use spare bond money',
        from: 'bv',
        to: 'pay',
        amt: () => Math.min(5000, Math.max(0, M.bv - BV_NEED())),
        why: 'Spare bond money, above what BondVault keeps for bondholders.'
      },
      bill: {
        t: 'Pay a bill from operating cash',
        from: 'ops',
        to: 'out',
        amt: () => 0,
        why: ''
      },
      move: {
        t: 'Move between the co-op’s accounts',
        from: 'ops',
        to: 'pay',
        amt: () => 0,
        why: ''
      }
    };
    const PLACES = {
      ops: 'Operating cash',
      pay: 'Payout pool',
      bv: 'BondVault',
      out: 'Someone outside the co-op',
      ap: 'AssurancePool'
    };

    /* ══ Money — is everything covered, where it sits, and the moves that need two people ══════════════════════
       Tabs answer one question each: Overview (covered?), Cash flow (what moves in the next 30 days), Credit (the book),
       Pools (AssurancePool, Payout, Yield, Bonds), Moves (propose, approve, history). The two checks stay apart on purpose:
       RTD gates credit; claims-in-order only reports and is never summed. */
    const N = {
      tab: 'overview',
      pool: 'yield',
      panel: null,
      me: 'kai',
      dp: 0,
      mp: 0,
      mf: 'all',
      rej: false
    };
    const ME = () => PPL[N.me],
      CAN = () => !RO() && ME().sign;
    const firstN = k => k === N.me ? 'You' : PPL[k].f;
    const ICO = {
      chev: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>,
      back: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>,
      x: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
    };
    const cell = (cls, title, right, body, foot, id = '') => <div className={`cell ${cls}`} {...attrs(id ? ` id="${id}"` : '')}><div className="hd"><h2>{title}</h2><div className="r">{right}</div></div>{body}<div className="bk-ft">{foot}</div></div>;
    const lbl = t => <span className="lbl">{t}</span>;
    const band = (cells, first) => <section className="band" {...attrs(first ? ' style="margin-top:0"' : '')}><div className="bento">{cells}</div></section>;
    const waiting = () => N.moves.filter(m => m.st === 'waiting'),
      pend = () => N.moves.filter(m => m.st === 'waiting' || m.st === 'merchants'),
      forMe = () => waiting().filter(m => m.by !== N.me && CAN() && (!m.wait || m.wait === N.me));
    const freeCash = () => M.cash - ASIDE.reduce((a, x) => a + x[1], 0);
    const pager = (p, n, per, key) => {
      const pages = Math.max(1, Math.ceil(n / per));
      return <span className="pg2"><span>{n ? p * per + 1 : 0}–{Math.min(n, (p + 1) * per)} of {n}</span><button {...{ [`data-${key}`]: '-1' }} disabled={p === 0} aria-label="Previous">{ICO.back}</button><button {...{ [`data-${key}`]: '1' }} disabled={p >= pages - 1} aria-label="Next">{ICO.chev}</button></span>;
    };

    /* ── the header: one sentence, then four vitals ─────────────────────────────────────── */
    function renderHdr() {
      const w = pend(),
        mine = forMe(),
        tier3 = Math.min(1, M.bv / M.bonds);
      const B = {
        overview: <>{"Member savings, shops and bondholders are "}{tier3 >= 1 ? 'all' : 'mostly'}{" covered. "}{w.some(m => m.kind === 'topup' || m.kind === 'bondvault') ? <>{"On 4 Nov the payout pool borrows "}{money(M.short)}{" from the yield pool unless "}<a data-ntab="moves">the top-up</a>{" is signed."}</> : 'Nothing borrows from the yield pool on 4 Nov.'}</>,
        cash: <>{money(13980.05)}{" goes to shops in the next 30 days and "}{money(3792.56)}{" comes in. On 4 Nov the payout pool "}<a data-ntab="cash" data-njump="ngap">{"borrows "}{money(M.short)}</a>{" from the yield pool."}</>,
        credit: `${money(M.credit)} is owed by ${M.members} members. ${pct(M.savingsBacked, M.credit, 0)} is backed by their own savings and ${pct(CR.aging[0][1], M.credit, 0)} is current.`,
        pools: <>{"The yield pool is "}{pct(Y.lent, Y.assets, 0)}{" lent out and pays depositors "}{(Y.apy * 100).toFixed(2)}{"% a year. "}<a data-npool="bonds">BondVault</a>{" holds "}{money(M.bv)}{" for "}{BONDS.length}{" bonds and keeps "}{money(BV_NEED())}{" of it back."}</>,
        moves: w.length ? <>{w.length === 1 ? 'One move waits' : `${['', 'One', 'Two', 'Three', 'Four', 'Five'][w.length] || w.length} moves wait`}{" for a second person."}{mine.length ? <>{" "}<a data-nopen={mine[0].id}>{mine[0].t}</a>{" needs you."}</> : ''}</> : 'Nothing is waiting for a second person.'
      }[N.tab];
      const rtdW = Math.min(1, M.rtd / 0.4) * 100,
        flr = M.floor / 0.4 * 100;
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />Money · Wed 21 Oct · Demo data</span><p className="brief">{B}</p><div className="strip"><div className="sc"><span className="lbl">Credit gate</span><div className="sc-v">{(M.rtd * 100).toFixed(1)}{"% "}<small>RTD</small></div><div className="mb"><i style={css(`width:${rtdW}%;background:var(--live)`)} /><s className="nflr" style={css(`left:${flr}%`)} /></div><div className="sc-s">{"Floor 20% · "}{money(M.room)}{" can still issue"}</div></div><div className="sc"><span className="lbl">Member savings</span><div className="sc-v">{money(M.savings).replace(/\.\d+$/, '')}<small className="ct">{money(M.savings).match(/\.\d+$/)[0]}</small></div><div className="mb"><i style={css("width:100%")} /></div><div className="sc-s">Reserved 1 : 1 · checked 2 min ago</div></div><div className="sc"><span className="lbl">Next 30 days</span><div className="sc-v">{money(13980.05).replace(/\.\d+$/, '')}<small>out</small></div><div className="mb"><i style={css(`width:${3792.56 / 13980.05 * 100}%;background:var(--land)`)} /><span className="hroom" style={css(`left:${(M.payout + 3792.56) / 13980.05 * 100}%;right:0;box-shadow:inset 0 0 0 1px var(--underway);background:repeating-linear-gradient(45deg,var(--underway) 0 1.5px,transparent 1.5px 5px)`)} /></div><div className="sc-s">{money(3792.56)}{" in · "}{money(M.short)}{" short on 4 Nov"}</div></div><div className="sc"><span className="lbl">Moves</span><div className="sc-v">{w.length}{" "}<small>waiting</small></div><div className="mb">{w.map((m, i) => <i key={i} style={css(`left:${i / Math.max(3, w.length) * 100}%;width:calc(${100 / Math.max(3, w.length)}% - 2px);background:${forMe().includes(m) ? 'var(--underway)' : m.st === 'merchants' ? 'var(--live)' : 'color-mix(in srgb,var(--fg) 40%,transparent)'}`)} />)}</div><div className="sc-s">{mine.length ? `${mine.length} for you` : 'None for you'}{w.some(m => m.st === 'merchants') ? ` · ${w.filter(m => m.st === 'merchants').length} shop payout` : ''}</div></div></div></>);
    }

    /* ══ Overview: is everything covered? ══════════════════════════════════════════════ */
    function claimsCell() {
      const C = [['Member savings', 'USDC reserve at Bridge', M.savings, M.savings], ['Shops, by 4 Nov', 'Payout pool, then the yield pool', M.owed14, M.payout + M.dueMembers + Y.toPayout], ['Bondholders', 'BondVault', M.bonds, Math.min(M.bonds, M.bv)], ['Yield pool deposits', 'Pool cash, then loans out', Y.assets, Y.assets, Y.cash - Y.toPayout]];
      return cell('s7', 'Claims in order', <span className="lbl">Who gets paid first</span>, <div className="ncl">{C.map(([k, by, owed, held, liq], i) => {
          const c = Math.min(1, held / owed),
            gap = Math.max(0, owed - held);
          return <div key={i} className={`ncl-r ${c < 1 ? 'part' : ''}`}><span className="ncl-n">{i + 1}</span><span className="ncl-k"><b>{k}</b><span>{by}</span></span><span className="ncl-b">{liq != null ? <><i style={css(`width:${liq / owed * 100}%`)} /><i style={css(`width:${(held - liq) / owed * 100}%;background:var(--land)`)} /></> : <><i style={css(`width:${c * 100}%`)} />{c < 1 ? <em style={css(`left:${c * 100}%;right:0`)} /> : ''}</>}</span><span className="ncl-p"><b>{c >= 1 ? '100%' : pct(held, owed)}</b><span>{gap ? money(gap) + ' short' : 'covered'}</span></span><b className="ncl-v">{money(owed)}</b></div>;
        })}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Cash or reserve</span><span><i style={css("background:var(--land)")} />Out on loan</span><span><i className="hatch" />Not covered yet</span></span><button data-ntab="pools">Pools →</button></>);
    }
    function gateCell() {
      const W = 100,
        H = 36,
        mx = .4,
        pts = RTD_W.map((v, i) => v == null ? null : [i / (RTD_W.length - 1) * W, H - v / mx * H]).filter(Boolean),
        dip = RTD_W.findIndex(v => v != null && v < M.floor);
      const spark = <svg className="ngs" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2={W} y1={H - M.floor / mx * H} y2={H - M.floor / mx * H} className="fl" /><path d={`M${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' L')}`} /></svg>;
      return cell('s5', 'Credit gate', <span className="lbl">Protocol · 12 s</span>, <div className="ngt"><div className="ngt-top"><div className="m-big">{(M.rtd * 100).toFixed(1)}{"% "}<small>RTD</small></div><span className="fst ok">Open</span></div><div className="ngt-eq"><span><b>{money(M.assurance)}</b>AssurancePool</span><i>÷</i><span><b>{money(M.unsecured)}</b>Unsecured credit</span></div><div className="ngt-m"><div className="ngt-t"><i style={css(`width:${M.rtd / mx * 100}%`)} /><s style={css(`left:${M.floor / mx * 100}%`)}><em>20% floor</em></s></div><div className="ngt-ax"><span>0</span><span>40%</span></div></div><div className="ngt-h">{spark}<span><b>{NW[dip]}</b>{" fell to "}{(RTD_W[dip] * 100).toFixed(1)}% and paused new credit for a week</span></div></div>, <><span>{money(M.room)}{" more unsecured credit can issue"}</span><button data-npool="ap" data-ntab="pools">AssurancePool →</button></>);
    }
    function runwayChart(h = 200) {
      let b = M.payout;
      const pts = [[0, b]];
      for (let d = 1; d <= 30; d++) {
        FLOWS.filter(f => f[0] === d).forEach(f => {
          pts.push([d, b]);
          b += f[1] === 'in' ? f[2] : -f[2];
          pts.push([d, b]);
        });
      }
      pts.push([30, b]);
      const mx = 12000,
        mn = -4000,
        W = 1000,
        x = d => d / 30 * W,
        y = v => (mx - v) / (mx - mn) * h,
        z = y(0),
        pc = v => (y(v) / h * 100).toFixed(2) + '%';
      const line = 'M' + pts.map(([d, v]) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' L');
      const lo = Math.min(...pts.map(p => p[1])),
        g0 = 14,
        g1 = 16;
      const area = `M0,${z} L` + pts.map(([d, v]) => `${x(d).toFixed(1)},${y(Math.max(0, v)).toFixed(1)}`).join(' L') + ` L${W},${z} Z`;
      const marks = FLOWS.map(([d, k, v], __k) => <i key={__k} className={k} style={css(`left:${d / 30 * 100}%`)} title={`${dayD(d)} · ${k === 'in' ? '+' : '−'}${money(v)}`} />);
      return <div className="nrw"><div className="nrw-p"><svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" aria-hidden="true"><defs><pattern id="nhu" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" className="hxu" /></pattern></defs>{[5000, 10000].map((v, __k) => <line key={__k} x1="0" x2={W} y1={y(v)} y2={y(v)} className="grid" />)}<path d={area} className="ar" /><rect x={x(g0)} y={z} width={x(g1) - x(g0)} height={y(lo) - z} className="gap" /><line x1="0" x2={W} y1={z} y2={z} className="zero" /><path d={line} className="ln" /></svg>{[[10000, '$10k'], [5000, '$5k'], [0, '$0']].map(([v, t], __k) => <span key={__k} className="nrw-y" style={css(`top:${pc(v)}`)}>{t}</span>)}<span className="nrw-c" style={css(`left:${(x(g0) + x(g1)) / 2 / W * 100}%;top:calc(${pc(lo)} + 8px)`)}><b>{"Borrows "}{money(-lo)}</b><span>{dayD(g0)}{" → "}{dayD(g1)}, from the yield pool</span></span><span className="nrw-e" style={css(`top:${pc(b)}`)}><b>{money(b)}</b></span></div><div className="nrw-x"><div className="nrw-m">{marks}</div>{[0, 7, 14, 21, 28].map((d, __k) => <span key={__k} style={css(`left:${d / 30 * 100}%`)}>{dayD(d)}</span>)}</div></div>;
    }
    function renderOverview() {
      const run = cell('s8', 'The payout pool, next 30 days', <span className="lbl">Projected from the schedule</span>, <div className="nrun"><div className="nrun-h"><div className="m-big">{money(52.51)}{" "}<small>left on 20 Nov, after it borrows and pays back</small></div></div>{runwayChart()}<div className="f-key nrun-k"><span><i style={css("background:var(--land)")} />Repayments in</span><span><i style={css("background:var(--fg)")} />Payouts to shops</span><span><i className="hatch" />Borrowed from the yield pool</span><span><i style={css("background:color-mix(in srgb,var(--fg) 12%,transparent);box-shadow:inset 0 0 0 1px var(--fg-50)")} />In the pool</span></div></div>, <><span>{money(13980.05)}{" out · "}{money(3792.56)}{" in"}</span><button data-ntab="cash">Cash flow →</button></>);
      const w = pend(),
        mine = forMe();
      const NEED = [...mine.map((m, __k) => ['underway', `Approve: ${m.t}`, `${money(m.amt)} · ${firstN(m.by)} proposed ${rel(m.d)}${m.due != null ? ' · due ' + dayD(m.due) : ''}`, rel(m.d) === 'today' ? 'Today' : WD(m.d), <><span className="who">Needs you</span><button className="lnk" data-nopen={m.id}>Review →</button></>]), ...w.filter(m => m.st === 'waiting' && m.by === N.me).map((m, __k) => ['line', m.t, `${money(m.amt)} · you proposed ${rel(m.d)}`, WD(m.d), <><span className="who">{"Waiting on "}{firstN(m.wait || 'dana')}</span><button className="lnk" data-ntab="moves">Moves →</button></>]), ...w.filter(m => m.st === 'merchants').map((m, __k) => ['live', m.t, `${money(m.amt)} · ${firstN(m.by)} proposed · goes ${rel(m.due)}`, 'Tomorrow', <><span className="who">Needs a second person</span><button className="lnk" data-nrosa="">Review →</button></>]), ['absent', 'Operating cash is 3 hours old', 'Plaid last synced at 08:12 · the bank feed is behind', '3 h', <><span className="who none">Not synced</span><button className="lnk" data-nsync="">Sync now →</button></>], ['line', 'The first bond matures 14 Dec', `BB-0001 · ${money(2500)} · paid from what BondVault keeps back`, '54 d', <button className="lnk" data-npool="bonds">Bonds →</button>]];
      const need = cell('s4', 'Needs you', <span className="lbl">{NEED.length}{" things"}</span>, <div className="al">{NEED.map(([sv, t, m, age, own], __k) => <div key={__k} className="alr"><div className="al-m"><div className="al-t"><i className="sv" style={css(`background:${{
                underway: 'var(--underway)',
                live: 'var(--live)',
                absent: 'var(--absent)',
                line: 'var(--line)'
              }[sv]}`)} /><b>{t}</b><span className="age">{age}</span></div><span className="m">{m}</span></div><div className={`own ${sv === 'absent' ? 'none' : ''}`}>{own}</div></div>)}</div>, <><span>Every move needs two people</span><button data-ntab="moves">All moves →</button></>);
      html(document.getElementById('nv'), <>{band(<>{claimsCell()}{gateCell()}</>, 1)}{band(<>{run}{need}</>)}{band(holdingsCell())}</>);
    }
    /* BondVault keeps back what's due to bondholders within 90 days, or 30% of all owed, whichever is more; the Safe can take the rest */
    const BV_NEED = () => Math.max(7500, M.bonds * 0.3);
    const bvSub = () => {
      const bv = M.bv || 0,
        kept = Math.min(bv, BV_NEED()),
        use = Math.max(0, bv - BV_NEED());
      return [['Kept for bondholders', 'Due within 90 days, or 30% of all owed', bv >= BV_NEED() ? 'Kept back' : `Needs ${money(BV_NEED())}`, money(kept)], ['The Safe can take', 'For operations, growth or the pools', 'Usable', money(use)]].map(([k, s, t, v], __k) => <div key={__k} className="nh-r sub"><span /><span className="nh-k"><b>{k}</b><span>{s}</span></span><span /><span /><span className="nh-ch">{t}</span><b className="nh-v">{v}</b></div>);
    };
    function holdingsCell() {
      const tot = ACCTS.reduce((a, x) => a + x[5], 0);
      let c = 0;
      const seg = ACCTS.map(a => {
        const w = a[5] / tot * 100,
          l = c;
        c += w;
        return {
          a,
          l,
          w
        };
      });
      const grp = Object.keys(GROUPS).map(g => {
        const ss = seg.filter(x => x.a[3] === g);
        return {
          g,
          l: ss[0].l,
          w: ss.reduce((s, x) => s + x.w, 0),
          v: ss.reduce((s, x) => s + x.a[5], 0)
        };
      });
      const sp = v => {
        const mx = Math.max(...v) || 1,
          mn = Math.min(...v);
        return <svg className="nh-sp" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d={`M${v.map((y, i) => `${(i / (v.length - 1) * 100).toFixed(1)},${(22 - (y - mn) / (mx - mn || 1) * 20).toFixed(1)}`).join(' L')}`} /></svg>;
      };
      return cell('s12', 'Where it sits', <span className="lbl">{ACCTS.length}{" accounts · "}{money(tot)}</span>, <><div className="nh"><div className="nh-bar">{seg.map(({
              a,
              w
            }, __k) => <button key={__k} data-nacct={a[0]} style={css(`flex:${w};--c:${a[7]}`)} title={`${a[1]} · ${money(a[5])}`}>{w > 13 ? <><span>{a[1]}</span><b>{pct(a[5], tot, 0)}</b></> : ''}</button>)}</div><div className="nh-br">{grp.map(({
              g,
              l,
              w,
              v
            }, __k) => <span key={__k} style={css(`left:${l}%;width:${w}%`)}><i /><b>{GROUPS[g][0]}</b><em>{money(v)}</em></span>)}</div></div><div className="nh-l"><div className="nh-r nh-hd"><span />{lbl('Account')}{lbl('Source')}{lbl('7 weeks')}{lbl('This week')}{lbl('Balance')}</div>{ACCTS.map((a, __k) => {
            const [id, n, why, g, src, bal, wk, col] = a,
              ch = wk[wk.length - 1] - wk[wk.length - 2];
            return <Fragment key={__k}><button className={`nh-r ${N.panel && N.panel.acct === id ? 'on' : ''}`} data-nacct={id}><i className="nh-sw" style={css(`background:${col}`)} /><span className="nh-k"><b>{n}</b><span>{why}</span></span><span className={`nh-src ${SRC[src][2] || ''}`}><i />{srcTxt(src)}</span>{sp(wk)}<span className={`nh-ch ${ch > 0 ? 'up' : ''}`}>{ch > 0 ? '+' : ''}{money(ch)}</span><b className="nh-v">{money(bal)}</b></button>{id === 'bv' ? bvSub() : ''}{id === 'ops' ? ASIDE.map(([k, v, s], __k) => <div key={__k} className="nh-r sub"><span /><span className="nh-k"><b>{k}</b><span>{s}</span></span><span /><span /><span className="nh-ch">Set aside</span><b className="nh-v">{money(v)}</b></div>) : ''}</Fragment>;
          })}</div></>, <><span>{money(freeCash())}{" of operating cash is free to spend, after tax and deposits"}</span><button data-nacct="ops">Operating cash →</button></>);
    }

    /* ══ Cash flow: what moves in the next 30 days ═════════════════════════════════════ */
    function renderCash() {
      let b = M.payout;
      const rows = FLOWS.map((f, i) => {
        b += f[1] === 'in' ? f[2] : -f[2];
        return [...f, b, i];
      });
      const L = rows.map(([d, k, v, n, s, bal, i], __k) => {
        const same = i && FLOWS[i - 1][0] === d,
          grp = FLOWS[i + 1] && FLOWS[i + 1][0] === d,
          newM = !i || MON(FLOWS[i - 1][0]) !== MON(d);
        const mt = FLOWS.filter(f => MON(f[0]) === MON(d)),
          mIn = mt.filter(f => f[1] === 'in').reduce((a, f) => a + f[2], 0),
          mOut = mt.filter(f => f[1] === 'out').reduce((a, f) => a + f[2], 0);
        return <Fragment key={__k}>{newM ? <div className="nfw-m"><span className="lbl">{MONL(d)}</span><span>{money(mOut)}{" out · "}{money(mIn)}{" in"}</span></div> : ''}<div className={`nfw-r ${same ? 'same' : ''} ${grp ? 'grp' : ''} ${d === 1 ? 'soon' : ''}`}><span className="nfw-d">{same ? <i className="tie" /> : <span className="leaf"><span>{WD(d)}</span><b>{DD(d)}</b></span>}</span><span className="nfw-k"><b>{n}</b><span>{s}{" · "}{same ? 'same day' : rel(d)}</span></span><b className={`nfw-v ${k}`}>{k === 'in' ? '+' : '−'}{money(v)}</b><span className={`nfw-b ${bal < 0 ? 'neg' : ''}`}>{bal < 0 ? <><b>{money(bal)}</b><span>yield pool lends it</span></> : <><b>{money(bal)}</b><span>in the pool after</span></>}</span></div></Fragment>;
      });
      const list = cell('s7', 'Every movement', <span className="lbl">Next 30 days</span>, <div className="nfw">{L}</div>, <><span>NET-14 shops are paid every other Wednesday</span><button data-ngo="merchants/payouts">Payouts · Merchants →</button></>);
      const term = (k, v, n, cls = '') => <div className={cls}>{lbl(k)}<b>{v}</b><span>{n}</span></div>;
      const tot = M.owed14,
        seg = [['In the pool', M.payout, ''], ['Coming in', M.dueMembers, 'in'], ['Borrowed', M.short, 'gap']];
      const gap = cell('s5', 'The 4 Nov gap', <span className="lbl">PayoutPool</span>, <div className="ngp"><div className="m-big">{money(M.short)}{" "}<small>short on 4 Nov · the yield pool covers it</small></div><div className="ngb"><div className="ngb-bar">{seg.map(([k, v, c], __k) => <i key={__k} className={c} style={css(`flex:${v}`)} />)}</div><div className="ngb-o"><span>Owed to shops by 4 Nov</span><b>{money(tot)}</b></div><div className="ngb-k">{seg.map(([k, v, c], __k) => <div key={__k} className={c}><i /><span>{k}</span><b>{money(v)}</b></div>)}</div></div><div className="ngp-l">{[[14, 'Yield pool lends it', 'Shops are paid on time', '+' + money(Y.toPayout), 'in'], [16, 'Repayments pay it back', 'Pool left at ' + money(1193.31), '−' + money(Y.toPayout), '']].map(([d, t, sub, v, k], __k) => <div key={__k} className="ngp-r">{leaf(d)}<span><b>{t}</b><span>{sub}</span></span><b className={k}>{v}</b></div>)}</div></div>, N.moves.some(m => m.kind === 'topup' && m.st === 'waiting') ? <><span>{firstN(N.moves.find(m => m.kind === 'topup').by)}{" proposed a top-up · waiting on "}{firstN(N.moves.find(m => m.kind === 'topup').wait || 'dana')}</span><button className="btn sm-b" data-ntab="moves">See it</button></> : <><span>No top-up needed</span><button className="btn sm-b" data-npropose="topup">Top up instead</button></>, 'ngap');
      const wk = [['This week', [592.94], [412.60]], ['26 Oct', [889.42], []], ['2 Nov', [2310.20], [9510.65, 2916.00]], ['9 Nov', [], []], ['16 Nov', [], [1140.80]]];
      const wmx = 12500;
      const weeks = cell('s7', 'In and out, by week', <span className="lbl">Next 5 weeks</span>, <div className="nwk">{wk.map(([t, i, o], __k) => {
          const ti = i.reduce((a, b) => a + b, 0),
            to = o.reduce((a, b) => a + b, 0);
          return <div key={__k} className="nwk-c"><div className="nwk-u"><i style={css(`height:${ti / wmx * 100}%`)} />{ti ? <span>+{money0(ti)}</span> : ''}</div><div className="nwk-d"><i className={t === '16 Nov' ? 'hx' : ''} style={css(`height:${to / wmx * 100}%`)} />{to ? <span>−{money0(to)}</span> : ''}</div><span className="nwk-t">{t}</span></div>;
        })}</div>, <><span className="f-key"><span><i style={css("background:var(--land)")} />In from members</span><span><i style={css("background:var(--fg)")} />Out to shops</span><span><i className="hx" />Estimate</span></span><span /></>);
      const later = cell('s5', 'After that', <span className="lbl">Next 90 days</span>, <div className="nl">{[[54, 'BB-0001 matures', 'Member · 4 months at 6.0%', 2500], [92, 'BB-0002 matures', 'Founding lender · 5 months at 6.5%', 5000], [41, 'Monthly run', 'October sales · NET-30 · estimate', 19825.70 * 0.98]].sort((a, b) => a[0] - b[0]).map(([d, t, s, v], __k) => <div key={__k} className="nl-r">{leaf(d)}<span><b>{t}</b><span>{s}{" · "}{rel(d)}</span></span><b>−{money(v)}</b></div>)}</div>, <><span>Bonds are paid from what BondVault keeps back</span><button data-npool="bonds">Bonds →</button></>);
      html(document.getElementById('nv'), <>{band(<>{list}{gap}</>, 1)}{band(<>{weeks}{later}</>)}</>);
    }

    /* ══ Credit: how much is out, and how safe ════════════════════════════════════════ */
    function renderCredit() {
      const t4 = (k, v, n, cls = '') => <div className={cls}>{lbl(k)}<b>{v}</b><span>{n}</span></div>;
      const oct = cell('s12', 'October', <span className="lbl">Protocol · 12 s</span>, <div className="ncr"><div className="ncr-rp"><div className="ncr-h"><div className="m-big">{"100% "}<small>of this cycle’s repayments are in or on autopay</small></div><span>{"Due 31 Oct · "}{money(CR.due)}</span></div><div className="ncr-t"><i style={css(`width:${CR.repaid / CR.due * 100}%`)} /><i className="s hx" style={css(`width:${CR.sched / CR.due * 100}%`)} /></div><div className="f-key"><span><i style={css("background:var(--fg)")} />{"Collected "}<b>{money(CR.repaid)}</b></span><span><i className="hx" />{"On autopay, 24 and 30 Oct "}<b>{money(CR.sched)}</b></span></div></div><div className="ngp-eq ncr-eq">{t4('Owed on 1 Oct', money(CR.start), 'start of the month')}<i>+</i>{t4('Spent', money(CR.spent), 'at 12 shops')}<i>−</i>{t4('Repaid', money(CR.repaid), 'by members')}<i>=</i>{t4('Owed now', money(M.credit), `by ${M.members} members`, 'hi')}</div></div>, <><span>{money(M.limits)}{" in limits · "}{pct(M.credit, M.limits)}{" drawn · "}{M.autopay}{" members on autopay"}</span><button data-ngo="members">Members →</button></>);
      /* one shape for the row: a figure, one bar, then a ledger whose rows match the bar's colours */
      const lrow = (col, k, sub, v, cls = '') => <div className={cls}><span><i className="nsw" style={css(`background:${col}`)} />{k}{sub ? <em>{sub}</em> : ''}</span><b>{v}</b></div>;
      const back = cell('s4', 'What backs it', <span className="lbl">If a member stops paying</span>, <div className="ncb"><div className="m-big">{pct(M.savingsBacked, M.credit)}{" "}<small>backed by their own savings</small></div><div className="ncb-bar"><i style={css(`flex:${M.savingsBacked}`)} /><i style={css(`flex:${M.unsecured};background:var(--underway)`)} /></div><div className="led ncb-l">{lrow('var(--fg)', 'Savings-backed', 'Their own savings pay it', money(M.savingsBacked))}{lrow('var(--underway)', 'Unsecured', 'Yield pool, then AssurancePool', money(M.unsecured))}</div></div>, <><span>Only unsecured counts for RTD</span><button data-npool="ap" data-ntab="pools">Gate →</button></>);
      const AC = ['var(--fg)', 'color-mix(in srgb,var(--fg) 45%,transparent)', 'var(--underway)', 'var(--absent)'];
      const age = cell('s4', 'How old', <span className="lbl">What’s owed</span>, <div className="ncb"><div className="m-big">{pct(CR.aging[0][1], M.credit)}{" "}<small>is current</small></div><div className="ncb-bar">{CR.aging.filter(a => a[1]).map(([k, v], i) => <i key={i} style={css(`flex:${v};background:${AC[i]}`)} />)}</div><div className="led ncb-l">{CR.aging.map(([k, v], i) => <Fragment key={i}>{lrow(AC[i], k, '', v ? money(v) : 'None', v ? '' : 'z')}</Fragment>)}</div></div>, <><span>{money(1310.40 + 421.80)}{" late · nothing over 60 days"}</span><span /></>);
      const loss = cell('s4', 'Losses', <span className="lbl">All time</span>, <div className="ncb"><div className="m-big">{money(M.lost)}{" "}<small>3 members · paid by the AssurancePool</small></div><div className="ncb-bar">{CR.losses.map((_, __k) => <i key={__k} style={css("flex:1;background:var(--absent)")} />)}</div><div className="led ncb-l">{CR.losses.map(([d, n, id, v]) => <Fragment key={id}>{lrow('var(--absent)', n, `${dayD(d)} · 90 days late`, money(v))}</Fragment>)}</div></div>, <><span>Loss rate 1.1% · recovered $0.00</span><button data-npool="ap" data-ntab="pools">AssurancePool →</button></>);
      const smx = CR.shops[0][1];
      const shops = cell('s7', 'Where it was spent', <span className="lbl">October · Lithic · 1 min</span>, <div className="nsh">{CR.shops.map(([n, v, l], i) => <div key={i} className={`nsh-r ${i === CR.shops.length - 1 ? 'rest' : ''}`}><span>{n}</span><span className="nsh-b"><i style={css(`width:${v / smx * 100}%;${l ? 'background:var(--underway)' : ''}`)} /></span><b>{money(v)}</b></div>)}</div>, <><span className="f-key"><i style={css("background:var(--fg)")} />{"No losses "}<i style={css("background:var(--underway)")} />A loss on its book</span><button data-ngo="merchants/partners">Partners →</button></>);
      const lmx = Math.max(...CR.limits.map(x => x[1]));
      const lim = cell('s5', 'Limit sizes', <span className="lbl">{M.members}{" members"}</span>, <div className="nlm">{CR.limits.map(([k, v], __k) => <div key={__k}><span>{v}</span><i style={css(`height:${v / lmx * 100}%`)} className={v === lmx ? 'hi' : ''} /><s>{k}</s></div>)}</div>, <><span>Most common limit $250 · 46 members</span><span /></>);
      html(document.getElementById('nv'), <>{band(oct, 1)}{band(<>{back}{age}{loss}</>)}{band(<>{shops}{lim}</>)}</>);
    }

    /* ══ Pools ═════════════════════════════════════════════════════════════════════════ */
    const POOLS = [['ap', 'AssurancePool', () => M.assurance, 'Covers unsecured losses after the yield pool', () => <><i style={css(`width:${M.unsecured * M.floor / M.assurance * 100}%`)} /><i style={css(`width:${(1 - M.unsecured * M.floor / M.assurance) * 100}%;background:var(--land)`)} /></>, () => `${money(M.assurance - M.unsecured * M.floor)} spare over the floor`], ['pay', 'Payout pool', () => M.payout, 'Pays shops for financed sales, oldest first', () => <><i style={css(`width:${M.payout / M.owed14 * 100}%`)} /><i className="hx" style={css("flex:1")} /></>, () => `Covers ${pct(M.payout, M.owed14, 0)} of what’s owed by 4 Nov`], ['yield', 'Yield pool', () => Y.assets, 'Members lending to unsecured credit', () => <><i style={css(`width:${Y.util * 100}%;background:var(--live)`)} /><i style={css(`width:${(1 - Y.util) * 100}%;background:var(--land)`)} /></>, () => `${(Y.apy * 100).toFixed(2)}% a year · ${pct(Y.lent, Y.assets, 0)} lent out`], ['bonds', 'Bonds', () => M.bonds, 'Owed to bondholders · 6 BurnerBonds', () => <><i style={css(`width:${Math.min(M.bv, BV_NEED()) / M.bonds * 100}%`)} /><i style={css(`width:${Math.max(0, M.bv - BV_NEED()) / M.bonds * 100}%;background:var(--land)`)} /></>, () => `${money(Math.min(M.bv, BV_NEED()))} kept · ${money(Math.max(0, M.bv - BV_NEED()))} spare`]];
    function renderPools() {
      const tiles = POOLS.map(([k, n, v, s, bar, f], __k) => <button key={__k} className={`cell s3 npt ${N.pool === k ? 'on' : ''}`} data-npool={k}><div className="hd"><h2>{n}</h2><div className="r">{ICO.chev}</div></div><div className="npt-b"><div className="m-big">{money(v()).replace(/\.\d+$/, '')}<small className="ct">{money(v()).match(/\.\d+$/)[0]}</small></div><span>{s}</span><div className="npt-bar">{bar()}</div></div><div className="bk-ft"><span>{f()}</span></div></button>);
      const D = {
        ap: poolAP,
        pay: poolPay,
        yield: poolYield,
        bonds: poolBonds
      }[N.pool]();
      const st = (n, k, v, s) => <div className="nlo-s"><span className="nlo-n">{n}</span><b>{k}</b><span className="m-big">{v}</span><span>{s}</span></div>;
      const ex = M.unsecured,
        S3 = [[1, 'Their own savings', M.savingsBacked, 'Savings-backed credit · their pledged savings pay it', 'Covers all of it', 1, 'var(--fg)', 'solo'], [2, 'Yield pool', Y.assets, 'Unsecured credit · first loss, its share price falls', `Could cover all ${money(ex)}`, 1, 'var(--live)', 'to'], [3, 'AssurancePool', M.assurance, 'Unsecured credit · pays what the yield pool can’t', `Covers ${pct(M.assurance, ex, 0)} of it`, M.assurance / ex, 'var(--underway)', 'end']];
      const arrow = <span className="nlx-a"><i /><svg viewBox="0 0 8 12" aria-hidden="true"><path d="M1.5 1.5 6.5 6l-5 4.5" /></svg></span>;
      const stop = <span className="nlx-a nlx-stop" title="Stops here: savings-backed credit never reaches a pool"><i /><b /></span>;
      const order = cell('s12', 'If a member stops paying', <span className="lbl">The order the contracts enforce</span>, <div className="nlx"><div className="nlx-st">{S3.map(([n, k, v, note, cov, f, col, kind], __k) => <div key={__k} className={`nlx-s ${kind}`}><div className="nlx-h"><span className="nlx-n" style={css(`--c:${col}`)}>{n}</span><b className="nlx-k">{k}</b>{kind === 'to' ? arrow : kind === 'solo' ? stop : ''}</div><span className="m-big">{money(v)}</span><span className="nlx-t">{note}</span><div className="nlx-b"><i style={css(`width:${Math.min(1, f) * 100}%;background:${col}`)} /></div><span className="nlx-c">{cov}</span></div>)}</div><div className="nlx-nv"><div className="nlx-h"><span className="nlx-n nlx-x"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2 2 8" /></svg></span><b className="nlx-k">Never covers a loss</b></div><div className="nlx-nl">{[['Bondholders', M.bonds, 'Owed by the co-op'], ['Payout pool', M.payout, 'Owed to shops'], ['Other members’ savings', M.savings - M.savingsBacked, 'Theirs, untouched']].map(([k, v, sub], __k) => <div key={__k}><span><b>{k}</b><em>{sub}</em></span><b>{money(v)}</b></div>)}</div></div></div>, <><span>Savings-backed credit never reaches a pool</span><button data-ntab="credit">Credit →</button></>);
      html(document.getElementById('nv'), <>{band(tiles, 1)}{D}{band(order)}</>);
    }
    function poolAP() {
      const req = M.unsecured * M.floor,
        apW = AP_BAL.slice(1).map((v, i) => v - AP_BAL[i]),
        wmx = Math.max(...apW);
      const a = cell('s7', 'Against the floor', <span className="lbl">AssurancePool · Protocol · 12 s</span>, <div className="npd"><div className="m-big">{money(M.assurance)}{" "}<small>{"covers "}{money(M.unsecured)}{" of unsecured credit"}</small></div><div className="ncb-bar"><i style={css(`flex:${req}`)} /><i style={css(`flex:${M.assurance - req};background:var(--land)`)} /></div><div className="f-key"><span><i style={css("background:var(--fg)")} />{"Needed for the 20% floor "}<b>{money(req)}</b></span><span><i style={css("background:var(--land)")} />{"Spare "}<b>{money(M.assurance - req)}</b></span></div>{lbl('Added each week · its share of credit fees')}<div className="nlm wk">{apW.map((v, i) => <div key={i}><span>{money0(v)}</span><i style={css(`height:${v / wmx * 100}%`)} className={i === apW.length - 1 ? 'hi' : ''} /><s>{NW[i + 1]}</s></div>)}</div></div>, <><span>Lent out $0.00 · it only lends its spare, never the floor</span><span /></>);
      const b = cell('s5', 'Losses it paid', <span className="lbl">All time · 3</span>, <div className="nl">{CR.losses.map(([d, s, id, v], __k) => <div key={__k} className="nl-r">{leaf(d)}<span><b>{s}</b><span>Member M•••, 90 days late · before the yield pool opened</span></span><b>−{money(v)}</b></div>)}</div>, <><span>{money(M.lost)}{" absorbed · loss rate 1.1%"}</span><button data-ntab="credit">Credit →</button></>);
      return band(<>{a}{b}</>);
    }
    function poolPay() {
      const q = [[1, 'Rosa’s Panadería', 412.60], [12, 'Monthly run · 11 shops', 9510.65], [14, 'Arrowhead Nails', 732.00], [14, 'Cajon Phone Repair', 2184.00]];
      let run = 0;
      const a = cell('s7', 'Claims, oldest first', <span className="lbl">PayoutPool · Protocol · 12 s</span>, <div className="nq">{q.map(([d, k, v], i) => {
          const s = run;
          run += v;
          const cov = Math.max(0, Math.min(v, M.payout - s)),
            same = i && q[i - 1][0] === d;
          const grp = q[i + 1] && q[i + 1][0] === d;
          return <div key={i} className={`nq-r ${same ? 'same' : ''} ${grp ? 'grp' : ''}`}><span className="nq-d">{same ? <i className="tie" aria-hidden="true" /> : leaf(d)}</span><span className="nq-k"><b>{k}</b><span>{cov >= v ? 'Covered now' : cov > 0 ? `${money(cov)} covered now` : 'From repayments, then the yield pool'}</span></span><span className="nq-b"><i style={css(`width:${cov / v * 100}%`)} /></span><b>{money(v)}</b></div>;
        })}</div>, <><span className="f-key"><i style={css("background:var(--fg)")} />{"Covered now "}<i className="hx" />Repayments, then the yield pool</span><button data-ngo="merchants/payouts">Payouts →</button></>);
      const b = cell('s5', 'How it’s funded', <span className="lbl">Funded beats queued</span>, <div className="led npl">{[['Today', money(M.payout)], ['Repayments due by 4 Nov', money(M.dueMembers)], ['Owed by 4 Nov', money(M.owed14)], ['Borrowed from the yield pool', money(M.short)], ['Paid back', '6 Nov, from repayments'], ['Order', 'Oldest claim first, always']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>, <><span>Top-ups need a second person</span><button className="btn sm-b" data-npropose="topup">Propose a top-up</button></>);
      return band(<>{a}{b}</>);
    }
    function poolYield() {
      const mo = bps => (bps / 100).toFixed(2) + '%',
        depAt = u => yApy(yBorrowBps(u) * u) * 100;
      const sc = [['20%', .2], ['40%', .4], [`${Math.round(Y.util * 100)}% now`, Y.util], [`${Math.round(Y.utilAfter * 100)}% 4 Nov`, Y.utilAfter], ['80%', .8]],
        smx = Math.max(...sc.map(s => depAt(s[1])));
      const t = (k, v, n, cls = '') => <div className={cls}>{lbl(k)}<b>{v}</b><span>{n}</span></div>;
      const a = cell('s7', 'Rate', <span className="lbl">{"LendingPool · opened "}{Y.opened}</span>, <div className="npd"><div className="ngp-eq">{t('Credit pays', mo(Y.borrowBps), `a month · ${(Y.apr * 100).toFixed(1)}% a year`)}<i>×</i>{t('Lent out', pct(Y.lent, Y.assets), `${money(Y.lent)} of ${money(Y.assets)}`)}<i>=</i>{t('Depositors earn', mo(Y.supplyBps), `a month · ${(Y.apy * 100).toFixed(2)}% a year`, 'hi')}</div>{lbl('Yearly rate to depositors, by share lent out')}<div className="nlm wk">{sc.map(([k, u], i) => <div key={i}><span>{depAt(u).toFixed(1)}%</span><i style={css(`height:${depAt(u) / smx * 100}%`)} className={i === 2 ? 'hi' : 'hx'} /><s>{k}</s></div>)}</div></div>, <><span>Set by the contract’s curve, not by us · past 80% lent it climbs fast</span><span /></>);
      const b = cell('s5', 'How depositors get paid', <span className="lbl">ERC-4626</span>, <div className="npd"><div className="m-big">${Y.price.toFixed(4)}{" "}<small>{"a share · up "}{((Y.price - 1) * 100).toFixed(2)}{"% since "}{Y.opened}</small></div><div className="led">{[['Interest', 'Raises the share price'], [`Withdrawals up to ${money(Y.cash)}`, 'Paid at once'], ['Above that', 'Queued, paid as credit repays'], ['Pledged to credit', `${money(Y.pledged)} · locked`], ['Earned so far', money(Y.earned)]].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>, <><span>Queue: empty</span><span /></>);
      const per = 8,
        rows = Y_DEP.slice(N.dp * per, N.dp * per + per);
      const tbl = cell('s12', 'Depositors', <span className="lbl">{Y.depositors}{" members · masked"}</span>, <div className="bt-wrap"><table className="bt ndp"><colgroup><col style={css("width:16%")} /><col style={css("width:12%")} /><col style={css("width:15%")} /><col style={css("width:12%")} /><col style={css("width:15%")} /><col style={css("width:15%")} /><col style={css("width:15%")} /></colgroup><thead><tr><th className="c-nm">Member</th><th style={css("text-align:left")}>Since</th><th>Put in</th><th>Earned</th><th>Worth now</th><th>Pledged</th><th>Can withdraw</th></tr></thead><tbody>{rows.map((r, __k) => <tr key={__k}><td className="tn"><b className="mono">M•••{r.id}</b></td><td style={css("text-align:left")}>{r.since}</td><td>{money(r.d)}</td><td>{money(r.e)}</td><td><b>{money(r.w)}</b></td><td>{r.pl ? money(r.pl) : <span className="quiet">None</span>}</td><td className="quiet">{r.pl ? money(r.w - r.pl) : 'All of it'}</td></tr>)}</tbody></table></div>, <><span>{"Names stay masked · "}{money(Y.assets)}{" in all"}</span>{pager(N.dp, Y_DEP.length, per, 'ndp')}</>);
      return <>{band(<>{a}{b}</>)}{band(tbl)}</>;
    }
    function poolBonds() {
      const mons = ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
        by = mons.map(m => BONDS.filter(b => b[3].endsWith(m)).reduce((a, b) => a + b[1], 0)),
        bmx = Math.max(...by);
      const a = cell('s7', 'Bond ladder', <span className="lbl">Face value by month it matures</span>, <div className="npd"><div className="m-big">{money(M.bonds)}{" "}<small>{"across "}{BONDS.length}{" bonds, each its own token"}</small></div><div className="nlm wk lad">{mons.map((m, i) => <div key={i}><span>{by[i] ? '$' + (by[i] / 1000).toFixed(1) + 'k' : ''}</span><i style={css(`height:${by[i] / bmx * 100}%`)} className={i === 0 ? 'hi' : by[i] ? 'hx' : 'z'} /><s>{m}</s></div>)}</div></div>, <><span>Zero-coupon · rates are internal, never exported</span><span /></>);
      const b = cell('s5', 'Due in 90 days', <span className="lbl">Through 21 Jan</span>, <div className="npd"><div className="m-big">{money(7500)}{" "}<small>{"two bonds · BondVault keeps "}{money(Math.min(M.bv, BV_NEED()))}{" back for them"}</small></div><div className="nl">{BONDS.filter(x => x[4] <= 92).map((x, __k) => <div key={__k} className="nl-r">{leaf(x[4])}<span><b>{x[0]}</b><span>{x[7]}{" · "}{rel(x[4])}</span></span><b>{money(x[1])}</b></div>)}</div></div>, <><span>BondVault keeps 30% of all owed, or what’s due in 90 days</span><span /></>);
      const tbl = cell('s12', 'Every bond', <span className="lbl">6 BurnerBonds</span>, <div className="bt-wrap"><table className="bt nbd"><colgroup><col style={css("width:14%")} /><col style={css("width:14%")} /><col style={css("width:12%")} /><col style={css("width:12%")} /><col style={css("width:22%")} /><col style={css("width:10%")} /><col style={css("width:16%")} /></colgroup><thead><tr><th className="c-nm">Bond</th><th>Face value</th><th style={css("text-align:left")}>Issued</th><th style={css("text-align:left")}>Matures</th><th style={css("text-align:left")}>Term</th><th>Rate</th><th style={css("text-align:left")}>Holder</th></tr></thead><tbody>{BONDS.map((x, __k) => <tr key={__k}><td className="tn"><b className="mono">{x[0]}</b></td><td>{money(x[1])}</td><td style={css("text-align:left")}>{x[2]}</td><td style={css("text-align:left")}>{x[3]}</td><td style={css("text-align:left")}><span className="nbd-t"><span><i style={css(`width:${x[5] / 12 * 100}%`)} /></span>{x[5]}{" mo"}</span></td><td>{x[6].toFixed(1)}%</td><td style={css("text-align:left")}>{x[7]}</td></tr>)}</tbody></table></div>, <><span>Next maturity 14 Dec · last 15 Sep</span><span /></>);
      return <>{band(<>{a}{b}</>)}{band(tbl)}</>;
    }

    /* ══ Moves: propose, approve, history ═════════════════════════════════════════════ */
    function renderMoves() {
      const w = pend();
      const row = m => {
        const mine = m.by === N.me,
          me = forMe().includes(m);
        return <div className={`nmv-r ${me ? 'me' : ''}`}>{leaf(m.d)}<span className="nmv-k"><b>{m.t}</b><span>{PLACES[m.from] || acctOf(m.from)?.[1] || m.from}{" → "}{PLACES[m.to] || m.to}{" · "}{mine ? 'you' : PPL[m.by].f}{" proposed "}{rel(m.d)}{m.due != null ? ' · due ' + dayD(m.due) : ''}</span></span><b className="nmv-v">{money(m.amt)}</b><span className="nmv-a">{m.st === 'merchants' ? <><span className="who">Needs a second person</span><button className="lnk" data-nrosa="">Review →</button></> : me ? <button className="btn sm-b p" data-nopen={m.id}>Review</button> : mine ? <><span className="who">{"Waiting on "}{firstN(m.wait || 'dana')}</span><button className="lnk3" data-nwithdraw={m.id}>Take it back</button></> : <span className="who">{"Waiting on "}{m.wait ? firstN(m.wait) : 'a signer'}</span>}</span></div>;
      };
      const wc = cell('s8', 'Waiting for a second person', <>{CAN() ? <button className="btn p sm-b" data-npropose="topup">+ Propose a move</button> : <span className="lbl">{w.length}{" waiting"}</span>}</>, <div className="nmv">{w.length ? <>{w.map(m => <Fragment key={m.id}>{row(m)}</Fragment>)}<div className="nmv-end">Nothing else is waiting</div></> : <p className="nmv-e">Nothing is waiting.</p>}</div>, <><span>Proposing and approving are both logged in Records</span><button data-ngo="records">Records →</button></>);
      const rules = cell('s4', 'How money moves', <span className="lbl">Ops Safe · 2 of 3</span>, <div className="nru">{lbl('Signers · any two')}<div className="nru-l">{['kai', 'dana', 'board'].map((k, __k) => <div key={__k} className={`nru-p ${k === N.me ? 'me' : ''}`}><span className="av sm">{PPL[k].ini}</span><b>{k === N.me ? 'You' : PPL[k].n}</b><span>{PPL[k].role}</span><em>{k === N.me ? 'Signed in' : ''}</em></div>)}</div>{lbl('Rules')}<div className="led">{[['Who proposes', 'Any signer'], ['Who approves', 'A different signer'], ['Crossing to a bank', 'Always two people'], ['Spending the co-op balance', 'A member vote']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{lbl('Runs on its own')}<div className="nru-a">{['Yield pool withdrawals, up to its cash', 'The payout pool borrowing for a claim that’s due', 'The AssurancePool paying a loss'].map((t, __k) => <span key={__k}>{t}</span>)}</div></div>, <><span>Set in Permissions</span><button data-ngo="team">Permissions →</button></>);
      const F = {
        all: ['All', N.done],
        people: ['By people', N.done.filter(x => x.by)],
        auto: ['Automatic', N.done.filter(x => x.auto)]
      };
      const list = F[N.mf][1],
        per = 6,
        pages = Math.max(1, Math.ceil(list.length / per));
      N.mp = Math.min(N.mp, pages - 1);
      const hist = cell('s12', 'Done', <div className="seg sm" role="group" aria-label="Show">{Object.entries(F).map(([k, [t, a]], __k) => <button key={__k} data-nmf={k} aria-pressed={N.mf === k}>{t}{" "}{a.length}</button>)}</div>, <div className="nd">{list.slice(N.mp * per, N.mp * per + per).map((x, __k) => <div key={__k} className={`nd-r ${x.no ? 'no' : ''}`}>{leaf(x.d)}<span className="nd-k"><b>{x.t}</b><span>{x.from}{" → "}{x.to}</span></span><span className="nd-w">{x.auto ? <><span className="nd-auto">Automatic</span><span>{x.auto}</span></> : x.no ? <><span>{firstN(x.by)}{" proposed · "}<b className="bad">{firstN(x.no)}{" rejected"}</b></span><span>{x.why}</span></> : <><span>{firstN(x.by)}{" proposed · "}{firstN(x.ok)}{" approved"}</span><span>Signed in the Ops Safe</span></>}</span><b className={`nd-v ${x.no ? 'quiet' : ''}`}>{money(x.amt)}</b><span className="nd-tx">{x.tx ? <span className="mono">{x.tx}</span> : <span className="quiet">Not sent</span>}</span></div>)}</div>, <><span>Last 30 days</span>{pager(N.mp, list.length, per, 'nmp')}</>);
      html(document.getElementById('nv'), <>{band(<>{wc}{rules}</>, 1)}{band(hist)}</>);
    }

    /* ══ Side panels: an account, proposing a move, reviewing one ═════════════════════ */
    function ensurePanel() {
      let pn = document.getElementById('npanel');
      if (!pn) {
        const sc = document.createElement('div');
        sc.id = 'nscrim';
        sc.className = 'scrim';
        document.body.appendChild(sc);
        pn = document.createElement('aside');
        pn.id = 'npanel';
        pn.className = 'panel npanel';
        document.body.appendChild(pn);
      }
      return pn;
    }
    function renderPanel() {
      const pn = ensurePanel(),
        P = N.panel;
      if (!P) {
        document.body.classList.remove('pn');
        return;
      }
      document.body.classList.add('pn');
      html(pn, P.acct ? acctPanel(P.acct) : P.propose ? proposePanel(P) : P.review ? reviewPanel(P.review) : '');
    }
    function acctPanel(id) {
      const [, n, why, g, src, bal, wk, col] = acctOf(id),
        mx = Math.max(...wk) * 1.1 || 1;
      const facts = {
        sav: [['Members', String(M.members)], ['Tied to credit', money(M.savingsBacked)], ['Free to withdraw', money(M.savings - M.savingsBacked)], ['USDC at Bridge', money(M.savings)], ['Reserve', '1 : 1 · 2 min ago']],
        yld: [['Deposited', `${money(Y.assets)} · ${Y.depositors} members`], ['Lent to unsecured credit', `${money(Y.lent)} · ${pct(Y.lent, Y.assets, 0)}`], ['Cash for withdrawals', money(Y.cash)], ['Lends the payout pool', `${money(Y.toPayout)} on 4 Nov`], ['Depositors earn', `${(Y.apy * 100).toFixed(2)}% a year`]],
        pay: [['Owed to shops by 4 Nov', money(M.owed14)], ['Repayments due', money(M.dueMembers)], ['Borrows on 4 Nov', money(M.short)], ['Moves by', 'Two people · Ops Safe']],
        ap: [['Covers', money(M.unsecured) + ' unsecured'], ['RTD', `${(M.rtd * 100).toFixed(1)}% · floor 20%`], ['Room to issue', money(M.room)], ['Losses absorbed', money(M.lost)]],
        ops: [['Bank', 'Business checking'], ['Last sync', '3 h ago · Plaid'], ['Set aside inside it', money(ASIDE.reduce((a, x) => a + x[1], 0))], ['Free to spend', money(freeCash())]],
        bv: [['Owed to bondholders', money(M.bonds) + ' · 6 bonds'], ['Kept back', money(Math.min(M.bv || 0, BV_NEED())) + ' of ' + money(BV_NEED())], ['The Safe can take', money(Math.max(0, (M.bv || 0) - BV_NEED()))], ['First maturity', '14 Dec · BB-0001 · ' + money(2500)], ['Moves by', 'Two people · Ops Safe']],
        coop: [['Added in October', money(COOP_W.slice(3).reduce((a, b) => a + b, 0))], ['From', 'Member discounts at partner shops'], ['Spending it', 'Needs a member vote']]
      }[id];
      const pts = wk.map((v, i) => `${(i / (wk.length - 1) * 100).toFixed(1)},${(38 - v / mx * 34).toFixed(1)}`).join(' L');
      const act = {
        bv: <button className="btn p" data-npropose="bondvault">Propose using the spare</button>,
        ops: <button className="btn p" data-npropose="bill">Propose a move from here</button>,
        pay: <button className="btn p" data-npropose="topup">Propose a top-up</button>,
        sav: <button className="btn" data-nreserve="">Run the reserve check</button>,
        yld: <button className="btn" data-npool="yield">Yield pool →</button>,
        ap: <button className="btn" data-npool="ap">AssurancePool →</button>,
        coop: <button className="btn" data-ngo="governance">Propose a use · Governance</button>
      }[id];
      return <><div className="pn-hd"><span className="lbl">{GROUPS[g][0]}</span><span className={`nsrc ${SRC[src][2] || ''}`}><i />{srcTxt(src)}</span><button className="x" data-nclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div><p className="npn-t">{n}</p><p className="npn-s">{why}</p></div><div><div className="m-big">{money(bal)}</div><svg className="npn-ch" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d={`M${pts} L100,40 L0,40 Z`} className="ar" style={css(`fill:color-mix(in srgb,${col} 18%,transparent)`)} /><path d={`M${pts}`} className="ln" style={css(`stroke:${col}`)} /></svg><div className="npn-ax"><span>{NW[0]}</span><span>{NW[NW.length - 1]}</span></div></div><div>{lbl('Facts')}<div className="led">{facts.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div></div><div className="pn-ft">{CAN() || !/propose/.test(act) ? act : <span className="small quiet">Read-only for you</span>}</div></>;
    }
    function proposePanel(P) {
      const K = KINDS[P.kind],
        amt = P.amt ?? K.amt(),
        to = P.kind === 'bill' ? P.payee || '' : PLACES[K.to],
        fromBal = K.from === 'bv' ? M.bv : M.cash;
      const approvers = Object.entries(PPL).filter(([k, p]) => p.sign && k !== N.me);
      return <><div className="pn-hd"><span className="lbl">New move</span><button className="x" data-nclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><p className="npn-t">Propose a move</p><div className="npk">{Object.entries(KINDS).map(([k, x], __k) => <button key={__k} data-nkind={k} aria-pressed={P.kind === k}><b>{x.t}</b><span>{PLACES[x.from]}{" → "}{k === 'bill' ? 'a payee' : PLACES[x.to]}</span></button>)}</div><div className="npf">{P.kind === 'bill' ? <label>{lbl('Pay who')}<input id="npayee" className="vin" defaultValue={(P.payee || '').replace(/"/g, '&quot;')} placeholder="CDTFA · sales tax" /></label> : ''}<label>{lbl('Amount')}<input id="namt" className="vin" inputMode="decimal" defaultValue={amt ? amt.toFixed(2) : ''} placeholder="0.00" /></label><label>{lbl('Why')}<textarea id="nwhy" className="vin" rows="2" placeholder="What it’s for" defaultValue={P.why ?? K.why} /></label><label>{lbl('Second person')}<select id="nappr" className="vin" defaultValue={P.appr || 'dana'}>{approvers.map(([k, p], __k) => <option key={__k} value={k}>{p.n}{" · "}{p.role}</option>)}</select></label></div><div>{lbl('After it')}<div className="led"><div><span>{PLACES[K.from]}</span><b>{money(fromBal)}{" → "}<span id="nafter">{money(fromBal - (amt || 0))}</span></b></div>{P.kind === 'topup' ? <div><span>Payout pool on 4 Nov</span><b>No borrowing from the yield pool</b></div> : P.kind === 'bondvault' ? <><div><span>Still kept for bondholders</span><b>{money(BV_NEED())}</b></div><div><span>Payout pool on 4 Nov</span><b>No borrowing from the yield pool</b></div></> : ''}{K.from === 'ops' ? <div><span>Free to spend</span><b>{money(freeCash() - (amt || 0))}</b></div> : ''}</div></div><p className="npn-n"><b>Two people.</b>{" You propose it, the second person signs it in the Ops Safe. Nothing moves until they do."}</p></div><div className="pn-ft"><button className="btn" data-nclose="">Cancel</button><button className="btn p" data-nsubmit="">Propose it</button></div></>;
    }
    function reviewPanel(id) {
      const m = N.moves.find(x => x.id === id);
      if (!m) return '';
      const after = m.from === 'ops' ? M.cash - m.amt : null;
      return <><div className="pn-hd"><span className="lbl">Needs your signature</span><button className="x" data-nclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div><p className="npn-t">{m.t}</p><p className="npn-s">{PPL[m.by].n}{" proposed it "}{rel(m.d)}{m.due != null ? ' · due ' + dayD(m.due) : ''}</p></div><div className="m-big">{money(m.amt)}</div><div className="led">{[['From', PLACES[m.from] || m.from], ['To', m.to], ['Why', m.why], ...(after != null ? [['Operating cash after', `${money(after)}`], ['Free to spend after', money(freeCash() - m.amt)]] : []), ...(m.from === 'bv' ? [['BondVault after', money(M.bv - m.amt)], ['Still kept for bondholders', money(BV_NEED())]] : []), ['Signs in', 'Ops Safe · 2 of 3']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{N.rej ? <label>{lbl('Why not')}<textarea id="nrej" className="vin" rows="2" placeholder={`Tell ${PPL[m.by].f} why`} /></label> : ''}<p className="npn-n">Approving signs it as the second person. It goes out at once and is logged in Records.</p></div><div className="pn-ft">{N.rej ? <><button className="btn" data-nrejcancel="">Back</button><button className="btn dz" data-nreject={m.id}>Send it back</button></> : <><button className="btn" data-nrejopen="">Reject</button><button className="btn p" data-napprove={m.id}>Approve and sign</button></>}</div></>;
    }

    /* ══ render + events ══════════════════════════════════════════════════════════════ */
    function sync() {
      const k = meKey();
      if (k !== N.me) {
        N.me = k;
        N.panel = null;
      }
      if (S.payoutDone && N.moves.some(m => m.id === 'mv-rosa')) {
        N.moves = N.moves.filter(m => m.id !== 'mv-rosa');
        N.done.unshift({
          d: 0,
          t: 'Rosa’s Panadería · NET-14 payout',
          from: 'Payout pool',
          to: 'Rosa’s Panadería',
          amt: 412.60,
          by: 'dana',
          ok: 'kai',
          tx: '0x41c8…e3a0'
        });
      }
    }
    function render() {
      if (!LIVE()) return;
      sync();
      W.classList.toggle('tot', TOT());
      document.querySelectorAll('.gtabs [data-ntab]').forEach(b => b.setAttribute('aria-current', b.dataset.ntab === N.tab ? 'page' : 'false'));
      document.getElementById('nw').classList.toggle('ro', !CAN());
      renderHdr();
      ({
        overview: renderOverview,
        cash: renderCash,
        credit: renderCredit,
        pools: renderPools,
        moves: renderMoves
      })[N.tab]();
      renderPanel();
      if (TOT()) CC.scrub(W);
      setHash();
    }
    const logIt = (what, detail, res) => {
      try {
        LOG.unshift(['n' + Date.now(), Date.UTC(2026, 9, 21, 14, 30), PPL[N.me].code, 'money', what, detail, 'Mac · Redlands', res, res === 'approved' ? 'Second signature' : 'Needs a second person']);
      } catch (e) {}
    };
    const closeN = () => {
      N.panel = null;
      N.rej = false;
    };
    document.addEventListener('click', e => {
      if (e.target.id === 'nscrim') {
        closeN();
        return render();
      }
      const t = e.target.closest('button,a,select,input');
      if (!t) return;
      const d = t.dataset;
      if (d.ntab) {
        N.tab = d.ntab;
        if (d.npool) N.pool = d.npool;
        closeN();
        render();
        if (d.njump) {
          const el = document.getElementById(d.njump);
          el && el.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        } else window.scrollTo({
          top: 0
        });
        return;
      }
      if (d.npool) {
        N.pool = d.npool;
        N.dp = 0;
        if (N.tab !== 'pools') {
          N.tab = 'pools';
          closeN();
          window.scrollTo({
            top: 0
          });
        }
        render();
        return;
      }
      if (d.nacct) {
        N.panel = {
          acct: d.nacct
        };
        return render();
      }
      if (d.nclose !== undefined) {
        closeN();
        return render();
      }
      if (d.npropose) {
        if (!CAN()) return toast('Only Ops Safe signers can propose a move');
        N.panel = {
          propose: true,
          kind: d.npropose
        };
        return render();
      }
      if (d.nkind) {
        const P = N.panel;
        P.kind = d.nkind;
        P.amt = null;
        P.why = null;
        return render();
      }
      if (d.nsubmit !== undefined) {
        const P = N.panel,
          K = KINDS[P.kind],
          amt = parseFloat((document.getElementById('namt').value || '').replace(/[^0-9.]/g, '')) || 0,
          appr = document.getElementById('nappr').value;
        const payee = P.kind === 'bill' ? document.getElementById('npayee').value.trim() || 'A payee' : PLACES[K.to];
        if (!amt) return toast('Add an amount');
        if (K.from === 'bv' && amt > M.bv - BV_NEED()) return toast(`BondVault can release up to ${money(Math.max(0, M.bv - BV_NEED()))}`);
        N.moves.unshift({
          id: 'mv-' + Date.now(),
          kind: P.kind,
          t: P.kind === 'bill' ? `Pay ${payee}` : K.t,
          from: K.from,
          to: payee,
          amt,
          by: N.me,
          d: 0,
          why: document.getElementById('nwhy').value.trim() || '—',
          st: 'waiting',
          wait: appr
        });
        logIt(`Proposed “${N.moves[0].t}”`, `${money(amt)} from ${PLACES[K.from]}. Waiting on ${PPL[appr].n}.`, 'waiting');
        closeN();
        N.tab = 'moves';
        render();
        return toast(`Proposed · waiting on ${PPL[appr].f} · logged in Records`);
      }
      if (d.nopen) {
        N.panel = {
          review: d.nopen
        };
        N.rej = false;
        return render();
      }
      if (d.nrejopen !== undefined) {
        N.rej = true;
        return render();
      }
      if (d.nrejcancel !== undefined) {
        N.rej = false;
        return render();
      }
      if (d.napprove) {
        const m = N.moves.find(x => x.id === d.napprove);
        N.moves = N.moves.filter(x => x !== m);
        if (m.from === 'bv') {
          M.bv -= m.amt;
          const v = acctOf('bv');
          v[5] = M.bv;
          v[6][v[6].length - 1] = M.bv;
          M.payout += m.amt;
          const p = acctOf('pay');
          p[5] = M.payout;
          p[6][p[6].length - 1] = M.payout;
        }
        if (m.from === 'ops') {
          M.cash -= m.amt;
          const a = acctOf('ops');
          a[5] = M.cash;
          a[6][a[6].length - 1] = M.cash;
          if (m.kind === 'bondvault') {
            M.bv = (M.bv || 0) + m.amt;
            const v = acctOf('bv');
            v[5] = M.bv;
            v[6][v[6].length - 1] = M.bv;
          }
          if (m.kind === 'topup') {
            M.payout += m.amt;
            const p = acctOf('pay');
            p[5] = M.payout;
            p[6][p[6].length - 1] = M.payout;
          }
        }
        N.done.unshift({
          d: 0,
          t: m.t,
          from: PLACES[m.from] || m.from,
          to: m.to,
          amt: m.amt,
          by: m.by,
          ok: N.me,
          tx: '0x' + Math.random().toString(16).slice(2, 6) + '…' + Math.random().toString(16).slice(2, 6)
        });
        M.short = Math.max(0, M.owed14 - M.payout - M.dueMembers);
        Y.toPayout = Math.min(M.short, Y.cash);
        logIt(`Signed “${m.t}”`, `${money(m.amt)}. ${PPL[m.by].n} proposed.`, 'approved');
        closeN();
        render();
        return toast(`Signed · ${money(m.amt)} sent · logged in Records`);
      }
      if (d.nreject) {
        const m = N.moves.find(x => x.id === d.nreject),
          why = (document.getElementById('nrej') || {}).value || 'No reason given';
        N.moves = N.moves.filter(x => x !== m);
        N.done.unshift({
          d: 0,
          t: `Rejected · ${m.t.toLowerCase()}`,
          from: PLACES[m.from] || m.from,
          to: m.to,
          amt: m.amt,
          by: m.by,
          no: N.me,
          why,
          tx: null
        });
        logIt(`Sent back “${m.t}”`, `${money(m.amt)} · ${why}`, 'done');
        closeN();
        render();
        return toast(`Sent back to ${PPL[m.by].f}`);
      }
      if (d.nrosa !== undefined) {
        if (S.waiting.some(w => w.id === 'payout') && CAN()) return openItem('payout');
        return goOut('merchants/payouts');
      }
      if (d.nwithdraw) {
        N.moves = N.moves.filter(x => x.id !== d.nwithdraw);
        render();
        return toast('Taken back · logged');
      }
      if (d.nmf) {
        N.mf = d.nmf;
        N.mp = 0;
        return render();
      }
      if (d.nmp) {
        N.mp += +d.nmp;
        return render();
      }
      if (d.ndp) {
        N.dp += +d.ndp;
        return render();
      }
      if (d.nsync !== undefined) {
        toast('Syncing from Plaid…');
        setTimeout(() => {
          SRC.plaid = ['Plaid', 'just now'];
          render();
          toast('Operating cash is current');
        }, 900);
        return;
      }
      if (d.nreserve !== undefined) return toast('Fully reserved · 1 : 1, checked just now');
      if (d.ngo) return goOut(d.ngo);
    });
    document.addEventListener('input', e => {
      if (e.target.id === 'namt') {
        const v = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0,
          el = document.getElementById('nafter');
        if (el) el.textContent = money((N.panel && KINDS[N.panel.kind] && KINDS[N.panel.kind].from === 'bv' ? M.bv : M.cash) - v);
        N.panel.amt = v;
      }
      if (e.target.id === 'npayee') N.panel.payee = e.target.value;
      if (e.target.id === 'nwhy') N.panel.why = e.target.value;
    });
    document.addEventListener('keydown', e => {
      if (!LIVE()) return;
      if (e.key === 'Escape' && N.panel && !document.querySelector('.modal')) {
        closeN();
        render();
      }
    });
    N.moves = MOVES.slice();
    N.done = DONE.slice();
    return {
      render,
      tab: () => N.tab,
      setTab(t, pool) {
        N.tab = t;
        if (pool) {
          N.pool = pool;
          N.dp = 0;
        }
        closeN();
      },
      close() {
        closeN();
      }
    };
  })(DOCP);
  // p: a tab or an old pane name; pools:<ap|pay|yield|bonds> opens that pool
  function setTab(p) {
    if (!p) return;
    const [k, x] = String(p).split(':'),
      m = MAP[k];
    if (!m) return;
    API.setTab(m[0], x || m[1]);
  }
  function mount() {
    // the slot is the shell's: the host goes inside it
    if (!into('n-slot')) return;
    API.render();
  }
  function unmount() {
    if (host.isConnected) return;
    API.close();
    W.classList.remove('pn');
  }
  return {
    mount,
    unmount,
    setTab: (_r, sub) => setTab(sub),
    tab: () => API.tab(),
    host
  };
}
registerPage(['money'], 'n-slot', makeMoney);
