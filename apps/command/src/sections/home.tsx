// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { Fragment } from 'react';
import { attrs, css, html } from '../runtime/dom';
import { $, cell, compBar, head, ic, int, money, pct, segHtml, themeSwitch } from './core';
import { LIVE, REAL } from '../live/env';
import { ibxData, inboxCell } from './inbox';
import { fig } from '../live/figures';
import { feedChip, feedLabel, feedList, hasFeeds } from '../live/feeds';
import {
  ALERTS0,
  DAY,
  DEADLINES,
  DL_STATUS,
  FORMS,
  FUNNEL,
  MEMBERS,
  NAMES,
  NEED,
  OWED,
  PLANNED,
  POSTERS,
  RANGE,
  S,
  SECTIONS,
  SIGNED,
  SPANS,
  TODAY,
  TXO,
  W_ICON,
  W_VIZ,
  vars,
} from './data';
import { fmtD, spark } from './growth';
import { vLevel } from './shell';

/* ── counted from the other sections ────────────────────────── */
/** Where the invited members are, and how the active ones funded: the server's counts when live. */
export function memberCounts() {
  if (LIVE && vars.memberSummary?.invited != null) return vars.memberSummary;
  const n = (f) => MEMBERS.filter(f).length;
  return {
    invited: MEMBERS.length,
    active: n((m) => m.status === 'active'),
    opened: n((m) => m.status === 'opened'),
    notOpened: n((m) => m.status === 'invited'),
    funded: { bank: n((m) => m.status === 'active' && m.fund === 'Bank'), five: n((m) => m.status === 'active' && m.fund === '$5'), deposit: n((m) => m.status === 'active' && m.fund === 'Deposit') },
  };
}
const shopName = (id) => vars.shopNames?.[id] ?? TXO.find((m) => m.id === id)?.name ?? SIGNED.find((x) => x[0] === id)?.[1] ?? id;
/** The $10 redemptions owed to shops, less the shop in today's payout once it's approved. */
export function owedNow() {
  // the payout run under way today (Rosa’s, in the design)
  const id = fig('merchants.payouts.schedule')?.underway?.id,
    today = id ? shopName(id) : null;
  const rows = Object.entries(OWED)
    .map(([id, v]) => [shopName(id), v])
    .filter(([n]) => !(S.payoutDone && n === today))
    .sort((a, b) => b[1] - a[1]);
  return { rows, today: S.payoutDone ? null : rows.find(([n]) => n === today), paidOut: S.payoutDone ? OWED[id] || 0 : 0 };
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayDate = (t) => `${DOW[new Date(t).getUTCDay()]} ${fmtD(t)}`;
/** A share, or 0.0% when there's nothing to share out. */
const pc = (a, b) => (b ? pct(a, b) : '0.0%');
// the prototype's moving work and changes, which real data never draws (taken the first time Now draws)
let PROTO = null;
export const real = (list) => {
  PROTO ??= new Set([...S.live, ...S.updates.filter((u) => !u.mine)]);
  return REAL ? list.filter((x) => !PROTO.has(x)) : list;
};
const noneYet = <span className="small quiet">None yet.</span>;
/* ── Home ────────────────────────────────────────────────── */
export function home() {
  // the preview states are the prototype's, for designing: live, Home is always itself
  const pv = LIVE ? 'live' : S.preview;
  const shown = pv === 'clear' ? 0 : S.waiting.length;
  const words = ['', 'One thing needs', 'Two things need', 'Three things need', 'Four things need'];
  const title =
    pv === 'empty'
      ? 'Nothing here yet.'
      : pv === 'loading'
        ? 'Getting today’s numbers.'
        : pv === 'error'
          ? 'Some numbers are stale.'
          : shown
            ? `${words[shown]} you.`
            : 'All clear.';
  const tools =
    pv === 'live' || pv === 'clear'
      ? segHtml(
          'range',
          [
            ['today', 'Today'],
            ['week', '7 days'],
            ['month', '30 days'],
          ],
          S.range,
          'Range',
        )
      : '';
  let h = head(
    <>
      {`Home · ${dayDate(TODAY)} · `}
      <b>{REAL ? 'Real data' : 'Demo data'}</b>
    </>,
    title,
    tools,
  );
  const proto = LIVE ? (
    ''
  ) : (
    <div className="proto">
      <span className="lbl">Prototype · preview state</span>
      {segHtml(
        'preview',
        [
          ['live', 'Live'],
          ['empty', 'Empty'],
          ['loading', 'Loading'],
          ['error', 'Error'],
          ['clear', 'All clear'],
        ],
        pv,
        'Preview state',
      )}
    </div>
  );
  if (pv === 'empty')
    return (
      <>
        {h}
        {stateEmpty()}
        {proto}
      </>
    );
  if (pv === 'loading')
    return (
      <>
        {h}
        {stateLoading()}
        {proto}
      </>
    );
  if (pv === 'error')
    return (
      <>
        {h}
        {stateError()}
        {proto}
      </>
    );
  const waiting = pv === 'clear' ? [] : S.waiting;
  const alerts = pv === 'clear' ? [] : ALERTS0;
  h = (
    <>
      {h}
      {nowPanel(waiting)}
      {numbers(waiting.length === 0, alerts)}
    </>
  );
  return (
    <>
      {h}
      {proto}
    </>
  );
}

/* ── Now: one permanent panel for everything moving ─────── */
/* Small visuals: each card type gets its own shape so it reads at a glance */
export function mkey(items) {
  return (
    <div className="mkey">
      {items.map(([c, t], __k) => (
        <span key={__k}>
          <i className="sw" style={css(`background:${c}`)} />
          {t}
        </span>
      ))}
    </div>
  );
}
export function mcomp(parts) {
  return (
    <>
      <div className="mcomp" role="img" aria-label={parts.map((p) => p[0] + ' ' + p[3]).join(', ')}>
        {parts.map((p, __k) => (
          <span key={__k} style={css(`flex:${p[1]};background:${p[2]}`)} />
        ))}
      </div>
      {mkey(parts.map((p) => [p[2], p[0] + ' ' + p[3]]))}
    </>
  );
}
export function vizTrack(nodes, signers) {
  return (
    <>
      <div className="track" role="img" aria-label={nodes.map((n) => n[0] + (n[1] ? ' done' : ' waiting')).join(', ')}>
        {nodes.map(([t, on], i) => (
          <Fragment key={i}>
            {i ? <span className="ln" /> : ''}
            <span className={`nd ${on === 2 ? 'cur' : on ? 'on' : 'wait'}`}>{t}</span>
          </Fragment>
        ))}
      </div>
      {signers
        ? mkey([
            ['var(--fg)', 'Signed'],
            ['var(--underway)', 'Waiting on you'],
          ])
        : ''}
    </>
  );
}
export function vizScale(from, to, min, max, fl, tl) {
  const a = ((from - min) / (max - min)) * 100,
    b = ((to - min) / (max - min)) * 100;
  return (
    <div className="scale" role="img" aria-label={`From ${fl} to ${tl}`}>
      <span className="base" />
      <span className="span" style={css(`left:${a}%;width:${b - a}%`)} />
      <span className="tk" style={css(`left:${a}%`)} />
      <span className="mk" style={css(`left:${b}%`)} />
      <span className="lb" style={css(`left:${a}%`)}>
        {fl}
      </span>
      <span className="lb now" style={css(`left:${b}%`)}>
        {tl}
      </span>
    </div>
  );
}
export function vizSpark(v) {
  const W = 200,
    H = 40,
    max = Math.max(...v),
    min = Math.min(...v);
  const pts = v.map((y, i) => `${((v.length > 1 ? i / (v.length - 1) : 1) * (W - 6) + 3).toFixed(1)},${(H - 4 - ((y - min) / (max - min || 1)) * (H - 8)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(',');
  return (
    <>
      <svg className="mspark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Waitlist growth over 12 weeks">
        <path d={`M${pts.join(' L')}`} />
        <rect x={(+last[0] - 4).toFixed(1)} y={(+last[1] - 4).toFixed(1)} width="8" height="8" style={css('fill:var(--fg);stroke:none')} />
      </svg>
      {mkey([['var(--fg)', '12 weeks']])}
    </>
  );
}
export function pips([n, a, b]) {
  return (
    <div className="pips" role="img" aria-label={`${a} of ${n} done${b ? `, ${b} part way` : ''}`}>
      {Array.from(
        {
          length: n,
        },
        (_, i) => (
          <i key={i} style={css(`background:${i < a ? 'var(--fg)' : i < a + b ? 'var(--land)' : 'var(--line)'}`)} />
        ),
      )}
    </div>
  );
}
export function kindHd(icon, label, tag) {
  return (
    <header className="c-hd">
      <span className="c-kind">
        {ic(icon, 'sm')}
        <span className="lbl">{label}</span>
      </span>
      <span className="tag">{tag}</span>
    </header>
  );
}
export function waitCard(w) {
  return (
    <section className="cell">
      {kindHd(W_ICON[w.id], w.kind, w.urgent ? <span className="chip live">{w.tag}</span> : w.tag)}
      <div className="c-fig">
        <h3 className="w-title">{w.title}</h3>
        <span className="fig fig-l">{w.fig}</span>
        <span className="figsub">{w.figSub}</span>
      </div>
      <div className="c-body">
        {W_VIZ[w.id]()}
        <span className="small quiet">{w.meta.join(' · ')}</span>
      </div>
      <div className="c-ft">
        <button type="button" data-open={w.id}>
          <span className="t">{w.cta}</span>
          {ic(w.mode === 'approve' ? 'chev' : 'out', 'sm')}
        </button>
      </div>
    </section>
  );
}
export function liveCard(l) {
  return (
    <section className="cell">
      {kindHd(
        l.icon,
        'In progress',
        <>
          <span className="dot pulse" aria-hidden="true" />
          Live
        </>,
      )}
      <div className="c-fig">
        <h3 className="w-title">{l.title}</h3>
        <span className="fig fig-l">{l.fig}</span>
        <span className="figsub">{l.sub}</span>
      </div>
      <div className="c-body">
        {pips(l.pips)}
        {mkey(l.key)}
      </div>
      <div className="c-ft">
        <button type="button" data-go={l.go}>
          <span className="t">{l.foot}</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
}
export function updCard(u) {
  return (
    <section className="cell">
      {kindHd(u.icon, 'Update', u.when)}
      <div className="c-fig">
        <h3 className="w-title">{u.title}</h3>
        <span className="fig fig-l">{u.fig}</span>
        <span className="figsub">{u.sub}</span>
      </div>
      <div className="c-body">
        {u.viz ? u.viz() : ''}
        <span className="small quiet">{u.by}</span>
      </div>
      <div className="c-ft">
        <button type="button" data-go={u.go}>
          <span className="t">{NAMES[u.go]}</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
}

/* ── Now ─────────────────────────────────────────────────────
   Three jobs, three forms. Things that need you are rows you act on, in due order.
   Things that are moving are progress you watch. Things that changed are a timeline you skim. */
export function chainGlyph(c) {
  return (
    <span className="cg" aria-hidden="true">
      {c.map((on, __k) => (
        <i key={__k} className={on ? 'on' : 'you'} />
      ))}
    </span>
  );
}
export function needRow(w) {
  const n = NEED[w.id];
  return (
    <div className={`nrow${w.urgent ? ' urgent' : ''}`}>
      <span className="ntile" aria-hidden="true">
        {ic(W_ICON[w.id])}
      </span>
      <div className="nmain">
        <b className="ntitle">{w.title}</b>
        <span className="nmeta">
          {n.meta}
          {w.urgent ? (
            <>
              {' · '}
              <em>{w.tag}</em>
            </>
          ) : (
            ''
          )}
        </span>
      </div>
      <div className="nend">
        <span className="fig">{n.fig}</span>
        <button className="btn btn-g btn-s" type="button" data-open={w.id}>
          {n.verb}
          {w.mode === 'approve' ? '' : ic('out')}
        </button>
      </div>
    </div>
  );
}
export function segs([n, a, b]) {
  return (
    <div className="segs" role="img" aria-label={`${a} of ${n} done${b ? `, ${b} part way` : ''}`}>
      {Array.from(
        {
          length: n,
        },
        (_, i) => (
          <i key={i} style={css(`background:${i < a ? 'var(--fg)' : i < a + b ? 'var(--land)' : 'var(--line)'}`)} />
        ),
      )}
    </div>
  );
}
export function moveRow(l) {
  return (
    <button className="mv" type="button" data-go={l.go}>
      <span className="mv-t">
        <b>{l.title}</b>
        <span className="fig fig-m">{l.fig}</span>
      </span>
      {segs(l.pips)}
      <span className="figsub">{l.sub}</span>
    </button>
  );
}
export function feedRow(u, i) {
  return (
    <li>
      <button type="button" data-go={u.go}>
        <span className={`node${u.mine ? ' on' : ''}`} />
        <span className="when">{u.when}</span>
        <span className="what">{u.what}</span>
        <span className="small quiet">{u.by}</span>
      </button>
    </li>
  );
}
export function zone({ span, label, tag, state = '', body, foot }) {
  return (
    <section className={`cell zone ${span}`} {...attrs(state ? `data-state="${state}"` : '')}>
      <header className="c-hd">
        <span className="lbl">{label}</span>
        <span className="tag">{tag}</span>
      </header>
      <div className="c-fig" />
      <div className="z-body">{body}</div>
      <div className="c-ft">{foot}</div>
    </section>
  );
}
export function needZone(waiting, span = 's-6') {
  const rows = (
    <div className="nlist">
      {waiting
        .slice()
        .sort((a, b) => NEED[a.id].order - NEED[b.id].order)
        .map(needRow)}
    </div>
  );
  return zone({
    span,
    label: 'Needs you',
    tag: waiting.length ? (
      `${waiting.length} waiting`
    ) : (
      <>
        <span className="dot" style={css('color:var(--settled)')} />
        All clear
      </>
    ),
    state: waiting.length ? '' : 'settled',
    body: waiting.length ? (
      rows
    ) : (
      <div className="z-empty">
        <p className="sub">Nothing needs you.</p>
        <span className="small quiet">Approvals and signatures land here first.</span>
      </div>
    ),
    foot: (
      <div className="row">
        <span className="t">Whoever proposes can’t approve</span>
      </div>
    ),
  });
}
export function nowPanel(waiting) {
  const moving = zone({
    span: 's-3',
    label: 'Moving',
    tag: (
      <>
        <span className="dot pulse" aria-hidden="true" />
        Live
      </>
    ),
    body: real(S.live).length ? <div className="mvlist">{real(S.live).map(moveRow)}</div> : <div className="z-empty">{noneYet}</div>,
    foot: (
      <button type="button" data-go="records">
        <span className="t">All running work</span>
        {ic('chev', 'sm')}
      </button>
    ),
  });
  const changed = zone({
    span: 's-3',
    label: 'Changed',
    tag: 'Today',
    body: real(S.updates).length ? (
      <ol className="feed">{real(S.updates).map(feedRow)}</ol>
    ) : (
      <div className="z-empty">{noneYet}</div>
    ),
    foot: (
      <button type="button" data-go="records">
        <span className="t">Activity log</span>
        {ic('chev', 'sm')}
      </button>
    ),
  });
  return (
    <div className="group">
      <div className="g-lbl">
        <span className="lbl">Now</span>
        <span className="lbl aside">{REAL ? `Updated ${new Date().toTimeString().slice(0, 5)}` : 'Updated 22:50'}</span>
      </div>
      <div className="nowwrap">
        <div className="bento sub now">
          {needZone(waiting)}
          {moving}
          {changed}
        </div>
      </div>
    </div>
  );
}
export function allClear() {
  return nowPanel([]);
}
export function syncPages() {
  const st = $('#strip'),
    dots = $('#dots');
  if (!st || !dots) return;
  const pages = Math.max(1, Math.round(st.scrollWidth / st.clientWidth));
  const cur = Math.min(pages - 1, Math.round(st.scrollLeft / st.clientWidth));
  if (dots.childElementCount !== pages) {
    html(
      dots,
      Array.from(
        {
          length: pages,
        },
        (_, i) => <button key={i} type="button" data-page={i} aria-label={`Page ${i + 1} of ${pages}`} />,
      ),
    );
  }
  dots.style.visibility = pages < 2 ? 'hidden' : 'visible';
  [...dots.children].forEach((d, i) => d.setAttribute('aria-current', String(i === cur)));
  const [prev, next] = document.querySelectorAll('.p-nav button');
  if (prev) {
    prev.disabled = cur === 0;
    next.disabled = cur >= pages - 1;
  }
}
export function numbers(cobaltFree, alerts) {
  const d0 = RANGE[S.range];
  // the range's own words, when the data came without them
  const d = d0.name
    ? d0
    : {
        ...d0,
        name: { today: 'Today', week: '7 days', month: '30 days' }[S.range],
        prevName: { today: `Last ${DOW[new Date(TODAY).getUTCDay()]}`, week: '7 days before', month: '30 days before' }[S.range],
      };
  const fTot = d.forms.reduce((a, b) => a + b, 0);
  const C = ['var(--fg)', 'var(--land)', 'var(--fg-50)', 'var(--line)'];
  const when = S.range === 'today' ? 'today' : 'in ' + d.name;
  const F = (n, sub) => (
    <>
      <span className="fig fig-xl">{n}</span>
      <span className="figsub">{sub}</span>
    </>
  );
  const G = (label, aside, body) => (
    <div className="group">
      <div className="g-lbl">
        <span className="lbl">{label}</span>
        {aside ? <span className="lbl aside">{aside}</span> : ''}
      </div>
      {body}
    </div>
  );

  /* Traffic */
  const visits = cell({
    span: 's-8',
    label: 'Site visits',
    tag:
      S.range === 'today' ? (
        <>
          <span className="dot pulse" aria-hidden="true" />
          Live
        </>
      ) : (
        d.name
      ),
    fig: F(int(d.visits), d.delta),
    main: (
      <>
        <div>
          {spark(d.spark, cobaltFree, d.prev)}
          <div className="axis" style={css('margin-top:8px')}>
            {d.axis.map((a, __k) => (
              <span key={__k}>{a}</span>
            ))}
          </div>
        </div>
        <div className="key">
          <span>
            <i />
            {d.name}
          </span>
          <span>
            <i className="d" />
            {d.prevName}
          </span>
        </div>
      </>
    ),
    foot: [
      {
        t: d.page[0] ? `Top page ${d.page[0]} · ${int(d.page[1])}` : 'No top page yet',
        go: 'growth',
      },
      {
        t: REAL ? feedLabel('site') || 'Not synced yet' : 'Synced 1 min ago',
      },
    ],
  });
  const forms = cell({
    span: 's-4',
    label: 'Forms',
    tag: d.name,
    fig: F(int(fTot), `submitted ${when}`),
    main: compBar(d.forms.map((v, i) => [FORMS[i], v, C[i]])),
    foot: [
      {
        t: 'All forms',
        go: 'growth',
      },
    ],
  });
  const sources = cell({
    span: 's-4',
    label: 'Sources',
    tag: d.name,
    fig: F(pc(d.src[0], d.visits), 'of visits came from a poster'),
    main: compBar(['Posters', 'Direct', 'Social', 'Search'].map((k, i) => [k, d.src[i], C[i]])),
  });
  const jr = d.visits ? +((d.forms[0] / d.visits) * 100).toFixed(1) : 0,
    dj = (jr - d.joinPrev).toFixed(1);
  const join = cell({
    span: 's-4',
    label: 'Join rate',
    tag: d.name,
    fig: F(jr.toFixed(1) + '%', `of visits joined · ${dj >= 0 ? 'up' : 'down'} ${Math.abs(dj)} pts`),
    main: (
      <>
        {d.visits ? vizScale(d.joinPrev, jr, 2, 5, d.joinPrev.toFixed(1) + '%', jr.toFixed(1) + '%') : ''}
        {mkey([
          ['var(--fg-50)', d.prevName],
          ['var(--fg)', d.name],
        ])}
        <div className="how two">
          {[
            ['Joins', int(d.forms[0])],
            ['Visits', int(d.visits)],
          ].map(([k, v], __k) => (
            <Fragment key={__k}>
              <span className="k">{k}</span>
              <b className="num">{v}</b>
            </Fragment>
          ))}
        </div>
      </>
    ),
  });
  const CITY = ['Redlands', 'San Bernardino', 'Riverside', 'Elsewhere'];
  const cities = cell({
    span: 's-4',
    label: 'Cities',
    tag: d.name,
    fig: F(pc(d.cities[0], d.visits), 'of visits from Redlands, the top city'),
    main: (
      <div className="how">
        {CITY.map((k, i) => (
          <Fragment key={i}>
            <span className="k">{i === 3 ? <span className="quiet">{k}</span> : k}</span>
            <b className="num">{int(d.cities[i])}</b>
            <span className="quiet num">{pc(d.cities[i], d.visits)}</span>
          </Fragment>
        ))}
      </div>
    ),
  });

  /* Poster launch */
  /* Funnel: one drawn shape, width shared with the step columns so they line up.
     Height follows the square root of each count, so a 50-to-1 drop stays readable. */
  const conv = FUNNEL.map((f, i) => (i ? (FUNNEL[i - 1][1] ? f[1] / FUNNEL[i - 1][1] : 0) : 1));
  const weak = conv.indexOf(Math.min(...conv.slice(1)));
  const hs = FUNNEL.map((f) => Math.max(10, FUNNEL[0][1] ? 112 * Math.sqrt(f[1] / FUNNEL[0][1]) : 0));
  const top = (h) => (60 - h / 2).toFixed(1),
    bot = (h) => (60 + h / 2).toFixed(1),
    T = 14;
  let up = [],
    dn = [];
  hs.forEach((h, i) => {
    const x0 = i * 100 + (i ? T : 0),
      x1 = (i + 1) * 100 - (i < 5 ? T : 0);
    up.push(`${x0},${top(h)}`, `${x1},${top(h)}`);
    dn.unshift(`${x1},${bot(h)}`, `${x0},${bot(h)}`);
  });
  const shape = FUNNEL.length ? (
    <svg
      className="fshape"
      viewBox="0 0 600 120"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Funnel from ${int(FUNNEL[0][1])} visits to ${int(FUNNEL.at(-1)[1])} first spends`}
    >
      <polygon points={`${up.join(' ')} ${dn.join(' ')}`} style={css('fill:var(--line)')} />
      <rect x="501" y={top(hs[5])} width="99" height={hs[5].toFixed(1)} style={css('fill:var(--fg)')} />
      {[1, 2, 3, 4, 5].map((i, __k) => (
        <line key={__k} x1={i * 100} x2={i * 100} y1="0" y2="120" style={css('stroke:var(--ground);stroke-width:2;vector-effect:non-scaling-stroke')} />
      ))}
    </svg>
  ) : (
    ''
  );
  const convTxt = (i) =>
    i ? (
      <>
        {ic('arr', 'xs')}
        {pc(FUNNEL[i][1], FUNNEL[i - 1][1])}
      </>
    ) : (
      'all sources'
    );
  const funnel = cell({
    span: 's-7',
    label: 'Funnel',
    tag: 'Last 30 days',
    fig: F((FUNNEL.length && FUNNEL[0][1] ? ((FUNNEL.at(-1)[1] / FUNNEL[0][1]) * 100).toFixed(2) : '0.00') + '%', 'of visits end in a first spend at a partner shop'),
    main: !FUNNEL.length ? (
      noneYet
    ) : (
      <>
        <div className="fwrap">
          <div className="fwide">
            <div className="fcols">
              {FUNNEL.map(([k, v], __k) => (
                <div key={__k}>
                  <span className="lbl">{k}</span>
                  <span className="fig fig-m">{int(v)}</span>
                </div>
              ))}
            </div>
            {shape}
            <div className="fcols fconv">
              {FUNNEL.map((f, i) => (
                <span key={i} className={`cv${i === weak ? ' weak' : ''}`}>
                  {convTxt(i)}
                </span>
              ))}
            </div>
          </div>
          <div className="fnarrow">
            {FUNNEL.map(([k, v], i) => (
              <div key={i} className="frow">
                <span className="lbl">{k}</span>
                <span className="fig fig-m">{int(v)}</span>
                <span className="fband">
                  <i style={css(`width:${((hs[i] / 112) * 100).toFixed(1)}%;background:${i === 5 ? 'var(--fg)' : 'var(--line)'}`)} />
                </span>
                <span className={`cv${i === weak ? ' weak' : ''}`}>{convTxt(i)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="fkey">
          <span className="small quiet">
            {'Biggest drop is '}
            <b className="drop">{weak === 1 ? 'visit to join' : `${FUNNEL[weak - 1][0].toLowerCase()} to ${FUNNEL[weak][0].toLowerCase()}`}</b>
            {`. ${FUNNEL[0][1] ? Math.round((1 - FUNNEL[1][1] / FUNNEL[0][1]) * 100) : 0} in every 100 visits leave without joining. ${fig('members.first_spends.poster_ten') ?? 0} of the ${FUNNEL.at(-1)[1]} first spends were a poster’s $10.`}
          </span>
        </div>
      </>
    ),
    foot: [
      {
        t: 'By source',
        go: 'growth',
      },
      {
        t: 'Poster funnel by shop',
        go: 'growth',
      },
    ],
  });
  const mc = memberCounts();
  const how = [
    ['Connected a bank', mc.funded.bank],
    ['Added $5', mc.funded.five],
    ['Set up direct deposit', mc.funded.deposit],
  ];
  const act = cell({
    span: 's-5',
    label: 'Activation',
    tag: 'Last 30 days',
    fig: F(pc(mc.active, mc.invited), `of ${mc.invited} invited · ${int(d.act)} activated ${when}`),
    main: (
      <>
        <div className="ablock">
          <span className="lbl">Where the {mc.invited} are</span>
          {compBar([
            ['Activated', mc.active, 'var(--fg)'],
            ['Opened, not funded', mc.opened, 'var(--land)'],
            ['Not opened yet', mc.notOpened, 'var(--line)'],
          ])}
        </div>
        <div className="ablock">
          <span className="lbl">How the {mc.active} activated</span>
          <div className="how">
            {how.map(([k, v], __k) => (
              <Fragment key={__k}>
                <span className="k">{k}</span>
                <b className="num">{v}</b>
                <span className="quiet num">{pc(v, mc.active)}</span>
              </Fragment>
            ))}
          </div>
        </div>
      </>
    ),
    foot: [
      {
        t: `Nudge ${mc.opened} people`,
        go: 'members',
      },
      {
        t: '90-day window',
        go: 'members',
      },
    ],
  });
  const others = d.scans - d.top.reduce((a, t) => a + t[1], 0);
  const tail = others <= 0 ? [] : (() => {
    const n = 70,
      w = Array.from(
        {
          length: n,
        },
        (_, i) => Math.exp(-i / 22),
      );
    const sw = w.reduce((a, b) => a + b, 0),
      rest = others - n;
    const v = w.map((x) => 1 + Math.floor((x / sw) * rest));
    let r = others - v.reduce((a, b) => a + b, 0);
    for (let i = 0; r > 0; i = (i + 1) % n, r--) v[i]++;
    return v;
  })();
  const nP = LIVE && vars.posterCount != null ? vars.posterCount : POSTERS.length;
  const dist = [...d.top.map((t) => t[1]), ...tail, ...Array(Math.max(0, nP - d.top.length - tail.length)).fill(0)].sort((a, b) => b - a);
  const none = dist.filter((v) => !v).length,
    top10 = dist.slice(0, 10).reduce((a, b) => a + b, 0);
  const dmax = dist[0],
    bw = 600 / nP;
  const distSvg = (
    <svg className="dist" viewBox="0 0 600 72" preserveAspectRatio="none" role="img" aria-label={`Scans per poster, most to least. ${none} posters had none.`}>
      {dist.map((v, i) => {
        const h = v ? Math.max(3, Math.sqrt(v / dmax) * 70) : 1.5;
        return (
          <rect
            key={i}
            x={(i * bw).toFixed(2)}
            y={(72 - h).toFixed(1)}
            width={(bw - 1.4).toFixed(2)}
            height={h.toFixed(1)}
            style={css(`fill:${i < 3 ? 'var(--fg)' : v ? 'var(--line)' : 'var(--hair)'}`)}
          />
        );
      })}
    </svg>
  );
  const scans = cell({
    span: 's-5',
    label: 'Poster scans',
    tag: d.name,
    fig: F(int(d.scans), `scans ${when} · ${none} posters had none`),
    main: (
      <>
        <div>
          {distSvg}
          <div className="axis" style={css('margin-top:8px')}>
            <span>Most scanned</span>
            <span>{nP} posters</span>
          </div>
        </div>
        <div className="how">
          {d.top.map(([n, v], __k) => (
            <Fragment key={__k}>
              <span className="k">
                <i className="sw" style={css('background:var(--fg)')} />
                {n}
              </span>
              <b className="num">{int(v)}</b>
              <span className="quiet num">{pc(v, d.scans)}</span>
            </Fragment>
          ))}
        </div>
        <span className="small quiet">
          {'The top 10 posters bring '}
          {pc(top10, d.scans)}
          {' of scans.'}
        </span>
      </>
    ),
    foot: [
      {
        t: `${nP} posters up`,
        go: 'growth',
      },
    ],
  });
  const on = owedNow(),
    owed = on.rows.reduce((a, r) => a + r[1], 0),
    shops = on.rows.length,
    top2 = on.rows.filter((r) => r !== on.today).slice(0, 2),
    rest = on.rows.filter((r) => r !== on.today && !top2.includes(r));
  const owedRows = top2.map(([n, v]) => [n, v / 10, 'var(--fg)']);
  if (on.today) owedRows.push([on.today[0], on.today[1] / 10, 'var(--land)', 'in today’s payout']);
  owedRows.push([`${rest.length} more shops`, rest.reduce((a, r) => a + r[1], 0) / 10, 'var(--line)']);
  const run = fig('merchants.payouts.schedule')?.monthly ? dayDate(fig('merchants.payouts.schedule').monthly) : '–';
  const owedC = cell({
    span: 's-7',
    label: '$10 owed to shops',
    tag: 'Redemptions',
    fig: F(money(owed), `owed to ${shops} shops · clears ${run}`),
    main: !on.rows.length ? (
      noneYet
    ) : (
      <>
        <div className="owe">
          {owedRows.map(([n, c, col, note], __k) => (
            <div key={__k} className="orow">
              <span className="k">
                {n}
                {note ? (
                  <span className="quiet small">
                    {' · '}
                    {note}
                  </span>
                ) : (
                  ''
                )}
              </span>
              <span className="opips" aria-label={`${c} redemptions`}>
                {Array.from(
                  {
                    length: c,
                  },
                  (_, __k) => (
                    <i key={__k} style={css(`background:${col}`)} />
                  ),
                )}
              </span>
              <b className="num">{money(c * 10)}</b>
            </div>
          ))}
        </div>
        <span className="small quiet">Each square is one $10 spent at that shop.</span>
      </>
    ),
    foot: [
      {
        t: `Paid ${money((fig('home.redeemed_paid') ?? 0) + on.paidOut)} in ${fmtD(TODAY).split(' ')[1]}`,
        go: 'merchants',
      },
      {
        t: `Next run ${run}`,
      },
    ],
  });

  /* Watch */
  const fixHtml = (a) =>
    a.fix === 'resync' ? (
      <span className="afix">
        <span className="small quiet">
          {'Re-syncing '}
          {a.progress[0]}/{a.progress[1]}
        </span>
        {segs([a.progress[1], a.progress[0], 0])}
      </span>
    ) : a.fix === 'route' ? (
      <button className="btn btn-g btn-s" type="button" data-go="field">
        Add to route
      </button>
    ) : a.fix === 'stock' ? (
      // live only (Phase 10c): a material under its low mark
      <button className="btn btn-g btn-s" type="button" data-spane="inventory">
        See materials
      </button>
    ) : (
      <button className="chip plain" type="button" data-go="waiting" style={css('height:24px')}>
        In Needs you
      </button>
    );
  const high = alerts.filter((a) => a.sev === 'absent').length;
  const al = cell({
    span: 's-5',
    label: 'Alerts',
    tag: alerts.length ? 'Needs a look' : 'All clear',
    state: alerts.length ? 'underway' : 'settled',
    fig: F(String(alerts.length), alerts.length ? `open · ${high} high, ${alerts.length - high} to check` : 'open · every feed synced'),
    main: alerts.length ? (
      <>
        <div className="alist">
          {alerts.map((a, __k) => (
            <div key={__k} className="arow">
              <i className="sev" style={css(`background:var(--${a.sev})`)} aria-label={a.sev === 'absent' ? 'High' : 'Check'} />
              <button className="amain" type="button" data-go={a.spane ? undefined : a.go} data-spane={a.spane}>
                <b>{a.t}</b>
                <span className="small quiet">
                  {a.area}
                  {' · '}
                  {a.age}
                </span>
              </button>
              {fixHtml(a)}
            </div>
          ))}
        </div>
        {mkey([
          ['var(--absent)', 'High'],
          ['var(--underway)', 'Check'],
        ])}
      </>
    ) : (
      <span className="small quiet">Nothing needs a look.</span>
    ),
    foot: [
      {
        t: 'All alerts',
        go: 'records',
      },
    ],
  });
  const ready = DEADLINES.filter((x) => x[4] === 'ready').length;
  const marks = DEADLINES.map(([t, e, dt, n, st], i) => (
    <Fragment key={i}>
      <span className={`mk ${st}`} style={css(`left:${(n / 30) * 100}%`)}>
        {i + 1}
      </span>
      <span className="dt" style={css(`left:${(n / 30) * 100}%`)}>
        {dt}
      </span>
    </Fragment>
  ));
  const dl = cell({
    span: 's-7',
    label: 'Deadlines',
    tag: 'Next 30 days',
    fig: F(DEADLINES.length ? `${DEADLINES[0][3]} days` : 'None', `to the next filing · ${ready} of ${DEADLINES.length} ready`),
    main: (
      <>
        <div className="tl" role="img" aria-label={DEADLINES.map((x) => x[0] + ' on ' + x[2]).join(', ')}>
          <span className="base" />
          <span className="tick" style={css('left:0')} />
          <span className="tick" style={css('left:100%')} />
          <span className="end" style={css('left:0')}>
            Today
          </span>
          <span className="end" style={css('left:100%;transform:translateX(-100%)')}>
            {fmtD(TODAY + 30 * DAY)}
          </span>
          {marks}
        </div>
        <div className="dlist">
          {DEADLINES.length ? '' : noneYet}
          {DEADLINES.map(([t, e, dt, n, st], i) => (
            <div key={i} className="drow">
              <span className={`num-sq ${st}`}>{i + 1}</span>
              <span className="dmain">
                <b>{t}</b>
                <span className="small quiet">
                  {e}
                  {' · '}
                  {dt}
                  {' · '}
                  {n}
                  {' days'}
                </span>
              </span>
              <span className={`chip ${DL_STATUS[st][0]}`}>{DL_STATUS[st][1]}</span>
            </div>
          ))}
        </div>
      </>
    ),
    foot: [
      {
        t: 'Compliance calendar',
        go: 'governance',
      },
    ],
  });
  return (
    <>
      {G(
        'Traffic',
        '',
        <div className="bento sub">
          {visits}
          {forms}
          {sources}
          {join}
          {cities}
        </div>,
      )}
      {G(
        'Funnel and posters',
        'All sources · about 100 posters with $10 to spend at that shop',
        <div className="bento sub">
          {funnel}
          {act}
          {scans}
          {owedC}
        </div>,
      )}
      {G(
        'Watch',
        '',
        <div className="bento sub">
          {al}
          {dl}
        </div>,
      )}
    </>
  );
}

/* ── Full-screen states ──────────────────────────────────── */
export function stateEmpty() {
  return (
    <div className="state">
      <div>
        <span className="lbl">Empty</span>
        <p className="h2">No numbers yet.</p>
        <p className="quiet" style={css('margin:0;max-width:44ch')}>
          They show up after the first poster is scanned or the first form comes in.
        </p>
        <div className="acts">
          <button className="btn btn-p" type="button" data-go="growth">
            <span className="dot pulse" style={css('color:var(--btn-dot)')} aria-hidden="true" />
            Set up posters
          </button>
          <button className="btn btn-g" type="button" data-go="members">
            Invite a batch
          </button>
        </div>
      </div>
      <div>
        <span className="lbl">Getting numbers flowing</span>
        <div className="rows">
          <div className="r">
            <span className="k">Site analytics connected</span>
            <span className="chip settled">
              <span className="dot" />
              Done
            </span>
          </div>
          <div className="r">
            <span className="k">First poster hung and scanned</span>
            <span className="chip absent">
              <span className="dot" />
              Not yet
            </span>
          </div>
          <div className="r">
            <span className="k">First batch invited</span>
            <span className="chip absent">
              <span className="dot" />
              Not yet
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
export function stateLoading() {
  // live, the real sources as they stand; the prototype's sample otherwise
  const real = REAL ? feedList().map((f) => [f.name, ...feedChip(f)]) : null;
  const src = real ?? [
    ['Site analytics', 'settled', 'Loaded'],
    ['Lithic', 'settled', 'Loaded'],
    ['Bridge', 'underway', 'Loading'],
    ['Plaid', 'underway', 'Loading'],
    ['Clear protocol', 'underway', 'Loading'],
  ];
  const sk = (span, rows) => (
    <section className={`cell ${span}`}>
      <header className="c-hd">
        <span className="skel" style={css('width:96px')} />
      </header>
      <div className="c-mn">
        <span className="skel big" />
        {Array.from(
          {
            length: rows,
          },
          (_, i) => (
            <span key={i} className="skel" style={css(`width:${90 - i * 14}%`)} />
          ),
        )}
      </div>
    </section>
  );
  return (
    <div className="group">
      <div className="g-lbl">
        <span className="lbl">{real ? (real.length ? `Loading from ${real.length} sources` : 'Loading') : 'Loading from 5 sources'}</span>
      </div>
      <div className="bento">
        <section className="cell s-4">
          <header className="c-hd">
            <span className="lbl">Sources</span>
            <span className="tag">{real ? `${real.filter((r) => r[1] === 'settled').length}/${real.length}` : '2/5'}</span>
          </header>
          <div className="c-mn">
            <div className="rows srcs">
              {src.map(([n, s, t], __k) => (
                <div key={__k} className="r">
                  <span className="k">{n}</span>
                  <span className={`chip ${s}`}>
                    <span className={`dot${s === 'underway' ? ' pulse' : ''}`} />
                    {t}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
        {sk('s-5', 3)}
        {sk('s-3', 2)}
      </div>
      <div className="bento" style={css('border-top:0')}>
        {sk('s-3', 2)}
        {sk('s-6', 2)}
        {sk('s-3', 3)}
      </div>
    </div>
  );
}
/** The page couldn't load. Live, it says why and when; the prototype's sample says the node didn't answer. */
export function stateError(err?: Error) {
  return (
    <div className="state" data-state="absent">
      {REAL ? (
        <div>
          <span className="lbl" style={css('color:var(--absent)')}>
            {`Error · ${new Date().toTimeString().slice(0, 5)}`}
          </span>
          <p className="h2">Couldn’t load this page.</p>
          <p className="quiet" style={css('margin:0;max-width:46ch')}>
            {`${err?.message || 'The API didn’t answer.'} Nothing moved.`}
          </p>
          <div className="acts">
            <button className="btn btn-p" type="button" data-retry="">
              Try again
            </button>
          </div>
        </div>
      ) : (
        <div>
          <span className="lbl" style={css('color:var(--absent)')}>
            Error · 22:48
          </span>
          <p className="h2">Couldn’t reach the protocol.</p>
          <p className="quiet" style={css('margin:0;max-width:46ch')}>
            The testnet node didn’t answer. Nothing moved. The last good figures are from 22:31.
          </p>
          <div className="acts">
            <button className="btn btn-p" type="button" data-retry="">
              Try again
            </button>
            <button className="btn btn-g" type="button" data-preview="live">
              Show figures from 22:31
            </button>
          </div>
        </div>
      )}
      <div>
        <span className="lbl">Sources</span>
        {REAL && !hasFeeds() ? (
          <span className="small quiet">Not loaded yet.</span>
        ) : REAL ? (
          <div className="rows srcs">
            {feedList().map((f) => {
              const [cls, words] = feedChip(f);
              return (
                <div key={f.id} className="r">
                  <span className="k">{f.name}</span>
                  <span className={`chip ${cls}`} title={f.error ?? f.offReason ?? ''}>
                    <span className="dot" />
                    {words}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rows srcs">
            <div className="r">
              <span className="k">Site analytics</span>
              <span className="chip settled">
                <span className="dot" />
                Synced
              </span>
            </div>
            <div className="r">
              <span className="k">Lithic</span>
              <span className="chip settled">
                <span className="dot" />
                Synced
              </span>
            </div>
            <div className="r">
              <span className="k">Bridge</span>
              <span className="chip settled">
                <span className="dot" />
                Synced
              </span>
            </div>
            <div className="r">
              <span className="k">Plaid</span>
              <span className="chip underway">
                <span className="dot" />
                3h behind
              </span>
            </div>
            <div className="r">
              <span className="k">Clear protocol</span>
              <span className="chip absent">
                <span className="dot" />
                Not reached
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
/* ── Waiting (phone tab) ─────────────────────────────────── */
export function waitingPage() {
  const { needs, alerts } = ibxData();
  const words = ['', 'One thing needs', 'Two things need', 'Three things need', 'Four things need'];
  const h = head(
    <>
      {'Inbox · '}
      <b>{needs.length + alerts.length}</b>
    </>,
    needs.length ? `${words[needs.length] || needs.length + ' things need'} you.` : 'Nothing needs you.',
    '',
    'Approvals and signatures first, then alerts, then updates. Whoever proposes can’t approve.',
  );
  return (
    <>
      {h}
      <div className="group">
        <div className="bento sub">{inboxCell('s-12 ibx-c')}</div>
      </div>
    </>
  );
}

/* ── Placeholder sections ────────────────────────────────── */
export function placeholder(id) {
  const p = PLANNED[id];
  const h = head(
    <>
      {NAMES[id]}
      {' · '}
      <b>Next stage</b>
    </>,
    NAMES[id],
    <span className="chip absent">
      <span className="dot" />
      Not yet built
    </span>,
    p.line,
  );
  const spans = SPANS[p.panes.length];
  return (
    <>
      {h}
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">Planned panes</span>
          <span className="count">{p.panes.length}</span>
        </div>
        <div className="bento sub pl">
          {p.panes.map(([t, d], i) =>
            cell({
              span: spans[i],
              label: t,
              tag: 'Pane',
              main: <p>{d}</p>,
              foot: [
                {
                  t: 'Comes in a later stage',
                },
              ],
            }),
          )}
        </div>
      </div>
    </>
  );
}

/* ── More (phone tab) ────────────────────────────────────── */
export function morePage() {
  const items = SECTIONS.flatMap((g) => g.items).filter(([id]) => !['home', 'field'].includes(id) && vLevel(id) > 0);
  return (
    <>
      {head('More', 'Everything else')}
      <div className="more-sec">
        <div className="list" style={css('border-top:1px solid var(--line)')}>
          {items.map(([id, n], __k) => (
            <button key={__k} className="nav" type="button" data-go={id}>
              {ic(id)}
              <span>{n}</span>
              <span className="ch">{ic('chev', 'sm')}</span>
            </button>
          ))}
        </div>
        <span className="lbl" style={css('margin-top:var(--s3)')}>
          Theme
        </span>
        <div style={css('max-width:360px')}>{themeSwitch()}</div>
        <span className="lbl" style={css('margin-top:var(--s3)')}>
          Signed in
        </span>
        <p style={css('margin:0')}>
          {S.view && !S.view.preview ? (
            <>
              {S.view.who} <span className="quiet">· Member</span>
            </>
          ) : (
            <>
              {'Kai '}
              <span className="quiet">· Admin</span>
            </>
          )}
        </p>
      </div>
    </>
  );
}

/* ══ Growth ══════════════════════════════════════════════════════════════
   Three panes: Funnel (by shop, by design), Posters (inventory, swaps), Site and forms.
   Every total here matches Home's 30-day poster funnel: 4,812 scans · 1,106 joined ·
   124 activated · 97 spent $10 · 102 posters. */
