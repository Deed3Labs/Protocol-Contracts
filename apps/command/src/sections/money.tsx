// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { live } from '../live/actions';
import { LIVE, REAL } from '../live/env';
import { fig } from '../live/figures';
import { feedLabel, feedLate, feedLine, hasFeeds } from '../live/feeds';
import { Fragment } from 'react';
import { attrs, css } from '../runtime/dom';
import { compBar, head, ic, money, pct } from './core';
import { ACCTS, AP_BAL, BONDS, COOP_W, DAY, ENTRIES, FLOWS, GROUPS, M, MEMBERS, MON, NS, NW, PRE, RTD_W, SHOP, TODAY, TXO, Y, YD, YLD, Y_DEP, vars } from './data';
import { kv, sec, vModal } from './governance';
import { G, chart, columns, figHtml, fmtD, gCell, line, px } from './growth';
import { mkey } from './home';
import { ddHtml } from './kit';
import { prOf } from './shop';
export function yBorrowBps(u) {
  return u <= Y.curve.kink
    ? Y.curve.base + (Y.curve.s1 * u) / Y.curve.kink
    : Y.curve.base + Y.curve.s1 + (Y.curve.s2 * (u - Y.curve.kink)) / (1 - Y.curve.kink);
}
export function yApr(bps) {
  return ((bps / 10000) * 365) / Y.cycleDays;
}
/* simple, per year */
export function yApy(bps) {
  return Math.pow(1 + bps / 10000, 365 / Y.cycleDays) - 1;
}
/* a share of a total that may be nothing yet: 0, not NaN */
const per = (a, b) => (b ? a / b : 0);
const pct0 = (a, b) => (b ? pct(a, b) : pct(0, 1));
export function acctOf(id) {
  return ACCTS.find((a) => a[0] === id);
}
export function ASIDE() {
  return [
    ['Sales tax held', LIVE && vars.setAside ? vars.setAside.salesTax : typeof SHOP !== 'undefined' ? SHOP.tax : 351.58, 'Shop · paid with the quarterly return'],
    [
      'Pre-order deposits',
      LIVE && vars.setAside
        ? vars.setAside.preorderDeposits
        : typeof PRE !== 'undefined'
          ? PRE.filter((r) => r[5] === 'held').reduce((a, r) => a + prOf(r[2]).price * r[4], 0)
          : 460,
      'Hardware · refundable until made',
    ],
  ];
}
export function dayD(d) {
  return fmtD(TODAY + d * DAY);
}
export function sgn(k, v) {
  return (k === 'in' ? '+' : '−') + money(v);
}
/* live, the USDC behind savings is the vault's on chain (Phase 6b); the prototype said Bridge */
const vaultLive = () => LIVE && M.clrusd != null;
const vaultWord = () => (vaultLive() ? 'USDC in the savings vault' : 'USDC at Bridge');
const reserveGap = () => (!vaultLive() || !M.reserveDiff ? 'None' : `${money(Math.abs(M.reserveDiff))} ${M.reserveDiff < 0 ? 'short' : 'over'}`);
export function srcTxt(k) {
  // live, how old each source's figures really are (Phase 6a)
  if (LIVE && hasFeeds()) return feedLabel(k);
  return {
    protocol: 'Protocol · 12 s',
    lithic: 'Lithic · 1 min',
    bridge: 'Bridge · 2 min',
    plaid: 'Plaid · 3 h',
  }[k];
}
/* stats attached to the foot of a cell; they sit in the footer row, so strips line up across a row */
export function strip(items) {
  return (
    <div className="c-strip">
      {items.map(([k, v, s, cls], __k) => (
        <div key={__k} {...attrs(cls ? ` class="${cls}"` : '')}>
          <span className="lbl">{k}</span>
          <b className="num">{v}</b>
          {s ? <span className="small quiet">{s}</span> : ''}
        </div>
      ))}
    </div>
  );
}
export function evRows(rows) {
  return (
    <div className="evlist">
      {rows.map(([d, n, s, v, k], __k) => (
        <div key={__k} className="ev-r">
          <span className="ev-d">{d}</span>
          <span className="ev-n">
            <b>{n}</b>
            {s ? <span className="small quiet">{s}</span> : ''}
          </span>
          <b className={`num ${k || ''}`}>{v}</b>
        </div>
      ))}
    </div>
  );
}
export function moneyPage() {
  const P = NS.pane;
  const title =
    P === 'overview'
      ? `${REAL ? 'The next 14 days’' : '4 Nov'} payouts clear, with ${money(M.short)} from the yield pool.`
      : P === 'reserves'
        ? 'Member savings are fully reserved.'
        : P === 'yield'
          ? `Depositors earn ${(Y.apy * 100).toFixed(2)}% a year today.`
          : P === 'credit'
            ? 'Most credit is backed by savings.'
            : P === 'bonds'
              ? BONDS.length
                ? `The first bond matures ${firstBond()}.`
                : 'No bonds yet.'
              : `${FLOWS.length} money movements in the next 30 days.`;
  const tools = (
    <div className="ph-tools">
      {LIVE && hasFeeds() ? (
        feedLine()?.worst ? (
          <span className="chip underway">
            <span className="dot" />
            {feedLine().headline.replace(/ is (.*) behind$/, ' $1 behind')}
          </span>
        ) : null
      ) : (
        <span className="chip underway">
          <span className="dot" />
          Plaid 3 h behind
        </span>
      )}
      <span className="chip plain">Read-only</span>
    </div>
  );
  const tabs = [
    ['overview', 'Overview'],
    ['reserves', 'Reserves'],
    ['yield', 'Yield pool'],
    ['credit', 'Credit'],
    ['bonds', 'Bonds'],
    ['schedule', 'Schedule'],
  ];
  const body = {
    overview: nOverview,
    reserves: nReserves,
    yield: nYield,
    credit: nCredit,
    bonds: nBonds,
    schedule: nSchedule,
  }[P]();
  return (
    <>
      {head(
        <>
          {'Money · Testnet · '}
          <b>{REAL ? 'Real data' : 'Demo data'}</b>
        </>,
        title,
        tools,
      )}
      <nav className="ptabs" aria-label="Money panes">
        {tabs.map(([v, t], __k) => (
          <button key={__k} type="button" data-npane={v} aria-current={P === v ? 'page' : 'false'}>
            {t}
          </button>
        ))}
      </nav>
      {body}
      {moneyPane()}
    </>
  );
}
export function holdings() {
  const tot = ACCTS.reduce((a, x) => a + x[5], 0),
    aside = ASIDE(),
    asideT = aside.reduce((a, x) => a + x[1], 0),
    free = M.cash - asideT;
  let c = 0;
  const seg = ACCTS.map((a) => {
    const w = (a[5] / tot) * 100,
      l = c;
    c += w;
    return {
      a,
      l,
      w,
    };
  });
  const grp = (seg.length ? Object.keys(GROUPS) : []).map((g) => {
    const ss = seg.filter((x) => x.a[3] === g),
      l = ss[0]?.l ?? 0,
      w = ss.reduce((s, x) => s + x.w, 0);
    return {
      g,
      l,
      w,
      v: ss.reduce((s, x) => s + x.a[5], 0),
    };
  });
  const bar = (
    <>
      <div className="wh-bar" role="img" aria-label={ACCTS.map((a) => a[1] + ' ' + money(a[5])).join(', ')}>
        {seg.map(({ a, w }, __k) => (
          <button key={__k} type="button" className="wh-s" data-nacct={a[0]} style={css(`flex:${w};--c:${a[7]}`)} title={`${a[1]} · ${money(a[5])}`}>
            {w > 14 ? (
              <>
                <span>{a[1]}</span>
                <b className="num">{pct(a[5], tot)}</b>
              </>
            ) : (
              ''
            )}
          </button>
        ))}
      </div>
      <div className="wh-br">
        {grp.map(({ g, l, w, v }, __k) => (
          <span key={__k} className="wh-b" style={css(`left:${l}%;width:${w}%`)}>
            <i />
            <b>{GROUPS[g][0]}</b>
            <span className="num">{money(v)}</span>
          </span>
        ))}
      </div>
    </>
  );
  const sp = (v) => {
    const mx = Math.max(...v) || 1,
      mn = Math.min(...v);
    return (
      <svg className="wh-sp" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
        <path d={`M${v.map((y, i) => `${((v.length > 1 ? i / (v.length - 1) : 1) * 100).toFixed(1)},${(26 - ((y - mn) / (mx - mn || 1)) * 24).toFixed(1)}`).join(' L')}`} />
      </svg>
    );
  };
  const rows = ACCTS.map((a, __k) => {
    const [id, n, why, g, src, bal, wk, col] = a,
      ch = wk.length > 1 ? wk[wk.length - 1] - wk[wk.length - 2] : 0,
      st = (LIVE && hasFeeds() ? feedLate(src) : src === 'plaid') ? 'late' : '';
    return (
      <Fragment key={__k}>
        <button type="button" className={`wh-r${NS.acct === id ? ' sel' : ''}`} data-nacct={id}>
          <i className="wh-sw" style={css(`background:${col}`)} />
          <span className="wh-k">
            <b>{n}</b>
            <span className="small quiet">{why}</span>
          </span>
          <span className={`wh-src ${st}`}>
            <i className="dot" />
            {srcTxt(src)}
          </span>
          {sp(wk)}
          <span className={`wh-ch num ${ch > 0 ? 'up' : ch < 0 ? 'dn' : ''}`}>
            {ch > 0 ? '+' : ch < 0 ? '−' : ''}
            {money(Math.abs(ch))}
          </span>
          <b className="wh-v num">{money(bal)}</b>
        </button>
        {id === 'ops'
          ? aside.map(([k, v, s], __k) => (
              <div key={__k} className="wh-r sub">
                <i />
                <span className="wh-k">
                  <b>{k}</b>
                  <span className="small quiet">{s}</span>
                </span>
                <span className="wh-src" />
                <span className="wh-sp" />
                <span className="wh-ch small quiet">Set aside</span>
                <b className="wh-v num">{money(v)}</b>
              </div>
            ))
          : ''}
      </Fragment>
    );
  });
  return (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Everything we hold</span>
        <span className="tag">
          {ACCTS.length}
          {' accounts · 3 sources'}
        </span>
      </header>
      <div className="c-fig">{figHtml(money(tot), `across ${ACCTS.length} accounts · ${money(free)} of it is the co-op’s to spend freely`)}</div>
      <div className="c-body">
        {bar}
        <div className="wh">
          <div className="wh-r wh-h">
            <span />
            <span>Account</span>
            <span>Source</span>
            <span>7 weeks</span>
            <span>This week</span>
            <span>Balance</span>
          </div>
          {rows.length ? rows : <span className="small quiet">None yet.</span>}
        </div>
      </div>
      {strip([
        [REAL ? 'Owed to shops, 14 days' : 'Owed to shops by 4 Nov', money(M.owed14), `${money(M.short)} lent by the yield pool`],
        ['Owed to bondholders', money(M.bonds), BONDS.length ? `first due ${firstBond()}` : ''],
        ['Reserve check', fig('money.reserve')?.ratio ?? pct(0, 1), fig('money.reserve') ? `member savings · ${fig('money.reserve').checked}` : 'member savings'],
        ['Free to spend', money(free), 'after tax and deposits'],
      ])}
    </section>
  );
}

