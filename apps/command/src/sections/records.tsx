// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { LIVE } from '../live/env';
import * as live from '../live/account';
import { css, swapClass } from '../runtime/dom';
import { D, pctX } from './contracts';
import { compBar, head, ic, pct, rng } from './core';
import {
  APPR,
  AREAS,
  COVER,
  COVER_K,
  CV,
  DAY,
  DCOUNT,
  DOCS,
  DONE1,
  DSTAT,
  DSTATE_N,
  DT,
  LOG,
  MON,
  NOW,
  PEOPLE_T,
  RESULT,
  RPN,
  RS,
  SIGNIN,
  TODAY,
  WEEK,
  WHO,
  vars,
} from './data';
import { entOf, kv, sec, vModal } from './governance';
import { G, figHtml, fmtD, gCell } from './growth';
import { mkey, vizTrack } from './home';
import { ddHtml } from './kit';
import { strip } from './money';

/* on file, draft, waiting */
export function docOf(id) {
  return DOCS.find((d) => d[0] === id);
}
export function H2(m, d, h, mi = 0) {
  return Date.UTC(2026, m - 1, d, h, mi);
}
export function logOf(id) {
  return LOG.find((l) => l[0] === id);
}
/* ── drawing ──────────────────────────────────────────────────────────── */
export function areaDot(a, big) {
  return AREAS[a][1] === 'gov' ? `background:var(--ground);box-shadow:inset 0 0 0 ${big ? 2 : 1.5}px var(--fg)` : `background:${AREAS[a][1]}`;
}
export function weekLanes() {
  /* a tile per person per day: shade is how busy, the number is the count, the strip is the mix, corner squares are key actions */
  const order = Object.keys(AREAS),
    days = Array.from(
      {
        length: 7,
      },
      (_, d) => H2(10, 15 + d, 0),
    );
  const dn = (t) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(t).getUTCDay()];
  const cellOf = (w, t) => {
    const e = t + DAY;
    return {
      keys: LOG.filter((l) => l[2] === w && l[1] >= t && l[1] < e).sort((a, b) => a[1] - b[1]),
      evs: WEEK.filter((x) => x[1] === w && x[0] >= t && x[0] < e),
    };
  };
  const max = Math.max(
    ...WHO.flatMap(([w]) =>
      days.map((t) => {
        const c = cellOf(w, t);
        return c.keys.length + c.evs.length;
      }),
    ),
  );
  const head = (
    <div className="wt-r wt-h">
      <span />
      {days.map((t, i) => (
        <span key={i} className={i === 6 ? 'now' : ''}>
          {i === 6 ? 'Today' : dn(t) + ' ' + new Date(t).getUTCDate()}
        </span>
      ))}
    </div>
  );
  const rows = WHO.map(([w, n], __k) => {
    const tot = WEEK.filter((e) => e[1] === w).length + LOG.filter((l) => l[2] === w && l[1] >= days[0]).length;
    return (
      <div key={__k} className="wt-r">
        <span className="wt-p">
          <b>{n}</b>
          <span>
            {tot}
            {' actions'}
          </span>
        </span>
        {days.map((t, i) => {
          const { keys, evs } = cellOf(w, t),
            cnt = keys.length + evs.length;
          const mix = order.map((a) => [a, evs.filter((x) => x[2] === a).length + keys.filter((l) => l[3] === a).length]).filter((x) => x[1]);
          return (
            <button
              key={i}
              type="button"
              className={`wtl${i === 6 ? ' now' : ''}`}
              data-rflow="day"
              data-rid={`${w}|${i}`}
              style={css(`--v:${(cnt / max).toFixed(2)}`)}
              title={`${n} · ${dn(t)} ${new Date(t).getUTCDate()} · ${cnt} actions${keys.length ? ' · ' + keys.length + ' key' : ''}`}
            >
              <b className="wtl-n">{cnt}</b>
              {keys.length ? (
                <span className="wtl-k">
                  {keys.map((_, __k) => (
                    <i key={__k} />
                  ))}
                </span>
              ) : (
                ''
              )}
            </button>
          );
        })}
      </div>
    );
  });
  return (
    <div className="wtg">
      {head}
      {rows}
    </div>
  );
}
export function areaKey(bare) {
  return (
    <div className="mkey wg-key">
      {bare ? (
        ''
      ) : (
        <>
          <span className="wg-kk">
            <i className="sw wt-sw" />
            Darker is busier · select a day
          </span>
          <span className="rule" />
        </>
      )}
      {Object.entries(AREAS).map(([k, [n]], __k) => (
        <span key={__k}>
          <i className="sw" style={css(areaDot(k))} />
          {n}
        </span>
      ))}
    </div>
  );
}
export function apprMatrix() {
  const ppl = [
      ['K', 'Kai'],
      ['DR', 'Dana Ruiz'],
      ['ML', 'Marcus Lee'],
    ],
    appr = [
      ['K', 'Kai'],
      ['DR', 'Dana'],
      ['ML', 'Marcus'],
      ['BS', 'Board'],
    ];
  return (
    <>
      <div className="am">
        <div className="am-r am-cap">
          <span />
          <span>Approved by</span>
        </div>
        <div className="am-r am-h">
          <span className="lbl">Proposed by</span>
          {appr.map((a, __k) => (
            <span key={__k}>{a[1]}</span>
          ))}
          <span>Total</span>
        </div>
        {ppl.map(([p, n], __k) => {
          const row = APPR[p] || {},
            tot = Object.values(row).reduce((a, b) => a + b, 0);
          return (
            <div key={__k} className="am-r">
              <span className="am-k">{n}</span>
              {appr.map(([a], __k) => {
                if (a === p) return <i key={__k} className="am-c self" title="Nobody approves their own action" />;
                const v = row[a] || 0;
                return (
                  <i key={__k} className="am-c" style={css(`--v:${v / 6};${v / 6 >= 0.5 ? 'color:var(--ground)' : ''}`)}>
                    {v || ''}
                  </i>
                );
              })}
              <b className="am-t">{tot}</b>
            </div>
          );
        })}
      </div>
      <div className="mkey">
        <span>
          <i className="sw" style={css('background:var(--fg)')} />
          Approvals, last 30 days
        </span>
        <span>
          <i className="sw am-sw" />
          Can’t approve your own
        </span>
      </div>
    </>
  );
}
export function byPerson() {
  const order = Object.keys(AREAS),
    from = H2(10, 15, 0);
  const data = WHO.map(([w, n]) => [
    n,
    order.map((a) => WEEK.filter((e) => e[1] === w && e[2] === a).length + LOG.filter((l) => l[2] === w && l[3] === a && l[1] >= from).length),
  ]);
  const max = Math.max(...data.map((d) => d[1].reduce((a, b) => a + b, 0)));
  return (
    <div className="bp">
      {data.map(([n, v], __k) => {
        const tot = v.reduce((a, b) => a + b, 0);
        return (
          <div key={__k} className="bp-r">
            <span className="bp-k">{n}</span>
            <span className="bp-b" style={css(`width:${(tot / max) * 100}%`)}>
              {v.map((x, i) => (x ? <i key={i} style={css(`flex:${x};${areaDot(order[i])}`)} title={`${AREAS[order[i]][0]} ${x}`} /> : ''))}
            </span>
            <b className="num">{tot}</b>
          </div>
        );
      })}
    </div>
  );
}
export function coverMatrix() {
  const ids = ['coop', 'fin', 'dt', 'hold', 'labs', 'mgr', 'fdn'];
  return (
    <>
      <div className="pw">
        <div className="pw-r pw-h">
          <span />
          {COVER_K.map((k, __k) => (
            <span key={__k}>{k}</span>
          ))}
        </div>
        {ids.map((id, __k) => (
          <div key={__k} className="pw-r">
            <span className="pw-k">
              <span className="pw-lg">{entOf(id)[1]}</span>
              <span className="pw-sh">
                {
                  {
                    coop: 'Co-op',
                    fin: 'Financial',
                    dt: 'D&T Co.',
                    hold: 'Holdings',
                    labs: 'ClearLabs',
                    mgr: 'Manager',
                    fdn: 'Foundation',
                  }[id]
                }
              </span>
            </span>
            {COVER[id].map((s, i) => (
              <i key={i} className={`pt ${s}`} title={`${COVER_K[i]}: ${CV[s][1]}`}>
                {s === 'm' ? 'Missing' : s === 'd' ? 'Draft' : ''}
              </i>
            ))}
          </div>
        ))}
      </div>
      {mkey(['f', 'd', 'm', 'n'].map((k) => [CV[k][0], CV[k][1]]))}
    </>
  );
}

