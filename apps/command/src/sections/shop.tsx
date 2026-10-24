// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { dollars, live, picked, typed } from '../live/actions';
import { LIVE, REAL } from '../live/env';
import { api } from '../live/api';
import { attrs, css } from '../runtime/dom';
import { D, laneFrame, pctX } from './contracts';
import { compBar, head, ic, money } from './core';
import {
  BUYERS,
  DAY,
  GLY,
  GP_W,
  INCOMING,
  LINES,
  NOW,
  ORDERS,
  ORD_W,
  OST,
  PARTNERS,
  PAID_WITH,
  PAY,
  PR,
  PRE,
  PRE_ST,
  RETURNS,
  RETURN_WHY,
  REV_W,
  SHELF,
  SHELF_EV,
  SHIP_DAYS,
  SHIST,
  SHOP,
  SIZES,
  SIZE_MIX,
  SS,
  STK,
  SW,
  TODAY,
  goods,
  vars,
} from './data';
import { kv, sec, vModal } from './governance';
import { G, columns, figHtml, fmtD, gCell, kpiCell } from './growth';
import { mkey, vizTrack } from './home';
import { ddHtml } from './kit';
import { evRows, strip } from './money';
import { vLevel } from './shell';
export function prOf(id) {
  return PR.find((p) => p.id === id);
}
export function pName(p) {
  return `${p.n} · ${p.v}`;
}
export function onHand(id) {
  return STK[id]
    ? Object.values(STK[id])
        .flat()
        .reduce((a, b) => a + b, 0)
    : null;
}
export function unitCost(p) {
  return p.c ? p.c.reduce((a, b) => a + b, 0) : 0;
}
export function u4(p) {
  return p.wk.slice(-4).reduce((a, b) => a + b, 0);
}
export function ordOf(id) {
  return ORDERS.find((o) => o[0] === id);
}
/** A restock on its way for a product: ordered, not just planned. */
export function restockFor(p) {
  return INCOMING.find((r) => r[4] === p.id && !r[2].some((s) => s[0] === 'plan'));
}
/** The return for an order, and the one still waiting on its refund. */
export function retOf(id) {
  return RETURNS.find((r) => r.order === id);
}
export function waitingReturn() {
  return RETURNS.find((r) => r.refundedAt == null);
}
/** A return's refund track: returned, who proposed it, the second person, refunded. */
export function retTrack(r) {
  return vizTrack([
    ['Returned', 1],
    [r.proposedBy, 1],
    ...(r.second ? [[r.second, r.refundedAt ? 1 : 2]] : []),
    ['Refunded', r.refundedAt ? 1 : 0],
  ]);
}
/** Days from paid to handed to the carrier: the median bucket, and the share within 2 days. */
export function shipTimes() {
  const total = SHIP_DAYS.reduce((a, b) => a + b[1], 0);
  if (!total) return { median: '—', within2: 0 };
  let c = 0;
  const median = SHIP_DAYS.find(([, n]) => (c += n) >= total / 2)[0];
  return { median, within2: SHIP_DAYS.slice(0, 3).reduce((a, b) => a + b[1], 0) / total };
}
const pc0 = (v) => `${(v * 100).toFixed(0)}%`;
/* a share of a total that may be nothing yet: 0, not NaN */
const per = (a, b) => (b ? a / b : 0);
/* the line's word for a product whose variants share a price: "Graphic", "Patches" */
const lineWord = (p) => (p.line === 'graphic' || p.line === 'patch' ? LINES[p.line][0].split(' ')[0] : p.n);
export function ordTotal(o) {
  return o[4].reduce((a, [pid, , , q]) => a + prOf(pid).price * q, 0);
}
export function ordShip(o) {
  return o[6] === 'ship' ? 6 : 0;
}
export function ordTax(o) {
  return Math.round(ordTotal(o) * 0.0775 * 100) / 100;
}
export function ordAge(o) {
  return (NOW - o[1]) / DAY;
}
export function coverW(p) {
  const h = onHand(p.id),
    r = u4(p) / 4;
  return r ? h / r : null;
}
export function glyph(p, cls = '') {
  return (
    <span className={`sp-g ${cls}${p.st === 'arch' ? ' arch' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 40 40">{GLY[p.g]}</svg>
    </span>
  );
}
export function k$(v) {
  return v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + Math.round(v);
}
export function shortN(p) {
  return p.line === 'graphic'
    ? p.v
    : p.line === 'patch'
      ? 'Patch · ' + p.v
      : p.line === 'logo' && p.id !== 'ft'
        ? 'Logo Tee · ' + p.v.split(' ')[0]
        : p.id === 'c8' || p.id === 'c10'
          ? 'Counter · ' + p.v
          : p.n;
}
/* ── drawing ──────────────────────────────────────────────────────────── */
export function waterfall() {
  const S = SHOP,
    steps = [
      ['Sales', 0, S.rev, 'tot'],
      ['Product cost', S.rev - S.cost, S.rev, 'neg'],
      ['Shipping', S.rev - S.cost - S.ship, S.rev - S.cost, 'neg'],
      ['Fees', S.gross, S.gross + S.fees, 'neg'],
      ['Gross profit', 0, S.gross, 'tot'],
      ['Running the line', S.left, S.gross, 'neg'],
      ['For marketing', 0, S.left, 'keep'],
    ];
  const max = 5500,
    Y = (v) => (v / max) * 100;
  return (
    <div className="wfl" role="img" aria-label={steps.map((s) => s[0] + ' ' + money(s[2] - s[1])).join(', ')}>
      <div className="wfl-p">
        {[0, 2000, 4000].map((v, __k) => (
          <i key={__k} className="wfl-g" style={css(`bottom:${Y(v)}%`)}>
            <span>{v ? '$' + v / 1000 + 'k' : '0'}</span>
          </i>
        ))}
        {steps.map(([k, lo, hi, c], i) => (
          <div key={i} className="wfl-c">
            <span className={`wfl-v ${c}`} style={css(`bottom:${Y(hi)}%`)}>
              {c === 'neg' ? '−' : ''}
              {k$(hi - lo)}
            </span>
            <i className={`wfl-b ${c}`} style={css(`bottom:${Y(lo)}%;height:${Y(hi - lo)}%`)} />
            {i < steps.length - 1 ? <em className="wfl-j" style={css(`bottom:${Y(c === 'neg' ? lo : hi)}%`)} /> : ''}
          </div>
        ))}
      </div>
      <div className="wfl-x">
        {steps.map(([k], __k) => (
          <span key={__k}>{k}</span>
        ))}
      </div>
    </div>
  );
}
export function stackCols() {
  const lines = ['logo', 'graphic', 'layers', 'patch'],
    mx = Math.max(...REV_W),
    H = 150;
  const notes = REAL
    ? {}
    : {
        2: 'Long sleeve',
        4: 'Graphic Tees',
        5: 'Hoodie sold out',
      };
  return (
    <>
      <div className="scol sc8" style={css(`--colh:${H}px`)}>
        {SW.map((w, i) => {
          const parts = lines.map((l) => goods.filter((p) => p.line === l).reduce((a, p) => a + p.wk[i] * p.price, 0));
          return (
            <div key={i} className={`mcol${i === SW.length - 1 ? ' now' : ''}`}>
              <span className="cv2">{k$(REV_W[i])}</span>
              <span className="mcol-s">
                {parts.map((v, k) =>
                  v ? (
                    <i
                      key={k}
                      style={css(`height:${((v / mx) * H).toFixed(1)}px;background:${LINES[lines[k]][1]}`)}
                      title={`${LINES[lines[k]][0]} ${money(v)}`}
                    />
                  ) : (
                    ''
                  ),
                )}
              </span>
              <span className="ck">{w}</span>
            </div>
          );
        })}
      </div>
      <div className="sc-notes">
        {SW.map((_, i) => (
          <span key={i}>
            {notes[i] ? (
              <>
                <i />
                {notes[i]}
              </>
            ) : (
              ''
            )}
          </span>
        ))}
      </div>
    </>
  );
}
export function ladder(list) {
  const max = 112,
    parts = [
      ['Blank or base', 'var(--fg)'],
      ['Making', 'var(--fg-50)'],
      ['Label and packing', 'var(--line)'],
    ];
  return (
    <>
      <div className="ld">
        {list.map((p, __k) => {
          const c = p.c,
            m = p.price - unitCost(p);
          return (
            <button key={__k} type="button" className="ld-r" data-product={p.id}>
              <span className="ld-k">
                <b>
                  {p.v === 'Short sleeve' || p.v === 'Long sleeve'
                    ? p.n + ' · ' + p.v.split(' ')[0]
                    : p.line === 'graphic'
                      ? p.v
                      : p.n === 'Clear patch'
                        ? 'Patch · ' + p.v
                        : p.n}
                </b>
              </span>
              <span className="ld-b">
                <span className="ld-t" style={css(`width:${(p.price / max) * 100}%`)}>
                  <i style={css(`flex:${c[0]};background:${parts[0][1]}`)} />
                  {c[1] ? <i style={css(`flex:${c[1]};background:${parts[1][1]}`)} /> : ''}
                  <i style={css(`flex:${c[2] + c[3]};background:${parts[2][1]}`)} />
                  <i className="ld-m" style={css(`flex:${m}`)} />
                </span>
                <em style={css(`left:${(p.price / max) * 100}%`)}>{money(p.price).replace('.00', '')}</em>
              </span>
              <b className="num">{((m / p.price) * 100).toFixed(0)}%</b>
            </button>
          );
        })}
        <div className="ld-ax">
          <span />
          <span className="ld-axl">
            {[0, 25, 50, 75, 100].map((v, __k) => (
              <span key={__k} style={css(`left:${(v / max) * 100}%`)}>
                ${v}
              </span>
            ))}
          </span>
          <span />
        </div>
      </div>
      {mkey([...parts.map(([n, c]) => [c, n]), ['var(--hair)', 'Margin, the share kept']])}
    </>
  );
}
/* the scatter's labels, and which side of the dot they sit */
const SC_LBL = {
  lts: ['Logo SS', 'r'],
  ltl: ['Logo LS', 'r'],
  tn: ['Turtleneck', 'r'],
  hd: ['Hoodie', 'r'],
  gcm: ['Carousel Mall', 'r'],
  gtt: ['Two Ten', 'l'],
  psq: ['Square', 'r'],
  pci: ['Circle', 'l'],
};
export const scName = (p) => SC_LBL[p.id]?.[0] ?? shortN(p);
export function scatter() {
  const pts = goods.filter((p) => p.st !== 'arch' && u4(p)),
    xm = 36,
    ym = 70,
    lbl = SC_LBL;
  const rmax = Math.max(...pts.map((p) => u4(p) * p.price));
  return (
    <>
      <div className="spt">
        <div className="spt-y">
          {[0, 20, 40, 60].map((v, __k) => (
            <span key={__k} style={css(`bottom:${(v / ym) * 100}%`)}>
              ${v}
            </span>
          ))}
        </div>
        <div className="spt-p">
          {[0, 20, 40, 60].map((v, __k) => (
            <i key={__k} className="spt-g" style={css(`bottom:${(v / ym) * 100}%`)} />
          ))}
          {[0, 12, 24, 36].map((v, __k) => (
            <i key={__k} className="spt-gv" style={css(`left:${(v / xm) * 100}%`)} />
          ))}
          {pts.map((p, __k) => {
            const x = (u4(p) / xm) * 100,
              y = ((p.price - unitCost(p)) / ym) * 100,
              r = 8 + 12 * Math.sqrt((u4(p) * p.price) / rmax),
              [t, s] = lbl[p.id];
            return (
              <button
                key={__k}
                type="button"
                className="spt-d"
                data-product={p.id}
                style={css(`left:${x}%;bottom:${y}%;--r:${r.toFixed(1)}px;--c:${LINES[p.line][1]}`)}
                title={pName(p)}
              >
                <i />
                <span className={s}>{t}</span>
              </button>
            );
          })}
        </div>
        <div className="spt-x">
          {[0, 12, 24, 36].map((v, __k) => (
            <span key={__k} style={css(`left:${(v / xm) * 100}%`)}>
              {v}
            </span>
          ))}
        </div>
      </div>
      <div className="spt-cap">
        <span>Margin per item</span>
        <span>Sold in 4 weeks →</span>
      </div>
    </>
  );
}
export function stockGrid() {
  const rows = goods
    .filter((p) => p.st !== 'arch' && p.line !== 'patch')
    .flatMap((p) =>
      Object.entries(STK[p.id]).map(([col, v], k) => ({
        p,
        col,
        v,
        first: k === 0,
      })),
    );
  const max = 18;
  const cell = (n, i, on) => (
    <span className={`sg-c${!on ? ' q' : n === 0 ? ' z' : n <= 2 && i > 0 && i < 5 ? ' lo' : ''}`} style={css(`--a:${Math.min(1, n / max)}`)}>
      <b>{on || n ? n : '–'}</b>
    </span>
  );
  return (
    <>
      <div className="sg">
        <div className="sg-r sg-h">
          <span>Product</span>
          <span>Colour</span>
          {SIZES.map((s, __k) => (
            <span key={__k}>{s}</span>
          ))}
          <span>Total</span>
        </div>
        {rows.map(({ p, col, v, first }, __k) => (
          <button key={__k} type="button" className={`sg-r${first ? ' first' : ''}${p.st === 'draft' ? ' draft' : ''}`} data-product={p.id}>
            <span className="sg-k">{first ? <b>{pName(p)}</b> : ''}</span>
            <span className="sg-col">
              <i className={`sw-c ${col.toLowerCase()}`} />
              {col}
            </span>
            {v.map((n, i) => cell(n, i, p.st === 'on'))}
            <b className="num">{v.reduce((a, b) => a + b, 0)}</b>
          </button>
        ))}
        {rows.length ? '' : <span className="small quiet">None yet.</span>}
      </div>
      <div className="mkey">
        <span>
          <i className="sg-k1" />
          Fewer to more on hand
        </span>
        <span>
          <i className="sg-k2" />
          Two or fewer, S to XL
        </span>
        <span>
          <i className="sg-k3" />
          Out
        </span>
        <span>
          <i className="sg-k4" />
          Not on the shelf
        </span>
      </div>
    </>
  );
}
export function coverBars() {
  const list = goods.filter((p) => p.st === 'on' || p.st === 'off').map((p) => [p, coverW(p)]),
    mx = 24;
  return (
    <>
      <div className="cvb">
        {list.map(([p, w], __k) => {
          const short = w !== null && w < p.lead,
            out = onHand(p.id) === 0;
          return (
            <button key={__k} type="button" className="wb-r cvb-r" data-product={p.id}>
              <span className="wb-k">{shortN(p)}</span>
              <span className="wb-b">
                {out ? (
                  <span className="cvb-out" style={css(`left:calc(${(p.lead / mx) * 100}% + 8px)`)}>
                    {REAL ? 'Out of stock' : 'Out · 120 arrive 30 Oct'}
                  </span>
                ) : (
                  <i style={css(`width:${Math.min(100, (w / mx) * 100)}%;${short ? 'background:var(--underway)' : ''}`)} />
                )}
                <em style={css(`left:${(p.lead / mx) * 100}%`)} />
              </span>
              <b className={`num${short || out ? ' warn' : ''}`}>{out ? '0' : w >= mx ? '24+' : w.toFixed(1)}</b>
            </button>
          );
        })}
        {list.length ? '' : <span className="small quiet">None yet.</span>}
        <div className="wb-ax">
          <span />
          <span className="wb-axl">
            <span>0</span>
            <span>6 wk</span>
            <span>12 wk</span>
            <span>18 wk</span>
            <span>24 wk</span>
          </span>
          <span />
        </div>
      </div>
      {mkey([
        ['var(--fg)', 'Weeks of stock at the last 4 weeks’ pace'],
        ['var(--underway)', 'Runs out before a reorder lands'],
        ['var(--fg-50)', 'Tick · time to restock'],
      ])}
    </>
  );
}
export function incomingLanes() {
  const from = D(9, 28),
    to = D(12, 31);
  const rows = INCOMING.map(([t, s, segs, tag, pid], __k) => (
    <button key={__k} type="button" className="ln-r" data-product={pid}>
      <span className="ln-k">
        <b>{t}</b>
        <span>{s}</span>
      </span>
      <span className="ln-l">
        {segs.map(([k, a, b], __k) => (
          <i key={__k} className={`in-s ${k}`} style={css(`left:${pctX(a, from, to)}%;width:${pctX(b, from, to) - pctX(a, from, to)}%`)} />
        ))}
        <i className={`gb-tag${pid === 'tn' ? '' : ' in'}`} style={css(`left:${pctX(segs[segs.length - 1][2], from, to)}%`)}>
          {tag}
        </i>
      </span>
    </button>
  ));
  return (
    <>
      {laneFrame(rows, from, to, 14, 'gt in-ln')}
      <div className="mkey">
        <span>
          <i className="in-k done" />
          Ordered
        </span>
        <span>
          <i className="in-k make" />
          Being made
        </span>
        <span>
          <i className="in-k ship" />
          On the way
        </span>
        <span>
          <i className="in-k plan" />
          Planned
        </span>
      </div>
    </>
  );
}
export function shelfLanes() {
  const from = D(8, 24),
    to = D(11, 8),
    list = PR.filter((p) => SHELF_EV[p.id]);
  const rows = list.map((p, __k) => (
    <button key={__k} type="button" className="ln-r" data-product={p.id}>
      <span className="ln-k">
        <b>{shortN(p)}</b>
        <span>
          {SHELF[p.st][1]}
          {p.st === 'on' && p.dep ? ' · pre-order' : ''}
        </span>
      </span>
      <span className="ln-l">
        {SHELF_EV[p.id].map(([k, a, b], __k) => (
          <i key={__k} className={`sh ${k}`} style={css(`left:${pctX(a, from, to)}%;width:${Math.max(0.6, pctX(b, from, to) - pctX(a, from, to))}%`)} />
        ))}
        {p.st === 'arch' ? <i className="sh-x" style={css(`left:${pctX(D(8, 31), from, to)}%`)} /> : ''}
      </span>
    </button>
  ));
  return (
    <>
      {laneFrame(rows, from, to, 14, 'gt sh-ln')}
      <div className="mkey">
        <span>
          <i className="sh-k on" />
          On the shelf
        </span>
        <span>
          <i className="sh-k off" />
          Off the shelf
        </span>
        <span>
          <i className="sh-k draft" />
          Draft
        </span>
        <span>
          <i className="sh-k proj" />
          Back on, planned
        </span>
        <span>
          <i className="sh-k x" />
          Archived
        </span>
      </div>
    </>
  );
}
export function pipeline() {
  const st = [
    ['paid', 'To pack', 'Paid, not packed'],
    ['packed', 'Packed', 'Waiting on a label scan'],
    ['shipped', 'On the way', 'With the carrier'],
    ['ready', 'Ready for pickup', 'At a partner shop'],
    ['closed', 'Done', 'Last 4 weeks'],
  ];
  // done in the last 4 weeks: the weeks' orders less the ones still on their way
  const cnt = (k) => (k === 'closed' ? SHOP.ord - ORDERS.filter((o) => st.slice(0, 4).some(([s]) => s === o[8])).length : ORDERS.filter((o) => o[8] === k).length);
  const ages = (k) => (k === 'closed' ? [] : ORDERS.filter((o) => o[8] === k).sort((a, b) => a[1] - b[1]));
  return (
    <>
      <div className="flow5">
        {st.map(([k, t, s], i) => (
          <button key={i} type="button" className={`f5-c${k === 'paid' ? ' hot' : ''}`} {...attrs(k === 'closed' ? 'data-sof="all"' : `data-sof="${k}"`)}>
            <span className="lbl">{t}</span>
            <b className="fig fig-l">{cnt(k)}</b>
            <span className="small quiet">{s}</span>
            <span className="f5-a">
              {k === 'closed' ? (
                <>
                  <span className="f5-bar">
                    <i style={css(`width:${per(SHOP.shipped, SHOP.ord) * 100}%`)} />
                  </span>
                  <span className="small quiet">
                    {SHOP.shipped}
                    {' shipped · '}
                    {SHOP.picked}
                    {' picked up'}
                  </span>
                </>
              ) : (
                ages(k).map((o, __k) => {
                  const a = ordAge(o);
                  return <i key={__k} className={a > 2 ? 'old' : a > 1 ? 'mid' : ''} title={`#${o[0]} · ${a.toFixed(1)} days`} />;
                })
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="mkey">
        <span>
          <i className="f5-k" />
          Under a day
        </span>
        <span>
          <i className="f5-k mid" />
          1–2 days
        </span>
        <span>
          <i className="f5-k old" />
          Over 2 days
        </span>
      </div>
    </>
  );
}
export function itemsLine(o) {
  return o[4]
    .map(([pid, col, sz, q]) => {
      const p = prOf(pid);
      return `${q > 1 ? q + ' × ' : ''}${p.line === 'graphic' ? p.v : p.line === 'patch' ? 'Patch · ' + p.v.toLowerCase() : pName(p)}${sz ? ' · ' + sz : ''}`;
    })
    .join(', ');
}
/* ── page ─────────────────────────────────────────────────────────────── */
export function shopPage() {
  // at Totals the orders are only counted: the list of buyers isn't shown
  const totals = LIVE && vLevel('shop') === 1;
  if (totals && SS.pane === 'orders') SS.pane = 'overview';
  const P = SS.pane,
    onShelf = PR.filter((p) => p.st === 'on').length,
    toPack = ORDERS.filter((o) => o[8] === 'paid').length,
    low = goods.filter((p) => p.st === 'on' && coverW(p) !== null && coverW(p) < p.lead);
  const title =
    P === 'overview'
      ? `${money(SHOP.left)} left for marketing.`
      : P === 'products'
        ? `${onShelf} products on the shelf.`
        : P === 'inventory'
          ? `${['Nothing needs', 'One product needs', 'Two products need', 'Three products need'][low.length] ?? `${low.length} products need`} a reorder.`
          : `${['No orders', 'One order', 'Two orders', 'Three orders', 'Four orders', 'Five orders', 'Six orders'][toPack] ?? `${toPack} orders`} to pack.`;
  const tools =
    P === 'inventory' ? (
      <button className="btn btn-p" type="button" data-sflow="restock" data-sid="tn">
        Restock
      </button>
    ) : P === 'orders' ? (
      <>
        <button className="btn btn-g hide-s" type="button" data-sflow="labels">
          Print labels
        </button>
        <button
          className="btn btn-p"
          type="button"
          data-sflow="pack"
          data-sid={ORDERS.filter((o) => o[8] === 'paid').sort((a, b) => a[1] - b[1])[0]?.[0] || ''}
        >
          <span className="dot pulse" style={css('color:var(--btn-dot)')} aria-hidden="true" />
          Pack the oldest
        </button>
      </>
    ) : (
      <button className="btn btn-p" type="button" data-sflow="add">
        Add a product
      </button>
    );
  const tabs = [
    ['overview', 'Overview'],
    ['products', 'Products'],
    ['inventory', 'Inventory'],
    ['orders', 'Orders'],
  ].filter(([v]) => !(totals && v === 'orders'));
  const body = {
    overview: sOverview,
    products: sProducts,
    inventory: sInventory,
    orders: sOrders,
  }[P]();
  return (
    <>
      {head(
        <>
          {'Shop · '}
          <b>useclear.org/shop</b>
        </>,
        title,
        <span className="ph-tools">{tools}</span>,
      )}
      <nav className="ptabs" aria-label="Shop panes">
        {tabs.map(([v, t], __k) => (
          <button key={__k} type="button" data-spane={v} aria-current={P === v ? 'page' : 'false'}>
            {t}
          </button>
        ))}
      </nav>
      {body}
      {shopPane()}
    </>
  );
}
export function sOverview() {
  const S = SHOP,
    L = SW.length - 1,
    aov = REV_W.map((r, i) => per(r, ORD_W[i]));
  const kpis = (
    <>
      {kpiCell('Sales', money(S.rev), `+${((S.rev / S.prev - 1) * 100).toFixed(1)}% on the 4 weeks before`, REV_W, '4 weeks')}
      {kpiCell('Gross profit', money(S.gross), `${((S.gross / S.rev) * 100).toFixed(1)}% of sales, after cost, shipping and fees`, GP_W, '4 weeks')}
      {kpiCell('Orders', String(S.ord), `${(S.items / S.ord).toFixed(1)} items each · ${toPackN()} to pack now`, ORD_W, '4 weeks')}
      {kpiCell('Average order', money(S.rev / S.ord), 'before shipping and tax', aov, '4 weeks')}
    </>
  );
  const wf = gCell(
    's-7',
    'Where each dollar goes',
    'Last 4 weeks',
    figHtml(money(S.left), 'left for marketing · after the goods, shipping, fees and running the line'),
    waterfall(),
    strip([
      ['Product margin', `${(per(S.rev - S.cost, S.rev) * 100).toFixed(1)}%`, 'before shipping and fees'],
      ['Sales tax held', money(S.tax), 'paid with the return'],
      ['Deposits held', money(PRE.filter((r) => r[5] === 'held').reduce((a, r) => a + prOf(r[2]).price * r[4], 0)), 'refundable'],
    ]),
  );
  const who = gCell(
    's-5',
    'Who buys',
    'Last 4 weeks',
    figHtml(pc0(per(BUYERS[0]?.[1] ?? 0, S.ord)), 'of orders come from members · the rest are guests'),
    <div className="sb">
      <div className="ablock">
        <span className="lbl">Buyer</span>
        {BUYERS.length ? compBar(BUYERS.map(([k, v], i) => [k, v, ['var(--fg)', 'var(--line)'][i], String(v)])) : <span className="small quiet">None yet.</span>}
      </div>
      <div className="ablock">
        <span className="lbl">Paid with</span>
        {PAID_WITH.length ? (
          compBar(PAID_WITH.map(([k, v], i) => [k, v, ['var(--fg)', 'var(--fg-50)', 'var(--line)'][i], String(v)]))
        ) : (
          <span className="small quiet">None yet.</span>
        )}
      </div>
      <div className="ablock">
        <span className="lbl">Gets it by</span>
        {compBar([
          ['Shipping', S.shipped, 'var(--fg)', String(S.shipped)],
          ['Pickup at a partner shop', S.picked, 'var(--land)', String(S.picked)],
        ])}
      </div>
    </div>,
    strip([
      ['Paid with Clear', pc0(per(PAID_WITH[0]?.[1] ?? 0, S.ord))],
      ['Picked up', `${S.picked} of ${S.ord}`],
    ]),
  );
  const trend = gCell(
    's-12',
    'Sales by week',
    'Since the shop opened 1 Sep',
    figHtml(
      money(Math.max(...REV_W)),
      Math.max(...REV_W)
        ? `the best week so far · ${SW[REV_W.indexOf(Math.max(...REV_W))]}${REAL ? '' : ', when the Graphic Tees were new'}`
        : 'the best week so far · no sales yet',
    ),
    <>
      {stackCols()}
      {mkey(['logo', 'graphic', 'layers', 'patch'].map((l) => [LINES[l][1], LINES[l][0]]))}
    </>,
    strip([
      ['8 weeks', money(REV_W.reduce((a, b) => a + b, 0))],
      ['Orders', String(ORD_W.reduce((a, b) => a + b, 0))],
      ['Products on the shelf', String(PR.filter((p) => p.st === 'on' && !p.dep).length)],
      ...goods
        .filter((p) => p.st === 'off' && restockFor(p))
        .slice(0, 1)
        .map((p) => [`${p.n} back`, restockFor(p)[3], '', 'warn']),
    ]),
  );
  const top = goods
      .filter((p) => u4(p))
      .map((p) => [p, u4(p) * p.price])
      .sort((a, b) => b[1] - a[1]),
    tm = top[0]?.[1];
  const topCell = gCell(
    's-6',
    'What sells',
    'Sales, last 4 weeks',
    top.length ? figHtml(shortN(top[0][0]), `the top seller · ${u4(top[0][0])} sold, ${money(top[0][1])}`) : '',
    <div className="hbars">
      {top.map(([p, v], __k) => (
        <button key={__k} type="button" className="hb" data-product={p.id}>
          <span className="hb-k">{shortN(p)}</span>
          <span className="hb-bar">
            <i style={css(`width:${(v / tm) * 100}%;background:${LINES[p.line][1]}`)} />
          </span>
          <b className="num">{money(v)}</b>
        </button>
      ))}
      {top.length ? '' : <span className="small quiet">None yet.</span>}
    </div>,
    <div className="c-ft">
      <button type="button" data-spane="products">
        <span className="t">Every product</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  const sizes = gCell(
    's-6',
    'Sizes sold',
    'Shirts and layers, last 4 weeks',
    figHtml(
      pc0(
        per(
          SIZE_MIX.filter(([k]) => k === 'M' || k === 'L').reduce((a, b) => a + b[1], 0),
          SIZE_MIX.reduce((a, b) => a + b[1], 0),
        ),
      ),
      'of shirts sold are a medium or large · restocks follow that mix',
    ),
    SIZE_MIX.length ? (
      columns(SIZE_MIX, {
        hi: 2,
        h: 150,
      })
    ) : (
      <span className="small quiet">None yet.</span>
    ),
    <div className="c-ft">
      <button type="button" data-spane="inventory">
        <span className="t">Stock by size</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  return (
    <>
      {G('The shelf', 'Select a product', '', shelfCell())}
      {G(
        'Money',
        'Margins cover the line and fund marketing',
        '',
        <>
          {wf}
          {who}
        </>,
      )}
      {G('The trend', '', '', trend)}
      {G(
        'What people buy',
        '',
        '',
        <>
          {topCell}
          {sizes}
        </>,
      )}
    </>
  );
}
export function toPackN() {
  return ORDERS.filter((o) => o[8] === 'paid').length;
}
export function shelfCell() {
  const S = SHOP,
    list = PR.filter((p) => p.st !== 'arch');
  const tiles = list.map((p, __k) => {
    const h = onHand(p.id),
      w = coverW(p),
      low = !p.dep && p.st === 'on' && w !== null && w < p.lead,
      out = h === 0 && p.st !== 'draft';
    const stock = p.dep ? (
      <span className="shf-st">Pre-order</span>
    ) : p.st === 'draft' ? (
      <span className="shf-st">Not stocked</span>
    ) : (
      <span className={`shf-st${out ? ' out' : low ? ' low' : ''}`}>{out ? 'Out' : h + ' on hand'}</span>
    );
    const lv = p.dep || p.st === 'draft' ? 0 : Math.min(1, (w || 0) / 12);
    return (
      <button key={__k} type="button" className={`shf-t ${p.st}`} data-product={p.id}>
        {glyph(p)}
        <span className="shf-k">
          <b>{shortN(p)}</b>
          <span className="small quiet">
            {money(p.price).replace('.00', '')}
            {p.dep ? ' deposit' : ''}
          </span>
        </span>
        <span className="shf-u">
          <b className="num">{u4(p)}</b>
          <span className="small quiet">{p.dep ? 'pre-ordered' : 'sold'}</span>
        </span>
        <span className="shf-m">
          <i style={css(`width:${(lv * 100).toFixed(0)}%`)} {...attrs(out ? ' class="out"' : low ? ' class="low"' : '')} />
        </span>
        {stock}
        {p.st !== 'on' ? <span className={`chip ${SHELF[p.st][0]} shf-c`}>{SHELF[p.st][1]}</span> : ''}
      </button>
    );
  });
  return (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">What’s for sale</span>
        <span className="tag">useclear.org/shop</span>
      </header>
      <div className="c-fig">
        {figHtml(money(S.rev), `in sales over 4 weeks · +${(S.prev ? (S.rev / S.prev - 1) * 100 : 0).toFixed(1)}% on the 4 weeks before · ${S.ord} orders`)}
      </div>
      <div className="c-body">
        {tiles.length ? <div className="shf">{tiles}</div> : <span className="small quiet">None yet.</span>}
        <div className="mkey">
          <span>
            <i className="sw" style={css('background:var(--fg)')} />
            Weeks of stock, full at 12
          </span>
          <span>
            <i className="sw" style={css('background:var(--underway)')} />
            Runs out before a reorder lands
          </span>
          <span>Sold and pre-ordered are the last 4 weeks</span>
        </div>
      </div>
      {strip([
        ['Gross profit', money(S.gross), `${(per(S.gross, S.rev) * 100).toFixed(1)}% of sales`],
        ['Average order', money(per(S.rev, S.ord)), `${per(S.items, S.ord).toFixed(1)} items`],
        ['To pack', String(toPackN()), 'paid, not packed', 'warn'],
        ['On the shelf', `${PR.filter((p) => p.st === 'on').length} of ${list.length}`],
      ])}
    </section>
  );
}
export function sProducts() {
  const cnt = (k) => PR.filter((p) => p.st === k).length;
  const opts = [
    ['all', 'All', PR.length],
    ['on', 'On shelf', cnt('on')],
    ['off', 'Off shelf', cnt('off')],
    ['draft', 'Drafts', cnt('draft')],
    ['arch', 'Archived', cnt('arch')],
  ];
  const list = PR.filter((p) => (SS.pf === 'all' ? p.st !== 'arch' || false : p.st === SS.pf)).concat(SS.pf === 'all' ? PR.filter((p) => p.st === 'arch') : []);
  const rows = list.map((p, __k) => {
    const h = onHand(p.id),
      m = p.dep ? null : (p.price - unitCost(p)) / p.price,
      wm = Math.max(1, ...p.wk);
    return (
      <button key={__k} type="button" className={`cat-r${p.st === 'arch' ? ' arch' : ''}`} data-product={p.id}>
        {glyph(p)}
        <span className="cat-k">
          <b>{pName(p)}</b>
          <span className="small quiet">
            {LINES[p.line][0]}
            {p.why ? ' · ' + p.why : ''}
          </span>
        </span>
        <span className="cat-p">
          <b className="num">{money(p.price)}</b>
          <span className="small quiet">{p.dep ? 'deposit' : 'each'}</span>
        </span>
        <span className="cat-m">
          {m === null ? (
            <span className="small quiet">Refundable</span>
          ) : (
            <>
              <span className="cat-mb">
                <i style={css(`width:${m * 100}%`)} />
              </span>
              <b className="num">{(m * 100).toFixed(0)}%</b>
            </>
          )}
        </span>
        <span className="cat-s">
          {h === null ? (
            <span className="small quiet">Made to order</span>
          ) : (
            <>
              <b className={`num${h === 0 && (p.st === 'on' || p.st === 'off') ? ' warn' : ''}`}>{h}</b>
              <span className="small quiet">{p.st === 'draft' ? 'not stocked' : p.st === 'arch' ? 'none left' : 'on hand'}</span>
            </>
          )}
        </span>
        <span className="cat-w">
          {p.wk.map((v, i) => (
            <i key={i} style={css(`height:${v ? Math.max(8, (v / wm) * 100) : 0}%`)} {...attrs(i === p.wk.length - 1 ? ' class="now"' : '')} />
          ))}
        </span>
        <span className="cat-c">
          <span className={`chip ${SHELF[p.st][0]}`}>{SHELF[p.st][1]}</span>
        </span>
      </button>
    );
  });
  const cat = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">{SS.pf === 'all' ? 'Every product' : opts.find((o) => o[0] === SS.pf)[1]}</span>
        <span className="hd-tools">{ddHtml('spf', opts, SS.pf, 'Show')}</span>
      </header>
      <div className="c-fig">
        {figHtml(String(cnt('on')), `on the shelf · ${cnt('off')} off, ${cnt('draft')} drafts, ${cnt('arch')} archived · select one to edit it`)}
      </div>
      <div className="c-body start">
        <div className="cat">
          <div className="cat-r cat-h">
            <span />
            <span>Product</span>
            <span>Price</span>
            <span>Margin</span>
            <span>Stock</span>
            <span>8 weeks</span>
            <span>Shelf</span>
          </div>
          {rows.length ? rows : <span className="small quiet">None yet.</span>}
        </div>
      </div>
      {strip([
        ['Lines', String(Object.keys(LINES).length)],
        ['Off shelf', String(cnt('off')), PR.filter((p) => p.st === 'off').map((p) => p.n).join(', '), 'warn'],
        ['Drafts', String(cnt('draft'))],
        ['Pre-orders', String(PR.filter((p) => p.dep && p.st === 'on').length)],
      ])}
    </section>
  );
  const priced = goods.filter((p) => p.st !== 'arch' && !(p.line === 'graphic' && p.id !== 'gcm') && p.id !== 'pci');
  const margin = (p) => (p.price - unitCost(p)) / p.price,
    byCost = [...priced].sort((a, b) => unitCost(a) - unitCost(b)),
    byMargin = [...priced].sort((a, b) => margin(a) - margin(b));
  const sold = goods.filter((p) => p.st !== 'arch' && u4(p)),
    most = (f) => sold.reduce((a, p) => (f(p) > f(a) ? p : a)),
    perItem = (p) => p.price - unitCost(p);
  const lad = gCell(
    's-7',
    'Where the price goes',
    'Cost of one item',
    figHtml(
      `${(per(goods.filter((p) => p.st === 'on').reduce((a, p) => a + (p.price - unitCost(p)) / p.price, 0), goods.filter((p) => p.st === 'on').length) * 100).toFixed(0)}%`,
      'average margin · enough to run the line and fund marketing, no more',
    ),
    priced.length ? ladder(priced) : <span className="small quiet">None yet.</span>,
    priced.length
      ? strip([
          ['Cheapest to make', `${shortN(byCost[0]).split(' · ')[0]} · ${money(unitCost(byCost[0]))}`],
          ['Costliest', `${shortN(byCost.at(-1)).split(' · ')[0]} · ${money(unitCost(byCost.at(-1)))}`],
          ['Lowest margin', `${lineWord(byMargin[0])} · ${pc0(margin(byMargin[0]))}`],
          ['Highest margin', `${lineWord(byMargin.at(-1))} · ${pc0(margin(byMargin.at(-1)))}`],
        ])
      : '',
  );
  const sc = gCell(
    's-5',
    'Margin and volume',
    'Size is sales',
    sold.length ? figHtml(scName(most((p) => u4(p) * perItem(p))), 'earns the most · a modest margin, sold most often') : '',
    sold.length ? scatter() : <span className="small quiet">None yet.</span>,
    sold.length
      ? strip([
          ['Most sold', `${scName(most(u4))} · ${u4(most(u4))}`],
          ['Most per item', `${scName(most(perItem))} · ${money(perItem(most(perItem)))}`],
        ])
      : '',
  );
  const hist = gCell(
    's-12',
    'On and off the shelf',
    Object.keys(SHELF_EV).length ? `Since ${fmtD(Math.min(...Object.values(SHELF_EV).flat().map((e) => e[1])))}` : '',
    figHtml(
      String(
        Object.values(SHIST)
          .flat()
          .filter((h) => /shelf|Archived|pre-orders/.test(h[1])).length,
      ),
      'shelf changes · select a product to see why',
    ),
    shelfLanes(),
    strip([
      ...PR.filter((p) => p.st === 'off').map((p) => ['Off now', `${p.n} · ${onHand(p.id) ? 'off' : 'sold out'}`, '', 'warn']),
      ...backOn().map(([p, t]) => ['Back on', `${scName(p)} · ${fmtD(t)}`]),
      ...PR.filter((p) => p.st === 'draft' && restockFor(p)).slice(0, 1).map((p) => ['Next draft', `${shortN(p)} · ${/sample$/.test(restockFor(p)[0]) ? 'sample ' : ''}${restockFor(p)[3]}`]),
      ['Archived', PR.filter((p) => p.st === 'arch').map((p) => p.n).join(', ') || 'None'],
    ]),
  );
  return (
    <>
      {G('Catalog', 'What shows on useclear.org/shop', '', cat)}
      {G(
        'Pricing',
        '',
        '',
        <>
          {lad}
          {sc}
        </>,
      )}
      {G('Shelf history', '', '', hist)}
    </>
  );
}
/** The latest product back on the shelf after time off it, and when. */
function backOn() {
  const back = PR.flatMap((p) => (SHELF_EV[p.id] || []).filter((e, i, ev) => e[0] === 'on' && ev[i - 1]?.[0] === 'off').map((e) => [p, e[1]]));
  return back.sort((a, b) => b[1] - a[1]).slice(0, 1);
}
export function sInventory() {
  const units = goods.filter((p) => p.st !== 'arch').reduce((a, p) => a + (onHand(p.id) || 0), 0),
    atCost = goods.filter((p) => p.st !== 'arch').reduce((a, p) => a + (onHand(p.id) || 0) * unitCost(p), 0);
  const outN = goods
    .filter((p) => p.st === 'on' && p.line !== 'patch')
    .reduce(
      (a, p) =>
        a +
        Object.values(STK[p.id])
          .flat()
          .filter((v) => v === 0).length,
      0,
    );
  const grid = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Stock by size</span>
        <span className="tag">Select a product</span>
      </header>
      <div className="c-fig">
        {figHtml(String(units), `items on hand · ${money(atCost)} at cost · patches ${onHand('psq') ?? 0} square and ${onHand('pci') ?? 0} circle`)}
      </div>
      <div className="c-body start">{stockGrid()}</div>
      {strip([
        ['Shirts and layers', String(units - onHand('psq') - onHand('pci'))],
        ['Patches', String(onHand('psq') + onHand('pci'))],
        ['Sizes out', String(outN), 'on the shelf', 'warn'],
        ['On the way', goods.filter((p) => (p.st === 'on' || p.st === 'off') && restockFor(p)).map((p) => `${parseInt(restockFor(p)[1])} ${p.n}s`).join(', ') || 'Nothing'],
      ])}
    </section>
  );
  const lasting = goods.filter((p) => p.st === 'on' && coverW(p) !== null).sort((a, b) => coverW(a) - coverW(b)),
    short = lasting[0],
    slow = lasting.at(-1),
    low = lasting.filter((p) => coverW(p) < p.lead);
  const coming = INCOMING.filter((r) => !r[2].some((s) => s[0] === 'plan')),
    next = goods.find((p) => p.st === 'off' && restockFor(p));
  const cov = gCell(
    's-6',
    'How long it lasts',
    'At the last 4 weeks’ pace',
    short ? figHtml(`${coverW(short).toFixed(1)} wk`, `of ${short.n}s left · a reorder takes ${short.lead} weeks to land`) : '',
    coverBars(),
    strip([
      ['Reorder now', low.map((p) => p.n).join(', ') || 'Nothing', '', low.length ? 'warn' : ''],
      ...(slow ? [['Slowest to sell', `${scName(slow)} · ${coverW(slow) >= 24 ? '24+' : coverW(slow).toFixed(1)} wk`]] : []),
    ]),
  );
  const inc = gCell(
    's-6',
    'On the way',
    'Ordered and planned',
    next ? figHtml(restockFor(next)[3], `the ${next.n} restock lands · it goes back on the shelf that day`) : figHtml(String(INCOMING.length), 'batches ordered and planned'),
    incomingLanes(),
    strip([
      ['Arriving', `${coming.length} ${coming.length === 1 ? 'batch' : 'batches'}`],
      ['Planned', String(INCOMING.length - coming.length)],
    ]),
  );
  return (
    <>
      {G('Stock', 'Each square is a size · darker means more on hand', '', grid)}
      {G(
        'Planning',
        '',
        '',
        <>
          {cov}
          {inc}
        </>,
      )}
    </>
  );
}
export function sOrders() {
  const open = ['paid', 'packed', 'shipped', 'ready', 'refund'];
  const opts = [
    ['open', 'Open', ORDERS.filter((o) => open.includes(o[8])).length],
    ...Object.keys(OST)
      .map((k) => [k, OST[k][1], ORDERS.filter((o) => o[8] === k).length])
      .filter((o) => o[2]),
    ['all', 'All recent', ORDERS.length],
  ];
  const list = ORDERS.filter((o) => (SS.of === 'all' ? 1 : SS.of === 'open' ? open.includes(o[8]) : o[8] === SS.of)).sort((a, b) => b[1] - a[1]),
    oldest = ORDERS.filter((o) => o[8] === 'paid').sort((a, b) => a[1] - b[1])[0];
  const pipe = gCell(
    's-12',
    'Where every order is',
    'Ships within 2 days of paying',
    figHtml(
      String(ORDERS.filter((o) => open.includes(o[8])).length),
      oldest ? `open orders · the oldest still to pack was paid ${ordAge(oldest).toFixed(1)} days ago` : 'open orders',
    ),
    pipeline(),
    strip([
      ['Over 2 days', String(ORDERS.filter((o) => o[8] === 'paid' && ordAge(o) > 2).length || 'None')],
      ['Median to ship', shipTimes().median],
      ['Picked up', `${SHOP.picked} in 4 weeks`],
      ['Returns', `${RETURNS.length} · ${(per(RETURNS.length, SHOP.ord) * 100).toFixed(1)}%`],
    ]),
  );
  const rows = list.map((o, __k) => {
    const st = OST[o[8]];
    return (
      <button key={__k} type="button" className="or-r" data-order={o[0]}>
        <span className="or-id mono">#{o[0]}</span>
        <span className="or-k">
          <b>
            {o[2]}
            {o[3] ? <span className="or-m">Member</span> : ''}
          </b>
          <span className="small quiet">{itemsLine(o)}</span>
        </span>
        <span className="or-g">{o[4].map(([pid]) => glyph(prOf(pid), 'sm'))}</span>
        <span className="or-w small">{o[6] === 'ship' ? 'Ship · ' + o[9] : 'Pickup · ' + o[7]}</span>
        <span className="or-d small quiet">{fmtD(o[1])}</span>
        <b className="num">{money(ordTotal(o))}</b>
        <span className="or-c">
          <span className={`chip ${st[0]}`}>{st[1]}</span>
        </span>
      </button>
    );
  });
  const tbl = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">{SS.of === 'open' ? 'Open orders, newest first' : SS.of === 'all' ? 'Recent orders' : (opts.find((o) => o[0] === SS.of)?.[1] ?? OST[SS.of]?.[1])}</span>
        <span className="hd-tools">{ddHtml('sof', opts, SS.of, 'Show')}</span>
      </header>
      <div className="c-fig" />
      <div className="c-body start">
        <div className="or">
          <div className="or-r or-h">
            <span>Order</span>
            <span>Buyer and items</span>
            <span />
            <span>Getting it</span>
            <span>Paid</span>
            <span>Total</span>
            <span>Status</span>
          </div>
          {rows.length ? (
            rows
          ) : (
            <p className="quiet" style={css('padding:var(--s3) 0')}>
              Nothing here.
            </p>
          )}
        </div>
      </div>
      <div />
    </section>
  );
  const held = PRE.filter((r) => r[5] === 'held'),
    dep = held.reduce((a, r) => a + prOf(r[2]).price * r[4], 0);
  const pre = gCell(
    's-7',
    'Hardware pre-orders',
    'Merchants only',
    figHtml(money(dep), `in deposits · refundable until each device is made`),
    <>
      <div className="po">
        {['cpt', 'c8']
          .filter((pid) => prOf(pid))
          .map((pid, __k) => {
            const p = prOf(pid),
              rs = PRE.filter((r) => r[2] === pid),
              h = rs.filter((r) => r[5] === 'held').reduce((a, r) => a + r[4], 0),
              w = rs.filter((r) => r[5] !== 'held').reduce((a, r) => a + r[4], 0);
            return (
              <div key={__k} className="po-r">
                <span className="po-k">
                  {glyph(p, 'sm')}
                  <span>
                    <b>{pName(p).replace(' · Counter or table', '')}</b>
                    <span className="small quiet">
                      {money(p.price)}
                      {' deposit'}
                    </span>
                  </span>
                </span>
                <span className="po-p">
                  {Array.from(
                    {
                      length: h,
                    },
                    (_, __k) => (
                      <i key={__k} className="on" />
                    ),
                  )}
                  {Array.from(
                    {
                      length: w,
                    },
                    (_, __k) => (
                      <i key={__k} />
                    ),
                  )}
                </span>
                <span className="small quiet">
                  {h}
                  {' held · '}
                  {w}
                  {' waiting'}
                </span>
              </div>
            );
          })}
      </div>
      <div className="pn-list">
        {PRE.map(([id, shop, pid, opt, n, st, d], __k) => (
          <button key={__k} type="button" className="pn-r" data-sflow="preorder" data-sid={id}>
            <span className="ev-d">{fmtD(d)}</span>
            <span className="pn-k">
              <b>{shop}</b>
              <span className="small quiet">
                {n}
                {' × '}
                {prOf(pid).n}
                {opt ? ' · ' + opt : ' · ' + prOf(pid).v}
              </span>
            </span>
            <span className={`chip ${PRE_ST[st][0]}`}>{PRE_ST[st][1]}</span>
          </button>
        ))}
        {PRE.length ? '' : <span className="small quiet">None yet.</span>}
      </div>
    </>,
    strip([
      ['Units', String(PRE.reduce((a, r) => a + r[4], 0))],
      ['Shops', String(new Set(PRE.map((r) => r[1])).size)],
      ['Not finished', String(PRE.filter((r) => r[5] !== 'held').length), 'sign-up or agreement', 'warn'],
    ]),
    undefined,
    ' start',
  );
  const waiting = RETURNS.filter((r) => r.refundedAt == null),
    refunded = RETURNS.filter((r) => r.refundedAt != null),
    why = RETURN_WHY.map((k) => [k, RETURNS.filter((r) => r.reason === k).length]),
    whyMax = Math.max(1, ...why.map((w) => w[1]));
  const refunds = gCell(
    's-5',
    'Refunds and returns',
    'Over $50.00 needs a second person',
    figHtml(String(waiting.length), `refund${waiting.length === 1 ? '' : 's'} waiting${waiting[0]?.second ? ` · ${waiting[0].second} is the second person` : ''}`),
    <>
      <div className="pn-list">
        {waiting.map((r, __k) => (
          <button key={__k} type="button" className="pn-r two" data-order={r.order}>
            <span className="pn-k">
              <b>
                {`#${r.order} · `}
                {money(ordTotal(ordOf(r.order)))}
              </b>
              <span className="small quiet">
                {r.item}
                {', '}
                {r.reason.toLowerCase()}
                {' · returned '}
                {fmtD(r.returned)}
              </span>
            </span>
            <span className="chip underway">Waiting {Math.round((NOW - r.proposedAt) / 3600e3)} h</span>
          </button>
        ))}
      </div>
      {waiting[0] ? <div>{retTrack(waiting[0])}</div> : ''}
      <div className="ablock">
        <span className="lbl">Refunded · 4 weeks</span>
        {refunded.length ? (
          evRows(refunded.map((r) => [fmtD(r.refundedAt), `#${r.order} · ${r.item}`, `${r.reason} · ${r.amount > 50 ? `approved by ${r.second}` : 'under $50.00, no second person'}`, money(r.amount)]))
        ) : (
          <span className="small quiet">None yet.</span>
        )}
      </div>
      <div className="ablock">
        <span className="lbl">Why things come back · 4 weeks</span>
        <div className="hbars">
          {why.map(([k, n], __k) => (
            <div key={__k} className="hb">
              <span className="hb-k">{k}</span>
              <span className="hb-bar">
                <i style={css(n ? `width:${(n / whyMax) * 100}%;background:var(--fg)` : 'width:0%')} />
              </span>
              <b className="num">{n}</b>
            </div>
          ))}
        </div>
      </div>
    </>,
    strip([
      ['Returns', `${RETURNS.length} · ${(per(RETURNS.length, SHOP.ord) * 100).toFixed(1)}%`],
      ['Refunded', money(refunded.reduce((a, r) => a + r.amount, 0))],
    ]),
    undefined,
    ' start',
  );
  const how = gCell(
    's-6',
    'Pickups',
    'At partner shops, last 4 weeks',
    figHtml(`${(per(SHOP.picked, SHOP.ord) * 100).toFixed(0)}%`, 'of orders are picked up at a partner shop · brings people through their door'),
    <div className="hbars">
      {PARTNERS.map(([k, v], __k) => (
        <div key={__k} className="hb">
          <span className="hb-k">{k}</span>
          <span className="hb-bar">
            <i style={css(`width:${(v / PARTNERS[0][1]) * 100}%;background:var(--land)`)} />
          </span>
          <b className="num">{v}</b>
        </div>
      ))}
      {PARTNERS.length ? '' : <span className="small quiet">None yet.</span>}
    </div>,
    <div className="c-ft">
      <button type="button" data-go="merchants">
        <span className="t">Partner shops</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  const days = gCell(
    's-6',
    'Time to ship',
    'Paid to handed to the carrier',
    figHtml(shipTimes().median, `median · ${pc0(shipTimes().within2)} ship within 2 days`),
    SHIP_DAYS.length ? (
      columns(SHIP_DAYS, {
        hi: 1,
        h: 150,
      })
    ) : (
      <span className="small quiet">None yet.</span>
    ),
    <div className="c-ft">
      <button type="button" data-sflow="labels">
        <span className="t">Print today’s labels</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  return (
    <>
      {G('Fulfilment', '', '', pipe)}
      {G('Orders', 'Buyers show by first name · addresses stay hidden until you pack', '', tbl)}
      {G(
        'Pre-orders and refunds',
        '',
        '',
        <>
          {pre}
          {refunds}
        </>,
      )}
      {G(
        'Getting it to people',
        '',
        '',
        <>
          {how}
          {days}
        </>,
      )}
    </>
  );
}

/* ── panels ───────────────────────────────────────────────────────────── */
export function shopPane() {
  if (SS.order) return orderPane();
  if (!SS.prod) return '';
  const p = prOf(SS.prod);
  if (!p) return '';
  const h = onHand(p.id),
    cost = unitCost(p),
    m = p.price - cost;
  const stockSec =
    STK[p.id] && p.line !== 'patch'
      ? sec(
          'Stock',
          <div className="sg sg-mini">
            <div className="sg-r sg-h">
              <span>Colour</span>
              {SIZES.map((s, __k) => (
                <span key={__k}>{s}</span>
              ))}
              <span>Total</span>
            </div>
            {Object.entries(STK[p.id]).map(([col, v], __k) => (
              <div key={__k} className="sg-r">
                <span className="sg-col">
                  <i className={`sw-c ${col.toLowerCase()}`} />
                  {col}
                </span>
                {v.map((n, i) => (
                  <span
                    key={i}
                    className={`sg-c${p.st !== 'on' ? ' q' : n === 0 ? ' z' : n <= 2 && i > 0 && i < 5 ? ' lo' : ''}`}
                    style={css(`--a:${Math.min(1, n / 18)}`)}
                  >
                    <b>{p.st !== 'on' && !n ? '–' : n}</b>
                  </span>
                ))}
                <b className="num">{v.reduce((a, b) => a + b, 0)}</b>
              </div>
            ))}
          </div>,
          p.st !== 'arch' ? (
            <button type="button" className="pn-link" data-sflow="restock" data-sid={p.id}>
              Restock
            </button>
          ) : (
            ''
          ),
        )
      : STK[p.id]
        ? sec(
            'Stock',
            kv([
              ['On hand', String(h)],
              ['Lasts', coverW(p) ? coverW(p).toFixed(1) + ' weeks at this pace' : '—', 1],
            ]),
            <button type="button" className="pn-link" data-sflow="restock" data-sid={p.id}>
              Restock
            </button>,
          )
        : sec(
            'Pre-orders',
            <div className="pn-list">
              {PRE.filter((r) => r[2] === p.id).map(([id, shop, pid, opt, n, st, d], __k) => (
                <button key={__k} type="button" className="pn-r" data-sflow="preorder" data-sid={id}>
                  <span className="ev-d">{fmtD(d)}</span>
                  <span className="pn-k">
                    <b>{shop}</b>
                    <span className="small quiet">
                      {n}
                      {' × '}
                      {opt || p.v}
                    </span>
                  </span>
                  <span className={`chip ${PRE_ST[st][0]}`}>{PRE_ST[st][1]}</span>
                </button>
              )) || (
                <p className="quiet small" style={css('margin:0')}>
                  None yet.
                </p>
              )}
            </div>,
          );
  const price = p.dep
    ? sec(
        'Deposit',
        kv([
          ['Deposit', money(p.price)],
          ['Refundable', 'Until the device is made'],
          ['Checkout', 'Needs a merchant account', 1],
        ]),
        p.st !== 'arch' ? (
          <button type="button" className="pn-link" data-sflow="edit" data-sid={p.id}>
            Edit
          </button>
        ) : (
          ''
        ),
      )
    : sec(
        'Price',
        <>
          <div className="ld ld-one">
            <span className="ld-b">
              <span className="ld-t" style={css('width:100%')}>
                <i style={css(`flex:${p.c[0]};background:var(--fg)`)} />
                {p.c[1] ? <i style={css(`flex:${p.c[1]};background:var(--fg-50)`)} /> : ''}
                <i style={css(`flex:${p.c[2] + p.c[3]};background:var(--line)`)} />
                <i className="ld-m" style={css(`flex:${m}`)} />
              </span>
            </span>
          </div>
          {/* live, a product the site sells that Command has no costs for says so, rather than a 100% margin */}
          {p.nc
            ? kv([
                ['Costs', 'Not entered yet'],
                ['Price', money(p.price)],
                ['Margin', '—', 1],
              ])
            : kv([
                ['Blank or base', money(p.c[0])],
                ['Making', p.c[1] ? money(p.c[1]) : '—'],
                ['Label and packing', money(p.c[2] + p.c[3])],
                ['Cost', money(cost)],
                ['Price', money(p.price)],
                ['Margin', `${money(m)} · ${((m / p.price) * 100).toFixed(1)}%`, 1],
              ])}
        </>,
        p.st !== 'arch' ? (
          <button type="button" className="pn-link" data-sflow="edit" data-sid={p.id}>
            Edit
          </button>
        ) : (
          ''
        ),
      );
  const wm = Math.max(1, ...p.wk);
  const sales = sec(
    'Sales',
    <>
      <div className="pn-cols">
        {p.wk.map((v, i) => (
          <span key={i} className="pn-col">
            <span className="num">{v || ''}</span>
            <i style={css(`height:${Math.max(2, (v / wm) * 100)}%`)} />
            <span className="ck">{SW[i].split(' ')[0]}</span>
          </span>
        ))}
      </div>
      {kv([
        [p.dep ? 'Pre-ordered, 4 weeks' : 'Sold, 4 weeks', String(u4(p))],
        [p.dep ? 'Deposits' : 'Sales, 4 weeks', money(u4(p) * p.price), 1],
      ])}
    </>,
  );
  const shelfSeg =
    p.st === 'arch' ? (
      ''
    ) : (
      <div className="seg2" role="group" aria-label="Shelf">
        <button type="button" data-sflow={p.st === 'on' ? '' : 'shelf-on'} data-sid={p.id} aria-pressed={p.st === 'on'}>
          On the shelf
        </button>
        <button type="button" data-sflow={p.st === 'on' ? 'shelf-off' : ''} data-sid={p.id} aria-pressed={p.st !== 'on'}>
          {p.st === 'draft' ? 'Draft' : 'Off the shelf'}
        </button>
      </div>
    );
  const shelf = sec(
    'Shelf',
    <>
      {shelfSeg}
      {kv([
        ['Page', <span className="mono">useclear.org/shop/{p.slug}</span>],
        ['Shows as', p.st === 'on' ? (p.dep ? 'Pre-order' : 'In stock') : p.st === 'off' ? 'Back soon' : p.st === 'draft' ? 'Hidden' : 'Removed'],
        p.why ? ['Why', p.why, 1] : ['Photos', p.line === 'hw' ? '2 renders' : '4 photos', 1],
      ])}
    </>,
    p.st === 'arch' ? (
      ''
    ) : (
      <button type="button" className="pn-link" data-sflow="archive" data-sid={p.id}>
        Archive
      </button>
    ),
  );
  const hist = sec(
    'History',
    <div className="pn-list">
      {(SHIST[p.id] || []).map(([d, t, w], __k) => (
        <div key={__k} className="pn-r">
          <span className="ev-d">{fmtD(d)}</span>
          <span className="pn-k">
            <b>{t}</b>
            <span className="small quiet">{w}</span>
          </span>
          <span />
        </div>
      ))}
    </div>,
  );
  const body = (
    <>
      <div className="sp-hd">
        {glyph(p, 'xl')}
        <div>
          <p className="h2" style={css('font-size:26px')}>
            {p.n}
          </p>
          <p className="quiet" style={css('margin:6px 0 0')}>
            {p.v}
            {' · '}
            {LINES[p.line][0]}
            {' · '}
            {money(p.price)}
            {p.dep ? ' deposit' : ''}
          </p>
        </div>
      </div>
      {shelf}
      {price}
      {stockSec}
      {sales}
      {hist}
    </>
  );
  const foot =
    p.st === 'arch' ? (
      <button className="btn btn-p" type="button" data-sflow="restore" data-sid={p.id}>
        Restore as a draft
      </button>
    ) : (
      <>
        <button className="btn btn-p" type="button" data-sflow="edit" data-sid={p.id}>
          Edit
        </button>
        {p.st === 'on' ? (
          <button className="btn btn-g" type="button" data-sflow="shelf-off" data-sid={p.id}>
            Take off the shelf
          </button>
        ) : (
          <button className="btn btn-g" type="button" data-sflow="shelf-on" data-sid={p.id}>
            Put on the shelf
          </button>
        )}
      </>
    );
  return (
    <>
      <div className="pane-scrim" data-closespane="" />
      <aside className="pane" role="dialog" aria-label="Product">
        <header className="m-hd">
          <span className="sub">Product</span>
          <span style={css('display:flex;align-items:center;gap:8px')}>
            <span className={`chip ${SHELF[p.st][0]}`}>{SHELF[p.st][1]}</span>
            <button className="x" type="button" data-closespane="" aria-label="Close">
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
export function orderPane() {
  const o = ordOf(SS.order);
  if (!o) return '';
  const [id, t, who, mem, items, pay, how, partner, st, city] = o,
    sub = ordTotal(o),
    ship = ordShip(o),
    tax = ordTax(o);
  const stages = how === 'ship' ? ['Paid', 'Packed', 'Shipped', 'Delivered'] : ['Paid', 'Packed', 'Ready', 'Picked up'];
  const at = {
    paid: 0,
    packed: 1,
    shipped: 2,
    ready: 2,
    done: 4,
    picked: 4,
    refund: 4,
  }[st];
  const track =
    st === 'refund' && retOf(id)
      ? retTrack(retOf(id))
      : vizTrack(stages.map((s, i) => [s, i < at ? 1 : i === at ? 2 : 0]));
  const body = (
    <>
      <div>
        <p className="h2" style={css('font-size:28px')}>
          #{id}
        </p>
        <p className="quiet" style={css('margin:8px 0 0')}>
          {who}
          {' · '}
          {mem ? 'member' : 'guest'}
          {' · '}
          {fmtD(t)}
          {', '}
          {new Date(t).toISOString().slice(11, 16)}
        </p>
      </div>
      {sec('Progress', <div>{track}</div>)}
      {sec(
        'Items',
        <>
          <div className="pn-list">
            {items.map(([pid, col, sz, q], __k) => {
              const p = prOf(pid);
              return (
                <button key={__k} type="button" className="pn-r" data-product={pid}>
                  {glyph(p, 'sm')}
                  <span className="pn-k">
                    <b>{pName(p)}</b>
                    <span className="small quiet">
                      {col}
                      {sz ? ' · ' + sz : ''}
                      {' · '}
                      {q}
                      {' × '}
                      {money(p.price)}
                    </span>
                  </span>
                  <b className="num">{money(q * p.price)}</b>
                </button>
              );
            })}
          </div>
          {kv([
            ['Items', money(sub)],
            ['Shipping', ship ? money(ship) : 'Free · pickup'],
            ['Sales tax', money(tax)],
            ['Total', money(sub + ship + tax), 1],
          ])}
        </>,
      )}
      {sec(
        how === 'ship' ? 'Shipping' : 'Pickup',
        kv(
          how === 'ship'
            ? [
                ['To', `${city}, CA`],
                ['Full address', 'Shows when you pack'],
                ['Carrier', 'USPS Ground Advantage'],
                ['Tracking', st === 'paid' || st === 'packed' ? 'After the label prints' : <span className="mono">9400 1118 …42{id.slice(2)}</span>, 1],
              ]
            : [
                ['At', partner],
                ['Held until', fmtD(t + 14 * DAY)],
                ['They show', 'The order number in the Clear app or email', 1],
              ],
        ),
      )}
      {sec(
        'Payment',
        kv([
          ['Paid with', PAY[pay]],
          ['Fee', money(Math.round(((sub + ship) * 0.029 + 0.3) * 100) / 100)],
          ['Buyer', mem ? 'Member · discount codes off' : 'Guest checkout', 1],
        ]),
      )}
    </>
  );
  const foot =
    st === 'paid' ? (
      <>
        <button className="btn btn-p" type="button" data-sflow="pack" data-sid={id}>
          Mark packed
        </button>
        <button className="btn btn-g" type="button" data-sflow="labels" data-sid={id}>
          Print the label
        </button>
      </>
    ) : st === 'packed' ? (
      how === 'ship' ? (
        <button className="btn btn-p" type="button" data-sflow="ship" data-sid={id}>
          Mark shipped
        </button>
      ) : (
        <button className="btn btn-p" type="button" data-sflow="ready" data-sid={id}>
          Ready for pickup
        </button>
      )
    ) : st === 'ready' ? (
      <>
        <button className="btn btn-p" type="button" data-sflow="picked" data-sid={id}>
          Mark picked up
        </button>
        <button className="btn btn-g" type="button" data-sflow="remind" data-sid={id}>
          Remind them
        </button>
      </>
    ) : st === 'refund' ? (
      <button className="btn btn-p" type="button" data-sflow="refundwait" data-sid={id}>
        See the refund
      </button>
    ) : (
      <button className="btn btn-g" type="button" data-sflow="refund" data-sid={id}>
        Refund
      </button>
    );
  return (
    <>
      <div className="pane-scrim" data-closespane="" />
      <aside className="pane" role="dialog" aria-label="Order">
        <header className="m-hd">
          <span className="sub">Order</span>
          <span style={css('display:flex;align-items:center;gap:8px')}>
            <span className={`chip ${OST[st][0]}`}>{OST[st][1]}</span>
            <button className="x" type="button" data-closespane="" aria-label="Close">
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
/* the address for packing a live order: asked for once a visit (each ask is logged), then written into the open flow */
const PACK_ADDR = new Map();
function packAddress(o) {
  if (PACK_ADDR.has(o[0])) return PACK_ADDR.get(o[0]);
  void api('GET', `/shop/orders/${o[0]}/address`).then(
    (a) => {
      const text = [a.name, ...a.lines].filter(Boolean).join(' · ') || `Ship to ${o[9]}`;
      PACK_ADDR.set(o[0], text);
      const el = document.querySelector(`[data-pack-addr="${o[0]}"]`);
      if (el) el.textContent = text;
    },
    (e) => {
      const el = document.querySelector(`[data-pack-addr="${o[0]}"]`);
      if (el) el.textContent = `Ship to ${o[9]} · the address couldn’t be read (${e.message})`;
    },
  );
  return `Ship to ${o[9]} · reading the address…`;
}
export function openSFlow(kind, id) {
  vars.lastFocus = document.activeElement;
  let f = null;
  const p = id ? prOf(id) : null,
    o = id ? ordOf(id) : null;
  const seg = (opts, cur, attr) => (
    <div className="seg2" role="group">
      {opts.map(([v, t], __k) => (
        <button key={__k} type="button" {...attrs(attr ? `data-${attr}="${v}"` : '')} aria-pressed={v === cur}>
          {t}
        </button>
      ))}
    </div>
  );
  if (kind === 'add') {
    const ln = SS.line;
    f = {
      t: 'Add a product',
      h: 'A new product',
      p: 'It starts as a draft. Nothing shows on the site until you put it on the shelf.',
      post: (
        <>
          <label className="field">
            <span className="lbl">Name</span>
            <input type="text" defaultValue="Graphic Tee · Arrowhead Springs" autoComplete="off" />
          </label>
          <span className="lbl">Line</span>
          {seg(
            Object.entries(LINES).map(([k, [n]]) => [k, n]),
            ln,
            'sline',
          )}
          <div className="f2">
            <label className="field">
              <span className="lbl">Price</span>
              <input type="text" defaultValue={ln === 'hw' ? '$60.00' : ln === 'patch' ? '$9.00' : '$44.00'} autoComplete="off" />
            </label>
            <label className="field">
              <span className="lbl">Cost per item</span>
              <input type="text" defaultValue={ln === 'hw' ? '—' : ln === 'patch' ? '$1.95' : '$16.70'} autoComplete="off" />
            </label>
          </div>
          {ln === 'hw' ? (
            ''
          ) : (
            <>
              <span className="lbl">Sizes</span>
              <div className="seg2" role="group" aria-label="Sizes">
                {(ln === 'patch' ? ['One size'] : SIZES).map((s, __k) => (
                  <button key={__k} type="button" data-stog="" aria-pressed="true">
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      ),
      rows: [
        ['Page', `useclear.org/shop/${ln === 'hw' ? 'new-device' : 'arrowhead-springs'}`],
        ['Margin', ln === 'hw' ? 'Deposit, refundable' : ln === 'patch' ? '78.3%' : '62.0%'],
        ['Starts as', 'Draft · hidden from the site', 1],
      ],
      btn: 'Add the draft',
      after: () => {
        PR.splice(PR.length - 1, 0, {
          id: 'gas',
          n: 'Graphic Tee',
          v: 'Arrowhead Springs',
          line: 'graphic',
          g: 'gtee',
          price: 44,
          c: [8.6, 5.8, 1.2, 1.1],
          st: 'draft',
          cols: ['Black'],
          wk: [0, 0, 0, 0, 0, 0, 0, 0],
          lead: 3,
          slug: 'arrowhead-springs',
          why: 'New · needs photos',
        });
        STK.gas = {
          Black: [0, 0, 0, 0, 0, 0],
        };
        SHELF_EV.gas = [['draft', NOW, NOW + DAY]];
        SHIST.gas = [[NOW, 'Added as a draft', 'Kai']];
      },
      steps: ['Made the draft', 'Reserved the page address', 'Logged who added it'],
      done: ['Draft added.', 'Add photos and stock, then put it on the shelf.'],
    };
  } else if (kind === 'edit' && p) {
    f = {
      t: 'Update product',
      lbl: SHELF[p.st][1],
      h: pName(p),
      post: (
        <>
          <label className="field">
            <span className="lbl">Name</span>
            <input type="text" defaultValue={pName(p)} autoComplete="off" />
          </label>
          <div className="f2">
            <label className="field">
              <span className="lbl">{p.dep ? 'Deposit' : 'Price'}</span>
              <input type="text" defaultValue={money(p.price)} autoComplete="off" />
            </label>
            {p.dep ? (
              ''
            ) : (
              <label className="field">
                <span className="lbl">Cost per item</span>
                <input type="text" defaultValue={money(unitCost(p))} autoComplete="off" />
              </label>
            )}
          </div>
          <label className="field">
            <span className="lbl">Short description</span>
            <input
              type="text"
              defaultValue={
                p.line === 'graphic'
                  ? 'Photo print of ' + p.v + ', San Bernardino'
                  : p.line === 'patch'
                    ? 'The Clear mark, embroidered'
                    : p.dep
                      ? 'For partner shops · merchant account needed'
                      : 'Heavy cotton, cut a little long'
              }
              autoComplete="off"
            />
          </label>
        </>
      ),
      rows: p.dep
        ? [
            ['Applies to', 'New pre-orders only'],
            ['Deposits already held', 'Unchanged', 1],
          ]
        : [
            ['Margin now', `${(((p.price - unitCost(p)) / p.price) * 100).toFixed(1)}%`],
            ['Open orders', 'Keep the price they paid'],
            ['Shows on the site', 'Right away', 1],
          ],
      note: p.dep ? null : (
        <>
          <b>Price stays honest.</b>
          {' Aim to cover the line and fund marketing, not more.'}
        </>
      ),
      noteIc: 'check',
      btn: 'Save changes',
      steps: ['Saved the changes', 'Updated the page', 'Logged the old and new price'],
      done: ['Saved.', 'The page shows it now.'],
    };
  } else if (kind === 'shelf-off' && p) {
    const w = SS.why;
    f = {
      t: 'Take off the shelf',
      lbl: pName(p),
      h: 'Take it off the shelf?',
      p: 'The page stays up and says back soon. You can put it back any time.',
      pre: (
        <>
          <span className="lbl">Why</span>
          {seg(
            [
              ['stock', 'Out of stock'],
              ['fix', 'Fixing the page'],
              ['season', 'Out of season'],
              ['pause', 'Pausing it'],
            ],
            w,
            'swhy',
          )}
        </>
      ),
      rows: [
        ['Page shows', 'Back soon, with a sign-up for a note'],
        ['Open orders', `${ORDERS.filter((x) => ['paid', 'packed'].includes(x[8]) && x[4].some((i) => i[0] === p.id)).length} · still ship`],
        ['Stock', `${onHand(p.id) ?? 0} kept on hand`, 1],
      ],
      btn: 'Take it off',
      after: () => {
        p.st = 'off';
        p.why = {
          stock: 'Out of stock',
          fix: 'Fixing the page',
          season: 'Out of season',
          pause: 'Paused',
        }[w];
        (SHELF_EV[p.id] || (SHELF_EV[p.id] = [])).forEach((e) => {
          if (e[2] >= NOW && e[0] === 'on') e[2] = NOW;
        });
        SHELF_EV[p.id].push(['off', NOW, NOW + DAY]);
        (SHIST[p.id] || (SHIST[p.id] = [])).unshift([NOW, 'Taken off the shelf', 'Kai']);
      },
      steps: ['Hid the buy button', 'Set the page to back soon', 'Logged it'],
      done: ['Off the shelf.', 'It shows as off shelf here and back soon on the site.'],
    };
  } else if (kind === 'shelf-on' && p) {
    const h = onHand(p.id),
      ready = [
        ['Photos', 1],
        ['Price', 1],
        ['Stock', p.dep || h > 0 ? 1 : 0],
        ['Page copy', 1],
      ];
    f = {
      t: 'Put on the shelf',
      lbl: pName(p),
      h: 'Put it on the shelf?',
      pre: (
        <div className="ablock">
          <span className="lbl">Checks</span>
          {vizTrack(ready.map(([t, d]) => [t, d ? 1 : 2]))}
        </div>
      ),
      rows: [
        ['Shows as', p.dep ? 'Pre-order · merchants only' : 'In stock'],
        ['Price', money(p.price) + (p.dep ? ' deposit' : '')],
        ['On hand', p.dep ? 'Made to order' : String(h), 1],
      ],
      note:
        !p.dep && !h ? (
          <>
            <b>Nothing on hand yet.</b>
            {' It will show as sold out until stock arrives'}
            {restockFor(p) ? ` on ${restockFor(p)[3]}` : ''}.
          </>
        ) : null,
      noteIc: 'out',
      btn: 'Put it on the shelf',
      after: () => {
        p.st = 'on';
        p.why = null;
        (SHELF_EV[p.id] || (SHELF_EV[p.id] = [])).forEach((e) => {
          if (e[2] >= NOW && e[0] !== 'on') e[2] = NOW;
        });
        SHELF_EV[p.id].push(['on', NOW, NOW + DAY]);
        (SHIST[p.id] || (SHIST[p.id] = [])).unshift([NOW, 'Put on the shelf', 'Kai']);
      },
      steps: ['Turned on the buy button', 'Published the page', 'Logged it'],
      done: ['On the shelf.', 'It’s live on useclear.org/shop.'],
    };
  } else if (kind === 'archive' && p) {
    f = {
      t: 'Archive',
      lbl: pName(p),
      h: 'Archive this product?',
      p: 'It leaves the shop for good. Its history and past orders stay.',
      rows: [
        ['Page', 'Redirects to useclear.org/shop'],
        ['Past orders', 'Kept'],
        ['Stock left', p.dep ? '—' : `${onHand(p.id) ?? 0} items`],
        ['Undo', 'Restore it as a draft any time', 1],
      ],
      note:
        (onHand(p.id) || 0) > 0 ? (
          <>
            <b>
              {onHand(p.id)}
              {' items are still on hand.'}
            </b>
            {' Sell them first or mark them as given away.'}
          </>
        ) : null,
      noteIc: 'out',
      btn: 'Archive it',
      after: () => {
        p.st = 'arch';
        p.why = 'Archived today';
        (SHIST[p.id] || (SHIST[p.id] = [])).unshift([NOW, 'Archived', 'Kai']);
        SS.prod = null;
      },
      steps: ['Took it out of the shop', 'Set the page to redirect', 'Logged it'],
      done: ['Archived.', 'Find it under Archived in the catalog.'],
    };
  } else if (kind === 'restore' && p) {
    f = {
      t: 'Restore',
      lbl: 'Archived',
      h: pName(p),
      rows: [
        ['Comes back as', 'A draft, hidden from the site'],
        ['Price', money(p.price), 1],
      ],
      btn: 'Restore as a draft',
      after: () => {
        p.st = 'draft';
        p.why = 'Restored';
        (SHIST[p.id] || (SHIST[p.id] = [])).unshift([NOW, 'Restored as a draft', 'Kai']);
      },
      steps: ['Restored it as a draft', 'Logged it'],
      done: ['Restored.', 'It’s a draft again.'],
    };
  } else if (kind === 'restock' && p) {
    const v = STK[p.id] ? Object.values(STK[p.id])[0] : [0],
      one = v.length === 1;
    const sug = one ? [100] : SIZE_MIX.map(([, n]) => Math.max(2, Math.round((n / 86) * 36))),
      units = sug.reduce((a, b) => a + b, 0),
      cost = units * unitCost(p);
    f = {
      t: 'Restock',
      lbl: pName(p),
      h: `${units} ${one ? 'patches' : 'items'} · ${money(cost)}`,
      p: one ? 'One size.' : 'Split by size the way they sell.',
      pre: one ? (
        ''
      ) : (
        <div className="rs-g">
          {SIZES.map((s, i) => (
            <label key={i} className="field rs-f">
              <span className="lbl">{s}</span>
              <input type="text" defaultValue={sug[i]} inputMode="numeric" autoComplete="off" />
            </label>
          ))}
        </div>
      ),
      rows: [
        [
          'Colour',
          Object.keys(
            STK[p.id] || {
              One: 1,
            },
          )[0],
        ],
        ['Cost', `${money(unitCost(p))} each · ${money(cost)}`],
        ['Lands in', `About ${p.lead || 3} weeks`],
        ['Paid from', 'Operating cash', 1],
      ],
      note:
        cost > 50 ? (
          <>
            <b>Money moves need a second person.</b>
            {' Dana Ruiz can approve it.'}
          </>
        ) : null,
      noteIc: 'team',
      btn: cost > 50 ? 'Send for a second person' : 'Order it',
      steps: ['Drafted the purchase order', cost > 50 ? 'Sent it to Dana Ruiz to approve' : 'Placed the order', 'Added it to On the way'],
      done: [cost > 50 ? 'Waiting on a second person.' : 'Ordered.', 'It shows on the way once it’s approved.'],
    };
  } else if (kind === 'pack' && o) {
    f = {
      t: 'Pack the order',
      lbl: `#${o[0]} · ${o[2]}`,
      h: itemsLine(o),
      pre: (
        <div className="pn-list">
          {o[4].map(([pid, col, sz, q], __k) => {
            const pp = prOf(pid);
            return (
              <div key={__k} className="pn-r">
                {glyph(pp, 'sm')}
                <span className="pn-k">
                  <b>{pName(pp)}</b>
                  <span className="small quiet">
                    {col}
                    {sz ? ' · ' + sz : ''}
                  </span>
                </span>
                <b className="num">
                  {'× '}
                  {q}
                </b>
              </div>
            );
          })}
        </div>
      ),
      rows: [
        [
          'Getting it',
          // live, the full address is read from Stripe for this order as it's packed, and never kept (Phase 7a)
          LIVE && o[6] === 'ship' ? <span data-pack-addr={o[0]}>{packAddress(o)}</span> : o[6] === 'ship' ? `Ship to ${o[9]}, CA` : `Pickup at ${o[7]}`,
        ],
        ['Paid', `${fmtD(o[1])} · ${ordAge(o).toFixed(1)} days ago`],
        ['Insert', 'Thank-you card and returns slip', 1],
      ],
      btn: o[6] === 'ship' ? 'Packed · print the label' : 'Packed',
      after: () => {
        o[8] = 'packed';
        SS.order = null;
      },
      steps:
        o[6] === 'ship' ? ['Marked it packed', 'Bought the label', 'Sent it to the label printer'] : ['Marked it packed', 'Bagged it for the partner shop'],
      done: ['Packed.', o[6] === 'ship' ? 'It moves to on the way when the carrier scans it.' : `Take it to ${o[7]}.`],
    };
  } else if (kind === 'labels') {
    const n = ORDERS.filter((x) => x[8] === 'paid' && x[6] === 'ship').length;
    f = {
      t: 'Print labels',
      h: `${n} shipping labels`,
      rows: [
        [
          'Orders',
          ORDERS.filter((x) => x[8] === 'paid' && x[6] === 'ship')
            .map((x) => '#' + x[0])
            .join(', ') || 'None',
        ],
        ['Printer', '4-inch label printer'],
        ['Postage', money(n * 7.4)],
        ['Pickups', 'No label · bag and take them over', 1],
      ],
      btn: 'Print them',
      steps: ['Bought the postage', 'Sent the labels to the printer'],
      done: ['Printing.', 'Mark each one packed as you go.'],
    };
  } else if (kind === 'ship' && o) {
    f = {
      t: 'Mark shipped',
      lbl: `#${o[0]}`,
      h: o[2],
      rows: [
        ['Carrier', 'USPS Ground Advantage'],
        ['Tracking', 'Sent to the buyer by email'],
        ['Arrives', 'In 2–5 days', 1],
      ],
      btn: 'Mark shipped',
      after: () => {
        o[8] = 'shipped';
      },
      steps: ['Marked it shipped', 'Emailed the tracking link'],
      done: ['Shipped.', 'It moves to delivered on the carrier’s scan.'],
    };
  } else if (kind === 'ready' && o) {
    f = {
      t: 'Ready for pickup',
      lbl: `#${o[0]}`,
      h: o[7],
      rows: [
        ['Tell them', 'In the Clear app or by email'],
        ['Held for', '14 days', 1],
      ],
      btn: 'Tell them it’s ready',
      after: () => {
        o[8] = 'ready';
      },
      steps: ['Marked it ready', 'Told the buyer'],
      done: ['Ready.', `It’s waiting at ${o[7]}.`],
    };
  } else if (kind === 'picked' && o) {
    f = {
      t: 'Mark picked up',
      lbl: `#${o[0]}`,
      h: o[2],
      rows: [
        ['At', o[7]],
        ['Checked', 'Order number matched', 1],
      ],
      btn: 'Mark picked up',
      after: () => {
        o[8] = 'picked';
        SS.order = null;
      },
      steps: ['Marked it picked up', 'Thanked the partner shop'],
      done: ['Picked up.', 'The order is done.'],
    };
  } else if (kind === 'remind' && o) {
    f = {
      t: 'Remind them',
      lbl: `#${o[0]}`,
      h: o[2],
      rows: [
        ['Message', `Your order is at ${o[7]}`],
        ['Sent by', 'Clear, not a person'],
        ['Held until', fmtD(o[1] + 14 * DAY), 1],
      ],
      btn: 'Send the reminder',
      steps: ['Sent the reminder'],
      done: ['Reminder sent.', 'Nothing else changes.'],
    };
  } else if (kind === 'refund' && o) {
    const amt = ordTotal(o);
    f = {
      t: 'Refund',
      lbl: `#${o[0]} · ${o[2]}`,
      h: money(amt),
      pre: (
        <>
          <span className="lbl">Why</span>
          {seg(
            [
              ['size', 'Wrong size'],
              ['damaged', 'Damaged'],
              ['mind', 'Changed their mind'],
            ],
            'size',
          )}
        </>
      ),
      rows: [
        ['Back to', PAY[o[5]]],
        ['Item', 'Returned first, then refunded'],
        ['Stock', 'Goes back on hand if it’s new'],
        ['Second person', amt > 50 ? 'Needed · over $50.00' : 'Not needed · under $50.00', 1],
      ],
      note:
        amt > 50 ? (
          <>
            <b>Refunds over $50.00 need a second person.</b>
            {' Dana Ruiz can approve it.'}
          </>
        ) : null,
      noteIc: 'team',
      btn: amt > 50 ? 'Send for a second person' : 'Refund it',
      steps: amt > 50 ? ['Drafted the refund', 'Sent it to Dana Ruiz'] : ['Refunded it', 'Emailed the buyer'],
      done: amt > 50 ? ['Waiting on a second person.', 'It shows in the two-person queue on Team.'] : ['Refunded.', 'The buyer has an email.'],
    };
  } else if (kind === 'refundwait' && o && retOf(o[0])) {
    const r = retOf(o[0]);
    f = {
      t: 'Refund',
      lbl: `#${o[0]} · ${o[2]}`,
      h: money(ordTotal(o)),
      pre: <div>{retTrack(r)}</div>,
      rows: [
        ['Why', `${r.reason} · ${r.item.replace(' · ', ', ')}`],
        ['Returned', `${fmtD(r.returned)}${r.condition ? ', ' + r.condition : ''}`],
        ['Proposed', `${r.proposedBy} · ${r.proposedAt >= TODAY ? 'today' : fmtD(r.proposedAt)} ${new Date(r.proposedAt).toISOString().slice(11, 16)}`],
        ['Waiting on', `${r.second} · ${Math.round((NOW - r.proposedAt) / 3600e3)} h`, 1],
      ],
      note: (
        <>
          <b>You proposed it, so you can’t approve it.</b>
          {' That’s the two-person rule.'}
        </>
      ),
      noteIc: 'team',
      btn: `Nudge ${r.second}`,
      steps: [`Sent ${r.second} a nudge`],
      done: ['Nudged.', 'You’ll see it here when it’s approved.'],
    };
  } else if (kind === 'preorder') {
    const r = PRE.find((x) => x[0] === id),
      pp = prOf(r[2]);
    f = {
      t: 'Pre-order',
      lbl: fmtD(r[6]),
      h: r[1],
      p: `${r[4]} × ${pp.n}${r[3] ? ' · ' + r[3] : ' · ' + pp.v}`,
      pre: (
        <div>
          {vizTrack([
            ['In the bag', 1],
            ['Merchant account', r[5] === 'held' ? 1 : 2],
            ['Deposit', r[5] === 'held' ? 1 : 0],
            ['Made', 0],
            ['Delivered', 0],
          ])}
        </div>
      ),
      rows: [
        ['Deposit', r[5] === 'held' ? money(pp.price * r[4]) + ' held' : 'Not taken yet'],
        ['Refundable', 'Until the device is made'],
        ['Status', PRE_ST[r[5]][1], 1],
      ],
      note:
        r[5] === 'agreement' ? (
          <>
            <b>Waiting on the merchant agreement.</b>
            {' It’s out for signature in Contracts.'}
          </>
        ) : r[5] === 'signup' ? (
          <>
            <b>They need a merchant account to finish.</b>
            {' Send them the sign-up link.'}
          </>
        ) : null,
      noteIc: 'out',
      btn: r[5] === 'held' ? 'Refund the deposit' : r[5] === 'signup' ? 'Send the sign-up link' : null,
      steps: r[5] === 'held' ? ['Drafted the refund', pp.price * r[4] > 50 ? 'Sent it to Dana Ruiz' : 'Refunded it'] : ['Sent the merchant sign-up link'],
      done: r[5] === 'held' ? ['Sent for a second person.', 'The deposit goes back once it’s approved.'] : ['Sent.', 'The deposit is taken once they finish.'],
    };
  }
  if (!f) return;
  shopLive(f, kind, p, o, id);
  vModal(f, 's:' + kind);
}

/** Live, each Shop flow saves through the API: what's typed and picked in it, read when it's confirmed. */
function shopLive(f, kind, p, o, id) {
  const WHY = { stock: 'Out of stock', fix: 'Fixing the page', season: 'Out of season', pause: 'Pausing it' };
  const nameOf = (s) => {
    const [n, ...v] = String(s).split(' · ');
    return { name: n.trim(), variant: v.join(' · ').trim() };
  };
  if (kind === 'add')
    live(f, 'shop', 'product-add', () => {
      const [name, price, cost] = typed(),
        ln = SS.line,
        sizes = ln === 'hw' ? [''] : (picked()[1] ?? []).map((x) => (x === 'One size' ? '' : x));
      return { ...nameOf(name), line: ln, glyph: ln === 'patch' ? 'patch' : ln === 'hw' ? 'point' : 'gtee', price: dollars(price), cost: ln === 'hw' ? null : [dollars(cost), 0, 0, 0], options: ['Black'], sizes: sizes.length ? sizes : [''] };
    });
  else if (kind === 'edit' && p)
    live(f, 'shop', 'product-edit', () => {
      const [name, price, cost] = typed(),
        c = dollars(cost);
      return { id: p.id, ...nameOf(name), price: dollars(price), cost: p.dep || Math.abs(c - unitCost(p)) < 0.005 ? null : [c, 0, 0, 0] };
    });
  else if (kind === 'shelf-off' && p) live(f, 'shop', 'shelf-off', () => ({ id: p.id, why: WHY[SS.why] ?? 'Off the shelf' }));
  else if (kind === 'shelf-on' && p) live(f, 'shop', 'shelf-on', () => ({ id: p.id }));
  else if (kind === 'archive' && p) live(f, 'shop', 'archive', () => ({ id: p.id, why: p.why || 'Archived' }));
  else if (kind === 'restore' && p) live(f, 'shop', 'restore', () => ({ id: p.id }));
  else if (kind === 'restock' && p)
    live(f, 'shop', 'restock', () => {
      const v = typed().map((x) => Math.max(0, Math.round(dollars(x)))),
        sizes = v.length ? SIZES : [''],
        n = v.length ? v : [100],
        units = sizes.map((size, i) => ({ option: Object.keys(STK[p.id] || { Black: 0 })[0], size, n: n[i] })).filter((u) => u.n > 0);
      return { id: p.id, units, cost: units.reduce((a, u) => a + u.n, 0) * unitCost(p) };
    });
  else if (['pack', 'ship', 'ready', 'picked', 'remind'].includes(kind) && o) live(f, 'shop', kind, () => ({ order: o[0] }));
  else if (kind === 'labels') live(f, 'shop', 'labels', () => ({ orders: ORDERS.filter((x) => x[8] === 'paid' && x[6] === 'ship').map((x) => x[0]) }));
  else if (kind === 'refund' && o)
    live(f, 'shop', 'refund', () => {
      const r = picked()[0]?.[0] ?? 'Wrong size';
      return { order: o[0], reason: r === 'Damaged' ? 'Damaged in shipping' : r, amount: ordTotal(o) };
    });
  else if (kind === 'refundwait' && o) live(f, 'shop', 'refund-nudge', () => ({ order: o[0] }));
  else if (kind === 'preorder') {
    const r = PRE.find((x) => x[0] === id);
    if (r?.[5] === 'held') live(f, 'shop', 'deposit-refund', () => ({ id: r[0], amount: prOf(r[2]).price * r[4] }));
    else if (r?.[5] === 'signup') live(f, 'shop', 'signup-link', () => ({ id: r[0] }));
  }
}

/* ── Render ──────────────────────────────────────────────── */
