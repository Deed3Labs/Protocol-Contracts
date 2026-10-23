// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { Fragment } from 'react';
import { css } from '../runtime/dom';
import { footItem, head, ic } from './core';
import { AGR, AGR_T, AST, CH, CH_DONE, CS, CTR, DAY, EDGES, LAYERS, MON, NOW, PENDING, REL, RELEASES, RK, SIGNERS, SIGN_W, TXD, vars } from './data';
import { G, chart, columns, figHtml, fmtD, gCell, px } from './growth';
import { mkey, vizTrack } from './home';
import { ddHtml } from './kit';
import { evRows, strip } from './money';
import { modalShell, onKey } from './shell';
export function D(m, d, y = 2026, h = 0) {
  return Date.UTC(y, m - 1, d, h);
}
export function agrOf(id) {
  return AGR.find((a) => a.id === id);
}
export function acnt(f) {
  return AGR.filter(f).length;
}
export function ctrOf(id) {
  return CTR.find((c) => c[0] === id);
}
/* projected, once you sign */
/* changes: events drawn on a lane. seg: done | open | proj | wait | block. mark: draft | check | sign | live | due | auto */
export function H(m, d, h) {
  return D(m, d, 2026, h);
}
/* ── shared drawing ───────────────────────────────────────────────────── */
export function pctX(t, a, b) {
  return Math.max(0, Math.min(100, ((t - a) / (b - a)) * 100));
}
export function axisHtml(from, to, step) {
  /* step: 'month' | days */
  const out = [];
  if (step === 'month') {
    const d = new Date(from);
    d.setUTCDate(1);
    if (d.getTime() < from) d.setUTCMonth(d.getUTCMonth() + 1);
    for (; d.getTime() <= to; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const m = d.getUTCMonth();
      out.push([d.getTime(), m === 0 ? `Jan ${String(d.getUTCFullYear()).slice(2)}` : MON[m]]);
    }
  } else for (let t = from; t <= to; t += step * DAY) out.push([t, fmtD(t)]);
  return out;
}
export function laneFrame(rows, from, to, step, cls) {
  /* label column + lanes, with month/day grid, today and the next-90-days shade */
  const ax = axisHtml(from, to, step),
    tX = pctX(NOW, from, to);
  return (
    <div className={`ln ${cls || ''}`}>
      <div className="ln-ax">
        <span />
        <span className="ln-axl">
          {ax.map(([t, l], __k) => (
            <span key={__k} style={css(`left:${pctX(t, from, to)}%`)}>
              {l}
            </span>
          ))}
          <span className="now" style={css(`left:${tX}%`)}>
            Today
          </span>
        </span>
      </div>
      <div className="ln-bd">
        <div className="ln-ov">
          {ax.map(([t], __k) => (
            <i key={__k} className="g" style={css(`left:${pctX(t, from, to)}%`)} />
          ))}
          <i className="t" style={css(`left:${tX}%`)} />
        </div>
        {rows}
      </div>
    </div>
  );
}

/* agreement terms as bars */
export function gantt(list, from, to, agg) {
  const tX = pctX(NOW, from, to);
  const row = (x) => {
    let lane = '';
    if (x.st === 'draft')
      lane = (
        <i className="gb-draft" style={css(`left:${tX}%`)}>
          {'Draft '}
          {x.ver}
        </i>
      );
    else if (x.st === 'out')
      lane = (
        <>
          <i className="gb out" style={css(`left:${pctX(x.sent, from, to)}%;width:${tX - pctX(x.sent, from, to)}%`)} />
          <i className="gb-tag live" style={css(`left:${tX}%`)}>
            Waiting on you
          </i>
        </>
      );
    else {
      const a = pctX(x.a, from, to),
        b = x.b ? pctX(x.b, from, to) : 100,
        soon = x.b && x.b - NOW < 90 * DAY;
      lane = (
        <>
          <i className={`gb${x.b ? '' : ' open'}${x.a < from ? ' cut' : ''}`} style={css(`left:${a}%;width:${b - a}%`)} />
          {x.b && x.b <= to ? (
            <>
              <i className={`gb-end${soon ? ' soon' : ''}`} style={css(`left:${b}%`)} />
              {soon ? (
                <i className="gb-tag" style={css(`left:${b}%`)}>
                  {fmtD(x.b)}
                </i>
              ) : (
                ''
              )}
            </>
          ) : (
            ''
          )}
        </>
      );
    }
    return (
      <button type="button" className="ln-r" data-agr={x.id}>
        <span className="ln-k">
          <b>{x.party}</b>
          <span>{x.name}</span>
        </span>
        <span className="ln-l">{lane}</span>
      </button>
    );
  };
  let rows = list.map(row);
  if (agg) {
    const ms = AGR.filter((x) => x.type === 'merchant' && x.a),
      s0 = Math.min(...ms.map((x) => x.a)),
      e0 = Math.min(...ms.map((x) => x.b)),
      e1 = Math.max(...ms.map((x) => x.b));
    rows = (
      <>
        {rows}
        <button type="button" className="ln-r agg" data-cpane="agreements">
          <span className="ln-k">
            <b>
              {ms.length + 1}
              {' merchant partners'}
            </b>
            <span>12-month terms</span>
          </span>
          <span className="ln-l">
            <i className="gb-band" style={css(`left:${pctX(s0, from, to)}%;width:${pctX(e1, from, to) - pctX(s0, from, to)}%`)} />
            {ms.map((x, __k) => (
              <Fragment key={__k}>
                <i className="gt-s" style={css(`left:${pctX(x.a, from, to)}%`)} />
                <i className="gt-e" style={css(`left:${pctX(x.b, from, to)}%`)} />
              </Fragment>
            ))}
            <i className="gb-brk" style={css(`left:${pctX(e0, from, to)}%;width:${pctX(e1, from, to) - pctX(e0, from, to)}%`)}>
              <span>
                {ms.length}
                {' renew '}
                {fmtD(e0)}
                {' – '}
                {fmtD(e1)}
              </span>
            </i>
          </span>
        </button>
      </>
    );
  }
  return laneFrame(rows, from, to, 'month', 'gt');
}

