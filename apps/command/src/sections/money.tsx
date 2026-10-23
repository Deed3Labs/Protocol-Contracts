// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { Fragment } from 'react';
import { attrs, css } from '../runtime/dom';
import { compBar, head, ic, money, pct } from './core';
import { ACCTS, AP_BAL, AP_REQ, BONDS, COOP_W, DAY, FLOWS, GROUPS, M, MON, NS, NW, PRE, RTD_W, SHOP, TODAY, TXO, vars } from './data';
import { kv, sec, vModal } from './governance';
import { G, chart, columns, figHtml, fmtD, gCell, line, px } from './growth';
import { mkey } from './home';
import { ddHtml } from './kit';
import { prOf } from './shop';
export function acctOf(id) {
  return ACCTS.find((a) => a[0] === id);
}
export function ASIDE() {
  return [
    ['Sales tax held', typeof SHOP !== 'undefined' ? SHOP.tax : 351.58, 'Shop · paid with the quarterly return'],
    [
      'Pre-order deposits',
      typeof PRE !== 'undefined' ? PRE.filter((r) => r[5] === 'held').reduce((a, r) => a + prOf(r[2]).price * r[4], 0) : 460,
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
export function srcTxt(k) {
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
      ? `The payout pool runs ${money(M.short)} short on 4 Nov.`
      : P === 'reserves'
        ? 'Member savings are fully reserved.'
        : P === 'credit'
          ? 'Most credit is backed by savings.'
          : P === 'bonds'
            ? 'The first bond matures 14 Dec.'
            : `${FLOWS.length} money movements in the next 30 days.`;
  const tools = (
    <div className="ph-tools">
      <span className="chip underway">
        <span className="dot" />
        Plaid 3 h behind
      </span>
      <span className="chip plain">Read-only</span>
    </div>
  );
  const tabs = [
    ['overview', 'Overview'],
    ['reserves', 'Reserves'],
    ['credit', 'Credit'],
    ['bonds', 'Bonds'],
    ['schedule', 'Schedule'],
  ];
  const body = {
    overview: nOverview,
    reserves: nReserves,
    credit: nCredit,
    bonds: nBonds,
    schedule: nSchedule,
  }[P]();
  return (
    <>
      {head(
        <>
          {'Money · Testnet · '}
          <b>Demo data</b>
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
  const grp = Object.keys(GROUPS).map((g) => {
    const ss = seg.filter((x) => x.a[3] === g),
      l = ss[0].l,
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
        <path d={`M${v.map((y, i) => `${((i / (v.length - 1)) * 100).toFixed(1)},${(26 - ((y - mn) / (mx - mn || 1)) * 24).toFixed(1)}`).join(' L')}`} />
      </svg>
    );
  };
  const rows = ACCTS.map((a, __k) => {
    const [id, n, why, g, src, bal, wk, col] = a,
      ch = wk[wk.length - 1] - wk[wk.length - 2],
      st = src === 'plaid' ? 'late' : '';
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
        <span className="tag">5 accounts · 3 sources</span>
      </header>
      <div className="c-fig">{figHtml(money(tot), `across five accounts · ${money(free)} of it is the co-op’s to spend freely`)}</div>
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
          {rows}
        </div>
      </div>
      {strip([
        ['Owed to shops by 4 Nov', money(M.owed14), `pool ${money(M.short)} short`, 'warn'],
        ['Owed to bondholders', money(M.bonds), 'first due 14 Dec'],
        ['Reserve check', '1 : 1', 'member savings · 2 min ago'],
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
      ['Members', '124'],
      ['Tied to credit', money(M.savingsBacked)],
      ['Free to withdraw', money(M.savings - M.savingsBacked)],
      ['USDC at Bridge', money(M.savings) + ' · 2 min'],
      ['Reserve', '1 : 1', 1],
    ],
    pay: [
      ['Owed to shops by 4 Nov', money(M.owed14)],
      ['Repayments due', money(M.dueMembers)],
      ['Short on 4 Nov', <span style={css('color:var(--underway)')}>{money(M.short)}</span>],
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
      ['Last sync', '3 h ago · Plaid'],
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
            ['20 Oct', 'Card sales · shop', 'Stripe payout', '+$1,218.40', 'in'],
            ['19 Oct', 'Poster printing', 'Card', '−$212.00', ''],
            ['15 Oct', 'BB-0006 issued', 'From a member', '+$5,000.00', 'in'],
            ['14 Oct', 'Railway', 'Card', '−$67.04', ''],
          ]
        : id === 'sav'
          ? [
              ['21 Oct', 'Deposits', '38 members', '+$1,904.20', 'in'],
              ['20 Oct', 'Withdrawals', '6 members', '−$412.00', ''],
              ['19 Oct', 'Deposits', '29 members', '+$1,322.10', 'in'],
            ]
          : id === 'ap'
            ? [
                ['20 Oct', 'Fee share in', 'From credit fees', '+$62.40', 'in'],
                ['14 Oct', 'Loss absorbed', 'Cajon Phone Repair', '−$204.00', ''],
                ['13 Oct', 'Fee share in', 'From credit fees', '+$58.10', 'in'],
              ]
            : [
                ['20 Oct', 'Discounts held', '14 purchases', '+$100.00', 'in'],
                ['13 Oct', 'Discounts held', '19 purchases', '+$126.80', 'in'],
              ];
  const act = {
    pay: ['top', 'Top up the pool'],
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
            <span className={`chip ${src === 'plaid' ? 'underway' : 'plain'}`}>{srcTxt(src)}</span>
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
          {id !== 'pay' ? (
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
      t: 'Top up the payout pool',
      lbl: 'Payout pool',
      h: money(M.short),
      p: 'Moves operating cash into the pool so the 4 Nov payouts clear.',
      rows: [
        ['From', 'Operating cash · ' + money(M.cash)],
        ['To', 'PayoutPool on Base Sepolia'],
        ['After it', money(M.payout + M.short) + ' in the pool'],
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
        ['Last sync', '3 hours ago'],
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
        ['CLRUSD issued', money(M.savings)],
        ['USDC at Bridge', money(M.savings)],
        ['Difference', 'None', 1],
      ],
      btn: 'Run it again',
      steps: ['Read CLRUSD supply on Base Sepolia', 'Read the USDC balance at Bridge', 'Compared them'],
      done: ['Fully reserved.', '1 : 1, checked just now.'],
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
  const gate = (
    <section className="cell s-6">
      <header className="c-hd">
        <span className="lbl">Credit gate · RTD</span>
        <span className="tag">{srcTxt('protocol')}</span>
      </header>
      <div className="c-fig">{figHtml(pct(M.rtd, 1), 'AssurancePool over unsecured credit · new credit may issue')}</div>
      <div className="c-body">
        {chart({
          h: 140,
          max: rmax,
          yTicks: [0, 0.2, 0.4],
          yFmt: (v) => (v ? Math.round(v * 100) + '%' : '0'),
          x: NW.map((t, i) => ({
            t,
            x: px(i, NW.length),
          })).filter((_, i) => i % 2 === 0),
          paths: (
            <>
              {floorLn}
              {rLine}
            </>
          ),
          marks: [
            {
              x: 100,
              v: M.rtd,
              c: 'var(--live)',
            },
            {
              x: px(dip, NW.length),
              v: RTD_W[dip],
              c: 'var(--underway)',
            },
          ],
        })}
        {mkey([
          ['var(--live)', 'RTD'],
          ['var(--fg-50)', 'Floor · 20%'],
          ['var(--underway)', `Under the floor ${NW[dip]}, credit paused`],
        ])}
      </div>
      {strip([
        ['AssurancePool', money(M.assurance)],
        ['Unsecured', money(M.unsecured)],
        ['Room to issue', money(M.room)],
      ])}
    </section>
  );

  /* claims in priority order, each against what backs it, never summed */
  const claims = [
    ['Member savings', 'USDC reserve at Bridge', M.savings, M.savings],
    ['Shops, by 4 Nov', 'Payout pool and repayments due', M.owed14, M.payout + M.dueMembers],
    ['Bondholders', 'Operating cash, until BondVault', M.bonds, M.cash],
  ];
  const order = (
    <section className="cell s-6">
      <header className="c-hd">
        <span className="lbl">Claims in order</span>
        <span className="tag">Reporting · gates nothing</span>
      </header>
      <div className="c-fig">{figHtml('100%', 'of tier 1, member savings, is reserved')}</div>
      <div className="c-body">
        <div className="claims">
          <div className="cl-r cl-h">
            <span />
            <span className="lbl">Claim</span>
            <span className="lbl">Covered</span>
            <span className="lbl">Owed</span>
          </div>
          {claims.map(([k, by, owed, held], i) => {
            const c = Math.min(1, held / owed);
            return (
              <div key={i} className="cl-r">
                <span className="num-sq">{i + 1}</span>
                <span className="cl-k">
                  <b>{k}</b>
                  <span className="small quiet">{by}</span>
                </span>
                <span className="cl-c">
                  <span className="cl-bar">
                    <i style={css(`width:${(c * 100).toFixed(1)}%;background:${c >= 1 ? 'var(--fg)' : 'var(--underway)'}`)} />
                  </span>
                  <b className="num">{c >= 1 ? '100%' : pct(held, owed)}</b>
                </span>
                <b className="num cl-v">{money(owed)}</b>
              </div>
            );
          })}
        </div>
      </div>
      {strip([
        ['Tier 1 gap', 'None'],
        ['Tier 2 gap', money(M.short), '', 'warn'],
        ['Tier 3 gap', money(M.bonds - M.cash)],
      ])}
    </section>
  );

  /* payout pool, projected day by day from the schedule */
  const lo = -2000,
    hi = 12000,
    Y = (v) => (1 - (v - lo) / (hi - lo)) * 100,
    X = (d) => (d / 30) * 1000;
  let bal = M.payout,
    low = {
      v: bal,
      d: 0,
    };
  const pts = [`0,${Y(bal)}`],
    dots = [];
  FLOWS.forEach(([d, k, v]) => {
    pts.push(`${X(d)},${Y(bal)}`);
    bal += k === 'in' ? v : -v;
    pts.push(`${X(d)},${Y(bal)}`);
    dots.push({
      d,
      v: bal,
      k,
    });
    if (bal < low.v)
      low = {
        v: bal,
        d,
      };
  });
  pts.push(`1000,${Y(bal)}`);
  const nxt = FLOWS.find((f) => f[0] > low.d)[0];
  const proj = (
    <div className="chart proj" style={css('--ch:160px')}>
      <div className="ch-y">
        {[0, 4000, 8000, 12000].map((v, __k) => (
          <span key={__k} style={css(`top:${Y(v)}%`)}>
            {v ? '$' + v / 1000 + 'k' : '0'}
          </span>
        ))}
      </div>
      <div className="ch-plot">
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          {[4000, 8000, 12000].map((v, __k) => (
            <line key={__k} x1="0" x2="1000" y1={Y(v)} y2={Y(v)} className="ch-grid" />
          ))}
          <rect x={X(low.d)} y={Y(0)} width={X(nxt) - X(low.d)} height={Y(low.v) - Y(0)} className="ch-neg" />
          <line x1="0" x2="1000" y1={Y(0)} y2={Y(0)} className="ch-zero" />
          <path d={`M${pts.join(' L')}`} className="ch-l1" />
        </svg>
        {dots.map((o, __k) => (
          <i key={__k} className={`ch-dot ${o.k}${o.d === low.d ? ' low' : ''}`} style={css(`left:${(o.d / 30) * 100}%;top:${Y(o.v)}%`)} />
        ))}
        <span className="ch-call" style={css(`left:${(low.d / 30) * 100}%;top:${Y(low.v)}%`)}>
          {'−' + money(-low.v)}
          {' on '}
          {dayD(low.d)}
        </span>
      </div>
      <div className="ch-x">
        {[0, 7, 14, 21, 28].map((d, __k) => (
          <span key={__k} style={css(`left:${(d / 30) * 100}%`)} className={d === 0 ? 'a0' : ''}>
            {dayD(d)}
          </span>
        ))}
      </div>
    </div>
  );
  const inn = FLOWS.filter((f) => f[1] === 'in').reduce((a, f) => a + f[2], 0),
    out = FLOWS.filter((f) => f[1] === 'out').reduce((a, f) => a + f[2], 0);
  const pool = (
    <section className="cell s-8">
      <header className="c-hd">
        <span className="lbl">Payout pool · next 30 days</span>
        <span className="tag">Projected from the schedule</span>
      </header>
      <div className="c-fig">{figHtml(money(M.short), 'to add by 30 Oct so the 4 Nov payouts clear · a multisig action')}</div>
      <div className="c-body">
        {proj}
        {mkey([
          ['var(--fg)', 'Balance · payout out'],
          ['var(--land)', 'Repayment in'],
          ['var(--underway)', 'Below zero'],
        ])}
      </div>
      {strip([
        ['Today', money(M.payout)],
        ['Out', money(out)],
        ['In', money(inn)],
        ['On 20 Nov', money(M.payout - out + inn)],
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
      <div className="c-body start span2">{evRows(FLOWS.map(([d, k, v, n, s]) => [dayD(d), n, s, sgn(k, v), k]))}</div>
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
  const cellR = (name, fig, sub, body, st) => (
    <section className="cell s-6">
      <header className="c-hd">
        <span className="lbl">{name}</span>
        <span className="tag">{srcTxt('protocol')}</span>
      </header>
      <div className="c-fig">{figHtml(fig, sub)}</div>
      <div className="c-body">{body}</div>
      {strip(st)}
    </section>
  );
  const ap = cellR(
    'AssurancePool',
    money(M.assurance),
    'absorbs losses on unsecured credit',
    <>
      {chart({
        h: 132,
        max: 1600,
        yTicks: [0, 800, 1600],
        yFmt: (v) => (v ? '$' + v.toLocaleString('en-US') : '0'),
        x: NW.map((t, i) => ({
          t,
          x: px(i, NW.length),
        })).filter((_, i) => i % 2 === 0),
        paths: (
          <>
            {line(AP_REQ, 1600, 'ch-l2')}
            <path
              d={`M${AP_BAL.map((y, i) => `${px(i, NW.length) * 10},${(1 - y / 1600) * 100}`).join(' L')}`}
              className="ch-l1"
              style={css('stroke:var(--live)')}
            />
          </>
        ),
        marks: [
          {
            x: 100,
            v: M.assurance,
            c: 'var(--live)',
          },
          {
            x: 100,
            v: AP_REQ[AP_REQ.length - 1],
            c: 'var(--land)',
          },
        ],
      })}
      {mkey([
        ['var(--live)', 'Pool'],
        ['var(--land)', 'Floor · 20% of unsecured'],
      ])}
    </>,
    [
      ['Covers', money(M.unsecured)],
      ['Above floor', money(M.assurance - M.unsecured * M.floor)],
      ['Absorbed', money(M.lost)],
    ],
  );
  const queue = [
    ['22 Oct', 'Rosa’s Panadería', 412.6],
    ['2 Nov', 'Monthly run · 11 shops', 9510.65],
    ['4 Nov', 'Arrowhead Nails', 732.0],
    ['4 Nov', 'Cajon Phone Repair', 2184.0],
  ];
  let run = 0;
  const pp = cellR(
    'PayoutPool',
    money(M.payout),
    'pays shops, oldest claim first',
    <>
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
      </div>
      {mkey([
        ['var(--fg)', 'Covered now'],
        ['var(--line)', 'Waits on repayments'],
      ])}
    </>,
    [
      ['Owed by 4 Nov', money(M.owed14)],
      ['Repayments due', money(M.dueMembers)],
      ['Short', money(M.short), '', 'warn'],
    ],
  );
  const esa = cellR(
    'Member savings',
    money(M.savings),
    'CLRUSD, backed 1:1 by USDC at Bridge',
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
          <b className="num">{money(M.savings)}</b>
          <span className="k">USDC at Bridge · 2 min</span>
          <b className="num">{money(M.savings)}</b>
        </div>
      </div>
    </>,
    [
      ['Members', '124'],
      ['Average', money(M.savings / 124)],
      ['Reserve', '1 : 1'],
    ],
  );
  const coop = cellR(
    'Co-op balance',
    money(M.coop),
    'discounts on member purchases · held',
    <div className="ablock">
      <span className="lbl">Added each week</span>
      {columns(
        NW.slice(1).map((t, i) => [t, COOP_W[i]]),
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
      {G(
        'Pools',
        'Read from the chain · LendingPool and BondVault are deployed, not funded yet',
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

/* ── Credit: how much is out, and how safe ───────────────────────────── */
export function nCredit() {
  const out = [0, 900, 3100, 6200, 9400, 12100, M.credit],
    lim = [0, 8000, 15400, 24600, 31800, 37200, M.limits];
  const trend = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Owed against limits</span>
        <span className="tag">{srcTxt('protocol')}</span>
      </header>
      <div className="c-fig">{figHtml(pct(M.credit, M.limits), 'of limits drawn · up from 11.3% the week the first batch went out')}</div>
      <div className="c-body">
        {chart({
          h: 180,
          max: 45000,
          yTicks: [0, 15000, 30000, 45000],
          yFmt: (v) => (v ? `$${v / 1000}k` : '0'),
          x: NW.map((t, i) => ({
            t,
            x: px(i, NW.length),
          })),
          paths: (
            <>
              {line(lim, 45000, 'ch-l2')}
              <path
                d={`M${out.map((y, i) => `${px(i, NW.length) * 10},${(1 - y / 45000) * 100}`).join(' L')}`}
                className="ch-l1"
                style={css('stroke:var(--live)')}
              />
            </>
          ),
          marks: [
            {
              x: 100,
              v: M.limits,
              c: 'var(--land)',
            },
            {
              x: 100,
              v: M.credit,
              c: 'var(--live)',
            },
          ],
        })}
        {mkey([
          ['var(--live)', 'Owed'],
          ['var(--land)', 'Limits issued'],
        ])}
      </div>
      {strip([
        ['Owed', money(M.credit)],
        ['Limits', money(M.limits)],
        ['Members', '124'],
        ['Average limit', money(M.limits / 124)],
      ])}
    </section>
  );
  const backing = gCell(
    's-4',
    'What backs it',
    srcTxt('protocol'),
    figHtml(pct(M.savingsBacked, M.credit), 'backed by the member’s own savings'),
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
        <b>The AssurancePool covers it</b>
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
    figHtml(pct(12480.2, M.credit), 'of what’s owed is current'),
    columns(
      [
        ['Current', 12480.2],
        ['1–30 d', 1310.4],
        ['31–60 d', 421.8],
      ],
      {
        hi: 0,
        h: 96,
        fmt: (v) => money(v),
      },
    ),
    strip([
      ['Late', money(1310.4 + 421.8)],
      ['Over 60 d', 'None'],
    ]),
  );
  const losses = gCell(
    's-4 wt',
    'Losses',
    'All time',
    figHtml(money(M.lost), '3 members · absorbed by the AssurancePool'),
    evRows([
      ['22 Sep', 'Redlands Tire', 'Member M•••, 90 days late', money(204)],
      ['6 Oct', 'Citrus Bowl Café', 'Member M•••, 90 days late', money(204)],
      ['14 Oct', 'Cajon Phone Repair', 'Member M•••, 90 days late', money(204)],
    ]),
    strip([
      ['Loss rate', '1.1%'],
      ['Recovered', money(0)],
    ]),
  );
  const shops = TXO.slice()
      .sort((a, b) => b.oct - a.oct)
      .slice(0, 6),
    octAll = TXO.reduce((a, m) => a + m.oct, 0);
  const byShop = gCell(
    's-8',
    'Where it was spent',
    srcTxt('lithic'),
    figHtml(money(octAll), 'of credit spent at 12 shops in October'),
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
    strip([
      ['Top shop', pct(shops[0].oct, octAll)],
      [
        'Top 3',
        pct(
          shops.slice(0, 3).reduce((a, m) => a + m.oct, 0),
          octAll,
        ),
      ],
      ['6 others', money(octAll - shops.reduce((a, m) => a + m.oct, 0))],
    ]),
  );
  const limits = gCell(
    's-4 wt',
    'Limit sizes',
    '124 members',
    figHtml('$250', 'the most common limit · 46 members'),
    columns(
      [
        ['$100', 38],
        ['$250', 46],
        ['$500', 28],
        ['$1,000+', 12],
      ],
      {
        hi: 1,
        h: 132,
      },
    ),
    strip([
      ['Smallest', money(100)],
      ['Largest', money(1500)],
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
    figHtml(money(M.bonds), 'face value across 6 BurnerBonds, each its own token'),
    columns(months, {
      hi: 0,
      h: 128,
      fmt: (v) => (v ? '$' + (v / 1000).toFixed(1) + 'k' : ''),
    }),
    strip([
      ['Bonds', '6'],
      ['Next', '14 Dec'],
      ['Last', '15 Sep'],
      ['Kind', 'Zero-coupon'],
    ]),
  );
  const due = gCell(
    's-4 wt',
    'Due in 90 days',
    'Through 21 Jan',
    figHtml(money(7500), 'two bonds · cash covers it 2.9 times'),
    evRows([
      ['14 Dec', 'BB-0001', 'Member', money(2500)],
      ['21 Jan', 'BB-0002', 'Founding lender', money(5000)],
    ]),
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
  const start = TODAY - 2 * DAY; /* Monday 19 Oct */
  const days = Array.from(
    {
      length: 35,
    },
    (_, i) => {
      const t = start + i * DAY,
        d = new Date(t),
        dn = d.getUTCDate(),
        e = ev[i - 2],
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
        <span className="lbl">19 Oct – 22 Nov</span>
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
        <div className="phlist">{evRows(shown.map(([d, k, v, n, s]) => [dayD(d), n, s, sgn(k, v), k]))}</div>
        {mkey([
          ['var(--land)', 'In from members'],
          ['var(--fg)', 'Out to shops'],
        ])}
      </div>
      {strip([
        ['Movements', String(shown.length)],
        ['Out', money(out)],
        ['In', money(inn)],
        ['Pool low', '−' + money(M.short), '', 'warn'],
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