/* ── account panel ───────────────────────────────────────────────────── */
export function moneyPane() {
  if (!NS.acct) return '';
  const a = acctOf(NS.acct);
  if (!a) return '';
  const [id, n, why, g, src, bal, wk] = a,
    mx = Math.max(...wk) * 1.15;
  const ch = chart({
    h: 150,
    max: mx,
    yTicks: [0, mx / 2],
    yFmt: (v) => (v ? (v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + Math.round(v)) : '0'),
    x: NW.map((t, i) => ({
      t,
      x: px(i, NW.length),
    })).filter((_, i) => i % 2 === 0),
    paths: line(wk, mx, 'ch-l1'),
    marks: [
      {
        x: 100,
        v: bal,
        c: 'var(--fg)',
      },
    ],
  });
  const facts = {
    sav: [
      ['Members', String(activeMembers())],
      ['Tied to credit', money(M.savingsBacked)],
      ['Free to withdraw', money(M.savings - M.savingsBacked)],
      [vaultWord(), money(M.savings) + (vaultLive() ? ' · on chain' : ' · 2 min')],
      ['Reserve', fig('money.reserve').ratio, 1],
    ],
    yld: [
      ['Deposited', money(Y.assets) + ' · ' + Y.depositors + ' depositors'],
      ['Lent to unsecured credit', money(Y.lent) + ' · ' + pct(Y.lent, Y.assets)],
      ['Cash for withdrawals', money(Y.cash)],
      ['Lends the payout pool', money(Y.toPayout) + (REAL ? ' as claims come due' : ' on 4 Nov')],
      ['Depositors earn', (Y.apy * 100).toFixed(2) + '% a year, today'],
      ['Takes losses', 'First, before the AssurancePool', 1],
    ],
    pay: [
      [REAL ? 'Owed to shops, 14 days' : 'Owed to shops by 4 Nov', money(M.owed14)],
      ['Repayments due', money(M.dueMembers)],
      [REAL ? 'Yield pool lends, 14 days' : 'Yield pool lends on 4 Nov', money(M.short)],
      ['Moves by', 'Two people · Ops Safe', 1],
    ],
    ap: [
      ['Covers unsecured credit', money(M.unsecured)],
      ['RTD', pct(M.rtd, 1) + ' · floor 20.0%'],
      ['Room to issue', money(M.room)],
      ['Losses absorbed', money(M.lost), 1],
    ],
    ops: [
      ['Bank', 'Business checking'],
      ['Last sync', LIVE && hasFeeds() ? feedLabel('plaid').replace(/^Plaid · (.*)$/, '$1 ago · Plaid') : '3 h ago · Plaid'],
      ['Set aside inside it', money(ASIDE().reduce((s, x) => s + x[1], 0))],
      ['Covers bonds until BondVault', money(M.bonds)],
      ['Moves by', 'Two people', 1],
    ],
    coop: [
      ['Added in October', money(COOP_W.slice(3).reduce((s, b) => s + b, 0))],
      ['From', 'Member discounts at partner shops'],
      ['Spending it', 'Needs a member vote', 1],
    ],
  }[id];
  const moves =
    id === 'pay'
      ? FLOWS.map(([d, k, v, nn, s]) => [dayD(d), nn, s, sgn(k, v), k])
      : id === 'ops'
        ? [
            ...entryRows('ops'),
          ]
        : id === 'sav'
          ? [
              ...entryRows('sav'),
            ]
          : id === 'yld'
            ? [
                [REAL ? 'In 14 days' : '4 Nov', 'Lends the payout pool', 'Scheduled · repaid from repayments', '−' + money(Y.toPayout), ''],
                ...entryRows('yld'),
              ]
            : id === 'ap'
              ? [
                  ...entryRows('ap'),
                ]
              : [
                  ...entryRows('coop'),
                ];
  const act = {
    yld: ['yrate', 'How the rate works'],
    pay: ['top', 'Top up instead'],
    ops: ['sync', 'Sync from Plaid'],
    ap: ['ap', 'How the gate works'],
    sav: ['reserve', 'Run the reserve check'],
    coop: ['vote', 'Propose a use for it'],
  }[id];
  const body = (
    <>
      <div>
        <p className="h2" style={css('font-size:28px')}>
          {n}
        </p>
        <p className="quiet" style={css('margin:8px 0 0')}>
          {why}
        </p>
      </div>
      <div>
        <span className="fig fig-xl">{money(bal)}</span>
        <span className="figsub" style={css('display:block;margin-top:6px')}>
          {GROUPS[g][0]}
          {' · '}
          {GROUPS[g][1].toLowerCase()}
          {' · '}
          {srcTxt(src)}
        </span>
      </div>
      {sec('Seven weeks', ch)}
      {sec('Facts', kv(facts))}
      {sec(
        id === 'pay' ? 'Next 30 days' : 'Recent',
        evRows(moves),
        id === 'pay' ? (
          <button type="button" className="pn-link" data-npane="schedule">
            Calendar
          </button>
        ) : (
          ''
        ),
      )}
    </>
  );
  return (
    <>
      <div className="pane-scrim" data-closenpane="" />
      <aside className="pane" role="dialog" aria-label="Account">
        <header className="m-hd">
          <span className="sub">Account</span>
          <span style={css('display:flex;align-items:center;gap:8px')}>
            <span className={`chip ${(LIVE && hasFeeds() ? feedLate(src) : src === 'plaid') ? 'underway' : 'plain'}`}>{srcTxt(src)}</span>
            <button className="x" type="button" data-closenpane="" aria-label="Close">
              {ic('close')}
            </button>
          </span>
        </header>
        <div className="pane-mn">{body}</div>
        <footer className="pane-ft">
          <button className="btn btn-p" type="button" data-nflow={act[0]}>
            {act[1]}
          </button>
          {id === 'yld' ? (
            <button className="btn btn-g" type="button" data-npane="yield">
              Yield pool
            </button>
          ) : id !== 'pay' ? (
            <button className="btn btn-g" type="button" data-npane="reserves">
              All pools
            </button>
          ) : (
            ''
          )}
        </footer>
      </aside>
    </>
  );
}
export function openNFlow(kind) {
  vars.lastFocus = document.activeElement;
  let f = null;
  if (kind === 'top')
    f = {
      t: 'Top up instead of borrowing',
      lbl: 'Payout pool · optional',
      h: money(M.short),
      p: (REAL ? 'Nothing is needed: when shops’ claims come due' : 'Nothing is needed: on 4 Nov') + ' the pool borrows this from the yield pool and pays it back from repayments. Topping up from operating cash means the co-op earns that interest instead.',
      rows: [
        ['From', 'Operating cash · ' + money(M.cash)],
        ['To', 'PayoutPool on Base Sepolia'],
        ['After it', money(M.payout + M.short) + ' in the pool'],
        ['Otherwise', 'The yield pool lends it · ' + money(Y.cash) + ' free'],
        ['Second person', 'Dana Ruiz, in the Ops Safe', 1],
      ],
      note: (
        <>
          <b>Money moves need a second person.</b>
          {' You propose, Dana Ruiz signs.'}
        </>
      ),
      noteIc: 'team',
      btn: 'Propose the top-up',
      steps: ['Drafted the transfer', 'Sent it to the Ops Safe for a second signature', 'Logged it'],
      done: ['Waiting on Dana Ruiz.', 'It shows on Home and Team until it’s signed.'],
    };
  else if (kind === 'sync')
    f = {
      t: 'Sync from Plaid',
      h: 'Operating cash',
      rows: [
        ['Last sync', LIVE && hasFeeds() ? feedLabel('plaid').replace(/^Plaid · (\d.*)$/, '$1 ago') : '3 hours ago'],
        ['Bank', 'Business checking'],
        ['Takes', 'About a minute', 1],
      ],
      btn: 'Sync now',
      steps: ['Asked Plaid for new transactions', 'Updated the balance'],
      done: ['Synced.', 'Balance and set-asides are current.'],
    };
  else if (kind === 'reserve')
    f = {
      t: 'Reserve check',
      h: 'Member savings',
      rows: [
        ['CLRUSD issued', money(vaultLive() ? M.clrusd : M.savings)],
        [vaultWord(), money(M.savings)],
        ['Difference', reserveGap(), 1],
      ],
      btn: 'Run it again',
      steps: ['Read CLRUSD supply on Base Sepolia', vaultLive() ? 'Read the USDC the savings vault holds' : 'Read the USDC balance at Bridge', 'Compared them'],
      done: ['Fully reserved.', '1 : 1, checked just now.'],
    };
  else if (kind === 'yrate')
    f = {
      t: 'How the yield pool pays',
      lbl: 'Yield pool',
      h: `${(Y.apy * 100).toFixed(2)}% a year today`,
      p: 'The rate follows how much of the pool is lent out. More lent, higher rate; more idle cash, lower rate. Nobody sets it by hand.',
      rows: [
        ['Lent out', pct(Y.lent, Y.assets) + ' of ' + money(Y.assets)],
        ['Unsecured credit pays', (Y.apr * 100).toFixed(1) + '% a year'],
        ['Depositors earn', 'That rate × the share lent out · ' + (Y.apy * 100).toFixed(2) + '%'],
        ['How they get it', 'Builds into the share price · paid when they withdraw'],
        [REAL ? 'Payout pool, 14 days' : 'Payout pool, 4 Nov', 'Borrows ' + money(Y.toPayout) + ' · rate rises to ' + (Y.apyAfter * 100).toFixed(2) + '%'],
        ['Losses', 'Lower the share price first, before the AssurancePool pays', 1],
      ],
      btn: null,
    };
  else if (kind === 'ap')
    f = {
      t: 'The credit gate',
      lbl: 'AssurancePool',
      h: `RTD ${pct(M.rtd, 1)}`,
      p: 'Unsecured credit can only issue while the AssurancePool is at least 20% of it.',
      rows: [
        ['AssurancePool', money(M.assurance)],
        ['Unsecured credit', money(M.unsecured)],
        ['Floor', '20%'],
        ['Room to issue', money(M.room), 1],
      ],
      btn: null,
    };
  else if (kind === 'vote')
    f = {
      t: 'Propose a use',
      lbl: 'Co-op balance',
      h: money(M.coop),
      post: (
        <label className="field">
          <span className="lbl">What for</span>
          <input type="text" defaultValue="Print 40 more window posters" autoComplete="off" />
        </label>
      ),
      rows: [
        ['Decided by', 'Member vote · one member, one vote'],
        ['Next vote window', 'After v2.2 closes, 29 Oct', 1],
      ],
      btn: 'Draft the proposal',
      steps: ['Drafted the proposal', 'Sent it to Governance'],
      done: ['Drafted.', 'It shows under Votes in Governance.'],
    };
  if (!f) return;
  if (kind === 'top') live(f, 'money', 'top', () => ({ amount: M.short }));
  else if (kind === 'sync') live(f, 'money', 'sync', () => ({ source: 'plaid' }));
  else if (kind === 'reserve') live(f, 'money', 'reserve', () => ({}));
  else if (kind === 'vote') live(f, 'money', 'vote', () => ({ what: (document.querySelector('#modalRoot input[type="text"]')?.value || '').trim() || 'A use for the co-op balance', amount: M.coop }));
  vModal(f, 'n:' + kind);
}

