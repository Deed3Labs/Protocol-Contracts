// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { Fragment } from 'react';
import { attrs, css, swapClass } from '../runtime/dom';
import { compBar, footItem, head, ic, int, pct } from './core';
import { BATCH_DATE, B_ACT, B_OPEN, DAY, MEMBERS, MS, M_ST, SRC_COL, UC_CAP, UC_STEPS, UK, vars } from './data';
import { G, columns, figHtml, figSide, fmtD, gCell, kpiCell, mask, maskMail } from './growth';
import { mkey } from './home';
import { ddHtml } from './kit';
import { modalShell, onKey } from './shell';
export function mCount(f) {
  return MEMBERS.filter(f).length;
}
export function mName(m) {
  return MS.reveal ? `${m.first} ${m.last}` : `${mask(m.first)} ${mask(m.last)}`;
}
/* stacked columns, one per batch: active / opened / not opened */
export function batchCols() {
  return (
    <div className="bcols">
      {B_ACT.map((a, i) => {
        const o = B_OPEN[i],
          n = 25 - a - o;
        return (
          <div key={i} className="bcol" title={`Batch ${i + 1}: ${a} active, ${o} opened, ${n} not opened`}>
            <span className="bv">{Math.round((a / 25) * 100)}%</span>
            <div className="bstack">
              <i style={css(`height:${(n / 25) * 100}%;background:var(--line)`)} />
              <i style={css(`height:${(o / 25) * 100}%;background:var(--land)`)} />
              <i style={css(`height:${(a / 25) * 100}%;background:var(--fg)`)} />
            </div>
            <span className="bk">{i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}
export function windowBar(left) {
  const used = Math.max(0, Math.min(90, 90 - left));
  return (
    <>
      <span className="wbar" title={`${left} of 90 days left`}>
        <i style={css(`width:${(used / 90) * 100}%`)} />
      </span>
      <span className="wnum num">{left}d</span>
    </>
  );
}
export function membersPage() {
  const title =
    MS.pane === 'overview' ? '64 people are one step from active.' : MS.pane === 'batches' ? 'Batch 13 is waiting on approval.' : '300 invited, 124 active.';
  const tools = (
    <button className="btn btn-p" type="button" data-mbatch="">
      <span className="dot pulse" style={css('color:var(--btn-dot)')} aria-hidden="true" />
      Plan a batch
    </button>
  );
  const tabs = [
    ['overview', 'Overview'],
    ['batches', 'Waitlist and batches'],
    ['accounts', 'Accounts'],
  ];
  return (
    <>
      {head(
        <>
          {'Members · '}
          <b>Demo data</b>
        </>,
        title,
        tools,
      )}
      <nav className="ptabs" aria-label="Members panes">
        {tabs.map(([v, t], __k) => (
          <button key={__k} type="button" data-mpane={v} aria-current={MS.pane === v ? 'page' : 'false'}>
            {t}
          </button>
        ))}
      </nav>
      {MS.pane === 'overview' ? mOverview() : MS.pane === 'batches' ? mBatches() : mAccounts()}
      {memberPane()}
    </>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────── */
export function uKind(m) {
  return m.spend ? 'spent' : m.status === 'active' ? 'active' : m.status === 'opened' ? 'opened' : m.quiet ? 'quiet' : 'invited';
}
export function unitCell() {
  const order = Object.keys(UK),
    list = MEMBERS.slice().sort((a, b) => order.indexOf(uKind(a)) - order.indexOf(uKind(b)) || a.id - b.id);
  const n = (k) => MEMBERS.filter((m) => uKind(m) === k).length,
    act = mCount((m) => m.status === 'active'),
    opn = n('opened'),
    total = MEMBERS.length;
  const unit = UC_STEPS.find((u) => Math.ceil(total / u) <= UC_CAP) || 1000,
    sty = (k) => (UK[k][1] ? ` style="--c:${UK[k][1]}"` : '');
  const sq =
    unit === 1
      ? list.map((m, __k) => {
          const k = uKind(m);
          return (
            <button
              key={__k}
              type="button"
              className={`uc-q ${k}`}
              data-member={m.id}
              title={`${m.first} ${m.last[0]}. · batch ${m.batch} · ${UK[k][0]}`}
              {...attrs(sty(k))}
            />
          );
        })
      : order.map((k, __k) => {
          const c = n(k),
            q = c ? Math.max(1, Math.round(c / unit)) : 0;
          return (<i className={`uc-q ${k}`} title={`${UK[k][0]} · ${int(c)}`} {...attrs(sty(k))} />).repeat(q);
        });
  const grid = <div className="uc">{sq}</div>;
  const key = (
    <div className="uc-k">
      {order.map((k, __k) => (
        <div key={__k} className={`uc-kr${k === 'opened' ? ' hl' : ''}`}>
          <i className={`uc-q ${k}`} {...attrs(UK[k][1] ? ` style="--c:${UK[k][1]}"` : '')} />
          <span>
            <b>{UK[k][0]}</b>
            <span className="small quiet">{UK[k][2]}</span>
          </span>
          <b className="num">{int(n(k))}</b>
        </div>
      ))}
    </div>
  );
  return gCell(
    's-8',
    'Members',
    `12 batches · ${unit === 1 ? 'a square each' : 'a square is ' + unit}`,
    figSide(int(act), 'active members', `${pct(act, total)} of ${int(total)} invited`),
    <>
      {grid}
      {key}
    </>,
    <div className="c-ft split">
      <button type="button" data-move="nudge">
        <span className="t">
          {'Nudge the '}
          {opn}
          {' who opened'}
        </span>
        {ic('chev', 'sm')}
      </button>
      <span className="rule" aria-hidden="true" />
      {footItem({
        t: 'Waitlist 1,500 · median wait 24 days',
      })}
    </div>,
  );
}
export function mOverview() {
  const act = mCount((m) => m.status === 'active'),
    opn = mCount((m) => m.status === 'opened'),
    inv = mCount((m) => m.status === 'invited'),
    spent = mCount((m) => m.spend),
    quiet = mCount((m) => m.quiet);
  const W_OPEN = [0, 0, 0, 0, 0, 0, 14, 18, 32, 48, 44, 32];
  const kpis = (
    <>
      {kpiCell(
        'Accounts',
        int(act + opn),
        `opened, of ${int(MEMBERS.length)} invited`,
        W_OPEN.map((v, i, a) => a.slice(0, i + 1).reduce((x, y) => x + y, 0)),
        'All time',
      )}
      {kpiCell('Active', int(act), `${pct(act, MEMBERS.length)} of everyone invited`, [0, 0, 0, 0, 0, 0, 9, 25, 49, 82, 117, 124], 'All time')}
      {kpiCell(
        'First spends',
        int(spent),
        `${pct(spent, act)} of active members · 97 were a poster’s $10`,
        [0, 0, 0, 0, 0, 0, 6, 19, 40, 68, 96, 109],
        'All time',
      )}
      {kpiCell('Waitlist', '1,500', 'waiting for an invite · median 24 days', [20, 48, 88, 118, 193, 288, 393, 572, 792, 1007, 1232, 1500], 'Now')}
    </>
  );

  /* where everyone is: one row per stage, bars on a shared square-root scale so 1,500 and 64 both read */
  const stages = [
    ['Waitlist', 1500, 'var(--line)', 'Waiting for an invite'],
    ['Invited, not opened', inv, 'var(--fg-50)', `${quiet} have gone quiet for 3+ weeks`],
    ['Opened, not funded', opn, 'var(--land)', 'No bank, deposit or $5 yet'],
    ['Active, no spend yet', act - spent, 'var(--fg-70)', 'Funded, waiting on a first spend'],
    ['Spent', spent, 'var(--fg)', 'Made a first spend at a partner shop'],
  ];
  const smax = Math.sqrt(1500);
  const pipe = gCell(
    's-7',
    'Where everyone is',
    'Now',
    figHtml(int(opn), 'opened an account but haven’t funded it, the easiest win'),
    <div className="stg">
      {stages.map(([k, v, c, note], i) => (
        <div key={i} className={`stg-r${i === 2 ? ' hl' : ''}`}>
          <span className="stg-k">
            <b>{k}</b>
            <span className="small quiet">{note}</span>
          </span>
          <b className="num stg-v">{int(v)}</b>
          <span className="stg-bar">
            <i style={css(`width:${((Math.sqrt(v) / smax) * 100).toFixed(1)}%;background:${c}`)} />
          </span>
        </div>
      ))}
    </div>,
    <div className="c-ft split">
      <button type="button" data-move="nudge">
        <span className="t">
          {'Nudge the '}
          {opn}
        </span>
        {ic('chev', 'sm')}
      </button>
      <span className="rule" aria-hidden="true" />
      {footItem({
        t: 'Bars use a square-root scale',
      })}
    </div>,
  );
  const how = [
    ['Connected a bank', mCount((m) => m.fund === 'Bank')],
    ['Added $5', mCount((m) => m.fund === '$5')],
    ['Direct deposit', mCount((m) => m.fund === 'Deposit')],
  ];
  const fund = gCell(
    's-5',
    'How they funded',
    'All time',
    figSide(pct(how[0][1], act), 'connected a bank', 'the most common way in'),
    <>
      {compBar(how.map(([k, v], i) => [k, v, SRC_COL[i]]))}
      <div className="how two">
        <span className="k">Median days, invite to active</span>
        <b className="num">6</b>
        <span className="k">From a poster</span>
        <b className="num">
          {pct(
            mCount((m) => m.status === 'active' && m.src === 'Poster'),
            act,
          )}
        </b>
      </div>
    </>,
  );
  const bcell = gCell(
    's-7',
    'Activation by batch',
    '12 batches of 25',
    figHtml('48%', 'active in batch 1, the oldest · batch 12 went out yesterday'),
    <>
      {batchCols()}
      {mkey([
        ['var(--fg)', 'Active'],
        ['var(--land)', 'Opened'],
        ['var(--line)', 'Not opened'],
      ])}
    </>,
    <div className="c-ft">
      <button type="button" data-mpane="batches">
        <span className="t">Batch history</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  const shopCount = {};
  MEMBERS.filter((m) => m.spend).forEach((m) => (shopCount[m.spend] = (shopCount[m.spend] || 0) + 1));
  const shops = Object.entries(shopCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const spendCell = gCell(
    's-5',
    'Where first spends happen',
    `${spent} first spends`,
    figHtml(shops[0][0], `${shops[0][1]} first spends, the most of any shop`),
    <div className="how">
      {shops.map(([k, v], __k) => (
        <Fragment key={__k}>
          <span className="k">{k}</span>
          <b className="num">{v}</b>
          <span className="quiet num">{pct(v, spent)}</span>
        </Fragment>
      ))}
    </div>,
    <div className="c-ft">
      <button type="button" data-go="merchants">
        <span className="t">Merchants</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  const cityC = {};
  MEMBERS.forEach((m) => {
    const c =
      cityC[m.city] ||
      (cityC[m.city] = {
        n: 0,
        a: 0,
      });
    c.n++;
    if (m.status === 'active') c.a++;
  });
  const cities = Object.entries(cityC).sort((a, b) => b[1].n - a[1].n);
  const cityCell = gCell(
    's-12',
    'By city',
    'Invited and active',
    figHtml(cities[0][0], `${cities[0][1].n} invited, the most of any city`),
    <>
      <div className="cityrows">
        {cities.map(([c, o], __k) => (
          <div key={__k} className="cr">
            <span className="cr-k">{c}</span>
            <span className="cr-bar">
              <i style={css(`width:${(o.n / cities[0][1].n) * 100}%`)} />
              <b style={css(`width:${(o.a / cities[0][1].n) * 100}%`)} />
            </span>
            <span className="num cr-v">
              {o.a}
              <span className="quiet">
                {' / '}
                {o.n}
              </span>
            </span>
            <span className="num quiet cr-p">{pct(o.a, o.n)}</span>
          </div>
        ))}
      </div>
      {mkey([
        ['var(--fg)', 'Active'],
        ['var(--line)', 'Invited'],
      ])}
    </>,
  );
  return (
    <>
      {G(
        'Everyone invited',
        'Select a square to open them',
        '',
        <>
          {unitCell()}
          {swapClass(fund, 'cell s-5', 'cell s-4 wt')}
        </>,
      )}
      {G(
        'Batches and spending',
        '',
        '',
        <>
          {bcell}
          {spendCell}
        </>,
      )}
      {G('Where members are', '', '', cityCell)}
    </>
  );
}

/* ── Waitlist and batches ─────────────────────────────────────────────── */
export function mBatches() {
  const n = MS.size;
  const order = {
    oldest: ['Oldest first', 'Longest wait goes first'],
    posters: ['Posters first', 'People who joined from a poster'],
    city: ['Redlands first', 'Where most partner shops are'],
  };
  /* preview of the next n on the waitlist */
  const pv =
    n === 25
      ? {
          wk: [25, 0, 0],
          src: [22, 3],
          city: [10, 7, 4, 4],
        }
      : n === 50
        ? {
            wk: [50, 0, 0],
            src: [43, 7],
            city: [19, 14, 9, 8],
          }
        : {
            wk: [71, 4, 0],
            src: [64, 11],
            city: [28, 21, 13, 13],
          };
  const nextCell = gCell(
    's-5',
    'Next batch',
    'Batch 13',
    figHtml('25', 'people · Marcus Lee proposed · needs a second approval'),
    <div className="how two">
      <span className="k">Joined between</span>
      <b>12 Sep – 20 Sep</b>
      <span className="k">From posters</span>
      <b className="num">19</b>
      <span className="k">From the website</span>
      <b className="num">6</b>
      <span className="k">Window ends</span>
      <b>19 Jan 2027</b>
    </div>,
    <div className="c-ft">
      <button type="button" data-go="home">
        <span className="t">Review it in Needs you</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  const plan = gCell(
    's-7',
    'Plan the batch after',
    'Batch 14',
    figHtml(String(n), `people, ${order[MS.order][0].toLowerCase()} · ${(1500 / (n * 3)).toFixed(0)} weeks to clear the waitlist at 3 a week`),
    <>
      <div className="plan-row">
        <div className="field">
          <span className="lbl">Size</span>
          <div className="seg" role="group" aria-label="Batch size">
            {[25, 50, 75].map((v, __k) => (
              <button key={__k} type="button" data-msize={v} aria-pressed={n === v}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="lbl">Who goes first</span>
          {ddHtml(
            'mord',
            Object.entries(order).map(([k, [t]]) => [k, t, '']),
            MS.order,
            'Who goes first',
          )}
        </div>
      </div>
      <div className="pv-grid">
        <div>
          <span className="lbl">Source</span>
          {compBar([
            ['Poster', pv.src[0], 'var(--fg)'],
            ['Website', pv.src[1], 'var(--line)'],
          ])}
        </div>
        <div>
          <span className="lbl">City</span>
          {compBar([
            ['Redlands', pv.city[0], 'var(--fg)'],
            ['San Bernardino', pv.city[1], 'var(--land)'],
            ['Riverside', pv.city[2], 'var(--fg-50)'],
            ['Other', pv.city[3], 'var(--line)'],
          ])}
        </div>
      </div>
    </>,
    <div className="c-ft">
      <button type="button" data-mbatch="">
        <span className="t">Propose batch 14 for a second approval</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  const ages = [
    ['< 1 wk', 318],
    ['1–2 wks', 300],
    ['2–3 wks', 270],
    ['3–4 wks', 172],
    ['4–6 wks', 260],
    ['6 wks +', 180],
  ];
  const ageCell = gCell(
    's-7',
    'How long people have waited',
    '1,500 on the waitlist',
    figHtml('24 days', 'median wait · 440 have waited over 4 weeks'),
    columns(ages, {
      hi: 5,
      h: 150,
    }),
    <div className="c-ft">
      <div className="row">
        <span className="t">The longest-waiting go first unless you pick otherwise</span>
      </div>
    </div>,
  );
  const srcCell = gCell(
    's-5',
    'Who is waiting',
    '1,500 on the waitlist',
    figHtml('82.4%', 'joined from a poster'),
    <>
      {compBar([
        ['Poster', 1236, 'var(--fg)'],
        ['Website', 264, 'var(--line)'],
      ])}
      <span className="lbl" style={css('margin-top:8px')}>
        City
      </span>
      {compBar([
        ['Redlands', 480, 'var(--fg)'],
        ['San Bernardino', 390, 'var(--land)'],
        ['Riverside', 270, 'var(--fg-50)'],
        ['Other', 360, 'var(--line)'],
      ])}
    </>,
  );
  const rows = B_ACT.map((a, i) => ({
    b: i + 1,
    sent: BATCH_DATE[i],
    a,
    o: B_OPEN[i],
    n: 25 - a - B_OPEN[i],
  })).reverse();
  const hist = (
    <div className="tbl-wrap">
      <table className="tbl compact">
        <thead>
          <tr>
            <th className="l">Batch</th>
            <th className="l">Sent</th>
            <th>People</th>
            <th>Opened</th>
            <th>Active</th>
            <th>Active rate</th>
            <th className="l">Split</th>
            <th className="l">Window ends</th>
          </tr>
        </thead>
        <tbody>
          <tr className="rest">
            <td className="l">
              <b>13</b>
            </td>
            <td className="l">Waiting</td>
            <td>25</td>
            <td>–</td>
            <td>–</td>
            <td>–</td>
            <td className="l">
              <span className="chip underway">Needs approval</span>
            </td>
            <td className="l">–</td>
          </tr>
          {rows.map((r, __k) => (
            <tr key={__k}>
              <td className="l">
                <b>{r.b}</b>
              </td>
              <td className="l">{fmtD(r.sent)}</td>
              <td>25</td>
              <td>{r.a + r.o}</td>
              <td>{r.a}</td>
              <td>{pct(r.a, 25)}</td>
              <td className="l">
                <span className="minibar">
                  <i style={css(`flex:${r.a};background:var(--fg)`)} />
                  <i style={css(`flex:${r.o};background:var(--land)`)} />
                  <i style={css(`flex:${r.n};background:var(--line)`)} />
                </span>
              </td>
              <td className="l">{fmtD(r.sent + 90 * DAY)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="l">
              <b>All</b>
            </td>
            <td />
            <td>300</td>
            <td>188</td>
            <td>124</td>
            <td>41.3%</td>
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
  const histCell = gCell('s-12', 'Batch history', 'Newest first', '', <div className="flush-x">{hist}</div>);
  return (
    <>
      {G(
        'Batches',
        'Each batch needs two people: one proposes, another approves',
        '',
        <>
          {nextCell}
          {plan}
        </>,
      )}
      {G(
        'The waitlist',
        '',
        '',
        <>
          {ageCell}
          {srcCell}
        </>,
      )}
      {G('History', '', '', histCell)}
    </>
  );
}

/* ── Accounts ─────────────────────────────────────────────────────────── */
export function mAccounts() {
  const fl = {
    all: (m) => true,
    active: (m) => m.status === 'active',
    opened: (m) => m.status === 'opened',
    invited: (m) => m.status === 'invited',
    quiet: (m) => m.quiet,
  };
  const opts = [
    ['all', 'Everyone invited', MEMBERS.length],
    ['active', 'Active', mCount(fl.active)],
    ['opened', 'Opened, not funded', mCount(fl.opened)],
    ['invited', 'Not opened', mCount(fl.invited)],
    ['quiet', 'Gone quiet', mCount(fl.quiet)],
  ];
  const list = MEMBERS.filter(fl[MS.mf])
    .slice()
    .sort((a, b) => b.batch - a.batch || b.last_ - a.last_ || a.id - b.id);
  const per = 15,
    pages = Math.max(1, Math.ceil(list.length / per));
  MS.pg = Math.min(MS.pg, pages - 1);
  const slice = list.slice(MS.pg * per, MS.pg * per + per);
  const strip = [
    ['Active', mCount(fl.active), 'var(--fg)'],
    ['Opened, not funded', mCount(fl.opened), 'var(--land)'],
    ['Not opened', mCount(fl.invited), 'var(--line)'],
  ];
  const summary = gCell(
    's-12',
    'Everyone invited',
    `${MEMBERS.length} people`,
    figHtml(int(mCount(fl.active)), `active · ${mCount(fl.quiet)} invited 3+ weeks ago and never opened`),
    compBar(strip),
  );
  const tbl = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Accounts</span>
        <span className="hd-tools">{ddHtml('mf', opts, MS.mf, 'Show')}</span>
      </header>
      <div className="c-fig" />
      <div className="c-body flush">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="l">Member</th>
                <th className="l">Status</th>
                <th>Batch</th>
                <th className="l">Invited</th>
                <th className="l">Funded by</th>
                <th className="l">First spend</th>
                <th className="l">City</th>
                <th className="l">90-day window</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((m, __k) => (
                <tr key={__k} className="click" data-member={m.id} tabIndex="0">
                  <td className="l">
                    <b>{mName(m)}</b>
                    <span className="quiet small">
                      <span className="mono">{m.no}</span>
                      {m.quiet ? (
                        <>
                          {' · '}
                          <span className="late">Gone quiet</span>
                        </>
                      ) : (
                        ''
                      )}
                    </span>
                  </td>
                  <td className="l">
                    <span className={`chip ${M_ST[m.status][0]}`}>{M_ST[m.status][1]}</span>
                  </td>
                  <td>{m.batch}</td>
                  <td className="l">{fmtD(m.invited)}</td>
                  <td className="l">{m.fund || <span className="quiet">–</span>}</td>
                  <td className="l small">{m.spend || <span className="quiet">–</span>}</td>
                  <td className="l">{m.city}</td>
                  <td className="l">
                    <span className="wcell">{m.status === 'active' ? <span className="small quiet">Done</span> : windowBar(m.left)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="c-ft">
        <button type="button" className={`pv${MS.reveal ? ' on' : ''}`} data-mreveal="" aria-pressed={MS.reveal}>
          <span className="pv-l">
            {ic(MS.reveal ? 'eye' : 'lockc', 'sm')}
            <span>
              <b>{MS.reveal ? 'Names shown' : 'Names hidden'}</b>
              <span className="quiet">
                {' · '}
                {MS.reveal ? 'this view is logged' : 'personal details are masked'}
              </span>
            </span>
          </span>
          <span className="pv-r">
            <span className="pv-t">{MS.reveal ? 'Hide' : 'Show'}</span>
            <span className="tgl" aria-hidden="true">
              <i />
            </span>
          </span>
        </button>
      </div>
      <footer className="p-ft">
        <div className="pg-lbl">
          {'Page '}
          {MS.pg + 1}
          {' of '}
          {pages}
          {' · '}
          {list.length}
          {' people'}
        </div>
        <span className="rule" aria-hidden="true" />
        <div className="p-pg">
          <div className="dots">
            {pages > 1 && pages <= 10
              ? Array.from(
                  {
                    length: pages,
                  },
                  (_, i) => <button key={i} type="button" data-mpg={i} aria-current={i === MS.pg} aria-label={`Page ${i + 1}`} />,
                )
              : ''}
          </div>
          <div className="p-nav">
            <button type="button" data-mpg={MS.pg - 1} {...attrs(MS.pg === 0 ? 'disabled' : '')} aria-label="Previous page">
              {ic('chevl', 'sm')}
            </button>
            <button type="button" data-mpg={MS.pg + 1} {...attrs(MS.pg >= pages - 1 ? 'disabled' : '')} aria-label="Next page">
              {ic('chev', 'sm')}
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
  return (
    <>
      {G('Summary', '', '', summary)}
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">Accounts</span>
          <span className="lbl aside">Select someone to open their record</span>
        </div>
        <div className="bento">{tbl}</div>
      </div>
    </>
  );
}

/* Member record: a pane, with a timeline of what happened */
export function memberPane() {
  if (MS.member == null) return '';
  const m = MEMBERS.find((x) => x.id === MS.member);
  if (!m) return '';
  const ev = [
    ['Joined the waitlist', m.joined, m.poster ? `From ${m.poster}` : 'From the website'],
    ['Invited', m.invited, `Batch ${m.batch}`],
  ];
  if (m.opened) ev.push(['Opened an account', m.opened, 'In the Clear app']);
  if (m.activeAt) ev.push([m.fund === 'Bank' ? 'Connected a bank' : m.fund === '$5' ? 'Added $5' : 'Set up direct deposit', m.activeAt, 'Now active']);
  if (m.spentAt) ev.push(['First spend', m.spentAt, `$10.00 at ${m.spend}`]);
  const next =
    m.status === 'invited'
      ? ['Not opened yet', m.quiet ? 'Gone quiet. A resend usually helps.' : 'Still early in the window.']
      : m.status === 'opened'
        ? ['One step left', 'Connect a bank, set up deposit or add $5.']
        : null;
  const action = m.status === 'invited' ? ['Resend invite', 'resend'] : m.status === 'opened' ? ['Send a nudge', 'nudge1'] : null;
  const used = Math.max(0, 90 - m.left);
  return (
    <>
      <div className="pane-scrim" data-closempane="" />
      <aside className="pane" role="dialog" aria-label={m.no}>
        <header className="m-hd">
          <span className="sub mono">{m.no}</span>
          <span style={css('display:flex;align-items:center;gap:8px')}>
            <span className={`chip ${M_ST[m.status][0]}`}>{M_ST[m.status][1]}</span>
            <button className="x" type="button" data-closempane="" aria-label="Close">
              {ic('close')}
            </button>
          </span>
        </header>
        <div className="pane-mn">
          <div>
            <p className="h2" style={css('font-size:28px')}>
              {mName(m)}
            </p>
            <p className="quiet" style={css('margin:8px 0 0')}>
              {m.city}
              {' · batch '}
              {m.batch}
              {' · '}
              {MS.reveal ? `${m.first.toLowerCase()}.${m.last.toLowerCase()}@gmail.com` : maskMail(m.first.toLowerCase() + '@gmail.com')}
            </p>
          </div>
          <div className="pp-figs">
            <div>
              <span className="lbl">Days left</span>
              <span className="fig fig-l">{m.status === 'active' ? '–' : m.left}</span>
            </div>
            <div>
              <span className="lbl">Funded by</span>
              <span className="fig fig-l">{m.fund || '–'}</span>
            </div>
            <div>
              <span className="lbl">Spends</span>
              <span className="fig fig-l">{m.spend ? 1 : 0}</span>
            </div>
          </div>
          {m.status !== 'active' ? (
            <div>
              <span className="lbl">90-day window</span>
              <div className="wline">
                <i style={css(`width:${(used / 90) * 100}%`)} />
                <span style={css(`left:${(used / 90) * 100}%`)}>Today</span>
              </div>
              <div className="axis" style={css('margin-top:24px')}>
                <span>{fmtD(m.invited)}</span>
                <span>{fmtD(m.invited + 90 * DAY)}</span>
              </div>
            </div>
          ) : (
            ''
          )}
          {next ? (
            <div className="note">
              {ic('chev', 'sm')}
              <span>
                <b>{next[0]}.</b> {next[1]}
              </span>
            </div>
          ) : (
            ''
          )}
          <div>
            <span className="lbl">What happened</span>
            <ol className="feed mfeed">
              {ev.map((e, i) => (
                <li key={i}>
                  <div className="mf-row">
                    <span className={`node${i === ev.length - 1 ? ' on' : ''}`} />
                    <span className="when">{fmtD(e[1])}</span>
                    <span className="what">{e[0]}</span>
                    <span className="small quiet">{e[2]}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="pv-inline">
            <button type="button" className={`pv${MS.reveal ? ' on' : ''}`} data-mreveal="" aria-pressed={MS.reveal}>
              <span className="pv-l">
                {ic(MS.reveal ? 'eye' : 'lockc', 'sm')}
                <span>
                  <b>{MS.reveal ? 'Details shown' : 'Details hidden'}</b>
                </span>
              </span>
              <span className="pv-r">
                <span className="pv-t">{MS.reveal ? 'Hide' : 'Show'}</span>
                <span className="tgl" aria-hidden="true">
                  <i />
                </span>
              </span>
            </button>
          </div>
        </div>
        <footer className="pane-ft">
          <button className="btn btn-g" type="button" data-mturnoff={m.id}>
            Turn off access
          </button>
          {action ? (
            <button className="btn btn-p" type="button" data-mact={action[1]} data-mid={m.id}>
              {action[0]}
            </button>
          ) : (
            ''
          )}
        </footer>
      </aside>
    </>
  );
}
export function openMemberFlow(kind, id) {
  vars.lastFocus = document.activeElement;
  const m = MEMBERS.find((x) => x.id === id);
  const f = {
    resend: {
      t: 'Resend invite',
      h: mName(m),
      rows: [
        ['Batch', String(m.batch)],
        ['Invited', fmtD(m.invited)],
        ['Window ends', fmtD(m.invited + 90 * DAY), 1],
      ],
      btn: 'Resend invite',
      steps: ['Made a fresh invite link', 'Sent it by text and email', 'Logged the resend'],
      done: ['Invite resent.', 'Their window still ends ' + fmtD(m.invited + 90 * DAY) + '.'],
    },
    nudge1: {
      t: 'Send a nudge',
      h: mName(m),
      rows: [
        ['Status', 'Opened, not funded'],
        ['Message', 'One step left: connect a bank or add $5'],
        ['Where', 'In the Clear app', 1],
      ],
      btn: 'Send nudge',
      steps: ['Queued the message in the app', 'Logged the nudge'],
      done: ['Nudge sent.', 'You’ll see it here if they fund.'],
    },
    off: {
      t: 'Turn off access',
      h: mName(m),
      rows: [
        ['What stops', 'Sign-in and new spending'],
        ['What stays', 'Their account record and history'],
        ['Undo', 'Turn it back on any time', 1],
      ],
      btn: 'Turn off access',
      steps: ['Signed them out everywhere', 'Paused new spending', 'Logged who turned it off'],
      done: ['Access turned off.', 'Their record is kept. You can turn it back on.'],
    },
    batch: {
      t: 'Propose batch 14',
      h: `${MS.size} people`,
      rows: [
        [
          'Who goes first',
          {
            oldest: 'Oldest first',
            posters: 'Posters first',
            city: 'Redlands first',
          }[MS.order],
        ],
        ['Approval', 'Someone else approves before it sends'],
        ['Window', '90 days from the day it sends', 1],
      ],
      btn: 'Propose batch 14',
      steps: [`Picked ${MS.size} people from the waitlist`, 'Checked none are already members', 'Sent it to Needs you for a second approval'],
      done: ['Batch 14 proposed.', 'It sends once someone else approves it.'],
    },
  }[kind];
  modalShell(
    f.t,
    <>
      <div>
        <span className="lbl">{f.t}</span>
        <p className="h2" style={css('margin-top:8px')}>
          {f.h}
        </p>
      </div>
      <div className="rows ledger">
        {f.rows.map(([k, v, t], __k) => (
          <div key={__k} className={`r${t ? ' total' : ''}`}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
      <div className="acts">
        <button className="btn btn-p" type="button" data-mgo={kind}>
          {f.btn}
        </button>
        <button className="btn btn-g" type="button" data-close="">
          Not now
        </button>
      </div>
    </>,
    'Every change is logged',
  );
  document.addEventListener('keydown', onKey);
  openMemberFlow.f = f;
}

/* A row of connected stages with a proportion bar under it. Used for the pipeline and the refurb line. */
export function stageFlow(stages, hi, unit) {
  const tot = stages.reduce((a, s) => a + s[1], 0);
  const cols = stages.map(() => 'auto').join(' minmax(16px,1fr) ');
  return (
    <>
      <div className="sflow" style={css(`grid-template-columns:${cols}`)}>
        {stages.map(([k, v, note], i) => (
          <Fragment key={i}>
            {i ? (
              <span className="sfc" aria-hidden="true">
                {ic('chev', 'sm')}
              </span>
            ) : (
              ''
            )}
            <div className={`sf${i === hi ? ' hi' : ''}`}>
              <span className="lbl">{k}</span>
              <b className="fig fig-l">{int(v)}</b>
              <span className="small quiet">{note || ''}</span>
            </div>
          </Fragment>
        ))}
      </div>
      <div className="sbar" role="img" aria-label={stages.map((s) => s[0] + ' ' + s[1]).join(', ')}>
        {stages.map(([k, v], i) => (
          <i key={i} style={css(`flex:${v};background:${i === hi ? 'var(--fg)' : i > hi ? 'var(--land)' : 'var(--line)'}`)} />
        ))}
      </div>
      <div className="sbar-k">
        <span>
          {int(tot)} {unit}
        </span>
        <span>
          {pct(stages[hi][1], tot)} {stages[hi][0].toLowerCase()}
        </span>
      </div>
    </>
  );
}

/* ══ Merchants ═══════════════════════════════════════════════════════════
   Ties to Home and Growth: 30 poster shops are partners · 12 transacting (Uptown Barber joined today) ·
   founding seats 3 filled, Inland Cycle Works signing as 4/5 · $430.00 in $10 redemptions owed across 11 shops ·
   Rosa's payout $412.60 on NET-14 due tomorrow · Rosa's cap $100 to $150 waiting in the multisig · Mesa's cap raised to $120. */
