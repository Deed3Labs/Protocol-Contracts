// @ts-nocheck: ported from the redesign's MONEY2 module (design/command-center-ui) with scripts/port/module.cjs; its data is its own.
import { LiquidationHolds } from './liquidationHolds';
import { Fragment } from 'react';
import { attrs, css, hasHtml, html } from '../runtime/dom';
import { run } from '../live/actions';
import { api } from '../live/api';
import { REAL } from '../live/env';
import { CC } from './cc';
import { LOG, S, vars } from './data';
import { moneyLive, settleMove } from './moneyLive';
import { demoTopUps, topUpsParts } from './payoutTopUps';
import { PoolTierPrincipal } from './settlementFunding';
import { demoSettle, settleCard, settleNeed, settleSlim, settleTile } from './settleCard';
import { keep, registerPage, shadowHost } from './pageHost';
import { openItem, render as renderShell, toast, vLevel } from './shell';

/*
 * Money (design/command-center-ui, the MONEY2 module): one question per tab (Overview: is everything
 * covered; Cash flow: the next 30 days; Credit: the book; Pools: AssurancePool, Payout, Yield, Bonds;
 * Moves: propose, approve, history). It lives in its own shadow root (pageHost.tsx). As the reference has
 * it, the module's code runs against a stand-in `document` (DOCP) that reads inside the shadow root, so
 * its lookups and its click/input listeners stay on the page. Links out go through CC.go.
 */