/* ── Overview: are we covered? ────────────────────────────────────────── */
export function nOverview() {
  const kpis = holdings();

  /* the gate, week by week against its floor */
  const rmax = 0.5,
    dip = RTD_W.findIndex((v) => v !== null && v < M.floor);
  const rLine = (
    <path
      d={`M${RTD_W.map((v, i) => (v === null ? null : `${px(i, NW.length) * 10},${(1 - v / rmax) * 100}`))
        .filter(Boolean)
        .join(' L')}`}
      className="ch-l1"
      style={css('stroke:var(--live)')}
    />
  );
  const floorLn = <line x1="0" x2="1000" y1={(1 - M.floor / rmax) * 100} y2={(1 - M.floor / rmax) * 100} className="ch-floor" />;
  /* the gate as a sum, a meter against the floor, and the last time it closed */
  const gOpen = M.rtd >= M.floor,
    GM = 0.4,
    gBack = RTD_W.findIndex((v, i) => i > dip && v !== null && v >= M.floor);
  const gsum = (
    <div className="yeq">
      <div>
        <span className="lbl">AssurancePool</span>
        <b className="fig fig-l">{money(M.assurance)}</b>
        <span className="small quiet">covers losses</span>
      </div>
      <span className="yeq-op" aria-hidden="true">
        ÷
      </span>
      <div>
        <span className="lbl">Unsecured credit</span>
        <b className="fig fig-l">{money(M.unsecured)}</b>
        <span className="small quiet">owed by members</span>
      </div>
      <span className="yeq-op" aria-hidden="true">
        =
      </span>
      <div className={gOpen ? 'hi' : 'warn'}>
        <span className="lbl">RTD</span>
        <b className="fig fig-l">{pct(M.rtd, 1)}</b>
        <span className="small quiet">{gOpen ? 'above the 20% floor' : 'under the 20% floor'}</span>
      </div>
    </div>
  );
  const meter = (
    <div className="ablock">
      <span className="lbl">Credit pauses below the floor</span>
      <div className="gm" role="img" aria-label={`RTD ${pct(M.rtd, 1)} against a 20% floor`}>
        <div className="gm-t">
          <i className={`gm-f${gOpen ? '' : ' warn'}`} style={css(`width:${Math.min(100, (M.rtd / GM) * 100).toFixed(1)}%`)} />
          <i className="gm-fl" style={css(`left:${((M.floor / GM) * 100).toFixed(1)}%`)} />
        </div>
        <div className="gm-x">
          <span style={css('left:0')}>0</span>
          <span className="fl" style={css(`left:${((M.floor / GM) * 100).toFixed(1)}%`)}>
            20% floor
          </span>
          <span style={css('left:100%')}>40%</span>
        </div>
      </div>
    </div>
  );
  const hist =
    dip >= 0 ? (
      <div className="ablock">
        <span className="lbl">Last time it closed</span>
        {evRows([
          [NW[dip], 'Fell under the floor', 'New credit paused', pct(RTD_W[dip], 1), ''],
          ...(gBack > 0 ? [[NW[gBack], 'Back above it', 'Credit reopened as the pool grew', pct(RTD_W[gBack], 1), 'in']] : []),
        ])}
      </div>
    ) : (
      ''
    );
  const gate = (
    <section className="cell s-6">
      <header className="c-hd">
        <span className="lbl">Credit gate · RTD</span>
        <span className="tag">{srcTxt('protocol')}</span>
      </header>
      <div className="c-fig">{figHtml(money(M.room), 'more unsecured credit can go out before the gate closes')}</div>
      <div className="c-body">
        {gsum}
        {meter}
        {hist}
      </div>
      {strip([
        ['Floor', '20%', 'set in AssurancePool'],
        ['Status', gOpen ? 'Open' : 'Closed', gOpen ? 'new credit may issue' : 'no new unsecured credit'],
      ])}
    </section>
  );

  /* claims in priority order, each against what backs it, never summed */
  const claims = [
    ['Member savings', vaultLive() ? 'USDC in the savings vault' : 'USDC reserve at Bridge', vaultLive() ? M.clrusd : M.savings, M.savings],
    [REAL ? 'Shops, 14 days' : 'Shops, by 4 Nov', 'Payout pool, then the yield pool', M.owed14, M.payout + M.dueMembers + YLD.toPayout],
    [
      'Bondholders',
      'Operating cash, until BondVault',
      M.bonds,
      M.cash,
    ] /* junior: first loss on unsecured credit. Owed what the pool holds, so always covered; the bar splits cash from loans out */,
    ['Yield pool deposits', 'Pool cash, then loans out', YLD.assets, YLD.assets, YLD.cash - YLD.toPayout],
  ];
  const order = (
    <section className="cell s-6">
      <header className="c-hd">
        <span className="lbl">Claims in order</span>
        <span className="tag">Reporting · gates nothing</span>
      </header>
      <div className="c-fig">
        {figHtml(REAL ? (claims[0][2] >= claims[0][3] ? '100%' : pct0(claims[0][2], claims[0][3])) : '100%', 'of tier 1, member savings, is reserved')}
      </div>
      <div className="c-body">
        <div className="claims">
          <div className="cl-r cl-h">
            <span />
            <span className="lbl">Claim</span>
            <span className="lbl">Covered</span>
            <span className="lbl">Owed</span>
          </div>
          {claims.map(([k, by, owed, held, liq], i) => {
            const c = owed ? Math.min(1, held / owed) : 0;
            return (
              <div key={i} className="cl-r">
                <span className="num-sq">{i + 1}</span>
                <span className="cl-k">
                  <b>{k}</b>
                  <span className="small quiet">{by}</span>
                </span>
                <span className="cl-c">
                  <span className="cl-bar">
                    {liq != null ? (
                      <>
                        <i style={css(`width:${(per(liq, owed) * 100).toFixed(1)}%`)} />
                        <i style={css(`width:${(per(held - liq, owed) * 100).toFixed(1)}%;background:var(--land)`)} />
                      </>
                    ) : (
                      <i style={css(`width:${(c * 100).toFixed(1)}%;background:${c >= 1 ? 'var(--fg)' : 'var(--underway)'}`)} />
                    )}
                  </span>
                  <b className="num">{c >= 1 ? '100%' : pct0(held, owed)}</b>
                </span>
                <b className="num cl-v">{money(owed)}</b>
              </div>
            );
          })}
        </div>
        {mkey([
          ['var(--fg)', 'Cash or reserve'],
          ['var(--land)', 'Out on loan'],
          ['var(--underway)', 'Partly covered'],
        ])}
      </div>
      {strip([
        ['Tier 1 gap', 'None'],
        ['Tier 2 gap', M.short > YLD.toPayout ? money(M.short - YLD.toPayout) : 'None'],
        ['Tier 3 gap', money(M.bonds - M.cash)],
        ['Tier 4 gap', 'None'],
      ])}
    </section>
  );

  /* payout pool: the 4 Nov gap as a sum, then what happens to it */
  let bal = M.payout,
    low = {
      v: bal,
      d: 0,
    },
    back = null;
  FLOWS.forEach(([d, k, v]) => {
    bal += k === 'in' ? v : -v;
    if (bal < low.v)
      low = {
        v: bal,
        d,
      };
    else if (low.v < 0 && back === null && bal >= 0) back = d;
  });
  const inn = FLOWS.filter((f) => f[1] === 'in').reduce((a, f) => a + f[2], 0),
    out = FLOWS.filter((f) => f[1] === 'out').reduce((a, f) => a + f[2], 0);
  const term = (k, v, note, cls = '') => (
    <div className={cls}>
      <span className="lbl">{k}</span>
      <b className="fig fig-l">{v}</b>
      <span className="small quiet">{note}</span>
    </div>
  );
  const op = (c) => (
    <span className="yeq-op" aria-hidden="true">
      {c}
    </span>
  );
  const sum = (
    <div className="yeq four">
      {term('In the pool', money(M.payout), 'today')}
      {op('+')}
      {term('Repayments', money(M.dueMembers), 'due by ' + dayD(low.d))}
      {op('−')}
      {term('Owed to shops', money(M.owed14), 'due by ' + dayD(low.d))}
      {op('=')}
      {term('Short', '−' + money(-low.v || 0), 'on ' + dayD(low.d), 'warn')}
    </div>
  );
  const after = back !== null ? FLOWS.filter((f) => f[0] <= back).reduce((a, f) => a + (f[1] === 'in' ? f[2] : -f[2]), M.payout) : 0;
  const then = !FLOWS.length ? (
    ''
  ) : (
    <div className="ablock">
      <span className="lbl">What happens to the gap</span>
      {evRows([
        [dayD(low.d), 'The yield pool lends it', 'Shops are paid on time', '+' + money(-low.v), 'in'],
        [
          back !== null ? dayD(back) : 'Later',
          'Repayments pay it back',
          'Principal first, then interest · pool left at ' + money(after),
          '−' + money(-low.v),
          '',
        ],
      ])}
    </div>
  );
  const pool = (
    <section className="cell s-8">
      <header className="c-hd">
        <span className="lbl">Payout pool · next 30 days</span>
        <span className="tag">Projected from the schedule</span>
      </header>
      <div className="c-fig">
        {figHtml(
          back !== null ? `${back - low.d} days` : 'Open',
          FLOWS.length ? `the pool borrows from the yield pool, ${dayD(low.d)} to ${back !== null ? dayD(back) : 'repaid'} · no top-up needed` : 'nothing scheduled in the next 30 days',
        )}
      </div>
      <div className="c-body">
        {sum}
        {then}
      </div>
      {strip([
        ['Paid out', money(out), 'next 30 days'],
        ['Coming in', money(inn), 'next 30 days'],
        ['On ' + dayD(30), money(M.payout - out + inn), 'after the loan is repaid'],
      ])}
    </section>
  );
  const next = (
    <section className="cell s-4 wt">
      <header className="c-hd">
        <span className="lbl">Coming up</span>
        <span className="tag">
          {FLOWS.length}
          {' movements'}
        </span>
      </header>
      <div className="c-body start span2">{FLOWS.length ? evRows(FLOWS.map(([d, k, v, n, s]) => [dayD(d), n, s, sgn(k, v), k])) : <span className="small quiet">None yet.</span>}</div>
      <div className="c-ft">
        <button type="button" data-npane="schedule">
          <span className="t">Calendar</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
  return (
    <>
      {G('Where it sits', 'Select an account', '', kpis)}
      {G(
        'Two checks',
        'Kept apart · RTD gates credit, claims only report',
        '',
        <>
          {gate}
          {order}
        </>,
      )}
      {G(
        'Next 30 days',
        '',
        '',
        <>
          {pool}
          {next}
        </>,
      )}
    </>
  );
}

/* ── Reserves: what sits in each pool ─────────────────────────────────── */
export function nReserves() {
  const cellR = (name, fig, sub, body, st, cls = 'mtop') => (
    <section className={`cell s-6 ${cls}`}>
      <header className="c-hd">
        <span className="lbl">{name}</span>
        <span className="tag">{srcTxt('protocol')}</span>
      </header>
      <div className="c-fig">{figHtml(fig, sub)}</div>
      <div className="c-body">{body}</div>
      {strip(st)}
    </section>
  );
  const yp = (v) => (v * 100).toFixed(2) + '%';
  /* who covers a loss — the order the contracts enforce, in two lanes by kind of credit */
  const st = (n, k, v, note) => (
    <div className="lo-s">
      <span className="lo-k">
        <span className="num-sq">{n}</span>
        <b>{k}</b>
      </span>
      <b className="fig fig-l">{v}</b>
      <span className="small quiet">{note}</span>
    </div>
  );
  const lane = (t, body, cls = '') => (
    <div className={`lo-g ${cls}`}>
      <span className="lo-lane">
        <b>{t}</b>
        <i />
      </span>
      {body}
    </div>
  );
  const never = [
    ['Bondholders', M.bonds],
    ['Payout pool', M.payout],
    ['Other members’ savings', M.savings - M.savingsBacked],
  ];
  const order = gCell(
    's-12',
    'If a member stops paying',
    srcTxt('protocol'),
    '',
    <div className="lo">
      {lane('Savings-backed credit', st(1, 'Their own savings', money(M.savingsBacked), 'Their pledged savings pay it'))}
      {lane(
        'Unsecured credit',
        <div className="lo-pair">
          {st(2, 'Yield pool', money(Y.assets), 'First loss · its share price falls')}
          <span className="lo-c" aria-hidden="true">
            {ic('chev', 'sm')}
          </span>
          {st(3, 'AssurancePool', money(M.assurance), 'Pays what the yield pool can’t')}
        </div>,
        'wide',
      )}
      {lane(
        'Never covers a loss',
        <div className="lo-nv">
          {never.map(([k, v], __k) => (
            <div key={__k}>
              <span>{k}</span>
              <b className="num">{money(v)}</b>
            </div>
          ))}
        </div>,
        'nv',
      )}
    </div>,
    <div className="c-ft">
      <button type="button" data-npane="yield">
        <span className="t">Yield pool</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  /* AssurancePool: what the floor needs and what's spare, then what goes in each week */
  const req = M.unsecured * M.floor,
    apW = AP_BAL.slice(1).map((v, i) => v - AP_BAL[i]);
  const ap = cellR(
    'AssurancePool',
    money(M.assurance),
    'covers unsecured losses after the yield pool',
    <>
      <div className="ablock">
        <span className="lbl">Against the 20% floor</span>
        {compBar([
          ['Needed for the floor', req, 'var(--fg)', money(req)],
          ['Spare', M.assurance - req, 'var(--land)', money(M.assurance - req)],
        ])}
      </div>
      <div className="ablock">
        <span className="lbl">Added each week · fee share</span>
        {columns(
          NW.slice(1).map((t, i) => [t, apW[i] ?? 0]),
          {
            h: 104,
            hi: apW.length - 1,
            fmt: (v) => money(v),
          },
        )}
      </div>
    </>,
    [
      ['Covers', money(M.unsecured), 'unsecured credit'],
      ['Absorbed', money(M.lost), `${fig('money.ap.losses') ?? 0} losses, all time`],
      ['Lent out', money(fig('money.ap.lent_out') ?? 0), 'from spare only'],
    ],
  );
  const queue = (fig('money.payout.queue') ?? []).map(([t, k, v]) => [fmtD(t), k, v]);
  let run = 0;
  const pp = cellR(
    'PayoutPool',
    money(M.payout),
    'pays shops, oldest claim first',
    <div className="ablock">
      <span className="lbl">Claims, oldest first</span>
      <div className="fifo">
        {queue.map(([d, k, v], __k) => {
          const a = run;
          run += v;
          const cov = Math.max(0, Math.min(v, M.payout - a));
          return (
            <div key={__k} className="ff-r">
              <span className="ev-d">{d}</span>
              <span className="ff-k">{k}</span>
              <span className="ff-bar">
                <i style={css(`width:${((cov / v) * 100).toFixed(1)}%`)} />
              </span>
              <b className="num">{money(v)}</b>
            </div>
          );
        })}
        {queue.length ? '' : <span className="small quiet">None yet.</span>}
      </div>
      {mkey([
        ['var(--fg)', 'Covered now'],
        ['var(--line)', 'By repayments, then the yield pool'],
      ])}
    </div>,
    [
      [REAL ? 'Owed, 14 days' : 'Owed by 4 Nov', money(M.owed14), `to ${queue.length} shops`],
      ['Repayments due', money(M.dueMembers), REAL ? 'in 14 days' : 'by 4 Nov'],
      ['From the yield pool', money(M.short), REAL ? 'as claims come due' : '4 Nov to 6 Nov'],
    ],
  );
  const esa = cellR(
    'Member savings',
    money(M.savings),
    vaultLive() ? 'CLRUSD, backed 1:1 by USDC in the savings vault' : 'CLRUSD, backed 1:1 by USDC at Bridge',
    <>
      <div className="ablock">
        <span className="lbl">Free or tied to credit</span>
        {compBar([
          ['Tied to credit', M.savingsBacked, 'var(--fg)', money(M.savingsBacked)],
          ['Free to withdraw', M.savings - M.savingsBacked, 'var(--land)', money(M.savings - M.savingsBacked)],
        ])}
      </div>
      <div className="ablock">
        <span className="lbl">Reserve check</span>
        <div className="how two">
          <span className="k">CLRUSD issued</span>
          <b className="num">{money(vaultLive() ? M.clrusd : M.savings)}</b>
          <span className="k">{vaultLive() ? 'USDC in the savings vault · on chain' : 'USDC at Bridge · 2 min'}</span>
          <b className="num">{money(M.savings)}</b>
          {LIVE && vars.depositRail ? (
            <>
              <span className="k">On its way through Bridge · {srcTxt('bridge').replace(/^Bridge · /, '')}</span>
              <b className="num">{vars.depositRail.count ? `${money(vars.depositRail.amount)} · ${vars.depositRail.count}` : 'None'}</b>
            </>
          ) : (
            ''
          )}
        </div>
      </div>
    </>,
    [
      ['Members', String(activeMembers())],
      ['Average', money(per(M.savings, activeMembers()))],
      ['Reserve', fig('money.reserve')?.ratio ?? pct(0, 1)],
    ],
  );
  const coop = cellR(
    'Co-op balance',
    money(M.coop),
    'discounts on member purchases · held',
    <div className="ablock">
      <span className="lbl">Added each week</span>
      {columns(
        NW.slice(1).map((t, i) => [t, COOP_W[i] ?? 0]),
        {
          h: 104,
          hi: 5,
          fmt: (v) => money(v),
        },
      )}
    </div>,
    [
      ['October', money(COOP_W.slice(3).reduce((a, b) => a + b, 0))],
      ['Held', money(M.coop)],
      ['To spend it', 'A vote'],
    ],
  );
  return (
    <>
      {G('Loss order', '', '', order)}
      {G(
        'Pools',
        'Read from the chain · BondVault is deployed, not funded yet',
        '',
        <>
          {ap}
          {pp}
        </>,
      )}
      {G(
        'Balances',
        '',
        '',
        <>
          {esa}
          {coop}
        </>,
      )}
    </>
  );
}

/* ── Yield pool: members lending to unsecured credit (LendingPool, ERC-4626) ── */
export function nYield() {
  const yp = (v) => (v * 100).toFixed(2) + '%';
  /* the yield pool: rate curve, then how depositors get paid */
  /* the rate, as a sum anyone can follow: what credit pays × how much of the pool is lent */
  const depAt = (u) => (Y.cycleDays && Y.curve.kink ? yApy(yBorrowBps(u) * u) * 100 : 0);
  const mo = (bps) => (bps / 100).toFixed(2) + '%';
  const eq = (
    <div className="yeq">
      <div>
        <span className="lbl">Credit pays</span>
        <b className="fig fig-l">{mo(Y.borrowBps)}</b>
        <span className="small quiet">
          {'a month · '}
          {(Y.apr * 100).toFixed(1)}% a year
        </span>
      </div>
      <span className="yeq-op" aria-hidden="true">
        ×
      </span>
      <div>
        <span className="lbl">Lent out</span>
        <b className="fig fig-l">{pct0(Y.lent, Y.assets)}</b>
        <span className="small quiet">
          {money(Y.lent)}
          {' of '}
          {money(Y.assets)}
        </span>
      </div>
      <span className="yeq-op" aria-hidden="true">
        =
      </span>
      <div className="hi">
        <span className="lbl">Depositors earn</span>
        <b className="fig fig-l">{mo(Y.supplyBps)}</b>
        <span className="small quiet">
          {'a month · '}
          {yp(Y.apy)}
          {' a year'}
        </span>
      </div>
    </div>
  );
  const scen = [
    ['20%', 0.2],
    ['40%', 0.4],
    [
      <>
        {Math.round(Y.util * 100)}%<br />
        now
      </>,
      Y.util,
    ],
    [
      <>
        {Math.round(Y.utilAfter * 100)}%<br />
        {REAL ? 'In 14 days' : '4 Nov'}
      </>,
      Y.utilAfter,
    ],
    ['80%', 0.8],
  ];
  const pool = (
    <section className="cell s-8">
      <header className="c-hd">
        <span className="lbl">Rate</span>
        <span className="tag">
          {srcTxt('protocol')}
          {Y.opened ? ' · opened ' : ''}
          {Y.opened}
        </span>
      </header>
      <div className="c-fig">{figHtml(yp(Y.apy), 'a year to depositors today · set by the contract, not by us')}</div>
      <div className="c-body">
        {eq}
        <div className="ablock">
          <span className="lbl">Yearly rate, by share lent out</span>
          {columns(
            scen.map(([k, u]) => [k, depAt(u)]),
            {
              h: 96,
              hi: 2,
              fmt: (v) => v.toFixed(1) + '%',
            },
          )}
        </div>
      </div>
      {strip([
        ['Base rate', mo(Y.curve.base), 'a month at 0% lent'],
        ['Cycle', Y.cycleDays + ' days', 'set by RevolvingIssuer'],
        [`Past ${Math.round(Y.curve.kink * 100)}% lent`, 'Climbs fast', 'to pull deposits in'],
      ])}
    </section>
  );
  const wd = gCell(
    's-4 ctop',
    'How depositors get paid',
    'ERC-4626',
    figHtml('$' + Y.price.toFixed(4), Y.price ? `a share · up ${((Y.price - 1) * 100).toFixed(2)}% since ${Y.opened}` : 'a share'),
    <div className="how two">
      <span className="k">Interest</span>
      <b>Raises the share price</b>
      <span className="k">
        {'Up to '}
        {money(Y.cash)}
      </span>
      <b>Paid at once</b>
      <span className="k">Above that</span>
      <b>Queued, paid as credit repays</b>
      <span className="k">Pledged to credit</span>
      <b className="num">
        {money(Y.pledged)}
        {' · locked'}
      </b>
    </div>,
    strip([
      ['Earned so far', money(Y.earned), Y.opened ? 'since ' + Y.opened : ''],
      ['Queue', Y.queued ? money(Y.queued) : 'Empty', Y.queued ? 'waiting on cash' : 'nothing waiting'],
    ]),
  );
  /* balance since it opened */
  const YMX = 10000,
    ny = YD.length;
  const bal = gCell(
    's-6 ctop',
    'Deposits',
    srcTxt('protocol'),
    figHtml(money(Y.assets), `held for ${Y.depositors} members${Y.opened ? ` since ${Y.opened}` : ''}`),
    <>
      <div className="ablock">
        <span className="lbl">Where it is</span>
        {compBar([
          ['Lent to unsecured credit', Y.lent, 'var(--live)', money(Y.lent)],
          ['Cash', Y.cash, 'var(--land)', money(Y.cash)],
        ])}
      </div>
      <div className="ablock">
        <span className="lbl">Since it opened</span>
        {evRows([
          ...(fig('money.yield.since_opened') ?? []).map(([t, k, d, v]) => [fmtD(t), k, d, sgn(v < 0 ? '' : 'in', Math.abs(v)), v < 0 ? '' : 'in']),
          ...(Y.earned ? [['21 Oct', 'Interest', 'From unsecured credit, so far', '+' + money(Y.earned), 'in']] : []),
        ])}
      </div>
    </>,
    strip([
      ['Depositors', String(Y.depositors), `${fig('money.yield.joined_this_week') ?? 0} joined this week`],
      ['Average', money(per(Y.assets, Y.depositors)), 'a member'],
      ['Largest', money(largestDeposit()), pct0(largestDeposit(), Y.assets) + ' of the pool'],
    ]),
  );
  const loans = gCell(
    's-6 ctop',
    'Loans to the payout pool',
    'drawForDueClaim',
    figHtml(money(Y.toPayout), REAL ? 'to lend when shops’ claims come due' : 'to lend on 4 Nov, when shops’ claims come due'),
    <>
      <div className="ablock">
        <span className="lbl">{REAL ? 'The pool in 14 days' : 'The pool on 4 Nov'}</span>
        {compBar([
          ['Lent to credit', Y.lent, 'var(--live)', money(Y.lent)],
          ['To the payout pool', Y.toPayout, 'var(--underway)', money(Y.toPayout)],
          ['Cash', Y.cash - Y.toPayout, 'var(--land)', money(Y.cash - Y.toPayout)],
        ])}
      </div>
      <div className="ablock">
        <span className="lbl">How it works</span>
        <div className="how two">
          <span className="k">Lent now</span>
          <b className="num">{money(0)}</b>
          <span className="k">Repaid from</span>
          <b>Member repayments, first</b>
          <span className="k">Order</span>
          <b>Principal, then interest</b>
          <span className="k">Backup</span>
          <b>AssurancePool spare, not its reserve</b>
        </div>
      </div>
    </>,
    strip([
      ['Lent after', pct0(Y.lent + Y.toPayout, Y.assets), 'of the pool'],
      ['Rate after', yp(Y.apyAfter), 'a year to depositors'],
      ['Paid back', '6 Nov', 'from repayments'],
    ]),
  );
  const rows = Y_DEP.map(([id, w, since, pl]) => {
    const e = per(w * Y.earned, Y.assets);
    return {
      id,
      w,
      since,
      pl,
      e,
      d: w - e,
    };
  });
  const top = rows.slice(0, 8),
    rest = rows.slice(8),
    sum = (a, k) => a.reduce((t, r) => t + r[k], 0);
  const tbl = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Depositors</span>
        <span className="tag">
          {Y.depositors}
          {' members · masked'}
        </span>
      </header>
      <div className="c-fig" />
      <div className="c-body flush">
        <div className="tbl-wrap">
          <table className="tbl compact">
            <thead>
              <tr>
                <th className="l">Member</th>
                <th className="l">Since</th>
                <th>Put in</th>
                <th>Earned</th>
                <th>Worth now</th>
                <th>Pledged</th>
                <th>Can withdraw</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r, __k) => (
                <tr key={__k}>
                  <td className="l mono">
                    <b>M•••{r.id}</b>
                  </td>
                  <td className="l">{r.since}</td>
                  <td>{money(r.d)}</td>
                  <td>{money(r.e)}</td>
                  <td>
                    <b>{money(r.w)}</b>
                  </td>
                  <td>{r.pl ? money(r.pl) : <span className="quiet">None</span>}</td>
                  <td className="quiet">{r.pl ? money(r.w - r.pl) : 'All of it'}</td>
                </tr>
              ))}
              {rest.length ? (
                <tr>
                  <td className="l quiet">
                    {rest.length}
                    {' more'}
                  </td>
                  <td />
                  <td>{money(sum(rest, 'd'))}</td>
                  <td>{money(sum(rest, 'e'))}</td>
                  <td>{money(sum(rest, 'w'))}</td>
                  <td>
                    <span className="quiet">None</span>
                  </td>
                  <td className="quiet">All of it</td>
                </tr>
              ) : (
                ''
              )}
              {rows.length ? (
                ''
              ) : (
                <tr>
                  <td className="l quiet" colSpan={7}>
                    None yet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="l">
                  <b>All</b>
                </td>
                <td />
                <td>{money(sum(rows, 'd'))}</td>
                <td>{money(sum(rows, 'e'))}</td>
                <td>{money(Y.assets)}</td>
                <td>{money(Y.pledged)}</td>
                <td className="quiet">{money(Y.assets - Y.pledged)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div />
    </section>
  );
  return (
    <>
      {G(
        'Rate',
        '',
        '',
        <>
          {pool}
          {wd}
        </>,
      )}
      {G(
        'Balance',
        '',
        '',
        <>
          {bal}
          {loans}
        </>,
      )}
      {G('Depositors', '', '', tbl)}
    </>
  );
}

/* ── Credit: how much is out, and how safe ───────────────────────────── */
export function nCredit() {
  const out = [...(fig('money.credit.outstanding_weeks') ?? []), M.credit],
    lim = [...(fig('money.credit.limits_weeks') ?? []), M.limits];
  /* October in one sum (where the balance came from), then whether this cycle's repayments are coming in */
  const spent = TXO.reduce((a, m) => a + m.oct, 0),
    start = fig('money.credit.owed_month_start') ?? 0,
    repaid = start + spent - M.credit; /* repaid falls out, so the sum always closes */
  const sched = FLOWS.filter((f) => f[1] === 'in' && f[0] <= 9).reduce((a, f) => a + f[2], 0),
    due = repaid + sched,
    autopay = fig('money.credit.autopay') ?? 0;
  const t4 = (k, v, note, cls = '') => (
    <div className={cls}>
      <span className="lbl">{k}</span>
      <b className="fig fig-l">{v}</b>
      <span className="small quiet">{note}</span>
    </div>
  );
  const o4 = (c) => (
    <span className="yeq-op" aria-hidden="true">
      {c}
    </span>
  );
  const flow = (
    <div className="yeq four">
      {t4('Owed on 1 Oct', money(start), 'start of the month')}
      {o4('+')}
      {t4('Spent', money(spent), `at ${TXO.length} shops`)}
      {o4('−')}
      {t4('Repaid', money(repaid), 'by members')}
      {o4('=')}
      {t4('Owed now', money(M.credit), `by ${activeMembers()} members`, 'hi')}
    </div>
  );
  const rp = (
    <div className="ablock">
      <span className="lbl">This cycle’s repayments · due 31 Oct</span>
      <div className="rp">
        <div className="rp-t">
          <i style={css(`width:${(per(repaid, due) * 100).toFixed(1)}%`)} />
          <i className="s" style={css(`width:${(per(sched, due) * 100).toFixed(1)}%`)} />
        </div>
        <div className="rp-k">
          <span>
            <i className="sw" />
            Collected<b className="num">{money(repaid)}</b>
          </span>
          <span>
            <i className="sw s" />
            {REAL ? 'On autopay' : 'On autopay, 24 and 30 Oct'}<b className="num">{money(sched)}</b>
          </span>
          <span className="due">
            <i className="sw n" />
            Due<b className="num">{money(due)}</b>
          </span>
        </div>
      </div>
    </div>
  );
  const trend = (
    <section className="cell s-12 mtop">
      <header className="c-hd">
        <span className="lbl">October</span>
        <span className="tag">{srcTxt('protocol')}</span>
      </header>
      <div className="c-fig">
        {figHtml(
          due && (repaid + sched) / due >= 0.9995 ? '100%' : pct0(repaid + sched, due),
          `of this cycle’s repayments are collected or on autopay · owed is up ${money(M.credit - start)} this month`,
        )}
      </div>
      <div className="c-body">
        {rp}
        <div className="ablock">
          <span className="lbl">Where the balance came from</span>
          {flow}
        </div>
      </div>
      {strip([
        ['Limits issued', money(M.limits), pct0(M.credit, M.limits) + ' drawn'],
        ['On autopay', String(autopay), pct0(autopay, activeMembers()) + ' of members'],
        ['Average owed', money(per(M.credit, activeMembers())), 'a member'],
      ])}
    </section>
  );
  const backing = gCell(
    's-4',
    'What backs it',
    srcTxt('protocol'),
    figHtml(pct0(M.savingsBacked, M.credit), 'backed by the member’s own savings'),
    <>
      {compBar([
        ['Savings', M.savingsBacked, 'var(--fg)', money(M.savingsBacked)],
        ['Unsecured', M.unsecured, 'var(--underway)', money(M.unsecured)],
      ])}
      <div className="how two">
        <span className="k">If a member stops paying</span>
        <b />
        <span className="k quiet">Savings-backed</span>
        <b>Their savings cover it</b>
        <span className="k quiet">Unsecured</span>
        <b>The yield pool, then the AssurancePool</b>
      </div>
    </>,
    strip([
      ['Counts for RTD', money(M.unsecured)],
      ['Does not', money(M.savingsBacked)],
    ]),
  );
  const aging = gCell(
    's-4',
    'How old',
    srcTxt('protocol'),
    figHtml(pct0(fig('money.credit.aging')?.[0]?.[1] ?? 0, M.credit), 'of what’s owed is current'),
    fig('money.credit.aging')?.length ? (
      columns(fig('money.credit.aging'), {
        hi: 0,
        h: 96,
        fmt: (v) => money(v),
      })
    ) : (
      <span className="small quiet">None yet.</span>
    ),
    strip([
      ['Late', money((fig('money.credit.aging') ?? []).slice(1).reduce((a, [, v]) => a + v, 0))],
      ['Over 60 d', 'None'],
    ]),
  );
  const losses = gCell(
    's-4 wt',
    'Losses',
    'All time',
    figHtml(money(M.lost), REAL ? 'paid by the AssurancePool' : '3 members · paid by the AssurancePool, before the yield pool opened'),
    // the prototype's three losses; live has no list of them yet
    REAL ? (
      M.lost ? (
        ''
      ) : (
        <span className="small quiet">None yet.</span>
      )
    ) : (
      evRows([
        ['22 Sep', 'Redlands Tire', 'Member M•••, 90 days late', money(204)],
        ['6 Oct', 'Citrus Bowl Café', 'Member M•••, 90 days late', money(204)],
        ['14 Oct', 'Cajon Phone Repair', 'Member M•••, 90 days late', money(204)],
      ])
    ),
    strip([
      ['Loss rate', pct0(TXO.reduce((a, m) => a + m.lost, 0), TXO.reduce((a, m) => a + m.orig, 0))],
      ['Recovered', money(fig('money.credit.recovered') ?? 0)],
    ]),
  );
  /* live, the card spend is Lithic's own, by merchant (Phase 6b) */
  const spend = LIVE && vars.cardSpend ? vars.cardSpend.merchants.map((m) => ({ name: m.name, oct: m.amount, lost: 0 })) : TXO,
    month = LIVE && vars.cardSpend ? new Date(`${vars.cardSpend.month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }) : 'October';
  const shops = spend
      .slice()
      .sort((a, b) => b.oct - a.oct)
      .slice(0, 6),
    octAll = spend.reduce((a, m) => a + m.oct, 0);
  const byShop = gCell(
    's-8',
    'Where it was spent',
    srcTxt('lithic'),
    figHtml(money(octAll), shops.length ? `of credit spent at ${spend.length} shops in ${month}` : `no card spend yet in ${month}`),
    <>
      <div className="hbars">
        {shops.map((m, __k) => (
          <div key={__k} className="hb">
            <span className="hb-k">{m.name}</span>
            <span className="hb-bar">
              <i style={css(`width:${((m.oct / shops[0].oct) * 100).toFixed(1)}%;background:${m.lost ? 'var(--underway)' : 'var(--fg)'}`)} />
            </span>
            <b className="num">{money(m.oct)}</b>
          </div>
        ))}
      </div>
      {mkey([
        ['var(--fg)', 'No losses'],
        ['var(--underway)', 'A loss on its book'],
      ])}
    </>,
    !shops.length ? '' : strip([
      ['Top shop', pct(shops[0].oct, octAll)],
      [
        'Top 3',
        pct(
          shops.slice(0, 3).reduce((a, m) => a + m.oct, 0),
          octAll,
        ),
      ],
      [`${spend.length - shops.length} others`, money(octAll - shops.reduce((a, m) => a + m.oct, 0))],
    ]),
  );
  const limits = gCell(
    's-4 wt',
    'Limit sizes',
    `${activeMembers()} members`,
    commonLimit() ? figHtml(commonLimit()[0], `the most common limit · ${commonLimit()[1]} members`) : '',
    commonLimit() ? (
      columns(fig('money.credit.limit_sizes'), {
        hi: 1,
        h: 132,
      })
    ) : (
      <span className="small quiet">None yet.</span>
    ),
    strip([
      ['Smallest', money(fig('money.credit.limit_range')?.smallest ?? 0)],
      ['Largest', money(fig('money.credit.limit_range')?.largest ?? 0)],
    ]),
  );
  return (
    <>
      {G('Credit', '', '', trend)}
      {G(
        'Quality',
        '',
        '',
        <>
          {backing}
          {aging}
          {losses}
        </>,
      )}
      {G(
        'Spread',
        '',
        '',
        <>
          {byShop}
          {limits}
        </>,
      )}
    </>
  );
}

/* ── Bonds: what we owe bondholders, and when ─────────────────────────── */
export function nBonds() {
  const months = [
    ['Dec', 2500],
    ['Jan', 5000],
    ['Feb', 0],
    ['Mar', 5000],
    ['Apr', 0],
    ['May', 0],
    ['Jun', 7500],
    ['Jul', 0],
    ['Aug', 0],
    ['Sep', 5000],
  ];
  const ladder = gCell(
    's-8',
    'Bond ladder',
    srcTxt('protocol'),
    figHtml(money(M.bonds), BONDS.length ? 'face value across 6 BurnerBonds, each its own token' : 'face value'),
    BONDS.length ? (
      columns(months, {
        hi: 0,
        h: 128,
        fmt: (v) => (v ? '$' + (v / 1000).toFixed(1) + 'k' : ''),
      })
    ) : (
      <span className="small quiet">None yet.</span>
    ),
    strip(
      BONDS.length
        ? [
            ['Bonds', '6'],
            ['Next', '14 Dec'],
            ['Last', '15 Sep'],
            ['Kind', 'Zero-coupon'],
          ]
        : [
            ['Bonds', '0'],
            ['Kind', 'Zero-coupon'],
          ],
    ),
  );
  const due = gCell(
    's-4 wt',
    'Due in 90 days',
    BONDS.length ? 'Through 21 Jan' : '',
    figHtml(money(BONDS.length ? 7500 : 0), BONDS.length ? 'two bonds · cash covers it 2.9 times' : 'nothing due'),
    BONDS.length ? (
      evRows([
        ['14 Dec', 'BB-0001', 'Member', money(2500)],
        ['21 Jan', 'BB-0002', 'Founding lender', money(5000)],
      ])
    ) : (
      <span className="small quiet">None yet.</span>
    ),
    strip([
      ['Operating cash', money(M.cash)],
      ['BondVault reserve', '30%', 'once funded'],
    ]),
  );
  const tbl = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Every bond</span>
        <span className="tag">Rates are internal · never exported</span>
      </header>
      <div className="c-fig" />
      <div className="c-body flush">
        <div className="tbl-wrap">
          <table className="tbl compact">
            <thead>
              <tr>
                <th className="l">Bond</th>
                <th>Face value</th>
                <th className="l">Issued</th>
                <th className="l">Matures</th>
                <th className="l">Term</th>
                <th>Rate</th>
                <th className="l">Holder</th>
              </tr>
            </thead>
            <tbody>
              {BONDS.map(([id, f, iss, mat, term, r, h], __k) => (
                <tr key={__k}>
                  <td className="l mono">
                    <b>{id}</b>
                  </td>
                  <td>{money(f)}</td>
                  <td className="l">{iss}</td>
                  <td className="l">{mat}</td>
                  <td className="l">
                    <span className="term">
                      <span className="term-b">
                        <i style={css(`width:${((term / 12) * 100).toFixed(1)}%`)} />
                      </span>
                      {term}
                      {' mo'}
                    </span>
                  </td>
                  <td>{r.toFixed(1)}%</td>
                  <td className="l quiet">{h}</td>
                </tr>
              ))}
              {BONDS.length ? (
                ''
              ) : (
                <tr>
                  <td className="l quiet" colSpan={7}>
                    None yet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="l">
                  <b>All</b>
                </td>
                <td>{money(M.bonds)}</td>
                <td />
                <td />
                <td />
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div />
    </section>
  );
  return (
    <>
      {G(
        'Maturities',
        '',
        '',
        <>
          {ladder}
          {due}
        </>,
      )}
      {G('Bonds', '', '', tbl)}
    </>
  );
}

/* ── Schedule: every movement, by day ─────────────────────────────────── */
export function nSchedule() {
  const shown = FLOWS.filter((f) => NS.sf === 'all' || f[1] === NS.sf);
  const ev = {};
  shown.forEach((f) => {
    (ev[f[0]] = ev[f[0]] || []).push(f);
  });
  const start = REAL ? TODAY - ((new Date(TODAY).getUTCDay() + 6) % 7) * DAY : TODAY - 2 * DAY; /* Monday 19 Oct */
  const days = Array.from(
    {
      length: 35,
    },
    (_, i) => {
      const t = start + i * DAY,
        d = new Date(t),
        dn = d.getUTCDate(),
        e = ev[i - (TODAY - start) / DAY],
        wk = d.getUTCDay() % 6 === 0;
      return (
        <div key={i} className={`cal-d${t === TODAY ? ' today' : ''}${wk ? ' wk' : ''}${t < TODAY ? ' past' : ''}`}>
          <span className="cal-n">{dn === 1 ? MON[d.getUTCMonth()] + ' 1' : dn}</span>
          {e
            ? e.map(([, k, v, n], __k) => (
                <span key={__k} className={`cev ${k}`}>
                  <b className="num">{sgn(k, v)}</b>
                  <span className="small">{n}</span>
                </span>
              ))
            : ''}
        </div>
      );
    },
  );
  const opts = [
    ['all', 'All', FLOWS.length],
    ['out', 'Out to shops', FLOWS.filter((f) => f[1] === 'out').length],
    ['in', 'In from members', FLOWS.filter((f) => f[1] === 'in').length],
  ];
  const inn = shown.filter((f) => f[1] === 'in').reduce((a, f) => a + f[2], 0),
    out = shown.filter((f) => f[1] === 'out').reduce((a, f) => a + f[2], 0);
  const cal = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">{REAL ? `${fmtD(start)} – ${fmtD(start + 34 * DAY)}` : '19 Oct – 22 Nov'}</span>
        <span className="hd-tools">{ddHtml('nsf', opts, NS.sf, 'Show')}</span>
      </header>
      <div className="c-fig" />
      <div className="c-body">
        <div className="cal">
          <div className="cal-h">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, __k) => (
              <span key={__k}>{d}</span>
            ))}
          </div>
          <div className="cal-g">{days}</div>
        </div>
        <div className="phlist">{shown.length ? evRows(shown.map(([d, k, v, n, s]) => [dayD(d), n, s, sgn(k, v), k])) : <span className="small quiet">None yet.</span>}</div>
        {mkey([
          ['var(--land)', 'In from members'],
          ['var(--fg)', 'Out to shops'],
        ])}
      </div>
      {strip([
        ['Movements', String(shown.length)],
        ['Out', money(out)],
        ['In', money(inn)],
        ['Yield pool lends', money(M.short)],
      ])}
    </section>
  );
  return G('Calendar', 'Payouts leave the PayoutPool · repayments come in by member autopay', '', cal);
}

/* ══ Contracts ══════════════════════════════════════════════════════════
   Agreements on paper, contracts on-chain, and the changes moving between them. Nothing here holds a key:
   changes are drafted here and signed in the Ops Safe (2 of 3); agreements are signed in the e-signature tool.
   Ties: Inland Cycle Works out for signature (Home, Needs you); Rosa's cap raise signed and in the wait (Merchants);
   RevolvingIssuer v1.3 live 21 Oct (Home, Dana Ruiz); PayoutPool top-up of $1,116.89 due 30 Oct (Money). */

// ── counted ─────────────────────────────────────────────────────────────────

/** Active members: the API counts them for Money; the preview counts the prototype's. */
export function activeMembers() {
  return LIVE && vars.memberSummary ? vars.memberSummary.active : MEMBERS.filter((m) => m.status === 'active').length;
}
/** When the first bond matures ("14 Dec"): ordered by issue month plus term, so a maturity next year sorts after this year's. */
export function firstBond() {
  const due = (b) => (MON.indexOf(b[2].split(' ')[1]) + b[4]) * 31 + Number(b[3].split(' ')[0]);
  return BONDS.slice().sort((a, b) => due(a) - due(b))[0][3];
}
export function largestDeposit() {
  return Y_DEP.length ? Math.max(...Y_DEP.map((r) => r[1])) : 0;
}
/** The most common credit limit, and how many members have it. */
export function commonLimit() {
  const sizes = fig('money.credit.limit_sizes') ?? [];
  return sizes.length ? sizes.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
}
/** An account's recent activity, newest first, as the panel lists it. */
export function entryRows(id) {
  return (ENTRIES[id] ?? []).map(({ at, what, detail, amount }) => [fmtD(at), what, detail, sgn(amount < 0 ? '' : 'in', Math.abs(amount)), amount < 0 ? '' : 'in']);
}