/* changes as signature lanes */
export function sigLanes(list, from, to, step) {
  const X = (t) => pctX(t, from, to),
    inW = (t) => t >= from && t <= to;
  const row = (r) => {
    const segs = r.ev
      .filter((e) => e[0] === 'seg')
      .map(([, k, a, b], __k) => <i key={__k} className={`sl-seg ${k}`} style={css(`left:${X(a)}%;width:${Math.max(0.4, X(b) - X(a))}%`)} />);
    const marks = r.ev
      .filter((e) => e[0] !== 'seg' && inW(e[1]))
      .map((e, __k) => {
        const [k, t, w, f] = e,
          l = X(t);
        return k === 'sign' ? (
          <i key={__k} className={`sl-sg${f ? ' me' : ''}`} style={css(`left:${l}%`)} title={w}>
            {w}
          </i>
        ) : k === 'due' ? (
          <i key={__k} className="sl-due" style={css(`left:${l}%`)}>
            <span>{w}</span>
          </i>
        ) : k === 'auto' ? (
          <i key={__k} className="sl-auto" style={css(`left:${l}%`)} />
        ) : (
          <i key={__k} className={`sl-${k}${f ? ' proj' : ''}`} style={css(`left:${l}%`)} />
        );
      });
    return (
      <button type="button" className="ln-r" data-cflow={r.flow || (r.mine ? 'sign' : 'view')} data-cid={r.id}>
        <span className="ln-k">
          <b>{r.t}</b>
          <span className={r.mine ? 'me' : ''}>{r.state}</span>
        </span>
        <span className="ln-l">
          {segs}
          {marks}
        </span>
      </button>
    );
  };
  return laneFrame(list.map(row), from, to, step, 'sl');
}
export function sigKey() {
  return (
    <div className="mkey sl-key">
      <span>
        <i className="k-sq h" />
        Drafted
      </span>
      <span>
        <i className="k-sq" />
        Checked
      </span>
      <span>
        <i className="k-sg">K</i>Signed
      </span>
      <span>
        <i className="k-wait" />
        24-hour wait
      </span>
      <span>
        <i className="k-sq f" />
        Live
      </span>
      <span>
        <i className="k-open" />
        Waiting on you
      </span>
    </div>
  );
}
/* the protocol, drawn */
export function protoMap() {
  const N = (id) => ctrOf(id),
    W = 15,
    HN = 3.0; /* node half-width and half-height, in % */
  /* fan lines out where several leave or meet the same side of a box, so they never stack */
  const fan = {},
    offA = [],
    offB = [];
  EDGES.forEach((e, i) => {
    const A = N(e[0]),
      B = N(e[1]);
    if (A[7] === B[7]) return;
    const fw = B[7] > A[7];
    (fan[e[0] + (fw ? 'R' : 'L')] = fan[e[0] + (fw ? 'R' : 'L')] || []).push([i, 'A', B[8]]);
    (fan[e[1] + (fw ? 'L' : 'R')] = fan[e[1] + (fw ? 'L' : 'R')] || []).push([i, 'B', A[8]]);
  });
  Object.values(fan).forEach((l) => {
    l.sort((x, y) => x[2] - y[2]);
    l.forEach(([i, w], j) => {
      const o = (j - (l.length - 1) / 2) * 1.5;
      (w === 'A' ? offA : offB)[i] = o;
    });
  });
  EDGES.forEach((e, i) => {
    const A = N(e[0]),
      B = N(e[1]);
    if (A[7] !== B[7] && A[8] === B[8]) {
      const o = offA[i] || 0 || offB[i] || 0;
      offA[i] = o;
      offB[i] = o;
    }
  });
  const geo = (e, i) => {
    const A = N(e[0]),
      B = N(e[1]),
      fw = B[7] > A[7];
    return {
      x1: A[7] + (fw ? W / 2 : -W / 2),
      x2: B[7] - (fw ? W / 2 : -W / 2),
      y1: A[8] + (offA[i] || 0),
      y2: B[8] + (offB[i] || 0),
    };
  };
  const path = (e, i) => {
    const [a, b, k] = e,
      A = N(a),
      B = N(b);
    if (A[7] === B[7]) {
      const dn = B[8] > A[8];
      return <path d={`M${A[7] * 10},${A[8] + (dn ? HN : -HN)} L${B[7] * 10},${B[8] + (dn ? -HN : HN)}`} className={`mp-e ${k}`} />;
    }
    const g = geo(e, i),
      mx = ((g.x1 + g.x2) / 2) * 10;
    return <path d={`M${g.x1 * 10},${g.y1} C${mx},${g.y1} ${mx},${g.y2} ${g.x2 * 10},${g.y2}`} className={`mp-e ${k}`} />;
  };
  const lbl = (e, i) => {
    const [a, b, k, , l, lx] = e;
    if (!l) return '';
    const A = N(a),
      B = N(b);
    if (A[7] === B[7]) return '';
    const g = geo(e, i),
      x = lx != null ? lx : (g.x1 + g.x2) / 2,
      y = lx != null ? g.y1 : (g.y1 + g.y2) / 2;
    return (
      <span className={`mp-el ${k}`} style={css(`left:${x}%;top:${y}%`)}>
        {l}
      </span>
    );
  };
  const pend = {
    ap: 'v1.3 · waiting on you',
    mr: '1 change in the wait',
    vr: 'Waits on D&T Co.',
    bb: '6 bonds',
    lp: 'Not funded yet',
    bv: 'Not funded yet',
  };
  return (
    <>
      <div className="mp" role="img" aria-label="How the contracts connect">
        <div className="mp-safe">
          <b>Ops Safe</b>
          <span>2 of 3 · admin and pause on every live contract</span>
        </div>
        <div className="mp-in">
          {LAYERS.map((l, i) => (
            <Fragment key={i}>
              <span className="mp-lay" style={css(`left:${10 + i * 20}%`)}>
                {l}
              </span>
              <i className="mp-drop" style={css(`left:${10 + i * 20}%`)} />
            </Fragment>
          ))}
          <i className="mp-sep" style={css('top:7.5%')} />
          <span className="mp-band" style={css('top:7.5%')}>
            Credit and money
          </span>
          <i className="mp-sep" style={css('top:77%')} />
          <span className="mp-band" style={css('top:77%')}>
            Deeds and real assets
          </span>
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
            {EDGES.map(path)}
          </svg>
          {EDGES.map(lbl)}
          {CTR.map((c, __k) => (
            <button
              key={__k}
              type="button"
              className={`mp-n ${c[4]}${pend[c[0]] && !['bb', 'lp', 'bv'].includes(c[0]) ? ' pend' : ''}${c[0] === 'ap' ? ' me' : ''}${['bb', 'lp', 'bv'].includes(c[0]) ? ' info' : ''}`}
              data-ctr={c[0]}
              style={css(`left:${c[7]}%;top:${c[8]}%`)}
            >
              <span className="mp-h">
                <b>{c[1]}</b>
                <span className="mono">{c[2]}</span>
              </span>
              {pend[c[0]] ? <span className="mp-t">{pend[c[0]]}</span> : ''}
            </button>
          ))}
        </div>
      </div>
      <div className="mp-list">
        {[
          ['c', 'Credit and money'],
          ['d', 'Deeds and real assets'],
        ].map(([b, bn], __k) => (
          <Fragment key={__k}>
            <div className="mp-lb">{bn}</div>
            {LAYERS.map((l, i) => {
              const cs = CTR.filter((c) => c[3] === i && c[9] === b);
              return cs.length ? (
                <div key={i} className="ph-c">
                  <span className="lbl">{l}</span>
                  {cs.map((c, __k) => (
                    <button key={__k} type="button" className="ph-r" data-ctr={c[0]}>
                      <i className={c[4]} />
                      <span>
                        {c[1]}
                        {pend[c[0]] ? <em>{pend[c[0]]}</em> : ''}
                      </span>
                      <span className="mono quiet">{c[2]}</span>
                    </button>
                  ))}
                </div>
              ) : (
                ''
              );
            })}
          </Fragment>
        ))}
      </div>
    </>
  );
}
export function mapKey() {
  return (
    <div className="mp-keys">
      {mkey([
        ['var(--fg)', 'Live on Base Sepolia'],
        ['var(--line)', 'In the repo, not deployed'],
        ['var(--underway)', 'Change in the wait'],
        ['var(--live)', 'Change waiting on you'],
      ])}
      <div className="mkey">
        <span>
          <i className="lk reads" />
          Reads from
        </span>
        <span>
          <i className="lk money" />
          Moves money
        </span>
        <span>
          <i className="lk mint" />
          Mints tokens
        </span>
      </div>
    </div>
  );
}
/* renewals per month, stacked by type */
export function renewCols(h = 132) {
  const months = Array.from(
    {
      length: 12,
    },
    (_, i) => D(11 + i > 12 ? i - 1 : 11 + i, 1, 11 + i > 12 ? 2027 : 2026),
  );
  const col = ['merchant', 'company', 'provider'],
    colr = {
      merchant: 'var(--fg)',
      company: 'var(--land)',
      provider: 'var(--fg-50)',
    };
  const bins = months.map((m) => {
    const e = new Date(m);
    e.setUTCMonth(e.getUTCMonth() + 1);
    return col.map((t) => AGR.filter((x) => x.type === t && x.b && x.b >= m && x.b < e.getTime()).length);
  });
  const max = Math.max(...bins.map((b) => b.reduce((a, c) => a + c, 0)));
  return (
    <>
      <div className="scol" style={css(`--colh:${h}px`)}>
        {bins.map((b, i) => {
          const tot = b.reduce((a, c) => a + c, 0),
            m = new Date(months[i]).getUTCMonth();
          return (
            <div key={i} className="mcol">
              <span className="cv2">{tot || ''}</span>
              <span className="mcol-s">
                {b.map((v, k) => (v ? <i key={k} style={css(`height:${((v / max) * h).toFixed(1)}px;background:${colr[col[k]]}`)} /> : ''))}
              </span>
              <span className="ck">{MON[m]}</span>
            </div>
          );
        })}
      </div>
      {mkey([
        ['var(--fg)', 'Merchant partners'],
        ['var(--land)', 'Company'],
        ['var(--fg-50)', 'Providers'],
      ])}
    </>
  );
}