/** Hands the person a JSON file (a Safe Transaction Builder batch) to load in the Safe app. */
function saveJson(obj, name) {
  const a = window.document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** The page's skeleton: the reference template's markup. */
function skeleton() {
  return <div className="gw nw" id="nw"><div className="hdr stack" id="hdr" /><nav className="gtabs" aria-label="Money views"><button data-ntab="overview">Overview</button><button data-ntab="cash">Cash flow</button><button data-ntab="credit">Credit</button><button data-ntab="pools">Pools</button><button data-ntab="moves">Moves</button></nav><div id="nv" /></div>;
}
function makeMoney() {
  const { host, R: SR, W, into } = shadowHost('money', skeleton());
  const L = REAL ? moneyLive() : null;
  const LIVE = () => host.isConnected && CC.route() === 'money';
  const RO = () => CC.viewing() && vLevel('money') < 3;
  const TOT = () => CC.viewing() && vLevel('money') === 1;
  const meKey = () => {
    // live, the signed-in person (the prototype's view picks one of its demo people)
    if (L) return L.me();
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
    const TODAY = L ? L.TODAY : Date.UTC(2026, 9, 21),
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
    const M = L ? L.M : {
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
    /* the Yield Pool (LendingPool, ERC-4626): deploys only to Clear Lending's lending account, by two signers, and earns Pool Interest on the Deployed Balance.
       It stands behind the whole credit book, fifth in the loss order (IV-02 5.1). */
    const Y = L ? L.Y : {
      assets: 9000.00,
      principal: 8962.10,
      lent: M.unsecured,
      depositors: 18,
      pledged: 1200.00,
      queued: 0,
      opened: '15 Oct',
      cycleDays: 30,
      curve: {
        r0: 0.02,
        s1: 0.03,
        k: 0.80,
        s2: 0.05
      }
    }; /* the deployed rate model: LendingPool.rateModel(), annual */
    // live, the API works these out (the rates are the contract's own reads): the reference's formulas only run on its figures
    if (!L) {
    Y.accrued = 14.62; /* Pool Interest owed since Clear Lending's last Return, accruing per second */
    Y.cash = Y.assets - Y.lent - Y.accrued;
    Y.util = Y.lent / Y.assets;
    Y.earned = Y.assets - Y.principal;
    Y.price = Y.assets / Y.principal;
    }
    /* Funding Rate (annual, YieldPoolLedger._rate): r0 + s1·u/k up to the kink, then + s2·(u−k)/(1−k). Returned in annual basis points.
       Live it's never worked out here: the API reads fundingRateAt(u) for each utilization the page draws (Y.rateAt, by basis points). */
    const yBorrowBps = u => {
      if (L) return Y.rateAt ? Y.rateAt[Math.round(Math.min(1, u) * 1e4)] ?? null : null;
      const c = Y.curve,
        x = Math.min(1, u);
      return 1e4 * (x <= c.k ? c.r0 + c.s1 * x / c.k : c.r0 + c.s1 + c.s2 * (x - c.k) / (1 - c.k));
    };
    const yApr = bps => bps / 10000;
    const yApy = bps => bps / 10000; /* holder yield ≈ Funding Rate × Utilization, before losses (IV-02 Schedule 2 §3) */
    if (!L) {
    Y.borrowBps = yBorrowBps(Y.util);
    Y.supplyBps = Y.borrowBps * Y.util;
    Y.apy = yApy(Y.supplyBps);
    Y.apr = yApr(Y.borrowBps);
    /* the AssurancePool: the co-op's, two compartments. The Credit Backstop pays Clear Lending's charged-off principal under I-11, up to the coverage cap posted each month;
       Member Assurance funds members' Assurance grants. Clear Lending's own Spread, Loss Reserve and capital come first. */
    M.apBack = 1120.00;
    M.apMem = M.assurance - M.apBack;
    M.cap = 10000;
    M.cover = Math.min(M.apBack, M.cap);
    M.drawn = 0;
    M.lr = 1850.00;
    M.spread = 312.40;
    M.resid = 5000.00;
    M.memberCash = 6240.18;
    M.clOp = 2723.16;
    M.clSettle = 2000.00;
    M.clSettlePeak = 1240.00;
    M.treasury = 1963.30;
    /* the payout pool: Clear Lending funds each financed charge by its Funding Deadline, two business days before the claim is due (I-09). Member repayments reach the pool first (ClearCredit pays it what it is owed, the rest goes to Clear Lending); short is what Clear Lending still owes by Mon 2 Nov.
       The payout funding keeper (apps/api jobs/payoutFundingKeeper.ts) reads this hourly: RED if a deadline is breached, AMBER if the payable balance is under what's due within 30 days (decision 49). */
    M.due30 = 13980.05;
    M.standShort = Math.max(0, M.due30 - M.payout);
    Y.headroom = Math.max(0, (Y.lent + Y.cash) * 0.9 - Y.lent);
    M.treasuryAllow = 0;
    M.short = Math.max(0, M.owed14 - M.payout - M.dueMembers);
    Y.toPayout = Math.min(M.short, Y.cash);
    Y.utilAfter = (Y.lent + Y.toPayout) / Y.assets;
    Y.apyAfter = yApy(yBorrowBps(Y.utilAfter) * Y.utilAfter);
    }

    /* weekly history, 8 Sep → 20 Oct */
    const NW = L ? L.NW : ['8 Sep', '15 Sep', '22 Sep', '29 Sep', '6 Oct', '13 Oct', '20 Oct'];
    const AP_BAL = L ? L.AP_BAL : [0, 400, 520, 690, 860, 1110, M.assurance],
      UNSEC = L ? L.UNSEC : [0, 900, 2050, 3450, 4400, 5100, M.unsecured];
    const COOP_W = L ? L.COOP_W : [22.40, 39.40, 78.40, 109.20, 126.80, 100.00];

    /* the next 30 days, day 0 = 21 Oct: [day, in|out, amount, what, detail, from|to] */
    const FLOWS = L ? L.FLOWS : [[1, 'out', 412.60, 'Rosa’s Panadería', 'NET-14 payout'], [3, 'in', 592.94, 'Member repayments', 'Autopay · the ledger pays the pool first'], [9, 'in', 889.42, 'Member repayments', 'Autopay · the ledger pays the pool first'], [9, 'in', 3840.05, 'Automatic top-up', 'From CL Operating, once the Deployment lands'], [12, 'out', 9510.65, 'Monthly run', '11 shops · NET-30'], [14, 'out', 732.00, 'Arrowhead Nails', 'NET-14 payout'], [14, 'out', 2184.00, 'Cajon Phone Repair', 'NET-14 payout'], [16, 'in', 2310.20, 'Member repayments', 'Autopay · the ledger pays the pool first'], [28, 'out', 1140.80, 'NET-14 shops', 'Next NET-14 round · estimate']];
    const BONDS = L ? L.BONDS : [/* id, face, issued, matures, months to maturity from today, term in months, internal rate, holder */
    ['BB-0001', 2500, '14 Aug', '14 Dec', 54, 4, 6.0, 'Member'], ['BB-0002', 5000, '21 Aug', '21 Jan', 92, 5, 6.5, 'Founding lender'], ['BB-0003', 2500, '2 Sep', '2 Mar', 132, 6, 7.0, 'Member'], ['BB-0004', 2500, '9 Sep', '9 Mar', 139, 6, 7.0, 'Member'], ['BB-0005', 7500, '1 Oct', '1 Jun', 223, 8, 7.5, 'Founding lender'], ['BB-0006', 5000, '15 Oct', '15 Sep', 329, 11, 8.0, 'Member']];
    /* every account, in the order the bar draws them: whose money it is decides the bracket */
    const ACCTS = L ? L.ACCTS : [/* id, name, what it's for, group, source, balance, 7 weeks, colour */
    ['sav', 'Member savings', 'CLRUSD, backed 1:1 by USDC in the ESA vault', 'members', 'protocol', M.savings, [0, 2100, 6400, 13900, 22800, 31200, M.savings], 'var(--fg)'], ['cash', 'Member cash', 'Spendable at the Bank Partner, through Lithic · the card spends it', 'members', 'lithic', M.memberCash, [0, 1180, 2460, 3520, 4310, 5390, M.memberCash], 'color-mix(in srgb,var(--fg) 72%,transparent)'], ['yld', 'Yield pool', 'Members’ deposits not lent out yet', 'members', 'protocol', Y.cash, [0, 0, 0, 0, 0, 2180, Y.cash], 'color-mix(in srgb,var(--live) 60%,transparent)'], ['pay', 'Payout pool', 'Pays shops for financed sales, deadline first', 'set', 'protocol', M.payout, [0, 1200, 3900, 5200, 7800, 9600, M.payout], 'color-mix(in srgb,var(--fg) 45%,transparent)'], ['ap', 'AssurancePool', 'The co-op’s · Credit Backstop and Member Assurance', 'set', 'protocol', M.assurance, AP_BAL, 'var(--underway)'], ['bv', 'BondVault', 'Bond buyers’ money · paid back at maturity', 'set', 'protocol', M.bv, [10000, 12500, 12500, 12500, 20000, 20000, M.bv], 'color-mix(in srgb,var(--fg) 28%,transparent)'], ['ops', 'Operating cash', 'Business checking · the co-op’s own money', 'coop', 'plaid', M.cash, [16800, 17900, 18600, 19800, 20400, 21100, M.cash], 'var(--land)'], ['trs', 'Clear Treasury Safe', 'USDC on chain · pays the co-op’s interchange share into the AssurancePool', 'coop', 'protocol', M.treasury, [0, 0, 480, 960, 1420, 1780, M.treasury], 'color-mix(in srgb,var(--land) 70%,transparent)'], ['coop', 'Co-op balance', 'Discounts on member purchases, held for a vote', 'coop', 'protocol', M.coop, [0, 22.40, 61.80, 140.20, 249.40, 376.20, M.coop], 'color-mix(in srgb,var(--land) 45%,transparent)'], ['clop', 'CL Operating', 'Safe · Deployments land here; top-ups and fees leave from here', 'cl', 'protocol', M.clOp, [0, 0, 0, 0, 0, 1220.00, M.clOp], 'color-mix(in srgb,var(--land) 60%,var(--fg) 25%)'], ['clset', 'Credit Settlement Account', 'At the Bank Partner · funded before each daily card cut-off', 'cl', 'lithic', M.clSettle, [0, 0, 0, 1500, 2000, 2000, M.clSettle], 'color-mix(in srgb,var(--land) 40%,var(--fg) 15%)'], ['cllr', 'CL Loss Reserve', 'Safe · takes credit losses right after the Spread', 'cl', 'protocol', M.lr, [0, 0, 500, 900, 1300, 1600, M.lr], 'color-mix(in srgb,var(--fg) 58%,transparent)'], ['clfee', 'CL Fees wallet', 'CDP · pays the Assurance fee into the pool, once funded', 'cl', 'protocol', 0, [0, 0, 0, 0, 0, 0, 0], 'color-mix(in srgb,var(--underway) 45%,transparent)']];
    const GROUPS = {
      members: ['Members’ money', 'Owed back to members on request'],
      set: ['Set aside', 'Only for shops, losses and bondholders'],
      coop: ['The co-op’s', 'Ours to run on'],
      cl: ['Clear Lending’s', 'A separate company · it lends to members']
    };
    const ASIDE = L ? L.ASIDE : [['Sales tax held', 351.58, 'Shop · paid with the quarterly return'], ['Pre-order deposits', 460.00, 'Hardware · refundable until made']];
    const SRC = L ? L.SRC : {
      protocol: ['Protocol', '12 s'],
      bridge: ['Bridge', '2 min'],
      plaid: ['Plaid', '3 h', 'late'],
      lithic: ['Lithic', '1 min']
    };
    const srcTxt = k => SRC[k][0] + ' · ' + SRC[k][1];
    const acctOf = id => ACCTS.find(a => a[0] === id);

    /* credit, October */
    const CR = L ? L.CR : {
      start: 7040.00,
      spent: 19825.70,
      aging: [['Current', 12480.20], ['1–30 days', 1310.40], ['31–60 days', 421.80], ['Over 60', 0]],
      losses: [[-29, 'Redlands Tire & Lube', 'tire', 204], [-15, 'Citrus Bowl Café', 'citrus', 204], [-7, 'Cajon Phone Repair', 'phone', 204]],
      limits: [['$100', 38], ['$250', 46], ['$500', 28], ['$1,000+', 12]],
      shops: [['Redlands Tire & Lube', 7940.00, 1], ['Cajon Phone Repair', 3120.00, 1], ['Highland Hardware', 2310.40, 0], ['Rosa’s Panadería', 1284.40, 0], ['Arrowhead Nails', 1036.00, 0], ['Mesa Laundry', 968.10, 0], ['6 more shops', 3166.80, 0]]
    };
    // live, repaid is the chain's own count (carry is added on top of spending); the reference works it out
    CR.repaid = L && L.creditReal ? CR.repaid : CR.start + CR.spent - M.credit;
    CR.sched = FLOWS.filter(f => f[1] === 'in' && f[0] <= 9).reduce((a, f) => a + f[2], 0);
    CR.due = CR.repaid + CR.sched;

    /* depositors, masked; earned split pro rata so rows reconcile to the pool */
    const Y_DEP = L ? L.Y_DEP : [['4f', 1500, '15 Oct', 600], ['a2', 1000, '15 Oct', 400], ['c9', 1000, '15 Oct', 0], ['17', 750, '15 Oct', 0], ['e0', 600, '15 Oct', 200], ['5b', 500, '15 Oct', 0], ['9d', 500, '15 Oct', 0], ['b3', 500, '20 Oct', 0], ['61', 400, '15 Oct', 0], ['2e', 350, '15 Oct', 0], ['d8', 300, '15 Oct', 0], ['7a', 300, '15 Oct', 0], ['f4', 250, '15 Oct', 0], ['0c', 250, '20 Oct', 0], ['8b', 200, '15 Oct', 0], ['3f', 200, '15 Oct', 0], ['c1', 200, '20 Oct', 0], ['6e', 200, '20 Oct', 0]].map(([id, w, since, pl]) => {
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
    const PPL = L ? L.PPL : {
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
    const MOVES = L ? L.MOVES : [{
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
      t: 'Deploy to Clear Lending',
      from: 'yld',
      to: 'CL Operating',
      amt: 1116.89,
      by: 'kai',
      d: 0,
      why: 'Clear Lending funds the 4 Nov payouts by Mon 2 Nov. The top-up job found CL Operating short of its refill, so two Deployment signers move this from the pool’s cash.',
      due: 9,
      st: 'waiting',
      wait: 'dana'
    }, {
      id: 'mv-rosa',
      kind: 'payout',
      t: 'Release Rosa’s held payout',
      from: 'pay',
      to: 'Rosa’s Panadería',
      amt: 412.60,
      by: 'dana',
      d: -1,
      why: 'Held for a customer dispute that closed 20 Oct in her favour. Releasing a hold needs a second person; the queue then pays it in its turn.',
      due: 1,
      st: 'merchants'
    }];
    /* live, Done's "Automatic": what the payout top-up job moved on its own (its record: each top-up, its trigger and its
       last transaction), beside the moves people approved */
    const AUTO_WHY = {
      'low-water': 'The 14-day low-water mark',
      overdue: 'Claims overdue',
      'wallet-balance': 'The remainder from CL Operating'
    };
    function autoDone() {
      const T = vars.payoutTopUps;
      if (!T) return [];
      const short = h => h ? `${h.slice(0, 6)}…${h.slice(-4)}` : null;
      return T.recent.filter(r => r.status === 'funded').map(r => ({
        d: Math.round((r.at - TODAY) / DAY),
        t: `Payout top-up #${r.id}`,
        from: 'CL Operating',
        to: 'Payout pool',
        amt: r.amount,
        auto: `${AUTO_WHY[r.trigger] ?? r.trigger} · the top-up job`,
        tx: short(r.txs.at(-1)?.[1])
      })).filter(x => x.d >= -30);
    }
    const DONE = L ? L.DONE : [{
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
      from: 'CL Loss Reserve',
      to: 'Credit ledger',
      amt: 204.00,
      auto: 'Charged off at 90 days · the Spread, then the Loss Reserve',
      tx: '0x77d0…0e3c'
    }, {
      d: -8,
      t: 'Yield Pool Deployment',
      from: 'Yield pool',
      to: 'CL Operating',
      amt: 2600.00,
      by: 'dana',
      ok: 'kai',
      tx: '0x3a92…c1f7'
    }, {
      d: -15,
      t: 'Loss absorbed · Citrus Bowl Café',
      from: 'CL Loss Reserve',
      to: 'Credit ledger',
      amt: 204.00,
      auto: 'Charged off at 90 days · the Spread, then the Loss Reserve',
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
      t: 'Yield Pool Deployment',
      from: 'Yield pool',
      to: 'CL Operating',
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
      from: 'CL Loss Reserve',
      to: 'Credit ledger',
      amt: 204.00,
      auto: 'Charged off at 90 days · the Spread, then the Loss Reserve',
      tx: '0x60fd…e2a1'
    }, {
      d: -30,
      t: 'Yield Pool Deployment',
      from: 'Yield pool',
      to: 'CL Operating',
      amt: 2500.00,
      by: 'dana',
      ok: 'kai',
      tx: '0x91b4…5c0e'
    }];
    /* card settlement (decision 54): live, the funding desk's last check with the API's verdict; the demo, the reference's
       "now" (Wed 21 Oct 16:04) in its Covered state */
    const SF_NOW = () => L ? Date.now() : new Date(2026, 9, 21, 16, 4).getTime();
    const SETL = () => L ? vars.settlementFunding ?? null : demoSettle(SF_NOW(), 'covered');
    const SH = () => ({
      cell,
      lbl,
      can: CAN()
    });
    const SETTLE_KINDS = {
      csabook: {
        t: 'Book repayments to the settlement account',
        from: 'col',
        to: 'csa',
        card: 'settlement-book',
        amt: () => {
          const S = SETL(),
            V = S?.verdict;
          return V ? Math.min(S.netting.collection ?? 0, Math.max(V.gapBuffer, 0) || S.netting.collection || 0) : 0;
        },
        why: 'Members’ repayments already at the bank cover the next card cut-off. A book transfer between Clear Lending’s two accounts at the Bank Partner: instant, and it can run until 15 minutes before the cut-off.'
      },
      csadeploy: {
        t: 'Fund the card settlement from the pool',
        from: 'yld',
        to: 'csa',
        card: 'settlement-deploy',
        amt: () => {
          const S = SETL(),
            V = S?.verdict;
          return V ? Math.min(V.gapBuffer, Math.max(0, S.lane.poolRoom - V.willMove.lane)) : 0;
        },
        why: 'More than the settlement lane allows this week. Two Deployment signers send it from the pool to CL Operating, and the off-ramp takes it to the settlement account. It must leave by the fund-by time to arrive before the cut-off.'
      },
      csamargin: {
        t: 'Advance the Savings-Backed Margin',
        from: 'sbm',
        to: 'csa',
        card: 'settlement-margin',
        amt: () => {
          const V = SETL()?.verdict;
          return V ? V.gapDue || V.gapBuffer : 0;
        },
        why: 'Last resort for this cut-off. The Margin settles the swipes until Settlement Funding or members’ repayments replace it, within two business days (L-01 8.4).'
      },
      csarestart: {
        t: 'Restart the settlement funding desk',
        from: 'yld',
        to: 'lane',
        card: 'settlement-restart',
        amt: () => 0,
        why: 'A stop takes one person; a restart takes two. It clears the desk’s halt, and when the lane is stopped on chain both Deployment signers send setSettlementFunder. Clear the cause first.'
      }
    };
    /* what someone can propose */
    // live, a top-up is the only move the API can propose (money/top: the Ops Safe funds the PayoutPool)
    const KINDS = L ? {
      topup: {
        t: 'Top up the payout pool',
        from: 'safe',
        to: 'pay',
        amt: () => M.short,
        why: ''
      },
      ...SETTLE_KINDS
    } : {
      ...SETTLE_KINDS,
      topup: {
        t: 'Deploy to Clear Lending',
        from: 'yld',
        to: 'clop',
        amt: () => M.short,
        why: 'Clear Lending funds the 4 Nov payouts by their Funding Deadline, Mon 2 Nov. Two Deployment signers; it goes only to Clear Lending’s lending account.'
      },
      bondvault: {
        t: 'Withdraw BondVault’s excess',
        from: 'bv',
        to: 'clop',
        amt: () => Math.min(5000, Math.max(0, M.bv - BV_NEED())),
        why: 'Above the Redemption Reserve. It goes only to Clear Lending’s registered multisig, through the Collateral Agent.'
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
      ...(L ? {
        safe: 'The Ops Safe'
      } : {}),
      col: 'Collection Account',
      csa: 'Credit Settlement Account',
      sbm: 'Savings-Backed Margin',
      lane: 'The settlement lane',
      ops: 'Operating cash',
      pay: 'Payout pool',
      bv: 'BondVault',
      out: 'Someone outside the co-op',
      ap: 'AssurancePool',
      yld: 'Yield pool',
      clop: 'CL Operating · Clear Lending'
    };

    /* ══ Money — is everything covered, where it sits, and the moves that need two people ══════════════════════
       Tabs answer one question each: Overview (covered?), Cash flow (what moves in the next 30 days), Credit (the book),
       Pools (AssurancePool, Payout, Yield, Bonds), Moves (propose, approve, history). The two checks stay apart on purpose:
       The Credit Backstop stands behind Clear Lending’s own reserve; claims-in-order only reports and is never summed. */
    const N = keep('money.N', {
      tab: 'overview',
      pool: 'yield',
      panel: null,
      me: 'kai',
      dp: 0,
      mp: 0,
      mf: 'all',
      rej: false
    }, ['tab', 'pool', 'dp', 'mp', 'mf']);
    // live, proposing takes Propose in Money and approving takes Approve (the API checks both)
    const ME = () => PPL[N.me],
      CAN = () => L ? !RO() : !RO() && ME().sign,
      APPR = () => L ? CAN() && vLevel('money') >= 4 : CAN();
    const firstN = k => k === N.me ? 'You' : PPL[k].f;
    // who a move waits on: the reference names a signer; live, anyone else with Approve
    const waitOn = m => m.wait ? firstN(m.wait) : L ? 'a second person' : firstN('dana');
    const ICO = {
      chev: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>,
      back: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>,
      x: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
    };
    const cell = (cls, title, right, body, foot, id = '') => <div className={`cell ${cls}`} {...attrs(id ? ` id="${id}"` : '')}><div className="hd"><h2>{title}</h2><div className="r">{right}</div></div>{body}<div className="bk-ft">{foot}</div></div>;
    const lbl = t => <span className="lbl">{t}</span>;
    // live, a cell whose figures have no source yet says so, hatched, and what it needs (docs/ui-redesign-plan.md, gaps)
    const notReal = (cls, title, need, id = '') => cell(cls, title, lbl('Not real yet'), <><div className="bk-empty hatch" style={css("min-height:120px;opacity:.5")} /><div className="bk-empty">{need}</div></>, <span />, id);
    const NEED_FLOWS = 'Needs the next 30 days of payments in and out: shop payouts as they come due and member repayments on autopay.';
    const band = (cells, first) => <section className="band" {...attrs(first ? ' style="margin-top:0"' : '')}><div className="bento">{cells}</div></section>;
    const waiting = () => N.moves.filter(m => m.st === 'waiting'),
      pend = () => N.moves.filter(m => m.st === 'waiting' || m.st === 'merchants'),
      forMe = () => waiting().filter(m => m.by !== N.me && APPR() && (!m.wait || m.wait === N.me));
    const freeCash = () => M.cash - ASIDE.reduce((a, x) => a + x[1], 0);
    // live, the next 30 days' totals, worked out from the schedule's rows
    const OUT30 = FLOWS.filter(f => f[1] === 'out').reduce((a, f) => a + f[2], 0),
      IN30 = FLOWS.filter(f => f[1] === 'in').reduce((a, f) => a + f[2], 0);
    const pager = (p, n, per, key) => {
      const pages = Math.max(1, Math.ceil(n / per));
      return <span className="pg2"><span>{n ? p * per + 1 : 0}–{Math.min(n, (p + 1) * per)} of {n}</span><button {...{ [`data-${key}`]: '-1' }} disabled={p === 0} aria-label="Previous">{ICO.back}</button><button {...{ [`data-${key}`]: '1' }} disabled={p >= pages - 1} aria-label="Next">{ICO.chev}</button></span>;
    };

    /* ── the header: one sentence, then four vitals ─────────────────────────────────────── */
    function renderHdr() {
      const w = pend(),
        mine = forMe(),
        tier3 = M.bonds ? Math.min(1, M.bv / M.bonds) : 1;
      const B = {
        overview: <>{"Member savings, shops and bondholders are "}{tier3 >= 1 ? 'all' : 'mostly'}{" covered. "}{L ? M.short ? <>{"Clear Lending still owes "}{money(M.short)}{" of funding for the payouts due in the next 14 days"}{w.some(m => m.kind === 'topup') ? <>{", once "}<a data-ntab="moves">the Deployment</a>{" is signed"}</> : ''}.</> : 'Every payout due in the next 14 days is funded.' : w.some(m => m.kind === 'topup' || m.kind === 'bondvault') ? <>{"Clear Lending funds "}{money(M.short)}{" of the 4 Nov payouts by Mon 2 Nov, once "}<a data-ntab="moves">the Deployment</a>{" is signed."}</> : 'Every 4 Nov payout is funded.'}</>,
        cash: L && !L.flowsReal ? <>{"The next 30 days’ payments aren’t recorded yet. "}<span className="q">Shop payouts due and member repayments on autopay come once the schedule is read.</span></> : L ? <>{money(OUT30)}{" goes to shops in the next 30 days and "}{money(IN30)}{" comes in."}{M.short ? <>{" Clear Lending still owes "}<a data-ntab="cash" data-njump="ngap">{money(M.short)}</a>{" of funding for the next 14 days."}</> : ''}</> : <>{money(13980.05)}{" goes to shops in the next 30 days and "}{money(7632.61)}{" comes in. Clear Lending still owes "}<a data-ntab="cash" data-njump="ngap">{money(M.short)}</a>{" of funding by Mon 2 Nov."}</>,
        credit: L && L.creditReal ? M.credit ? `${money(M.credit)} is owed by ${CR.owing} ${CR.owing === 1 ? 'member' : 'members'}. ${pct(M.savingsBacked, M.credit, 0)} is backed by their own savings and ${pct(CR.aging[0][1], M.credit, 0)} is current.` : `No member owes anything right now. ${money(M.limits)} in limits is open to ${CR.limits.reduce((a, x) => a + x[1], 0)} ${CR.limits.reduce((a, x) => a + x[1], 0) === 1 ? 'member' : 'members'}.` : `${money(M.credit)} is owed by ${M.members} members. ${pct(M.savingsBacked, M.credit, 0)} is backed by their own savings${L ? '.' : ` and ${pct(CR.aging[0][1], M.credit, 0)} is current.`}`,
        pools: <>{"The yield pool has "}{pct(Y.lent, Y.assets, 0)}{" deployed to Clear Lending and pays "}{(Y.apy * 100).toFixed(2)}{"% a year. "}{M.cover != null ? <>{"The Credit Backstop can cover "}{money(M.cover)}{". "}</> : ''}<a data-npool="bonds">BondVault</a>{" holds "}{money(M.bv)}{" for "}{BONDS.length}{" bonds and keeps "}{money(BV_NEED())}{" of it back."}</>,
        moves: w.length ? <>{w.length === 1 ? 'One move waits' : `${['', 'One', 'Two', 'Three', 'Four', 'Five'][w.length] || w.length} moves wait`}{" for a second person."}{mine.length ? <>{" "}<a data-nopen={mine[0].id}>{mine[0].t}</a>{" needs you."}</> : ''}</> : 'Nothing is waiting for a second person.'
      }[N.tab];
      // the Credit Backstop behind Clear Lending's reserve: the reserve dark, what the backstop can still cover amber
      const lrv = M.lr ?? 0,
        cov = M.cover ?? 0,
        bk = lrv + cov || 1;
      const backstop = <div className="sc" data-npool="ap" data-ntab="pools"><span className="lbl">Credit backstop</span><div className="sc-v">{money(cov).replace(/\.\d+$/, '')}<small>available</small></div><div className="mb"><i style={css(`width:${lrv / bk * 100}%;background:var(--fg)`)} /><i style={css(`left:${lrv / bk * 100}%;width:${cov / bk * 100}%;background:var(--underway)`)} /></div><div className="sc-s">{M.lr != null ? <>{"Behind Clear Lending’s "}{money0(lrv)}{" reserve"}</> : 'Clear Lending’s reserve isn’t read yet'}</div></div>;
      html(document.getElementById('hdr'), <><span className="when"><span className="dot" />{L ? `Money · ${WD(0)} ${dayD(0)}` : 'Money · Wed 21 Oct · Demo data'}</span><p className="brief">{B}</p><div className="strip s5">{!L || M.cover != null ? backstop : apStrip()}<div className="sc"><span className="lbl">Member savings</span><div className="sc-v">{money(M.savings).replace(/\.\d+$/, '')}<small className="ct">{money(M.savings).match(/\.\d+$/)[0]}</small></div><div className="mb"><i style={css("width:100%")} /></div><div className="sc-s">{L ? L.reserve ? `Reserved ${L.reserve.ratio} · checked ${L.reserve.checked}` : 'The reserve isn’t read yet' : 'Reserved 1 : 1 · checked 2 min ago'}</div></div>{L && !L.flowsReal ? <div className="sc"><span className="lbl">Next 30 days</span><div className="sc-v">—</div><div className="mb hatch" /><div className="sc-s">Not real yet · the schedule isn’t recorded</div></div> : L ? <div className="sc"><span className="lbl">Next 30 days</span><div className="sc-v">{money(OUT30).replace(/\.\d+$/, '')}<small>out</small></div><div className="mb"><i style={css(`width:${OUT30 ? Math.min(100, IN30 / OUT30 * 100) : 0}%;background:var(--land)`)} /></div><div className="sc-s">{money(IN30)}{" in · "}{M.short ? `${money(M.short)} short in 14 days` : 'nothing short'}</div></div> : <div className="sc"><span className="lbl">Next 30 days</span><div className="sc-v">{money(13980.05).replace(/\.\d+$/, '')}<small>out</small></div><div className="mb"><i style={css(`width:${7632.61 / 13980.05 * 100}%;background:var(--land)`)} /></div><div className="sc-s">{money(7632.61)}{" in · top-up included"}</div></div>}{settleTile(SETL(), {
        cls: 'sc sc-sf',
        attrs: {
          'data-ntab': 'overview',
          'data-njump': 'nsettle'
        }
      })}<div className="sc"><span className="lbl">Moves</span><div className="sc-v">{w.length}{" "}<small>waiting</small></div><div className="mb">{w.map((m, i) => <i key={i} style={css(`left:${i / Math.max(3, w.length) * 100}%;width:calc(${100 / Math.max(3, w.length)}% - 2px);background:${forMe().includes(m) ? 'var(--underway)' : m.st === 'merchants' ? 'var(--live)' : 'color-mix(in srgb,var(--fg) 40%,transparent)'}`)} />)}</div><div className="sc-s">{mine.length ? `${mine.length} for you` : 'None for you'}{w.some(m => m.st === 'merchants') ? ` · ${w.filter(m => m.st === 'merchants').length} shop payout` : ''}</div></div></div></>);
    }

    /* ══ Overview: is everything covered? ══════════════════════════════════════════════ */
    function claimsCell() {
      const C = L ? [['Member savings', 'USDC in the savings vault', M.savings, M.savings], ['Shops, 14 days', 'Payout pool, then Clear Lending’s funding', M.owed14, M.payout + M.dueMembers + Y.toPayout], ['Bondholders', 'BondVault', M.bonds, Math.min(M.bonds, M.bv)], ['Yield pool deposits', 'Pool cash, then deployed', Y.assets, Y.assets, Y.cash - Y.toPayout]] : [['Member savings', 'USDC in the ESA vault', M.savings, M.savings], ['Shops, by 4 Nov', 'Payout pool, then top-ups', M.owed14, M.owed14, M.payout], ['Bondholders', 'BondVault', M.bonds, Math.min(M.bonds, M.bv)], ['Yield pool deposits', 'Vault Cash, then Deployments', Y.assets, Y.assets, Y.cash]];
      return cell('s7', 'Claims in order', <span className="lbl">Who gets paid first</span>, <div className="ncl">{C.map(([k, by, owed, held, liq], i) => {
          const c = owed ? Math.min(1, held / owed) : 1,
            gap = Math.max(0, owed - held);
          return <div key={i} className={`ncl-r ${c < 1 ? 'part' : ''}`}><span className="ncl-n">{i + 1}</span><span className="ncl-k"><b>{k}</b><span>{by}</span></span><span className="ncl-b">{liq != null ? <><i style={css(`width:${owed ? liq / owed * 100 : 0}%`)} /><i style={css(`width:${owed ? (held - liq) / owed * 100 : 0}%;background:var(--land)`)} /></> : <><i style={css(`width:${c * 100}%`)} />{c < 1 ? <em style={css(`left:${c * 100}%;right:0`)} /> : ''}</>}</span><span className="ncl-p"><b>{c >= 1 ? '100%' : pct(held, owed)}</b><span>{gap ? money(gap) + ' short' : 'covered'}</span></span><b className="ncl-v">{money(owed)}</b></div>;
        })}</div>, <><span className="f-key"><span><i style={css("background:var(--fg)")} />Cash or reserve</span><span><i style={css("background:var(--land)")} />Deployed, or due in by a deadline</span><span><i className="hatch" />Not covered yet</span></span><button data-ntab="pools">Pools →</button></>);
    }
    /* live, Phase 2c: the AssurancePool is two compartments, not an RTD gate. The Credit Backstop keeps a floor
       and the coverage above it is what Lending Co. may draw; Member Assurance pays grants. Read only: every pool
       action takes two signers, from their own wallets, and Command never signs one. */
    function apStrip() {
      const A = L && L.assurance;
      if (!A) return <div className="sc"><span className="lbl">Credit Backstop</span><div className="sc-v">—</div><div className="mb hatch" /><div className="sc-s">The AssurancePool isn’t read yet</div></div>;
      const w = A.floor ? Math.min(100, A.backstop / Math.max(A.backstop, A.floor * 1.25) * 100) : 100,
        f = A.floor ? Math.min(100, A.floor / Math.max(A.backstop, A.floor * 1.25) * 100) : 0;
      return <div className="sc"><span className="lbl">Credit Backstop</span><div className="sc-v">{money(A.backstop).replace(/\.\d+$/, '')}<small>{A.backstop >= A.floor ? ' above floor' : ' under floor'}</small></div><div className="mb"><i style={css(`width:${w}%;background:var(--live)`)} /><s className="nflr" style={css(`left:${f}%`)} /></div><div className="sc-s">{`Floor ${money(A.floor)} · ${money(A.coverage)} coverage available`}</div></div>;
    }
    function assuranceCell() {
      const A = L.assurance;
      if (!A) return notReal('s5', 'AssurancePool', 'Needs the Phase 2c AssurancePool: its compartments, the Credit Backstop’s floor and the coverage above it.');
      const label = k => k === 'CREDIT_BACKSTOP' ? 'Credit Backstop' : k === 'MEMBER_ASSURANCE' ? 'Member Assurance' : k;
      const open = A.draws.filter(d => d.status === 'Requested' || d.status === 'Approved');
      return cell('s5', 'AssurancePool', <span className="lbl">{`${srcTxt('protocol')} · read only`}</span>, <div className="ngt"><div className="ngt-top"><div className="m-big">{money(A.total)}{" "}<small>in two compartments</small></div><span className={`fst ${A.paused ? 'warn' : A.backstop >= A.floor ? 'ok' : 'warn'}`}>{A.paused ? 'Paused' : A.backstop >= A.floor ? 'Above floor' : 'Under floor'}</span></div><div className="led ngt-wf" aria-label="Compartments">{A.compartments.map(c => <div key={c.key}><span>{`${label(c.key)} · ${(c.allocationBps / 100).toFixed(0)}% of inflows`}</span><b>{money(c.balance)}</b></div>)}</div><div className="led ngt-wf" aria-label="Backstop"><div><span>Backstop floor</span><b>{money(A.floor)}</b></div><div><span>Available coverage</span><b>{money(A.coverage)}</b></div><div><span>Draws requested · approved, unpaid</span><b>{`${money(A.pendingDraws)} · ${money(A.approvedUnpaid)}`}</b></div></div>{open.length ? <div className="ngt-h"><span>{open.map(d => `Draw #${d.id} ${d.status.toLowerCase()} ${money(d.approved || d.requested)}`).join(' · ')}</span></div> : ''}</div>, <><span>Draws, grants and transfers need two signers, from their own wallets</span><span /></>);
    }
    /* ── Loss ladder: the one component that shows who takes a loss, in order (IV-02 5.1, L-01 10.1) ──
       Each layer is a bar on one shared dollar scale, starting where the layer before it ends, so you read straight down how deep
       a loss has to go before it reaches the next layer. The dashed line is today's whole unsecured book: the worst case, if every
       unsecured member stopped paying at once. Savings-backed credit never enters the ladder: the member's own pledge pays it.
       lossLadder({compact}) is used on Overview (compact) and Pools (full, with what never takes a loss). */
    function lossLayers() {
      return L ? lossLayersLive() : [['Spread', 'Clear Lending’s margin this month', M.spread, 'var(--fg)'], ['Loss Reserve', 'Clear Lending’s CL Loss Reserve', M.lr, 'color-mix(in srgb,var(--fg) 58%,transparent)'], ['Credit Backstop', 'AssurancePool, up to the coverage cap', M.cover, 'var(--underway)'], ['Clear Lending’s capital', 'Its Residual Capital', M.resid, 'color-mix(in srgb,var(--fg) 32%,transparent)'], ['Yield pool', 'Pool Loss Charge · Holdbacks first', Y.assets, 'var(--live)']];
    }
    function lossLadder({
      compact = false
    } = {}) {
      const L = lossLayers(),
        ahead = L.slice(0, 4).reduce((a, x) => a + (x[2] ?? 0), 0),
        total = ahead + (L[4][2] ?? 0);
      const step = compact ? total > 12000 ? 10000 : 5000 : total > 12000 ? 5000 : 2500,
        max = Math.max(step, Math.ceil(total / step) * step),
        pc = v => (v / max * 100).toFixed(3) + '%';
      const worst = M.unsecured,
        reach = L.findIndex((_, i) => L.slice(0, i + 1).reduce((a, x) => a + (x[2] ?? 0), 0) >= worst);
      let at = 0;
      /* live, a rung that isn't read yet counts as nothing and says so: the order then shows the pool's loss at its worst */
      const rows = L.map(([k, sub, v0, c], i) => {
        const unread = v0 == null,
          v = v0 ?? 0;
        const a = at;
        at += v;
        const hit = !unread && i === reach,
          used = Math.max(0, Math.min(v, worst - a));
        const note = unread ? 'Not read yet' : used >= v && v ? 'All used' : used > 0 ? `${money0(used)}${compact ? '' : ' of it'} used` : 'Untouched';
        return <div key={i} className={`lw-r${i === 4 ? ' pool' : ''}${hit ? ' hit' : ''}`}><span className="lw-n" style={css(`--c:${c}`)}>{i + 1}</span><span className="lw-k"><b>{compact && k === 'Clear Lending’s capital' ? 'Residual Capital' : k}</b>{compact ? '' : <em>{sub}</em>}</span><span className="lw-t"><i className="lw-bar" style={css(`left:${pc(a)};width:${pc(v)};--c:${c}`)} />{used ? <i className="lw-used" style={css(`left:${pc(a)};width:${pc(used)};--c:${c}`)} /> : ''}{compact ? '' : <i className="lw-wc" style={css(`left:${pc(worst)}`)} />}</span><span className="lw-v"><b>{unread ? '—' : money(v)}</b><em className={used ? 'u' : ''}>{note}</em></span></div>;
      });
      const ticks = Array.from({
        length: max / step + 1
      }, (_, i) => <s key={i} style={css(`left:${pc(i * step)}`)}>{i ? '$' + i * step / 1000 + 'k' : '$0'}</s>);
      const axis = <div className="lw-r lw-ax"><span /><span className="lw-k"><em>Loss so far</em></span><span className="lw-t">{ticks}{compact ? '' : <i className="lw-wc ax" style={css(`left:${pc(worst)}`)} />}<b className="lw-wl" style={css(`left:${pc(worst)}`)}>{compact ? 'Worst case' : 'Worst case: all unsecured credit'}{" · "}{money0(worst)}</b></span><span /></div>;
      return <div className={`lw${compact ? ' sm' : ''}`}>{axis}{rows}{compact ? <i className="lw-wcl" style={css(`--f:${worst / max}`)} /> : ''}</div>;
    }
    function lossVerdict() {
      const L = lossLayers(),
        ahead = L.slice(0, 4).reduce((a, x) => a + (x[2] ?? 0), 0),
        worst = M.unsecured,
        hit = Math.max(0, worst - ahead),
        partial = L.slice(0, 4).some(x => x[2] == null);
      return {
        ahead,
        hit,
        partial,
        line: hit ? `If every unsecured member stopped paying at once, the yield pool would bear ${money(hit)}` : `Even if every unsecured member stopped paying at once, the yield pool loses nothing`
      };
    }
    /* live, the ladder's layers as Money reads them. Clear Lending's Spread and capital aren't read yet (the credit book's
       monthly figures): those rungs show "Not read yet" and count as nothing, so what stands ahead of the pool is a floor
       ("at least") and the pool's loss is never understated */
    function lossLayersLive() {
      return [['Spread', 'Clear Lending’s margin this month', M.spread, 'var(--fg)'], ['Loss Reserve', 'Clear Lending’s CL Loss Reserve', M.lr, 'color-mix(in srgb,var(--fg) 58%,transparent)'], ['Credit Backstop', 'AssurancePool · coverage available', M.cover ?? (L.assurance ? L.assurance.coverage : null), 'var(--underway)'], ['Clear Lending’s capital', 'Its own money, behind its lenders', M.resid, 'var(--land)'], ['Yield pool', 'Holders’ deposits, last', Y.assets, 'var(--live)']];
    }
    /* Overview's slot keeps the AssurancePool's own cell live until every rung is read: it's the one place its compartments,
       floor and draws show. Pools draws the order with what is read (lossLadder marks the rest) */
    const ladderRead = () => !L || lossLayersLive().every(l => l[2] != null);
    function gateCell() {
      if (L && !ladderRead()) return assuranceCell();
      const V = lossVerdict();
      return cell('s5', 'Who takes a loss first', <span className="lbl">If a member stops paying</span>, <div className="ngt lw-c">{lossLadder({
          compact: true
        })}</div>, <><span>{V.partial ? 'At least ' : ''}<b>{money(V.ahead)}</b>{" stands ahead of the yield pool · in the worst case it loses "}{V.hit ? money(V.hit) : 'nothing'}</span><button data-npool="ap" data-ntab="pools">Full order →</button></>);
    }
    // the demo draws the reference's chart; live, the one below, scaled to the schedule with its gap marked
    function runwayChartRef(h = 200) {
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
      const lo = Math.min(...pts.map(p => p[1])),
        hi = Math.max(...pts.map(p => p[1])),
        g0 = 14,
        g1 = 16;
      /* the scale fits the projection: room above the peak, and below zero only when the balance goes under it */
      const mx = Math.max(12000, Math.ceil(hi * 1.08 / 1000) * 1000),
        mn = lo < 0 ? Math.floor(lo * 1.3 / 1000) * 1000 : -mx * 0.04,
        W = 1000,
        x = d => d / 30 * W,
        y = v => (mx - v) / (mx - mn) * h,
        z = y(0),
        pc = v => (y(v) / h * 100).toFixed(2) + '%';
      const line = 'M' + pts.map(([d, v]) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' L');
      const area = `M0,${z} L` + pts.map(([d, v]) => `${x(d).toFixed(1)},${y(Math.max(0, v)).toFixed(1)}`).join(' L') + ` L${W},${z} Z`;
      const marks = FLOWS.map(([d, k, v], __k) => <i key={__k} className={k} style={css(`left:${d / 30 * 100}%`)} title={`${dayD(d)} · ${k === 'in' ? '+' : '−'}${money(v)}`} />);
      return <div className="nrw"><div className="nrw-p"><svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" aria-hidden="true"><defs><pattern id="nhu" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" className="hxu" /></pattern></defs>{[5000, 10000].map((v, __k) => <line key={__k} x1="0" x2={W} y1={y(v)} y2={y(v)} className="grid" />)}<path d={area} className="ar" />{lo < 0 ? <rect x={x(g0)} y={z} width={x(g1) - x(g0)} height={y(lo) - z} className="gap" /> : ''}<line x1="0" x2={W} y1={z} y2={z} className="zero" /><path d={line} className="ln" /></svg>{[[10000, '$10k'], [5000, '$5k'], [0, '$0']].map(([v, t], __k) => <span key={__k} className="nrw-y" style={css(`top:${pc(v)}`)}>{t}</span>)}{lo < 0 ? <span className="nrw-c" style={css(`left:${(x(g0) + x(g1)) / 2 / W * 100}%;top:calc(${pc(lo)} + 8px)`)}><b>{"Short "}{money(-lo)}</b><span>{dayD(g0)}{" → "}{dayD(g1)}{" · claims queue"}</span></span> : ''}<span className="nrw-e" style={css(`top:${pc(b)}`)}><b>{money(b)}</b></span></div><div className="nrw-x"><div className="nrw-m">{marks}</div>{[0, 7, 14, 21, 28].map((d, __k) => <span key={__k} style={css(`left:${d / 30 * 100}%`)}>{dayD(d)}</span>)}</div></div>;
    }
    function runwayChart(h = 200) {
      if (!L) return runwayChartRef(h);
      let b = M.payout;
      const pts = [[0, b]];
      for (let d = L ? 0 : 1; d <= 30; d++) {
        FLOWS.filter(f => f[0] === d).forEach(f => {
          pts.push([d, b]);
          b += f[1] === 'in' ? f[2] : -f[2];
          pts.push([d, b]);
        });
      }
      pts.push([30, b]);
      // live, the scale and the gap are worked out from the schedule; the reference's scale fits its own projection
      const nice = v => {
          const st = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
          return Math.ceil(v / st) * st;
        },
        hi = Math.max(...pts.map(p => p[1])),
        lo0 = Math.min(...pts.map(p => p[1])),
        neg = pts.findIndex(p => p[1] < 0),
        back = neg < 0 ? -1 : pts.findIndex((p, i) => i > neg && p[1] >= 0);
      const mx = L ? nice(Math.max(hi, 1000) * 1.1) : Math.max(12000, Math.ceil(hi * 1.08 / 1000) * 1000),
        mn = L ? lo0 < 0 ? -nice(-lo0 * 1.3) : -mx / 4 : lo0 < 0 ? Math.floor(lo0 * 1.3 / 1000) * 1000 : -mx * 0.04,
        W = 1000,
        x = d => d / 30 * W,
        y = v => (mx - v) / (mx - mn) * h,
        z = y(0),
        pc = v => (y(v) / h * 100).toFixed(2) + '%';
      const line = 'M' + pts.map(([d, v]) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' L');
      const lo = lo0,
        g0 = L ? neg < 0 ? 0 : pts[neg][0] : 14,
        g1 = L ? neg < 0 ? 0 : back < 0 ? 30 : pts[back][0] : 16,
        grid = L ? [mx / 2, mx] : [5000, 10000],
        kfmt = v => v >= 1000 ? `$${+(v / 1000).toFixed(1)}k` : `$${v}`;
      const area = `M0,${z} L` + pts.map(([d, v]) => `${x(d).toFixed(1)},${y(Math.max(0, v)).toFixed(1)}`).join(' L') + ` L${W},${z} Z`;
      const marks = FLOWS.map(([d, k, v], __k) => <i key={__k} className={k} style={css(`left:${d / 30 * 100}%`)} title={`${dayD(d)} · ${k === 'in' ? '+' : '−'}${money(v)}`} />);
      return <div className="nrw"><div className="nrw-p"><svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" aria-hidden="true"><defs><pattern id="nhu" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" className="hxu" /></pattern></defs>{grid.map((v, __k) => <line key={__k} x1="0" x2={W} y1={y(v)} y2={y(v)} className="grid" />)}<path d={area} className="ar" />{L && neg < 0 ? '' : <rect x={x(g0)} y={z} width={x(g1) - x(g0)} height={y(lo) - z} className="gap" />}<line x1="0" x2={W} y1={z} y2={z} className="zero" /><path d={line} className="ln" /></svg>{(L ? [[mx, kfmt(mx)], [mx / 2, kfmt(mx / 2)], [0, '$0']] : [[10000, '$10k'], [5000, '$5k'], [0, '$0']]).map(([v, t], __k) => <span key={__k} className="nrw-y" style={css(`top:${pc(v)}`)}>{t}</span>)}{L && neg < 0 ? '' : <span className="nrw-c" style={css(`left:${(x(g0) + x(g1)) / 2 / W * 100}%;top:calc(${pc(lo)} + 8px)`)}><b>{"Borrows "}{money(-lo)}</b><span>{dayD(g0)}{" → "}{dayD(g1)}, from the yield pool</span></span>}<span className="nrw-e" style={css(`top:${pc(b)}`)}><b>{money(b)}</b></span></div><div className="nrw-x"><div className="nrw-m">{marks}</div>{[0, 7, 14, 21, 28].map((d, __k) => <span key={__k} style={css(`left:${d / 30 * 100}%`)}>{dayD(d)}</span>)}</div></div>;
    }
    /* live, what else needs someone: the bank feed when it's behind or hasn't read yet, and the next bond to mature */
    /** Needs you's card settlement row: none when it's Covered; when the desk has it, no button to fund. */
    function settleRow() {
      const n = settleNeed(SETL(), SF_NOW());
      return n ? [[n.sev, n.title, n.meta, n.age, <><span className="who">{n.owner}</span><button className="lnk" data-ntab="overview" data-njump="nsettle">{n.action}</button></>]] : [];
    }
    function liveNeeds() {
      const out = [],
        [, age, late] = SRC.plaid,
        sync = CAN() ? <button className="lnk" data-nsync="">Sync now →</button> : '';
      if (late) out.push(['absent', `Operating cash is ${age} old`, 'Plaid · the bank feed is behind', age, <><span className="who none">Not synced</span>{sync}</>]);
      else if (age === 'not synced yet' || age === 'off') out.push(['absent', 'Operating cash isn’t synced', age === 'off' ? 'The Plaid feed is off' : 'Plaid hasn’t read the bank yet', '—', <><span className="who none">Not synced</span>{sync}</>]);
      // the payout top-ups job (decision 51): stopped, or waiting on CL Operating's owners for what's past its limit
      const T = vars.payoutTopUps;
      if (T?.halted) out.push(['underway', 'Payout top-ups stopped', `After top-up #${T.halted.id}: ${T.halted.error} · nothing moves until someone clears it`, '—', <><span className="who">Clear Lending</span><button className="lnk" data-npool="pay" data-ntab="pools">Payout pool →</button></>]);
      else if (T?.needsHuman) out.push(['underway', 'Top-up waits on CL Operating', `${money(T.needsHuman.remainder)} is past the spending limit · CL Operating holds ${money(T.operating)} · its owners sign in the Safe app`, '—', <><span className="who">Clear Lending</span><button className="lnk" data-npool="pay" data-ntab="pools">Payout pool →</button></>]);
      // each Assurance fee that's due and not yet funded (the fee payer's records)
      (AF()?.items ?? []).filter(i => i.status === 'due').forEach(i => out.push(['underway', `Fund ${afMonth(i.month).split(' ')[0]}’s Assurance fee`, `${money(i.amount)} · CL Operating to the CL Fees wallet · Clear Lending’s two signers sign`, '—', <><span className="who">Needs you</span><button className="lnk" data-npool="ap" data-ntab="pools">AssurancePool →</button></>]));
      const next = BONDS.filter(x => Number.isFinite(x[4]) && x[4] >= 0).sort((a, b) => a[4] - b[4])[0];
      if (next) out.push(['line', `The first bond matures ${next[3]}`, `${next[0]} · ${money(next[1])} · paid from what BondVault keeps back`, `${next[4]} d`, <button className="lnk" data-npool="bonds">Bonds →</button>]);
      return out;
    }
    function renderOverview() {
      const run = L && !L.flowsReal ? notReal('s8', 'The payout pool, next 30 days', NEED_FLOWS) : cell('s8', 'The payout pool, next 30 days', <span className="lbl">Projected from the schedule</span>, <div className="nrun"><div className="nrun-h"><div className="m-big">{L ? money(M.payout + IN30 - OUT30) : money(3892.56)}{" "}<small>{L ? `left on ${dayD(30)}${FLOWS.some((f, i) => M.payout + FLOWS.slice(0, i + 1).reduce((a, g) => a + (g[1] === 'in' ? g[2] : -g[2]), 0) < 0) ? ', once Clear Lending funds what’s due' : ''}` : 'left on 20 Nov · Clear Lending funds each charge before it’s due'}</small></div></div>{runwayChart()}<div className="f-key nrun-k"><span><i style={css("background:var(--land)")} />Repayments and top-ups</span><span><i style={css("background:var(--fg)")} />Payouts to shops</span>{L ? <span><i className="hatch" />Funding Clear Lending owes</span> : ''}<span><i style={css("background:color-mix(in srgb,var(--fg) 12%,transparent);box-shadow:inset 0 0 0 1px var(--fg-50)")} />In the pool</span></div></div>, <><span>{money(L ? OUT30 : 13980.05)}{" out · "}{money(L ? IN30 : 7632.61)}{" in"}</span><button data-ntab="cash">Cash flow →</button></>);
      const w = pend(),
        mine = forMe();
      const NEED = L ? [...settleRow(), ...mine.map((m, __k) => ['underway', `Approve: ${m.t}`, `${money(m.amt)} · ${firstN(m.by)} proposed ${rel(m.d)}${m.due != null ? ' · due ' + dayD(m.due) : ''}`, rel(m.d) === 'today' ? 'Today' : WD(m.d), <><span className="who">Needs you</span><button className="lnk" data-nopen={m.id}>Review →</button></>]), ...w.filter(m => m.st === 'waiting' && m.by === N.me).map((m, __k) => ['line', m.t, `${money(m.amt)} · you proposed ${rel(m.d)}`, WD(m.d), <><span className="who">{"Waiting on "}{waitOn(m)}</span><button className="lnk" data-ntab="moves">Moves →</button></>]), ...w.filter(m => m.st === 'merchants').map((m, __k) => ['live', m.t, `${money(m.amt)} · ${firstN(m.by)} proposed · goes ${rel(m.due)}`, 'Tomorrow', <><span className="who">Needs a second person</span><button className="lnk" data-nrosa="">Review →</button></>]), ...(L ? liveNeeds() : [['absent', 'Operating cash is 3 hours old', 'Plaid last synced at 08:12 · the bank feed is behind', '3 h', <><span className="who none">Not synced</span><button className="lnk" data-nsync="">Sync now →</button></>], ['line', 'The first bond matures 14 Dec', `BB-0001 · ${money(2500)} · paid from what BondVault keeps back`, '54 d', <button className="lnk" data-npool="bonds">Bonds →</button>]])] : [...settleRow(), ...mine.map((m, __k) => ['underway', `Approve: ${m.t}`, `${money(m.amt)} · ${firstN(m.by)} proposed ${rel(m.d)}${m.due != null ? ' · due ' + dayD(m.due) : ''}`, rel(m.d) === 'today' ? 'Today' : WD(m.d), <><span className="who">Needs you</span><button className="lnk" data-nopen={m.id}>Review →</button></>]), ...w.filter(m => m.st === 'waiting' && m.by === N.me).map((m, __k) => ['line', m.t, `${money(m.amt)} · you proposed ${rel(m.d)}`, WD(m.d), <><span className="who">{"Waiting on "}{firstN(m.wait || 'dana')}</span><button className="lnk" data-ntab="moves">Moves →</button></>]), ...w.filter(m => m.st === 'merchants').map((m, __k) => ['live', m.t, `${money(m.amt)} · ${firstN(m.by)} proposed · goes ${rel(m.due)}`, 'Tomorrow', <><span className="who">Needs a second person</span><button className="lnk" data-nrosa="">Review →</button></>]), ...(M.standShort && TU.op < TU.refill() ? [['underway', 'Top-up waits on CL Operating', `It needs ${money(TU.refill())}, CL Operating holds ${money(TU.op)} · the keeper is Amber, nothing is late`, '6 min', <><span className="who">Clear Lending</span><button className="lnk" data-npool="pay" data-ntab="pools">Payout pool →</button></>]] : []), ...AFD.items.filter(it => it.st === 0).map((it, __k) => ['underway', `Fund ${it.month.split(' ')[0]}’s Assurance fee`, `${money(it.amt)} · CL Operating to the CL Fees wallet · Clear Lending’s two signers sign`, '20 d', <><span className="who">Needs you</span><button className="lnk" data-npool="ap" data-ntab="pools">AssurancePool →</button></>]), ['absent', 'Operating cash is 3 hours old', 'Plaid last synced at 08:12 · the bank feed is behind', '3 h', <><span className="who none">Not synced</span><button className="lnk" data-nsync="">Sync now →</button></>], ['line', 'The first bond matures 14 Dec', `BB-0001 · ${money(2500)} · paid from BondVault’s Redemption Reserve`, '54 d', <button className="lnk" data-npool="bonds">Bonds →</button>]];
      const need = cell('s4', 'Needs you', <span className="lbl">{NEED.length}{NEED.length === 1 ? ' thing' : " things"}</span>, <div className="al">{L && !NEED.length ? <p className="nmv-e">Nothing needs you.</p> : ''}{NEED.map(([sv, t, m, age, own], __k) => <div key={__k} className="alr"><div className="al-m"><div className="al-t"><i className="sv" style={css(`background:${{
                underway: 'var(--underway)',
                live: 'var(--live)',
                absent: 'var(--absent)',
                line: 'var(--line)'
              }[sv]}`)} /><b>{t}</b><span className="age">{age}</span></div><span className="m">{m}</span></div><div className={`own ${sv === 'absent' ? 'none' : ''}`}>{own}</div></div>)}</div>, <><span>Every move needs two people</span><button data-ntab="moves">All moves →</button></>);
      // card settlement leads (decision 54): will the swipes settle at the next cut-off, and what to press if not
      const SC = SETL(),
        settle = SC ? settleCard(SC, SH(), SF_NOW()) : notReal('s12', 'Next card settlement', 'Needs the settlement funding desk (SETTLEMENT_FUNDING_ENABLED) to have checked: the next cut-off, what’s due, the settlement account and what the desk can move.', 'nsettle');
      html(document.getElementById('nv'), <>{band(settle, 1)}{band(<>{claimsCell()}{gateCell()}</>)}{band(<>{run}{need}</>)}{band(holdingsCell())}</>);
    }
    /* BondVault keeps back what's due to bondholders within 90 days, or 30% of all owed, whichever is more; the Safe can take the rest */
    /* the bonds that mature in the next 90 days, soonest first */
    const soon90 = () => BONDS.filter(x => x[4] >= 0 && x[4] <= 90).sort((a, b) => a[4] - b[4]);
    // live, the contract's own read (BondVault.requiredReserve)
    const BV_NEED = () => L ? L.bvNeed : Math.max(7500, M.bonds * 0.3);
    const bvSub = () => {
      const bv = M.bv || 0,
        kept = Math.min(bv, BV_NEED()),
        use = Math.max(0, bv - BV_NEED());
      return [['Redemption Reserve', L ? L.bvRule : 'Due within 90 days, or 30% of all owed', bv >= BV_NEED() ? 'Kept back' : `Needs ${money(BV_NEED())}`, money(kept)], ['Excess', 'Clear Lending can withdraw it, through the Collateral Agent', 'Usable', money(use)]].map(([k, s, t, v], __k) => <div key={__k} className="nh-r sub"><span /><span className="nh-k"><b>{k}</b><span>{s}</span></span><span /><span /><span className="nh-ch">{t}</span><b className="nh-v">{v}</b></div>);
    };
    /* live, the ClearCredit the Ops Safe holds: the co-op's claim still to be cashed, from the PayoutPool as members repay or from the AssurancePool's excess above its RTD target, so shown but not counted until it arrives as USDC */
    const coopSub = () => <div className="nh-r sub"><span /><span className="nh-k"><b>ClearCredit claim</b><span>From the PayoutPool, or AssurancePool excess</span></span><span /><span /><span className="nh-ch">Not counted</span><b className="nh-v">{money(L.COOP.credit)}</b></div>;
    /* live, the offers line's cap: a change goes to the Ops Safe to sign, as OffersIssuer.setCap */
    const offersCapForm = () => <div>{lbl('Offers cap')}<div className="npf"><label>{lbl('New cap, $')}<input id="noffcap" className="vin" inputMode="decimal" defaultValue={L.OFFERS.cap.toFixed(2)} /></label></div><p className="small quiet">{`Room for ${Math.max(0, Math.floor((L.OFFERS.cap - L.OFFERS.owed) / 10))} more $10 offers now. Paying the line down makes room too.`}</p><button className="btn" data-noffcap="">Propose to the Ops Safe</button></div>;
    /* live, what the co-op owes for $10 offers on their own line: owed, not taken from the balance */
    const offersSub = () => <div className="nh-r sub"><span /><span className="nh-k"><b>Offers owed</b><span>{`$10 offers, ${money(L.OFFERS.unspent)} not yet spent · paid down from the Safe`}</span></span><span /><span /><span className="nh-ch">Owed</span><b className="nh-v">{money(L.OFFERS.owed)}</b></div>;
    function holdingsCell() {
      const tot = ACCTS.reduce((a, x) => a + x[5], 0);
      let c = 0;
      const seg = ACCTS.map(a => {
        const w = tot ? a[5] / tot * 100 : 100 / ACCTS.length,
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
          n: ss.length,
          l: ss.length ? ss[0].l : 0,
          w: ss.reduce((s, x) => s + x.w, 0),
          v: ss.reduce((s, x) => s + x.a[5], 0)
        };
      }).filter(x => x.n);
      const sp = v => {
        const mx = Math.max(...v) || 1,
          mn = Math.min(...v);
        return <svg className="nh-sp" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d={`M${v.map((y, i) => `${(i / (v.length - 1) * 100).toFixed(1)},${(22 - (y - mn) / (mx - mn || 1) * 20).toFixed(1)}`).join(' L')}`} /></svg>;
      };
      return cell('s12', 'Where it sits', <span className="lbl">{ACCTS.length}{" accounts · "}{money(tot)}</span>, <><div className="nh"><div className="nh-bar">{seg.map(({
              a,
              w
            }, __k) => !a[5] ? <button key={__k} className="z" data-nacct={a[0]} style={css(`flex:0 0 2px;--c:${a[7]}`)} title={L && a[9] ? `${a[1]} · not connected yet` : `${a[1]} · ${money(a[5])}`} /> : <button key={__k} className={seg.find(x => x.a[3] === a[3]) === seg.find(x => x.a === a) ? 'g0' : ''} data-nacct={a[0]} style={css(`width:${w}%;--c:${a[7]}${w > 13 ? '' : ';padding:0'}`)} title={`${a[1]} · ${money(a[5])} · ${pct(a[5], tot, 1)}`}>{w > 13 ? <><span>{a[1]}</span><b>{pct(a[5], tot, 0)}</b></> : ''}</button>)}</div><div className="nh-br">{grp.map(({
              g,
              l,
              w,
              v
            }, __k) => <span key={__k} style={css(`left:${l}%;width:${w}%`)}><i /><b>{GROUPS[g][0]}</b><em>{money(v)}{" "}<small>{Math.round(w)}%</small></em></span>)}</div></div><div className="nh-l"><div className="nh-r nh-hd"><span />{lbl('Account')}{lbl('Source')}{lbl('7 weeks')}{lbl('This week')}{lbl('Balance')}</div>{ACCTS.map((a, ai) => {
            const [id, n, why, g, src, bal, wk, col] = a,
              ch = wk[wk.length - 1] - wk[wk.length - 2],
              // live, an account nothing reads yet (Lithic's, until it's wired): said, not drawn as $0
              unread = L && a[9];
            const gh = !ai || ACCTS[ai - 1][3] !== g ? <div className="nh-g"><b>{GROUPS[g][0]}</b><span>{GROUPS[g][1]}</span><em>{money(ACCTS.filter(x => x[3] === g).reduce((t, x) => t + x[5], 0))}</em></div> : '';
            return <Fragment key={ai}>{gh}<button className={`nh-r ${N.panel && N.panel.acct === id ? 'on' : ''}`} data-nacct={id}><i className="nh-sw" style={css(`background:${col}`)} /><span className="nh-k"><b>{n}</b><span>{why}</span></span>{unread ? <><span className="nh-src none"><i />{"Not connected yet"}</span><span /><span className="nh-ch" /><b className="nh-v quiet">—</b></> : <><span className={`nh-src ${SRC[src][2] || ''}`}><i />{srcTxt(src)}</span>{sp(wk)}<span className={`nh-ch ${ch > 0 ? 'up' : ''}`}>{ch > 0 ? '+' : ''}{money(ch)}</span><b className="nh-v">{money(bal)}</b></>}</button>{id === 'bv' ? bvSub() : ''}{id === 'coop' && L && L.COOP && L.COOP.credit > 0 ? coopSub() : ''}{id === 'coop' && L && L.OFFERS ? offersSub() : ''}{id === 'ops' ? ASIDE.map(([k, v, s], __k) => <div key={__k} className="nh-r sub"><span /><span className="nh-k"><b>{k}</b><span>{s}</span></span><span /><span /><span className="nh-ch">Set aside</span><b className="nh-v">{money(v)}</b></div>) : ''}</Fragment>;
          })}</div></>, <><span>{money(freeCash())}{" of operating cash is free to spend, after tax and deposits"}</span><button data-nacct="ops">Operating cash →</button></>);
    }

    /* ══ Cash flow: what moves in the next 30 days ═════════════════════════════════════ */
    function renderCash() {
      let b = M.payout;
      const rows = FLOWS.map((f, i) => {
        b += f[1] === 'in' ? f[2] : -f[2];
        return [...f, b, i];
      });
      const LR = rows.map(([d, k, v, n, s, bal, i], __k) => {
        const same = i && FLOWS[i - 1][0] === d,
          grp = FLOWS[i + 1] && FLOWS[i + 1][0] === d,
          newM = !i || MON(FLOWS[i - 1][0]) !== MON(d);
        const mt = FLOWS.filter(f => MON(f[0]) === MON(d)),
          mIn = mt.filter(f => f[1] === 'in').reduce((a, f) => a + f[2], 0),
          mOut = mt.filter(f => f[1] === 'out').reduce((a, f) => a + f[2], 0);
        return <Fragment key={__k}>{newM ? <div className="nfw-m"><span className="lbl">{MONL(d)}</span><span>{money(mOut)}{" out · "}{money(mIn)}{" in"}</span></div> : ''}<div className={`nfw-r ${same ? 'same' : ''} ${grp ? 'grp' : ''} ${d === (L ? 0 : 1) ? 'soon' : ''}`}><span className="nfw-d">{same ? <i className="tie" /> : <span className="leaf"><span>{WD(d)}</span><b>{DD(d)}</b></span>}</span><span className="nfw-k"><b>{n}</b><span>{s}{" · "}{same ? 'same day' : rel(d)}</span></span><b className={`nfw-v ${k}`}>{k === 'in' ? '+' : '−'}{money(v)}</b><span className={`nfw-b ${bal < 0 ? 'neg' : ''}`}>{bal < 0 ? <><b>{money(bal)}</b><span>claims queue</span></> : <><b>{money(bal)}</b><span>in the pool after</span></>}</span></div></Fragment>;
      });
      const list = cell('s7', 'Every movement', <span className="lbl">Next 30 days</span>, L && !LR.length ? <div className="lv-e"><span>Nothing moves in or out in the next 30 days</span></div> : <div className="nfw">{LR}</div>, <><span>NET-14 shops are paid every other Wednesday</span><button data-ngo="merchants/payouts">Payouts · Merchants →</button></>);
      const term = (k, v, n, cls = '') => <div className={cls}>{lbl(k)}<b>{v}</b><span>{n}</span></div>;
      const tot = M.owed14,
        seg = [['In the pool', M.payout, ''], ['Member repayments', M.dueMembers, 'in'], [L ? 'Clear Lending, within 14 days' : 'Clear Lending, by Mon 2 Nov', M.short, 'gap']];
      // live, when the schedule first goes short: Clear Lending funds it by its Funding Deadline (I-09), before shops are due
      const G = (() => {
        let bb = M.payout,
          g0 = -1,
          g1 = -1,
          left = 0;
        for (const f of FLOWS) {
          bb += f[1] === 'in' ? f[2] : -f[2];
          if (bb < 0 && g0 < 0) g0 = f[0];else if (g0 >= 0 && g1 < 0 && bb >= 0) {
            g1 = f[0];
            left = bb;
          }
        }
        return [...(g0 >= 0 ? [[g0, 'Yield pool lends it', 'Shops are paid on time', '+' + money(Y.toPayout), 'in']] : []), ...(g1 >= 0 ? [[g1, 'Repayments pay it back', 'Pool left at ' + money(left), '−' + money(Y.toPayout), '']] : [])];
      })();
      const topW = N.moves.find(m => m.kind === 'topup' && m.st === 'waiting');
      const gap = L && !L.flowsReal ? notReal('s5', 'Clear Lending’s funding', NEED_FLOWS, 'ngap') : L ? cell('s5', 'Clear Lending’s funding', <span className="lbl">PayoutPool · I-09</span>, <div className="ngp" id="ngap"><div className="m-big">{money(M.short)}{" "}<small>{M.short ? 'still to fund in the next 14 days' : 'nothing to fund in the next 14 days'}</small></div><div className="ngb"><div className="ngb-bar">{seg.map(([k, v, c], __k) => <i key={__k} className={c} style={css(`flex:${v}`)} />)}</div><div className="ngb-o"><span>Owed to shops, 14 days</span><b>{money(tot)}</b></div><div className="ngb-k">{seg.map(([k, v, c], __k) => <div key={__k} className={c}><i /><span>{k}</span><b>{money(v)}</b></div>)}</div></div><div className="ngp-l">{G.map(([d, t, sub, v, k], __k) => <div key={__k} className="ngp-r">{leaf(d)}<span><b>{t}</b><span>{sub}</span></span><b className={k}>{v}</b></div>)}</div></div>, topW ? <><span>{firstN(topW.by)}{" proposed a top-up · waiting on "}{waitOn(topW)}</span><button className="btn sm-b" data-ntab="moves">See it</button></> : <><span>{M.short ? 'Nothing proposed yet' : 'No top-up needed'}</span>{CAN() ? <button className="btn sm-b" data-npropose="topup">Top up instead</button> : <span />}</>, 'ngap') : cell('s5', 'Clear Lending’s funding', <span className="lbl">4 Nov payouts · I-09</span>, <div className="ngp" id="ngap"><div className="m-big">{money(M.short)}{" "}<small>still to fund by its deadline, Mon 2 Nov</small></div><div className="ngb"><div className="ngb-bar">{seg.map(([k, v, c], __k) => <i key={__k} className={c} style={css(`flex:${v}`)} />)}</div><div className="ngb-o"><span>Owed to shops by 4 Nov</span><b>{money(tot)}</b></div><div className="ngb-k">{seg.map(([k, v, c], __k) => <div key={__k} className={c}><i /><span>{k}</span><b>{money(v)}</b></div>)}</div></div><div className="ngp-l">{[[12, 'Funding Deadline', 'Two business days before the claims are due', '+' + money(M.short), 'in'], [14, 'Shops are paid', 'Funded beats queued: nothing waits', '−' + money(2916.00), '']].map(([d, t, sub, v, k], __k) => <div key={__k} className="ngp-r">{leaf(d)}<span><b>{t}</b><span>{sub}</span></span><b className={k}>{v}</b></div>)}</div><p className="bd-n">Clear Lending funds it from CL Operating: money borrowed from the Yield Pool and BondVault’s excess, plus member repayments. Never from the AssurancePool, the Loss Reserve or BondVault’s Redemption Reserve.</p></div>, topW ? <><span>{firstN(N.moves.find(m => m.kind === 'topup').by)}{" proposed a Deployment · waiting on "}{firstN(N.moves.find(m => m.kind === 'topup').wait || 'dana')}</span><button className="btn sm-b" data-ntab="moves">See it</button></> : <><span>Funded on time</span><span /></>);
      // live, the schedule's rows by week, from this week's Monday
      const mon0 = -((new Date(TODAY).getUTCDay() + 6) % 7);
      const wk = L ? [0, 1, 2, 3, 4].map(i => {
        const fs = FLOWS.filter(f => f[0] >= mon0 + 7 * i && f[0] < mon0 + 7 * i + 7);
        return [i ? dayD(mon0 + 7 * i) : 'This week', fs.filter(f => f[1] === 'in').map(f => f[2]), fs.filter(f => f[1] === 'out').map(f => f[2])];
      }) : [['This week', [592.94], [412.60]], ['26 Oct', [889.42, 3840.05], []], ['2 Nov', [2310.20], [9510.65, 2916.00]], ['9 Nov', [], []], ['16 Nov', [], [1140.80]]];
      const wmx = L ? Math.max(1, ...wk.flatMap(([, i, o]) => [i.reduce((a, b) => a + b, 0), o.reduce((a, b) => a + b, 0)])) * 1.1 : 12500;
      const weeks = cell('s7', 'In and out, by week', <span className="lbl">Next 5 weeks</span>, <div className="nwk">{wk.map(([t, i, o], __k) => {
          const ti = i.reduce((a, b) => a + b, 0),
            to = o.reduce((a, b) => a + b, 0);
          return <div key={__k} className="nwk-c"><div className="nwk-u"><i style={css(`height:${ti / wmx * 100}%`)} />{ti ? <span>+{money0(ti)}</span> : ''}</div><div className="nwk-d"><i className={!L && t === '16 Nov' ? 'hx' : ''} style={css(`height:${to / wmx * 100}%`)} />{to ? <span>−{money0(to)}</span> : ''}</div><span className="nwk-t">{t}</span></div>;
        })}</div>, <><span className="f-key"><span><i style={css("background:var(--land)")} />In · repayments and Clear Lending</span><span><i style={css("background:var(--fg)")} />Out to shops</span><span><i className="hx" />Estimate</span></span><span /></>);
      const later = cell('s5', 'After that', <span className="lbl">Next 90 days</span>, <div className="nl">{L && !soon90().length ? <p className="nmv-e">No bond matures in the next 90 days.</p> : ''}{(L ? soon90().map(x => [x[4], `${x[0]} matures`, `${x[7] || 'Bondholder'} · ${x[5]} months at ${x[6].toFixed(1)}%`, x[1]]) : [[54, 'BB-0001 matures', 'Member · 4 months at 6.0%', 2500], [92, 'BB-0002 matures', 'Founding lender · 5 months at 6.5%', 5000], [41, 'Monthly run', 'October sales · NET-30 · estimate', 19825.70 * 0.98]]).sort((a, b) => a[0] - b[0]).map(([d, t, s, v], __k) => <div key={__k} className="nl-r">{leaf(d)}<span><b>{t}</b><span>{s}{" · "}{rel(d)}</span></span><b>−{money(v)}</b></div>)}</div>, <><span>Bonds are paid from BondVault’s Redemption Reserve</span><button data-npool="bonds">Bonds →</button></>);
      // live, nothing records the schedule yet: its cells say so
      const nr = L && !L.flowsReal;
      html(document.getElementById('nv'), <>{band(<>{nr ? notReal('s7', 'Every movement', NEED_FLOWS) : list}{gap}</>, 1)}{band(<>{nr ? notReal('s7', 'In and out, by week', NEED_FLOWS) : weeks}{later}</>)}</>);
    }

    /* ══ Credit: how much is out, and how safe ════════════════════════════════════════ */
    function renderCredit() {
      const t4 = (k, v, n, cls = '') => <div className={cls}>{lbl(k)}<b>{v}</b><span>{n}</span></div>;
      const oct = L ? null : cell('s12', 'October', <span className="lbl">Protocol · 12 s</span>, <div className="ncr"><div className="ncr-rp"><div className="ncr-h"><div className="m-big">{"100% "}<small>of this cycle’s repayments are in or on autopay</small></div><span>{"Due 31 Oct · "}{money(CR.due)}</span></div><div className="ncr-t"><i style={css(`width:${CR.repaid / CR.due * 100}%`)} /><i className="s hx" style={css(`width:${CR.sched / CR.due * 100}%`)} /></div><div className="f-key"><span><i style={css("background:var(--fg)")} />{"Collected "}<b>{money(CR.repaid)}</b></span><span><i className="hx" />{"On autopay, 24 and 30 Oct "}<b>{money(CR.sched)}</b></span></div></div><div className="ngp-eq ncr-eq">{t4('Owed on 1 Oct', money(CR.start), 'start of the month')}<i>+</i>{t4('Spent', money(CR.spent), 'at 12 shops')}<i>−</i>{t4('Repaid', money(CR.repaid), 'by members')}<i>=</i>{t4('Owed now', money(M.credit), `by ${M.members} members`, 'hi')}</div></div>, <><span>{money(M.limits)}{" in limits · "}{pct(M.credit, M.limits)}{" drawn · "}{M.autopay}{" members on autopay"}</span><button data-ngo="members">Members →</button></>);
      /* one shape for the row: a figure, one bar, then a ledger whose rows match the bar's colours */
      const lrow = (col, k, sub, v, cls = '') => <div className={cls}><span><i className="nsw" style={css(`background:${col}`)} />{k}{sub ? <em>{sub}</em> : ''}</span><b>{v}</b></div>;
      const back = cell('s4', 'What backs it', <span className="lbl">If a member stops paying</span>, <div className="ncb"><div className="m-big">{pct(M.savingsBacked, M.credit)}{" "}<small>backed by their own savings</small></div><div className="ncb-bar"><i style={css(`flex:${M.savingsBacked}`)} /><i style={css(`flex:${M.unsecured};background:var(--underway)`)} /></div><div className="led ncb-l">{lrow('var(--fg)', 'Savings-backed', 'Their own savings pay it', money(M.savingsBacked))}{lrow('var(--underway)', 'Unsecured', 'Clear Lending’s reserve, the backstop, then the pool', money(M.unsecured))}</div></div>, <><span>Only what collateral misses is a loss</span><button data-npool="ap" data-ntab="pools">Loss order →</button></>);
      const AC = ['var(--fg)', 'color-mix(in srgb,var(--fg) 45%,transparent)', 'var(--underway)', 'var(--absent)'];
      const age = L ? null : cell('s4', 'How old', <span className="lbl">What’s owed</span>, <div className="ncb"><div className="m-big">{pct(CR.aging[0][1], M.credit)}{" "}<small>is current</small></div><div className="ncb-bar">{CR.aging.filter(a => a[1]).map(([k, v], i) => <i key={i} style={css(`flex:${v};background:${AC[i]}`)} />)}</div><div className="led ncb-l">{CR.aging.map(([k, v], i) => <Fragment key={i}>{lrow(AC[i], k, '', v ? money(v) : 'None', v ? '' : 'z')}</Fragment>)}</div></div>, <><span>{money(1310.40 + 421.80)}{" late · nothing over 60 days"}</span><span /></>);
      const loss = L ? null : cell('s4', 'Losses', <span className="lbl">All time</span>, <div className="ncb"><div className="m-big">{money(M.lost)}{" "}<small>3 members · Clear Lending absorbed it</small></div><div className="ncb-bar">{CR.losses.map((_, __k) => <i key={__k} style={css("flex:1;background:var(--absent)")} />)}</div><div className="led ncb-l">{CR.losses.map(([d, n, id, v]) => <Fragment key={id}>{lrow('var(--absent)', n, `${dayD(d)} · 90 days late`, money(v))}</Fragment>)}</div></div>, <><span>Loss rate 1.1% · no backstop draw</span><button data-npool="ap" data-ntab="pools">AssurancePool →</button></>);
      const smx = L ? Math.max(1, ...CR.shops.map(x => x[1])) : CR.shops[0][1];
      const shops = cell('s7', 'Where it was spent', <span className="lbl">{L ? L.creditReal ? `${CR.month ?? 'This month'} · ClearCredit and Lithic` : `${CR.month ?? 'This month'} · ${srcTxt('lithic')}` : 'October · Lithic · 1 min'}</span>, <div className="nsh">{L && !CR.shops.length ? <p className="nmv-e">{L.creditReal ? 'Nothing spent on credit this month.' : 'No card spend this month.'}</p> : ''}{CR.shops.map(([n, v, l], i) => <div key={i} className={`nsh-r ${!L && i === CR.shops.length - 1 ? 'rest' : ''}`}><span>{n}</span><span className="nsh-b"><i style={css(`width:${v / smx * 100}%;${l ? 'background:var(--underway)' : ''}`)} /></span><b>{money(v)}</b></div>)}</div>, <><span className="f-key"><i style={css("background:var(--fg)")} />{"No losses "}<i style={css("background:var(--underway)")} />A loss on its book</span><button data-ngo="merchants/partners">Partners →</button></>);
      const lmx = Math.max(...CR.limits.map(x => x[1]));
      const lim = L ? null : cell('s5', 'Limit sizes', <span className="lbl">{M.members}{" members"}</span>, <div className="nlm">{CR.limits.map(([k, v], __k) => <div key={__k}><span>{v}</span><i style={css(`height:${v / lmx * 100}%`)} className={v === lmx ? 'hi' : ''} /><s>{k}</s></div>)}</div>, <><span>Most common limit $250 · 46 members</span><span /></>);
      // live, the chain's book: the month, how late balances are, the losses and the limits
      if (L && L.creditReal) {
        const q = (a, b) => b ? a / b : 0;
        const mon = (CR.month || 'This month').slice(0, 3);
        const lateAmt = CR.aging.slice(1).reduce((a, x) => a + x[1], 0);
        const octL = cell('s12', CR.month || 'This month', <span className="lbl">{`ClearCredit · ${srcTxt('protocol')}`}</span>, <div className="ncr"><div className="ncr-rp"><div className="ncr-h"><div className="m-big">{CR.due ? pct(CR.repaid, CR.due, 0) : '—'}{" "}<small>{CR.due ? 'of what’s repaid or due in 9 days is in' : 'nothing repaid or due in the next 9 days'}</small></div><span>{"Due in 9 days · "}{money(CR.sched)}</span></div><div className="ncr-t"><i style={css(`width:${q(CR.repaid, CR.due) * 100}%`)} /><i className="s hx" style={css(`width:${q(CR.sched, CR.due) * 100}%`)} /></div><div className="f-key"><span><i style={css("background:var(--fg)")} />{"Collected "}<b>{money(CR.repaid)}</b></span><span><i className="hx" />{"Due in the next 9 days "}<b>{money(CR.sched)}</b></span></div></div><div className="ngp-eq ncr-eq">{t4(`Owed on 1 ${mon}`, money(CR.start), 'start of the month')}<i>+</i>{t4('Spent', money(CR.spent + CR.carry), CR.carry ? `with ${money(CR.carry)} carry` : `at ${CR.shops.length} ${CR.shops.length === 1 ? 'shop' : 'shops'}`)}<i>−</i>{t4('Repaid', money(CR.repaid), 'by members')}<i>=</i>{t4('Owed now', money(M.credit), CR.owing ? `by ${CR.owing} ${CR.owing === 1 ? 'member' : 'members'}` : 'nobody owes anything', 'hi')}</div></div>, <><span>{money(M.limits)}{" in limits · "}{pct(M.credit, M.limits)}{" drawn · "}{M.autopay ?? 0}{" on autopay"}</span><button data-ngo="members">Members →</button></>);
        const ageL = cell('s4', 'How old', <span className="lbl">What’s owed</span>, <div className="ncb"><div className="m-big">{M.credit ? pct(CR.aging[0][1], M.credit) : '—'}{" "}<small>{M.credit ? 'is current' : 'nothing is owed'}</small></div><div className="ncb-bar">{CR.aging.filter(a => a[1]).map(([k, v], i) => <i key={i} style={css(`flex:${v};background:${AC[CR.aging.findIndex(x => x[0] === k)]}`)} />)}</div><div className="led ncb-l">{CR.aging.map(([k, v], i) => <Fragment key={i}>{lrow(AC[i], k, '', v ? money(v) : 'None', v ? '' : 'z')}</Fragment>)}</div></div>, <><span>{lateAmt ? `${money(lateAmt)} late · ${CR.late} ${CR.late === 1 ? 'member' : 'members'}${CR.aging[3][1] ? '' : ' · nothing over 60 days'}` : 'Nobody is late'}</span><span /></>);
        const lossL = cell('s4', 'Losses', <span className="lbl">All time</span>, <div className="ncb"><div className="m-big">{money(M.lost)}{" "}<small>{CR.losses.length ? `${CR.losses.length} written off` : 'nothing written off'}</small></div>{CR.losses.length ? <><div className="ncb-bar">{CR.losses.map((_, __k) => <i key={__k} style={css("flex:1;background:var(--absent)")} />)}</div><div className="led ncb-l">{CR.losses.map(([d, n, id, v]) => <Fragment key={id}>{lrow('var(--absent)', n, dayD(d), money(v))}</Fragment>)}</div></> : <div className="lv-e"><span>No losses written off yet</span></div>}</div>, <><span>{CR.poolPaid ? `${money(CR.poolPaid)} paid by the AssurancePool` : 'The AssurancePool has paid nothing'}</span><button data-npool="ap" data-ntab="pools">AssurancePool →</button></>);
        const lmxL = Math.max(1, ...CR.limits.map(x => x[1])),
          top = [...CR.limits].sort((a, b) => b[1] - a[1])[0];
        const limL = cell('s5', 'Limit sizes', <span className="lbl">{CR.limits.reduce((a, x) => a + x[1], 0)}{" with a limit"}</span>, CR.limits.length ? <div className="nlm">{CR.limits.map(([k, v], __k) => <div key={__k}><span>{v}</span><i style={css(`height:${v / lmxL * 100}%`)} className={v === lmxL ? 'hi' : ''} /><s>{k}</s></div>)}</div> : <p className="nmv-e">No member has a limit yet.</p>, <><span>{top ? `Most common limit ${top[0]} · ${top[1]} ${top[1] === 1 ? 'member' : 'members'}` : 'No limits set'}</span><span /></>);
        // live, Phase 2b: Liquidation Holds and shortfall notices, each hold step sent from the signer's own wallet
        return html(document.getElementById('nv'), <>{band(octL, 1)}{band(<>{back}{ageL}{lossL}</>)}{band(<>{shops}{limL}</>)}{creditsBand()}<LiquidationHolds /></>);
      }
      // live, before the API reads the chain's book: it says so
      if (L) return html(document.getElementById('nv'), <>{band(notReal('s12', CR.month ?? 'This month', 'Needs the credit ledger for the month: what was owed on the 1st, what was spent and repaid, and what’s on autopay.'), 1)}{band(<>{back}{notReal('s4', 'How old', 'Needs how late each member’s balance is: current, 1–30, 31–60 and over 60 days.')}{notReal('s4', 'Losses', 'Needs the credit ledger’s charge-offs: each balance written off and what the AssurancePool paid.')}</>)}{band(<>{shops}{notReal('s5', 'Limit sizes', 'Needs each member’s credit limit.')}</>)}{creditsBand()}<LiquidationHolds /></>);
      html(document.getElementById('nv'), <>{band(oct, 1)}{band(<>{back}{age}{loss}</>)}{band(<>{shops}{lim}</>)}</>);
    }


    /* Clear Credits and the Housing Allowance (live only): the points line the co-op owes on, the ledger's
       credits by why they were earned and each day's mints, and every Housing Allowance record together. */
    function creditsBand() {
      if (!L) return '';
      const K = L.CREDITS;
      if (!K) return band(<>{notReal('s7', 'Clear Credits', 'Needs the Points Issuer and the credits ledger (CREDITS in the money section).')}{notReal('s5', 'Housing Allowance', 'Needs the Housing Allowance Record.')}</>);
      const n = v => Math.round(v).toLocaleString('en-US');
      const SC = [['saving', 'Saving', 'var(--land)'], ['rent', 'Rent', 'var(--underway)'], ['bill', 'Bills', 'color-mix(in srgb,var(--fg) 45%,transparent)']];
      const lrow = (col, k, sub, v) => <div><span><i className="nsw" style={css(`background:${col}`)} />{k}{sub ? <em>{sub}</em> : ''}</span><b>{v}</b></div>;
      const led = rows => <div className="led">{rows.map(([k, v], i) => <div key={i}><span>{k}</span><b>{v}</b></div>)}</div>;
      const ln = K.line, lg = K.ledger;
      const days = lg ? lg.byDay : [];
      const dmx = Math.max(1, ...days.map(d => d.minted));
      const creditsCell = cell('s7', 'Clear Credits', <span className="lbl">{`Points Issuer · ${srcTxt('protocol')}`}</span>, <div className="ncb">
        <div className="m-big">{ln ? n(ln.outstanding) : '—'}{" "}<small>{ln ? `credits the points line owes now · ${n(ln.cap)} cap` : 'the points line isn’t read yet'}</small></div>
        {lg && lg.mintedTotal ? <div className="ncb-bar">{SC.filter(([k]) => lg.minted[k]).map(([k, , col]) => <i key={k} style={css(`flex:${lg.minted[k]};background:${col}`)} />)}</div> : ''}
        {lg ? <><div className="led ncb-l">{SC.map(([k, label, col]) => <Fragment key={k}>{lrow(col, label, 'minted', n(lg.minted[k]))}</Fragment>)}</div>
          {led([
            ...(ln ? [['Redeemed, spent or reversed · minted, less what the line owes', n(Math.max(0, lg.mintedTotal - ln.outstanding))]] : []),
            ['Earned, still in their 30 days', n(lg.pending)],
            ['Vested, waiting for the minting job', n(lg.vested)],
            ['Voided · reversed payments and refused mints', n(lg.voided)],
          ])}</> : <p className="nmv-e">The credits ledger isn’t read yet.</p>}
        {lg && days.length ? <>{lbl(`Minted each day · ${n(lg.mintedWeek)} in the last 7`)}<div className="nlm">{days.map(d => <div key={d.day}><span>{d.minted ? n(d.minted) : ''}</span><i style={css(`height:${d.minted / dmx * 100}%`)} className={d.minted === dmx && d.minted ? 'hi' : ''} /><s>{d.day.slice(8)}</s></div>)}</div></> : ''}
      </div>, <><span>1 credit redeems for $1 into a Housing Allowance, after an ELPA</span><span /></>);
      const H = K.housing;
      const both = H ? H.creditPortion + H.memberPortion : 0;
      const housingCell = cell('s5', 'Housing Allowance', <span className="lbl">{`Housing Allowance Record · ${srcTxt('protocol')}`}</span>, H ? <div className="ncb">
        <div className="m-big">{money(both)}{" "}<small>{H.live ? `toward ${money(H.price)} on ${H.live} ${H.live === 1 ? 'home' : 'homes'}` : 'no home has a live record yet'}</small></div>
        {both ? <div className="ncb-bar"><i style={css(`flex:${H.creditPortion};background:var(--land)`)} /><i style={css(`flex:${H.memberPortion};background:var(--fg)`)} /></div> : ''}
        <div className="led ncb-l">
          {lrow('var(--land)', 'Credit Portion', 'from credits · never cash', money(H.creditPortion))}
          {lrow('var(--fg)', 'Member Portion', 'their own payments', money(H.memberPortion))}
        </div>
        {led([
          ['Reached the price · waiting for the RedemptionAgent', String(H.redeemable)],
          ['Refunds due · after a move, an end or a redemption', money(H.refundsDue)],
          [`Lapses due · ${H.lapsesDue.count ? `${H.lapsesDue.count} past the 2-year hold` : 'none past the hold'}`, money(H.lapsesDue.creditPortion)],
          [`Held after an end · ${H.held.count ? `${H.held.count} in the 2-year hold` : 'none'}`, money(H.held.creditPortion)],
          ['Records · every home, live or not', String(H.records)],
        ])}
      </div> : <p className="nmv-e">The Housing Allowance Record isn’t read yet.</p>, <><span>Opened, moved and ended in Members, by two people and the Clear Treasury Safe</span><button data-ngo="members">Members →</button></>);
      return band(<>{creditsCell}{housingCell}</>);
    }

    /* ══ Pools ═════════════════════════════════════════════════════════════════════════ */
    // a share of a total that may be nothing yet (live): 0, not NaN
    const dv = (a, b) => b ? a / b : 0;
      const POOLS = L ? [['ap', 'AssurancePool', () => M.assurance, L ? 'Credit Backstop and Member Assurance · read only' : 'Covers unsecured losses after the yield pool', () => L && M.apBack != null ? <><i style={css(`width:${Math.min(1, dv(M.apBack, M.assurance)) * 100}%;background:var(--underway)`)} /><i style={css(`width:${Math.min(1, dv(M.apMem ?? 0, M.assurance)) * 100}%;background:var(--land)`)} /></> : L ? <><i style={css(`width:${Math.min(1, dv(M.backstopFloor ?? 0, M.assurance)) * 100}%`)} /><i style={css(`width:${(1 - Math.min(1, dv(M.backstopFloor ?? 0, M.assurance))) * 100}%;background:var(--land)`)} /></> : <><i style={css(`width:${Math.min(1, dv(M.unsecured * M.floor, M.assurance)) * 100}%`)} /><i style={css(`width:${(1 - Math.min(1, dv(M.unsecured * M.floor, M.assurance))) * 100}%;background:var(--land)`)} /></>, () => L ? `Backstop floor ${money(M.backstopFloor ?? 0)} · ${money(M.coverage ?? 0)} coverage` : `${money(M.assurance - M.unsecured * M.floor)} spare over the floor`], ['pay', 'Payout pool', () => M.payout, 'Pays shops for financed sales, deadline first', () => <><i style={css(`width:${L ? Math.min(1, dv(M.payout, M.owed14)) * 100 : M.payout / M.owed14 * 100}%`)} /><i className="hx" style={css("flex:1")} /></>, () => L ? M.owed14 ? `Covers ${pct(Math.min(M.payout, M.owed14), M.owed14, 0)} of what’s owed in 14 days` : 'Nothing owed to shops in 14 days' : `Covers ${pct(M.payout, M.owed14, 0)} of what’s owed by 4 Nov`], ['yield', 'Yield pool', () => Y.assets, 'Pool Shares · deployed only to Clear Lending', () => <><i style={css(`width:${Y.util * 100}%;background:var(--live)`)} /><i style={css(`width:${(1 - Y.util) * 100}%;background:var(--land)`)} /></>, () => `${(Y.apy * 100).toFixed(2)}% a year · ${pct(Y.lent, Y.assets, 0)} deployed`], ['bonds', 'Bonds', () => M.bonds, L ? `Owed to bondholders · ${BONDS.length} BurnerBond${BONDS.length === 1 ? '' : 's'}` : 'Owed to bondholders · 6 BurnerBonds', () => <><i style={css(`width:${Math.min(1, dv(Math.min(M.bv, BV_NEED()), M.bonds)) * 100}%`)} /><i style={css(`width:${Math.min(1, dv(Math.max(0, M.bv - BV_NEED()), M.bonds)) * 100}%;background:var(--land)`)} /></>, () => `${money(Math.min(M.bv, BV_NEED()))} kept · ${money(Math.max(0, M.bv - BV_NEED()))} spare`]] : [['ap', 'AssurancePool', () => M.assurance, 'The co-op’s · Credit Backstop and Member Assurance', () => <><i style={css(`width:${M.apBack / M.assurance * 100}%;background:var(--underway)`)} /><i style={css(`width:${M.apMem / M.assurance * 100}%;background:var(--land)`)} /></>, () => `${money(M.cover)} available to the backstop`], ['pay', 'Payout pool', () => M.payout, 'Pays shops for financed sales, deadline first', () => <><i style={css(`width:${M.payout / M.owed14 * 100}%`)} /><i className="hx" style={css("flex:1")} /></>, () => `Topped up by Mon 2 Nov`], ['yield', 'Yield pool', () => Y.assets, 'Pool Shares · deployed only to Clear Lending', () => <><i style={css(`width:${Y.util * 100}%;background:var(--live)`)} /><i style={css(`width:${(1 - Y.util) * 100}%;background:var(--land)`)} /></>, () => `${(Y.apy * 100).toFixed(2)}% a year · ${pct(Y.lent, Y.assets, 0)} deployed`], ['bonds', 'Bonds', () => M.bonds, 'Owed to bondholders · 6 BurnerBonds', () => <><i style={css(`width:${Math.min(M.bv, BV_NEED()) / M.bonds * 100}%`)} /><i style={css(`width:${Math.max(0, M.bv - BV_NEED()) / M.bonds * 100}%;background:var(--land)`)} /></>, () => `${money(Math.min(M.bv, BV_NEED()))} kept back`]];
    function renderPools() {
      const tiles = POOLS.map(([k, n, v, s, bar, f], __k) => <button key={__k} className={`cell s3 npt ${N.pool === k ? 'on' : ''}`} data-npool={k}><div className="hd"><h2>{n}</h2><div className="r">{ICO.chev}</div></div><div className="npt-b"><div className="m-big">{money(v()).replace(/\.\d+$/, '')}<small className="ct">{money(v()).match(/\.\d+$/)[0]}</small></div><span>{s}</span><div className="npt-bar">{bar()}</div></div><div className="bk-ft"><span>{f()}</span></div></button>);
      const D = {
        ap: poolAP,
        pay: poolPay,
        yield: poolYield,
        bonds: poolBonds
      }[N.pool]();
      const st = (n, k, v, s) => <div className="nlo-s"><span className="nlo-n">{n}</span><b>{k}</b><span className="m-big">{v}</span><span>{s}</span></div>;
      const V = lossVerdict();
      const NEVER = [['Bondholders', M.bonds, 'Never written down'], ['Payout pool', M.payout, 'Owed to shops'], ['Member Assurance', M.apMem ?? 0, 'The other compartment'], ['Other members’ savings', M.savings - M.savingsBacked, 'Theirs, untouched']];
      const order = cell('s12', 'If a member stops paying', <span className="lbl">Who takes the loss, in order · IV-02 5.1</span>, <div className="lw-wrap"><div className="lw-top"><div className="m-big">{money(V.ahead)}{" "}<small>{V.partial ? 'at least stands ahead of the yield pool: Clear Lending’s Spread and capital aren’t read yet. ' : 'stands ahead of the yield pool. '}{V.line}.</small></div><p className="lw-pre"><b>Before any of this:</b>{" savings-backed credit ("}{money(M.savingsBacked)}) is paid from the member’s own pledged savings. Only what collateral doesn’t cover becomes a loss and starts at step 1.</p></div>{lossLadder()}<div className="lw-nv"><span className="lw-nh"><b>Never takes a loss</b><span>{money(NEVER.reduce((a, x) => a + x[1], 0))}</span><em>Outside the order</em></span>{NEVER.map(([k, v, sub], __k) => <span key={__k} className="lw-ni"><b>{k}</b><span>{money(v)}</span><em>{sub}</em></span>)}</div></div>, <><span className="f-key"><span><i className="lw-ks" />Used if every unsecured member stopped paying</span><span><i className="lw-ks lt" />Still left</span></span><button data-ntab="credit">Credit →</button></>, 'loss');
      html(document.getElementById('nv'), <>{band(tiles, 1)}{D}{band(order)}</>);
    }
    function poolAP() {
      if (L) return poolAPLive();
      const apW = AP_BAL.slice(1).map((v, i) => v - AP_BAL[i]),
        wmx = Math.max(...apW);
      const a = cell('s7', 'Two compartments', <span className="lbl">AssurancePool · the co-op’s · Protocol · 12 s</span>, <div className="npd"><div className="m-big">{money(M.assurance)}{" "}<small>every dollar belongs to one compartment · nothing is lent, staked or pledged</small></div><div className="ncb-bar"><i style={css(`flex:${M.apBack};background:var(--underway)`)} /><i style={css(`flex:${M.apMem};background:var(--land)`)} /></div><div className="led ncb-l">{[['var(--underway)', 'Credit Backstop', 'Clear Lending’s charged-off principal · I-11', money(M.apBack)], ['var(--land)', 'Member Assurance', 'Members’ Assurance grants · MB-10', money(M.apMem)]].map(([c, k, sub, v], __k) => <div key={__k}><span><i className="nsw" style={css(`background:${c}`)} />{k}<em>{sub}</em></span><b>{v}</b></div>)}</div>{lbl('Paid in each week · Clear Lending’s fees and recoveries, the co-op’s interchange and allocations')}<div className="nlm wk">{apW.map((v, i) => <div key={i}><span>{money0(v)}</span><i style={css(`height:${v / wmx * 100}%`)} className={i === apW.length - 1 ? 'hi' : ''} /><s>{NW[i + 1]}</s></div>)}</div></div>, <><span>Money leaves a compartment only after 14 days, with two signers</span><span /></>);
      const b = cell('s5', 'The backstop this month', <span className="lbl">Floor posted 1 Oct</span>, <div className="npd"><div className="m-big">{money(M.cover)}{" "}<small>{"available · the compartment, up to the "}{money(M.cap)}{" cap"}</small></div><div className="led">{[['Fees and recoveries', 'Clear Lending · its CL Fees wallet'], ['Interchange and board allocations', 'The co-op treasury'], ['Split', 'Credit Backstop to its floor, then 50/50'], ['Coverage cap', `${money(M.cap)} · posted monthly`], ['Covered book', 'Read from CollateralRegistry'], ['Draws this year', M.drawn ? money(M.drawn) : 'None'], ['Draws go to', 'CL Loss Reserve, once two signers release'], ['Grants go to', 'Assurance Disbursement, after two signers'], ['Changing it', 'Board Safe schedules · two signers approve · 7 days'], ['Security pause', '72 hours at a time']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>, <><span>Clear Lending’s Spread and Loss Reserve come first</span><button data-ngo="settings">Protocol rules →</button></>);
      const steps = st => <span className="nau-st">{AFD_ST.map((n, i) => <i key={i} className={i < st ? 'on' : i === st ? st === 3 ? 'done' : 'now' : ''}>{n}</i>)}</span>;
      const item = it => <div className="nau-r nau-f"><span className="nau-m">{it.m}</span><span><b>{"Credit Enhancement Fee · "}{it.month}</b><span>{AFD.bps / 100}{"% a year on "}{money(it.avg)}{" average Available Coverage · "}{it.days}{" days"}{it.st === 3 ? <>{" · "}<a>approve</a>{" · "}<a>deposit</a></> : ''}</span>{steps(it.st)}</span><span className="nau-a"><b>{money(it.amt)}</b>{it.st === 0 ? <button className="btn sm-b" data-nafund={it.id}>Propose funding</button> : it.st === 1 ? <em>Clear Lending’s signers</em> : ''}</span></div>;
      const e = cell('s7', 'Assurance fees', <span className="lbl">Credit Backstop · CL Fees wallet · paying on</span>, <div className="npd"><div className="m-big">{money(AFD.soFar())}{" "}<small>{"October’s fee so far · "}{AFD.oct.read}{" of "}{AFD.oct.days}{" days read"}</small></div><div className="led">{[[`September · ${money(AFD.items[0].avg)} average`, money(AFD.items[0].amt)], ['Rate', `${AFD.bps / 100}% a year · daily average · actual/365`], ['Advances outstanding', `${money(M.drawn || 0)} · no draws`]].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{lbl('What Clear Lending pays in · oldest month first')}<div className="nau-l">{AFD.items.map(item)}</div></div>, <><span>Clear Lending’s two signers sign CL Operating’s transfer · the CL Fees wallet deposits exactly that</span><span /></>);
      const f = cell('s5', 'Repayments and interchange', <span className="lbl">Into the pool</span>, <div className="npd">{lbl('Spread Repayment or recovery')}<p className="nau-p">Nothing to enter: no draws have been released, so nothing is owed back to the Credit Backstop. A repayment can never be more than the advances outstanding.</p>{lbl('Interchange · the co-op treasury’s 25%')}<div className="led">{AFD.ix.map(([mo, ix, v, st], __k) => <div key={__k}><span>{mo}{" · 25% of $"}{ix}<em className="nau-e">{st}</em></span><b>{money(v)}</b></div>)}<div><span>October<em className="nau-e">Entered once the month ends · the treasury’s owners sign</em></span><b>—</b></div></div>{lbl('Floor figures')}<div className="led"><div><span>Posted 1 Oct · the pool’s two signers<em className="nau-e">Reminded when more than 31 days old</em></span><b>Next by 31 Oct</b></div></div></div>, <><span>Nothing moves until the Safe’s signers sign</span><span /></>);
      return <>{band(<>{a}{b}</>)}{band(<>{e}{f}</>)}</>;
    }
    /* live: the reference's two cards from the contract's own reads (Phase 2c: two compartments, the Credit Backstop's
       floor and the coverage above it, its draws), then the Assurance fees card with its real actions. The weekly
       paid-in history isn't kept: the card says so rather than drawing one week. */
    function poolAPLive() {
      const A = L.assurance;
      if (!A) return <>{band(notReal('s12', 'Two compartments', 'Needs the Phase 2c AssurancePool: its compartments, the Credit Backstop’s floor and the coverage above it.'))}{assuranceFees()}</>;
      const label = k => k === 'CREDIT_BACKSTOP' ? 'Credit Backstop' : k === 'MEMBER_ASSURANCE' ? 'Member Assurance' : k;
      const SUB = {
        CREDIT_BACKSTOP: 'Clear Lending’s charged-off principal · I-11',
        MEMBER_ASSURANCE: 'Members’ Assurance grants · MB-10'
      };
      const COL = {
        CREDIT_BACKSTOP: 'var(--underway)',
        MEMBER_ASSURANCE: 'var(--land)'
      };
      const comps = A.compartments;
      const a = cell('s7', 'Two compartments', <span className="lbl">{`AssurancePool · the co-op’s · ${srcTxt('protocol')}`}</span>, <div className="npd"><div className="m-big">{money(A.total)}{" "}<small>every dollar belongs to one compartment · nothing is lent, staked or pledged</small></div><div className="ncb-bar">{comps.filter(c => c.balance > 0).map(c => <i key={c.key} style={css(`flex:${c.balance};background:${COL[c.key] ?? 'var(--fg)'}`)} />)}</div><div className="led ncb-l">{comps.map(c => <div key={c.key}><span><i className="nsw" style={css(`background:${COL[c.key] ?? 'var(--fg)'}`)} />{label(c.key)}<em>{SUB[c.key] ?? `${(c.allocationBps / 100).toFixed(0)}% of inflows`}</em></span><b>{money(c.balance)}</b></div>)}</div>{lbl('Paid in each week · Clear Lending’s fees and recoveries, the co-op’s interchange and allocations')}<p className="nmv-e">The pool’s weekly history isn’t kept yet: today’s balances are the contract’s.</p></div>, <><span>{A.paused ? 'Paused · releases and transfers wait out the 72 hours' : 'Draws, grants and transfers need two signers, from their own wallets'}</span><span /></>);
      const open = A.draws.filter(d => d.status === 'Requested' || d.status === 'Approved');
      const b = cell('s5', 'The backstop this month', <span className="lbl">{A.backstop >= A.floor ? 'Above its floor' : 'Under its floor'}</span>, <div className="npd"><div className="m-big">{money(A.coverage)}{" "}<small>{"available · the Credit Backstop above its "}{money(A.floor)}{" floor"}{M.cap != null ? `, up to the ${money(M.cap)} cap` : ''}</small></div><div className="led">{[['Fees and recoveries', 'Clear Lending · its CL Fees wallet'], ['Interchange and board allocations', 'The co-op treasury'], ['Split', comps.map(c => `${label(c.key)} ${(c.allocationBps / 100).toFixed(0)}%`).join(' · ')], ['Coverage cap', M.cap != null ? money(M.cap) : 'Not read yet'], ['Covered book', money(A.coveredBook)], ['Draws requested · approved, unpaid', `${money(A.pendingDraws)} · ${money(A.approvedUnpaid)}`], ['Open draws', open.length ? open.map(d => `#${d.id} ${d.status.toLowerCase()} ${money(d.approved || d.requested)}`).join(' · ') : 'None'], ['Draws go to', 'CL Loss Reserve, once two signers release'], ['Grants go to', 'Assurance Disbursement, after two signers'], ['Security pause', A.paused ? 'On now · 72 hours at a time' : '72 hours at a time']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>, <><span>Clear Lending’s Spread and Loss Reserve come first</span><button data-ngo="settings">Protocol rules →</button></>);
      return <>{band(<>{a}{b}</>)}{assuranceFees()}</>;
    }
    /* Assurance fees (docs/operators/assurance-fee-payer.md): what Clear Lending pays into the new pool. Each item
       goes due → funding proposed (CL Operating's transfer to the CL Fees wallet, signed in the Safe app) → funded
       → paid (the API's job deposits it); the treasury's interchange goes to the Clear Treasury Safe. */
    // live only: the prototype has no such card (the API sends its seeded one when Money reads the seed)
    const AF = () => L ? L.AF : null;
    const AF_KIND = {
      fee: 'Credit Enhancement Fee',
      spread_repayment: 'Spread Repayment',
      recovery: 'Recovery'
    };
    const AF_ST = [['due', 'Due'], ['funding_proposed', 'Funding proposed'], ['funded', 'Funded'], ['paid', 'Paid']];
    const AF_NOW = {
      sending: ['funded', 'Paying'],
      failed: ['funded', 'Stopped']
    };
    const afMonth = m => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    });
    const afShort = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';
    const afLast = () => {
      const d = new Date(TODAY);
      d.setUTCDate(0);
      return d.toISOString().slice(0, 7);
    };
    function afSteps(st) {
      const [at, word] = AF_NOW[st] ?? [st, null];
      const k = AF_ST.findIndex(([s]) => s === at);
      return <span className="naf-st">{AF_ST.map(([s, n], i) => <i key={s} className={i < k ? 'on' : i === k ? 'now' : ''}>{i === k && word ? word : n}</i>)}</span>;
    }
    function afItem(i) {
      const tx = (h, l, w) => h ? <a href={l || '#'} target="_blank" rel="noopener">{`${w} ${h.slice(0, 10)}…`}</a> : '';
      const b = i.basis;
      const sub = i.kind === 'fee' && b ? `${AF().feeBps / 100}% a year on ${money(b.average)} average Available Coverage · ${b.days} days${b.filled ? `, ${b.filled} filled` : ''}${b.zero ? `, ${b.zero} at zero` : ''}` : i.note || (i.tag === 1 ? 'Into the Credit Backstop' : '');
      return <div key={i.id} className="nl-r"><span className="naf-m">{afMonth(i.month).replace(/ \d+$/, '').slice(0, 3)}</span><span><b>{`${AF_KIND[i.kind] ?? i.kind} · ${afMonth(i.month)}`}</b><span>{sub}</span>{i.status === 'nothing_due' ? <span>Nothing due</span> : afSteps(i.status)}{i.error ? <span className="naf-w">{i.error}</span> : ''}<span className="naf-a">{(i.status === 'due' || i.status === 'funding_proposed') && CAN() ? <button className="btn sm-b" data-nafund={i.id}>{i.funding ? 'Build the batch again' : 'Propose funding'}</button> : ''}{i.funding ? <><button className="lnk" data-nabatch={i.id}>Batch file</button><a href={i.funding.link} target="_blank" rel="noopener">Open CL Operating in the Safe app →</a></> : ''}{tx(i.approveTx, i.approveLink, 'Approve')}{tx(i.depositTx, i.depositLink, 'Deposit')}{i.status === 'failed' && APPR() ? <button className="btn sm-b" data-naretry={i.id}>Retry after checking</button> : ''}</span></span><b>{money(i.amount)}</b></div>;
    }
    function assuranceFees() {
      if (!L) return '';
      const A = AF();
      if (!A) return band(notReal('s12', 'Assurance fees', 'Needs the API’s Assurance fee records (ASSURANCE_FEES in the money section).'));
      if (!A.configured) return band(notReal('s12', 'Assurance fees', A.why || 'The new Assurance Pool isn’t configured yet.'));
      const tm = A.thisMonth,
        lm = A.lastMonth,
        adv = A.advances;
      const items = A.items.filter(i => i.status !== 'nothing_due' || i.kind === 'fee').slice(0, 12);
      const rate = `${A.feeBps / 100}% a year on average daily Available Coverage, actual/365`;
      const summary = <div className="led">{[[tm ? `${afMonth(tm.month)} so far · ${tm.read} of ${tm.days} days read` : 'This month', tm ? money(tm.fee) : '—'], [lm ? `${afMonth(lm.month)} · ${money(lm.average)} average over ${lm.days} days${lm.filled ? `, ${lm.filled} filled` : ''}${lm.zero ? `, ${lm.zero} at zero` : ''}` : 'Last month', lm ? money(lm.fee) : 'Not accrued yet'], ['Available Coverage now', A.coverage ? money(A.coverage.available) : '—'], [adv ? `Advances outstanding · ${adv.draws} draw${adv.draws === 1 ? '' : 's'} released, ${money(adv.repaidPaid)} paid back` : 'Advances outstanding', adv ? money(adv.outstanding) : '—'], [`CL Fees wallet ${afShort(A.wallet?.address)}`, A.wallet?.balance == null ? '—' : money(A.wallet.balance)]].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>;
      const floor = A.floor && A.floor.stale ? <p className="naf-w">{A.floor.at ? `The floor figures were last posted ${A.floor.days} days ago: post this month’s (setFloorInputs, two signers).` : 'The floor figures have never been posted: post them (setFloorInputs, two signers).'}</p> : '';
      const fees = cell('s7', 'Assurance fees', <span className="lbl">{A.demo ? 'Prototype' : `Credit Backstop · ${A.payerEnabled ? 'paying on' : 'paying off'}`}</span>, <div className="npd">{summary}{floor}{lbl('What’s owed, oldest month first')}{items.length ? <div className="nl">{items.map(afItem)}</div> : <p className="nmv-e">Nothing accrued yet. The first fee is worked out once a month the pool was read in has ended.</p>}</div>, <><span>{rate}</span><span>{A.links?.clOperatingQueue ? <a href={A.links.clOperatingQueue} target="_blank" rel="noopener">CL Operating’s queue →</a> : ''}</span></>);
      const room = adv ? adv.room : 0;
      const repay = CAN() && !A.demo ? <div className="npf">{lbl('Enter a Spread Repayment or recovery')}<label>{lbl('What')}<select id="narep-kind" className="vin" defaultValue="spread_repayment"><option value="spread_repayment">Spread Repayment (retained Spread, Step 5)</option><option value="recovery">Recovery (the Credit Backstop’s share)</option></select></label><label>{lbl('Month')}<input id="narep-month" className="vin" defaultValue={afLast()} placeholder="YYYY-MM" /></label><label>{lbl('Amount, $')}<input id="narep-amt" className="vin" inputMode="decimal" placeholder="0.00" /></label><label>{lbl('Note')}<input id="narep-note" className="vin" placeholder="What it is" /></label><label>{lbl('Evidence')}<input id="narep-ev" className="vin" placeholder="A link or reference" /></label><p className="small quiet" id="narep-warn">{`Up to ${money(room)}: the advances outstanding, less what’s already entered. Paid under RECOVERY, all of it to the Credit Backstop.`}</p><button className="btn" data-narep="">Enter it</button></div> : '';
      const ix = A.interchange ?? [];
      const ixList = ix.length ? <div className="led">{ix.map(x => <div key={x.month}><span>{`${afMonth(x.month)} · ${x.bps / 100}% of ${money(x.interchange)} · ${x.outbox === 'sent' ? 'in the Safe’s queue' : x.outbox === 'queued' ? 'waiting to be put in the Safe (Build → Safe)' : 'batch file'}`}{" "}<button className="lnk" data-naibatch={x.month}>Batch</button></span><b>{money(x.amount)}</b></div>)}</div> : <p className="small quiet">No interchange proposed yet.</p>;
      const inter = <div className="npf">{lbl('Interchange · the co-op treasury’s')}{ixList}{CAN() && !A.demo ? <><label>{lbl('Month')}<input id="naint-month" className="vin" defaultValue={afLast()} placeholder="YYYY-MM" /></label><label>{lbl('The month’s card interchange, $')}<input id="naint-amt" className="vin" inputMode="decimal" placeholder="0.00" /></label><p className="small quiet" id="naint-x">{`${A.interchangeBps / 100}% of it goes in: approve and deposit(INTERCHANGE), signed by the Clear Treasury Safe’s owners.`}</p><button className="btn" data-naint="">Propose to the Clear Treasury Safe</button></> : ''}</div>;
      const side = cell('s5', 'Repayments and interchange', <span className="lbl">Into the pool</span>, <div className="npd">{repay}{inter}</div>, <><span>Nothing moves until the Safe’s signers sign</span><span /></>);
      return band(<>{fees}{side}</>);
    }
    /* Automatic top-ups (decision 51, docs/operators/payout-topups.md): the top-up wallet pulls from CL Operating under a Safe
       AllowanceModule limit, then approve + PayoutPool.fund. It moves only when 14 days is short, refills to 30 days + $100. */
    const TU = {
      cap: 5000,
      used: 0,
      resets: 'Mon 26 Oct · 00:00 UTC',
      margin: 100,
      op: M.clOp,
      last: '6 min ago',
      wallet: '0xC0C4…5068',
      hist: [[-23, 'Top-up #1', '14-day low-water', 2960.40, 'funded']]
    };
    TU.refill = () => M.standShort + TU.margin;
    /* Assurance fees (docs/operators/assurance-fee-payer.md): 8% a year on average daily Available Coverage, actual/365. Each item goes
       Due → Funding proposed (CL Operating → CL Fees, signed by the Clear Lending Safe) → Funded → Paid (the CL Fees wallet deposits it). */
    const AFD = {
      bps: 800,
      oct: {
        read: 20,
        days: 31,
        avg: 1094.10
      },
      items: [{
        id: 'af-sep',
        m: 'Sep',
        month: 'September 2026',
        avg: 1046.20,
        days: 30,
        amt: 6.87,
        st: 0
      }, {
        id: 'af-aug',
        m: 'Aug',
        month: 'August 2026',
        avg: 980.00,
        days: 31,
        amt: 6.65,
        st: 3
      }],
      ix: [['September', '1,284.40', 321.10, 'Deposited · Clear Treasury Safe signed 5 Oct']]
    };
    AFD.soFar = () => Math.floor(AFD.oct.read * AFD.oct.avg * AFD.bps / 1e4 / 365 * 100) / 100;
    const AFD_ST = ['Due', 'Funding proposed', 'Funded', 'Paid'];
    function poolPay() {
      // live, the shops' payouts in the schedule's next 14 days
      const q = L ? FLOWS.filter(f => f[1] === 'out' && f[0] <= 14).map(f => [f[0], f[3], f[2]]) : [[1, 'Rosa’s Panadería', 412.60], [12, 'Monthly run · 11 shops', 9510.65], [14, 'Arrowhead Nails', 732.00], [14, 'Cajon Phone Repair', 2184.00]];
      let run = 0;
      const a = L && !L.flowsReal ? notReal('s7', 'Claims, deadline first', 'Needs the PayoutPool’s claims: each shop owed for a financed sale, how much and when it’s due.') : cell('s7', 'Claims, deadline first', <span className="lbl">{L ? `PayoutPool · ${srcTxt('protocol')}` : 'PayoutPool · Protocol · 12 s'}</span>, L && !q.length ? <div className="lv-e"><span>Nothing is owed to shops in the next 14 days</span></div> : <div className="nq">{q.map(([d, k, v], i) => {
          const s = run;
          run += v;
          const cov = Math.max(0, Math.min(v, M.payout - s)),
            same = i && q[i - 1][0] === d;
          const grp = q[i + 1] && q[i + 1][0] === d;
          return <div key={i} className={`nq-r ${same ? 'same' : ''} ${grp ? 'grp' : ''}`}><span className="nq-d">{same ? <i className="tie" aria-hidden="true" /> : leaf(d)}</span><span className="nq-k"><b>{k}</b><span>{cov >= v ? 'Funded now' : cov > 0 ? `${money(cov)} funded now · Clear Lending funds the rest` : 'Clear Lending funds it by its deadline'}</span></span><span className="nq-b"><i style={css(`width:${cov / v * 100}%`)} /></span><b>{money(v)}</b></div>;
        })}</div>, <><span className="f-key"><i style={css("background:var(--fg)")} />{"Funded now "}<i className="hx" />Clear Lending funds it by its deadline</span><button data-ngo="merchants/payouts">Payouts →</button></>);
      /* live: the reference's keeper and top-up wallet, from the chain and the top-up job's record. The keeper's level is
         payoutFunding/fundingStatus.ts's: Red when claims due within two business days are short (12.10), Amber when the
         PayoutPool holds less than what's due within 30 days (decision 49). Where the money can come from is information only */
      if (L) {
        const T = vars.payoutTopUps,
          ds = vars.payoutDueSoon;
        const stand = M.due30 == null ? null : Math.max(0, M.due30 - M.payout),
          red = (ds?.short ?? 0) > 0;
        const lv = red ? ['Red', 'var(--absent)'] : stand == null ? ['Not read', 'var(--fg-50)'] : stand ? ['Amber', 'var(--underway)'] : ['Green', 'var(--settled)'];
        const headroom = Math.max(0, (Y.lent + Y.cash) * 0.9 - Y.lent);
        const opts = [['Yield Pool Deployment', money(headroom), 'Up to 90% deployed · two Deployment signers'], ['BondVault excess', money(Math.max(0, M.bv - BV_NEED())), 'Through the Collateral Agent'], ['Co-op treasury allowance', 'Not read yet', 'treasuryAvailable']];
        const b = cell('s5', 'Payout funding keeper', <span className="lbl">Hourly · read-only</span>, <div className="npd"><div className="ngt-top"><div className="m-big">{stand == null ? '—' : money(stand)}{" "}<small>{stand == null ? 'what’s due in 30 days isn’t read yet' : 'top-up that restores the standing balance'}</small></div><span className="fst" style={css(`color:${lv[1]};box-shadow:inset 0 0 0 1px ${lv[1]}`)}>{lv[0]}</span></div><div className="led">{[['Deadline rule', ds ? red ? `${money(ds.short)} short within ${ds.businessDays} business days` : `Met · ${ds.businessDays} business days ahead` : 'Not read yet'], ['Standing balance', M.due30 == null ? money(M.payout) : `${money(M.payout)} of ${money(M.due30)} due`], ['Within 14 days', `${money(M.short)} from Clear Lending`]].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{lbl('Where the money can come from · information only')}<div className="led ncb-l">{opts.map(([k, v, sub], i) => <div key={i}><span><i className="nsw" style={css(`background:${['var(--live)', 'color-mix(in srgb,var(--fg) 45%,transparent)', 'var(--land)'][i]}`)} />{k}<em>{sub}</em></span><b>{v}</b></div>)}</div></div>, <><span>Alerts ops when Amber or Red · moves nothing</span>{CAN() ? <button className="btn sm-b" data-npropose="topup">Propose a Deployment</button> : <span />}</>);
        const c = T ? cell('s7', 'Automatic top-ups', ...topUpsParts(T, money)) : notReal('s7', 'Automatic top-ups', 'Needs the payout top-up job (PAYOUT_TOPUP_ENABLED) to have checked the PayoutPool: its projections, the spending limit and each top-up it made.');
        const d = T ? cell('s5', 'The top-up wallet', <span className="lbl">CDP · payout-topup</span>, <div className="npd"><div className="led">{[['Address', <span className="mono">{T.wallet}</span>], ['Pulls from', <span className="mono">{T.safe}</span>], ['It can', 'Pull from CL Operating, approve, fund'], ['It never', 'Withdraws, or calls anything else'], ['Holds between top-ups', 'No USDC · gas only']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{lbl('Turning it off')}<div className="led">{[['Pause the job', <span className="mono">PAYOUT_TOPUP_ENABLED=0</span>], ['Cut it off on chain', 'CL Operating drops the delegate'], ['Key in doubt', 'Also revoke FUNDER_ROLE']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>, <><span>Only CL Operating’s owners can change the limit</span><button data-ngo="build/security">Security →</button></>) : notReal('s5', 'The top-up wallet', 'Needs the payout top-up job’s record: its wallet and the Safe it pulls from.');
        return <>{band(<>{a}{b}</>)}{band(<>{c}{d}</>)}</>;
      }
      const lv = M.standShort ? ['Amber', 'var(--underway)'] : ['Green', 'var(--settled)'];
      const opts = [['Yield Pool Deployment', Y.headroom, 'Up to 90% deployed · two Deployment signers'], ['BondVault excess', Math.max(0, M.bv - BV_NEED()), 'Through the Collateral Agent'], ['Co-op treasury allowance', M.treasuryAllow, 'treasuryAvailable · none set']];
      const b = cell('s5', 'Payout funding keeper', <span className="lbl">Hourly · read-only</span>, <div className="npd"><div className="ngt-top"><div className="m-big">{money(M.standShort)}{" "}<small>top-up that restores the standing balance</small></div><span className="fst" style={css(`color:${lv[1]};box-shadow:inset 0 0 0 1px ${lv[1]}`)}>{lv[0]}</span></div><div className="led">{[['Deadline rule', 'Met · 2 business days ahead'], ['Standing balance', `${money(M.payout)} of ${money(M.due30)} due`], ['Next deadline', `Mon 2 Nov · ${money(M.short)} from Clear Lending`]].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{lbl('Where the money can come from · information only')}<div className="led ncb-l">{opts.map(([k, v, sub], i) => <div key={i}><span><i className="nsw" style={css(`background:${['var(--live)', 'color-mix(in srgb,var(--fg) 45%,transparent)', 'var(--land)'][i]}`)} />{k}<em>{sub}</em></span><b>{money(v)}</b></div>)}</div></div>, <><span>Alerts ops when Amber or Red · moves nothing</span><button className="btn sm-b" data-npropose="topup">Propose a Deployment</button></>);
      const need = TU.refill(),
        left = TU.cap - TU.used,
        ready = TU.op >= need;
      const c = cell('s7', 'Automatic top-ups', <span className="fst" style={css("color:var(--underway);box-shadow:inset 0 0 0 1px var(--underway)")}>{ready ? 'Moves next check' : 'Waiting on CL Operating'}</span>, <div className="npd"><div className="m-big">{money(need)}{" "}<small>{"next top-up · 30 days due plus a "}{money0(TU.margin)}{" margin"}</small></div>{ready ? '' : <p className="nau-w"><b>{"CL Operating holds "}{money(TU.op)}</b>{", short of the refill, so it moved nothing and emailed ops once. The Deployment in Moves brings it to "}{money(TU.op + M.short)}; the next check after it lands moves the lot.</p>}<div className="led">{[['Due within 14 days · moves if short', `${money(M.owed14)} · ${money(M.short)} short`], ['Due within 30 days · refills to', `${money(M.due30)} + ${money0(TU.margin)}`], ['Spending limit · weekly, set on CL Operating', `${money(TU.used)} of ${money0(TU.cap)} used`], ['Limit resets', TU.resets], ['In CL Operating', money(TU.op)], ['Last check', `${TU.last} · every 15 min`]].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{lbl('Recent top-ups')}<div className="nau-l">{TU.hist.map(([dd, k, trig, v], __k) => <div key={__k} className="nau-r">{leaf(dd)}<span><b>{k}{" · "}{trig}</b><span>{"Funded · "}<a>pull</a>{" · "}<a>approve</a>{" · "}<a>fund</a></span></span><b>{money(v)}</b></div>)}</div></div>, <><span>{"Never more than "}{money0(left)}{" this week · any revert stops it until someone clears it"}</span><button data-ntab="moves">Moves →</button></>);
      const d = cell('s5', 'The top-up wallet', <span className="lbl">CDP · payout-topup</span>, <div className="npd"><div className="led">{[['Address', <span className="mono">{TU.wallet}</span>], ['It can', 'Pull from CL Operating, approve, fund'], ['It never', 'Withdraws, or calls anything else'], ['Holds between top-ups', 'No USDC · gas only'], ['Pool positions it buys', 'Kept · not redeemed yet']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{lbl('Turning it off')}<div className="led">{[['Pause the job', <span className="mono">PAYOUT_TOPUP_ENABLED=0</span>], ['Cut it off on chain', 'CL Operating drops the delegate'], ['Key in doubt', 'Also revoke FUNDER_ROLE']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>, <><span>Only CL Operating’s owners can change the limit</span><button data-ngo="build/security">Security →</button></>);
      return <>{band(<>{a}{b}</>)}{band(<>{c}{d}</>)}</>;
    }
    /* the yield pool's next 30 days: one Deployment out (in Moves), Returns back as members repay. A Return pays interest first, then principal. */
    const Y_RET = [[5, 640.00], [12, 910.00], [19, 520.00], [26, 480.00]];
    function yieldProjection() {
      const day = Y.borrowBps / 1e4 / 365;
      let dep = Y.lent,
        owed = Y.accrued ?? 0,
        last = 0,
        cash = Y.cash,
        intIn = 0,
        prinIn = 0;
      const rows = [];
      const accrue = d => {
        owed += dep * day * (d - last);
        last = d;
      };
      /* live, only what is known: no Returns are scheduled (Clear Lending returns money as members repay), and the one
         Deployment in view is the PayoutPool's shortfall, needed now */
      const evs = L ? Y.toPayout > 0 ? [{
        d: 0,
        out: Y.toPayout
      }] : [] : Y_RET.map(([d, p]) => ({
        d,
        p
      })).concat([{
        d: 9,
        out: Y.toPayout
      }]).sort((a, b) => a.d - b.d);
      evs.forEach(e => {
        accrue(e.d);
        if (e.out) {
          dep += e.out;
          cash -= e.out;
          rows.push({
            d: e.d,
            k: 'Deployment',
            sub: L ? 'The PayoutPool’s shortfall · two signers' : 'Waiting in Moves · two signers',
            out: e.out,
            cash,
            dep,
            owed
          });
        } else {
          const i = owed,
            p = e.p;
          owed = 0;
          dep -= p;
          cash += i + p;
          intIn += i;
          prinIn += p;
          rows.push({
            d: e.d,
            k: 'Return',
            sub: 'As members repay their credit',
            i,
            p,
            cash,
            dep,
            owed
          });
        }
      });
      accrue(30);
      /* the same events, day by day, for the chart */
      const days = [];
      {
        let d2 = Y.lent,
          o2 = Y.accrued ?? 0,
          c2 = Y.cash;
        const ev = {};
        evs.forEach(e => ev[e.d] = e);
        for (let t = 0; t <= 30; t++) {
          if (t) o2 += d2 * day;
          const e = ev[t];
          if (e) {
            if (e.out) {
              d2 += e.out;
              c2 -= e.out;
            } else {
              c2 += o2 + e.p;
              d2 -= e.p;
              o2 = 0;
            }
          }
          days.push({
            t,
            cash: c2,
            dep: d2,
            owed: o2
          });
        }
      }
      return {
        rows,
        intIn,
        prinIn,
        dep,
        cash,
        owed,
        assets: cash + dep + owed,
        days
      };
    }
    /* a month of Clear Lending's income on the unsecured book (rate-schedule.json, monthly bps; MR-02 2.5% merchant fee), and where it goes */
    const CARRY = [['Income tier', 150, 2600.00, 0.45, '1.5% a month'], ['Boost', 250, 1240.00, 0.70, '2.5% a month'], ['Partner plans', 200, M.unsecured - 3840.00, 0.75, '2% a month · free if paid in full'], ['Savings-backed', 0, M.savingsBacked, 0, 'No carry']];
    const MFEE = {
      rate: 0.025,
      sales: 10689.20
    };
    /* live, one cycle at today's balances: each credit tier's carry on what's drawn in it and the term plans', from the
       issuers (Y.rates); the merchant fees on this month's financed sales, from the charges; the Funding Rate on what's
       deployed; and what was charged off this month. Null until the issuers are read */
    function memberPaymentsLive() {
      const R = Y.rates;
      if (!R) return null;
      const per = bps => `${+(bps / 100).toFixed(2)}% a cycle`;
      const c = R.tiers.map(t => ({
        k: t.name,
        bps: t.bps,
        bal: t.out,
        n: t.bps ? per(t.bps) : 'No carry',
        v: Math.round(t.out * t.bps / 1e4 * 100) / 100
      })).concat(R.term.out ? [{
        k: 'Term plans',
        bps: R.term.bps ?? 0,
        bal: R.term.out,
        n: R.term.bps ? per(R.term.bps) : 'No carry',
        v: Math.round(R.term.out * (R.term.bps ?? 0) / 1e4 * 100) / 100
      }] : []);
      const F = vars.merchantFees,
        carry = c.reduce((a, x) => a + x.v, 0),
        fees = F ? F.fees : 0,
        inc = Math.round((carry + fees) * 100) / 100;
      const dom = new Date(TODAY).getUTCDate() - 1,
        losses = Math.round((CR.losses ?? []).filter(x => -x[0] <= dom).reduce((a, x) => a + x[3], 0) * 100) / 100;
      const pool = Math.round((Y.deployed ?? Y.lent) * Y.borrowBps / 1e4 * R.cycleDays / 365 * 100) / 100,
        spread = Math.round((inc - pool - losses) * 100) / 100;
      return {
        c,
        carry,
        fees,
        F,
        inc,
        pool,
        losses,
        spread
      };
    }
    function memberPayments() {
      const c = CARRY.map(([k, bps, bal, sh, n]) => ({
        k,
        bps,
        bal,
        sh,
        n,
        v: Math.round(bal * sh * bps / 1e4 * 100) / 100
      }));
      const carry = c.reduce((a, x) => a + x.v, 0),
        fees = Math.round(MFEE.sales * MFEE.rate * 100) / 100,
        inc = carry + fees;
      const pool = Math.round(Y.lent * Y.borrowBps / 1e4 / 12 * 100) / 100,
        losses = 0,
        spread = Math.round((inc - pool - losses) * 100) / 100;
      return {
        c,
        carry,
        fees,
        inc,
        pool,
        losses,
        spread
      };
    }
    function poolYield() {
      const yr = bps => (bps / 100).toFixed(2) + '%',
        depAt = u => yApy(yBorrowBps(u) * u) * 100;
      /* live, the rate model as the pool holds it (rateModel()); the demo keeps the reference's words */
      const rateFoot = () => {
        const c = L ? Y.curve : null;
        if (!c || c.r0 == null) return '2% base, +3% to the 80% kink, +5% above · 10% is the ceiling, only if every dollar were lent out';
        const p = f => `${+(f * 100).toFixed(2)}%`;
        return `${p(c.r0)} base, +${p(c.s1)} to the ${p(c.k)} kink, +${p(c.s2)} above · ${p(c.r0 + c.s1 + c.s2)} is the ceiling, only if every dollar were lent out`;
      };
      const sc = [['50%', .5], [`${Math.round(Y.util * 100)}% now`, Y.util], [`${Math.round(Y.utilAfter * 100)}% ${L ? 'in 14 days' : '2 Nov'}`, Y.utilAfter], ['80% · kink', .8], ['90%', .9], ['100%', 1]],
        smx = 10;
      const t = (k, v, n, cls = '') => <div className={cls}>{lbl(k)}<b>{v}</b><span>{n}</span></div>;
      const a = L && !Y.rateAt ? notReal('s7', 'Rate', 'Needs the Yield Pool’s Funding Rate, read by the API from the chain: fundingRate and fundingRateAt at each share lent out.') : cell('s7', 'Rate', <span className="lbl">{"LendingPool · opened "}{Y.opened}</span>, <div className="npd"><div className="ngp-eq">{t('Funding Rate', yr(Y.borrowBps), 'a year · Clear Lending pays it')}<i>×</i>{t('Deployed', pct(Y.lent, Y.assets), `${money(Y.lent)} to Clear Lending`)}<i>=</i>{t('Holders earn', yr(Y.supplyBps), 'a year · before losses', 'hi')}</div>{lbl('Holders earn, by share lent out · Funding Rate × share, before losses')}<div className="nlm wk yr">{sc.map(([k, u], i) => {
            const h = depAt(u) / smx * 100;
            return <div key={i}><b className="yr-t"><span style={css(`bottom:calc(${h}% + 6px)`)}>{depAt(u).toFixed(2)}%</span><i style={css(`height:${h}%`)} className={i === 1 ? 'hi' : 'hx'} /></b><s>{k}</s></div>;
          })}</div></div>, <><span>{rateFoot()}</span><span /></>);
      const b = cell('s5', 'How holders get paid', <span className="lbl">Pool Shares · ERC-4626</span>, <div className="npd"><div className="m-big">${Y.price.toFixed(4)}{" "}<small>{"Share Value · up "}{((Y.price - 1) * 100).toFixed(2)}{"% since "}{Y.opened}</small></div><div className="led">{[['Pool Interest', 'Raises Share Value'], [`Redemptions up to ${money(Y.cash)}`, 'Paid at once, while no one is queued'], ['Above that', 'A strict queue · still earning, still bearing losses'], ['Loss Holdback', L ? Y.holdback == null ? 'Not read yet' : Y.holdback ? `${money(Y.holdback)} held` : 'None open' : 'None open'], ['Pledged to credit', `${money(Y.pledged)} · locked`], ['Earned so far', money(Y.earned)]].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>, <><span>{L && Y.queued ? `Queue: ${money(Y.queued)}` : 'Queue: empty'}</span><span /></>);
      const per = 8,
        rows = Y_DEP.slice(N.dp * per, N.dp * per + per);
      const tbl = cell('s12', 'Holders', <span className="lbl">{Y.depositors}{" members · masked"}</span>, L && !rows.length ? <div className="lv-e"><span>No one holds Pool Shares yet</span></div> : <div className="bt-wrap"><table className="bt ndp"><colgroup><col style={css("width:16%")} /><col style={css("width:12%")} /><col style={css("width:15%")} /><col style={css("width:12%")} /><col style={css("width:15%")} /><col style={css("width:15%")} /><col style={css("width:15%")} /></colgroup><thead><tr><th className="c-nm">Member</th><th style={css("text-align:left")}>Since</th><th>Put in</th><th>Earned</th><th>Worth now</th><th>Pledged</th><th>Can redeem</th></tr></thead><tbody>{rows.map((r, __k) => <tr key={__k}><td className="tn"><b className="mono">M•••{r.id}</b></td><td style={css("text-align:left")}>{r.since}</td><td>{money(r.d)}</td><td>{money(r.e)}</td><td><b>{money(r.w)}</b></td><td>{r.pl ? money(r.pl) : <span className="quiet">None</span>}</td><td className="quiet">{r.pl ? money(r.w - r.pl) : 'All of it'}</td></tr>)}</tbody></table></div>, <><span>{"Names stay masked · "}{money(Y.assets)}{" in all"}</span>{pager(N.dp, Y_DEP.length, per, 'ndp')}</>);
      const P = yieldProjection(),
        prinTot = Y.principal,
        earned = Y.assets - Y.principal;
      /* the loop: money goes right (out), comes back left (Returns); the loss order is a separate question, answered below */
      const node = (k, v, sub, cls = '') => <div className={`ny-nd ${cls}`}><span>{k}</span><b>{v}</b><em>{sub}</em></div>;
      const link = (out, back) => <div className="ny-ln"><div className="ny-o"><em>{out}</em><i /></div><div className="ny-b"><i /><em>{back}</em></div></div>;
      const V = lossVerdict();
      const flow = cell('s12', 'How the pool’s money moves', <span className="lbl">Lending order</span>, <><div className="ny-dg">{node('Holders', money(Y.principal), `${Y.depositors} members put in`)}{link('Subscribe', 'Redeem')}{node('Yield pool', money(Y.assets), `Share Value $${Y.price.toFixed(4)}`, 'me')}{link('Deploy · two signers', 'Return · interest, then principal')}{node('Clear Lending', money(Y.lent), 'Borrowed · owed back')}{link('Lend as credit', 'Repay')}{node('Members', money(M.unsecured), 'Owe on unsecured credit')}</div><div className="ny-ls"><span className="ny-lx">If a member doesn’t repay</span><span>{"Clear Lending takes the loss first: its Spread, Loss Reserve and capital, then the co-op’s backstop, "}{V.partial ? 'at least ' : ''}<b>{money(V.ahead)}</b>{" in all. The pool is last."}</span><button className="lnk" data-ntab="pools" data-npool="yield" data-njump="loss">Loss order ↓</button></div></>, <><span>The pool and the bonds are the funding base · they lend only to Clear Lending, never to housing</span><span /></>);
      // card settlement funding (decision 54): what the funding desk last saw and did, and the Pool Tier principal beside it
      const SF = SETL();
      const sf = SF ? settleSlim(SF, SH()) : notReal('s12', 'Card settlement', 'Needs the settlement funding desk (SETTLEMENT_FUNDING_ENABLED) to have checked.');
      const settle = <>{band(sf)}{band(<PoolTierPrincipal demo={!L} money={money} cls="s12" />)}</>;
      /* one card: what holders put in, what the pool holds, and how that moves over 30 days, as a chart with its events beneath */
      const D = P.days,
        top = Math.max(500, Math.ceil(Math.max(L ? Y.principal : 0, ...D.map(d => d.cash + d.dep + d.owed)) * 1.16 / 500) * 500),
        W = 1000,
        H = 220;
      const X = t => t / 30 * W,
        Yv = v => H - v / top * H,
        pcx = t => (t / 30 * 100).toFixed(3) + '%',
        pcy = v => (Yv(v) / H * 100).toFixed(3) + '%';
      const area = (lo, hi) => 'M' + D.map(d => `${X(d.t)},${Yv(hi(d))}`).join(' L') + ' L' + D.slice().reverse().map(d => `${X(d.t)},${Yv(lo(d))}`).join(' L') + 'Z';
      const step = (lo, hi) => {
        /* events are instant: draw each day as a step */
        const pts = [];
        D.forEach((d, k) => {
          if (k) pts.push([X(d.t), D[k - 1]]);
          pts.push([X(d.t), d]);
        });
        return 'M' + pts.map(([x, d]) => `${x},${Yv(hi(d))}`).join(' L') + ' L' + pts.slice().reverse().map(([x, d]) => `${x},${Yv(lo(d))}`).join(' L') + 'Z';
      };
      const earnedNow = Y.assets - Y.principal,
        earned30 = P.assets - Y.principal;
      /* the demo's grid is the reference's; live, five lines fitted to the pool */
      const gk = v => v >= 1000 ? '$' + +(v / 1000).toFixed(1) + 'k' : '$' + Math.round(v);
      const gl = (L ? [0, .25, .5, .75, 1].map(f => f * top) : [0, 2500, 5000, 7500, 10000].filter(v => v <= top)).map((v, __k) => <Fragment key={__k}><span className="yc-g" style={css(`top:${pcy(v)}`)}>{L ? gk(v) : v ? '$' + v / 1000 + 'k' : '$0'}</span><i className="yc-gl" style={css(`top:${pcy(v)}`)} /></Fragment>);
      const lineTop = Math.max(Y.principal, P.assets);
      const marks = P.rows.map((r, __k) => <i key={__k} className={`yc-m${r.out ? ' out' : ''}`} style={css(`left:${pcx(r.d)}${r.out ? '' : `;top:${pcy(lineTop)}`}`)} />);
      /* money out sits above the chart, money back below it */
      const chip = r => <div className={`yc-e${r.out ? ' out' : ''}`} style={css(`left:${pcx(r.d)}`)}><span>{dayD(r.d)}{" · "}{r.out ? 'Deployment' : 'Return'}</span><b>{r.out ? '−' : '+'}{money(r.out || r.i + r.p)}</b><em>{r.out ? 'Out to Clear Lending' : <>{money(r.i)}{" interest"}<br />{money(r.p)}{" principal"}</>}</em></div>;
      const chips = P.rows.filter(r => !r.out).map(chip),
        outs = P.rows.filter(r => r.out).map(chip);
      const proj = cell('s12', 'The pool, now and over the next 30 days', <span className="lbl">{"Projected at a "}{(Y.borrowBps / 100).toFixed(2)}{"% Funding Rate · "}{L ? P.rows.length ? `${P.rows.length} Deployment, the PayoutPool’s shortfall · no Returns scheduled` : 'nothing scheduled' : `${Y_RET.length} Returns, 1 Deployment`}</span>, <><div className="yp-top">{[['Holders put in', money(Y.principal), 'Returns don’t change it'], ['Pool Assets', money(Y.assets), `${money(P.assets)} in 30 days`], ['Earned on top', money(earnedNow), `${money(earned30)} in 30 days`], ['Share Value', `$${Y.price.toFixed(4)}`, `$${(L ? Y.price * (Y.assets ? P.assets / Y.assets : 1) : P.assets / Y.principal).toFixed(4)} in 30 days`]].map(([k, v, n], __k) => <div key={__k}><span>{k}</span><b>{v}</b><em>{n}</em></div>)}</div><div className="yc"><div className="yc-ev up">{outs}</div><div className="yc-plot">{gl}<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"><defs><pattern id="ycHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="color-mix(in srgb,var(--settled) 12%,var(--ground))" /><rect width="2" height="6" fill="color-mix(in srgb,var(--settled) 62%,var(--ground))" /></pattern></defs><path className="yc-cash" d={step(d => 0, d => d.cash)} /><path className="yc-dep" d={step(d => d.cash, d => d.cash + d.dep)} /><path className="yc-own" d={step(d => d.cash + d.dep, d => d.cash + d.dep + d.owed)} /><line x1="0" x2={W} y1={Yv(Y.principal)} y2={Yv(Y.principal)} className="yc-pr" vectorEffect="non-scaling-stroke" /></svg>{marks}<span className="yc-pl" style={css(`top:${pcy(lineTop)}`)}>{"Holders’ principal "}{money(Y.principal)}</span><span className="yc-er" style={css(`top:${pcy(lineTop)}`)}><b>+{money(earned30)}</b>{" earned by "}{dayD(30)}</span><span className="yc-lb c" style={css(`top:${pcy(D[0].cash / 2)};left:14px`)}><em>Vault Cash</em>{money(Y.cash)}</span>{!L || D[0].dep ? <span className="yc-lb h" style={css(`top:${pcy(D[0].cash + D[0].dep / 2)};left:14px`)}><em>Lent to Clear Lending</em>{money(Y.lent)}</span> : ''}<span className="yc-lb c r" style={css(`top:${pcy(D[30].cash / 2)};right:14px`)}><em>{dayD(30)}</em>{money(D[30].cash)}</span>{!L || D[30].dep ? <span className="yc-lb h r" style={css(`top:${pcy(D[30].cash + D[30].dep / 2)};right:14px`)}><em>{dayD(30)}</em>{money(D[30].dep)}</span> : ''}</div><div className="yc-x">{[0, 7, 14, 21, 30].map((t, __k) => <span key={__k} style={css(`left:${pcx(t)}`)}>{t ? dayD(t) : 'Today · ' + dayD(0)}</span>)}</div><div className="yc-ev">{chips}</div></div></>, <><span className="f-key"><span><i className="yc-k1" />Vault Cash · in hand</span><span><i className="yc-k2" />Lent to Clear Lending · owed back</span><span><i className="yc-k3" />Interest owed</span><span><i className="yc-kd" />Holders’ principal</span></span><span className="quiet small yc-note">Returns follow member repayments</span></>);
      const MP = L ? memberPaymentsLive() : memberPayments(),
        scale = MP ? Math.max(MP.inc, MP.pool + MP.losses) : 0,
        Wp = v => (scale ? Math.max(0, v) / scale * 100 : 0).toFixed(3) + '%';
      const LAND = ['var(--land)', 'color-mix(in srgb,var(--land) 70%,var(--ground))', 'color-mix(in srgb,var(--land) 45%,var(--ground))', 'color-mix(in srgb,var(--land) 28%,var(--ground))'];
      const inSeg = !MP ? [] : (L ? MP.c.filter(x => x.bal > 0 || x.bps > 0) : MP.c.filter(x => x.v > 0)).map((x, i) => ({
        k: x.k,
        v: x.v,
        sub: L ? `${x.n} on ${money0(x.bal)} drawn` : `${x.n} · ${Math.round(x.sh * 100)}% of ${money0(x.bal)} carried`,
        c: LAND[Math.min(i, LAND.length - 1)]
      })).concat([{
        k: 'Merchant fees',
        v: MP.fees,
        sub: L ? MP.F ? MP.F.count ? `${pct(MP.F.fees, MP.F.financed)} of ${money(MP.F.financed)} financed this month` : 'Nothing financed this month' : 'The charges aren’t read yet' : `2.5% of ${money(MFEE.sales)} financed`,
        c: 'var(--underway)'
      }]);
      const outSeg = !MP ? [] : [{
        k: 'Holders’ interest',
        v: MP.pool,
        sub: `${(Y.borrowBps / 100).toFixed(2)}% a year on ${money0(L ? Y.deployed ?? Y.lent : Y.lent)} ${L ? 'deployed' : 'lent out'}`,
        c: 'var(--live)'
      }, {
        k: 'Clear Lending’s Spread',
        v: MP.spread,
        sub: 'Its costs, then the first loss',
        c: 'var(--fg)'
      }];
      const bar = segs => <div className="wp-bar">{segs.filter(x => x.v > 0).map((x, __k) => <i key={__k} style={css(`width:${Wp(x.v)};background:${x.c}`)} title={`${x.k} · ${money(x.v)}`} />)}</div>;
      const legend = segs => <div className="wp-lg">{segs.map((x, __k) => <div key={__k}><i style={css(`background:${x.c}`)} /><span><b>{x.k}</b><em>{x.sub}</em></span><strong>{money(x.v)}</strong></div>)}</div>;
      const pay = L && !MP ? notReal('s12', 'Where member payments go', 'Needs the credit issuers’ tiers: each one’s carry and what’s drawn in it.') : cell('s12', 'Where member payments go', <span className="lbl">{L ? `One cycle · ${MP.c.length ? 'the issuers’ rates at today’s balances' : 'nothing drawn yet'}` : 'One month · the deployed rate schedule · demo balances'}</span>, <><div className="wp"><div className="wp-col"><div className="wp-h"><span>Comes in to Clear Lending</span><b>{money(MP.inc)}</b></div>{bar(inSeg)}{legend(inSeg)}</div><div className="wp-mid" aria-hidden="true"><svg viewBox="0 0 12 20"><path d="M2 2l8 8-8 8" /></svg></div><div className="wp-col"><div className="wp-h"><span>Goes out</span><b>{money(MP.inc)}</b></div>{bar(outSeg)}{legend(outSeg)}<p className="wp-n">{"Holders get "}{L && !MP.inc ? '—' : pct(MP.pool, MP.inc, 0)}{" of it. They don’t share in carry or fees: Clear Lending keeps the Spread and takes every loss before the pool does. Charged off this month: "}{money(MP.losses)}.</p></div></div><div className="wp-af"><span className="wp-afh">Then the Spread</span>{[['1', 'Bills and reserves first', 'Expenses, bonds due, pool interest, reserves, the Assurance fee · L-01 9.2'], ['2', 'Kept as capital', 'More member and merchant lending, and the fourth loss layer'], ['3', 'Or paid to Holdings', 'Only if reserves, coverage and licences pass · L-01 12.2'], ['4', 'Split by shares', 'The co-op’s Class A and investors’ Class B alike · Holdings funds Clear Building Co. for homes']].map(([n, k, t], i) => <div key={i} className="wp-as"><b><i>{n}</i>{k}</b><span>{t}</span></div>)}</div></>, <><span>Many members pay in full and owe no carry · savings-backed lines carry none</span><button data-npool="ap" data-ntab="pools">Loss order →</button></>);
      return <>{band(flow)}{band(pay)}{band(proj)}{settle}{band(<>{a}{b}</>)}{band(tbl)}</>;
    }
    function poolBonds() {
      // live, the ten months from this one, each bond by when it matures
      const m0 = new Date(TODAY),
        ym = i => [new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + i, 1)).getUTCFullYear(), new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + i, 1)).getUTCMonth()];
      const mons = L ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => MON(Date.UTC(...ym(i), 1) / DAY - TODAY / DAY)) : ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
        by = L ? mons.map((_, i) => BONDS.filter(b => b[8] != null && new Date(b[8]).getUTCFullYear() === ym(i)[0] && new Date(b[8]).getUTCMonth() === ym(i)[1]).reduce((a, b) => a + b[1], 0)) : mons.map(m => BONDS.filter(b => b[3].endsWith(m)).reduce((a, b) => a + b[1], 0)),
        bmx = L ? Math.max(1, ...by) : Math.max(...by),
        hi0 = L ? by.findIndex(v => v > 0) : 0;
      const a = cell('s7', 'Bond ladder', <span className="lbl">Face value by month it matures</span>, <div className="npd"><div className="m-big">{money(M.bonds)}{" "}<small>{"across "}{BONDS.length}{" bonds, each its own token"}</small></div><div className="nlm wk lad">{mons.map((m, i) => <div key={i}><span>{by[i] ? '$' + (by[i] / 1000).toFixed(1) + 'k' : ''}</span><i style={css(`height:${by[i] / bmx * 100}%`)} className={i === hi0 ? 'hi' : by[i] ? 'hx' : 'z'} /><s>{m}</s></div>)}</div></div>, <><span>Zero-coupon · rates are internal, never exported</span><span /></>);
      const due = soon90(),
        dueN = ['No bonds', 'one bond', 'two bonds', 'three bonds', 'four bonds', 'five bonds'][due.length] || `${due.length} bonds`;
      const b = cell('s5', 'Due in 90 days', <span className="lbl">{L ? `Through ${dayD(90)}` : 'Through 21 Jan'}</span>, <div className="npd"><div className="m-big">{money(L ? due.reduce((a, x) => a + x[1], 0) : 7500)}{" "}<small>{L ? `${dueN} · BondVault keeps ` : "two bonds · BondVault keeps "}{money(Math.min(M.bv, BV_NEED()))}{" back for them"}</small></div><div className="nl">{(L ? due : BONDS.filter(x => x[4] <= 92)).map((x, __k) => <div key={__k} className="nl-r">{leaf(x[4])}<span><b>{x[0]}</b><span>{x[7] || 'Bondholder'}{" · "}{rel(x[4])}</span></span><b>{money(x[1])}</b></div>)}</div></div>, <><span>{L ? `BondVault keeps back: ${L.bvRule.charAt(0).toLowerCase()}${L.bvRule.slice(1)}` : 'BondVault keeps 30% of all owed, or what’s due in 90 days'}</span><span /></>);
      const byDue = BONDS.slice().sort((a, b) => a[4] - b[4]);
      const tbl = cell('s12', 'Every bond', <span className="lbl">{L ? `${BONDS.length} BurnerBond${BONDS.length === 1 ? '' : 's'}` : '6 BurnerBonds'}</span>, L && !BONDS.length ? <div className="lv-e"><span>No bonds issued yet</span></div> : <div className="bt-wrap"><table className="bt nbd"><colgroup><col style={css("width:14%")} /><col style={css("width:14%")} /><col style={css("width:12%")} /><col style={css("width:12%")} /><col style={css("width:22%")} /><col style={css("width:10%")} /><col style={css("width:16%")} /></colgroup><thead><tr><th className="c-nm">Bond</th><th>Face value</th><th style={css("text-align:left")}>Issued</th><th style={css("text-align:left")}>Matures</th><th style={css("text-align:left")}>Term</th><th>Rate</th><th style={css("text-align:left")}>Holder</th></tr></thead><tbody>{BONDS.map((x, __k) => <tr key={__k}><td className="tn"><b className="mono">{x[0]}</b></td><td>{money(x[1])}</td><td style={css("text-align:left")}>{x[2]}</td><td style={css("text-align:left")}>{x[3]}</td><td style={css("text-align:left")}><span className="nbd-t"><span><i style={css(`width:${x[5] / 12 * 100}%`)} /></span>{x[5]}{" mo"}</span></td><td>{x[6].toFixed(1)}%</td><td style={css("text-align:left")}>{x[7]}</td></tr>)}</tbody></table></div>, <><span>{L ? byDue.length ? `Next maturity ${byDue[0][3]} · last ${byDue[byDue.length - 1][3]}` : 'No bonds yet' : 'Next maturity 14 Dec · last 15 Sep'}</span><span /></>);
      return <>{band(<>{a}{b}</>)}{band(tbl)}</>;
    }

    /* ══ Moves: propose, approve, history ═════════════════════════════════════════════ */
    function renderMoves() {
      const w = pend();
      const row = m => {
        const mine = m.by === N.me,
          me = forMe().includes(m);
        return <div className={`nmv-r ${me ? 'me' : ''}`}>{leaf(m.d)}<span className="nmv-k"><b>{m.t}</b><span>{PLACES[m.from] || acctOf(m.from)?.[1] || m.from}{" → "}{PLACES[m.to] || m.to}{" · "}{mine ? 'you' : PPL[m.by].f}{" proposed "}{rel(m.d)}{m.due != null ? ' · due ' + dayD(m.due) : ''}</span></span><b className="nmv-v">{money(m.amt)}</b><span className="nmv-a">{m.st === 'merchants' ? <><span className="who">Needs a second person</span><button className="lnk" data-nrosa="">Review →</button></> : me ? <button className="btn sm-b p" data-nopen={m.id}>Review</button> : mine ? <><span className="who">{"Waiting on "}{waitOn(m)}</span><button className="lnk3" data-nwithdraw={m.id}>Take it back</button></> : <span className="who">{"Waiting on "}{m.wait ? firstN(m.wait) : 'a signer'}</span>}</span></div>;
      };
      const wc = cell('s8', 'Waiting for a second person', <>{CAN() ? <button className="btn p sm-b" data-npropose="topup">+ Propose a move</button> : <span className="lbl">{w.length}{" waiting"}</span>}</>, <div className="nmv">{w.length ? <>{w.map(m => <Fragment key={m.id}>{row(m)}</Fragment>)}<div className="nmv-end">Nothing else is waiting</div></> : <p className="nmv-e">Nothing is waiting.</p>}</div>, <><span>Proposing and approving are both logged in Records</span><button data-ngo="records">Records →</button></>);
      // live, the Ops Safe's own owners and threshold (GET /safe)
      const sf = L && L.safe,
        anyN = n => ['none', 'one', 'two', 'three', 'four', 'five'][n] || String(n);
      const rules = L ? cell('s4', 'How money moves', <span className="lbl">{L ? sf ? `Ops Safe · ${sf.threshold} of ${sf.owners.length}` : 'Ops Safe · not connected' : 'Ops Safe · 2 of 3'}</span>, <div className="nru">{lbl(L ? sf ? `Signers · any ${anyN(sf.threshold)}` : 'Signers' : 'Signers · any two')}{L && !L.signers.length ? <p className="nmv-e">{sf ? 'The Safe has no owners.' : 'The Ops Safe isn’t connected here yet.'}</p> : ''}<div className="nru-l">{(L ? L.signers : ['kai', 'dana', 'board']).map((k, __k) => <div key={__k} className={`nru-p ${k === N.me ? 'me' : ''}`}><span className="av sm">{PPL[k].ini}</span><b>{k === N.me ? 'You' : PPL[k].n}</b><span>{PPL[k].role}</span><em>{k === N.me ? 'Signed in' : ''}</em></div>)}</div>{lbl('Rules')}<div className="led">{(L ? [['Who proposes', 'Anyone with Propose in Money'], ['Who approves', 'Someone else with Approve'], ['Then it’s signed', 'In the Ops Safe'], ['Spending the co-op balance', 'A member vote']] : [['Who proposes', 'Any signer'], ['Who approves', 'A different signer'], ['Crossing to a bank', 'Always two people'], ['Spending the co-op balance', 'A member vote']]).map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{lbl('Runs on its own')}<div className="nru-a">{['Yield Pool redemptions, up to its Vault Cash', 'Payouts to shops, soonest deadline first', 'Payout pool top-ups, within CL Operating’s weekly limit', 'Assurance fees, once Clear Lending’s signers fund them'].map((t, __k) => <span key={__k}>{t}</span>)}</div></div>, <><span>Set in Permissions</span><button data-ngo="team">Permissions →</button></>) : cell('s4', 'How money moves', <span className="lbl">Two signers</span>, <div className="nru">{lbl('Signers · any two')}<div className="nru-l">{['kai', 'dana', 'board'].map((k, __k) => <div key={__k} className={`nru-p ${k === N.me ? 'me' : ''}`}><span className="av sm">{PPL[k].ini}</span><b>{k === N.me ? 'You' : PPL[k].n}</b><span>{PPL[k].role}</span><em>{k === N.me ? 'Signed in' : ''}</em></div>)}</div>{lbl('Rules')}<div className="led">{[['Who proposes', 'Any signer'], ['Who approves', 'A different signer'], ['Crossing to a bank', 'Always two people'], ['Spending the co-op balance', 'A member vote']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{lbl('Runs on its own')}<div className="nru-a">{['Yield Pool redemptions, up to its Vault Cash', 'Payouts to shops, soonest deadline first', 'Payout pool top-ups, within CL Operating’s weekly limit', 'Assurance fees, once Clear Lending’s signers fund them'].map((t, __k) => <span key={__k}>{t}</span>)}</div></div>, <><span>Set in Permissions</span><button data-ngo="team">Permissions →</button></>);
      const F = {
        all: ['All', N.done],
        people: ['By people', N.done.filter(x => x.by)],
        auto: ['Automatic', N.done.filter(x => x.auto)]
      };
      const list = F[N.mf][1],
        per = 6,
        pages = Math.max(1, Math.ceil(list.length / per));
      N.mp = Math.min(N.mp, pages - 1);
      const hist = cell('s12', 'Done', <div className="seg sm" role="group" aria-label="Show">{Object.entries(F).map(([k, [t, a]], __k) => <button key={__k} data-nmf={k} aria-pressed={N.mf === k}>{t}{" "}{a.length}</button>)}</div>, L && !list.length ? <div className="lv-e"><span>{N.mf === 'all' ? 'No moves in the last 30 days' : N.mf === 'people' ? 'Nobody proposed a move in the last 30 days' : 'Nothing moved on its own in the last 30 days'}</span></div> : <div className="nd">{list.slice(N.mp * per, N.mp * per + per).map((x, __k) => <div key={__k} className={`nd-r ${x.no ? 'no' : ''}`}>{leaf(x.d)}<span className="nd-k"><b>{x.t}</b><span>{x.from}{" → "}{x.to}</span></span><span className="nd-w">{x.auto ? <><span className="nd-auto">Automatic</span><span>{x.auto}</span></> : x.no ? <><span>{firstN(x.by)}{" proposed · "}<b className="bad">{firstN(x.no)}{" rejected"}</b></span><span>{x.why}</span></> : <><span>{firstN(x.by)}{" proposed · "}{firstN(x.ok)}{" approved"}</span><span>{L ? 'Approved here · then signed in the Ops Safe' : /Yield pool/.test(x.from) ? 'Two Deployment signers' : x.from === 'BondVault' ? 'Two treasury signers, through the Collateral Agent' : 'Signed in the Ops Safe'}</span></>}</span><b className={`nd-v ${x.no ? 'quiet' : ''}`}>{money(x.amt)}</b><span className="nd-tx">{x.tx ? <span className="mono">{x.tx}</span> : <span className="quiet">{L && x.ok ? 'For the Safe' : 'Not sent'}</span>}</span></div>)}</div>, <><span>Last 30 days</span>{pager(N.mp, list.length, per, 'nmp')}</>);
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
    /** Live, the facts for Member cash and Clear Lending's accounts: their addresses on chain, or that nothing reads them yet. */
    function clFacts() {
      const C = L.CL || {},
        at = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : 'Not set',
        lithic = ['Balance', 'Not connected yet · Lithic isn’t wired to Command'];
      return {
        cash: [lithic, ['Held for', 'Members, in their own names'], ['Held by', 'The Bank Partner · Clear Financial services it'], ['Never funds', 'Card credit · I-02 4.9(b)']],
        clop: [['Owned by', 'Clear Lending Co. · through the Clear Lending Safe'], ['Address', at(C.clop)], ['Comes in', 'Yield Pool Deployments, BondVault excess'], ['Goes out', 'Payout top-ups, Assurance fee funding, card settlement funding']],
        clset: [lithic, ['Owned by', 'Clear Lending Co. · Clear Financial runs it as servicer'], ['Funded to', SETL()?.verdict ? `${money(SETL().verdict.target)} · what is due at the next cut-off plus the buffer` : 'What is due at the next cut-off plus the buffer'], ['Pays', 'The credit part of each card swipe']],
        cllr: [['Owned by', 'Clear Lending Co. · its own Safe'], ['Address', C.cllr ? `${at(C.cllr)}${C.cllrFrom === 'config' ? ' · the rollout’s; the pool names it after its Assurance batch runs' : ''}` : 'Not set'], ['Takes losses', 'After the month’s Spread, before the Credit Backstop'], ['Receives', 'Backstop draws, once two signers release them']],
        clfee: [['Address', at(C.clfee)], ['Holds', 'Only what CL Operating sends it to pay'], ['Pays', 'Credit Enhancement Fees and recoveries into the Credit Backstop'], ['Between payments', 'Empty, by design']]
      };
    }
    function acctPanel(id) {
      const [, n, why, g, src, bal, wk, col] = acctOf(id),
        mx = Math.max(...wk) * 1.1 || 1;
      const nb = BONDS.filter(x => Number.isFinite(x[4]) && x[4] >= 0).sort((a, b) => a[4] - b[4])[0];
      const facts = L ? {
        sav: [['Active members', String(M.members)], ['Tied to credit', money(M.savingsBacked)], ['Free to withdraw', money(Math.max(0, M.savings - M.savingsBacked))], ['USDC in the savings vault', money(M.savings)], ['Reserve', L.reserve ? `${L.reserve.ratio} · ${L.reserve.checked}` : 'Not read yet']],
        yld: [['Pool Assets', `${money(Y.assets)} · ${Y.depositors} members`], ['Deployed to Clear Lending', `${money(Y.lent)} · ${pct(Y.lent, Y.assets, 0)}`], ['Vault Cash', money(Y.cash)], ['Holders earn', `${(Y.apy * 100).toFixed(2)}% a year`]],
        pay: [['Owed to shops, 14 days', money(M.owed14)], ['Repayments due', money(M.dueMembers)], ['Clear Lending owes, 14 days', money(M.short)], ['Moves by', 'Two people · Ops Safe']],
        ap: M.apBack != null ? [['Credit Backstop', money(M.apBack)], ['Member Assurance', M.apMem != null ? money(M.apMem) : 'Not read yet'], ['Coverage cap', M.cap != null ? `${money(M.cap)} · this month` : 'Not read yet'], ['Draws this year', M.drawn ? money(M.drawn) : 'None']] : [['Covers', money(M.unsecured) + ' unsecured' + (M.bondGap ? ` · ${money(M.bondGap)} of bonds due` : '')], ['RTD', `${(M.rtd * 100).toFixed(1)}% · floor ${Math.round(M.floor * 100)}%`], ['Room to issue', money(M.room)], ['Losses absorbed', money(M.lost)]],
        ops: [['Bank', 'Business checking'], ['Last sync', srcTxt('plaid')], ['Set aside inside it', money(ASIDE.reduce((a, x) => a + x[1], 0))], ['Free to spend', money(freeCash())]],
        bv: [['Owed to bondholders', `${money(M.bonds)} · ${BONDS.length} bond${BONDS.length === 1 ? '' : 's'}`], ['Kept back', money(Math.min(M.bv || 0, BV_NEED())) + ' of ' + money(BV_NEED())], ['The Safe can take', money(Math.max(0, (M.bv || 0) - BV_NEED()))], ['First maturity', nb ? `${nb[3]} · ${nb[0]} · ${money(nb[1])}` : 'None'], ['Moves by', 'Two people · Ops Safe']],
        // the co-op's balance is the Ops Safe's USDC, from the chain; its ClearCredit is a claim still to be cashed, from the PayoutPool or the AssurancePool's excess
        coop: L.COOP ? [['USDC in the Safe', money(L.COOP.usdc)], ...(L.COOP.credit ? [['ClearCredit claim', `${money(L.COOP.credit)} · not counted`]] : []), ['Held by', `Ops Safe · ${L.COOP.holder.slice(0, 6)}…${L.COOP.holder.slice(-4)}`], ['History', 'From today on'], ...(L.OFFERS ? [['Offers owed', `${money(L.OFFERS.owed)} of ${money(L.OFFERS.cap)}`]] : []), ['Spending it', 'Needs a member vote']] : [['Added, last 4 weeks', money(COOP_W.slice(-4).reduce((a, b) => a + b, 0))], ['From', 'The co-op’s fee on financed sales'], ['Spending it', 'Needs a member vote']],
        // Clear Lending's, from the chain by address; Lithic's two aren't read yet
        ...clFacts()
      }[id] ?? [['Source', srcTxt(src)]] : {
        sav: [['Members', String(M.members)], ['Tied to credit', money(M.savingsBacked)], ['Free to withdraw', money(M.savings - M.savingsBacked)], ['USDC in the ESA vault', money(M.savings)], ['Trustee', 'Clear Financial · ESA Reserve Trust'], ['Reserve', '1 : 1 · checked hourly']],
        yld: [['Pool Assets', `${money(Y.assets)} · ${Y.depositors} members`], ['Deployed to Clear Lending', `${money(Y.lent)} · ${pct(Y.lent, Y.assets, 0)}`], ['Vault Cash', money(Y.cash)], ['Deploys to', 'Clear Lending’s lending account only · two signers'], ['Holders earn', `${(Y.apy * 100).toFixed(2)}% a year`]],
        pay: [['Owed to shops by 4 Nov', money(M.owed14)], ['Member repayments due', money(M.dueMembers)], ['Clear Lending still to fund by Mon 2 Nov', money(M.short)], ['Keeper', `${M.standShort ? 'Amber' : 'Green'} · checked hourly`]],
        ap: [['Credit Backstop', money(M.apBack)], ['Member Assurance', money(M.apMem)], ['Coverage cap', `${money(M.cap)} · this month`], ['Draws this year', M.drawn ? money(M.drawn) : 'None'], ['Owned by', 'Clear Collective LLC · board Safe and two signers']],
        ops: [['Bank', 'Business checking'], ['Last sync', '3 h ago · Plaid'], ['Set aside inside it', money(ASIDE.reduce((a, x) => a + x[1], 0))], ['Free to spend', money(freeCash())]],
        bv: [['Owed to bondholders', money(M.bonds) + ' · 6 bonds'], ['Kept back', money(Math.min(M.bv || 0, BV_NEED())) + ' of ' + money(BV_NEED())], ['Excess Clear Lending can withdraw', money(Math.max(0, (M.bv || 0) - BV_NEED()))], ['First maturity', '14 Dec · BB-0001 · ' + money(2500)], ['Moves by', 'Two treasury signers, through the Collateral Agent']],
        cash: [['Held for', `${M.members} members · in their own names`], ['Held by', 'The Bank Partner · Clear Financial services it'], ['Never funds', 'Card credit · I-02 4.9(b)'], ['Reconciled', 'Hourly, against Lithic’s ledger']],
        clop: [['Owned by', 'Clear Lending Co. · through the Clear Lending Safe'], ['Address', '0xfAFf…df65'], ['Comes in', 'Yield Pool Deployments, BondVault excess'], ['Goes out', 'Payout top-ups (bot, $5,000 a week), Assurance fee funding']],
        clset: [['Owned by', 'Clear Lending Co. · Clear Financial runs it as servicer'], ['Funded to', SETL()?.verdict ? `${money(SETL().verdict.target)} · what is due at the next cut-off plus the buffer` : 'What is due at the next cut-off plus the buffer'], ['Pays', 'The credit part of each card swipe'], ['If it runs short', 'Card credit is declined, and Clear Lending is told that day'], ['Testnet', 'Lithic sandbox has no funded float yet']],
        cllr: [['Owned by', 'Clear Lending Co. · its own Safe'], ['Address', '0xb425…'], ['Takes losses', 'After the month’s Spread, before the Credit Backstop'], ['Receives', 'Backstop draws, once two signers release them']],
        clfee: [['Address', '0xB9ed…cDFd'], ['Holds', 'Only what CL Operating sends it to pay'], ['Pays', 'Credit Enhancement Fees and recoveries into the Credit Backstop'], ['Between payments', 'Empty, by design']],
        trs: [['Address', '0x52e6…cf50'], ['Signers', 'Two · Clear and Clear Financial'], ['Pays', '25% of card interchange into the AssurancePool, monthly'], ['On testnet', 'Also plays the Ops, board and Clear Financial Safes']],
        coop: [['Added in October', money(COOP_W.slice(3).reduce((a, b) => a + b, 0))], ['From', 'Member discounts at partner shops'], ['Spending it', 'Needs a member vote']]
      }[id];
      const pts = wk.map((v, i) => `${(i / (wk.length - 1) * 100).toFixed(1)},${(38 - v / mx * 34).toFixed(1)}`).join(' L');
      // live, a move the API can't propose yet (using BondVault's spare, a bill from operating cash) isn't offered
      const act = L ? {
        bv: <button className="btn" data-npool="bonds">Bonds →</button>,
        ops: <button className="btn" data-nsync="">Sync from Plaid</button>,
        pay: <button className="btn p" data-npropose="topup">Propose a top-up</button>,
        sav: <button className="btn" data-nreserve="">Run the reserve check</button>,
        yld: <button className="btn" data-npool="yield">Yield pool →</button>,
        ap: <button className="btn" data-npool="ap">AssurancePool →</button>,
        coop: <button className="btn" data-ngo="governance">Propose a use · Governance</button>
      }[id] : {
        bv: <button className="btn p" data-npropose="bondvault">Propose withdrawing the excess</button>,
        ops: <button className="btn p" data-npropose="bill">Propose a move from here</button>,
        pay: <button className="btn p" data-npropose="topup">Propose a Deployment</button>,
        sav: <button className="btn" data-nreserve="">Run the reserve check</button>,
        yld: <button className="btn" data-npool="yield">Yield pool →</button>,
        clop: <button className="btn" data-npool="pay">Automatic top-ups →</button>,
        clfee: <button className="btn" data-npool="ap">Assurance fees →</button>,
        ap: <button className="btn" data-npool="ap">AssurancePool →</button>,
        coop: <button className="btn" data-ngo="governance">Propose a use · Governance</button>
      }[id];
      return <><div className="pn-hd"><span className="lbl">{GROUPS[g][0]}</span><span className={`nsrc ${SRC[src][2] || ''}`}><i />{srcTxt(src)}</span><button className="x" data-nclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div><p className="npn-t">{n}</p><p className="npn-s">{why}</p></div><div><div className="m-big">{L && acctOf(id)[9] ? '—' : money(bal)}</div><svg className="npn-ch" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d={`M${pts} L100,40 L0,40 Z`} className="ar" style={css(`fill:color-mix(in srgb,${col} 18%,transparent)`)} /><path d={`M${pts}`} className="ln" style={css(`stroke:${col}`)} /></svg><div className="npn-ax"><span>{L ? acctOf(id)[8] > 1 ? dayD(-7 * (wk.length - 1)) : 'Now' : NW[0]}</span><span>{L ? 'Now' : NW[NW.length - 1]}</span></div></div><div>{lbl('Facts')}<div className="led">{facts.map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div></div>{id === 'coop' && L && L.OFFERS && CAN() ? offersCapForm() : ''}</div><div className="pn-ft">{!act ? <span className="small quiet">{g === 'cl' ? 'Clear Lending’s account · its signers move it' : 'Read-only here'}</span> : CAN() || !/propose/.test(act) ? act : <span className="small quiet">Read-only for you</span>}</div></>;
    }
    function proposePanel(P) {
      if (KINDS[P.kind]?.card) {
        const K = KINDS[P.kind],
          amt = P.amt ?? K.amt();
        return <><div className="pn-hd"><span className="lbl">Card settlement</span><button className="x" data-nclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><p className="npn-t">{K.t}</p><div className="led"><div><span>From</span><b>{PLACES[K.from]}</b></div><div><span>To</span><b>{PLACES[K.to]}</b></div></div>{P.kind === 'csarestart' ? '' : <div className="npf"><label>{lbl('Amount')}<input id="namt" className="vin" inputMode="decimal" defaultValue={amt ? amt.toFixed(2) : ''} placeholder="0.00" /></label></div>}<p className="npn-n">{K.why}</p><p className="npn-n"><b>Two people.</b>{" You propose it; someone else with Approve in Money approves it. Nothing moves until they do."}</p></div><div className="pn-ft"><button className="btn" data-nclose="">Cancel</button><button className="btn p" data-nsubmit="">Propose it</button></div></>;
      }
      if (L) {
        // live: a top-up the Ops Safe funds; anyone else with Approve in Money is the second person
        const amt = P.amt ?? KINDS.topup.amt();
        return <><div className="pn-hd"><span className="lbl">New move</span><button className="x" data-nclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><p className="npn-t">Propose a move</p><div className="npk">{Object.entries(KINDS).map(([k, x], __k) => <button key={__k} data-nkind={k} aria-pressed={P.kind === k}><b>{x.t}</b><span>{PLACES[x.from]}{" → "}{PLACES[x.to]}</span></button>)}</div><div className="npf"><label>{lbl('Amount')}<input id="namt" className="vin" inputMode="decimal" defaultValue={amt ? amt.toFixed(2) : ''} placeholder="0.00" /></label></div><div>{lbl('After it')}<div className="led"><div><span>Payout pool</span><b>{money(M.payout)}{" → "}<span id="nafter">{money(M.payout + (amt || 0))}</span></b></div>{M.short ? <div><span>Borrowed from the yield pool, 14 days</span><b>{money(M.short)}</b></div> : ''}</div></div><p className="npn-n"><b>Two people.</b>{" You propose it; someone else with Approve in Money approves it, then it’s signed in the Ops Safe. Nothing moves until it is."}</p></div><div className="pn-ft"><button className="btn" data-nclose="">Cancel</button><button className="btn p" data-nsubmit="">Propose it</button></div></>;
      }
      const K = KINDS[P.kind],
        amt = P.amt ?? K.amt(),
        to = P.kind === 'bill' ? P.payee || '' : PLACES[K.to],
        fromBal = K.from === 'bv' ? M.bv : K.from === 'yld' ? Y.cash : M.cash;
      const approvers = Object.entries(PPL).filter(([k, p]) => p.sign && k !== N.me);
      return <><div className="pn-hd"><span className="lbl">New move</span><button className="x" data-nclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><p className="npn-t">Propose a move</p><div className="npk">{Object.entries(KINDS).map(([k, x], __k) => <button key={__k} data-nkind={k} aria-pressed={P.kind === k}><b>{x.t}</b><span>{PLACES[x.from]}{" → "}{k === 'bill' ? 'a payee' : PLACES[x.to]}</span></button>)}</div><div className="npf">{P.kind === 'bill' ? <label>{lbl('Pay who')}<input id="npayee" className="vin" defaultValue={(P.payee || '').replace(/"/g, '&quot;')} placeholder="CDTFA · sales tax" /></label> : ''}<label>{lbl('Amount')}<input id="namt" className="vin" inputMode="decimal" defaultValue={amt ? amt.toFixed(2) : ''} placeholder="0.00" /></label><label>{lbl('Why')}<textarea id="nwhy" className="vin" rows="2" placeholder="What it’s for" defaultValue={P.why ?? K.why} /></label><label>{lbl('Second person')}<select id="nappr" className="vin" defaultValue={P.appr || 'dana'}>{approvers.map(([k, p], __k) => <option key={__k} value={k}>{p.n}{" · "}{p.role}</option>)}</select></label></div><div>{lbl('After it')}<div className="led"><div><span>{PLACES[K.from]}</span><b>{money(fromBal)}{" → "}<span id="nafter">{money(fromBal - (amt || 0))}</span></b></div>{P.kind === 'topup' ? <div><span>Payout pool on 4 Nov</span><b>Funded before the deadline</b></div> : P.kind === 'bondvault' ? <><div><span>Redemption Reserve kept</span><b>{money(BV_NEED())}</b></div><div><span>Goes to</span><b>Clear Lending’s registered multisig</b></div></> : ''}{K.from === 'ops' ? <div><span>Free to spend</span><b>{money(freeCash() - (amt || 0))}</b></div> : ''}</div></div><p className="npn-n"><b>Two people.</b>{" You propose it, the second person signs it in the Ops Safe. Nothing moves until they do."}</p></div><div className="pn-ft"><button className="btn" data-nclose="">Cancel</button><button className="btn p" data-nsubmit="">Propose it</button></div></>;
    }
    function reviewPanel(id) {
      const m = N.moves.find(x => x.id === id);
      if (!m) return '';
      const after = m.from === 'ops' ? M.cash - m.amt : null;
      return <><div className="pn-hd"><span className="lbl">{L ? 'Needs your approval' : 'Needs your signature'}</span><button className="x" data-nclose="" aria-label="Close">{ICO.x}</button></div><div className="pn-b"><div><p className="npn-t">{m.t}</p><p className="npn-s">{PPL[m.by].n}{" proposed it "}{rel(m.d)}{m.due != null ? ' · due ' + dayD(m.due) : ''}</p></div><div className="m-big">{money(m.amt)}</div><div className="led">{[['From', PLACES[m.from] || m.from], ['To', m.to], ['Why', m.why || '—'], ...(after != null ? [['Operating cash after', `${money(after)}`], ['Free to spend after', money(freeCash() - m.amt)]] : []), ...(m.from === 'bv' ? [['BondVault after', money(M.bv - m.amt)], ['Redemption Reserve kept', money(BV_NEED())]] : []), ['Signs in', L ? L.safe ? `Ops Safe · ${L.safe.threshold} of ${L.safe.owners.length}` : 'The Ops Safe' : m.from === 'yld' ? 'Two Deployment signers' : m.from === 'bv' ? 'Two treasury signers, through the Collateral Agent' : 'Ops Safe · two signers']].map(([k, v], __k) => <div key={__k}><span>{k}</span><b>{v}</b></div>)}</div>{N.rej && !L ? <label>{lbl('Why not')}<textarea id="nrej" className="vin" rows="2" placeholder={`Tell ${PPL[m.by].f} why`} /></label> : ''}<p className="npn-n">{L ? 'Approving records you as the second person. The transfer then goes to the Ops Safe to be signed, and it’s logged in Records.' : 'Approving signs it as the second person. It goes out at once and is logged in Records.'}</p></div><div className="pn-ft">{N.rej ? <><button className="btn" data-nrejcancel="">Back</button><button className="btn dz" data-nreject={m.id}>Send it back</button></> : <><button className="btn" data-nrejopen="">Reject</button><button className="btn p" data-napprove={m.id}>{L ? 'Approve' : 'Approve and sign'}</button></>}</div></>;
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
      watchBrackets();
      if (TOT()) CC.scrub(W);
      setHash();
    }
    /* a bracket under the bar too narrow for its figure (the set-aside accounts, when the co-op's cash
       dwarfs them) shows the bracket alone: its label would run into the next one. Hovering it still
       names it. */
    function fitBrackets() {
      const br = document.querySelector('.nh-br');
      // live only, as live.css (which styles .thin) is
      if (!br || !L) return;
      const ss = [...br.children];
      ss.forEach(s => s.classList.remove('thin'));
      ss.forEach(s => {
        // the name shortens itself (…); the figure can't, so it's the figure that has to fit
        const thin = s.scrollWidth > s.clientWidth + 1;
        s.classList.toggle('thin', thin);
        if (thin) s.title = `${s.querySelector('b').textContent} · ${s.querySelector('em').textContent}`;
        else s.removeAttribute('title');
      });
    }
    /* measured once the row has a size, which it may not have yet when the page draws, and again whenever
       its width changes */
    let brRO = null;
    function watchBrackets() {
      brRO?.disconnect();
      const br = document.querySelector('.nh-br');
      fitBrackets();
      if (!br || !L || typeof ResizeObserver === 'undefined') return;
      let w = br.clientWidth;
      brRO = new ResizeObserver(([e]) => {
        if (e.contentRect.width === w) return;
        w = e.contentRect.width;
        fitBrackets();
      });
      brRO.observe(br);
    }
    const logIt = (what, detail, res) => {
      if (L) return;
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
      // the offers line's new cap, proposed to the Ops Safe; never below what the line already owes
      // Assurance fees: the funding batch for CL Operating, Spread Repayments and recoveries, interchange, a retry
      if (d.nafund !== undefined || d.narep !== undefined || d.naint !== undefined || d.naretry !== undefined) {
        if (!L) return;
        if (d.nafund !== undefined) {
          t.disabled = true;
          return run('money', 'assurance-fund', {
            id: d.nafund
          }, r => {
            const f = r?.result?.funding;
            if (f) saveJson(f.batch, `cl-operating-assurance-${d.nafund.slice(0, 8)}.json`);
            toast('Batch saved · load it in the Transaction Builder on CL Operating; the Clear Lending Safe’s owners sign');
          });
        }
        if (d.naretry !== undefined) {
          t.disabled = true;
          return run('money', 'assurance-retry', {
            id: d.naretry
          });
        }
        const val = id => (document.getElementById(id)?.value || '').trim();
        if (d.narep !== undefined) {
          const amount = parseFloat(val('narep-amt').replace(/[$,\s]/g, ''));
          const room = L.AF?.advances?.room ?? 0;
          if (!(amount > 0)) return toast('Enter the amount');
          if (amount > room + 1e-9) return toast(`More than the advances outstanding: ${money(room)} is left`);
          if (!val('narep-note')) return toast('Add a note: what it is');
          t.disabled = true;
          return run('money', 'assurance-repayment', {
            kind: val('narep-kind'),
            month: val('narep-month'),
            amount,
            note: val('narep-note'),
            evidence: val('narep-ev')
          }, () => toast('Entered · propose its funding when you’re ready'));
        }
        const interchange = parseFloat(val('naint-amt').replace(/[$,\s]/g, ''));
        if (!(interchange > 0)) return toast('Enter the month’s card interchange');
        t.disabled = true;
        return run('money', 'assurance-interchange', {
          month: val('naint-month'),
          interchange
        }, r => toast(`Sent to the Clear Treasury Safe to sign · ${money(r?.result?.amount ?? 0)}`));
      }
      if (d.nabatch !== undefined) {
        const i = AF()?.items.find(x => x.id === d.nabatch);
        if (i?.funding) saveJson(i.funding.batch, `cl-operating-assurance-${i.month}-${i.kind}.json`);
        return;
      }
      if (d.naibatch !== undefined) {
        const x = AF()?.interchange?.find(y => y.month === d.naibatch);
        if (x) saveJson(x.batch, `clear-treasury-interchange-${x.month}.json`);
        return;
      }
      if (d.noffcap !== undefined && L && L.OFFERS) {
        const cap = parseFloat((document.getElementById('noffcap')?.value || '').replace(/[$,\s]/g, ''));
        if (!(cap > 0)) return toast('Enter the new cap');
        if (cap < L.OFFERS.owed) return toast(`The line already owes ${money(L.OFFERS.owed)}; the cap can’t go under it`);
        if (Math.abs(cap - L.OFFERS.cap) < 0.005) return toast('That’s the cap already');
        t.disabled = true;
        return run('contracts', 'propose', {
          contract: 'OffersIssuer',
          what: `Set the $10 offers cap to ${money(cap)}`,
          fn: 'setCap',
          args: [String(Math.round(cap * 100) * 10000)]
        }, () => toast('Sent to the Ops Safe to sign'));
      }
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
        if (!acctOf(d.nacct)) return;
        N.panel = {
          acct: d.nacct
        };
        return render();
      }
      if (d.nclose !== undefined) {
        closeN();
        return render();
      }
      // the demo's funding proposal (live, the app's own handler sends it to the API)
      if (d.nafund && !L) {
        const it = AFD.items.find(x => x.id === d.nafund);
        if (it) {
          it.st = 1;
          toast(`Batch saved · load it in the Transaction Builder on CL Operating: ${money(it.amt)} to the CL Fees wallet. The Clear Lending Safe’s two owners sign`);
          return render();
        }
      }
      if (d.npropose) {
        if (!CAN()) return toast(L ? 'Proposing a move takes Propose in Money' : 'Only Ops Safe signers can propose a move');
        N.panel = {
          propose: true,
          kind: L && !KINDS[d.npropose] ? 'topup' : d.npropose
        };
        return render();
      }
      if (d.nsf) {
        if (!CAN()) return toast(L ? 'Moving money for the card settlement takes Propose in Money' : 'Only Clear Lending signers can move money for the settlement');
        if (d.nsf === 'run') {
          if (!L) return toast('Checked just now · nothing to move');
          return api('POST', '/settlement-funding/run').then(r => {
            toast(`Desk ran · ${r.tick}`);
            window.dispatchEvent(new Event('command:changed'));
          }, e => toast(e.message));
        }
        if (d.nsf === 'stop') {
          const why = window.prompt('Why stop the desk? It shows on the card until two people restart it.');
          if (!why) return;
          if (!L) return toast('Desk stopped · nothing moves on its own until two people restart it');
          return api('POST', '/settlement-funding/stop', {
            why
          }).then(r => {
            saveJson({
              version: '1.0',
              chainId: String(r.chainId),
              createdAt: Date.now(),
              meta: {
                name: 'Stop the settlement funding lane',
                description: 'stopSettlementFunder(): send it from your own wallet. The desk is already halted.'
              },
              transactions: [r.call]
            }, 'stop-settlement-funder.json');
            toast('Desk stopped · send stopSettlementFunder from your wallet');
            window.dispatchEvent(new Event('command:changed'));
          }, e => toast(e.message));
        }
        N.panel = {
          propose: true,
          kind: {
            book: 'csabook',
            deploy: 'csadeploy',
            margin: 'csamargin',
            restart: 'csarestart'
          }[d.nsf]
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
      if (d.nsubmit !== undefined && KINDS[N.panel?.kind]?.card) {
        const K = KINDS[N.panel.kind],
          restart = N.panel.kind === 'csarestart';
        const amt = restart ? 0 : parseFloat((document.getElementById('namt').value || '').replace(/[^0-9.]/g, '')) || 0;
        if (!restart && !amt) return toast('Add an amount');
        closeN();
        render();
        if (!L) {
          logIt(`Proposed “${K.t}”`, restart ? 'Waiting for a second person' : `${money(amt)} · waiting for a second person`, 'waiting');
          return toast('Proposed · waiting for a second person · logged in Records');
        }
        return run('money', K.card, restart ? {} : {
          amount: amt
        }, () => renderShell());
      }
      if (d.nsubmit !== undefined && L) {
        // live: the API's money/top, which waits for a second person (202) before it reaches the Ops Safe
        const amt = parseFloat((document.getElementById('namt').value || '').replace(/[^0-9.]/g, '')) || 0;
        if (!amt) return toast('Add an amount');
        closeN();
        N.tab = 'moves';
        render();
        return run('money', 'top', {
          amount: amt
        }, () => renderShell());
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
      // live, approving and sending back go through the proposal (the API refuses your own)
      if (L && (d.napprove || d.nreject || d.nwithdraw)) {
        const id = d.napprove || d.nreject || d.nwithdraw,
          m = N.moves.find(x => x.id === id),
          how = d.napprove ? 'approve' : 'decline';
        closeN();
        render();
        settleMove(id, how).then(() => {
          toast(d.napprove ? 'Approved · it goes to the Ops Safe to be signed · logged in Records' : d.nwithdraw ? 'Taken back · logged' : `Sent back to ${m ? PPL[m.by].f : 'them'} · logged`);
          renderShell();
        }, e => toast(e.message));
        return;
      }
      if (d.napprove) {
        const m = N.moves.find(x => x.id === d.napprove);
        N.moves = N.moves.filter(x => x !== m);
        if (m.from === 'yld') {
          Y.cash -= m.amt;
          Y.lent += m.amt;
          Y.util = Y.lent / Y.assets;
          const y = acctOf('yld');
          y[5] = Y.cash;
          y[6][y[6].length - 1] = Y.cash;
          M.payout += m.amt;
          const p = acctOf('pay');
          p[5] = M.payout;
          p[6][p[6].length - 1] = M.payout;
        }
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
      if (d.nsync !== undefined && L) {
        if (!CAN()) return toast('Syncing takes Propose in Money');
        toast('Syncing from Plaid…');
        return run('money', 'sync', {
          source: 'plaid'
        }, () => {
          toast('Asked Plaid for new transactions · the balance updates at its next read');
          renderShell();
        });
      }
      if (d.nreserve !== undefined && L) {
        if (!CAN()) return toast('The reserve check takes Propose in Money');
        return run('money', 'reserve', {}, () => toast('Recorded for the reserve check · nothing is sent yet'));
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
        if (el) el.textContent = L ? money(M.payout + v) : money((N.panel && KINDS[N.panel.kind] && KINDS[N.panel.kind].from === 'bv' ? M.bv : M.cash) - v);
        N.panel.amt = v;
      }
      // a Spread Repayment or recovery is never more than the advances outstanding; interchange shows its share
      if (e.target.id === 'narep-amt' && L?.AF) {
        const v = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0,
          room = L.AF.advances?.room ?? 0,
          w = document.getElementById('narep-warn');
        if (w) {
          w.textContent = v > room + 1e-9 ? `More than the advances outstanding: only ${money(room)} is left, so it can’t be entered.` : `Up to ${money(room)}: the advances outstanding, less what’s already entered. Paid under RECOVERY, all of it to the Credit Backstop.`;
          w.classList.toggle('naf-w', v > room + 1e-9);
        }
      }
      if (e.target.id === 'naint-amt' && L?.AF) {
        const v = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0,
          el = document.getElementById('naint-x');
        if (el) el.textContent = `${L.AF.interchangeBps / 100}% of it goes in: ${money(Math.floor(v * L.AF.interchangeBps / 100) / 100)}, by approve and deposit(INTERCHANGE), signed by the Clear Treasury Safe’s owners.`;
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
    // live, what waits in Money and what was approved come from the proposals, and the signers from the Ops Safe
    if (L) L.load().then(() => {
      N.moves = L.MOVES.slice();
      N.done = [...L.DONE, ...autoDone()].sort((a, b) => b.d - a.d);
      render();
    }, () => undefined);
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
registerPage(['money'], 'n-slot', makeMoney, { live: true });