/* squarified treemap, in percent of a box */
export function treemap(items, W = 100, H = 62) {
  items = items.slice().sort((a, b) => b.v - a.v);
  const tot = items.reduce((a, b) => a + b.v, 0),
    out = [];
  let x = 0,
    y = 0,
    w = W,
    h = H,
    row = [],
    area = (it) => (it.v / tot) * W * H;
  const worst = (r, side) => {
    const s = r.reduce((a, b) => a + area(b), 0);
    return Math.max(...r.map((it) => Math.max((side * side * area(it)) / (s * s), (s * s) / (side * side * area(it)))));
  };
  const lay = (r) => {
    const s = r.reduce((a, b) => a + area(b), 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      r.forEach((it) => {
        const ch = area(it) / cw;
        out.push({
          ...it,
          x,
          y: cy,
          w: cw,
          h: ch,
        });
        cy += ch;
      });
      x += cw;
      w -= cw;
    } else {
      const ch = s / w;
      let cx = x;
      r.forEach((it) => {
        const cw = area(it) / ch;
        out.push({
          ...it,
          x: cx,
          y,
          w: cw,
          h: ch,
        });
        cx += cw;
      });
      y += ch;
      h -= ch;
    }
  };
  items.forEach((it) => {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, it], side) <= worst(row, side)) row.push(it);
    else {
      lay(row);
      row = [it];
    }
  });
  if (row.length) lay(row);
  return (
    <div className="tm" style={css(`aspect-ratio:${W}/${H}`)}>
      {out.map((r, __k) => {
        const st = DSTATE_N[r.k];
        return (
          <button
            key={__k}
            type="button"
            className="tm-c"
            data-rdf={r.k}
            style={css(`left:${(r.x / W) * 100}%;top:${(r.y / H) * 100}%;width:${(r.w / W) * 100}%;height:${(r.h / H) * 100}%;--c:${DT[r.k][1]}`)}
          >
            <b>{DT[r.k][0]}</b>
            <span className="num">{r.v}</span>
            {st[1] || st[2] ? (
              <em>
                {st[1] ? st[1] + ' draft' : ''}
                {st[1] && st[2] ? ' · ' : ''}
                {st[2] ? st[2] + ' waiting' : ''}
              </em>
            ) : (
              ''
            )}
          </button>
        );
      })}
    </div>
  );
}
export function heat() {
  const r = rng(77),
    days = 84,
    start = TODAY - 83 * DAY;
  const v = Array.from(
    {
      length: days,
    },
    (_, i) => {
      const d = new Date(start + i * DAY).getUTCDay(),
        we = d === 0 || d === 6;
      const ramp = 0.35 + i / days;
      return Math.round((we ? 2 : 9) * ramp + r() * (we ? 3 : 8));
    },
  );
  const max = Math.max(...v),
    first = new Date(start).getUTCDay();
  const weeks = Math.ceil((days + ((first + 6) % 7)) / 7);
  const cells = Array.from(
    {
      length: weeks * 7,
    },
    (_, k) => {
      const i = k - ((first + 6) % 7);
      if (i < 0 || i >= days) return <i key={k} className="hx-c off" />;
      const t = start + i * DAY;
      return <i key={k} className={`hx-c${t === TODAY ? ' today' : ''}`} style={css(`--v:${v[i] / max}`)} title={`${fmtD(t)} · ${v[i]} actions`} />;
    },
  );
  const mlabels = Array.from(
    {
      length: weeks,
    },
    (_, wk) => {
      const t = start + (wk * 7 - ((first + 6) % 7)) * DAY;
      const d = new Date(t);
      return d.getUTCDate() <= 7 ? (
        <span key={wk} style={css(`grid-column:${wk + 1}`)}>
          {MON[d.getUTCMonth()]}
        </span>
      ) : (
        ''
      );
    },
  );
  return {
    html: (
      <>
        <div className="hx" style={css(`--wk:${weeks}`)}>
          <div className="hx-m">{mlabels}</div>
          <div className="hx-d">
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
            <span>Sun</span>
          </div>
          <div className="hx-g">{cells}</div>
        </div>
        <div className="mkey hx-k">
          <span>Fewer</span>
          {[0.1, 0.35, 0.6, 0.85, 1].map((x, __k) => (
            <i key={__k} className="hx-c" style={css(`--v:${x}`)} />
          ))}
          <span>More</span>
        </div>
      </>
    ),
    total: v.reduce((a, b) => a + b, 0),
    last30: v.slice(-30).reduce((a, b) => a + b, 0),
    max,
    quiet: v.filter((x) => x < 4).length,
  };
}

