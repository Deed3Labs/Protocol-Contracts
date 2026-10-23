// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { Fragment } from 'react';
import { attrs, css, html } from '../runtime/dom';
import { D } from './contracts';
import { $, compBar, footItem, head, ic, int, money, pct, ringBig, series } from './core';
import {
  CAPS,
  CITY_LL,
  CK,
  CM_GEO,
  CM_K,
  DAY,
  INVITES,
  KST,
  LOGT,
  ML_STYLE,
  MON,
  NEXT_ACT,
  OWED,
  PEOPLE_T,
  PROSPECTS,
  S,
  SIGNED,
  TODAY,
  TXO,
  XS,
  vars,
} from './data';
import { G, columns, figHtml, figSide, fmtD, gCell, kpiCell, metricsCell, spark } from './growth';
import { mkey } from './home';
import { ddHtml } from './kit';
import { stageFlow } from './members';
import { strip } from './money';
import { modalShell, onKey, render, vLevel } from './shell';
import { accOf, grpName } from './team';
export function T(r) {
  return {
    id: r[0],
    name: r[1],
    kind: r[2],
    city: r[3],
    founding: !!r[4],
    fee: r[5],
    terms: r[6],
    cap: r[7],
    hits: r[8],
    orig: r[9],
    lost: r[10],
    oct: r[11],
    octN: r[12],
    sept: r[13],
    hw: r[14],
  };
}
export function capRaise(m) {
  return m.id === 'rosas' ? 'pending' : m.hits > 0 && m.lost === 0 && m.orig >= 15 ? 'raise' : m.hits > 0 ? 'hold' : 'ok';
}
export function payOf(m) {
  const fee = m.id === 'rosas' ? 0 : +((m.sept * m.fee) / 100).toFixed(2);
  return {
    sales: m.sept,
    fee,
    red: OWED[m.id] || 0,
    total: +(m.sept - fee + (OWED[m.id] || 0)).toFixed(2),
  };
}
export function merchantsPage() {
  const title =
    XS.pane === 'overview'
      ? 'One founding seat is still open.'
      : XS.pane === 'pipeline'
        ? 'Seven shops are in talks.'
        : XS.pane === 'partners'
          ? 'Twelve shops are transacting.'
          : XS.pane === 'payouts'
            ? 'The next payout run is Mon 2 Nov.'
            : 'Two devices need a visit.';
  const tools = (
    <button className="btn btn-p" type="button" data-xadd="">
      <span className="dot pulse" style={css('color:var(--btn-dot)')} aria-hidden="true" />
      Add a prospect
    </button>
  );
  const tabs = [
    ['overview', 'Overview'],
    ['pipeline', 'Pipeline'],
    ['partners', 'Partners'],
    ['payouts', 'Payouts'],
    ['hardware', 'Hardware'],
  ];
  const body = {
    overview: xOverview,
    pipeline: xPipeline,
    partners: xPartners,
    payouts: xPayouts,
    hardware: xHardware,
  }[XS.pane]();
  return (
    <>
      {head(
        <>
          {'Merchants · '}
          <b>Demo data</b>
        </>,
        title,
        tools,
      )}
      <nav className="ptabs" aria-label="Merchant panes">
        {tabs.map(([v, t], __k) => (
          <button key={__k} type="button" data-xpane={v} aria-current={XS.pane === v ? 'page' : 'false'}>
            {t}
          </button>
        ))}
      </nav>
      {body}
      {merchantPane()}
    </>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────── */
/* real places for the live map: lng, lat, and which side the label sits so neighbours never collide */
export function corridorData() {
  const by = {};
  const add = (c, o) => (by[c] = by[c] || []).push(o);
  TXO.forEach((m) =>
    add(m.city, {
      k: 't1',
      n: m.name,
      id: m.id,
      v: m.oct,
      kind: m.kind,
    }),
  );
  SIGNED.forEach((x) =>
    add(x[3], {
      k: x[4] === 'signing' ? 'sg' : 'si',
      n: x[1],
      kind: x[2],
    }),
  );
  PROSPECTS.forEach((x) =>
    add(x[2], {
      k: 'pr',
      n: x[0],
      kind: x[1],
    }),
  );
  const order = {
    t1: 0,
    sg: 1,
    si: 2,
    pr: 3,
  };
  return Object.entries(by)
    .filter(([c]) => CITY_LL[c])
    .map(([c, l]) => ({
      c,
      l: l.sort((a, b) => order[a.k] - order[b.k] || (b.v || 0) - (a.v || 0)),
      n: (k) => l.filter((o) => o.k === k).length,
    }))
    .sort((a, b) => b.n('t1') - a.n('t1') || b.l.length - a.l.length);
}
export function cmSq(o) {
  return o.k === 't1' ? (
    <button type="button" className="cm-s ck-tx" data-merchant={o.id} title={`${o.n} · ${money(o.v)} in Oct`} />
  ) : (
    <i className={`cm-s ${CK[o.k]}`} title={o.n} />
  );
}
export function cmXY(lng, lat) {
  const [[a, b], [c, d]] = cmBounds();
  return [((lng - a) / (c - a)) * 100, ((d - lat) / (d - b)) * 100];
}
export function cmAspect() {
  const [[a, b], [c, d]] = cmBounds();
  return (((c - a) * CM_K) / (d - b)).toFixed(3);
}
export function cmPath(pts, close) {
  return (
    'M' +
    pts
      .map(([g, t]) =>
        cmXY(g, t)
          .map((v) => v.toFixed(2))
          .join(','),
      )
      .join(' L') +
    (close ? ' Z' : '')
  );
}
export function cmPip(pt, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
export function cmBase() {
  const G = CM_GEO,
    h = (a, b) => {
      const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
  const off = (g, t) => cmPip([g, t], G.hills) || cmPip([g, t], G.badl) || cmPip([g, t], G.jurupa) || t < 33.92 || (g > -117.13 && t < 34.0);
  /* minor streets: a broken grid, thinner to the east where it is less built up */
  const st = [];
  for (let t = 33.93; t <= 34.17; t += 0.0065)
    for (let g = -117.62; g < -116.96; g += 0.026) {
      const g2 = g + 0.026,
        keep = h(g, t) > (g > -117.15 ? 0.62 : 0.28);
      if (keep && !off(g, t) && !off(g2, t))
        st.push(
          cmPath([
            [g, t],
            [g2, t],
          ]),
        );
    }
  for (let g = -117.62; g <= -116.96; g += 0.0075)
    for (let t = 33.93; t < 34.17; t += 0.022) {
      const t2 = t + 0.022,
        keep = h(t, g) > (g > -117.15 ? 0.62 : 0.28);
      if (keep && !off(g, t) && !off(g, t2))
        st.push(
          cmPath([
            [g, t],
            [g, t2],
          ]),
        );
    }
  /* main roads on the real grid */
  const ar = [];
  [34.136, 34.106, 34.077, 34.048].forEach((t) =>
    ar.push(
      cmPath([
        [-117.66, t],
        [t > 34.06 ? -117.12 : -117.24, t],
      ]),
    ),
  );
  [33.975].forEach((t) =>
    ar.push(
      cmPath([
        [-117.52, t],
        [-117.3, t],
      ]),
    ),
  );
  [-117.435, -117.37, -117.31, -117.27, -117.2, -117.16].forEach((g) =>
    ar.push(
      cmPath([
        [g, g > -117.3 ? 34.03 : 33.99],
        [g, g > -117.22 ? 34.135 : 34.162],
      ]),
    ),
  );
  [-117.4, -117.36].forEach((g) =>
    ar.push(
      cmPath([
        [g, 33.93],
        [g, 34.0],
      ]),
    ),
  );
  ar.push(
    cmPath([
      [-117.085, 34.085],
      [-117.06, 34.04],
      [-117.04, 33.995],
    ]),
  );
  const fw = Object.values(G.fwy)
    .map((p) => cmPath(p))
    .join(' ');
  return (
    <>
      <svg className="cm-base" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path className="hl" d={cmPath(G.hills, 1)} />
        <path className="hl lo" d={cmPath(G.badl, 1)} />
        <path className="hl lo" d={cmPath(G.jurupa, 1)} />
        <path className="st" d={st.join(' ')} />
        <path className="wt" d={cmPath(G.river)} />
        <path className="ar" d={ar.join(' ')} />
        <path className="fc" d={fw} />
        <path className="fw" d={fw} />
      </svg>
      {G.shields.map(([n, g, t], __k) => {
        const [x, y] = cmXY(g, t);
        return (
          <span key={__k} className="cm-hw" style={css(`left:${x.toFixed(2)}%;top:${y.toFixed(2)}%`)}>
            {n}
          </span>
        );
      })}
    </>
  );
}
/* a city marker: the same markup on the drawn map and on the live one */
/* every label is the same size: name, transacting of all, and one cell per shop in a fixed-width bar, so a city with 40 shops fits like one with 2 */
/* a city marker: the same markup on the drawn map and on the live one */
/* every label is the same size: name, transacting of all, and one cell per shop in a fixed-width bar, so a city with 40 shops fits like one with 2 */
export function cmChip(d) {
  return (
    <>
      <i className={`cm-dot${d.n('t1') ? ' t' : ''}`} />
      <div className="cm-lab" data-cmcity={d.c}>
        <span className="cm-lt2">
          <b>{d.c}</b>
          <span className="num">
            <b>{d.n('t1')}</b>/{d.l.length}
          </span>
        </span>
        <span className="cm-bar">
          {d.l.map((o, __k) => (
            <i key={__k} className={CK[o.k]} />
          ))}
        </span>
      </div>
    </>
  );
}
export function cmSide(c) {
  return CITY_LL[c][2][0];
}
export function cmPinFb(d) {
  const [lng, lat] = CITY_LL[d.c],
    side = cmSide(d.c),
    [x, y] = cmXY(lng, lat);
  return (
    <div
      className={`cm-pin ${side}${vars.CMAP && vars.CMAP.sel === d.c ? ' on' : ''}`}
      data-cmpin={d.c}
      data-side={side}
      data-cmcity={d.c}
      style={css(`left:${x.toFixed(2)}%;top:${y.toFixed(2)}%`)}
    >
      {cmChip(d)}
    </div>
  );
}
export function cmOct(d) {
  return d.l.filter((o) => o.k === 't1').reduce((a, o) => a + o.v, 0);
}
export function cmRow(d, sel) {
  const t = d.n('t1'),
    groups = ['t1', 'sg', 'si', 'pr'].filter((k) => d.n(k));
  const lbl = {
    t1: 'Transacting',
    sg: 'Signing',
    si: 'Signed, not transacting',
    pr: 'Talking or prospect',
  };
  return (
    <div className={`cm-lr${sel === d.c ? ' on' : ''}`} data-cmrow={d.c}>
      <button type="button" className="cm-lh" data-cmcity={d.c}>
        <span className="cm-lt">
          <b>{d.c}</b>
          <span className="small quiet">{t ? money(cmOct(d)) + ' in Oct' : 'Not transacting yet'}</span>
        </span>
        <span className="cm-lc num">
          <span>{t}</span>
          <span>
            {'of '}
            {d.l.length}
          </span>
        </span>
        {ic('chev', 'sm')}
      </button>
      <div className="cm-ld">
        {groups.map((k, __k) => (
          <div key={__k} className="cm-g">
            <div className="cm-gh">
              <i className={`cm-s ${CK[k]}`} />
              <span className="lbl">{lbl[k]}</span>
              <span className="lbl num">{d.n(k)}</span>
            </div>
            {d.l
              .filter((o) => o.k === k)
              .map((o, __k) =>
                k === 't1' ? (
                  <button key={__k} type="button" className="cm-li" data-merchant={o.id}>
                    <span className="cm-ln">{o.n}</span>
                    <span className="num">{money(o.v)}</span>
                  </button>
                ) : (
                  <div key={__k} className="cm-li">
                    <span className="cm-ln">{o.n}</span>
                    <span className="quiet">{o.kind}</span>
                  </div>
                ),
              )}
          </div>
        ))}
      </div>
    </div>
  );
}
export function corridorCell(oct, run, lost, orig) {
  vars.CM_DATA = corridorData();
  const sel = vars.CMAP && vars.CMAP.sel,
    live = vars.CMAP && vars.CMAP.live && !vars.CMAP.fail;
  const nTx = TXO.length,
    nP = nTx + SIGNED.length;
  return (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Partner shops</span>
        <span className="tag">Inland Empire</span>
      </header>
      <div className="c-fig">{figSide(String(nTx), 'shops transacting', `of ${nP} partners in ${vars.CM_DATA.length} cities`)}</div>
      <div className="c-body flush">
        <div className="cm-wrap">
          <div className={`cm-host${live ? ' live' : ''}`} id="cm-host">
            <div className="cm-slot" />
            <div className="cm-fb">
              <div className="cm-stage" style={css(`--a:${cmAspect()}`)}>
                {cmBase()}
                {vars.CM_DATA.map(cmPinFb)}
              </div>
            </div>
            <div className="cm-zoom">
              <button type="button" data-cmzoom="1" aria-label="Zoom in">
                +
              </button>
              <button type="button" data-cmzoom="-1" aria-label="Zoom out">
                −
              </button>
              <button type="button" data-cmzoom="0" aria-label="Show every city">
                {ic('field', 'sm')}
              </button>
            </div>
          </div>
          <div className="cm-side">
            <div className="cm-sh">
              <span className="lbl">By city</span>
              <span className="lbl aside">Transacting of all</span>
            </div>
            <div className="cm-list">{vars.CM_DATA.map((d) => cmRow(d, sel))}</div>
          </div>
        </div>
        <div className="mkey cm-key">
          <span>
            <i className="cm-s ck-tx" />
            Transacting
          </span>
          <span>
            <i className="cm-s ck-sg" />
            Signing
          </span>
          <span>
            <i className="cm-s ck-si" />
            Signed, not transacting
          </span>
          <span>
            <i className="cm-s ck-pr" />
            Talking or prospect
          </span>
        </div>
      </div>
      {strip([
        ['Cleared in Oct', money(oct), '21 days'],
        ['Next payout run', money(run), 'Mon 2 Nov'],
        ['In talks', '7', '$52,500.00 a month'],
        ['Loss rate', pct(lost, orig), 'on shops’ own books'],
      ])}
    </section>
  );
}
/* the live map: MapLibre (the open-source Mapbox GL) on free OpenFreeMap tiles. One instance, moved into each render. */
export function cmLoadLib() {
  if (window.maplibregl) return Promise.resolve();
  return import('maplibre-gl').then((m) => {
    window.maplibregl = m.default ?? m;
  });
}
export function cmHost() {
  return document.getElementById('cm-host');
}
export function cmFail() {
  if (!vars.CMAP) vars.CMAP = {};
  vars.CMAP.fail = true;
  vars.CMAP.live = false;
  try {
    vars.CMAP.map && vars.CMAP.map.remove();
  } catch (e) {}
  vars.CMAP.map = null;
  const h = cmHost();
  if (h) {
    h.classList.remove('live');
    cmDeclutter();
  }
}
export function cmLive() {
  if (!vars.CMAP || vars.CMAP.fail || vars.CMAP.live) return;
  vars.CMAP.live = true;
  const h = cmHost();
  if (h) h.classList.add('live');
  vars.CMAP.map.resize();
  requestAnimationFrame(() => cmDeclutter());
}
export function cmBounds() {
  const ll = Object.values(CITY_LL);
  return [
    [Math.min(...ll.map((v) => v[0])) - 0.03, Math.min(...ll.map((v) => v[1])) - 0.03],
    [Math.max(...ll.map((v) => v[0])) + 0.03, Math.max(...ll.map((v) => v[1])) + 0.03],
  ];
}
export function cmMarkers() {
  if (!vars.CMAP || !vars.CMAP.map) return;
  (vars.CMAP.marks || []).forEach((m) => m.remove());
  vars.CMAP.marks = [];
  vars.CM_DATA.forEach((d) => {
    const [lng, lat] = CITY_LL[d.c],
      side = cmSide(d.c),
      el = document.createElement('div');
    el.className = `cm-pin ${side}${vars.CMAP.sel === d.c ? ' on' : ''}`;
    el.dataset.cmpin = d.c;
    el.dataset.side = side;
    el.dataset.cmcity = d.c;
    html(el, cmChip(d));
    vars.CMAP.marks.push(
      new maplibregl.Marker({
        element: el,
        anchor: 'center',
      })
        .setLngLat([lng, lat])
        .addTo(vars.CMAP.map),
    );
  });
  requestAnimationFrame(() => cmDeclutter());
}
/* labels never collide or spill off the map: the selected and busiest cities keep their shop squares, then a name-only label, then just the dot (hover shows it) */
export function cmDeclutter() {
  const h = cmHost();
  if (!h) return;
  const root = h.classList.contains('live') && vars.CMAP && vars.CMAP.el ? vars.CMAP.el : h.querySelector('.cm-fb');
  if (!root) return;
  const box = h.getBoundingClientRect(),
    kept = [],
    sel = vars.CMAP && vars.CMAP.sel,
    pins = [...root.querySelectorAll('.cm-pin')];
  const dots = pins.map((el) => [el, el.querySelector('.cm-dot').getBoundingClientRect()]);
  const rank = (el) => (el.dataset.cmpin === sel ? -1 : vars.CM_DATA.findIndex((d) => d.c === el.dataset.cmpin));
  const fits = (el) => {
    const r = el.querySelector('.cm-lab').getBoundingClientRect();
    if (
      r.left < box.left + 8 ||
      (r.right > box.right - 52 && r.top < box.top + 120) ||
      r.right > box.right - 8 ||
      r.top < box.top + 8 ||
      r.bottom > box.bottom - 24
    )
      return null;
    const hit = (k, m) => !(r.right + m < k.left || r.left - m > k.right || r.bottom + m < k.top || r.top - m > k.bottom);
    return kept.some((k) => hit(k, 6)) || dots.some(([p, k]) => p !== el && hit(k, 3)) ? null : r;
  };
  const SIDES = ['n', 'e', 's', 'w'];
  pins
    .sort((a, b) => rank(a) - rank(b))
    .forEach((el) => {
      const pref = el.dataset.side,
        order = [pref, ...SIDES.filter((x) => x !== pref)];
      let r = null;
      el.classList.remove('hid');
      for (const sd of order) {
        SIDES.forEach((x) => el.classList.toggle(x, x === sd));
        r = fits(el);
        if (r) break;
      }
      if (r) kept.push(r);
      else {
        SIDES.forEach((x) => el.classList.toggle(x, x === pref));
        el.classList.add('hid');
      }
    });
}
export function cmInit() {
  if (!window.maplibregl) return cmFail();
  let errs = 0,
    tiles = false;
  try {
    vars.CMAP.map = new maplibregl.Map({
      container: vars.CMAP.el,
      style: ML_STYLE,
      bounds: cmBounds(),
      fitBoundsOptions: {
        padding: 40,
      },
      attributionControl: {
        compact: false,
      },
      scrollZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
    });
  } catch (e) {
    return cmFail();
  }
  vars.CMAP.map.touchZoomRotate.disableRotation();
  vars.CMAP.map.on('data', (e) => {
    if (e.dataType === 'source' && e.tile) {
      tiles = true;
      if (vars.CMAP.ok) cmLive();
    }
  });
  vars.CMAP.map.on('error', () => {
    errs++;
    if (!vars.CMAP.ok || (!tiles && errs >= 4)) cmFail();
  });
  vars.CMAP.map.on('load', () => {
    vars.CMAP.ok = true;
    cmMarkers();
    if (tiles) cmLive();
  });
  vars.CMAP.map.on('moveend', () => {
    if (vars.CMAP.live) cmDeclutter();
  });
  setTimeout(() => {
    if (vars.CMAP && !vars.CMAP.fail && !tiles) cmFail();
  }, 10000);
}
export function corridorMount() {
  const host = cmHost();
  if (!host) return;
  if (!vars.CMAP || (!vars.CMAP.el && !vars.CMAP.fail)) {
    vars.CMAP = Object.assign(
      vars.CMAP || {
        sel: null,
      },
      {
        el: document.createElement('div'),
      },
    );
    vars.CMAP.el.className = 'cm-gl';
    cmLoadLib().then(cmInit, cmFail);
  }
  if (vars.CMAP.el && !vars.CMAP.fail) host.querySelector('.cm-slot').appendChild(vars.CMAP.el);
  else if (vars.CMAP.el && vars.CMAP.el.parentNode) vars.CMAP.el.remove();
  if (vars.CMAP.map) {
    vars.CMAP.map.resize();
    cmMarkers();
  }
  requestAnimationFrame(() => cmDeclutter());
  if (!window.__cmRs) {
    window.__cmRs = true;
    let t;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (vars.CMAP && vars.CMAP.map) vars.CMAP.map.resize();
        cmDeclutter();
      }, 120);
    });
  }
}
export function cmSelect(c) {
  if (!vars.CMAP)
    vars.CMAP = {
      sel: null,
    };
  vars.CMAP.sel = c && vars.CMAP.sel !== c ? c : null;
  document.querySelectorAll('[data-cmrow]').forEach((r) => r.classList.toggle('on', r.dataset.cmrow === vars.CMAP.sel));
  document.querySelectorAll('[data-cmpin]').forEach((r) => r.classList.toggle('on', r.dataset.cmpin === vars.CMAP.sel));
  if (vars.CMAP.map && vars.CMAP.live) {
    if (vars.CMAP.sel) {
      const [lng, lat] = CITY_LL[c];
      vars.CMAP.map.flyTo({
        center: [lng, lat],
        zoom: 12.2,
        duration: 700,
      });
    } else
      vars.CMAP.map.fitBounds(cmBounds(), {
        padding: 40,
        duration: 700,
      });
  } else cmDeclutter();
  const row = document.querySelector(`[data-cmrow="${vars.CMAP.sel}"]`),
    list = row && row.closest('.cm-list');
  if (row && list && list.scrollHeight > list.clientHeight + 4)
    list.scrollTo({
      top: row.offsetTop - list.offsetTop,
      behavior: 'smooth',
    });
}
export function xOverview() {
  const oct = TXO.reduce((a, m) => a + m.oct, 0),
    orig = TXO.reduce((a, m) => a + m.orig, 0),
    lost = TXO.reduce((a, m) => a + m.lost, 0);
  const run =
    TXO.filter((m) => m.terms === 'NET-30')
      .map(payOf)
      .reduce((a, p) => a + p.total, 0) +
    60 +
    40; /* plus signed-only shops' redemptions */
  const kpis = (
    <>
      {kpiCell('Transacting', '12', 'of 30 partners · Uptown Barber joined today', [0, 0, 1, 2, 3, 4, 5, 7, 8, 10, 11, 12], 'Now')}
      {kpiCell(
        'Cleared in Oct',
        money(oct),
        'through Clear at partner shops · 21 days',
        [0, 120, 480, 1100, 2300, 3900, 6100, 8800, 11900, 14600, 17300, oct],
        'Month to date',
      )}
      {kpiCell(
        'Next payout run',
        money(run),
        'Mon 2 Nov · September sales plus $10 redemptions',
        [0, 0, 0, 0, 310, 310, 310, 310, 3980, 3980, 3980, run],
        'Mon 2 Nov',
      )}
      {kpiCell(
        'Loss rate',
        pct(lost, orig),
        `${lost} of ${orig} originations, on each shop’s own book`,
        [0, 0, 0, 0, 0, 0, 0, 1.2, 1.4, 1.2, 1.1, (lost / orig) * 100],
        'All time',
      )}
    </>
  );
  const pipe = gCell(
    's-7',
    'Pipeline',
    '44 shops',
    figHtml('12', `transacting · 7 more in talks worth $52,500.00 a month in financed work`),
    stageFlow(
      [
        ['Prospect', 7, 'Walk-ins'],
        ['Talking', 7, 'Demos and calls'],
        ['Signing', 1, 'Founding 4/5'],
        ['Signed', 17, 'Redemptions only'],
        ['Transacting', 12, 'Payments on'],
      ],
      4,
      'shops',
    ),
    <div className="c-ft">
      <button type="button" data-xpane="pipeline">
        <span className="t">Open the board</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  const seats = [
    ['Rosa’s', 'filled', 'Aug'],
    ['Mesa Laundry', 'filled', 'Sep'],
    ['Uptown Barber', 'filled', 'Today'],
    ['Inland Cycle', 'signing', 'Signing'],
    ['', 'open', 'Open'],
  ];
  const seat = gCell(
    's-5',
    'Founding seats',
    'Capped at five',
    figHtml('3 of 5', 'filled · Inland Cycle Works signs for the fourth'),
    <>
      <div className="seats">
        {seats.map(([n, st, w], i) => (
          <div key={i} className={`seat ${st}`}>
            <span className="seat-n">{i + 1}</span>
            <b>{n || 'Open seat'}</b>
            <span className="seat-w">{w}</span>
          </div>
        ))}
      </div>
      <div className="how two">
        <span className="k">Rate for life</span>
        <b>2.0%, not 2.5%</b>
        <span className="k">First 20 transactions</span>
        <b>No fee</b>
      </div>
    </>,
    <div className="c-ft">
      <button type="button" data-go="home">
        <span className="t">Sign Inland Cycle Works in Needs you</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  const sorted = TXO.slice().sort((a, b) => b.oct - a.oct),
    top = sorted.slice(0, 7),
    rest = sorted.slice(7).reduce((a, m) => a + m.oct, 0),
    vmax = top[0].oct;
  const vol = gCell(
    's-7',
    'Cleared by shop',
    'October so far',
    figHtml(pct(top[0].oct, oct), `of October’s volume is ${top[0].name}, a financing shop`),
    <>
      <div className="hbars">
        {top.map((m, __k) => (
          <button key={__k} type="button" className="hb" data-merchant={m.id}>
            <span className="hb-k">{m.name}</span>
            <span className="hb-bar">
              <i style={css(`width:${((m.oct / vmax) * 100).toFixed(1)}%;background:${m.cap >= 300 ? 'var(--fg)' : 'var(--land)'}`)} />
            </span>
            <b className="num">{money(m.oct)}</b>
          </button>
        ))}
        <div className="hb rest">
          <span className="hb-k">5 more shops</span>
          <span className="hb-bar">
            <i style={css(`width:${((rest / vmax) * 100).toFixed(1)}%;background:var(--line)`)} />
          </span>
          <b className="num">{money(rest)}</b>
        </div>
      </div>
      {mkey([
        ['var(--fg)', 'Financing shops, cap $300+'],
        ['var(--land)', 'Everyday shops'],
      ])}
    </>,
    <div className="c-ft">
      <button type="button" data-xpane="partners">
        <span className="t">All partners</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  const review = TXO.filter((m) => m.hits > 0).sort((a, b) => b.hits - a.hits);
  const REC = {
    pending: ['live', 'In multisig'],
    raise: ['settled', 'Raise'],
    hold: ['underway', 'Hold'],
    ok: ['plain', 'OK'],
  };
  const caps = gCell(
    's-5',
    'Caps to review',
    'Hit the cap this week',
    figHtml(String(review.length), 'shops hit their per-sale cap this week'),
    <div className="capl">
      {review.map((m, __k) => (
        <button key={__k} type="button" className="capr" data-merchant={m.id}>
          <span className="capr-k">
            <b>{m.name}</b>
            <span className="small quiet">
              {money(m.cap)}
              {' cap · '}
              {pct(m.lost, m.orig)}
              {' loss on '}
              {m.orig}
            </span>
          </span>
          <span className="hits" aria-label={`${m.hits} cap hits`}>
            {[0, 1, 2].map((i, __k) => (
              <i key={__k} className={i < m.hits ? 'on' : ''} />
            ))}
          </span>
          <span className={`chip ${REC[capRaise(m)][0]}`}>{REC[capRaise(m)][1]}</span>
        </button>
      ))}
    </div>,
    <div className="c-ft">
      <div className="row">
        <span className="t">Raise on results: hits with no losses</span>
      </div>
    </div>,
  );
  const runs = [
    ['Rosa’s Panadería', 'NET-14 · September', 1, 412.6, '22 Oct', 'underway'],
    ['Monthly run', 'NET-30 · 9 shops', 12, run, '2 Nov', 'plain'],
    ['NET-14 shops', 'Arrowhead Nails, Cajon Phone Repair', 14, payOf(TXO[7]).total + payOf(TXO[9]).total, '4 Nov', 'plain'],
  ];
  const pay = gCell(
    's-12',
    'Payout calendar',
    'Next 30 days',
    figHtml(money(runs.reduce((a, r) => a + r[3], 0)), 'goes out to shops in the next 14 days'),
    <>
      <div className="tl xtl" role="img" aria-label={runs.map((r) => r[0] + ' on ' + r[4]).join(', ')}>
        <span className="base" />
        <span className="tick" style={css('left:0')} />
        <span className="tick" style={css('left:100%')} />
        <span className="end" style={css('left:100%;transform:translateX(-100%)')}>
          20 Nov
        </span>
        {runs.map((r, i) => (
          <Fragment key={i}>
            <span className={`mk ${i === 0 ? 'draft' : 'ready'}`} style={css(`left:${((i === 0 ? 1 : r[2]) / 30) * 100}%`)}>
              {i + 1}
            </span>
            <span className={`dt${i === 0 ? ' first' : ''}`} style={css(`left:${((i === 0 ? 1 : r[2]) / 30) * 100}%`)}>
              {i === 0 ? 'Tomorrow' : r[4]}
            </span>
          </Fragment>
        ))}
      </div>
      <div className="dlist">
        {runs.map((r, i) => (
          <div key={i} className="drow">
            <span className={`num-sq ${i === 0 ? 'draft' : 'ready'}`}>{i + 1}</span>
            <span className="dmain">
              <b>{r[0]}</b>
              <span className="small quiet">
                {r[1]}
                {' · '}
                {r[4]}
              </span>
            </span>
            <b className="num">{money(r[3])}</b>
          </div>
        ))}
      </div>
    </>,
    <div className="c-ft split">
      <button type="button" data-xpane="payouts">
        <span className="t">Payout schedule</span>
        {ic('chev', 'sm')}
      </button>
      <span className="rule" aria-hidden="true" />
      {footItem({
        t: '$430.00 in $10 redemptions owed across 11 shops',
      })}
    </div>,
  );
  return (
    <>
      {G('Where our partners are', 'Select a shop to open it', '', corridorCell(oct, run, lost, orig))}
      {G(
        'Partners',
        '',
        '',
        <>
          {pipe}
          {seat}
        </>,
      )}
      {G(
        'Volume and caps',
        '',
        '',
        <>
          {vol}
          {caps}
        </>,
      )}
      {G('Money out', '', '', pay)}
    </>
  );
}

/* ── Pipeline board: one list of shops, each with a stage. Drag a card between columns (press and drag with a mouse, touch and hold on a phone). ── */
export function kbInit() {
  if (XS.board) return;
  XS.board = [
    ...PROSPECTS.map((p, i) => ({
      id: 'p' + i,
      name: p[0],
      kind: p[1],
      city: p[2],
      val: p[3],
      owner: p[4],
      next: p[5],
      stage: p[6],
      flag: p[5] === 'Wants net-14',
    })),
    {
      id: 'icw',
      name: 'Inland Cycle Works',
      kind: 'Bikes and repair',
      city: 'Redlands',
      stage: 'signing',
      founding: 1,
      m: 'icw',
    },
    ...SIGNED.slice(1).map((s) => ({
      id: s[0],
      name: s[1],
      kind: s[2],
      city: s[3],
      stage: 'signed',
      m: s[0],
      posters: s[0] === 'tacos' ? 4 : 3,
      owed: OWED[s[0]] || 0,
    })),
  ];
  XS.board.forEach((c, i) => kbSeed(c, i));
}
export function kbCard(c) {
  const k = `data-kc="${c.id}" tabindex="0" role="button" aria-label="${c.name}, edit"`,
    open = '';
  if (c.stage === 'signing')
    return (
      <div className={`kc${c.founding ? ' flag' : ''}`} {...attrs(k)} {...attrs(open)}>
        <div className="kc-t">
          <b>{c.name}</b>
        </div>
        <span className="small quiet">
          {c.kind}
          {' · '}
          {c.city}
        </span>
        <div className="kc-m">
          {c.founding ? (
            <>
              <span className="kc-amb">Founding seat 4 of 5</span>
              <span>You sign next</span>
            </>
          ) : (
            <>
              <span>Agreement out</span>
              <span>{c.owner || 'Kai'}</span>
            </>
          )}
        </div>
      </div>
    );
  if (c.stage === 'signed' || !c.val)
    return (
      <div className="kc sm" {...attrs(k)} {...attrs(open)}>
        <b className="kc-n">{c.name}</b>
        <span className="small quiet">
          {c.kind}
          {' · '}
          {c.city}
        </span>
        <div className="kc-v">
          <span className="num">{c.owed ? money(c.owed) : '$0.00'}</span>
          <span className="small quiet">owed in redemptions</span>
        </div>
        <div className="kc-m">
          <span>{c.posters ? c.posters + ' posters' : 'No posters yet'}</span>
          <span>{c.owner || ''}</span>
        </div>
      </div>
    );
  return (
    <div className={`kc${c.flag ? ' flag' : ''}`} {...attrs(k)}>
      <b className="kc-n">{c.name}</b>
      <span className="small quiet">
        {c.kind}
        {' · '}
        {c.city}
      </span>
      <div className="kc-v">
        <span className="num">{money(c.val)}</span>
        <span className="small quiet">a month</span>
      </div>
      <span className="kc-bar">
        <i style={css(`width:${((c.val / 12000) * 100).toFixed(0)}%`)} />
      </span>
      <div className="kc-m">
        <span className="kc-nx">
          {c.next || <span className="quiet">No next step</span>}
          {kcCard(c)}
        </span>
        <span>{c.owner || <span className="quiet">No owner</span>}</span>
      </div>
    </div>
  );
}
export function kbBoard() {
  kbInit();
  const by = (st) => XS.board.filter((c) => c.stage === st),
    sum = (a) => a.reduce((x, c) => x + (c.val || 0), 0);
  const sub = {
    prospect: (a) => `${money(sum(a))} a month`,
    talking: (a) => `${money(sum(a))} a month`,
    signing: (a) => (a.some((c) => c.founding) ? 'Founding seat 4 of 5' : `${a.length} agreement${a.length === 1 ? '' : 's'} out`),
    signed: () => '$10 redemptions only',
  };
  return (
    <div className="kboard" id="kboard">
      {KST.map(([st, name], __k) => {
        const a = by(st),
          cap = st === 'signed' && !XS.allSigned ? 8 : 99;
        return (
          <section key={__k} className="kcol" data-kcol={st}>
            <header className="kcol-h">
              <div>
                <span className="lbl">{name}</span>
                <span className="small quiet">{sub[st](a)}</span>
              </div>
              <b className="fig fig-m">{a.length}</b>
            </header>
            <div className="kcol-b">
              {a.slice(0, cap).map(kbCard)}
              {a.length > 8 && st === 'signed' ? (
                <button type="button" className="kmore" data-xsigned="">
                  {XS.allSigned ? 'Show fewer' : `Show ${a.length - 8} more`}
                </button>
              ) : (
                ''
              )}
              {a.length ? '' : <div className="kempty">Drop a shop here</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
/* drag: the card lifts into a ghost that follows the pointer; its slot moves through the columns and the cards around it slide out of the way */
export function kWho() {
  return S.view && !S.view.preview ? S.view.who : 'Kai';
}
export function kcLog(c, t, type = 'edit') {
  (c.log = c.log || []).unshift([TODAY, t, kWho(), type]);
  if (['call', 'visit', 'demo', 'note'].includes(type)) c.last = TODAY;
}
export function kbTeam() {
  return PEOPLE_T.filter((p) => !p.off && p.role !== 'investors')
    .map((p) => ({
      id: p.id,
      first: p.n.split(' ')[0],
      n: p.n,
      grp: grpName(p),
      can: accOf(p)[4] >= 3,
    }))
    .concat(
      INVITES.map(([id, n, role]) => ({
        id,
        first: n.split(' ')[0],
        n,
        grp: 'Invited',
        can: false,
        inv: true,
      })),
    );
}
export function kOwner(first) {
  return kbTeam().find((t) => t.first === first);
}
export function kDue(t) {
  if (!t)
    return {
      t: 'No date',
      cls: 'none',
    };
  const d = Math.round((t - TODAY) / DAY);
  if (d < 0)
    return {
      t: `Overdue · ${fmtD(t)}`,
      cls: 'late',
    };
  if (d === 0)
    return {
      t: 'Today',
      cls: 'soon',
    };
  if (d === 1)
    return {
      t: 'Tomorrow',
      cls: 'soon',
    };
  if (d < 7)
    return {
      t:
        new Date(t).toLocaleDateString('en-US', {
          weekday: 'short',
          timeZone: 'UTC',
        }) +
        ' ' +
        fmtD(t),
      cls: '',
    };
  return {
    t: fmtD(t),
    cls: '',
  };
}
export function kAgo(t) {
  if (!t) return 'None yet';
  const d = Math.round((TODAY - t) / DAY);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
}
export function kNextDays() {
  const dow = new Date(TODAY).getUTCDay(),
    to = (w) => TODAY + ((w - dow + 7) % 7 || 7) * DAY;
  return [
    ['Today', TODAY],
    ['Tomorrow', TODAY + DAY],
    [`Fri ${fmtD(to(5)).split(' ')[0]}`, to(5)],
    [`Mon ${fmtD(to(1)).split(' ')[0]}`, to(1)],
  ];
}
export function kbSeed(c, i) {
  const due = {
    'Mission Auto Care': D(10, 22),
    'Orange Show Tires': D(10, 23),
    'Cypress Dental': D(10, 26),
    'Sun Valley HVAC': D(10, 23),
    'Barton Rd. Appliance': D(10, 28),
    'Tri-City Transmission': D(10, 20),
    'Kingston Vet': D(10, 22),
  }[c.name];
  const contact = {
    'Mission Auto Care': {
      name: 'Ray Ortega',
      role: 'Owner',
      phone: '(909) 555-0142',
      email: 'ray@missionauto.com',
    },
    'Orange Show Tires': {
      name: 'Lupe Diaz',
      role: 'Manager',
      phone: '(909) 555-0177',
      email: '',
    },
    'Sun Valley HVAC': {
      name: 'Dev Patel',
      role: 'Owner',
      phone: '(909) 555-0110',
      email: 'dev@sunvalleyhvac.com',
    },
  }[c.name] || {
    name: '',
    role: '',
    phone: '',
    email: '',
  };
  return Object.assign(c, {
    due: due || null,
    last: c.stage === 'talking' ? D(10, 13 + ((i * 3) % 8)) : null,
    contact,
    source: c.stage === 'talking' ? ['Walk-in', 'Poster', 'Referral'][i % 3] : c.stage === 'prospect' ? 'Walk-in' : 'Poster',
    addr: '',
  });
}
export function kcCard(c) {
  const due = c.due ? kDue(c.due) : null;
  return due ? <span className={`kc-due ${due.cls}`}>{due.cls === 'late' ? 'Overdue' : due.t.split(' · ')[0]}</span> : '';
}
export function kcHtml() {
  const isNew = !vars.KE.id,
    c = isNew ? vars.KE.d : XS.board.find((x) => x.id === vars.KE.id),
    ro = S.view && vLevel('merchants') < 3,
    dis = ro ? ' disabled' : '';
  const colN = (st) => XS.board.filter((x) => x.stage === st),
    sName = (st) => KST.find((s) => s[0] === st)[1],
    si = KST.findIndex((s) => s[0] === c.stage);
  const esc = (v) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  const inp = (k, val, ph, cls = '', type = 'text') => (
    <input className={`kce-in ${cls}`} data-kf={k} type={type} defaultValue={val} placeholder={ph} autoComplete="off" {...attrs(dis)} />
  );
  const team = kbTeam(),
    own = c.owner
      ? kOwner(c.owner) || {
          id: '?',
          first: c.owner,
          n: c.owner,
          grp: '',
          can: false,
        }
      : null;
  const due = kDue(c.due),
    last = isNew ? null : c.last;
  const where = isNew ? 'New prospect' : `${colN(c.stage).indexOf(c) + 1} of ${colN(c.stage).length} in ${sName(c.stage)} · added ${fmtD(c.added || D(10, 1))}`;

  /* stage: a track you can click; moving forward past Talking is a real event, so it says what will happen */
  const gate = vars.KE.stageTo && vars.KE.stageTo !== c.stage ? vars.KE.stageTo : null;
  const track = (
    <>
      <div className="kst" role="radiogroup" aria-label="Stage">
        {KST.map(([st, n], i) => (
          <button
            key={i}
            type="button"
            role="radio"
            className={`kst-s${i < si ? ' done' : ''}${i === si ? ' on' : ''}${gate === st ? ' to' : ''}`}
            data-kst={st}
            aria-checked={i === si}
            {...attrs(dis)}
          >
            <i />
            <span>{n}</span>
          </button>
        ))}
      </div>
      {gate ? (
        <div className="kst-gate">
          <span>
            {gate === 'signing'
              ? 'This sends them the merchant agreement to sign.'
              : gate === 'signed'
                ? 'Only mark signed once the agreement is back. It’s checked against Contracts.'
                : `Move from ${sName(c.stage)} to ${sName(gate)}?`}
          </span>
          <button type="button" className="btn btn-p sm" data-kstgo="">
            {gate === 'signing' ? 'Send and move' : 'Move it'}
          </button>
          <button type="button" className="kce-link" data-kstno="">
            Cancel
          </button>
        </div>
      ) : (
        ''
      )}
    </>
  );

  /* owner: picks from everyone in Permissions who can work Merchants; searchable once the team is big */
  const ownerList = vars.KE.ownerOpen
    ? (() => {
        const q = (vars.KE.ownerQ || '').toLowerCase(),
          list = [
            {
              id: '',
              first: '',
              n: 'None',
              grp: 'Nobody owns it yet',
              can: true,
              none: true,
            },
            ...team,
          ].filter((t) => !q || t.n.toLowerCase().includes(q));
        return (
          <div className="kown-pop" role="listbox">
            {team.length > 5 ? (
              <input className="kown-q" data-kownq="" placeholder="Find someone" defaultValue={vars.KE.ownerQ || ''} autoComplete="off" />
            ) : (
              ''
            )}
            {list.map((t, __k) => (
              <button
                key={__k}
                type="button"
                role="option"
                className={`kown-o${t.first === (c.owner || '') ? ' on' : ''}`}
                data-kown={t.first}
                {...attrs(t.can ? '' : ' disabled')}
              >
                <i className={`kav${t.none ? ' none' : ''}`}>{t.none ? '' : t.id}</i>
                <span>
                  <b>{t.n}</b>
                  <span className="small quiet">{t.can ? t.grp : t.inv ? 'Invited · not signed in yet' : `${t.grp} · can’t edit Merchants`}</span>
                </span>
                {t.first === (c.owner || '') ? ic('check', 'sm') : ''}
              </button>
            )) || <span className="small quiet kown-none">Nobody matches</span>}
            <span className="kown-ft small quiet">
              {'People come from Permissions · '}
              {team.filter((t) => t.can).length}
              {' can own shops'}
            </span>
          </div>
        );
      })()
    : '';
  const strip = (
    <>
      <div className={`kce-strip${isNew ? ' two' : ''}`}>
        <label className="kce-c kce-cin">
          <span className="lbl">Per month</span>
          {inp('val', c.val ? money(c.val) : '', '$0.00', 'num big')}
        </label>
        <div className="kce-c kown">
          <button type="button" className="kown-b" data-kownopen="" aria-haspopup="listbox" aria-expanded={!!vars.KE.ownerOpen} {...attrs(dis)}>
            <span className="lbl">Owner{ic('chevd', 'sm')}</span>
            <span className="kown-v">
              {own ? (
                <>
                  <i className="kav">{own.id}</i>
                  <b>{own.first}</b>
                </>
              ) : (
                <b className="none">None</b>
              )}
            </span>
          </button>
          {ownerList}
        </div>
        {isNew ? (
          ''
        ) : (
          <div className="kce-c">
            <span className="lbl">Last contact</span>
            <b className={`kce-v${last && (TODAY - last) / DAY > 10 ? ' late' : ''}`}>{kAgo(last)}</b>
          </div>
        )}
      </div>
      {own && !own.can ? (
        <span className="kce-warn">
          {own.first}
          {' can’t edit Merchants. Pick someone who can, or change their access in Permissions.'}
        </span>
      ) : (
        ''
      )}
    </>
  );

  /* next step: the thing someone actually has to do, with a date; marking it done logs it and clears the way for the next one */
  const next = (
    <div className="kce-sec">
      <div className="kce-h2">
        <span className="lbl">Next step</span>
        {c.due && due.cls === 'late' ? <span className="kc-due late">{due.t}</span> : ''}
      </div>
      <div className="kce-next">
        {inp('next', c.next, 'What happens next, e.g. demo with the owner')}
        {!isNew && c.next ? (
          <button type="button" className="kce-done" data-kdone="" title="Mark done and log it" {...attrs(dis)}>
            {ic('check', 'sm')}Done
          </button>
        ) : (
          ''
        )}
      </div>
      <div className="kce-due">
        {kNextDays().map(([t, v], __k) => (
          <button
            key={__k}
            type="button"
            data-kdue={c.due === v ? '' : v}
            aria-pressed={c.due === v}
            title={c.due === v ? 'Select again to clear' : ''}
            {...attrs(dis)}
          >
            {t}
          </button>
        ))}
        <label className={`kce-date${c.due && !kNextDays().some((x) => x[1] === c.due) ? ' on' : ''}`}>
          <svg className="i sm" viewBox="0 0 20 20" aria-hidden="true">
            <rect x="3.5" y="5" width="13" height="11.5" />
            <path d="M3.5 8.5h13M7 3v4M13 3v4" />
          </svg>
          {c.due && !kNextDays().some((x) => x[1] === c.due) ? fmtD(c.due) : 'Pick a date'}
          <input
            type="date"
            data-kf="duedate"
            defaultValue={c.due ? new Date(c.due).toISOString().slice(0, 10) : ''}
            {...attrs(dis)}
            aria-label="Pick a date"
          />
        </label>
      </div>
    </div>
  );
  const contact = (
    <div className="kce-sec">
      <span className="lbl">Who you talk to</span>
      <div className="kce-rows">
        <label className="kce-r">
          <span>Name</span>
          {inp('c.name', c.contact.name, 'Add a name')}
        </label>
        <label className="kce-r">
          <span>Role</span>
          {inp('c.role', c.contact.role, 'Owner, manager…')}
        </label>
        <label className="kce-r">
          <span>Phone</span>
          {inp('c.phone', c.contact.phone, '(909) 555-0100', '', 'tel')}
          {c.contact.phone ? (
            <a className="kce-act" href={`tel:${c.contact.phone.replace(/[^0-9+]/g, '')}`}>
              Call
            </a>
          ) : (
            ''
          )}
        </label>
        <label className="kce-r">
          <span>Email</span>
          {inp('c.email', c.contact.email, 'name@shop.com', '', 'email')}
          {c.contact.email ? (
            <a className="kce-act" href={`mailto:${c.contact.email}`}>
              Email
            </a>
          ) : (
            ''
          )}
        </label>
      </div>
    </div>
  );
  const details = (
    <div className="kce-sec">
      <span className="lbl">Shop</span>
      <div className="kce-rows">
        <label className="kce-r">
          <span>Kind</span>
          {inp('kind', c.kind, 'Auto repair, dental…')}
        </label>
        <label className="kce-r">
          <span>City</span>
          {inp('city', c.city, 'Redlands')}
        </label>
        <label className="kce-r">
          <span>Address</span>
          {inp('addr', c.addr, 'Street address')}
        </label>
        <div className="kce-r">
          <span>Source</span>
          <div className="kseg sm">
            {['Walk-in', 'Poster', 'Referral', 'Website'].map((o, __k) => (
              <button key={__k} type="button" data-ksrc={o} aria-pressed={c.source === o} {...attrs(dis)}>
                {o}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
  const hist = isNew
    ? []
    : (c.log || []).some((l) => l[1] === 'Added to the board')
      ? c.log
      : (c.log || []).concat([[c.added || D(10, 1), 'Added to the board', c.owner || 'Kai', 'edit']]);
  const activity = isNew ? (
    <div className="kce-sec">
      <span className="lbl">First note</span>
      <textarea className="kce-ta" data-kf="note" rows="3" placeholder="What they said, what they need" {...attrs(dis)} defaultValue={c.note || ''} />
    </div>
  ) : (
    <div className="kce-sec">
      <span className="lbl">Activity</span>
      {ro ? (
        ''
      ) : (
        <div className="kce-log">
          <div className="kce-lt">
            {['note', 'call', 'visit', 'demo'].map((t, __k) => (
              <button key={__k} type="button" data-klt={t} aria-pressed={(vars.KE.logType || 'note') === t}>
                {LOGT[t][0]}
              </button>
            ))}
          </div>
          <textarea
            className="kce-ta"
            id="kce-logtx"
            rows="2"
            placeholder={
              {
                note: 'Add a note',
                call: 'How did the call go?',
                visit: 'What happened at the visit?',
                demo: 'How did the demo go?',
              }[vars.KE.logType || 'note']
            }
            defaultValue={vars.KE.logDraft || ''}
          />
          <div className="kce-lb">
            <span className="small quiet">
              {'Logged as '}
              {kWho()}
              {' · today'}
            </span>
            <button type="button" className="btn btn-g sm" data-klog="">
              Log it
            </button>
          </div>
        </div>
      )}
      <ol className="kce-tl">
        {hist.slice(0, vars.KE.allLog ? 99 : 6).map(([t, w, who, ty = 'edit'], __k) => (
          <li key={__k} className={ty}>
            <i>{LOGT[ty] ? LOGT[ty][1] : '·'}</i>
            <span>
              <b>{w}</b>
              <span className="small quiet">
                {who}
                {' · '}
                {fmtD(t)}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {hist.length > 6 ? (
        <button type="button" className="kce-link" data-kall="">
          {vars.KE.allLog ? 'Show less' : `Show all ${hist.length}`}
        </button>
      ) : (
        ''
      )}
    </div>
  );
  const off =
    !isNew && !ro ? (
      vars.KE.offOpen ? (
        <div className="kce-off">
          <span className="lbl">Why is it coming off?</span>
          <div className="kseg sm wrap">
            {['Not a fit', 'Went with someone else', 'No response', 'Closed down', 'Other'].map((r, __k) => (
              <button key={__k} type="button" data-koffr={r} aria-pressed={vars.KE.offReason === r}>
                {r}
              </button>
            ))}
          </div>
          <div className="kce-lb">
            <span className="small quiet">It stays in the log and can come back.</span>
            <button type="button" className="btn btn-g sm danger" data-koffgo="" {...attrs(vars.KE.offReason ? '' : ' disabled')}>
              Take it off
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="kce-link danger" data-koff="">
          Take off the board
        </button>
      )
    ) : (
      ''
    );
  const body = (
    <>
      <div className="kce-top">
        <span className="lbl">{where}</span>
        <input
          className={`kce-in kce-title${vars.KE.err ? ' bad' : ''}`}
          data-kf="name"
          type="text"
          defaultValue={c.name}
          placeholder="Shop name"
          autoComplete="off"
          aria-label="Shop name"
          {...attrs(dis)}
        />
        {vars.KE.err ? <span className="kce-err">Give the shop a name to add it.</span> : ''}
        {track}
      </div>
      {strip}
      {next}
      {activity}
      {contact}
      {details}
      {off}
    </>
  );
  const na = NEXT_ACT[c.stage];
  const foot = ro ? (
    <>
      <span className="small quiet kce-st">Read-only in this view</span>
      <button className="btn btn-g" type="button" data-close="">
        Close
      </button>
    </>
  ) : isNew ? (
    <>
      <span className="small quiet kce-st">{c.owner ? `Owned by ${c.owner}` : 'No owner yet'}</span>
      <button className="btn btn-g" type="button" data-close="">
        Cancel
      </button>
      <button className="btn btn-p" type="button" data-kadd="">
        Add to the board
      </button>
    </>
  ) : (
    <>
      <span className="small quiet kce-st" id="kceSaved">
        {vars.KE.saved ? 'Saved · logged' : 'Changes save as you go'}
      </span>
      {c.m ? (
        <button className="btn btn-g" type="button" data-kcopen={c.m}>
          Open the shop
        </button>
      ) : (
        ''
      )}
      {na ? (
        <button className="btn btn-p" type="button" data-kst={na[1]} data-kfoot="">
          {na[0]}
        </button>
      ) : (
        <button className="btn btn-g" type="button" data-close="">
          Done
        </button>
      )}
    </>
  );
  const chip = isNew ? (
    <span className="chip plain">New</span>
  ) : (
    <span className={`chip ${c.stage === 'signing' ? 'underway' : c.stage === 'signed' ? 'settled' : 'plain'}`}>{sName(c.stage)}</span>
  );
  return (
    <>
      <header className="m-hd">
        <span className="sub">{isNew ? 'Add a prospect' : 'Shop on the board'}</span>
        <span style={css('display:flex;align-items:center;gap:8px')}>
          {chip}
          <button className="x" type="button" data-close="" aria-label="Close">
            {ic('close')}
          </button>
        </span>
      </header>
      <div className="pane-mn">{body}</div>
      <footer className="pane-ft">{foot}</footer>
    </>
  );
}
export function kcDraw() {
  const pane = document.querySelector('.pane.kce');
  if (pane) {
    const mn = pane.querySelector('.pane-mn'),
      y = mn ? mn.scrollTop : 0,
      a = document.activeElement,
      key = a && (a.dataset.kf || a.id || (a.dataset.kownq !== undefined ? 'kownq' : '')),
      pos = a && a.selectionStart;
    html(pane, kcHtml());
    const m2 = pane.querySelector('.pane-mn');
    if (m2) m2.scrollTop = y;
    if (key) {
      const el = pane.querySelector(`[data-kf="${key}"]`) || document.getElementById(key) || (key === 'kownq' && pane.querySelector('[data-kownq]'));
      if (el) {
        el.focus();
        try {
          if (pos != null) el.setSelectionRange(pos, pos);
        } catch (e) {}
      }
    }
    return;
  }
  const isNew = !vars.KE.id;
  html(
    $('#modalRoot'),
    <>
      <div className="pane-scrim" data-close="" />
      {/* Empty here and drawn as its own root, so kcDraw can redraw it in place. */}
      <aside className="pane kce" role="dialog" aria-label={isNew ? 'New prospect' : 'Shop on the board'} />
    </>,
  );
  html(document.querySelector('.pane.kce'), kcHtml());
  document.addEventListener('keydown', onKey);
  const first = isNew ? document.querySelector('.pane.kce .kce-title') : document.querySelector('.pane.kce .x');
  if (first) setTimeout(() => first.focus(), isNew ? 330 : 0);
}
export function openKc(id) {
  if (!document.querySelector('.pane.kce')) vars.lastFocus = document.activeElement;
  vars.KE = {
    id,
  };
  kcDraw();
}
export function kcNew() {
  kbInit();
  if (!document.querySelector('.pane.kce')) vars.lastFocus = document.activeElement;
  const me = kOwner(kWho());
  vars.KE = {
    id: null,
    d: {
      name: '',
      kind: '',
      city: '',
      addr: '',
      val: 0,
      next: 'First visit',
      due: TODAY + DAY,
      note: '',
      owner: me && me.can ? me.first : 'Marcus',
      stage: 'prospect',
      source: 'Walk-in',
      contact: {
        name: '',
        role: '',
        phone: '',
        email: '',
      },
      log: [],
    },
  };
  kcDraw();
}
export function kcItem() {
  return !vars.KE ? null : vars.KE.id ? XS.board.find((x) => x.id === vars.KE.id) : vars.KE.d;
}
export function kcSaved(msg) {
  vars.KE.saved = true;
  const s = document.getElementById('kceSaved');
  if (s) {
    s.textContent = msg || 'Saved · logged';
    s.classList.add('flash');
    setTimeout(() => s.classList.remove('flash'), 900);
  }
  if (vars.KE.id) render();
}
export function kcMove(c, to, how) {
  const from = c.stage;
  c.stage = to;
  const rest = XS.board.filter((x) => x !== c),
    same = rest.filter((x) => x.stage === to);
  rest.splice(same.length ? rest.indexOf(same[0]) : rest.length, 0, c);
  XS.board = rest;
  kcLog(c, how || `Moved to ${KST.find((s) => s[0] === to)[1]}`, 'stage');
  return from;
}
/* ── Pipeline board ───────────────────────────────────────────────────── */
export function xPipeline() {
  const pros = PROSPECTS.filter((p) => p[6] === 'prospect'),
    talk = PROSPECTS.filter((p) => p[6] === 'talking');
  const fmax = 12000,
    sum = (a) => a.reduce((x, p) => x + p[3], 0);
  const big = (p, flag) => (
    <div className={`kc${flag ? ' flag' : ''}`}>
      <b className="kc-n">{p[0]}</b>
      <span className="small quiet">
        {p[1]}
        {' · '}
        {p[2]}
      </span>
      <div className="kc-v">
        <span className="num">{money(p[3])}</span>
        <span className="small quiet">a month</span>
      </div>
      <span className="kc-bar">
        <i style={css(`width:${((p[3] / fmax) * 100).toFixed(0)}%`)} />
      </span>
      <div className="kc-m">
        <span>{p[5]}</span>
        <span>{p[4]}</span>
      </div>
    </div>
  );
  const row = (title, sub, right, act = '', cls = '') => (
    <div className={`kr ${cls}`} {...attrs(act)}>
      <span className="kr-k">
        <b>{title}</b>
        <span className="small quiet">{sub}</span>
      </span>
      <span className="kr-v">{right}</span>
    </div>
  );
  const col = (name, n, sub, body) => (
    <section className="kcol">
      <header className="kcol-h">
        <div>
          <span className="lbl">{name}</span>
          <span className="small quiet">{sub}</span>
        </div>
        <b className="fig fig-m">{n}</b>
      </header>
      <div className="kcol-b">{body}</div>
    </section>
  );
  const board = kbBoard();
  const boardCell = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Board</span>
        <span className="tag">Drag to move · select to edit</span>
      </header>
      <div className="c-fig" />
      <div className="c-body flush">{board}</div>
      <div className="c-ft split">
        {footItem({
          t: 'Qualify: tickets $300+, lost jobs, can wait 30 days',
        })}
        <span className="rule" aria-hidden="true" />
        {footItem({
          t: 'NET-14 only on 30-day customer terms',
        })}
      </div>
    </section>
  );
  const owners = [
    ['Marcus Lee', 9, 'var(--fg)'],
    ['Dana Ruiz', 4, 'var(--land)'],
    ['Kai', 3, 'var(--line)'],
  ];
  const kinds = [
    ['Auto and tires', 8],
    ['Furniture and mattresses', 2],
    ['Veterinary', 2],
    ['Optical', 1],
    ['Dental', 1],
    ['HVAC', 1],
    ['Appliances', 1],
  ];
  const flow = gCell(
    's-12',
    'Stages',
    'Now',
    figHtml('7', `in talks · ${money(sum(talk))} a month in financed work if they all sign`),
    stageFlow(
      [
        ['Prospect', 7, 'Walk-ins'],
        ['Talking', 7, 'Demos and calls'],
        ['Signing', 1, 'Founding 4/5'],
        ['Signed', 17, 'Redemptions only'],
        ['Transacting', 12, 'Clear payments on'],
      ],
      4,
      'shops',
    ),
  );
  const ownCell = gCell('s-5', 'Who owns the calls', '14 open', figHtml('9', 'are Marcus Lee’s, mostly auto and tire'), compBar(owners));
  const kindCell = gCell(
    's-7',
    'What kind of shops',
    '14 open',
    figHtml('8 of 14', 'are auto and tire, the strongest early fit'),
    <div className="how">
      {kinds.map(([k, v], __k) => (
        <Fragment key={__k}>
          <span className="k">{k}</span>
          <b className="num">{v}</b>
          <span className="quiet num">{pct(v, 14)}</span>
        </Fragment>
      ))}
    </div>,
  );
  const txCell = transactingCell();
  return (
    <>
      {G('Stages', 'Paid on shops signed and transacting, never on signatures', '', flow)}
      {G('Board', 'Until a shop is transacting', '', boardCell)}
      {G('Transacting', 'Select a shop to open it', '', txCell)}
      {G(
        'Open pipeline',
        '',
        '',
        <>
          {ownCell}
          {kindCell}
        </>,
      )}
    </>
  );
}

/* ── Partners ─────────────────────────────────────────────────────────── */
export function xPartners() {
  const fl = {
    all: () => true,
    tx: (m) => m.tx,
    signed: (m) => !m.tx,
    founding: (m) => m.founding,
    review: (m) => m.tx && m.hits > 0,
  };
  const rows = [
    ...TXO.map((m) => ({
      ...m,
      tx: 1,
    })),
    ...SIGNED.map((s) => ({
      id: s[0],
      name: s[1],
      kind: s[2],
      city: s[3],
      tx: 0,
      founding: s[0] === 'icw',
      signing: s[4] === 'signing',
    })),
  ];
  const opts = [
    ['all', 'All partners', rows.length],
    ['tx', 'Transacting', 12],
    ['signed', 'Signed, not transacting', 18],
    ['founding', 'Founding', 4],
    ['review', 'Hit the cap', rows.filter(fl.review).length],
  ];
  const list = rows.filter(fl[XS.pf]);
  const tbl = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Partners</span>
        <span className="hd-tools">{ddHtml('xpf', opts, XS.pf, 'Show')}</span>
      </header>
      <div className="c-fig" />
      <div className="c-body flush">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="l">Shop</th>
                <th className="l">Status</th>
                <th>Fee</th>
                <th className="l">Terms</th>
                <th>Cap</th>
                <th className="l">Cap hits</th>
                <th>Loss</th>
                <th>Oct cleared</th>
                <th>$10 owed</th>
                <th className="l">Hardware</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m, __k) => (
                <tr key={__k} className="click" data-merchant={m.id} tabIndex="0">
                  <td className="l">
                    <b>{m.name}</b>
                    <span className="quiet small">
                      {m.founding ? (
                        <>
                          <span className="fnd">Founding</span>
                          {' · '}
                        </>
                      ) : (
                        ''
                      )}
                      {m.kind}
                      {' · '}
                      {m.city}
                    </span>
                  </td>
                  <td className="l">
                    {m.tx ? (
                      <span className="chip settled">Transacting</span>
                    ) : m.signing ? (
                      <span className="chip underway">Signing</span>
                    ) : (
                      <span className="chip plain">Signed</span>
                    )}
                  </td>
                  <td>{m.tx ? m.id === 'uptown' ? <span className="quiet">Free, 7/20</span> : m.fee.toFixed(1) + '%' : <span className="quiet">–</span>}</td>
                  <td className="l">{m.tx ? m.terms : <span className="quiet">–</span>}</td>
                  <td>{m.tx ? money(m.cap).replace('.00', '') : <span className="quiet">–</span>}</td>
                  <td className="l">
                    {m.tx ? (
                      <span className="hits">
                        {[0, 1, 2].map((i, __k) => (
                          <i key={__k} className={i < m.hits ? 'on' : ''} />
                        ))}
                      </span>
                    ) : (
                      ''
                    )}
                  </td>
                  <td className={m.tx && m.lost ? 'weak' : ''}>{m.tx ? pct(m.lost, m.orig) : <span className="quiet">–</span>}</td>
                  <td>{m.tx ? money(m.oct) : <span className="quiet">–</span>}</td>
                  <td>{OWED[m.id] ? money(OWED[m.id]) : <span className="quiet">–</span>}</td>
                  <td className="l small">{m.hw || <span className="quiet">Poster only</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="c-ft">
        <div className="row">
          <span className="t">Select a shop to open it · loss rate is on each shop’s own originations</span>
        </div>
      </div>
    </section>
  );
  /* the three cells top-align their charts, so both bars and their keys sit on the same lines; notes live in the footers */
  const mix = gCell(
    's-4 ctop',
    'Terms',
    '12 transacting',
    figHtml('9 of 12', 'on NET-30, the default'),
    compBar([
      ['NET-30', 9, 'var(--fg)'],
      ['NET-14', 3, 'var(--land)'],
    ]),
    <div className="c-ft">
      <div className="row">
        <span className="t">NET-14 needs 30-day customer terms</span>
      </div>
    </div>,
  );
  const feeC = gCell(
    's-4 ctop',
    'Fees',
    '12 transacting',
    figHtml('2.5%', 'standard · founding shops pay 2.0% for life'),
    compBar([
      ['2.5%', 9, 'var(--fg)'],
      ['2.0% founding', 2, 'var(--land)'],
      ['Free, first 20', 1, 'var(--line)'],
    ]),
    <div className="c-ft">
      <div className="row">
        <span className="t">Taken out of each payout</span>
      </div>
    </div>,
  );
  const capC = gCell(
    's-4 ctop',
    'Caps',
    'Per sale',
    figHtml('$100', 'where most shops start'),
    columns(
      [
        ['$100', 5],
        ['$120', 1],
        ['$150', 3],
        ['$300', 2],
        ['$500', 1],
      ],
      {
        hi: 0,
        h: 96,
        fmt: (v) => v,
      },
    ),
    <div className="c-ft">
      <div className="row">
        <span className="t">Raised after 15 clean sales</span>
      </div>
    </div>,
  );
  return (
    <>
      {G(
        'How partners are set up',
        '',
        'g3',
        <>
          {mix}
          {feeC}
          {capC}
        </>,
      )}
      <div className="group">
        <div className="g-lbl">
          <span className="lbl">Every partner</span>
          <span className="lbl aside">30 shops</span>
        </div>
        <div className="bento">{tbl}</div>
      </div>
    </>
  );
}

/* ── Transacting: one cell. Totals, a stat strip, then a tile per shop that reflows 4 / 3 / 2 / 1 by the cell's own width. ── */
export function transactingCell() {
  const oct = TXO.reduce((a, m) => a + m.oct, 0),
    n = TXO.reduce((a, m) => a + m.octN, 0),
    orig = TXO.reduce((a, m) => a + m.orig, 0),
    lost = TXO.reduce((a, m) => a + m.lost, 0);
  const pace = (m) => (m.sept ? ((m.oct / 21) * 30) / m.sept - 1 : null);
  const sorts = {
    busy: (a, b) => b.oct - a.oct,
    growth: (a, b) => (pace(b) ?? 9) - (pace(a) ?? 9),
    az: (a, b) => a.name.localeCompare(b.name),
  };
  const list = TXO.slice().sort(sorts[XS.txsort]);
  const top3 = TXO.slice()
    .sort(sorts.busy)
    .slice(0, 3)
    .reduce((a, m) => a + m.oct, 0);
  const opts = [
    ['busy', 'Busiest', ''],
    ['growth', 'Fastest growing', ''],
    ['az', 'A to Z', ''],
  ];
  const stat = (k, v, sub) => (
    <div className="txs">
      <span className="lbl">{k}</span>
      <b className="fig fig-m">{v}</b>
      <span className="small quiet">{sub}</span>
    </div>
  );
  const tile = (m, i) => {
    const v = series(14, Math.max(14, m.octN * 3), (j) => 0.6 + 0.4 * Math.sin((j + i) / 2.5) + 0.03 * j, m.orig + 3),
      p = pace(m);
    const chg =
      p == null ? (
        <span className="tx-chg new">New</span>
      ) : (
        <span className={`tx-chg ${p >= 0 ? 'up' : 'down'}`}>
          {p >= 0 ? '+' : '−'}
          {Math.abs(p * 100).toFixed(0)}%
        </span>
      );
    return (
      <button type="button" className="tx" data-merchant={m.id}>
        <b className="tx-name">{m.name}</b>
        {chg}
        <b className="num tx-amt">{money(m.oct)}</b>
        <span className="tx-spark">{spark(v)}</span>
      </button>
    );
  };
  return (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Cleared at partner shops</span>
        <span className="tag">
          {TXO.length}
          {' shops · October'}
        </span>
      </header>
      <div className="c-fig">{figHtml(money(oct), `cleared at 12 shops in October · Uptown Barber joined today`)}</div>
      <div className="c-body flush txwrap">
        <div className="txstrip">
          {stat('Sales', int(n), 'in October')}
          {stat('Average sale', money(oct / n), 'across all shops')}
          {stat('Loss rate', pct(lost, orig), `${lost} of ${orig} originations`)}
          {stat('Top 3 shops', pct(top3, oct), 'of October’s volume')}
        </div>
        <div className="sub-hd">
          <span className="sub-hd-k">
            <span className="lbl">Each shop</span>
            <span className="small quiet">Change is October’s pace against September</span>
          </span>
          <span className="hd-tools">{ddHtml('xsort', opts, XS.txsort, 'Sort')}</span>
        </div>
        <div className="txgrid">{list.map(tile)}</div>
      </div>
      <div className="c-ft">
        <button type="button" data-xpane="partners">
          <span className="t">Full table in Partners</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
}

/* ── Payouts ──────────────────────────────────────────────────────────── */
export function xPayouts() {
  const net30 = TXO.filter((m) => m.terms === 'NET-30'),
    lines = net30.map((m) => ({
      m,
      ...payOf(m),
    }));
  const extra = [
    ['Inland Cycle Works', 60],
    ['Fontana Tacos', 40],
  ];
  const runTotal = lines.reduce((a, l) => a + l.total, 0) + extra.reduce((a, e) => a + e[1], 0);
  const sales = lines.reduce((a, l) => a + l.sales, 0),
    fees = lines.reduce((a, l) => a + l.fee, 0),
    red = lines.reduce((a, l) => a + l.red, 0) + 100;
  const collected = +(sales * 0.842).toFixed(2);
  const kpis = (
    <>
      {kpiCell('Next run', money(runTotal), 'Mon 2 Nov · 11 shops', [0, 0, 0, 0, 310, 310, 310, 310, 3980, 3980, 3980, runTotal], '2 Nov')}
      {kpiCell(
        'Already collected',
        pct(collected, sales),
        `${money(collected)} of September sales repaid by members`,
        [0, 8, 19, 31, 42, 52, 61, 69, 75, 80, 83, 84.2],
        'This run',
      )}
      {kpiCell('$10 owed', '$430.00', 'across 11 shops · paid with each run', [0, 0, 40, 90, 150, 200, 250, 300, 340, 380, 410, 430], 'Now')}
      {kpiCell(
        'Fees earned',
        money(fees + payOf(TXO[7]).fee + payOf(TXO[9]).fee),
        'on September sales',
        [0, 0, 0, 0, 0, 8, 14, 20, 28, 36, 44, fees],
        'September',
      )}
    </>
  );

  /* how the run adds up: a waterfall on one scale */
  const W = Math.max(sales, runTotal),
    x = (v) => ((v / W) * 100).toFixed(2);
  const steps = [
    ['Sales cleared', 0, sales, 'var(--fg)', money(sales)],
    ['Fees', sales - fees, sales, 'var(--absent)', '−' + money(fees)],
    ['$10 redemptions', sales - fees, sales - fees + red, 'var(--land)', '+' + money(red)],
    ['Payout', 0, runTotal, 'var(--fg)', money(runTotal)],
  ];
  const wf = gCell(
    's-7',
    'How the run adds up',
    'September · NET-30',
    figHtml(money(runTotal), 'to 11 shops on Mon 2 Nov'),
    <div className="wf">
      {steps.map(([k, a, b, c, t], i) => (
        <div key={i} className={`wf-r${i === 3 ? ' tot' : ''}`}>
          <span className="wf-k">{k}</span>
          <span className="wf-track">
            <i style={css(`left:${x(a)}%;width:${x(b - a)}%;background:${c}`)} />
          </span>
          <b className="num">{t}</b>
        </div>
      ))}
    </div>,
    <div className="c-ft">
      <button type="button" data-xrun="">
        <span className="t">Propose the run for a second approval</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  const col = gCell(
    's-5',
    'Collected before it goes out',
    'For this run',
    ringBig(0.842, `of September’s ${money(sales)} is already repaid by members`),
    <div className="how two">
      <span className="k">Collected</span>
      <b className="num">{money(collected)}</b>
      <span className="k">Still due from members</span>
      <b className="num">{money(sales - collected)}</b>
      <span className="k">Due by</span>
      <b>30 Oct</b>
    </div>,
    <div className="c-ft">
      <div className="row">
        <span className="t">Why NET-30 costs about half the cash of paying now</span>
      </div>
    </div>,
  );

  /* calendar: five weeks from Mon 19 Oct */
  const start = Date.UTC(2026, 9, 19),
    marks = {
      21: 'today',
      22: [money(412.6), 'Rosa’s'],
      33: [money(runTotal), 'Monthly run'],
      35: [money(payOf(TXO[7]).total + payOf(TXO[9]).total), 'NET-14'],
      49: [money(1140.8), 'NET-14, est.'],
    };
  const days = Array.from(
    {
      length: 35,
    },
    (_, i) => {
      const t = start + i * DAY,
        d = new Date(t),
        dn = d.getUTCDate(),
        key = i + 19;
      const m = marks[key];
      const wk = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      return (
        <div key={i} className={`cal-d${m === 'today' ? ' today' : ''}${Array.isArray(m) ? ' pay' : ''}${wk ? ' wk' : ''}${t < TODAY ? ' past' : ''}`}>
          <span className="cal-n">{dn === 1 ? MON[d.getUTCMonth()] + ' 1' : dn}</span>
          {Array.isArray(m) ? (
            <>
              <b className="num">{m[0]}</b>
              <span className="small">{m[1]}</span>
            </>
          ) : (
            ''
          )}
        </div>
      );
    },
  );
  const cal = gCell(
    's-12',
    'Payout calendar',
    '19 Oct – 22 Nov',
    figHtml('4', 'payouts in the next 30 days · NET-14 every other Wednesday'),
    <div className="cal">
      <div className="cal-h">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, __k) => (
          <span key={__k}>{d}</span>
        ))}
      </div>
      <div className="cal-g">{days}</div>
    </div>,
  );
  const runCell = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Monthly run, line by line</span>
        <span className="tag">Mon 2 Nov</span>
      </header>
      <div className="c-fig" />
      <div className="c-body flush">
        <div className="tbl-wrap">
          <table className="tbl compact">
            <thead>
              <tr>
                <th className="l">Shop</th>
                <th>Sales cleared</th>
                <th>Fee</th>
                <th>$10 redemptions</th>
                <th>Payout</th>
                <th className="l">Share of run</th>
                <th className="l">Clears to</th>
              </tr>
            </thead>
            <tbody>
              {lines
                .sort((a, b) => b.total - a.total)
                .map((l, __k) => (
                  <tr key={__k}>
                    <td className="l">
                      <b>{l.m.name}</b>
                    </td>
                    <td>{money(l.sales)}</td>
                    <td className="quiet">{l.fee ? '−' + money(l.fee) : 'Free'}</td>
                    <td>{l.red ? money(l.red) : <span className="quiet">–</span>}</td>
                    <td>
                      <b>{money(l.total)}</b>
                    </td>
                    <td className="l">
                      <span className="share">
                        <span className="sharebar">
                          <i style={css(`width:${((l.total / runTotal) * 100).toFixed(1)}%`)} />
                        </span>
                        <span className="small quiet">{pct(l.total, runTotal)}</span>
                      </span>
                    </td>
                    <td className="l mono small">····{String(4000 + l.m.orig * 37).slice(-4)}</td>
                  </tr>
                ))}
              {extra.map(([n, v], __k) => (
                <tr key={__k} className="rest">
                  <td className="l">
                    <b>{n}</b>
                    <span className="quiet small">Signed · redemptions only</span>
                  </td>
                  <td>–</td>
                  <td>–</td>
                  <td>{money(v)}</td>
                  <td>
                    <b>{money(v)}</b>
                  </td>
                  <td className="l">
                    <span className="share">
                      <span className="sharebar">
                        <i style={css(`width:${((v / runTotal) * 100).toFixed(1)}%`)} />
                      </span>
                      <span className="small quiet">{pct(v, runTotal)}</span>
                    </span>
                  </td>
                  <td className="l mono small">····{String(5000 + v * 13).slice(-4)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="l">
                  <b>Run total</b>
                </td>
                <td>{money(sales)}</td>
                <td>−{money(fees)}</td>
                <td>{money(red)}</td>
                <td>{money(runTotal)}</td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div className="c-ft">
        <div className="row">
          <span className="t">Every account verified · proposed by one person, approved by another</span>
        </div>
      </div>
    </section>
  );
  const months = [
    ['Aug', 310],
    ['Sep', 3980.4],
    ['Oct', 4520.4],
    ['Nov', runTotal + 412.6],
  ];
  const hist = gCell(
    's-7',
    'Paid to shops',
    'By month',
    figHtml(money(months[3][1]), 'scheduled for November, the biggest month yet'),
    columns(months, {
      hi: 3,
      h: 140,
      fmt: (v) => money(v),
    }),
  );
  const n14 = [TXO[0], TXO[7], TXO[9]].map((m) => ({
    m,
    ...payOf(m),
  }));
  const n14c = gCell(
    's-5',
    'NET-14 shops',
    'Paid every two weeks',
    figHtml('3', 'shops on NET-14, all on 30-day customer terms'),
    <div className="how three">
      {n14.map((l, __k) => (
        <Fragment key={__k}>
          <span className="k">{l.m.name}</span>
          <span className="quiet small">{l.m.id === 'rosas' ? '22 Oct' : '4 Nov'}</span>
          <b className="num">{money(l.total)}</b>
        </Fragment>
      ))}
    </div>,
    <div className="c-ft">
      <button type="button" data-go="home">
        <span className="t">Rosa’s is waiting in Needs you</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  return (
    <>
      {G('At a glance', '', '', metricsCell(kpis))}
      {G(
        'The next run',
        'Payouts are a receivables purchase on NET-30',
        '',
        <>
          {wf}
          {col}
        </>,
      )}
      {G('When money goes out', '', '', cal)}
      {G('Line by line', '', '', runCell)}
      {G(
        'History',
        '',
        '',
        <>
          {hist}
          {n14c}
        </>,
      )}
    </>
  );
}

/* ── Hardware ─────────────────────────────────────────────────────────── */
export function xHardware() {
  /* the fleet: one row per shop, one square per device under its type, problems first */
  const FT = [
    ['P', 'Point', 'At the counter'],
    ['t', 'Table Point', 'At the table'],
    ['T', 'Tap dock', 'Card reader'],
    ['C', 'Counter', 'Tablet'],
  ];
  const fleet = [
    [
      'citrus',
      {
        P: ['on'],
        t: ['on', 'on', 'on', 'low', 'on', 'off'],
      },
      'Table 4 battery low · table 6 offline since Tue',
      '2 min ago',
    ],
    [
      'orange',
      {
        P: ['off'],
      },
      'Point unplugged since 08:40',
      '08:40',
    ],
    [
      'rosas',
      {
        P: ['on'],
        T: ['on'],
      },
      '',
      'Now',
    ],
    [
      'tire',
      {
        T: ['on'],
        C: ['on'],
      },
      '',
      'Now',
    ],
    [
      'hdw',
      {
        T: ['on'],
        C: ['on'],
      },
      '',
      '1 min ago',
    ],
    [
      'uptown',
      {
        P: ['on'],
      },
      '',
      'Now',
    ],
    [
      'mesa',
      {
        P: ['on'],
      },
      '',
      '3 min ago',
    ],
    [
      'books',
      {
        P: ['on'],
      },
      '',
      'Now',
    ],
    [
      'mich',
      {
        P: ['on'],
      },
      '',
      'Now',
    ],
    [
      'nails',
      {
        P: ['on'],
      },
      '',
      '4 min ago',
    ],
    [
      'phone',
      {
        T: ['on'],
      },
      '',
      'Now',
    ],
    [
      'pet',
      {
        P: ['on'],
      },
      '',
      '1 min ago',
    ],
  ];
  const all = fleet.flatMap((f) => Object.values(f[1]).flat()),
    total = all.length,
    off = all.filter((x) => x === 'off').length,
    low = all.filter((x) => x === 'low').length;
  const visit = fleet.filter((f) => f[2]),
    byType = (k) => fleet.reduce((a, f) => a + (f[1][k] || []).length, 0);
  const kpis = (
    <>
      {kpiCell(
        'Devices out',
        String(total),
        `${byType('P') + byType('t')} Clear Points, ${byType('T')} Tap docks, ${byType('C')} Counters`,
        [0, 0, 2, 4, 6, 8, 10, 13, 15, 17, 19, total],
        'Now',
      )}
      {kpiCell(
        'Online',
        pct(total - off, total),
        `${off} offline · ${low} battery low`,
        [100, 100, 100, 95, 100, 100, 94, 100, 95, 90, 95, ((total - off) / total) * 100],
        'Now',
      )}
      {kpiCell('Pre-orders', '19', 'devices across 7 shops · deposits held', [0, 0, 0, 0, 2, 2, 5, 8, 11, 14, 17, 19], 'Open')}
      {kpiCell('Unit cost', '$61.00', 'repaired, against $189.00 new', [88, 84, 80, 76, 74, 71, 69, 66, 64, 63, 62, 61], 'Average')}
    </>
  );
  const ST = {
    on: 'Online',
    low: 'Battery low',
    off: 'Offline',
  };
  const sq = (k, list) =>
    list ? (
      <span className="fv-q">
        {list.map((st, i) => (
          <i key={i} className={`fv-s ${st}`} title={`${FT.find((t) => t[0] === k)[1]}${list.length > 1 ? ' ' + (i + 1) : ''} · ${ST[st]}`} />
        ))}
      </span>
    ) : (
      <span className="quiet">—</span>
    );
  const rows = fleet.map(([id, d, note, seen], __k) => {
    const m = TXO.find((x) => x.id === id),
      bad = Object.values(d)
        .flat()
        .some((x) => x === 'off')
        ? 'off'
        : Object.values(d)
              .flat()
              .some((x) => x === 'low')
          ? 'low'
          : '';
    return (
      <tr key={__k} className={`fv-r${bad ? ' ' + bad : ''}`} data-merchant={id}>
        <td className="l">
          <span className="fv-n">
            <b>{m.name}</b>
            <span className="small quiet">{m.city}</span>
            <span className={`fv-st fv-m${bad ? ' ' + bad : ''}`}>{bad ? note : 'All online'}</span>
          </span>
        </td>
        {FT.map(([k], __k) => (
          <td key={__k} className="l fv-d">
            {sq(k, d[k])}
          </td>
        ))}
        <td className="l quiet fv-d">{seen}</td>
        <td className="l fv-d">
          <span className={`fv-st${bad ? ' ' + bad : ''}`}>{bad ? note : 'All online'}</span>
        </td>
        <td className="fv-all">{sq('P', Object.values(d).flat())}</td>
      </tr>
    );
  });
  const fleetCell = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Devices at shops</span>
        <span className="tag">
          {total}
          {' devices at '}
          {fleet.length}
          {' shops'}
        </span>
      </header>
      <div className="c-fig">{figSide(String(visit.length), 'shops need a visit', `${off} device${off === 1 ? '' : 's'} offline · ${low} battery low`)}</div>
      <div className="c-body flush">
        <div className="tbl-wrap">
          <table className="tbl compact fv">
            <thead>
              <tr>
                <th className="l">Shop</th>
                {FT.map(([, n], __k) => (
                  <th key={__k} className="l fv-d">
                    {n}
                  </th>
                ))}
                <th className="l fv-d">Last check-in</th>
                <th className="l fv-d">Status</th>
                <th className="fv-all">Devices</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
        <div className="mkey fv-key">
          <span>
            <i className="fv-s on" />
            Online
          </span>
          <span>
            <i className="fv-s low" />
            Battery low
          </span>
          <span>
            <i className="fv-s off" />
            Offline
          </span>
          <span className="quiet">One square per device · select a shop to open it</span>
        </div>
      </div>
      <div className="c-ft split">
        <button type="button" data-go="field">
          <span className="t">
            {'Add '}
            {visit.map((f) => TXO.find((x) => x.id === f[0]).name.split(' ')[0]).join(' and ')}
            {' to today’s route'}
          </span>
          {ic('chev', 'sm')}
        </button>
        <span className="rule" aria-hidden="true" />
        {footItem({
          t: 'Points report in every 2 minutes',
        })}
      </div>
    </section>
  );
  const refurb = gCell(
    's-7',
    'Refurb line',
    'Used and damaged Samsung units',
    figHtml('8', 'ready to ship · 10 still in repair or testing'),
    stageFlow(
      [
        ['Bought', 14, 'Awaiting repair'],
        ['Repairing', 6, 'Screens, ports'],
        ['Testing', 4, '48-hour soak'],
        ['Ready', 8, 'In stock'],
        ['Shipped', 21, 'At shops'],
      ],
      3,
      'units',
    ),
  );
  const cost = gCell(
    's-5',
    'What a unit costs',
    'Average, repaired',
    figHtml('68%', 'less than buying the same unit new'),
    <>
      {compBar([
        ['Used unit', 38, 'var(--fg)', '$38.00'],
        ['Parts', 14, 'var(--land)', '$14.00'],
        ['Labour', 9, 'var(--line)', '$9.00'],
      ])}
      <div className="how two">
        <span className="k">Repaired</span>
        <b className="num">$61.00</b>
        <span className="k">New, same model</span>
        <b className="num">$189.00</b>
      </div>
    </>,
  );
  const inv = [
    ['Clear Point · counter', 9, 4, 6],
    ['Clear Point · table', 6, 2, 0],
    ['Clear Tap dock', 4, 2, 1],
    ['Clear Counter tablet', 2, 0, 3],
  ];
  const invCell = gCell(
    's-7',
    'Inventory',
    'By device',
    figHtml('8', 'in stock today'),
    <>
      <div className="flush-x">
        <div className="tbl-wrap">
          <table className="tbl compact" style={css('min-width:460px')}>
            <thead>
              <tr>
                <th className="l">Device</th>
                <th>At shops</th>
                <th>In stock</th>
                <th>In repair</th>
                <th className="l">Split</th>
              </tr>
            </thead>
            <tbody>
              {inv.map(([k, d, s, r], __k) => (
                <tr key={__k}>
                  <td className="l">
                    <b>{k}</b>
                  </td>
                  <td>{d}</td>
                  <td>{s}</td>
                  <td>{r}</td>
                  <td className="l">
                    <span className="minibar">
                      <i style={css(`flex:${d};background:var(--fg)`)} />
                      <i style={css(`flex:${s || 0.001};background:var(--land)`)} />
                      <i style={css(`flex:${r || 0.001};background:var(--line)`)} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {mkey([
        ['var(--fg)', 'At shops'],
        ['var(--land)', 'In stock'],
        ['var(--line)', 'In repair'],
      ])}
    </>,
  );
  const DEP = {
    Point: 40,
    Tap: 60,
    Counter: 90,
    table: 30,
  };
  const pre = [
    [
      'Mission Auto Care',
      [
        ['Point', 1],
        ['Tap', 1],
      ],
      'Thu 29 Oct',
    ],
    [
      'Sun Valley HVAC',
      [
        ['Counter', 1],
        ['Tap', 1],
      ],
      'Mon 2 Nov',
    ],
    [
      'Base Line Pho',
      [
        ['Point', 1],
        ['table', 6],
      ],
      'Fri 6 Nov',
    ],
    [
      'Fontana Tacos',
      [
        ['Point', 1],
        ['table', 4],
      ],
      'Fri 6 Nov',
    ],
    ['Kingston Vet', [['Point', 1]], 'Thu 29 Oct'],
    ['Colton Cuts', [['Point', 1]], 'Thu 29 Oct'],
    ['Mentone Coffee', [['Point', 1]], 'Mon 2 Nov'],
  ];
  const depOf = (p) => p[1].reduce((a, [k, n]) => a + DEP[k] * n, 0),
    depTot = pre.reduce((a, p) => a + depOf(p), 0);
  const preCell = gCell(
    's-5',
    'Pre-orders',
    'Refundable until made',
    figHtml(money(depTot), 'in deposits for 19 devices'),
    <div className="how three">
      {pre.map((p, __k) => (
        <Fragment key={__k}>
          <span className="k">{p[0]}</span>
          <span className="quiet small">{p[2]}</span>
          <b className="num">{money(depOf(p))}</b>
        </Fragment>
      ))}
    </div>,
  );
  return (
    <>
      {G('At a glance', '', '', metricsCell(kpis))}
      {G('In the field', '', '', fleetCell)}
      {G(
        'Making them',
        '',
        '',
        <>
          {refurb}
          {cost}
        </>,
      )}
      {G(
        'Stock and orders',
        '',
        '',
        <>
          {invCell}
          {preCell}
        </>,
      )}
    </>
  );
}
/* ── Merchant record ──────────────────────────────────────────────────── */
export function merchantPane() {
  if (XS.merchant == null) return '';
  const m = TXO.find((x) => x.id === XS.merchant),
    s = SIGNED.find((x) => x[0] === XS.merchant);
  if (!m && !s) return '';
  let body, foot, chip;
  if (m) {
    const p = payOf(m),
      ci = CAPS.indexOf(m.cap);
    const daily = series(21, m.octN, (i) => 0.6 + 0.4 * Math.sin(i / 3) + 0.02 * i, m.orig);
    chip = <span className="chip settled">Transacting</span>;
    body = (
      <>
        <div>
          <p className="h2" style={css('font-size:28px')}>
            {m.name}
          </p>
          <p className="quiet" style={css('margin:8px 0 0')}>
            {m.kind}
            {' · '}
            {m.city}
            {m.founding ? ' · founding partner' : ''}
          </p>
        </div>
        <div className="pp-figs">
          <div>
            <span className="lbl">Oct cleared</span>
            <span className="fig fig-l">{money(m.oct)}</span>
          </div>
          <div>
            <span className="lbl">Originations</span>
            <span className="fig fig-l">{m.orig}</span>
          </div>
          <div>
            <span className="lbl">Loss</span>
            <span className="fig fig-l">{pct(m.lost, m.orig)}</span>
          </div>
        </div>
        <div>
          <span className="lbl">Sales a day, October</span>
          {columns(
            daily.map((v, i) => [i % 5 === 0 ? String(i + 1) : '', v]),
            {
              h: 64,
              fmt: () => '',
            },
          )}
        </div>
        <div>
          <span className="lbl">Per-sale cap</span>
          <div className="ladder">
            {CAPS.map((c, i) => (
              <span key={i} className={`lad ${i < ci ? 'past' : i === ci ? 'cur' : m.id === 'rosas' && c === 150 ? 'next' : ''}`}>
                {money(c).replace('.00', '')}
              </span>
            ))}
          </div>
          <span className="small quiet">
            {m.hits ? `Hit the cap ${m.hits} time${m.hits > 1 ? 's' : ''} this week.` : 'No cap hits this week.'}{' '}
            {capRaise(m) === 'pending'
              ? 'Raise to $150.00 is in the multisig, 2/3 signed.'
              : capRaise(m) === 'raise'
                ? 'Clean record, ready to raise.'
                : capRaise(m) === 'hold'
                  ? 'Hold until the loss clears.'
                  : ''}
          </span>
        </div>
        <div className="rows ledger">
          <div className="r">
            <span className="k">Fee</span>
            <span className="v">{m.id === 'uptown' ? 'Free for the first 20 transactions' : m.fee.toFixed(1) + '%'}</span>
          </div>
          <div className="r">
            <span className="k">Terms</span>
            <span className="v">{m.terms}</span>
          </div>
          <div className="r">
            <span className="k">Next payout</span>
            <span className="v">
              {money(p.total)}
              {' · '}
              {m.id === 'rosas' ? '22 Oct' : m.terms === 'NET-14' ? '4 Nov' : '2 Nov'}
            </span>
          </div>
          <div className="r">
            <span className="k">$10 owed</span>
            <span className="v">{OWED[m.id] ? money(OWED[m.id]) : 'None'}</span>
          </div>
          <div className="r">
            <span className="k">Hardware</span>
            <span className="v">{m.hw}</span>
          </div>
        </div>
      </>
    );
    foot = (
      <>
        <button className="btn btn-g" type="button" data-xturnoff={m.id}>
          Turn off payments
        </button>
        {capRaise(m) === 'raise' ? (
          <button className="btn btn-p" type="button" data-xcap={m.id}>
            Propose a cap raise{ic('out')}
          </button>
        ) : (
          ''
        )}
      </>
    );
  } else {
    chip = s[4] === 'signing' ? <span className="chip underway">Signing</span> : <span className="chip plain">Signed</span>;
    body = (
      <>
        <div>
          <p className="h2" style={css('font-size:28px')}>
            {s[1]}
          </p>
          <p className="quiet" style={css('margin:8px 0 0')}>
            {s[2]}
            {' · '}
            {s[3]}
          </p>
        </div>
        <div className="note">
          {ic('chev', 'sm')}
          <span>
            <b>{s[4] === 'signing' ? 'Founding seat 4 of 5.' : 'Taking $10 redemptions.'}</b>{' '}
            {s[4] === 'signing'
              ? 'They signed 20 Oct. Your signature is waiting in Needs you.'
              : 'Clear payments aren’t on yet. Turn them on once the shop is ready.'}
          </span>
        </div>
        <div className="rows ledger">
          <div className="r">
            <span className="k">$10 owed</span>
            <span className="v">{OWED[s[0]] ? money(OWED[s[0]]) : 'None'}</span>
          </div>
          <div className="r">
            <span className="k">Posters</span>
            <span className="v">{s[0] === 'icw' ? 3 : s[0] === 'tacos' ? 4 : 3}</span>
          </div>
          <div className="r">
            <span className="k">Hardware</span>
            <span className="v">Poster only</span>
          </div>
        </div>
      </>
    );
    foot =
      s[4] === 'signing' ? (
        <button className="btn btn-p" type="button" data-go="home">
          Open Needs you
        </button>
      ) : (
        <button className="btn btn-p" type="button" data-xon={s[0]}>
          Turn on Clear payments
        </button>
      );
  }
  return (
    <>
      <div className="pane-scrim" data-closexpane="" />
      <aside className="pane" role="dialog" aria-label="Shop">
        <header className="m-hd">
          <span className="sub">Shop</span>
          <span style={css('display:flex;align-items:center;gap:8px')}>
            {chip}
            <button className="x" type="button" data-closexpane="" aria-label="Close">
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
export function openXFlow(kind, id) {
  vars.lastFocus = document.activeElement;
  const m = TXO.find((x) => x.id === id) || {
    name: (SIGNED.find((x) => x[0] === id) || [])[1],
  };
  const next = m.cap ? CAPS[CAPS.indexOf(m.cap) + 1] || m.cap : 0;
  const f = {
    cap: {
      t: 'Propose a cap raise',
      h: m.name,
      rows: [
        ['From', money(m.cap || 0)],
        ['To', money(next)],
        ['Why', `${m.hits} cap hits this week, ${pct(m.lost || 0, m.orig || 1)} loss on ${m.orig} originations`],
        ['Contract', 'MerchantRegistry v1.0 · Base Sepolia'],
        ['Signatures', 'Needs 2 of 3 in the multisig', 1],
      ],
      btn: 'Prepare for the multisig',
      steps: ['Prepared the transaction', 'Opened it in the multisig', 'Waiting for signatures there'],
      done: ['Handed to the multisig.', 'It goes live when two of three sign. No keys live in this app.'],
    },
    off: {
      t: 'Turn off payments',
      h: m.name,
      rows: [
        ['What stops', 'New Clear payments at this shop'],
        ['What stays', '$10 redemptions, payouts owed, their history'],
        ['Undo', 'Turn it back on any time', 1],
      ],
      btn: 'Turn off payments',
      steps: ['Paused new payments at this shop', 'Kept payouts owed on schedule', 'Logged who turned it off'],
      done: ['Payments turned off.', 'Payouts already owed still go out on time.'],
    },
    on: {
      t: 'Turn on Clear payments',
      h: m.name,
      rows: [
        ['Fee', '2.5%'],
        ['Terms', 'NET-30'],
        ['Starting cap', '$100.00 per sale'],
        ['Counter', 'Clear Point ships in 3 days', 1],
      ],
      btn: 'Turn on payments',
      steps: ['Set the shop to 2.5% on NET-30', 'Set a $100.00 cap', 'Queued a Clear Point'],
      done: ['Payments turned on.', 'They can take Clear at the counter once the Point arrives.'],
    },
    run: {
      t: 'Propose the monthly run',
      h: 'Mon 2 Nov',
      rows: [
        ['Shops', '11'],
        ['Pays', 'September sales and $10 redemptions'],
        ['Approval', 'Someone else approves before it goes', 1],
      ],
      btn: 'Propose the run',
      steps: ['Totalled September for 11 shops', 'Checked every bank account on file', 'Sent it to Needs you for a second approval'],
      done: ['Run proposed.', 'It goes out Mon 2 Nov once someone else approves.'],
    },
    add: {
      t: 'Add a prospect',
      h: 'New shop',
      rows: [
        ['Qualify', 'Tickets $300+'],
        ['Ask early', 'Can they wait 30 days?'],
        ['Owner', 'You', 1],
      ],
      btn: 'Add to the board',
      steps: ['Added the shop to Prospect', 'Set you as the owner'],
      done: ['Prospect added.', 'It’s on the board under Prospect.'],
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
      {kind === 'add' ? (
        <label className="field">
          <span className="lbl">Shop</span>
          <input id="xa-name" type="text" defaultValue="Sunnymead Auto" autoComplete="off" />
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
      {kind === 'cap' ? (
        <div className="note">
          {ic('out', 'sm')}
          <span>
            <b>You sign in the multisig.</b>
            {' The app only prepares the change.'}
          </span>
        </div>
      ) : (
        ''
      )}
      <div className="acts">
        <button className="btn btn-p" type="button" data-xgo={kind}>
          {f.btn}
          {kind === 'cap' ? ic('out') : ''}
        </button>
        <button className="btn btn-g" type="button" data-close="">
          Not now
        </button>
      </div>
    </>,
    'Every change is logged',
  );
  document.addEventListener('keydown', onKey);
  openXFlow.f = f;
}

/* ══ Field ══════════════════════════════════════════════════════════════
   Built for a phone on the poster route. Ties to Home ("Poster route 3/8 · Marcus Lee"),
   Growth (P-044 faded at Mesa Laundry, swaps due) and Merchants (Orange St. Point unplugged since 08:40,
   Citrus Bowl table 4 battery low). */