/* signer activity */
export function signerHeat() {
  const max = 4;
  return (
    <div className="hm">
      <div className="hm-r hm-h">
        <span />
        {['1', '8', '15', '22', '29', '6', '13', '20'].map((w, __k) => (
          <span key={__k}>{w}</span>
        ))}
        <span>Median</span>
      </div>
      {SIGNERS.map(([k, n, r, med], __k) => (
        <div key={__k} className="hm-r">
          <span className="hm-k">
            <b>{n}</b>
          </span>
          {SIGN_W[k].map((v, __k) => (
            <i key={__k} className="hm-c" style={css(`--v:${v / max};${v / max >= 0.5 ? 'color:var(--ground)' : ''}`)} title={`${v} signed`}>
              {v || ''}
            </i>
          ))}
          <b className="num">
            {med.toFixed(1)}
            {' h'}
          </b>
        </div>
      ))}
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────── */
export function contractsPage() {
  const P = CS.pane,
    mine = CH.filter((c) => c.mine).length + acnt((a) => a.st === 'out');
  const title =
    P === 'overview'
      ? mine === 1
        ? 'One signature is waiting on you.'
        : `${mine} signatures are waiting on you.`
      : P === 'agreements'
        ? `${AGR.length} agreements on file.`
        : P === 'chain'
          ? `${CTR.filter((c) => c[4] === 'live').length} contracts live on testnet.`
          : `${CH.length} changes in flight.`;
  const tools = (
    <button className="btn btn-p" type="button" data-cflow="propose">
      <span className="dot pulse" style={css('color:var(--btn-dot)')} aria-hidden="true" />
      Propose a change
    </button>
  );
  const tabs = [
    ['overview', 'Overview'],
    ['agreements', 'Agreements'],
    ['chain', 'On-chain'],
    ['changes', 'Changes'],
  ];
  const body = {
    overview: cOverview,
    agreements: cAgreements,
    chain: cChain,
    changes: cChanges,
  }[P]();
  return (
    <>
      {head(
        <>
          {'Contracts · Testnet · '}
          <b>Demo data</b>
        </>,
        title,
        tools,
      )}
      <nav className="ptabs" aria-label="Contracts panes">
        {tabs.map(([v, t], __k) => (
          <button key={__k} type="button" data-cpane={v} aria-current={P === v ? 'page' : 'false'}>
            {t}
          </button>
        ))}
      </nav>
      {body}
      {contractsPane()}
    </>
  );
}
export function cOverview() {
  const live = CTR.filter((c) => c[4] === 'live').length;
  const map = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">The protocol</span>
        <span className="tag">Base Sepolia · block 18,204,331</span>
      </header>
      <div className="c-fig">
        {figHtml(`${live} of ${CTR.length}`, 'contracts live · AssurancePool v1.3 waits on your signature and closes the open withdraw')}
      </div>
      <div className="c-body">
        {protoMap()}
        {mapKey()}
      </div>
      {strip([
        ['Live', live],
        ['Not deployed', CTR.filter((c) => c[4] !== 'live').length],
        ['Not funded yet', '2'],
        ['Changes in flight', CH.length],
        ['Paused', 'None'],
      ])}
    </section>
  );
  const from = D(7, 1),
    to = D(10, 31, 2027);
  const terms = gantt(
    AGR.filter((a) => a.type !== 'merchant' && a.st !== 'draft').sort((x, y) => (x.b || 9e15) - (y.b || 9e15)),
    from,
    to,
    true,
  );
  const ms = AGR.filter((x) => x.type === 'merchant' && x.b),
    cluster = ms.filter((x) => x.b >= D(8, 1, 2027)).length;
  const agr = (
    <section className="cell s-8">
      <header className="c-hd">
        <span className="lbl">Agreement terms</span>
        <span className="tag">Jul 26 – Oct 27</span>
      </header>
      <div className="c-fig">{figHtml(String(acnt((a) => a.st === 'renew')), 'renewals in the next 90 days · the first is Plaid on 12 Nov')}</div>
      <div className="c-body">
        {terms}
        {mkey([
          ['var(--fg)', 'Term'],
          ['var(--underway)', 'Renews within 90 days'],
          ['var(--live)', 'Waiting on you'],
        ])}
      </div>
      {strip([
        ['On file', AGR.length],
        ['Renewal due', acnt((a) => a.st === 'renew'), '', 'warn'],
        ['Waiting on you', acnt((a) => a.st === 'out')],
        ['Drafts', acnt((a) => a.st === 'draft')],
      ])}
    </section>
  );
  const ren = gCell(
    's-4 wt',
    'Renewals by month',
    'Next 12 months',
    figHtml(String(cluster), `of ${ms.length + 1} merchant agreements renew in the same three months · worth staggering`),
    renewCols(250),
    <div className="c-ft">
      <button type="button" data-cpane="agreements">
        <span className="t">Every agreement</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  const flight = (
    <section className="cell s-8">
      <header className="c-hd">
        <span className="lbl">Changes in flight</span>
        <span className="tag">2 of 3 sign, then a 24-hour wait</span>
      </header>
      <div className="c-fig">{figHtml('1', 'waiting on your signature · Dana Ruiz signed AssurancePool v1.3 yesterday')}</div>
      <div className="c-body">
        {sigLanes([CH[0], CH[1], CH[2], CH[3], CH[4], CH_DONE[0]], D(10, 13), D(10, 31), 3)}
        {sigKey()}
      </div>
      <div className="c-ft split">
        <button type="button" data-cpane="changes">
          <span className="t">Every change</span>
          {ic('chev', 'sm')}
        </button>
        <span className="rule" aria-hidden="true" />
        {footItem({
          t: 'No keys live in this app',
        })}
      </div>
    </section>
  );
  const tot30 = Object.values(SIGN_W).reduce((a, v) => a + v.slice(4).reduce((x, y) => x + y, 0), 0);
  const signers = gCell(
    's-4 wt',
    'Signers',
    'Ops Safe · 2 of 3',
    figHtml('3.1 h', 'your median time to sign · the fastest of the three'),
    <>
      <div className="ablock">
        <span className="lbl">Signatures a week · Sep – Oct</span>
        {signerHeat()}
      </div>
      <div className="ablock">
        <span className="lbl">Waiting on each</span>
        {evRows(
          [
            ['K', 'Kai', 'AssurancePool v1.3', '1', 'me'],
            ['DR', 'Dana Ruiz', 'Next on your top-up, once proposed', '0'],
            ['BS', 'Board signer', 'Nothing waiting', '0'],
          ].map(([k, n, w, c, m]) => [k, n, w, c, m]),
        )}
      </div>
    </>,
    strip([
      ['Signed, 30 days', String(tot30)],
      ['Waiting on you', '1'],
    ]),
  );
  return (
    <>
      {G('On-chain', 'Every live contract answers to the Ops Safe', '', map)}
      {G(
        'Paper',
        '',
        '',
        <>
          {agr}
          {ren}
        </>,
      )}
      {G(
        'Changes',
        '',
        '',
        <>
          {flight}
          {signers}
        </>,
      )}
    </>
  );
}
export function cAgreements() {
  const opts = [
    ['all', 'All', AGR.length],
    ['company', 'Company', acnt((a) => a.type === 'company')],
    ['provider', 'Providers', acnt((a) => a.type === 'provider')],
    ['member', 'Members', acnt((a) => a.type === 'member')],
    ['merchant', 'Merchant partners', acnt((a) => a.type === 'merchant')],
  ];
  const order = ['company', 'provider', 'member', 'merchant'];
  const list = AGR.filter((a) => (CS.af === 'all' ? a.type !== 'merchant' : a.type === CS.af)).sort(
    (x, y) => order.indexOf(x.type) - order.indexOf(y.type) || (x.a || NOW) - (y.a || NOW),
  );
  const full = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Every agreement</span>
        <span className="hd-tools">{ddHtml('caf', opts, CS.af, 'Show')}</span>
      </header>
      <div className="c-fig">
        {figHtml(
          String(CS.af === 'all' ? AGR.length : list.length),
          `${CS.af === 'all' ? 'agreements · merchant partners grouped, pick them in the menu' : AGR_T[CS.af].toLowerCase()} · each bar is a term, each square a renewal`,
        )}
      </div>
      <div className="c-body">
        {gantt(list, D(7, 1), D(10, 31, 2027), CS.af === 'all')}
        {mkey([
          ['var(--fg)', 'Term'],
          ['var(--underway)', 'Renews within 90 days'],
          ['var(--live)', 'Waiting on you'],
          ['var(--line)', 'Draft'],
        ])}
      </div>
      {strip([
        ['Signed', acnt((a) => a.st === 'signed')],
        ['Renewal due', acnt((a) => a.st === 'renew'), '', 'warn'],
        ['Waiting on you', acnt((a) => a.st === 'out')],
        ['Drafts', acnt((a) => a.st === 'draft')],
      ])}
    </section>
  );

  /* merchant template adoption, cumulative by week */
  const wk = Array.from(
      {
        length: 12,
      },
      (_, i) => D(8, 3) + i * 7 * DAY,
    ),
    ms = AGR.filter((a) => a.type === 'merchant' && a.a);
  const v0 = wk.map((t) => ms.filter((a) => a.a <= t + 6 * DAY && a.ver === 'v1.0').length),
    v1 = wk.map((t, i) => v0[i] + ms.filter((a) => a.a <= t + 6 * DAY && a.ver === 'v1.1').length);
  const max = 30,
    area = (top, bot, cls) => (
      <path
        d={`M${top.map((y, i) => `${px(i, 12) * 10},${(1 - y / max) * 100}`).join(' L')} L${bot.map((y, i) => `${px(11 - i, 12) * 10},${(1 - bot[11 - i] / max) * 100}`).join(' L')} Z`}
        className={cls}
      />
    );
  const zero = wk.map(() => 0);
  const tmpl = gCell(
    's-6',
    'Merchant template',
    'Signed partners by version',
    figHtml(String(v0[11]), 'shops still on v1.0 · v1.1 added NET-14 on 15 Sep'),
    <>
      {chart({
        h: 132,
        max,
        yTicks: [0, 10, 20, 30],
        x: wk
          .map((t, i) => ({
            t: fmtD(t),
            x: px(i, 12),
          }))
          .filter((_, i) => i % 3 === 0 || i === 11),
        paths: (
          <>
            {area(v1, v0, 'ar-2')}
            {area(v0, zero, 'ar-1')}
          </>
        ),
        notes: [
          {
            x: pctX(D(9, 15), wk[0], wk[11]),
            t: 'v1.1',
          },
        ],
      })}
      {mkey([
        ['var(--fg)', 'v1.0'],
        ['var(--land)', 'v1.1'],
      ])}
    </>,
    strip([
      ['On v1.1', String(v1[11] - v0[11])],
      ['On v1.0', String(v0[11])],
      ['Member', 'v2.1'],
    ]),
  );
  const icw = agrOf('icw');
  const sig = gCell(
    's-6',
    'Out for signature',
    'E-signature',
    figHtml(icw.party, 'founding seat 4 of 5 · your signature is next'),
    <>
      {sigLanes(
        [
          {
            id: 'icw',
            t: 'Merchant agreement',
            state: 'Waiting on you',
            flow: 'esign',
            ev: [
              ['seg', 'done', D(10, 18, 2026, 10), D(10, 20, 2026, 15)],
              ['seg', 'open', D(10, 20, 2026, 15), NOW],
              ['seg', 'proj', NOW, D(10, 24)],
              ['draft', D(10, 18, 2026, 10)],
              ['sign', D(10, 20, 2026, 15), 'IC'],
              ['sign', NOW, 'K', 1],
              ['check', D(10, 23), 1],
              ['live', D(10, 24), 1],
            ],
          },
        ],
        D(10, 16),
        D(10, 26),
        3,
      )}
      <div className="how two">
        <span className="k">Sent</span>
        <b>18 Oct</b>
        <span className="k">Shop signed</span>
        <b>20 Oct</b>
        <span className="k">After you sign</span>
        <b>Filed, then terms go to the Ops Safe</b>
      </div>
    </>,
    <div className="c-ft">
      <button type="button" data-cflow="esign" data-cid="icw">
        <span className="t">Sign in your e-signature tool</span>
        {ic('out', 'sm')}
      </button>
    </div>,
  );
  return (
    <>
      {G('Terms', 'Select a row for the agreement', '', full)}
      {G(
        'Paper',
        '',
        '',
        <>
          {tmpl}
          {sig}
        </>,
      )}
    </>
  );
}
export function cChain() {
  const live = CTR.filter((c) => c[4] === 'live').length;
  const map = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">The protocol</span>
        <span className="tag">Select a contract</span>
      </header>
      <div className="c-fig">{figHtml(`${live} of ${CTR.length}`, 'live on Base Sepolia · CreditPool is the one still in the repo only')}</div>
      <div className="c-body">
        {protoMap()}
        {mapKey()}
      </div>
      {strip([
        ['Admin', 'Ops Safe'],
        ['Pause', 'Ops Safe'],
        ['Keys in this app', 'None'],
        ['Paused', 'None'],
      ])}
    </section>
  );
  /* release lanes */
  const from = D(8, 1),
    to = D(10, 31),
    ids = ['ri', 'ti', 'ap', 'pp', 'cc', 'esa', 'cu', 'lp', 'bv', 'lq', 'ce', 'si', 'mr', 'dn', 'va', 'sd', 'fz'];
  const rows = ids.map((id, __k) => {
    const c = ctrOf(id),
      rel = RELEASES[id] || [],
      p = PENDING[id];
    const first = rel[0] ? rel[0][1] : D(10, 12);
    const lane = (
      <>
        {c[4] === 'build' ? (
          <>
            <i className="sl-seg block" style={css(`left:${pctX(D(10, 12), from, to)}%;width:${pctX(NOW, from, to) - pctX(D(10, 12), from, to)}%`)} />
            <i className="rl-tag" style={css(`left:${pctX(D(10, 12), from, to)}%`)}>
              In review
            </i>
          </>
        ) : (
          <i className="sl-seg done" style={css(`left:${pctX(first, from, to)}%;width:${pctX(NOW, from, to) - pctX(first, from, to)}%`)} />
        )}
        {rel.map(([v, t], i) => (
          <i key={i} className={`rl-v${i === rel.length - 1 ? ' cur' : ''}`} style={css(`left:${pctX(t, from, to)}%`)}>
            <span>{v}</span>
          </i>
        ))}
        {p ? (
          <>
            <i className="sl-seg proj" style={css(`left:${pctX(NOW, from, to)}%;width:${pctX(p[1], from, to) - pctX(NOW, from, to)}%`)} />
            <i className="rl-v next" style={css(`left:${pctX(p[1], from, to)}%`)}>
              <span>{p[0]}</span>
            </i>
          </>
        ) : (
          ''
        )}
        {id === 'mr' ? TXD.map((t, __k) => <i key={__k} className="rl-dot" style={css(`left:${pctX(t, from, to)}%`)} />) : ''}
      </>
    );
    return (
      <button key={__k} type="button" className="ln-r" data-ctr={id}>
        <span className="ln-k">
          <b>{c[1]}</b>
          <span>{c[4] === 'build' ? 'Building' : c[2] + ' live'}</span>
        </span>
        <span className="ln-l">{lane}</span>
      </button>
    );
  });
  const nRel = Object.values(RELEASES).reduce((a, r) => a + r.length, 0);
  const lanes = (
    <section className="cell s-8">
      <header className="c-hd">
        <span className="lbl">Releases</span>
        <span className="tag">Aug – Oct</span>
      </header>
      <div className="c-fig">{figHtml(String(nRel), 'deploys and upgrades since 2 Aug · RevolvingIssuer moves fastest, 4 versions')}</div>
      <div className="c-body">
        {laneFrame(rows, from, to, 14, 'sl rl')}
        {mkey([
          ['var(--fg)', 'Live version'],
          ['var(--live)', 'Next, waiting on you'],
          ['var(--fg-50)', 'Shop added to MerchantRegistry'],
        ])}
      </div>
      {strip([
        ['This week', '1'],
        ['Last', 'RevolvingIssuer v1.3'],
        ['By', 'Dana Ruiz'],
      ])}
    </section>
  );
  /* who can do what */
  const holders = ['Ops Safe', 'Issuers', 'ClearCredit', 'BurnerBond', 'Validator', 'Anyone', 'LendingPool'];
  const roles = [
    ['Upgrade and admin', [1, 0, 0, 0, 0, 0, 0]],
    ['Pause', [1, 0, 0, 0, 0, 0, 0]],
    ['Mint credit', [0, 1, 0, 0, 0, 0, 0]],
    ['Set shop terms', [1, 0, 0, 0, 0, 0, 0]],
    ['Approve a deed', [0, 0, 0, 0, 1, 0, 0]],
    ['Add a validator', [1, 0, 0, 0, 0, 0, 0]],
    ['Claim from AssurancePool', [0, 0, 1, 1, 0, 3, 2]],
  ];
  const mx = (
    <div className="rm">
      <div className="rm-r rm-h">
        <span />
        {holders.map((h, __k) => (
          <span key={__k}>{h}</span>
        ))}
      </div>
      {roles.map(([r, v], __k) => (
        <div key={__k} className="rm-r">
          <span className="rm-k">{r}</span>
          {v.map((x, __k) => (
            <span key={__k} className="rm-c">
              {x === 1 ? <i className="on" /> : x === 2 ? <i className="later" /> : x === 3 ? <i className="risk" /> : <i className="no" />}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
  const rl = gCell(
    's-4 wt',
    'Who can do what',
    'Roles',
    figHtml('1', 'open door: anyone can withdraw from the AssurancePool until v1.3'),
    <>
      {mx}
      {mkey([
        ['var(--fg)', 'Holds it'],
        ['var(--underway)', 'Open, closes with v1.3'],
        ['var(--line)', 'Once funded'],
      ])}
    </>,
    strip([
      ['People with keys', '3'],
      ['Keys in this app', 'None'],
    ]),
  );
  return (
    <>
      {G('Map', '', '', map)}
      {G(
        'History',
        '',
        '',
        <>
          {lanes}
          {rl}
        </>,
      )}
    </>
  );
}
export function cChanges() {
  const all = [...CH, ...CH_DONE];
  const tl = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Every change</span>
        <span className="tag">18 Sep – 1 Nov</span>
      </header>
      <div className="c-fig">{figHtml(String(CH.length), `in flight · ${CH_DONE.length} went live in the last 30 days`)}</div>
      <div className="c-body">
        {sigLanes(all, D(9, 18), D(11, 1), 7)}
        {sigKey()}
      </div>
      {strip([
        ['Waiting on you', String(CH.filter((c) => c.mine).length)],
        ['In the wait', String(CH.filter((c) => c.stage === 3).length)],
        ['Drafts', String(CH.filter((c) => c.stage === 0).length)],
        ['Live, 30 days', String(CH_DONE.length)],
      ])}
    </section>
  );
  const signers = gCell(
    's-6',
    'Signers',
    'Signatures a week',
    figHtml('3.1 h', 'your median time to sign'),
    signerHeat(),
    strip([
      ['Fastest', 'Kai'],
      ['Slowest', 'Board signer · 31.0 h'],
    ]),
  );
  const ttl = [
    ['RevolvingIssuer v1.3', 8.0],
    ['Uptown Barber', 2.1],
    ['BB-0006', 1.4],
    ['PayoutPool v0.9', 7.0],
    ['AssurancePool v1.2', 9.0],
  ];
  const speed = gCell(
    's-6',
    'Draft to live',
    'Days, last 5 changes',
    figHtml('7.0 days', 'median · contract upgrades take longest, shop changes about 2 days'),
    columns(
      ttl.map(([k, v]) => [k, v]),
      {
        h: 120,
        hi: 0,
        fmt: (v) => v.toFixed(1) + ' d',
      },
    ),
    strip([
      ['Upgrades', '8.0 d'],
      ['Shop changes', '2.1 d'],
      ['Bonds', '1.4 d'],
    ]),
  );
  return (
    <>
      {G('Changes', 'Drafted here · signed in the Ops Safe', '', tl)}
      {G(
        'Pace',
        '',
        '',
        <>
          {signers}
          {speed}
        </>,
      )}
    </>
  );
}

/* ── detail panes ─────────────────────────────────────────────────────── */
export function contractsPane() {
  let sub, chip, body, foot;
  if (CS.ag) {
    const a = agrOf(CS.ag);
    if (!a) return '';
    sub = 'Agreement';
    chip = <span className={`chip ${AST[a.st][0]}`}>{AST[a.st][1]}</span>;
    const trail =
      a.st === 'out'
        ? [
            ['Sent', 1],
            ['Shop signed', 1],
            ['You sign', 2],
            ['Filed', 0],
          ]
        : a.st === 'draft'
          ? [
              ['Draft', 2],
              ['Review', 0],
              ['Sign', 0],
              ['Filed', 0],
            ]
          : a.st === 'sent'
            ? [
                ['Sent', 2],
                ['Signed', 0],
                ['Filed', 0],
              ]
            : [
                ['Sent', 1],
                ['Signed', 1],
                ['Filed', 1],
              ];
    const lane = a.a ? gantt([a], D(7, 1), D(10, 31, 2027)) : '';
    body = (
      <>
        <div>
          <p className="h2" style={css('font-size:28px')}>
            {a.party}
          </p>
          <p className="quiet" style={css('margin:8px 0 0')}>
            {a.name}
            {' · '}
            {a.ver}
          </p>
        </div>
        {lane ? (
          <div>
            <span className="lbl">Term</span>
            {lane}
          </div>
        ) : (
          ''
        )}
        <div>
          <span className="lbl">Signing</span>
          {vizTrack(trail)}
        </div>
        <div className="rows ledger">
          <div className="r">
            <span className="k">Type</span>
            <span className="v">{AGR_T[a.type]}</span>
          </div>
          <div className="r">
            <span className="k">Signed</span>
            <span className="v">{a.a ? fmtD(a.a) + ' ' + new Date(a.a).getUTCFullYear() : 'Not yet'}</span>
          </div>
          <div className="r">
            <span className="k">Renews</span>
            <span className="v">{a.b ? fmtD(a.b) + ' ' + new Date(a.b).getUTCFullYear() : a.roll ? 'Month to month' : a.a ? 'No end' : '—'}</span>
          </div>
          <div className="r">
            <span className="k">Signed copy</span>
            <span className="v">{a.a ? 'In Records' : 'Not yet'}</span>
          </div>
        </div>
        <p className="quiet" style={css('margin:0')}>
          {a.note}
        </p>
      </>
    );
    foot =
      a.st === 'out' ? (
        <button className="btn btn-p" type="button" data-cflow="esign" data-cid={a.id}>
          Sign in your e-signature tool{ic('out')}
        </button>
      ) : a.st === 'renew' ? (
        <button className="btn btn-p" type="button" data-cflow="renew" data-cid={a.id}>
          Start the renewal
        </button>
      ) : (
        <button className="btn btn-g" type="button" data-go="records">
          {a.st === 'draft' ? 'Open the draft in Records' : 'Signed copy in Records'}
        </button>
      );
  } else if (CS.ct) {
    const c = ctrOf(CS.ct);
    if (!c) return '';
    sub = 'Contract';
    chip = (
      <span
        className={`chip ${
          {
            live: 'settled',
            build: 'underway',
            later: 'plain',
          }[c[4]]
        }`}
      >
        {
          {
            live: 'Live',
            build: 'Building',
            later: 'Not deployed',
          }[c[4]]
        }
      </span>
    );
    const rel = RELEASES[c[0]] || [],
      p = PENDING[c[0]];
    const vers = rel.length ? rel.map(([v], i) => [v, i === rel.length - 1 ? 2 : 1]).concat(p ? [[p[0], 0]] : []) : [['Planned', 0]];
    const pend = CH.filter((x) => x.c === c[1]);
    body = (
      <>
        <div>
          <p className="h2" style={css('font-size:28px')}>
            {c[1]}
          </p>
          <p className="quiet" style={css('margin:8px 0 0')}>
            {c[6]}
          </p>
        </div>
        <div>
          <span className="lbl">Versions</span>
          {vizTrack(vers)}
        </div>
        {(() => {
          const rs = REL.filter((r) => r[0] === c[0] || r[1] === c[0]);
          return rs.length ? (
            <div>
              <span className="lbl">Connections</span>
              <div className="cn-list">
                {rs.map((r, __k) => {
                  const out = r[0] === c[0],
                    o = ctrOf(out ? r[1] : r[0]);
                  return (
                    <button key={__k} type="button" className="pn-r cn-r" data-ctr={o[0]}>
                      <i className={`lk ${r[2]}`} />
                      <span className="pn-k">
                        <b>{out ? r[3] + ' · ' + o[1] : o[1] + ' · ' + r[3]}</b>
                        <span className="small quiet">
                          {RK[r[2]]}
                          {' · '}
                          {out ? 'outgoing' : 'incoming'}
                        </span>
                      </span>
                      <span className="mono quiet small">{out ? '→' : '←'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            ''
          );
        })()}
        <div className="rows ledger">
          <div className="r">
            <span className="k">Address</span>
            <span className="v mono">{c[5]}</span>
          </div>
          <div className="r">
            <span className="k">Network</span>
            <span className="v">{c[4] === 'live' ? 'Base Sepolia' : 'Not deployed'}</span>
          </div>
          <div className="r">
            <span className="k">Track</span>
            <span className="v">{c[9] === 'd' ? 'Deeds and real assets' : 'Credit and money'}</span>
          </div>
          <div className="r">
            <span className="k">Layer</span>
            <span className="v">{LAYERS[c[3]]}</span>
          </div>
          <div className="r">
            <span className="k">Admin</span>
            <span className="v">{c[4] === 'live' ? 'Ops Safe' : '—'}</span>
          </div>
          <div className="r">
            <span className="k">Paused</span>
            <span className="v">{c[4] === 'live' ? 'No' : '—'}</span>
          </div>
          <div className="r">
            <span className="k">Last release</span>
            <span className="v">{rel.length ? fmtD(rel[rel.length - 1][1]) : '—'}</span>
          </div>
        </div>
        {pend.length ? (
          <div>
            <span className="lbl">In flight</span>
            {sigLanes(pend, D(10, 12), D(11, 1), 7)}
          </div>
        ) : (
          ''
        )}
      </>
    );
    foot =
      c[4] === 'live' ? (
        <>
          <button className="btn btn-p" type="button" data-cflow="propose" data-cid={c[0]}>
            Propose a change
          </button>
          <button className="btn btn-g" type="button" data-cflow="explorer" data-cid={c[0]}>
            Block explorer{ic('out')}
          </button>
        </>
      ) : (
        <button className="btn btn-g" type="button" data-closecpane="">
          Close
        </button>
      );
  } else return '';
  return (
    <>
      <div className="pane-scrim" data-closecpane="" />
      <aside className="pane" role="dialog" aria-label={sub}>
        <header className="m-hd">
          <span className="sub">{sub}</span>
          <span style={css('display:flex;align-items:center;gap:8px')}>
            {chip}
            <button className="x" type="button" data-closecpane="" aria-label="Close">
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

/* ── action flows ─────────────────────────────────────────────────────── */
export function openCFlow(kind, id) {
  vars.lastFocus = document.activeElement;
  const a = id ? agrOf(id) : null,
    c = id ? ctrOf(id) : null,
    ch = id ? [...CH, ...CH_DONE].find((x) => x.id === id) : null;
  const f = {
    propose: {
      t: 'Propose a change',
      h: c ? c[1] : 'A contract change',
      rows: [
        ['Contract', c ? `${c[1]} ${c[2]}` : 'Pick one in the multisig'],
        ['Second person', 'Dana Ruiz or the board signer'],
        ['Then', '2 of 3 sign, then a 24-hour wait', 1],
      ],
      input: true,
      btn: 'Prepare for the multisig',
      ext: 1,
      after: (v) => {
        const w = v || 'Contract change';
        CH.push({
          id: 'ch' + (CH.length + 5),
          t: w,
          c: c ? c[1] : 'Contract',
          by: 'You',
          stage: 2,
          state: 'Waiting on Dana Ruiz · 1 of 2',
          d: w,
          ev: [
            ['seg', 'done', NOW - 3600e3, NOW],
            ['seg', 'open', NOW, NOW + 20 * 3600e3],
            ['draft', NOW - 3600e3],
            ['sign', NOW, 'K'],
          ],
        });
      },
      steps: ['Prepared the transaction', 'Opened it in the multisig', 'Asked Dana Ruiz for the second signature'],
      done: ['Handed to the multisig.', 'It goes live after two of three sign and the 24-hour wait. No keys live in this app.'],
    },
    sign: {
      t: 'Sign a change',
      h: ch && ch.t,
      p: ch && ch.d,
      rows: ch
        ? [
            ['Contract', ch.c],
            ['Proposed by', ch.by],
            ['Signatures', '1 of 2 · yours is next'],
            ['Then', 'A 24-hour wait, then live', 1],
          ]
        : [],
      rule: ch && ch.by,
      btn: 'Sign in the multisig',
      ext: 1,
      steps: ['Opened it in the multisig', 'Waiting for your signature there'],
      done: ['Over to the multisig.', 'It shows as signed here once you sign there.'],
    },
    view: {
      t: 'Change',
      h: ch && ch.t,
      p: ch && ch.d,
      rows: ch
        ? [
            ['Contract', ch.c],
            ['Proposed by', ch.by],
            ['Now', ch.state, 1],
          ]
        : [],
      btn: null,
    },
    esign: {
      t: 'Sign an agreement',
      h: a && a.party,
      p: a && a.note,
      rows: a
        ? [
            ['Agreement', `${a.name} ${a.ver}`],
            ['They signed', '20 Oct'],
            ['After you sign', 'Their terms go to the Ops Safe', 1],
          ]
        : [],
      btn: 'Open in your e-signature tool',
      ext: 1,
      steps: ['Opened the agreement in your e-signature tool'],
      done: ['Over to your e-signature tool.', 'It comes back here marked signed.'],
    },
    renew: {
      t: 'Start a renewal',
      h: a && a.party,
      rows: a
        ? [
            ['Agreement', `${a.name} ${a.ver}`],
            ['Ends', a.b ? fmtD(a.b) : '—'],
            ['New term', '12 months, same terms'],
            ['Signed in', 'Your e-signature tool', 1],
          ]
        : [],
      btn: 'Start the renewal',
      after: () => {
        a.st = 'sent';
        a.note = 'Renewal sent for signature today, same terms for 12 months.';
      },
      steps: ['Copied the current terms', 'Prepared it in your e-signature tool', 'Set a reminder 14 days before it ends'],
      done: ['Renewal started.', 'It comes back here marked signed.'],
    },
    explorer: {
      t: 'Block explorer',
      h: c && c[1],
      rows: c
        ? [
            ['Address', c[5]],
            ['Network', 'Testnet', 1],
          ]
        : [],
      btn: 'Open the explorer',
      ext: 1,
      steps: ['Opened the address in the explorer'],
      done: ['Opened in a new tab.', 'Nothing changes here.'],
    },
  }[kind];
  const note =
    f.ext && kind !== 'explorer' ? (
      <div className="note">
        {ic('out', 'sm')}
        <span>
          <b>{kind === 'esign' ? 'You sign in your e-signature tool.' : 'You sign in the multisig.'}</b>{' '}
          {kind === 'esign' ? 'It comes back here marked signed.' : 'No keys live in this app.'}
        </span>
      </div>
    ) : (
      ''
    );
  const rule = f.rule ? (
    <div className="note">
      {ic('team', 'sm')}
      <span>
        <b>Two-person rule.</b> {f.rule}
        {' proposed this. You sign second.'}
      </span>
    </div>
  ) : (
    ''
  );
  modalShell(
    f.t,
    <>
      <div>
        <span className="lbl">{f.t}</span>
        <p className="h2" style={css('margin-top:8px')}>
          {f.h}
        </p>
        {f.p ? (
          <p className="quiet" style={css('margin:8px 0 0')}>
            {f.p}
          </p>
        ) : (
          ''
        )}
      </div>
      {f.input ? (
        <label className="field">
          <span className="lbl">What changes</span>
          <input
            id="cp-what"
            type="text"
            defaultValue={c ? '' : 'Weekly review of the AssurancePool floor'}
            placeholder="One line, plain words"
            autoComplete="off"
          />
        </label>
      ) : (
        ''
      )}
      <div className="rows ledger">
        {f.rows.map(([k, v, t], __k) => (
          <div key={__k} className={`r${t ? ' total' : ''}`}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
      {rule}
      {note}
      <div className="acts">
        {f.btn ? (
          <>
            <button className="btn btn-p" type="button" data-cgo={kind}>
              {f.btn}
              {f.ext ? ic('out') : ''}
            </button>
            <button className="btn btn-g" type="button" data-close="">
              Not now
            </button>
          </>
        ) : (
          <button className="btn btn-g" type="button" data-close="">
            Close
          </button>
        )}
      </div>
    </>,
    'Every change is logged',
  );
  document.addEventListener('keydown', onKey);
  openCFlow.f = f;
}

/* ══ Governance ═════════════════════════════════════════════════════════
   Who decides what, and when it is due. The co-op is the parent; Holdings carries a governance class
   (co-op) and a financial class (investors); the Foundation sits outside the tree and contracts ClearLabs.
   Ties: Home deadlines (ClearLabs annual report 1 Nov, ready; Co-op board minutes 4 Nov, drafting;
   Statement of Information 15 Nov, not started); Contracts (member agreement v2.2 draft, intercompany
   services draft, protocol maintenance). */
