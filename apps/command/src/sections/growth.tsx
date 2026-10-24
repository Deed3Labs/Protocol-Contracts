// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { live } from '../live/actions';
import { LIVE, REAL } from '../live/env';
import { fig } from '../live/figures';
import { Fragment } from 'react';
import { attrs, css } from '../runtime/dom';
import { $, compBar, footItem, head, ic, int, pct, series } from './core';
import {
  BOARDS,
  CITY_V,
  COHORTS,
  DAY,
  DESIGNS,
  FORMS,
  GS,
  HEAT,
  INBOX,
  LANDING,
  MEMBERS,
  MON,
  OTHERS,
  PER_PAGE,
  POSTERS,
  RANGE,
  REFS,
  SC_COL,
  SHOPS,
  SHOP_NO,
  SRC30,
  SRC_COL,
  ST,
  TODAY,
  WEEKS,
  W_ACT,
  W_INV,
  W_JOIN,
  W_SRC,
  W_VIS,
  W_WAIT,
  vars,
} from './data';
import { mkey } from './home';
import { ddHtml } from './kit';
import { nextBatch } from './members';
import { modalShell, onKey, vLevel } from './shell';
export function fmtD(t) {
  const d = new Date(t);
  return d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
}
export function daysTo(t) {
  return Math.round((t - TODAY) / DAY);
}
export function pid(n) {
  return 'P-' + String(n).padStart(3, '0');
}
export function slug(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/’/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
/* Small drawn thumbnail of each poster design, so the table and cards show which is which */
export function designThumb(k, size = 40) {
  const h = size * 1.3;
  const inner =
    k === 'A' ? (
      <>
        <rect x="5" y="8" width="22" height="5" style={css('fill:var(--fg)')} />
        <rect x="5" y="16" width="16" height="5" style={css('fill:var(--fg)')} />
        <circle cx="25" cy="34" r="5" style={css('fill:none;stroke:var(--fg);stroke-width:1.5')} />
        <rect x="5" y="44" width="10" height="2" style={css('fill:var(--fg-50)')} />
      </>
    ) : k === 'B' ? (
      <>
        <text x="5" y="27" style={css('font:800 15px var(--f-display);fill:var(--fg);letter-spacing:-.04em')}>
          $10
        </text>
        <rect x="5" y="33" width="20" height="3" style={css('fill:var(--fg)')} />
        <rect x="5" y="44" width="10" height="2" style={css('fill:var(--fg-50)')} />
      </>
    ) : (
      <>
        <path d="M5 12h22M5 20h22M5 28h22M11 6v32M19 6v32" style={css('stroke:var(--fg-50);stroke-width:1;fill:none')} />
        <rect x="16" y="17" width="6" height="6" style={css('fill:var(--fg)')} />
        <rect x="5" y="44" width="10" height="2" style={css('fill:var(--fg-50)')} />
      </>
    );
  return (
    <svg className="thumb" viewBox="0 0 32 52" width={size} height={h} aria-hidden="true">
      <rect x=".5" y=".5" width="31" height="51" style={css('fill:var(--raised);stroke:var(--line)')} />
      {inner}
    </svg>
  );
}
export function miniSpark(seed, total, n = 14, w = 96, h = 24, cls = 'tspark') {
  const v = series(n, Math.max(total, n), (i) => 0.7 + 0.3 * Math.sin((i + seed) / 2.3) + 0.02 * i, seed + 3);
  const max = Math.max(...v),
    min = Math.min(...v);
  const pts = v.map((y, i) => `${((i / (n - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((y - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`);
  return (
    <svg className={cls} viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={`M${pts.join(' L')}`} />
    </svg>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */
export function growthPage() {
  const due = POSTERS.filter((p) => p.status !== 'up').length;
  const W = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const title =
    GS.pane === 'overview'
      ? 'Joins are outpacing invites.'
      : GS.pane === 'acq'
        ? 'Posters bring the visitors who join.'
        : GS.pane === 'cohorts'
          ? 'Seven in ten activate within a week.'
          : GS.pane === 'shops'
            ? REAL
              ? SHOPS.length
                ? `${SHOPS.reduce((a, b) => (perOr0(b[4], b[3]) > perOr0(a[4], a[3]) ? b : a))[1]} converts best.`
                : 'No shop scans yet.'
              : 'Uptown Barber converts best.'
            : GS.pane === 'site'
              ? 'Eight new forms since this morning.'
              : due
                ? `${W[due] || due} poster${due === 1 ? '' : 's'} need${due === 1 ? 's' : ''} a swap.`
                : POSTERS.length
                  ? 'Every poster is up.'
                  : 'No posters up yet.';
  const tools = (
    <button className="btn btn-p" type="button" data-addposter="">
      <span className="dot pulse" style={css('color:var(--btn-dot)')} aria-hidden="true" />
      Add a poster
    </button>
  );
  const tabs = [
    ['overview', 'Overview'],
    ['acq', 'Acquisition'],
    ['cohorts', 'Cohorts'],
    ['shops', 'Shops and designs'],
    ['posters', 'Posters'],
    ['site', 'Forms'],
  ].filter(([v]) => !(LIVE && v === 'site' && vLevel('growth') === 1));
  if (LIVE && GS.pane === 'site' && vLevel('growth') === 1) GS.pane = 'overview';
  return (
    <>
      {head(
        <>
          {'Growth · Soft launch · '}
          <b>{REAL ? 'Real data' : 'Demo data'}</b>
        </>,
        title,
        tools,
      )}
      <nav className="ptabs" aria-label="Growth panes">
        {tabs.map(([v, t], __k) => (
          <button key={__k} type="button" data-gpane={v} aria-current={GS.pane === v ? 'page' : 'false'}>
            {t}
          </button>
        ))}
      </nav>
      {GS.pane === 'overview'
        ? gOverview()
        : GS.pane === 'acq'
          ? gAcquisition()
          : GS.pane === 'cohorts'
            ? gCohorts()
            : GS.pane === 'shops'
              ? gFunnel()
              : GS.pane === 'posters'
                ? gPosters()
                : gSite()}
      {posterPane()}
    </>
  );
}

/* ── Overview pane: is growth working, where, and what to do next ─────── */
/* ── Overview pane ────────────────────────────────────────────────────────
   Read top to bottom: this week at a glance, the one trend that matters (joins vs invites),
   what to do about it, then where growth comes from. Charts draw their shapes in SVG and their
   words in HTML, so labels stay 11px at every width and never collide with lines. */
/* One chart frame for every chart on the page */
export function chart({ h = 200, max, yTicks = [], x = [], paths = '', marks = [], notes = [], yFmt = (v) => v }) {
  const Y = (v) => (1 - v / max) * 100;
  return (
    <div className="chart" style={css(`--ch:${h}px`)}>
      <div className="ch-y">
        {yTicks.map((v, __k) => (
          <span key={__k} style={css(`top:${Y(v)}%`)}>
            {yFmt(v)}
          </span>
        ))}
      </div>
      <div className="ch-plot">
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          {yTicks.map((v, __k) => (
            <line key={__k} x1="0" x2="1000" y1={Y(v)} y2={Y(v)} className="ch-grid" />
          ))}
          {notes.map((n, __k) => (
            <line key={__k} x1={n.x * 10} x2={n.x * 10} y1="0" y2="100" className="ch-note" />
          ))}
          {paths}
        </svg>
        {notes.map((n, __k) => (
          <span key={__k} className="ch-ntext" style={css(`left:${n.x}%`)}>
            {n.t}
          </span>
        ))}
        {marks.map((m, __k) => (
          <i key={__k} className="ch-mark" style={css(`left:${m.x}%;top:${Y(m.v)}%;background:${m.c}`)} />
        ))}
      </div>
      <div className="ch-x">
        {x.map((l, __k) => (
          <span key={__k} style={css(`left:${l.x}%`)} className={l.x < 1 ? 'a0' : l.x > 99 ? 'a1' : ''}>
            {l.t}
          </span>
        ))}
      </div>
    </div>
  );
}
export function px(i, n) {
  return (i / (n - 1)) * 100;
}
export function line(v, max, cls) {
  return <path d={`M${v.map((y, i) => `${px(i, v.length) * 10},${(1 - y / max) * 100}`).join(' L')}`} className={cls} />;
}
export function spark(v, color = 'var(--fg)') {
  const max = Math.max(...v) * 1.08 || 1;
  return (
    <div className="kspark">
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={`M0,100 L${v.map((y, i) => `${px(i, v.length) * 10},${(1 - y / max) * 100}`).join(' L')} L1000,100 Z`} className="ks-area" />
        {line(v, max, 'ks-line')}
      </svg>
      <i style={css(`top:${(1 - v[v.length - 1] / max) * 100}%;background:${color}`)} />
    </div>
  );
}
export function gOverview() {
  const n = WEEKS.length,
    L = n - 1;
  const xl = WEEKS.map((t, i) => ({
    t,
    x: px(i, n),
  })).filter((_, i) => i % 3 === 0 || i === L);

  /* 1 · This week */
  const kpi = (label, fig, sub, v, tag = 'This week') => kpiCell(label, fig, sub, v, tag);
  const dv = W_VIS[L - 1] ? (W_VIS[L] / W_VIS[L - 1] - 1) * 100 : 0,
    dj = W_JOIN[L - 1] ? (W_JOIN[L] / W_JOIN[L - 1] - 1) * 100 : 0;
  const week = (
    <>
      {kpi('Visits', int(W_VIS[L]), `+${dv.toFixed(1)}% on last week`, W_VIS)}
      {kpi('Joined', int(W_JOIN[L]), `+${dj.toFixed(1)}% on last week`, W_JOIN)}
      {kpi('Invited', int(W_INV[L]), `${W_INV[L] / 25} batches of 25 · batch ${nextBatch()?.number ?? '–'} waiting`, W_INV)}
      {kpi('Waiting', int(W_WAIT[L]), `on the waitlist · median ${figOr('members.waitlist.median_days', 0)} days`, W_WAIT, 'Now')}
    </>
  );

  /* 2 · Joins against invites. The shaded gap is the waitlist growing. */
  const max = 400;
  const gap = (
    <path
      d={`M${W_JOIN.map((y, i) => `${px(i, n) * 10},${(1 - y / max) * 100}`).join(' L')} L${W_INV.map((y, i) => `${px(i, n) * 10},${(1 - y / max) * 100}`)
        .reverse()
        .join(' L')} Z`}
      className="ch-gap"
    />
  );
  const trend = (
    <section className="cell s-12" data-state="underway">
      <header className="c-hd">
        <span className="lbl">Joins against invites</span>
        <span className="tag">{`Weekly · since ${WEEKS[0]}`}</span>
      </header>
      <div className="c-fig">
        <span className="fig fig-xl">
          {perOr0(W_JOIN[L], W_INV[L]).toFixed(1)}
          {' to 1'}
        </span>
        <span className="figsub">people join for every one we invite · the gap is the waitlist growing</span>
      </div>
      <div className="c-body">
        {chart({
          h: 240,
          max,
          yTicks: [0, 100, 200, 300, 400],
          x: xl,
          paths: (
            <>
              {gap}
              {line(W_JOIN, max, 'ch-l1')}
              {line(W_INV, max, 'ch-l2')}
              {line(W_ACT, max, 'ch-l3')}
            </>
          ),
          marks: [
            {
              x: 100,
              v: W_JOIN[L],
              c: 'var(--fg)',
            },
            {
              x: 100,
              v: W_INV[L],
              c: 'var(--land)',
            },
            {
              x: 100,
              v: W_ACT[L],
              c: 'var(--fg-50)',
            },
          ],
          notes: REAL
            ? []
            : [
                {
                  x: px(2, n),
                  t: 'Posters up',
                },
                {
                  x: px(6, n),
                  t: 'Invites start',
                },
              ],
        })}
        {mkey([
          ['var(--fg)', `Joined ${W_JOIN[L]}`],
          ['var(--land)', `Invited ${W_INV[L]}`],
          ['var(--fg-50)', `Activated ${W_ACT[L]}`],
          ['var(--hair)', 'Waitlist growth'],
        ])}
      </div>
      <div className="c-ft split">
        {footItem({
          t: `At this pace the waitlist takes ${figOr('growth.waitlist.weeks_to_clear', 0)} weeks to clear`,
        })}
        <span className="rule" aria-hidden="true" />
        <button type="button" data-move="pace">
          <span className="t">Raise the invite pace</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );

  /* 3 · Next moves */
  const byCity = {};
  Object.entries(CITY_V).forEach(
    ([c, v]) =>
      (byCity[c] = {
        v,
        p: 0,
      }),
  );
  POSTERS.forEach((p) => {
    if (byCity[p.city]) byCity[p.city].p++;
  });
  const cities = Object.entries(byCity)
    .filter(([, o]) => o.p > 0)
    .map(([c, o]) => ({
      c,
      v: o.v,
      p: o.p,
      vp: o.v / o.p,
    }));
  const pick = cities.slice().sort((a, b) => b.vp - a.vp)[0];
  const move = (icon, kind, title, fig, figSub, why, btn, act) => (
    <section className="cell">
      <header className="c-hd">
        <span className="c-kind">
          {ic(icon, 'sm')}
          <span className="lbl">{kind}</span>
        </span>
        <span className="tag">Suggested</span>
      </header>
      <div className="c-fig">
        <h3 className="w-title">{title}</h3>
        <span className="fig fig-l">{fig}</span>
        <span className="figsub">{figSub}</span>
      </div>
      <div className="c-body">
        <span className="small quiet">{why}</span>
      </div>
      <div className="c-ft">
        <button type="button" {...attrs(act)}>
          <span className="t">{btn}</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
  const aJr = DESIGNS.A ? ((DESIGNS.A.joined / DESIGNS.A.scans) * 100).toFixed(1) : '0.0';
  /* nothing to suggest yet: the move's cell, with no figure and no button */
  const noMove = (icon, kind, why) => (
    <section className="cell">
      <header className="c-hd">
        <span className="c-kind">
          {ic(icon, 'sm')}
          <span className="lbl">{kind}</span>
        </span>
        <span className="tag" />
      </header>
      <div className="c-fig" />
      <div className="c-body">
        <span className="small quiet">{why}</span>
      </div>
      <div />
    </section>
  );
  const moves = (
    <>
      {!SHOPS.length
        ? noMove('field', 'Swap design', 'No shop scans yet.')
        : move(
            'field',
            'Swap design',
            lowestShop()[1],
            pctOr0(lowestShop()[4], lowestShop()[3]),
            `join rate on ${int(lowestShop()[3])} scans`,
            `Lowest of the top 10 shops. Design A averages ${aJr}%.`,
            'Plan the swap',
            'data-move="swap"',
          )}
      {!pick
        ? noMove('growth', 'Add posters', 'No posters up yet.')
        : move(
            'growth',
            'Add posters',
            pick.c,
            int(Math.round(pick.vp)),
            'visits per poster, the most of any city',
            `${int(pick.v)} visits this month and ${pick.p} posters up.`,
            `Add a poster in ${pick.c}`,
            `data-move="add" data-city="${pick.c}"`,
          )}
      {move(
        'members',
        'Nudge',
        'Opened, not funded',
        int(memberSummary().opened),
        'people one step from activating',
        'No bank, no deposit and no $5 yet.',
        'Send a nudge',
        'data-move="nudge"',
      )}
    </>
  );

  /* 4 · Where it comes from */
  const top = cities.sort((a, b) => b.v - a.v).slice(0, 8),
    vpMax = 600;
  const cityCell = !pick ? (
    gCell(
      '',
      'Cities',
      'Last 30 days',
      figHtml('0', 'visits per poster'),
      <span className="small quiet">No posters up yet.</span>,
      <div className="c-ft">
        <button type="button" data-gpane="shops">
          <span className="t">Shops in each city</span>
          {ic('chev', 'sm')}
        </button>
      </div>,
    )
  ) : (
    <section className="cell">
      <header className="c-hd">
        <span className="lbl">Cities</span>
        <span className="tag">Last 30 days</span>
      </header>
      <div className="c-fig">
        <span className="fig fig-xl">{int(Math.round(pick.vp))}</span>
        <span className="figsub">
          {'visits per poster in '}
          {pick.c}, the most of any city
        </span>
      </div>
      <div className="c-body">
        <div className="dots-plot">
          <div className="dp-row dp-head">
            <span>City</span>
            <span>Visits</span>
            <span>Posters</span>
            <span className="dp-scale">
              <b style={css('left:0')}>0</b>
              <b style={css('left:50%')}>300</b>
              <b style={css('left:100%')}>600</b>
            </span>
          </div>
          {top.map((c, __k) => (
            <div key={__k} className={`dp-row${c === pick ? ' pick' : ''}`}>
              <span className="dp-c">{c.c}</span>
              <span className="num">{int(c.v)}</span>
              <span className="num">{c.p}</span>
              <span className="dp-track">
                <i style={css(`left:${Math.min(100, (c.vp / vpMax) * 100)}%`)} />
                <em style={css(`left:${Math.min(100, (c.vp / vpMax) * 100)}%`)}>{int(Math.round(c.vp))}</em>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="c-ft">
        <button type="button" data-gpane="shops">
          <span className="t">Shops in each city</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
  const srcMax = 10000,
    keys = Object.keys(W_SRC);
  let base = Array(n).fill(0);
  const areas = keys.map((k, ki) => {
    const topv = base.map((b, i) => b + W_SRC[k][i]);
    const d = `M${topv.map((v, i) => `${px(i, n) * 10},${(1 - v / srcMax) * 100}`).join(' L')} L${base
      .map((v, i) => `${px(i, n) * 10},${(1 - v / srcMax) * 100}`)
      .reverse()
      .join(' L')} Z`;
    base = topv;
    return <path key={ki} d={d} style={css(`fill:${SRC_COL[ki]}`)} className="ch-area" />;
  });
  const srcCell = (
    <section className="cell">
      <header className="c-hd">
        <span className="lbl">Sources</span>
        <span className="tag">Weekly visits</span>
      </header>
      <div className="c-fig">
        <span className="fig fig-xl">{pctOr0(W_SRC.Posters[L], W_VIS[L])}</span>
        <span className="figsub">{REAL ? 'of this week’s visits came from a poster' : 'of this week’s visits came from a poster · none before 18 Aug'}</span>
      </div>
      <div className="c-body">
        {chart({
          h: 200,
          max: srcMax,
          yTicks: [0, 5000, 10000],
          yFmt: (v) => (v ? `${v / 1000}k` : '0'),
          x: xl,
          paths: areas,
        })}
        {mkey(keys.map((k, i) => [SRC_COL[i], `${k} ${int(W_SRC[k][L])}`]))}
      </div>
      <div className="c-ft">
        <button type="button" data-gpane="site">
          <span className="t">Pages and forms</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
  return (
    <>
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">This week</span>
          <span className="lbl aside">{REAL ? 'All sources' : 'All sources · demo data'}</span>
        </div>
        <div className="bento sub">{metricsCell(week)}</div>
      </div>
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">The trend</span>
        </div>
        <div className="bento sub">{trend}</div>
      </div>
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">Next moves</span>
          <span className="lbl aside">Worked out from the numbers on this page</span>
        </div>
        <div className="bento sub moves">{moves}</div>
      </div>
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">Where it comes from</span>
        </div>
        <div className="bento sub g2">
          {cityCell}
          {srcCell}
        </div>
      </div>
    </>
  );
}

/* ── Shared pieces for the analytics panes ────────────────────────────── */
export function kpiCell(label, fig, sub, v, tag) {
  /* one column of a metrics strip: label, figure, a line, and twelve bars */
  const mx = Math.max(...v) || 1;
  return (
    <div className="mx-c">
      <div className="mx-h">
        <span className="lbl">{label}</span>
        <span className="mx-t">{tag || ''}</span>
      </div>
      <b className="mx-f">{fig}</b>
      <span className="mx-s">{sub}</span>
      <span className="mx-b" aria-hidden="true">
        {v.map((x, i) => (
          <i key={i} className={i === v.length - 1 ? 'now' : ''} style={css(`height:${Math.max(2, (x / mx) * 100).toFixed(1)}%`)} />
        ))}
      </span>
    </div>
  );
}
export function metricsCell(cols) {
  return (
    <section className="cell s-12 mx-cell">
      <div className="mx">{cols}</div>
    </section>
  );
}
export function gCell(cls, label, tag, fig, body, foot, state, bodyCls) {
  return (
    <section className={`cell ${cls || ''}`} {...attrs(state ? `data-state="${state}"` : '')}>
      <header className="c-hd">
        <span className="lbl">{label}</span>
        <span className="tag">{tag || ''}</span>
      </header>
      <div className="c-fig">{fig || ''}</div>
      <div className={`c-body${bodyCls || ''}`}>{body}</div>
      {foot || <div />}
    </section>
  );
}
export function figHtml(n, sub) {
  return (
    <>
      <span className="fig fig-xl">{n}</span>
      <span className="figsub">{sub}</span>
    </>
  );
}
export function figSide(n, a, b) {
  return (
    <>
      <span className="fig fig-xl">{n}</span>
      <span className="figsub two">
        <span>{a}</span>
        <span>{b}</span>
      </span>
    </>
  );
}
export function G(label, aside, cls, cells) {
  return (
    <div className="group">
      <div className="g-lbl">
        <span className="lbl">{label}</span>
        {aside ? <span className="lbl aside">{aside}</span> : ''}
      </div>
      <div className={`bento sub ${cls}`}>{cells}</div>
    </div>
  );
}
/* vertical columns drawn in HTML so labels stay crisp */
export function columns(items, { max, fmt = (v) => v, hi = -1, h = 140 } = {}) {
  max = max || Math.max(...items.map((i) => i[1]));
  return (
    <div className="cols" style={css(`--colh:${h}px`)}>
      {items.map(([k, v], i) => (
        <div key={i} className={`col${i === hi ? ' hi' : ''}`}>
          <span className="cv2">{fmt(v)}</span>
          <i style={css(`height:calc(var(--colh) * ${(max ? v / max : 0).toFixed(4)})`)} />
          <span className="ck">{k}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Acquisition pane: where visitors come from and which ones join ───── */
export function gAcquisition() {
  const tot = SRC30.reduce((a, s) => [a[0] + s[1], a[1] + s[2], a[2] + s[3]], [0, 0, 0]);
  const ratio = figOr('growth.visitors_ratio', 0),
    uniq = W_VIS.map((v) => Math.round(v * ratio)),
    jr = W_VIS.map((v, i) => perOr0(W_JOIN[i], v) * 100),
    phone = figOr('growth.phone_share', []);
  const kpis = (
    <>
      {kpiCell('Visits', int(tot[0]), RANGE.month.delta, W_VIS, '30 days')}
      {kpiCell('Visitors', int(Math.round(tot[0] * ratio)), 'people, after repeat visits', uniq, '30 days')}
      {kpiCell('Join rate', pctOr0(tot[1], tot[0]), 'of visits join the waitlist', jr, '30 days')}
      {kpiCell('On a phone', `${(phone[phone.length - 1] ?? 0).toFixed(1)}%`, 'of visits · posters are phone-only', phone, '30 days')}
    </>
  );
  const best = SRC30.length ? SRC30.reduce((a, b) => (b[2] / b[1] > a[2] / a[1] ? b : a)) : null;
  const srcTable = (
    <div className="tbl-wrap">
      <table className="tbl compact">
        <thead>
          <tr>
            <th className="l">Source</th>
            <th>Visits</th>
            <th>Share</th>
            <th>Joined</th>
            <th>Join rate</th>
            <th>Activated</th>
            <th className="l">12 weeks</th>
          </tr>
        </thead>
        <tbody>
          {SRC30.map((s, i) => (
            <tr key={i}>
              <td className="l">
                <span className="dcell">
                  <i className="sw" style={css(`background:${SRC_COL[i]}`)} />
                  <b>{s[0]}</b>
                </span>
              </td>
              <td>{int(s[1])}</td>
              <td className="quiet">{pctOr0(s[1], tot[0])}</td>
              <td>{int(s[2])}</td>
              <td className={s === best ? 'good' : ''}>{pctOr0(s[2], s[1])}</td>
              <td>{s[3]}</td>
              <td className="l">{miniSparkV(W_SRC[s[0]])}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="l">
              <b>All sources</b>
            </td>
            <td>{int(tot[0])}</td>
            <td>100%</td>
            <td>{int(tot[1])}</td>
            <td>{pctOr0(tot[1], tot[0])}</td>
            <td>{tot[2]}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
  const srcCell = gCell(
    's-7',
    'Sources',
    '30 days',
    best
      ? figHtml(
          pct(best[2], best[1]),
          `join rate from ${best[0].toLowerCase()} · ${Math.round(best[2] / best[1] / ((tot[1] - best[2]) / (tot[0] - best[1])))}× every other source combined`,
        )
      : figHtml('0.0%', 'join rate'),
    <div className="flush-x">{srcTable}</div>,
    REAL ? null : (
      <div className="c-ft">
        <div className="row">
          <span className="t">Posters are 13% of visits and 85% of joins</span>
        </div>
      </div>
    ),
  );
  const flat = HEAT.flatMap((d) => d.v),
    hmax = Math.max(...flat);
  let peak = {
    d: '',
    h: 0,
    v: 0,
  };
  HEAT.forEach((d) =>
    d.v.forEach((v, h) => {
      if (v > peak.v)
        peak = {
          d: d.d,
          h,
          v,
        };
    }),
  );
  const heat = (
    <div className="heat">
      <div className="hh">
        <span />
        {Array.from(
          {
            length: 24,
          },
          (_, h) => (
            <span key={h}>{h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>
          ),
        )}
      </div>
      {HEAT.map((d, __k) => (
        <div key={__k} className="hr">
          <span>{d.d}</span>
          {d.v.map((v, h) => (
            <i key={h} title={`${d.d} ${String(h).padStart(2, '0')}:00`} style={css(`opacity:${(0.08 + (0.92 * v) / hmax).toFixed(2)}`)} />
          ))}
        </div>
      ))}
      <div className="hkey">
        <span>Quiet</span>
        <i style={css('opacity:.1')} />
        <i style={css('opacity:.35')} />
        <i style={css('opacity:.6')} />
        <i style={css('opacity:1')} />
        <span>Busy</span>
      </div>
    </div>
  );
  const heatCell = !(hmax > 0)
    ? gCell('s-5', 'When they visit', 'Hour by day · 30 days', '', <span className="small quiet">No visits yet.</span>)
    : gCell(
        's-5',
        'When they visit',
        'Hour by day · 30 days',
        figHtml(`${peak.d} ${String(peak.h).padStart(2, '0')}:00`, 'busiest hour · evenings carry weekdays'),
        heat,
        <div className="c-ft">
          <div className="row">
            <span className="t">Schedule posts and posters for 18:00 to 21:00</span>
          </div>
        </div>,
      );
  const dev = gCell(
    '',
    'Devices',
    '30 days',
    figHtml(pctOr0(figOr('growth.devices', [])[0]?.[1], sumOf(figOr('growth.devices', []))), 'on a phone'),
    compBar(figOr('growth.devices', []).map(([k, v], i) => [k, v, ['var(--fg)', 'var(--land)', 'var(--line)'][i]])),
  );
  const ret = gCell(
    '',
    'New or returning',
    '30 days',
    figHtml(pctOr0(figOr('growth.returning', [])[1]?.[1], sumOf(figOr('growth.returning', []))), 'of visits are a return visit'),
    compBar(figOr('growth.returning', []).map(([k, v], i) => [k, v, ['var(--fg)', 'var(--land)'][i]])),
  );
  const refMax = Math.max(...REFS.map((r) => r[1]));
  const rs = REFS.slice().sort((a, b) => b[1] - a[1]);
  const refs = gCell(
    '',
    'Referrers',
    '30 days',
    rs.length ? figHtml(rs[0][0], `${int(rs[0][1])} visits, the top referrer`) : '',
    rs.length ? (
      <div className="how">
        {rs.map(([k, v], __k) => (
          <Fragment key={__k}>
            <span className="k mono">{k}</span>
            <b className="num">{int(v)}</b>
            <span className="quiet num">{pctOr0(v, tot[0])}</span>
          </Fragment>
        ))}
      </div>
    ) : (
      <span className="small quiet">None yet.</span>
    ),
  );
  const land = (
    <div className="tbl-wrap">
      <table className="tbl compact">
        <thead>
          <tr>
            <th className="l">Page</th>
            <th>Visits</th>
            <th>Share</th>
            <th>Joins started here</th>
            <th>Join rate</th>
          </tr>
        </thead>
        <tbody>
          {LANDING.map(([p, v, j], __k) => (
            <tr key={__k}>
              <td className="l mono">{p}</td>
              <td>{int(v)}</td>
              <td className="quiet">{pctOr0(v, tot[0])}</td>
              <td>{j ? int(j) : <span className="quiet">–</span>}</td>
              <td>{j ? pct(j, v) : <span className="quiet">Hands off to /join</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const landCell = gCell(
    's-12',
    'Landing pages',
    'Where visits start · 30 days',
    LANDING.length ? figHtml('/join', `${pctOr0(LANDING[0][1], tot[0])} of visits start here`) : '',
    LANDING.length ? <div className="flush-x">{land}</div> : <span className="small quiet">None yet.</span>,
  );
  return (
    <>
      {G('At a glance', 'Last 30 days', '', metricsCell(kpis))}
      {G(
        'Sources and timing',
        'Select a source for its pages',
        '',
        <>
          {srcCell}
          {heatCell}
        </>,
      )}
      {G(
        'Visitors',
        '',
        'g3',
        <>
          {dev}
          {ret}
          {refs}
        </>,
      )}
      {G('Pages', '', '', landCell)}
    </>
  );
}
export function miniSparkV(v, w = 96, h = 24) {
  const max = Math.max(...v),
    min = Math.min(...v);
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((y - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`);
  return (
    <svg className="tspark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={`M${pts.join(' L')}`} />
    </svg>
  );
}

/* ── Cohorts pane: what happens after we invite ───────────────────────── */
export function gCohorts() {
  const invited = COHORTS.reduce((a, c) => a + c[1], 0),
    ms = memberSummary();
  const kpis = (
    <>
      {kpiCell('Invited', int(invited), fig('growth.cohorts.since') == null ? 'since invites started' : `since invites started ${fmtD(fig('growth.cohorts.since'))}`, W_INV.slice(6), 'All time')}
      {kpiCell('Activated', int(ms.active), `${pctOr0(ms.active, ms.invited)} of the ${int(ms.invited)} invited in 30 days`, W_ACT.slice(5), '30 days')}
      {kpiCell('Days to activate', String(figOr('growth.cohorts.median_days_to_activate', []).at(-1) ?? 0), 'median, from invite to activated', figOr('growth.cohorts.median_days_to_activate', []), 'By cohort')}
      {kpiCell('Still in window', int(ms.invited - ms.active), `of the ${int(ms.invited)} invited in 30 days, not yet active`, figOr('growth.cohorts.still_in_window', []), 'Now')}
    </>
  );
  const maxW = 5;
  const tbl = (
    <div className="tbl-wrap">
      <table className="tbl cohort">
        <thead>
          <tr>
            <th className="l">Invited week</th>
            <th>People</th>
            {Array.from(
              {
                length: maxW,
              },
              (_, i) => (
                <th key={i}>
                  {'Week '}
                  {i + 1}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {COHORTS.map(([w, n, v], __k) => (
            <tr key={__k}>
              <td className="l">
                <b>{w}</b>
              </td>
              <td>{n}</td>
              {Array.from(
                {
                  length: maxW,
                },
                (_, i) =>
                  v[i] != null ? (
                    <td key={i} className="hc">
                      <span style={css(`--a:${(v[i] / 60).toFixed(2)}`)} className={v[i] >= 36 ? 'dark' : ''}>
                        {v[i]}%
                      </span>
                    </td>
                  ) : (
                    <td key={i} className="hc">
                      <span className="none" />
                    </td>
                  ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const cohortCell = gCell(
    's-12',
    'Activation by invite week',
    'Share active, by week',
    figHtml(`${figOr('growth.cohorts.by_week_three', 0)}%`, 'activate by week three, in every cohort that has reached it'),
    <div className="flush-x">{tbl}</div>,
    <div className="c-ft">
      <div className="row">
        <span className="t">Read across for one cohort; read down to see if newer invites do better</span>
      </div>
    </div>,
  );
  const ttA = figOr('growth.cohorts.time_to_activate', []);
  const timeCell = gCell(
    's-7',
    'Time to activate',
    `${int(ms.active)} activations · 30 days`,
    figHtml(`${Math.round(perOr0(sumOf(ttA.slice(0, 3)), ms.active) * 100)}%`, 'activate within a week of the invite'),
    columns(ttA, {
      hi: 0,
      fmt: (v) => v,
    }),
    <div className="c-ft">
      <div className="row">
        <span className="t">After two weeks, a nudge is the best lever left</span>
      </div>
    </div>,
  );
  const how = gCell(
    's-5',
    'How they activated',
    `${int(ms.active)} activations`,
    figHtml(pctOr0(ms.funded.Bank, ms.active), 'connected a bank'),
    <>
      {compBar([
        ['Connected a bank', ms.funded.Bank, 'var(--fg)'],
        ['Added $5', ms.funded.$5, 'var(--land)'],
        ['Direct deposit', ms.funded.Deposit, 'var(--line)'],
      ])}
      <div className="how two">
        <span className="k">Opened, not funded</span>
        <b className="num">{int(ms.opened)}</b>
        <span className="k">Not opened yet</span>
        <b className="num">{int(ms.invited - ms.active - ms.opened)}</b>
      </div>
    </>,
    <div className="c-ft">
      <button type="button" data-move="nudge">
        <span className="t">Nudge the {int(ms.opened)}</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  return (
    <>
      {G('At a glance', '', '', metricsCell(kpis))}
      {G('Cohorts', 'Activated means an account plus a bank, a deposit or $5 within 90 days', '', cohortCell)}
      {G(
        'Getting to active',
        '',
        '',
        <>
          {timeCell}
          {how}
        </>,
      )}
    </>
  );
}

/* Shops: traffic against conversion, so each shop's next step is obvious */
/* Each shop is a numbered square; the numbers match the shop table and the list beside the chart,
   so no label ever has to sit next to a point and collide. */
export function scMid() {
  return {
    mx: SHOPS.length ? SHOPS.reduce((a, s) => a + s[3] / s[2], 0) / SHOPS.length : 0,
    my: scanJoinRate(),
  };
}
export function scCorner(s) {
  const { mx, my } = scMid(),
    hi = s[3] / s[2] > mx,
    good = s[4] / s[3] > my;
  return hi && !good ? 'swap' : !hi && good ? 'add' : hi && good ? 'keep' : 'watch';
}
export function noSq(s, solid) {
  return <span className={`nsq ${scCorner(s)}${solid ? ' solid' : ''}`}>{SHOP_NO[s[0]]}</span>;
}
export function shopScatter() {
  const xMin = 60,
    xMax = 230,
    yMin = 0.1,
    yMax = 0.34,
    { mx, my } = scMid();
  const X = (v) => ((v - xMin) / (xMax - xMin)) * 100,
    Y = (v) => (1 - (v - yMin) / (yMax - yMin)) * 100;
  const yt = [0.1, 0.15, 0.2, 0.25, 0.3],
    xt = [60, 100, 140, 180, 220];
  return (
    <div className="sc">
      <div className="sc-y">
        <b className="sc-yt">Join rate</b>
        {yt.map((v, __k) => (
          <span key={__k} style={css(`top:${Y(v)}%`)}>
            {Math.round(v * 100)}%
          </span>
        ))}
      </div>
      <div className="sc-plot" role="img" aria-label="Scans per poster against join rate for the top 10 shops">
        <i className="sc-qt" style={css(`left:0;top:0;width:${X(mx)}%;height:${Y(my)}%;--c:${SC_COL.add}`)} />
        <i className="sc-qt" style={css(`left:${X(mx)}%;top:${Y(my)}%;right:0;bottom:0;--c:${SC_COL.swap}`)} />
        {yt.map((v, __k) => (
          <i key={__k} className="sc-g" style={css(`top:${Y(v)}%`)} />
        ))}
        {xt.slice(1).map((v, __k) => (
          <i key={__k} className="sc-gv" style={css(`left:${X(v)}%`)} />
        ))}
        <i className="sc-avx" style={css(`left:${X(mx)}%`)} />
        <i className="sc-avy" style={css(`top:${Y(my)}%`)} />
        <span className="sc-avl x" style={css(`left:${X(mx)}%`)}>
          {'Avg '}
          {Math.round(mx)}
          {' scans'}
        </span>
        <span className="sc-avl y" style={css(`top:${Y(my)}%`)}>
          {'Avg '}
          {(my * 100).toFixed(1)}%
        </span>
        <span className="sc-q tl">
          <i style={css(`background:${SC_COL.add}`)} />
          Converts, needs traffic
        </span>
        <span className="sc-q tr">
          <i style={css(`background:${SC_COL.keep}`)} />
          Busy and converting
        </span>
        <span className="sc-q bl">
          <i style={css(`background:${SC_COL.watch}`)} />
          Quiet, weak join
        </span>
        <span className="sc-q br">
          <i style={css(`background:${SC_COL.swap}`)} />
          Busy, weak join
        </span>
        {SHOPS.map((s, __k) => (
          <span
            key={__k}
            className="sc-pt"
            style={css(`left:${X(s[3] / s[2])}%;top:${Y(s[4] / s[3])}%`)}
            title={`${s[1]}: ${(s[3] / s[2]).toFixed(0)} scans per poster, ${((s[4] / s[3]) * 100).toFixed(1)}% join`}
          >
            {noSq(s, true)}
          </span>
        ))}
      </div>
      <div className="sc-x">
        {xt.map((v, __k) => (
          <span key={__k} style={css(`left:${X(v)}%`)}>
            {v}
          </span>
        ))}
        <b>Scans per poster →</b>
      </div>
    </div>
  );
}

/* ── Shops pane ───────────────────────────────────────────────────────── */
export function gFunnel() {
  const rows = [...SHOPS, BOARDS, OTHERS]
    .filter((s) => s[0])
    .map((s) => ({
      id: s[0],
      name: s[1],
      posters: s[2],
      scans: s[3],
      joined: s[4],
      act: s[5],
      spent: s[6],
      city: s[7],
      jr: perOr0(s[4], s[3]),
    }));
  const tot = rows.reduce(
    (a, r) => ({
      posters: a.posters + r.posters,
      scans: a.scans + r.scans,
      joined: a.joined + r.joined,
      act: a.act + r.act,
      spent: a.spent + r.spent,
    }),
    {
      posters: 0,
      scans: 0,
      joined: 0,
      act: 0,
      spent: 0,
    },
  );
  const ranked = rows.slice(0, 10);
  const best = ranked.length ? ranked.reduce((a, b) => (b.jr > a.jr ? b : a)) : null,
    worst = ranked.length ? ranked.reduce((a, b) => (b.jr < a.jr ? b : a)) : null;
  const key = {
    scans: 'scans',
    joined: 'joined',
    jr: 'jr',
    act: 'act',
    spent: 'spent',
    perposter: 'pp',
  };
  rows.forEach((r) => (r.pp = perOr0(r.scans, r.posters)));
  const sorted = [...rows.slice(0, 10).sort((a, b) => (a[key[GS.sort]] - b[key[GS.sort]]) * GS.dir), ...rows.slice(10)];
  const th = (k, t) => (
    <button type="button" className={`th${GS.sort === k ? ' on' : ''}`} data-gsort={k}>
      {t}
      {GS.sort === k ? ic(GS.dir < 0 ? 'down' : 'up', 'xs') : ''}
    </button>
  );
  const D = Object.entries(DESIGNS);
  const bestD = D.length ? D.reduce((a, b) => (b[1].joined / b[1].scans > a[1].joined / a[1].scans ? b : a))[0] : null;
  const mostD = D.length ? D.reduce((a, b) => (b[1].scans / b[1].posters > a[1].scans / a[1].posters ? b : a))[0] : null;
  const shopTable = (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th className="l">Shop</th>
            <th>Posters</th>
            <th>{th('scans', 'Scans')}</th>
            <th>{th('joined', 'Joined')}</th>
            <th>{th('jr', 'Join rate')}</th>
            <th>{th('act', 'Activated')}</th>
            <th>{th('spent', '$10 spent')}</th>
            <th className="l">Last 14 days</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className={r.id === 'boards' || r.id === 'others' ? 'rest' : ''}>
              <td className="l">
                <span className="tshop">
                  {SHOP_NO[r.id] ? noSq(SHOPS.find((x) => x[0] === r.id)) : <span className="nsq blank" />}
                  <span>
                    <b>{r.name}</b>
                    <span className="quiet small">{r.city}</span>
                  </span>
                </span>
              </td>
              <td>{r.posters}</td>
              <td>{int(r.scans)}</td>
              <td>{int(r.joined)}</td>
              <td className={r === best ? 'good' : r === worst ? 'weak' : ''}>{(r.jr * 100).toFixed(1)}%</td>
              <td>{r.act}</td>
              <td>{r.spent}</td>
              <td className="l">{miniSpark(i * 3 + 1, r.scans / 2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="l">
              <b>All posters</b>
            </td>
            <td>{tot.posters}</td>
            <td>{int(tot.scans)}</td>
            <td>{int(tot.joined)}</td>
            <td>{pctOr0(tot.joined, tot.scans)}</td>
            <td>{tot.act}</td>
            <td>{tot.spent}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
  const shopCell = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Poster funnel per shop</span>
        <span className="tag">Last 30 days</span>
      </header>
      <div className="c-fig" />
      <div className="c-body flush">{shopTable}</div>
      {!best ? (
        <div className="c-ft">
          <div className="row">
            <span className="t">No shop scans yet</span>
          </div>
        </div>
      ) : (
        <div className="c-ft split">
          {footItem({
            t: `Best join rate: ${best.name}, ${(best.jr * 100).toFixed(1)}%`,
          })}
          <span className="rule" aria-hidden="true" />
          {footItem({
            t: `Lowest: ${worst.name}, ${(worst.jr * 100).toFixed(1)}%. Try design A there`,
          })}
        </div>
      )}
    </section>
  );
  const designCells = D.map(([k, d], __k) => {
    const jr = perOr0(d.joined, d.scans),
      pp = perOr0(d.scans, d.posters);
    return (
      <section key={__k} className="cell">
        <header className="c-hd">
          <span className="lbl">
            {'Design '}
            {k}
            {' · '}
            {d.name}
          </span>
          <span className="tag">
            {d.posters}
            {' posters'}
          </span>
        </header>
        <div className="c-fig">
          <div className="dhead">
            {designThumb(k, 48)}
            <div>
              <span className="fig fig-xl">{(jr * 100).toFixed(1)}%</span>
              <span className="figsub">join rate</span>
            </div>
          </div>
        </div>
        <div className="c-body">
          <div className="how two">
            <span className="k">Scans per poster</span>
            <b className="num">{pp.toFixed(1)}</b>
            <span className="k">Scans</span>
            <b className="num">{int(d.scans)}</b>
            <span className="k">Joined</span>
            <b className="num">{int(d.joined)}</b>
          </div>
          {k === bestD ? (
            <span className="chip settled" style={css('align-self:flex-start')}>
              Converts best
            </span>
          ) : k === mostD ? (
            <span className="chip plain" style={css('align-self:flex-start')}>
              Most scans per poster
            </span>
          ) : (
            <span className="chip plain" style={css('align-self:flex-start')}>
              Fewest scans
            </span>
          )}
        </div>
        <div className="c-ft">
          <button type="button" data-gpane="posters">
            <span className="t">
              {'See its '}
              {d.posters}
              {' posters'}
            </span>
            {ic('chev', 'sm')}
          </button>
        </div>
      </section>
    );
  });
  const mx = SHOPS.length ? SHOPS.reduce((a, s) => a + s[3] / s[2], 0) / SHOPS.length : 0,
    my = scanJoinRate();
  const q = (hi, good) => SHOPS.filter((s) => s[3] / s[2] > mx === hi && s[4] / s[3] > my === good).map((s) => s[1]);
  const scatter = !best ? (
    gCell('s-8', 'Traffic against join rate', 'Top 10 shops · last 30 days', figHtml('0.0%', 'best join rate'), <span className="small quiet">No shop scans yet.</span>)
  ) : (
    <section className="cell s-8">
      <header className="c-hd">
        <span className="lbl">Traffic against join rate</span>
        <span className="tag">Top 10 shops · last 30 days</span>
      </header>
      <div className="c-fig">
        <span className="fig fig-xl">{(best.jr * 100).toFixed(1)}%</span>
        <span className="figsub">
          {'best join rate, at '}
          {best.name}
          {' · average '}
          {(my * 100).toFixed(1)}%
        </span>
      </div>
      <div className="c-body">{shopScatter()}</div>
      <div className="c-ft">
        <div className="row">
          <span className="t">Dashed lines are the averages · numbers match the shop table</span>
        </div>
      </div>
    </section>
  );
  const grp = (k) => SHOPS.filter((s) => scCorner(s) === k);
  const block = (k, title, act) => (
    <div className="cg-blk">
      <div className="cg-hd">
        <i style={css(`background:${SC_COL[k]}`)} />
        <b>{title}</b>
        <span className="small quiet">{act}</span>
      </div>
      <div className="cg-list">
        {grp(k).map((s, __k) => (
          <span key={__k} className="cg-item">
            {noSq(s)}
            <span>{s[1]}</span>
            <b className="num">{((s[4] / s[3]) * 100).toFixed(1)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
  const corners = (
    <section className="cell s-4">
      <header className="c-hd">
        <span className="lbl">What to do</span>
        <span className="tag">By corner</span>
      </header>
      <div className="c-fig">
        <span className="fig fig-xl">{grp('swap').length + grp('add').length}</span>
        <span className="figsub">shops with a clear next step</span>
      </div>
      <div className="c-body">
        {block('swap', 'Busy, weak join', 'Swap to design A')}
        {block('add', 'Converts, needs traffic', 'Add posters')}
        {block('keep', 'Busy and converting', 'Keep as is')}
        {block('watch', 'Quiet, weak join', 'Watch for two weeks')}
      </div>
      {REAL && !SHOPS.length ? (
        <div />
      ) : (
        <div className="c-ft">
          <button type="button" data-move="swap">
            <span className="t">{REAL ? `Plan the swap at ${lowestShop()[1]}` : 'Plan the swap at Redlands Tire'}</span>
            {ic('chev', 'sm')}
          </button>
        </div>
      )}
    </section>
  );
  return (
    <>
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">Shops at a glance</span>
          <span className="lbl aside">Each square is a shop</span>
        </div>
        <div className="bento sub">
          {scatter}
          {corners}
        </div>
      </div>
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">By shop</span>
          <span className="lbl aside">Starts at the poster scan · select a column to sort</span>
        </div>
        <div className="bento sub">{shopCell}</div>
      </div>
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">By poster design</span>
          {D.length ? (
            <span className="lbl aside">
              {DESIGNS[mostD].name}
              {' pulls scans · '}
              {DESIGNS[bestD].name}
              {' turns them into joins'}
            </span>
          ) : (
            ''
          )}
        </div>
        <div className="bento sub dgrid">{D.length ? designCells : gCell('', 'Designs', '', '', <span className="small quiet">None yet.</span>)}</div>
      </div>
    </>
  );
}

/* ── Posters pane ─────────────────────────────────────────────────────── */
export function gPosters() {
  const counts = {
    up: 0,
    due: 0,
    faded: 0,
    missing: 0,
  };
  POSTERS.forEach((p) => counts[p.status]++);
  const swap = POSTERS.filter((p) => p.status !== 'up').sort((a, b) => a.swap - b.swap);
  const list = POSTERS.filter((p) => GS.pf === 'all' || (GS.pf === 'attn' ? p.status !== 'up' : p.status === GS.pf));
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  GS.pg = Math.min(GS.pg, pages - 1);
  const slice = list.slice(GS.pg * PER_PAGE, GS.pg * PER_PAGE + PER_PAGE);
  const swapTxt = (p) => {
    const d = daysTo(p.swap);
    return d < 0 ? (
      <span className="late">
        {-d}
        {' days late'}
      </span>
    ) : d === 0 ? (
      'today'
    ) : (
      `in ${d} days`
    );
  };
  const status = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Status</span>
        <span className="tag">{REAL ? `${POSTERS.length} posters` : '102 posters'}</span>
      </header>
      <div className="c-fig">
        <span className="fig fig-xl">{counts.up}</span>
        <span className="figsub">up and scanning</span>
      </div>
      <div className="c-body">
        {compBar([
          ['Up', counts.up, 'var(--fg)'],
          ['Swap due', counts.due, 'var(--land)'],
          ['Faded', counts.faded, 'var(--underway)'],
          ['Missing', counts.missing, 'var(--absent)'],
        ])}
      </div>
      <div className="c-ft">
        <button type="button" data-pf="attn">
          <span className="t">
            {'Show the '}
            {swap.length}
            {' that need you'}
          </span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
  const swaps = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Swap this week</span>
        <span className="tag">
          {swap.length}
          {' posters'}
        </span>
      </header>
      <div className="c-fig">
        <span className="fig fig-xl">{swap.length}</span>
        <span className="figsub">
          {'need a swap · '}
          {swap.filter((p) => daysTo(p.swap) < 0).length}
          {' late · '}
          {counts.missing}
          {' missing'}
        </span>
      </div>
      <div className="c-body flush">
        <div className="swlist">
          {!swap.length ? (
            <div className="z-empty">
              <span className="small quiet">None yet.</span>
            </div>
          ) : (
            ''
          )}
          {swap.map((p, __k) => (
            <div key={__k} className="swrow">
              {designThumb(p.design, 28)}
              <button type="button" className="swmain" data-poster={p.n}>
                <b>
                  <span className="mono">{pid(p.n)}</span>
                  {' · '}
                  {p.shop}
                </b>
                <span className="small quiet">
                  {p.city}
                  {' · swap '}
                  {swapTxt(p)}
                </span>
              </button>
              <span className={`chip ${ST[p.status][0]}`}>{ST[p.status][1]}</span>
              <button className="btn btn-g btn-s" type="button" data-replace={p.n}>
                Mark replaced
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="c-ft split">
        {footItem({
          t: 'Add all to today’s route',
          go: 'field',
        })}
        <span className="rule" aria-hidden="true" />
        {footItem({
          t: 'Posters last 60 days, then swap',
        })}
      </div>
    </section>
  );
  const filters = [
    ['all', 'All', POSTERS.length],
    ['attn', 'Needs you', swap.length],
    ['faded', 'Faded', counts.faded],
    ['missing', 'Missing', counts.missing],
  ];
  const table = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Every poster</span>
        <span className="hd-tools">{ddHtml('pf', filters, GS.pf, 'Show')}</span>
      </header>
      <div className="c-fig" />
      <div className="c-body flush">
        <div className="tbl-wrap">
          <table className="tbl ptbl">
            <thead>
              <tr>
                <th className="l">Poster</th>
                <th className="l">Where</th>
                <th className="l">Design</th>
                <th className="l">Hung</th>
                <th className="l">Swap by</th>
                <th>Scans · 30 days</th>
                <th className="l">Status</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((p, __k) => (
                <tr key={__k} className="click" data-poster={p.n} tabIndex="0">
                  <td className="l">
                    <b className="mono">{pid(p.n)}</b>
                  </td>
                  <td className="l">
                    <b>{p.shop}</b>
                    <span className="quiet small">{p.city}</span>
                  </td>
                  <td className="l">
                    <span className="dcell">
                      {designThumb(p.design, 20)}
                      {p.design}
                    </span>
                  </td>
                  <td className="l">{fmtD(p.hung)}</td>
                  <td className="l">
                    {fmtD(p.swap)} <span className="quiet small">{swapTxt(p)}</span>
                  </td>
                  <td>{int(p.scans)}</td>
                  <td className="l">
                    <span className={`chip ${ST[p.status][0]}`}>{ST[p.status][1]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <footer className="p-ft">
        <div className="pg-lbl">
          {'Page '}
          {GS.pg + 1}
          {' of '}
          {pages}
          {' · '}
          {list.length}
          {' posters'}
        </div>
        <span className="rule" aria-hidden="true" />
        <div className="p-pg">
          <div className="dots">
            {pages > 1
              ? Array.from(
                  {
                    length: pages,
                  },
                  (_, i) => <button key={i} type="button" data-pg={i} aria-current={i === GS.pg} aria-label={`Page ${i + 1}`} />,
                )
              : ''}
          </div>
          <div className="p-nav">
            <button type="button" data-pg={GS.pg - 1} {...attrs(GS.pg === 0 ? 'disabled' : '')} aria-label="Previous page">
              {ic('chevl', 'sm')}
            </button>
            <button type="button" data-pg={GS.pg + 1} {...attrs(GS.pg >= pages - 1 ? 'disabled' : '')} aria-label="Next page">
              {ic('chev', 'sm')}
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
  return (
    <>
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">Posters</span>
          <span className="lbl aside">
            {counts.up}
            {' up · '}
            {swap.length}
            {' need you'}
          </span>
        </div>
        <div className="bento sub">
          {status}
          {swaps}
        </div>
      </div>
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">Inventory</span>
          <span className="lbl aside">Select a poster to open it</span>
        </div>
        <div className="bento">{table}</div>
      </div>
    </>
  );
}

/* Poster sub-page: a pane from the right, not a modal */
export function posterPane() {
  if (GS.poster == null) return '';
  const p = POSTERS.find((x) => x.n === GS.poster);
  if (!p) return '';
  const url = `useclear.org/s/${slug(p.shop)}`;
  const d = DESIGNS[p.design];
  const daysUp = Math.round((TODAY - p.hung) / DAY);
  const est = Math.round(p.scans * (p.board ? 0.15 : 0.23));
  return (
    <>
      <div className="pane-scrim" data-closepane="" />
      <aside className="pane" role="dialog" aria-label={pid(p.n)}>
        <header className="m-hd">
          <span className="sub">
            <span className="mono">{pid(p.n)}</span>
          </span>
          <span style={css('display:flex;align-items:center;gap:8px')}>
            <span className={`chip ${ST[p.status][0]}`}>{ST[p.status][1]}</span>
            <button className="x" type="button" data-closepane="" aria-label="Close">
              {ic('close')}
            </button>
          </span>
        </header>
        <div className="pane-mn">
          <div className="pp-top">
            {designThumb(p.design, 72)}
            <div>
              <p className="h2" style={css('font-size:28px')}>
                {p.shop}
              </p>
              <p className="quiet" style={css('margin:8px 0 0')}>
                {p.city}
                {' · Design '}
                {p.design}
                {', '}
                {d?.name}
              </p>
            </div>
          </div>
          <div className="pp-code">
            <span className="lbl">Code</span>
            <span className="mono">{url}</span>
            <button className="btn btn-g btn-s" type="button" data-copy={url}>
              Copy
            </button>
          </div>
          <div className="pp-figs">
            <div>
              <span className="lbl">Scans · 30 days</span>
              <span className="fig fig-l">{int(p.scans)}</span>
            </div>
            <div>
              <span className="lbl">Joined, est.</span>
              <span className="fig fig-l">{est}</span>
            </div>
            <div>
              <span className="lbl">Days up</span>
              <span className="fig fig-l">{daysUp}</span>
            </div>
          </div>
          <div>
            {miniSpark(p.n, p.scans, 30, 480, 64, 'tspark wide')}
            <div className="axis" style={css('margin-top:8px')}>
              <span>22 Sep</span>
              <span>21 Oct</span>
            </div>
          </div>
          <div className="rows ledger">
            <div className="r">
              <span className="k">Hung</span>
              <span className="v">{fmtD(p.hung)}</span>
            </div>
            <div className="r">
              <span className="k">Last checked</span>
              <span className="v">{fmtD(p.checked)}</span>
            </div>
            <div className="r">
              <span className="k">Swap by</span>
              <span className="v">{fmtD(p.swap)}</span>
            </div>
            <div className="r">
              <span className="k">$10 offer</span>
              <span className="v">{p.board ? 'Any partner shop' : 'Spend at ' + p.shop}</span>
            </div>
          </div>
        </div>
        <footer className="pane-ft">
          <button className="btn btn-g" type="button" data-go="field">
            Add to route
          </button>
          <button className="btn btn-p" type="button" data-replace={p.n}>
            Mark replaced
          </button>
        </footer>
      </aside>
    </>
  );
}

/* ── Site and forms pane ──────────────────────────────────────────────── */
export function mask(s) {
  return s[0] + '•'.repeat(Math.max(2, Math.min(5, s.length - 1)));
}
export function maskMail(m) {
  const [u, d] = m.split('@');
  return u[0] + '•••@' + d[0] + '•••.' + d.split('.').pop();
}
export function gSite() {
  const d = RANGE.month,
    tot = d.forms.reduce((a, b) => a + b, 0);
  const types = ['all', 'Waitlist', 'Shop enquiry', 'Land offer', 'Work with us'];
  const rows = INBOX.filter((x) => GS.ft === 'all' || x.type === GS.ft);
  const pages = figOr('growth.site.pages', []);
  const forms = (
    <section className="cell s-5">
      <header className="c-hd">
        <span className="lbl">Forms</span>
        <span className="tag">Last 30 days</span>
      </header>
      <div className="c-fig">
        <span className="fig fig-xl">{int(tot)}</span>
        <span className="figsub">
          {'submitted · '}
          {int(d.forms[0])}
          {' joined the waitlist'}
        </span>
      </div>
      <div className="c-body">{compBar(d.forms.map((v, i) => [FORMS[i], v, ['var(--fg)', 'var(--land)', 'var(--fg-50)', 'var(--line)'][i]]))}</div>
      <div className="c-ft">
        <button type="button" data-gpane="site">
          <span className="t">8 new since this morning</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
  const top = (
    <section className="cell s-7">
      <header className="c-hd">
        <span className="lbl">Top pages</span>
        <span className="tag">Last 30 days</span>
      </header>
      <div className="c-fig">
        <span className="fig fig-xl">{int(d.visits)}</span>
        <span className="figsub">
          {'visits · '}
          {d.delta}
        </span>
      </div>
      <div className="c-body">
        <div className="how">
          {pages.map(([u, v], __k) => (
            <Fragment key={__k}>
              <span className="k mono">{u}</span>
              <b className="num">{int(v)}</b>
              <span className="quiet num">{pctOr0(v, d.visits)}</span>
            </Fragment>
          ))}
        </div>
      </div>
      <div className="c-ft">
        <div className="row">
          <span className="t">Poster pages are /s/ plus the shop name</span>
        </div>
      </div>
    </section>
  );
  const typeOpts = types.map((t) => [t, t === 'all' ? 'All forms' : t, t === 'all' ? INBOX.length : INBOX.filter((x) => x.type === t).length]);
  const inbox = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Inbox</span>
        <span className="hd-tools">{ddHtml('ft', typeOpts, GS.ft, 'Form')}</span>
      </header>
      <div className="c-fig" />
      <div className="c-body flush">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="l">Name</th>
                <th className="l">Email</th>
                <th className="l">Form</th>
                <th className="l">City</th>
                <th className="l">Came from</th>
                <th className="l">At</th>
                <th className="l">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x, __k) => (
                <tr key={__k}>
                  <td className="l">
                    <b>{GS.reveal ? x.who.join(' ') : x.who.map(mask).join(' ')}</b>
                  </td>
                  <td className="l mono small">{GS.reveal ? x.mail : maskMail(x.mail)}</td>
                  <td className="l">{x.type}</td>
                  <td className="l">{x.city}</td>
                  <td className="l small">{x.src}</td>
                  <td className="l mono small">{x.when}</td>
                  <td className="l">
                    <span className={`chip ${x.st === 'New' ? 'underway' : x.st === 'Invited' ? 'settled' : 'plain'}`}>{x.st}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="c-ft">
        <button type="button" className={`pv${GS.reveal ? ' on' : ''}`} data-reveal="" aria-pressed={GS.reveal}>
          <span className="pv-l">
            {ic(GS.reveal ? 'eye' : 'lockc', 'sm')}
            <span>
              <b>{GS.reveal ? 'Details shown' : 'Details hidden'}</b>
              <span className="quiet">
                {' · '}
                {GS.reveal ? 'this view is logged' : 'names and emails are masked'}
              </span>
            </span>
          </span>
          <span className="pv-r">
            <span className="pv-t">{GS.reveal ? 'Hide' : 'Show'}</span>
            <span className="tgl" aria-hidden="true">
              <i />
            </span>
          </span>
        </button>
      </div>
    </section>
  );
  return (
    <>
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">Site</span>
        </div>
        <div className="bento sub">
          {forms}
          {top}
        </div>
      </div>
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">Latest forms</span>
          <span className="lbl aside">Personal details stay hidden until you ask</span>
        </div>
        <div className="bento">{inbox}</div>
      </div>
    </>
  );
}

/* ── Dropdown: a listbox, never the system menu. Arrows move, Enter chooses, Escape closes. ── */
export function openReplace(n) {
  const p = POSTERS.find((x) => x.n === n);
  vars.lastFocus = document.activeElement;
  const next = fmtD(TODAY + 60 * DAY);
  modalShell(
    'Mark replaced',
    <>
      <div>
        <span className="lbl">{pid(n)}</span>
        <p className="h2" style={css('margin-top:8px')}>
          {p.shop}
        </p>
      </div>
      <div className="rows ledger">
        <div className="r">
          <span className="k">Old poster</span>
          <span className="v">Retired today</span>
        </div>
        <div className="r">
          <span className="k">New poster</span>
          <span className="v">
            {'Design '}
            {p.design}, same code
          </span>
        </div>
        <div className="r">
          <span className="k">Code</span>
          <span className="v mono">useclear.org/s/{slug(p.shop)}</span>
        </div>
        <div className="r total">
          <span className="k">Next swap</span>
          <span className="v">{next}</span>
        </div>
      </div>
      <div className="acts">
        <button className="btn btn-p" type="button" data-doreplace={n}>
          Mark replaced
        </button>
        <button className="btn btn-g" type="button" data-close="">
          Not now
        </button>
      </div>
    </>,
    'Every change is logged',
  );
  document.addEventListener('keydown', onKey);
}
export function openMove(kind, city) {
  vars.lastFocus = document.activeElement;
  const flows = {
    swap: () => ({
      title: 'Plan a swap',
      h: lowestShop()[1],
      rows: [
        ['Posters', String(lowestShop()[2])],
        ['Now', `Design ${POSTERS.find((p) => p.shopId === lowestShop()[0])?.design ?? '–'}, ${pctOr0(lowestShop()[4], lowestShop()[3])} join rate`],
        ['Swap to', `Design A, ${DESIGNS.A ? ((DESIGNS.A.joined / DESIGNS.A.scans) * 100).toFixed(1) : '0.0'}% average`],
        ['When', `Next route day, ${dayName(asOf() + DAY)}`],
        ['Check again', 'After 14 days', 1],
      ],
      btn: 'Plan the swap',
      steps: [`Added both posters to ${dayName(asOf() + DAY).split(' ')[0] === 'Thu' ? 'Thursday' : dayName(asOf() + DAY).split(' ')[0]}\u2019s route`, 'Set them to design A', `Set a check for ${fmtD(asOf() + 15 * DAY)}`],
      done: ['Swap planned.', `You\u2019ll see the new join rate here on ${fmtD(asOf() + 15 * DAY)}.`],
    }),
    nudge: () => ({
      title: 'Send a nudge',
      h: '64 people',
      rows: [
        ['Who', 'Opened, not funded'],
        ['Message', 'One step left: connect a bank or add $5'],
        ['Where', 'In the Clear app'],
        ['Sent by', 'Clear, not a person', 1],
      ],
      btn: 'Send to 64 people',
      steps: ['Picked the 64 who opened but haven\u2019t funded', 'Queued the message in the app', 'Set a report for 29 Oct'],
      done: ['Nudge sent.', 'You\u2019ll see who funded on 29 Oct.'],
    }),
    pace: () => ({
      title: 'Raise the invite pace',
      h: '150 invites a week',
      rows: [
        ['Now', '3 batches of 25 a week'],
        ['Change to', '3 batches of 50 a week'],
        ['Waitlist clears', 'In about 10 weeks'],
        ['Approval', 'Each batch still needs two people', 1],
      ],
      btn: 'Raise the pace',
      steps: ['Set batches to 50 people', 'Kept the two-person rule on each batch', 'Queued batch 14 for Fri 23 Oct'],
      done: ['Pace raised.', 'Batch 14 goes to Needs you on Friday.'],
    }),
  };
  const f = flows[kind]();
  modalShell(
    f.title,
    <>
      <div>
        <span className="lbl">Suggested</span>
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
        <button className="btn btn-p" type="button" data-domove={kind}>
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
  if (kind === 'swap') live(f, 'growth', 'swap', () => ({ shop: city || 'A shop' }));
  else if (kind === 'nudge') live(f, 'growth', 'nudge', () => ({ who: 'opened', count: MEMBERS.filter((m) => m.status === 'opened').length }));
  else if (kind === 'pace') live(f, 'growth', 'pace', () => ({ perBatch: 50 }));
  openMove.f = f;
}
export function openAdd(prefill) {
  vars.lastFocus = document.activeElement;
  modalShell(
    'Add a poster',
    <>
      <p className="quiet" style={css('margin:0')}>
        It gets the next number, P-{String(POSTERS.length + 1).padStart(3, '0')}, and the shop’s code.
      </p>
      <label className="field">
        <span className="lbl">Shop or board</span>
        <input id="ap-shop" type="text" defaultValue={prefill || (REAL ? '' : 'Sixth St. Tailor')} autoComplete="off" />
      </label>
      <div className="field">
        <span className="lbl">Design</span>
        <div className="seg" role="group" aria-label="Design">
          {Object.entries(DESIGNS).map(([k, d], i) => (
            <button key={i} type="button" data-apd={k} aria-pressed={i === 0}>
              {k}
              {' · '}
              {d.name}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="lbl">Hung on</span>
        <input id="ap-date" type="text" defaultValue={REAL ? `${fmtD(TODAY)} ${new Date(TODAY).getUTCFullYear()}` : '21 Oct 2026'} autoComplete="off" />
      </label>
      <div className="acts">
        <button className="btn btn-p" type="button" data-doadd="">
          Add poster
        </button>
        <button className="btn btn-g" type="button" data-close="">
          Not now
        </button>
      </div>
    </>,
    'Every change is logged',
  );
  document.addEventListener('keydown', onKey);
  $('#ap-shop').focus();
}

/* ══ Members ════════════════════════════════════════════════════════════
   Ties to Home: 300 invited in 12 batches of 25 · 188 opened · 124 active · 64 opened, not funded ·
   112 not opened · 109 first spends · batch 12 at 14/25 opened with 9 active · batch 13 waiting. */

/** Of the top shops, the one whose scans turn into joins least often: the swap Growth suggests. */
export function lowestShop() {
  return SHOPS.reduce((a, b) => (b[4] / b[3] < a[4] / a[3] ? b : a));
}
/** Joins per scan across every poster: the top shops, the boards and the rest. */
export function scanJoinRate() {
  const all = [...SHOPS, BOARDS, OTHERS];
  return perOr0(all.reduce((a, s) => a + s[4], 0), all.reduce((a, s) => a + s[3], 0));
}
export function sumOf(rows) {
  return rows.reduce((a, [, v]) => a + v, 0);
}
/* Empty data (real data only, Phase 9): a share of nothing is 0, never NaN or Infinity, and a figure the API hasn't sent is its blank. */
function perOr0(a, b) {
  return b ? a / b : 0;
}
function pctOr0(a, b) {
  return b ? pct(a, b) : '0.0%';
}
function figOr(k, d) {
  return fig(k) ?? d;
}
/** How many of the invited are at each step: the API counts it in the live app; the preview counts the prototype's members. */
export function memberSummary() {
  if (LIVE && vars.memberSummary) return vars.memberSummary;
  const n = (f) => MEMBERS.filter(f).length;
  return {
    invited: MEMBERS.length,
    opened: n((m) => m.status === 'opened'),
    active: n((m) => m.status === 'active'),
    funded: { Bank: n((m) => m.fund === 'Bank'), $5: n((m) => m.fund === '$5'), Deposit: n((m) => m.fund === 'Deposit') },
  };
}
/** The day the rows were read for. */
export function asOf() {
  return vars.asOf ?? TODAY;
}
/** "Thu 22 Oct". */
export function dayName(t) {
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(t).getUTCDay()]} ${fmtD(t)}`;
}