/* ── page ─────────────────────────────────────────────────────────────── */
export function recordsPage() {
  const P = RS.pane,
    gaps = Object.values(COVER)
      .flat()
      .filter((x) => x === 'm').length;
  const title =
    P === 'overview'
      ? `${gaps} documents are missing.`
      : P === 'docs'
        ? `${Object.values(DCOUNT).reduce((a, b) => a + b, 0)} documents on file.`
        : `${LOG.filter((l) => l[1] >= H2(10, 15, 0)).length + WEEK.length} actions logged this week.`;
  const tools = (
    <button className="btn btn-p" type="button" data-rflow="upload">
      <span className="dot pulse" style={css('color:var(--btn-dot)')} aria-hidden="true" />
      Add a document
    </button>
  );
  const tabs = [
    ['overview', 'Overview'],
    ['docs', 'Documents'],
    ['log', 'Audit log'],
  ];
  const body = {
    overview: rOverview,
    docs: rDocs,
    log: rLog,
  }[P]();
  return (
    <>
      {head(
        <>
          {'Records · '}
          <b>Kept seven years</b>
        </>,
        title,
        tools,
      )}
      <nav className="ptabs" aria-label="Records panes">
        {tabs.map(([v, t], __k) => (
          <button key={__k} type="button" data-rpane={v} aria-current={P === v ? 'page' : 'false'}>
            {t}
          </button>
        ))}
      </nav>
      {body}
      {recordsPane()}
    </>
  );
}
export function coverCell(span) {
  const all = Object.values(COVER).flat(),
    f = all.filter((x) => x === 'f').length,
    need = all.filter((x) => x !== 'n').length;
  return (
    <section className={`cell ${span}`}>
      <header className="c-hd">
        <span className="lbl">Paperwork by entity</span>
        <span className="tag">What each one must keep</span>
      </header>
      <div className="c-fig">
        {figHtml(
          `${f} of ${need}`,
          `required papers on file · ${all.filter((x) => x === 'm').length} missing, ${all.filter((x) => x === 'd').length} in draft`,
        )}
      </div>
      <div className="c-body">{coverMatrix()}</div>
      <div className="c-ft split">
        <button type="button" data-ent-go="dt">
          <span className="t">The Deed & Title Co. is missing two</span>
          {ic('chev', 'sm')}
        </button>
        <span className="rule" aria-hidden="true" />
        <button type="button" data-rflow="upload">
          <span className="t">Add what’s missing</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
}
export function weekCell(span) {
  const n = LOG.filter((l) => l[1] >= H2(10, 15, 0)).length + WEEK.length;
  return (
    <section className={`cell ${span}`}>
      <header className="c-hd">
        <span className="lbl">This week</span>
        <span className="tag">15 – 21 Oct</span>
      </header>
      <div className="c-fig">{figHtml(String(n), 'actions by the team and the system · select a day to see what happened')}</div>
      <div className="c-body start">
        {weekLanes()}
        <div className="mkey">
          <span>
            <i className="wk-scale">
              <i />
              <i />
              <i />
              <i />
            </i>
            Fewer to more actions
          </span>
          <span>
            <i className="wk-keysw" />
            Key action that day
          </span>
        </div>
      </div>
      <div className="c-ft">
        <button type="button" data-rpane="log">
          <span className="t">The full log</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
}
export function kindCell(span) {
  const from = H2(10, 15, 0),
    order = Object.keys(AREAS);
  const by = order.map((a) => [a, WEEK.filter((e) => e[2] === a).length + LOG.filter((l) => l[3] === a && l[1] >= from).length]).sort((x, y) => y[1] - x[1]);
  const max = by[0][1],
    tot = by.reduce((a, b) => a + b[1], 0);
  return (
    <section className={`cell ${span}`}>
      <header className="c-hd">
        <span className="lbl">Kind of work</span>
        <span className="tag">This week</span>
      </header>
      <div className="c-fig">{figHtml(AREAS[by[0][0]][0], `the biggest share · ${pct(by[0][1], tot)} of this week’s actions`)}</div>
      <div className="c-body start">
        <div className="kw">
          {by.map(([a, v], __k) => (
            <div key={__k} className="kw-r">
              <i className="kw-sw" style={css(areaDot(a))} />
              <span className="kw-k">{AREAS[a][0]}</span>
              <span className="kw-b">
                <i style={css(`width:${((v / max) * 100).toFixed(1)}%;${areaDot(a)}`)} />
              </span>
              <b className="num">{v}</b>
            </div>
          ))}
        </div>
      </div>
      {strip([
        ['Alerts', String(by.find((x) => x[0] === 'alert')[1]), '', 'warn'],
        ['By the system', String(WEEK.filter((e) => e[1] === 'SY').length + LOG.filter((l) => l[2] === 'SY' && l[1] >= from).length)],
      ])}
    </section>
  );
}
export function keyCell(span) {
  return (
    <section className={`cell ${span}`}>
      <header className="c-hd">
        <span className="lbl">Key actions</span>
        <span className="tag">Newest first</span>
      </header>
      <div className="c-fig">
        {figHtml(
          String(LOG.filter((l) => l[1] >= TODAY).length),
          `key actions today · ${LOG.filter((l) => l[7] === 'waiting').length} still waiting on someone`,
        )}
      </div>
      <div className="c-body start">
        <div className="pn-list">
          {LOG.slice(0, 6).map((l, __k) => (
            <button key={__k} type="button" className="pn-r ka-r" data-rflow="entry" data-rid={l[0]}>
              <span className="ev-d">{fmtD(l[1])}</span>
              <i className="dt-ic" style={css(areaDot(l[3]))} />
              <span className="pn-k">
                <b>{l[4]}</b>
                <span className="small quiet">
                  {WHO.find((w) => w[0] === l[2])[1]}
                  {' · '}
                  {l[6]}
                </span>
              </span>
              <span className={`chip ${RESULT[l[7]][0]}`}>{RESULT[l[7]][1]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="c-ft">
        <button type="button" data-rpane="log">
          <span className="t">
            {'All '}
            {LOG.length}
            {' key actions'}
          </span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
}
export function rOverview() {
  const appr = gCell(
    's-4 wt',
    'Two-person rule',
    'Who approves whom',
    figHtml('20', 'approvals in 30 days · nobody approved their own'),
    apprMatrix(),
    strip([
      ['Waiting', '3'],
      ['Self-approved', 'None'],
    ]),
  );
  const tm = gCell(
    's-5',
    'What’s on file',
    'By kind',
    figHtml(
      String(Object.values(DCOUNT).reduce((a, b) => a + b, 0)),
      `documents · ${Object.values(DSTATE_N).reduce((a, b) => a + b[1], 0)} drafts and ${Object.values(DSTATE_N).reduce((a, b) => a + b[2], 0)} signature waiting`,
    ),
    treemap(
      Object.entries(DCOUNT).map(([k, v]) => ({
        k,
        v,
      })),
    ),
    <div className="c-ft">
      <button type="button" data-rpane="docs">
        <span className="t">Every document</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  return (
    <>
      {G(
        'Activity',
        'Logged as it happens · nothing here can be edited',
        '',
        <>
          {weekCell('s-8')}
          {kindCell('s-4 wt')}
        </>,
      )}
      {G(
        'Approvals',
        '',
        '',
        <>
          {keyCell('s-7')}
          {swapClass(appr, 'cell s-4 wt', 'cell s-5')}
        </>,
      )}
      {G(
        'Documents',
        '',
        '',
        <>
          {coverCell('s-7')}
          {tm}
        </>,
      )}
    </>
  );
}
export function rDocs() {
  const tm = gCell(
    's-5',
    'What’s on file',
    'Select a kind to filter',
    figHtml(String(Object.values(DCOUNT).reduce((a, b) => a + b, 0)), 'documents across 7 entities'),
    treemap(
      Object.entries(DCOUNT).map(([k, v]) => ({
        k,
        v,
      })),
    ),
    strip([
      ['Signed or final', String(Object.values(DSTATE_N).reduce((a, b) => a + b[0], 0))],
      ['Drafts', '5'],
      ['Waiting', '1'],
    ]),
  );
  /* documents by date: one row per kind, months as columns, status as the mark */
  const from = D(6, 1),
    to = D(11, 1),
    kinds = Object.keys(DT),
    X = (t) => pctX(t, from, to),
    tX = X(NOW);
  const months = [6, 7, 8, 9, 10].map((m) => [D(m, 1), D(m + 1, 1), MON[m - 1]]);
  const grid = (
    <span className="dlx-bg">
      {months.map(([a, b], i) => (
        <i key={i} className={a <= NOW && NOW < b ? 'cur' : ''} style={css(`left:${X(a)}%;width:${X(b) - X(a)}%`)} />
      ))}
      <em style={css(`left:${tX}%`)} />
    </span>
  );
  const rows = kinds.map((k, __k) => {
    const ds = DOCS.filter((d) => d[2] === k && d[4] >= from).sort((a, b) => a[4] - b[4]);
    let prev = -1e15,
      up = false;
    const marks = ds.map((d, __k) => {
      up = d[4] - prev < 6 * DAY ? !up : false;
      prev = d[4];
      return (
        <button
          key={__k}
          type="button"
          className={`dlx-m ${d[5]}${up ? ' up' : ''}`}
          data-doc={d[0]}
          title={`${d[1]} · ${fmtD(d[4])}`}
          style={css(`left:${X(d[4])}%`)}
        />
      );
    });
    const last = ds.length ? fmtD(ds[ds.length - 1][4]) : '—';
    return (
      <div key={__k} className="dlx-r">
        <button type="button" className="dlx-k" data-rdf={k} title={`Show only ${DT[k][0].toLowerCase()}`}>
          <i style={css(`background:${DT[k][1]}`)} />
          <span>
            <b>{DT[k][0]}</b>
            <span>
              {DCOUNT[k]}
              {' on file'}
            </span>
          </span>
        </button>
        <span className="dlx-t">
          {grid}
          {marks}
        </span>
        <span className="dlx-l">{last}</span>
      </div>
    );
  });
  const paper = (
    <div className="dlx">
      <div className="dlx-r dlx-h">
        <span>Kind</span>
        <span className="dlx-t">
          {months.map(([a, b, n], __k) => (
            <b key={__k} style={css(`left:${(X(a) + X(b)) / 2}%`)}>
              {n}
            </b>
          ))}
        </span>
        <span>Latest</span>
      </div>
      {rows}
      <div className="dlx-r dlx-f">
        <span />
        <span className="dlx-t">
          <b style={css(`left:${tX}%`)}>
            {'Today · '}
            {fmtD(NOW)}
          </b>
        </span>
        <span />
      </div>
    </div>
  );
  const lanes = (
    <section className="cell s-7">
      <header className="c-hd">
        <span className="lbl">Recent papers</span>
        <span className="tag">Jun – Oct</span>
      </header>
      <div className="c-fig">{figHtml(String(DOCS.filter((d) => d[4] >= D(10, 1)).length), 'papers added in October · select one to open it')}</div>
      <div className="c-body">
        {paper}
        <div className="mkey">
          <span>
            <i className="sw" style={css('background:var(--fg)')} />
            Signed or final
          </span>
          <span>
            <i className="sw" style={css('background:var(--ground);box-shadow:inset 0 0 0 1.5px var(--underway)')} />
            Draft
          </span>
          <span>
            <i className="sw" style={css('background:var(--ground);box-shadow:inset 0 0 0 1.5px var(--live)')} />
            Waiting on you
          </span>
        </div>
      </div>
      {strip([
        ['Added in Oct', String(DOCS.filter((d) => d[4] >= D(10, 1)).length)],
        ['Drafts', String(Object.values(DSTATE_N).reduce((a, b) => a + b[1], 0)), '', 'warn'],
        ['Waiting on you', String(Object.values(DSTATE_N).reduce((a, b) => a + b[2], 0))],
      ])}
    </section>
  );
  const opts = [['all', 'All', DOCS.length], ...Object.keys(DT).map((k) => [k, DT[k][0], DOCS.filter((d) => d[2] === k).length])];
  const list = DOCS.filter((d) => RS.df === 'all' || d[2] === RS.df).sort((a, b) => b[4] - a[4]);
  const tbl = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">{RS.df === 'all' ? 'Newest first' : DT[RS.df][0] + ' · newest first'}</span>
        <span className="hd-tools">{ddHtml('rdf', opts, RS.df, 'Show')}</span>
      </header>
      <div className="c-fig" />
      <div className="c-body flush">
        <div className="tbl-wrap">
          <table className="tbl compact">
            <thead>
              <tr>
                <th className="l">Document</th>
                <th className="l">Kind</th>
                <th className="l">Entity</th>
                <th className="l">Added</th>
                <th className="l">Version</th>
                <th className="l">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d, __k) => (
                <tr key={__k} className="click" data-doc={d[0]} tabIndex="0">
                  <td className="l">
                    <span className="dt-row">
                      <i className="dt-ic" style={css(`--c:${DT[d[2]][1]}`)} />
                      <span>
                        <b>{d[1]}</b>
                        <span className="quiet small">
                          {d[7]}
                          {' · '}
                          {d[8]}
                          {' pages'}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="l">{DT[d[2]][0]}</td>
                  <td className="l">{entOf(d[3])[1]}</td>
                  <td className="l">{fmtD(d[4])}</td>
                  <td className="l mono">{d[6]}</td>
                  <td className="l">
                    <span className={`chip ${DSTAT[d[5]][0]}`}>{DSTAT[d[5]][1]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div />
    </section>
  );
  return (
    <>
      {G(
        'Shelf',
        '',
        '',
        <>
          {lanes}
          {tm}
        </>,
      )}
      {G('Coverage', '', '', coverCell('s-12'))}
      {G('Every document', 'Latest 15 shown · search finds the rest', '', tbl)}
    </>
  );
}
export function rLog() {
  const h = heat();
  const hc = (
    <section className="cell s-8">
      <header className="c-hd">
        <span className="lbl">Every day</span>
        <span className="tag">12 weeks</span>
      </header>
      <div className="c-fig">{figHtml(String(h.last30), 'actions in the last 30 days · busier every week since the first batch')}</div>
      <div className="c-body">{h.html}</div>
      {strip([
        ['12 weeks', String(h.total)],
        ['Busiest day', String(h.max)],
        ['Quiet days', String(h.quiet), 'mostly weekends'],
      ])}
    </section>
  );
  const byArea = Object.keys(AREAS)
    .map((a) => [a, WEEK.filter((e) => e[2] === a).length + LOG.filter((l) => l[3] === a).length])
    .sort((x, y) => y[1] - x[1]);
  const areas = gCell(
    's-4 wt',
    'By area',
    'This week',
    figHtml(AREAS[byArea[0][0]][0], `the busiest area · ${byArea[0][1]} actions`),
    <div className="hbars">
      {byArea.map(([a, v], __k) => (
        <div key={__k} className="hb">
          <span className="hb-k">{AREAS[a][0]}</span>
          <span className="hb-bar">
            <i style={css(`width:${(v / byArea[0][1]) * 100}%;${areaDot(a)}`)} />
          </span>
          <b className="num">{v}</b>
        </div>
      ))}
    </div>,
    strip([
      ['Alerts', String(LOG.filter((l) => l[3] === 'alert').length)],
      ['By the system', String(WEEK.filter((e) => e[1] === 'SY').length + LOG.filter((l) => l[2] === 'SY').length)],
    ]),
  );
  const opts = [['all', 'Everything', LOG.length], ...Object.keys(AREAS).map((a) => [a, AREAS[a][0], LOG.filter((l) => l[3] === a).length])];
  const list = LOG.filter((l) => RS.lf === 'all' || l[3] === RS.lf);
  const tbl = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">{RS.lf === 'all' ? 'Key actions, newest first' : AREAS[RS.lf][0] + ', newest first'}</span>
        <span className="hd-tools">{ddHtml('rlf', opts, RS.lf, 'Show')}</span>
      </header>
      <div className="c-fig" />
      <div className="c-body flush">
        <div className="tbl-wrap">
          <table className="tbl compact">
            <thead>
              <tr>
                <th className="l">When</th>
                <th className="l">Who</th>
                <th className="l">What</th>
                <th className="l">From</th>
                <th className="l">Result</th>
              </tr>
            </thead>
            <tbody>
              {list.map((l, __k) => (
                <tr key={__k} className="click" data-rentry={l[0]} tabIndex="0">
                  <td className="l mono">
                    {fmtD(l[1])} {new Date(l[1]).toISOString().slice(11, 16)}
                  </td>
                  <td className="l">
                    <span className="who">
                      <i className={`sg-sq${l[2] === 'K' ? ' me' : ''}`}>{l[2]}</i>
                      {WHO.find((w) => w[0] === l[2])[1]}
                    </span>
                  </td>
                  <td className="l">
                    <span className="dt-row">
                      <i className="dt-ic" style={css(areaDot(l[3]))} />
                      <span>
                        <b>{l[4]}</b>
                        <span className="quiet small">
                          {AREAS[l[3]][0]}
                          {l[8] ? ' · ' + l[8] : ''}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="l quiet">{l[6]}</td>
                  <td className="l">
                    <span className={`chip ${RESULT[l[7]][0]}`}>{RESULT[l[7]][1]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div />
    </section>
  );
  const si = gCell(
    's-6',
    'Sign-ins',
    'Last 7 days',
    figHtml('1', 'new device this week · Marcus Lee’s iPhone, confirmed by Kai'),
    <div className="si">
      {SIGNIN.map(([k, n, dev, days, last, flag], __k) => (
        <div key={__k} className="si-r">
          <i className={`sg-sq${k === 'K' ? ' me' : ''}`}>{k}</i>
          <span className="si-k">
            <b>{n}</b>
            <span className="small quiet">
              {dev}
              {flag ? (
                <>
                  {' · '}
                  <em>{flag}</em>
                </>
              ) : (
                ''
              )}
            </span>
          </span>
          <span className="si-p">
            {days.map((v, __k) => (
              <i key={__k} style={css(`height:${6 + v * 6}px`)} />
            ))}
          </span>
          <span className="small quiet">{last}</span>
        </div>
      ))}
    </div>,
    <div className="c-ft">
      <button type="button" data-rflow="signout">
        <span className="t">Sign someone out everywhere</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  return (
    <>
      {G(
        'Activity',
        '',
        '',
        <>
          {hc}
          {areas}
        </>,
      )}
      {G('By person and day', '', '', weekCell('s-12'))}
      {G('Log', 'Who, when and from where · entries can’t be edited', '', tbl)}
      {G(
        'People',
        '',
        '',
        <>
          {si}
          {gCell(
            's-6',
            'Who did what',
            'This week',
            figHtml('Marcus Lee', 'the most actions this week · nearly all in shops and the field'),
            <>
              {byPerson()}
              {areaKey(true)}
            </>,
            strip([
              ['Team', String(WEEK.filter((e) => e[1] !== 'SY').length + LOG.filter((l) => l[2] !== 'SY' && l[1] >= H2(10, 15, 0)).length)],
              ['System', String(WEEK.filter((e) => e[1] === 'SY').length + LOG.filter((l) => l[2] === 'SY' && l[1] >= H2(10, 15, 0)).length)],
            ]),
          )}
        </>,
      )}
    </>
  );
}

/* ── document panel ───────────────────────────────────────────────────── */
export function recordsPane() {
  if (!RS.doc) return '';
  const d = docOf(RS.doc);
  if (!d) return '';
  const lines = Array.from(
    {
      length: 12,
    },
    (_, i) => <i key={i} style={css(`width:${[92, 88, 95, 70, 90, 84, 93, 60, 0, 88, 76, 40][i]}%`)} />,
  );
  const preview = (
    <div className="dpv">
      <div className="dpv-pg">
        <span className="dpv-t">{d[1].split(' · ')[0]}</span>
        <span className="dpv-s">{d[1].split(' · ')[1] || entOf(d[3])[1]}</span>
        <div className="dpv-l">{lines}</div>
        <div className="dpv-sig">
          {d[7].split(' · ').map((s, __k) => (
            <span key={__k}>
              <i />
              {s}
            </span>
          ))}
        </div>
      </div>
      <div className="dpv-pg back" />
    </div>
  );
  const vers = d[6].startsWith('v0')
    ? [
        ['v0.1', 1],
        [d[6], 2],
        ['v1.0', 0],
      ]
    : d[6] === 'v1.2'
      ? [
          ['v1.0', 1],
          ['v1.1', 1],
          ['v1.2', 2],
        ]
      : d[6] === 'v1.1'
        ? [
            ['v1.0', 1],
            ['v1.1', 2],
          ]
        : [[d[6], 2]];
  const access = [
    ['Kai', 'Opened', 'Today 08:12'],
    ['Dana Ruiz', 'Opened', 'Yesterday'],
    ['Kai', 'Added', fmtD(d[4])],
  ];
  const body = (
    <>
      {preview}
      <div>
        <p className="h2" style={css('font-size:24px')}>
          {d[1]}
        </p>
        <p className="quiet" style={css('margin:8px 0 0')}>
          {DONE1[d[2]]}
          {' · '}
          {entOf(d[3])[1]}
          {' · '}
          {d[8]}
          {' pages'}
        </p>
      </div>
      {sec('Versions', vizTrack(vers))}
      {sec(
        'Facts',
        kv([
          ['Added', fmtD(d[4]) + ' 2026'],
          ['By', d[7]],
          ['Fingerprint', <span className="mono">sha256 9f2c…a41e</span>],
          ['Stored', 'Two copies, encrypted'],
          ['Kept until', fmtD(d[4]) + ' 2033', 1],
        ]),
      )}
      {sec(
        'Who has opened it',
        <div className="pn-list">
          {access.map(([w, a, t], __k) => (
            <div key={__k} className="pn-r two">
              <span className="pn-k">
                <b>{w}</b>
                <span className="small quiet">{a}</span>
              </span>
              <span className="small quiet">{t}</span>
            </div>
          ))}
        </div>,
      )}
    </>
  );
  const foot =
    d[5] === 'waiting' ? (
      <>
        <button className="btn btn-p" type="button" data-cflow="esign" data-cid="icw">
          Sign in your e-signature tool{ic('out')}
        </button>
        <button className="btn btn-g" type="button" data-rflow="download" data-rid={d[0]}>
          Download
        </button>
      </>
    ) : d[5] === 'draft' ? (
      <>
        <button className="btn btn-p" type="button" data-rflow="version" data-rid={d[0]}>
          Add a new version
        </button>
        <button className="btn btn-g" type="button" data-rflow="download" data-rid={d[0]}>
          Download
        </button>
      </>
    ) : (
      <>
        <button className="btn btn-p" type="button" data-rflow="share" data-rid={d[0]}>
          Share a link
        </button>
        <button className="btn btn-g" type="button" data-rflow="download" data-rid={d[0]}>
          Download
        </button>
      </>
    );
  return (
    <>
      <div className="pane-scrim" data-closerpane="" />
      <aside className="pane" role="dialog" aria-label="Document">
        <header className="m-hd">
          <span className="sub">Document</span>
          <span style={css('display:flex;align-items:center;gap:8px')}>
            <span className={`chip ${DSTAT[d[5]][0]}`}>{DSTAT[d[5]][1]}</span>
            <button className="x" type="button" data-closerpane="" aria-label="Close">
              {ic('close')}
            </button>
          </span>
        </header>
        <div className="pane-mn">{body}</div>
        <footer className="pane-ft">{foot}</footer>
      </aside>
    </>
  );
}

/* ── modals ───────────────────────────────────────────────────────────── */
export function openRFlow(kind, id) {
  vars.lastFocus = document.activeElement;
  const d = id ? docOf(id) : null,
    l = id ? logOf(id) : null;
  let f = null;
  if (kind === 'day') {
    const [w, di] = id.split('|'),
      t = H2(10, 15 + +di, 0),
      e = t + DAY,
      who = WHO.find((x) => x[0] === w)[1];
    const keys = LOG.filter((x) => x[2] === w && x[1] >= t && x[1] < e).sort((a, b) => a[1] - b[1]),
      evs = WEEK.filter((x) => x[1] === w && x[0] >= t && x[0] < e);
    const order = Object.keys(AREAS),
      mix = order.map((a) => [a, evs.filter((x) => x[2] === a).length]).filter((x) => x[1]);
    f = {
      t: 'Day log',
      lbl: `${who} · ${fmtD(t)}`,
      h: `${keys.length + evs.length} actions`,
      p: keys.length ? `${keys.length} worth a look, ${evs.length} routine.` : 'All routine.',
      pre: (
        <>
          {keys.length ? (
            <div className="pn-list">
              {keys.map((x, __k) => (
                <button key={__k} type="button" className="pn-r" data-rflow="entry" data-rid={x[0]}>
                  <span className="ev-d">{new Date(x[1]).toISOString().slice(11, 16)}</span>
                  <span className="pn-k">
                    <b>{x[4]}</b>
                    <span className="small quiet">
                      {AREAS[x[3]][0]}
                      {' · '}
                      {x[6]}
                    </span>
                  </span>
                  <span className={`chip ${RESULT[x[7]][0]}`}>{RESULT[x[7]][1]}</span>
                </button>
              ))}
            </div>
          ) : (
            ''
          )}
          <div className="ablock">
            <span className="lbl">Routine actions by area</span>
            {compBar(mix.map(([a, v]) => [AREAS[a][0], v, AREAS[a][1] === 'gov' ? 'var(--fg-50)' : AREAS[a][1], String(v)]))}
          </div>
        </>
      ),
      btn: null,
      foot: 'Every action is in the audit log',
    };
  } else if (kind === 'entry' && l) {
    const who = WHO.find((w) => w[0] === l[2])[1];
    f = {
      t: 'Log entry',
      lbl: `${fmtD(l[1])} · ${new Date(l[1]).toISOString().slice(11, 16)} · ${AREAS[l[3]][0]}`,
      h: l[4],
      p: l[5],
      rows: [
        ['Who', who],
        ['From', l[6]],
        ['Result', RESULT[l[7]][1]],
        ['Second person', l[8] || 'Not needed'],
        [
          'Entry',
          <span className="mono">
            #{48210 + LOG.indexOf(l)}
            {' · sealed'}
          </span>,
          1,
        ],
      ],
      note: (
        <>
          <b>Entries can’t be edited or deleted.</b>
          {' A correction is a new entry that points to this one.'}
        </>
      ),
      noteIc: 'check',
      btn: null,
    };
  } else if (kind === 'download' && d) {
    f = {
      t: 'Download',
      h: d[1],
      rows: [
        ['Copy', 'Watermarked with your name and today’s date'],
        ['Format', 'PDF'],
        ['Logged', 'Yes, in the audit log', 1],
      ],
      btn: 'Download',
      ext: 1,
      steps: ['Prepared a watermarked copy', 'Logged the download'],
      done: ['Downloading.', 'It’s in the audit log.'],
    };
  } else if (kind === 'share' && d) {
    f = {
      t: 'Share a link',
      h: d[1],
      post: (
        <>
          <span className="lbl">Link lasts</span>
          <div className="seg2" role="group" aria-label="Expiry">
            {['1 day', '7 days', '30 days'].map((x, i) => (
              <button key={i} type="button" aria-pressed={i === 1}>
                {x}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="lbl">Who it’s for</span>
            <input type="text" defaultValue="accountant@" autoComplete="off" />
          </label>
        </>
      ),
      rows: [
        ['They can', 'View only, no download'],
        ['Logged', 'Every open', 1],
      ],
      btn: 'Make the link',
      steps: ['Made a view-only link', 'Set it to expire in 7 days', 'Logged who it’s for'],
      done: ['Link ready.', 'Copied to your clipboard. It stops working in 7 days.'],
    };
  } else if (kind === 'version' && d) {
    f = {
      t: 'Add a new version',
      h: d[1],
      post: (
        <label className="field">
          <span className="lbl">What changed</span>
          <input type="text" defaultValue="Board edits from 4 Nov" autoComplete="off" />
        </label>
      ),
      rows: [
        ['Now', d[6]],
        ['Becomes', d[6].replace(/\.(\d)$/, (m, n) => '.' + (+n + 1))],
        ['Old version', 'Kept, never replaced', 1],
      ],
      btn: 'Add it',
      after: () => {
        d[6] = d[6].replace(/\.(\d)$/, (m, n) => '.' + (+n + 1));
      },
      steps: ['Uploaded the new version', 'Fingerprinted it', 'Kept the old one'],
      done: ['New version added.', 'Both versions stay on file.'],
    };
  } else if (kind === 'upload') {
    f = {
      t: 'Add a document',
      h: 'A new document',
      post: (
        <>
          <span className="lbl">Kind</span>
          <div className="seg2" role="group" aria-label="Kind">
            {Object.keys(DT).map((k, i) => (
              <button key={i} type="button" aria-pressed={i === 2}>
                {DONE1[k]}
              </button>
            ))}
          </div>
          <span className="lbl">Entity</span>
          <div className="seg2" role="group" aria-label="Entity">
            {['coop', 'fin', 'dt', 'hold', 'labs', 'mgr'].map((e, __k) => (
              <button key={__k} type="button" aria-pressed={e === 'dt'}>
                {RPN[e] || entOf(e)[1]}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="lbl">File</span>
            <input id="ru-name" type="text" defaultValue="EIN letter · The Deed & Title Co..pdf" autoComplete="off" />
          </label>
        </>
      ),
      rows: [
        ['Kept', 'Seven years'],
        ['Logged', 'Yes', 1],
      ],
      btn: 'Add it',
      after: () => {
        COVER.dt[2] = 'f';
        DCOUNT.filing++;
        DOCS.unshift(['d' + (DOCS.length + 1), 'EIN letter · The Deed & Title Co.', 'filing', 'dt', NOW, 'filed', 'v1.0', 'Kai', 1]);
      },
      steps: ['Uploaded it', 'Fingerprinted it', 'Filed it under The Deed & Title Co.'],
      done: ['Added.', 'It counts toward the paperwork for that entity.'],
    };
  } else if (kind === 'signout') {
    f = {
      t: 'Sign someone out everywhere',
      h: 'Pick a person',
      post: (
        <div className="seg2" role="group" aria-label="Person">
          {LIVE
            ? PEOPLE_T.filter((p) => p.id !== vars.meId && !p.off).map((p, i) => (
                <button key={p.id} type="button" data-pid={p.id} aria-pressed={i === 0}>
                  {p.n}
                </button>
              ))
            : ['Dana Ruiz', 'Marcus Lee'].map((x, i) => (
                <button key={i} type="button" aria-pressed={i === 1}>
                  {x}
                </button>
              ))}
        </div>
      ),
      rows: [
        ['Ends', 'Every session on every device'],
        ['They’ll need', 'To sign in again'],
        ['Logged', 'Yes', 1],
      ],
      btn: 'Sign them out',
      api: () => {
        const b = document.querySelector('.modal .seg2 [aria-pressed="true"]');
        if (!b?.dataset.pid) return Promise.reject(new Error('Pick someone first'));
        return live.teamChange(f, () => live.signOutEverywhere(b.dataset.pid));
      },
      steps: ['Ended every session', 'Logged it'],
      done: ['Signed out.', 'They can sign back in with their own passkey.'],
    };
  }
  if (!f) return;
  vModal(f, 'r:' + kind);
  openRFlow.f = f;
}

/* ══ Team ═══════════════════════════════════════════════════════════════
   Who can see and do what. Ties: Records (sign-ins, the two-person grid, the log), Contracts (the Ops Safe,
   2 of 3: Kai, Dana Ruiz, the board signer), Money (PayoutPool top-up waiting on a second person). */
