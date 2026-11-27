// @ts-nocheck: reads the sections' untyped data (src/sections/data.tsx), as the other section files do.
import { api } from '../live/api';
import { LIVE } from '../live/env';
import { reloadSection } from '../live/sections';
import { css } from '../runtime/dom';
import { ic, money } from './core';
import { COST_HIST, INPUTS, MATERIALS, PR, RECIPES, RUNS, SIZES, SS, STK, vars } from './data';
import { kv, sec, vModal } from './governance';
import { G, figHtml, fmtD } from './growth';
import { mkey } from './home';
import { ddHtml, stepFlow } from './kit';
import { strip } from './money';
import { closeModal, render, toast } from './shell';
import { glyph, pName, prOf, shortN, unitCost } from './shop';

/*
 * What goes into a product (docs/command-center-plan.md, Phase 10b), live only: Shop's Costs tab (the
 * inputs library and an input's pane), the product pane's recipe, and their flows. Phase 10c adds the
 * stock: Inventory's Materials and Runs, an input's purchases and ledger, counting and writing off,
 * and recording a production run. Phase 10d adds what a sale cost: a product's cost at sale over
 * time, and an order's cost and margin. The prototype has none of it, so nothing here draws unless REAL;
 * shop.tsx and startup.tsx call in.
 *
 * Money in the payload and in the actions' bodies is dollars. A unit cost keeps its fractions of a
 * cent ($0.0425 a ml); a line's cost comes rounded to the cent.
 */

const KIND = { material: 'Material', service: 'Service', labour: 'Labour' };
export const inputOf = (id) => INPUTS.find((i) => i.id === id);
/** "1", "0.25", "12.5": up to 4 places, no trailing zeros. */
const qty = (n) => (n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 }));
/** An amount with its unit: "12 ml", "0.25 h", "1 each". */
export const amountOf = (n, unit) => (n == null || !isFinite(n) ? '—' : `${qty(n)} ${unit}`);
const perUnit = (unit) => (unit === 'each' ? ' each' : `/${unit}`);
/** A unit cost: to the cent, or to 4 places under 10¢ ($0.0425/ml). */
export function unitCostText(v, unit) {
  if (v == null || !isFinite(v)) return 'Not known yet';
  const small = v > 0 && v < 0.1;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: small ? 4 : 2 }) + perUnit(unit);
}
/** Money that can be less than nothing (a margin). */
const signed = (v) => (v < 0 ? '−' + money(-v) : money(v));
const share = (s) => (s == null || !isFinite(s) ? '—' : `${(s * 100).toFixed(1)}%`);
const ofVariant = (o, s) => [o, s].filter(Boolean).join(' ') || 'Any colour or size';
const products = (n) => `${n} product${n === 1 ? '' : 's'}`;
const lineCount = (n) => `${n} line${n === 1 ? '' : 's'}`;
/** The products the shop makes: not a deposit, not archived. */
const makeable = () => PR.filter((p) => !p.dep && p.st !== 'arch');
/** The products whose recipe uses an input, with that line. */
const usedBy = (iid) =>
  Object.entries(RECIPES)
    .map(([pid, r]) => [prOf(pid), (r.lines || []).find((l) => l.input === iid)])
    .filter(([p, l]) => p && l);
/** Why a line's other side is missing: the API says "zero" for a unit cost that isn't known yet too. */
const noteOf = (l, i) => (i && i.unitCost == null ? (l.amount == null ? 'No unit cost yet: the amount is worked out once it has one' : 'No unit cost yet: it costs nothing until it has one') : l.note);
/** "+12 each", "−0.5 m": a stock move. */
const moveQty = (n, unit) => (n > 0 ? '+' : n < 0 ? '−' : '') + amountOf(Math.abs(n), unit);
/** To the millionth, as the API keeps quantities. */
const round6 = (v) => Math.round(v * 1e6) / 1e6;
/** A run's colour and size: "Black M", "One size". */
const runVariant = (o, s) => [o, s].filter(Boolean).join(' ') || 'One size';
const productName = (pid) => {
  const p = prOf(pid);
  return p ? pName(p) : pid;
};
const productShort = (pid) => {
  const p = prOf(pid);
  return p ? shortN(p) : pid;
};
/** What a run used of one input: "12 × Blank tee", "144 m Thread". */
const usedText = (u) => {
  const i = inputOf(u.input);
  return i?.unit === 'each' ? `${qty(u.quantity)} × ${i.name}` : `${amountOf(u.quantity, i?.unit ?? '')} ${i?.name ?? u.input}`;
};
const REASON = { purchase: 'Bought', run: 'Used in a run', adjust: 'Counted', waste: 'Written off' };
const lastBought = (i) => (i.lastPurchase ? `${fmtD(i.lastPurchase.at)} · ${qty(i.lastPurchase.quantity)} for ${money(i.lastPurchase.total)}` : 'Not yet');

/* ── Shop → Costs ─────────────────────────────────────────────────────── */

const listed = () => INPUTS.filter((i) => (SS.cf === 'all' ? true : SS.cf === 'arch' ? i.archived : !i.archived));
/** The line that costs the most a product, and where. */
function dearest() {
  let best = null;
  for (const [pid, r] of Object.entries(RECIPES)) for (const l of r.lines || []) if (prOf(pid) && (!best || l.cost > best[1].cost)) best = [prOf(pid), l];
  return best;
}
export function costsTitle() {
  const n = INPUTS.filter((i) => !i.archived).length;
  return n ? `${n} input${n === 1 ? '' : 's'} go into the products.` : 'No inputs in the library yet.';
}
export function sCosts() {
  const live = INPUTS.filter((i) => !i.archived),
    kept = live.filter((i) => i.stocked),
    low = kept.filter((i) => i.low),
    arch = INPUTS.length - live.length,
    top = dearest();
  const opts = [
    ['live', 'In use', live.length],
    ['arch', 'Archived', arch],
    ['all', 'All', INPUTS.length],
  ];
  const list = listed();
  const rows = list.map((i) => (
    <tr key={i.id} className={`click${i.archived ? ' rest' : ''}`} data-sinput={i.id} tabIndex="0">
      <td className="l">
        <b>{i.name}</b>
        {i.archived || i.note ? <span className="small quiet">{i.archived ? 'Archived' : i.note}</span> : ''}
      </td>
      <td className="l">{KIND[i.kind] ?? i.kind}</td>
      <td className="l mono">{i.unit}</td>
      <td>{unitCostText(i.unitCost, i.unit)}</td>
      <td className="l">
        {i.stocked ? (
          <>
            <b className={i.low ? 'weak' : ''}>{amountOf(i.onHand ?? 0, i.unit)}</b>
            <span className="small quiet">Kept on hand{i.low ? ' · low' : ''}</span>
          </>
        ) : (
          <span className="quiet">Made to order</span>
        )}
      </td>
      <td>{i.usedIn ? `Used in ${products(i.usedIn)}` : <span className="quiet">Not used yet</span>}</td>
      <td className="l">{i.lastPurchase ? lastBought(i) : <span className="quiet">Not bought yet</span>}</td>
    </tr>
  ));
  const cell = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">{SS.cf === 'arch' ? 'Archived inputs' : SS.cf === 'all' ? 'Every input' : 'The inputs library'}</span>
        <span className="hd-tools">{ddHtml('scf', opts, SS.cf, 'Show')}</span>
      </header>
      <div className="c-fig">{figHtml(String(live.length), `inputs · ${kept.length} kept on hand${low.length ? `, ${low.length} low` : ''} · select one to see where it goes`)}</div>
      <div className="c-body flush">
        <div className="tbl-wrap">
          <table className="tbl compact">
            <thead>
              <tr>
                <th className="l">Input</th>
                <th className="l">Kind</th>
                <th className="l">Unit</th>
                <th>Unit cost</th>
                <th className="l">Stock</th>
                <th>Used in</th>
                <th className="l">Last bought</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows
              ) : (
                <tr>
                  <td className="l quiet" colSpan="7">
                    {SS.cf === 'arch' ? 'Nothing archived.' : 'None yet. Add the materials, services and labour that go into the products.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {strip([
        ['Inputs', String(live.length)],
        ['Kept on hand', String(kept.length)],
        ['Low', String(low.length), low.map((i) => i.name).join(', '), low.length ? 'warn' : ''],
        ['Dearest a product', top ? `${inputOf(top[1].input)?.name ?? top[1].input} · ${money(top[1].cost)}` : 'None yet', top ? `in ${pName(top[0])}` : ''],
      ])}
    </section>
  );
  return G('Inputs', 'What goes into each product', '', cell);
}

/** The Costs tab's button in the page head. */
export const costsTool = () => (
  <button className="btn btn-p" type="button" data-cflow="input">
    Add an input
  </button>
);

/* ── An input's pane ──────────────────────────────────────────────────── */

export function inputPane() {
  const i = inputOf(SS.input);
  if (!i) return '';
  const uses = usedBy(i.id);
  const chip = i.archived ? ['plain', 'Archived'] : i.low ? ['underway', 'Low'] : i.stocked ? ['settled', 'Kept on hand'] : ['plain', 'Made to order'];
  const facts = sec(
    'Facts',
    kv([
      ['Kind', KIND[i.kind] ?? i.kind],
      ['Unit', i.unit],
      ['Unit cost', unitCostText(i.unitCost, i.unit)],
      ['Stock', i.stocked ? `${amountOf(i.onHand ?? 0, i.unit)} on hand` : 'Made to order'],
      ...(i.stocked ? [['Low mark', i.lowMark == null ? 'None set' : amountOf(i.lowMark, i.unit)]] : []),
      ['Note', i.note || '—', 1],
    ]),
    <button type="button" className="pn-link" data-cflow="archive" data-cid={i.id}>
      {i.archived ? 'Restore' : 'Archive'}
    </button>,
  );
  const lp = i.lastPurchase;
  // the history (Phase 10c), newest first; an older answer has only the latest
  const ps = i.purchases ?? (lp ? [{ ...lp, unitCost: lp.quantity ? lp.total / lp.quantity : null, note: '' }] : []);
  const bought = sec(
    'Purchases',
    <div className="pn-list">
      {ps.length ? (
        ps.map((x, n) => (
          <div key={n} className="pn-r">
            <span className="ev-d">{fmtD(x.at)}</span>
            <span className="pn-k">
              <b>
                {amountOf(x.quantity, i.unit)}
                {' for '}
                {money(x.total)}
              </b>
              <span className="small quiet">
                {x.supplier || 'No supplier given'}
                {' · '}
                {unitCostText(x.unitCost, i.unit)}
                {x.note ? ` · ${x.note}` : ''}
              </span>
            </span>
            <span className="small quiet">{n === 0 ? 'Latest' : ''}</span>
          </div>
        ))
      ) : (
        <p className="quiet small" style={css('margin:0')}>
          None yet.
        </p>
      )}
      {ps.length ? (
        <p className="quiet small" style={css('margin:8px 0 0')}>
          The latest purchase sets the unit cost. Earlier ones are kept{ps.length >= 20 ? ': the latest 20 show here' : ''}.
        </p>
      ) : (
        ''
      )}
    </div>,
    i.archived ? (
      ''
    ) : (
      <button type="button" className="pn-link" data-cflow="purchase" data-cid={i.id}>
        Record a purchase
      </button>
    ),
  );
  // a kept-on-hand input's stock ledger: bought, used, counted, written off
  const moves = i.moves ?? [];
  const moveNote = (m) => {
    if (m.reason === 'run') {
      const r = RUNS.find((x) => x.id === m.ref);
      return r ? `${r.units} ${productName(r.product)} · ${runVariant(r.option, r.size)}` : 'A production run';
    }
    if (m.reason === 'purchase') return m.note || 'No supplier given';
    return m.note || (m.reason === 'waste' ? 'No reason given' : 'No note');
  };
  const ledger = i.stocked
    ? sec(
        'Stock ledger',
        <div className="pn-list">
          {moves.length ? (
            moves.map((m, n) => (
              <div key={n} className="pn-r">
                <span className="ev-d">{fmtD(m.at)}</span>
                <span className="pn-k">
                  <b>{REASON[m.reason] ?? m.reason}</b>
                  <span className="small quiet">{moveNote(m)}</span>
                </span>
                <b className="num">{moveQty(m.quantity, i.unit)}</b>
              </div>
            ))
          ) : (
            <p className="quiet small" style={css('margin:0')}>
              No moves yet. A purchase, a run, a count or a write-off shows here.
            </p>
          )}
          {moves.length >= 30 ? (
            <p className="quiet small" style={css('margin:8px 0 0')}>
              The latest 30 show here.
            </p>
          ) : (
            ''
          )}
        </div>,
        i.archived ? (
          ''
        ) : (
          <>
            <button type="button" className="pn-link" data-cflow="count" data-cid={i.id}>
              Count stock
            </button>
            <button type="button" className="pn-link" data-cflow="waste" data-cid={i.id}>
              Write off
            </button>
          </>
        ),
      )
    : '';
  const used = sec(
    'Used in',
    <div className="pn-list">
      {uses.length ? (
        uses.map(([p, l]) => (
          <button key={p.id} type="button" className="pn-r" data-product={p.id}>
            {glyph(p, 'sm')}
            <span className="pn-k">
              <b>{pName(p)}</b>
              <span className="small quiet">
                {l.amount == null ? (l.note ? noteOf(l, i) : 'No amount yet') : `${amountOf(l.amount, i.unit)} a product`}
                {l.entered === 'cost' ? (l.typed != null ? ` · entered as ${money(l.typed)}` : ' · entered as a cost') : ''}
              </span>
            </span>
            <b className="num">{money(l.cost)}</b>
          </button>
        ))
      ) : (
        <p className="quiet small" style={css('margin:0')}>
          None yet.
        </p>
      )}
    </div>,
    i.archived ? (
      ''
    ) : (
      <button type="button" className="pn-link" data-cflow="apply" data-cid={i.id}>
        Add to products…
      </button>
    ),
  );
  const foot = i.archived ? (
    <>
      <button className="btn btn-p" type="button" data-cflow="archive" data-cid={i.id}>
        Restore
      </button>
      <button className="btn btn-g" type="button" data-cflow="input" data-cid={i.id}>
        Edit
      </button>
    </>
  ) : (
    <>
      <button className="btn btn-p" type="button" data-cflow="input" data-cid={i.id}>
        Edit
      </button>
      <button className="btn btn-g" type="button" data-cflow="purchase" data-cid={i.id}>
        Record a purchase
      </button>
      <button className="btn btn-g hide-s" type="button" data-cflow="apply" data-cid={i.id}>
        Add to products…
      </button>
    </>
  );
  return (
    <>
      <div className="pane-scrim" data-closespane="" />
      <aside className="pane" role="dialog" aria-label="Input">
        <header className="m-hd">
          <span className="sub">Input</span>
          <span style={css('display:flex;align-items:center;gap:8px')}>
            <span className={`chip ${chip[0]}`}>{chip[1]}</span>
            <button className="x" type="button" data-closespane="" aria-label="Close">
              {ic('close')}
            </button>
          </span>
        </header>
        <div className="pane-mn">
          <div>
            <p className="h2" style={css('font-size:26px')}>
              {i.name}
            </p>
            <p className="quiet" style={css('margin:6px 0 0')}>
              {KIND[i.kind] ?? i.kind}
              {' · '}
              {unitCostText(i.unitCost, i.unit)}
              {' · '}
              {i.usedIn ? `used in ${products(i.usedIn)}` : 'not used yet'}
            </p>
          </div>
          {facts}
          {bought}
          {ledger}
          {used}
        </div>
        <footer className="pane-ft">{foot}</footer>
      </aside>
    </>
  );
}

/* ── Inventory: materials and production runs (Phase 10c) ────────────── */

/** The products a run can be recorded for: a recipe, and the colours and sizes Command keeps stock of. */
const runnable = () =>
  Object.keys(RECIPES)
    .map(prOf)
    .filter((p) => p && !p.dep && p.st !== 'arch' && Object.keys(STK[p.id] ?? {}).length);
const optsOf = (pid) => Object.keys(STK[pid] ?? {});
const sizesOf = (pid, opt) => ((STK[pid]?.[opt]?.length ?? 0) === SIZES.length ? SIZES : ['']);
const sizeFor = (pid, opt, cur) => {
  const ss = sizesOf(pid, opt);
  return ss.includes(cur) ? cur : ss.includes('M') ? 'M' : ss[0];
};
/** What's on the shelf of a colour and size now. */
const shelfOf = (pid, opt, size) => {
  const ss = sizesOf(pid, opt);
  return STK[pid]?.[opt]?.[Math.max(0, ss.indexOf(size))] ?? 0;
};
/** A recipe line's amount for a colour and size, with the override the API would pick: colour and size, then size, then colour. */
function amountFor(pid, iid, opt, size) {
  const r = RECIPES[pid];
  const ovs = (r?.overrides ?? []).filter((o) => o.input === iid);
  const o = ovs.find((x) => x.option && x.size && x.option === opt && x.size === size) ?? ovs.find((x) => !x.option && x.size && x.size === size) ?? ovs.find((x) => x.option && !x.size && x.option === opt);
  return (o ?? r?.lines?.find((x) => x.input === iid))?.amount ?? null;
}
/** What a run of `units` uses of each kept-on-hand input, and what's left after; worked out as the API's run action does. */
function runPlan(pid, opt, size, units) {
  const plan = { uses: [], unknown: [], toOrder: [] };
  for (const l of RECIPES[pid]?.lines ?? []) {
    const i = inputOf(l.input);
    if (!i?.stocked) {
      plan.toOrder.push(l.input);
      continue;
    }
    const per = amountFor(pid, l.input, opt, size);
    if (per == null) {
      plan.unknown.push(l.input);
      continue;
    }
    const quantity = round6(per * units),
      on = i.onHand ?? 0,
      after = round6(on - quantity);
    plan.uses.push({ input: l.input, per, quantity, on, after, short: after < -1e-9 });
  }
  return plan;
}

/** Inventory's Materials: each kept-on-hand input against its low mark, and what it covers. */
function materialsCell() {
  const list = MATERIALS.onHand ?? [];
  const low = list.filter((m) => m.low);
  // the product that runs out first, and the input it runs out of
  const first = Object.entries(MATERIALS.makes ?? {})
    .map(([pid, k]) => [prOf(pid), k])
    .filter(([p, k]) => p && p.st !== 'arch' && k && k.units != null)
    .sort((a, b) => a[1].units - b[1].units)[0];
  const rows = list.map((m) => {
    const i = inputOf(m.input);
    const on = Number(m.onHand) || 0;
    // the bar is against the largest purchase, or the low mark, whichever is more
    const top = Math.max(on, m.lowMark ?? 0, i?.lastPurchase?.quantity ?? 0, ...(i?.purchases ?? []).map((x) => x.quantity));
    const pct = (v) => (top > 0 ? Math.min(100, (Math.max(0, v) / top) * 100) : 0).toFixed(1);
    const cov = Object.entries(MATERIALS.covers?.[m.input] ?? {})
      .map(([pid, n]) => [prOf(pid), n])
      .filter(([p]) => p)
      .sort((a, b) => a[1] - b[1]);
    return (
      <button key={m.input} type="button" className="pn-r two cvb-r" data-sinput={m.input} style={css('padding:10px 0')}>
        <span className="pn-k">
          <b>{m.name}</b>
          <span className="wb-b" style={css('display:block;margin:6px 0')}>
            <i style={css(`width:${pct(on)}%${m.low ? ';background:var(--underway)' : ''}`)} />
            {m.lowMark != null && top > 0 ? <em style={css(`left:${pct(m.lowMark)}%`)} /> : ''}
          </span>
          <span className="small quiet">
            {m.lowMark == null ? 'No low mark' : `Low mark ${amountOf(m.lowMark, m.unit)}`}
            {' · '}
            {cov.length ? `covers ${cov.map(([p, n]) => `${n} ${shortN(p)}`).join(', ')}` : 'in no recipe yet'}
          </span>
        </span>
        <b className={`num${m.low ? ' warn' : ''}`}>{amountOf(on, m.unit)}</b>
      </button>
    );
  });
  return (
    <section className="cell s-6">
      <header className="c-hd">
        <span className="lbl">Materials</span>
        <span className="tag">{list.length ? 'Select one for its ledger' : ''}</span>
      </header>
      <div className="c-fig">{figHtml(String(list.length), `materials kept on hand · ${low.length ? `${low.length} low` : 'none low'}`)}</div>
      <div className="c-body start">
        {rows.length ? (
          <>
            <div className="pn-list cvb">{rows}</div>
            {mkey([
              ['var(--fg)', 'On hand'],
              ['var(--underway)', 'At or under its low mark'],
              ['var(--fg-50)', 'Tick · low mark'],
            ])}
          </>
        ) : (
          <p className="quiet small" style={css('margin:0')}>
            No materials kept on hand yet. Add them on Costs.
          </p>
        )}
      </div>
      {strip([
        ['Kept on hand', String(list.length)],
        ['Low', String(low.length), low.map((m) => m.name).join(', '), low.length ? 'warn' : ''],
        [
          'Runs out first',
          first ? shortN(first[0]) : 'Nothing yet',
          first
            ? first[1].units > 0
              ? `${first[1].units} more before ${inputOf(first[1].binding)?.name ?? first[1].binding} runs out`
              : `${inputOf(first[1].binding)?.name ?? first[1].binding} has run out`
            : 'No recipe uses a material kept on hand',
          first && first[1].units === 0 ? 'warn' : '',
        ],
      ])}
    </section>
  );
}

const SHOWN_RUNS = 10;
/** Inventory's Runs: the recent production runs, and recording one. */
function runsCell() {
  const units = RUNS.reduce((a, r) => a + (r.units || 0), 0),
    short = RUNS.filter((r) => r.short).length;
  const rows = RUNS.slice(0, SHOWN_RUNS).map((r) => (
    <div key={r.id} className="pn-r">
      <span className="ev-d">{fmtD(r.at)}</span>
      <span className="pn-k">
        <b>
          {productName(r.product)}
          {' · '}
          {runVariant(r.option, r.size)}
        </b>
        <span className="small quiet">
          {r.who || 'Someone'}
          {r.note ? ` · ${r.note}` : ''}
        </span>
        <span className="small quiet">{r.uses?.length ? `Used ${r.uses.map(usedText).join(', ')}` : 'Used nothing kept on hand'}</span>
        {r.short ? (
          <span className="small" style={css('color:var(--underway)')}>
            Short: recorded with too little on hand
          </span>
        ) : (
          ''
        )}
      </span>
      <b className="num">+{r.units}</b>
    </div>
  ));
  return (
    <section className="cell s-6">
      <header className="c-hd">
        <span className="lbl">Production runs</span>
        <span className="hd-tools">
          <button className="btn btn-g btn-s" type="button" data-cflow="run">
            Record a run
          </button>
        </span>
      </header>
      <div className="c-fig">{figHtml(String(RUNS.length), RUNS.length ? `recent runs · ${units} units made` : 'runs recorded')}</div>
      <div className="c-body start">
        {rows.length ? (
          <div className="pn-list">
            {rows}
            {RUNS.length > SHOWN_RUNS ? (
              <p className="quiet small" style={css('margin:8px 0 0')}>
                And {RUNS.length - SHOWN_RUNS} earlier.
              </p>
            ) : (
              ''
            )}
          </div>
        ) : (
          <p className="quiet small" style={css('margin:0')}>
            No runs recorded yet. Record one when a batch is made: it uses up the materials by the recipe and adds the units to stock.
          </p>
        )}
      </div>
      {strip([
        ['Units made', String(units)],
        ['Short', String(short), short ? 'too little on hand' : '', short ? 'warn' : ''],
        ['Latest', RUNS[0] ? fmtD(RUNS[0].at) : 'None yet', RUNS[0] ? productShort(RUNS[0].product) : ''],
      ])}
    </section>
  );
}
/** Inventory's Materials group, live only. */
export const stockGroup = () =>
  G(
    'Materials',
    'Kept on hand, and what’s been made',
    '',
    <>
      {materialsCell()}
      {runsCell()}
    </>,
  );

/* ── The product pane's recipe ────────────────────────────────────────── */

const KIND_FILL = { material: 'var(--fg)', service: 'var(--fg-50)', labour: 'var(--line)' };
/** The sizes (and, where colours differ, the colours) a recipe costs differently, from its variants. */
function bySize(r) {
  const out = [];
  const sizes = [...new Set(r.variants.map((v) => v.size))];
  for (const s of sizes) {
    const vs = r.variants.filter((v) => v.size === s);
    if (vs.every((v) => v.cost === vs[0].cost)) out.push([s || 'One size', vs[0]]);
    else for (const v of vs) out.push([`${v.option}${s ? ' ' + s : ''}`, v]);
  }
  return out;
}
/** A product's recipe, in place of its Price section, when it has one. */
export function recipeSec(p) {
  const r = RECIPES[p.id];
  const edit = p.st !== 'arch';
  const lines = r.lines || [],
    ovs = r.overrides || [];
  const m = r.margin || { amount: 0, share: null };
  const lineRow = (l, o) => {
    const i = inputOf(l.input);
    const unit = i?.unit ?? '';
    const Tag = edit ? 'button' : 'div';
    const at = o ? { 'data-cflow': 'override', 'data-copt': o.option, 'data-csize': o.size } : { 'data-cflow': 'line' };
    return (
      <Tag key={(o ? `${o.option}|${o.size}|` : '') + l.input} {...(edit ? { type: 'button', ...at, 'data-sid': p.id, 'data-cid': l.input } : {})} className="pn-r">
        {o ? <span className="ev-d">{ofVariant(o.option, o.size)}</span> : <span className="ev-d">{KIND[i?.kind] ?? 'Input'}</span>}
        <span className="pn-k">
          <b>
            {i?.name ?? l.input}
            {i?.archived ? ' · archived' : ''}
          </b>
          <span className="small quiet">
            {l.amount == null ? 'No amount' : amountOf(l.amount, unit)}
            {l.entered === 'cost' ? (l.typed != null ? ` · entered as ${money(l.typed)}` : ' · entered as a cost') : ''}
          </span>
          {l.note ? <span className="small quiet">{noteOf(l, i)}</span> : ''}
        </span>
        <b className="num">{money(l.cost ?? 0)}</b>
      </Tag>
    );
  };
  const sizes = r.differs ? bySize(r) : [];
  return sec(
    'Recipe',
    <>
      <div className="ld ld-one">
        <span className="ld-b">
          <span className="ld-t" style={css('width:100%')}>
            {lines.map((l) => (
              <i key={l.input} style={css(`flex:${Math.max(0, l.cost || 0)};background:${KIND_FILL[inputOf(l.input)?.kind] ?? 'var(--fg-50)'}`)} />
            ))}
            <i className="ld-m" style={css(`flex:${Math.max(0, m.amount || 0)}`)} />
          </span>
        </span>
      </div>
      <div className="pn-list">
        {lines.length ? lines.map((l) => lineRow(l)) : <p className="quiet small">None yet.</p>}
        {ovs.map((o) => lineRow(o, o))}
      </div>
      {kv([
        ['Cost', money(r.cost ?? 0)],
        ['Price', money(p.price)],
        ['Margin', `${signed(m.amount ?? 0)} · ${share(m.share)}`, 1],
      ])}
      {sizes.length ? (
        <div className="pn-list">
          <div className="pn-h">
            <span className="lbl">By size</span>
            <span className="small quiet">Cost · margin</span>
          </div>
          {sizes.map(([k, v]) => (
            <div key={k} className="pn-r">
              <span className="ev-d">{k}</span>
              <span className="pn-k">
                <b>{money(v.cost)}</b>
              </span>
              <span className="num">
                {signed(v.margin?.amount ?? 0)}
                {' · '}
                {share(v.margin?.share)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        ''
      )}
      {edit ? (
        <div className="pn-a">
          <button type="button" className="pn-link" data-cflow="override" data-sid={p.id}>
            For a colour or size
          </button>
          <button type="button" className="pn-link" data-cflow="copy" data-sid={p.id}>
            Copy to other products
          </button>
        </div>
      ) : (
        ''
      )}
    </>,
    edit ? (
      <button type="button" className="pn-link" data-cflow="line" data-sid={p.id}>
        Add a line
      </button>
    ) : (
      ''
    ),
  );
}
/** "$14.91", or "$14.91–$16.51" when the week's sizes cost differently. */
const costRange = (lo, hi) => (lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`);
/** A product's cost at sale over time (Phase 10d): today's, then each week it sold, as its sales recorded. */
export function costHistSec(p) {
  const ws = COST_HIST[p.id] || [];
  if (!ws.length) return '';
  return sec(
    'Cost at sale',
    <>
      <div className="pn-list">
        <div className="pn-r">
          <span className="ev-d">Now</span>
          <span className="pn-k">
            <b>{money(RECIPES[p.id]?.cost ?? unitCost(p))}</b>
            <span className="small quiet">{RECIPES[p.id] ? 'From the recipe' : 'From the costs entered'}</span>
          </span>
          <span />
        </div>
        {ws.map((w) => (
          <div key={w.week} className="pn-r">
            <span className="ev-d">{fmtD(w.week)}</span>
            <span className="pn-k">
              <b>{costRange(w.low, w.high)}</b>
              <span className="small quiet">
                {w.units}
                {' sold that week'}
                {w.later ? ' · costed later' : ''}
              </span>
            </span>
            <span />
          </div>
        ))}
      </div>
      {ws.some((w) => w.later) ? (
        <p className="quiet small" style={css('margin:8px 0 0')}>
          Sales from before costs were recorded were costed later, at the recipe as it stood then.
        </p>
      ) : (
        ''
      )}
    </>,
  );
}
/** An order's cost to make and its margin on the items (Phase 10d), from See: each line as it cost when it sold, or today's for one not costed yet. */
export function orderCostRows(o, sub) {
  const items = o[4];
  if (!items.some((i) => i.length > 4)) return [];
  let cost = 0,
    bare = 0;
  for (const [pid, , , q, c] of items) {
    const p = prOf(pid);
    if (c == null) bare++;
    cost += q * (c ?? (p ? unitCost(p) : 0));
  }
  const m = sub - cost;
  return [
    ['Cost to make', `${money(cost)}${bare ? ` · ${bare === 1 ? 'a line' : `${bare} lines`} at today’s cost` : ''}`],
    ['Margin on items', `${signed(m)} · ${share(sub ? m / sub : null)}`],
  ];
}
/** For a product with no recipe yet: its boxes stay, and a recipe can be started. */
export const startRecipe = (p) => (
  <button type="button" className="pn-link" data-cflow="line" data-sid={p.id}>
    Start a recipe
  </button>
);

/* ── The flows ────────────────────────────────────────────────────────── */

/** The open flow: which, for what, and what's been picked in it. Typed fields survive a redraw. */
const CF = { kind: '', fixed: false, pid: '', iid: '', opt: '', size: '', mode: 'amount', ikind: 'material', stocked: false, cmode: 'unit', copy: 'merge', picked: new Set(), back: null };
const val = (id) => (document.getElementById(id)?.value ?? '').trim();
/** A typed number: "$1,200.50" is 1200.5, nothing typed is null, anything else NaN. */
const num = (s) => {
  const t = String(s ?? '').replace(/[$,\s]/g, '');
  return t === '' ? null : /^\d*\.?\d+$|^\d+\.$/.test(t) ? Number(t) : NaN;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ucEdit = (v) => (v == null ? '' : String(Number(v.toFixed(4))));
const fail = (m) => {
  throw new Error(m);
};

function seg(opts, cur, key, aria) {
  return (
    <div className="seg2" role="group" aria-label={aria}>
      {opts.map(([v, t]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={v === cur}
          onClick={() => {
            CF[key] = v;
            redraw();
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
/** Products to pick, each a toggle. */
function pickProducts(list) {
  if (!list.length)
    return (
      <p className="quiet small" style={css('margin:0')}>
        No other products yet.
      </p>
    );
  return (
    <div className="seg2" role="group" aria-label="Products">
      {list.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={CF.picked.has(p.id)}
          onClick={(e) => {
            CF.picked.has(p.id) ? CF.picked.delete(p.id) : CF.picked.add(p.id);
            e.currentTarget.setAttribute('aria-pressed', String(CF.picked.has(p.id)));
            compute();
          }}
        >
          {pName(p)}
        </button>
      ))}
    </div>
  );
}
const field = (id, label, value, extra = {}) => (
  <label className="field">
    <span className="lbl">{label}</span>
    <input type="text" id={id} defaultValue={value ?? ''} autoComplete="off" onInput={compute} {...extra} />
  </label>
);
/** Amount or cost, the other worked out live. */
function eitherWay(i, amount, cost) {
  return (
    <>
      {seg(
        [
          ['amount', 'Amount used'],
          ['cost', 'Cost per product'],
        ],
        CF.mode,
        'mode',
        'Entered as',
      )}
      {CF.mode === 'amount'
        ? field('cf-val', i ? `Amount used a product, in ${i.unit}` : 'Amount used a product', amount == null ? '' : qty(amount).replace(/,/g, ''), { inputMode: 'decimal' })
        : field('cf-val', 'Cost per product', cost == null ? '' : money(cost), { inputMode: 'decimal' })}
    </>
  );
}
const out = (k) => <span data-cout={k}>—</span>;

/** The live sums: what a purchase works out to, what a line costs or uses. */
function compute() {
  const set = (k, t) => document.querySelectorAll(`#modalRoot [data-cout="${k}"]`).forEach((el) => (el.textContent = t));
  if (CF.kind === 'count' || CF.kind === 'waste') {
    const i = inputOf(CF.iid);
    if (!i) return;
    const on = i.onHand ?? 0,
      v = num(val('cf-qty'));
    const typed = v != null && isFinite(v) && v >= 0;
    if (CF.kind === 'count') {
      const d = typed ? round6(v - on) : null;
      set('diff', d == null ? 'Type what you counted' : Math.abs(d) < 1e-9 ? 'None: it matches the books' : moveQty(d, i.unit));
      set('after', typed ? amountOf(v, i.unit) : '—');
    } else {
      const after = typed ? round6(on - v) : null;
      set('after', after == null ? 'Type the amount written off' : after < -1e-9 ? `Can’t go below nothing: ${amountOf(on, i.unit)} on hand` : amountOf(after, i.unit));
    }
    return;
  }
  if (CF.kind === 'run') return computeRun(set);
  if (CF.kind === 'input' || CF.kind === 'purchase') {
    const unit = CF.kind === 'input' ? (CF.ikind === 'labour' ? 'h' : val('cf-unit').toLowerCase() || 'unit') : (inputOf(CF.iid)?.unit ?? 'unit');
    set('unit', unit);
    if (CF.kind === 'purchase' || CF.cmode === 'paid') {
      const paid = num(val('cf-paid')),
        q = num(val('cf-qty'));
      set('uc', paid != null && q && isFinite(paid) && isFinite(q) && q > 0 ? unitCostText(paid / q, unit) : 'Type what was paid and how many came');
    } else {
      const u = num(val('cf-uc'));
      set('uc', u == null ? 'Not known yet' : isFinite(u) ? unitCostText(u, unit) : 'Type a number');
    }
    return;
  }
  if (CF.kind === 'line' || CF.kind === 'override' || CF.kind === 'apply') {
    const i = inputOf(CF.iid);
    if (CF.kind === 'apply') set('n', CF.picked.size ? products(CF.picked.size) : 'None picked yet');
    if (!i) return set('worked', 'Pick an input');
    const v = num(val('cf-val')),
      u = i.unitCost;
    if (v == null || !isFinite(v)) return set('worked', CF.mode === 'amount' ? 'Type the amount used' : 'Type the cost per product');
    if (CF.mode === 'amount') set('worked', u == null ? `${money(0)} · ${i.name} has no unit cost yet, so it costs nothing until it has one` : `${money(v * u)} a product`);
    else set('worked', !u ? `${i.name} has no unit cost yet, so the amount is worked out once it has one` : `${amountOf(v / u, i.unit)} a product`);
  }
}

/** Opens a costing flow: input (add or edit), purchase, archive, apply, line, override, copy. */
export function openCostFlow(kind, pid = '', iid = '', ds = {}) {
  vars.lastFocus = document.activeElement;
  const i = inputOf(iid);
  Object.assign(CF, { kind, fixed: false, pid: pid || '', iid: iid || '', opt: ds.copt ?? '', size: ds.csize ?? '', mode: 'amount', copy: 'merge', picked: new Set(), back: ds.back ?? null });
  if (kind === 'input') Object.assign(CF, { ikind: i?.kind ?? 'material', stocked: !!i?.stocked, cmode: 'unit' });
  if (kind === 'line' || kind === 'override') {
    const r = RECIPES[CF.pid];
    const l = kind === 'override' ? r?.overrides?.find((o) => o.input === CF.iid && o.option === CF.opt && o.size === CF.size) : r?.lines?.find((x) => x.input === CF.iid);
    if (l?.entered === 'cost') CF.mode = 'cost';
    // opened on a line or override that's there: its input (and colour and size) stay as they are
    CF.fixed = !!l;
    // a new line starts on the first input that isn't in the recipe yet
    if (kind === 'line' && !CF.iid) CF.iid = INPUTS.find((x) => !x.archived && !r?.lines?.some((y) => y.input === x.id))?.id ?? '';
    if (kind === 'override' && !CF.iid) CF.iid = r?.lines?.[0]?.input ?? '';
  }
  // a run starts on the first product it can be recorded for, its first colour, and M where it's sized
  if (kind === 'run') {
    if (!runnable().some((x) => x.id === CF.pid)) CF.pid = runnable()[0]?.id ?? '';
    CF.opt = optsOf(CF.pid)[0] ?? '';
    CF.size = sizeFor(CF.pid, CF.opt, '');
  }
  draw();
}
function draw() {
  const f = build();
  if (!f) return;
  vModal(f, 'c:' + CF.kind);
  compute();
}
/** Draws the flow again after a choice, keeping what was typed. */
function redraw() {
  const kept = [...document.querySelectorAll('#modalRoot input[id]')].filter((x) => !x.disabled).map((x) => [x.id, x.value]);
  const focus = document.activeElement?.id;
  draw();
  for (const [id, v] of kept) {
    const el = document.getElementById(id);
    if (el && !el.disabled) el.value = v;
  }
  compute();
  if (focus) document.getElementById(focus)?.focus();
}
/** A pick from a dropdown in a costing flow (kit.tsx ddPick hands over ids starting cf-). */
export function costPick(id, v) {
  if (id === 'cf-prod') {
    CF.pid = v;
    CF.opt = optsOf(v)[0] ?? '';
    CF.size = sizeFor(v, CF.opt, CF.size);
  }
  if (id === 'cf-input') {
    if (v === '__new') return openCostFlow('input', '', '', { back: { kind: CF.kind, pid: CF.pid, opt: CF.opt, size: CF.size } });
    CF.iid = v;
  }
  redraw();
}

/** Saves a flow: checks what was typed, runs its actions in order, loads Shop again, shows the steps. */
function submit(f, calls) {
  const b = document.querySelector('#modalRoot [data-vgo]');
  let seq;
  try {
    seq = calls();
  } catch (e) {
    return toast(e.message);
  }
  if (!LIVE) return stepFlow('Working', f.steps, f.done, () => render());
  if (b) b.disabled = true;
  (async () => {
    const rs = [];
    try {
      // one after another: a later body can use an earlier answer (a new input's id)
      for (const [kind, body] of seq) rs.push(await api('POST', `/actions/shop/${kind}`, typeof body === 'function' ? body(rs) : body));
    } finally {
      await reloadSection('shop').catch(() => undefined);
    }
    return rs;
  })().then(
    (rs) => (f.then ? f.then(rs) : stepFlow('Working', f.steps, f.done, () => render())),
    (e) => {
      if (b) b.disabled = false;
      toast(e.message);
    },
  );
}
/** Takes a line or an override out, from inside its flow. */
function removeIt(kind, body, what) {
  if (!LIVE) return closeModal();
  api('POST', `/actions/shop/${kind}`, { ...body, remove: true })
    .then(() => reloadSection('shop'))
    .then(
      () => stepFlow('Working', [what], ['Taken out.', 'The cost and margin are worked out again.'], () => render()),
      (e) => toast(e.message),
    );
}
/** The amount or cost typed, as a body's either-way half. */
function either() {
  const v = num(val('cf-val'));
  if (v == null || !isFinite(v)) fail(CF.mode === 'amount' ? 'Type the amount used' : 'Type the cost per product');
  if (CF.mode === 'amount' && v <= 0) fail('An amount used is more than nothing');
  return CF.mode === 'amount' ? { amount: v } : { cost: v };
}

function build() {
  const p = CF.pid ? prOf(CF.pid) : null;
  const i = CF.iid ? inputOf(CF.iid) : null;
  const k = CF.kind;
  if (k === 'input') return inputFlow(i);
  if (k === 'purchase' && i) {
    const f = {
      t: 'Record a purchase',
      lbl: i.name,
      h: `Bought ${i.name}`,
      p: i.stocked ? 'What came goes on hand, and the unit cost becomes what this one works out to.' : 'The unit cost becomes what this one works out to.',
      pre: (
        <>
          <div className="f2">
            {field('cf-qty', <>How many came, in {out('unit')}</>, '', { inputMode: 'decimal' })}
            {field('cf-paid', 'Total paid', '', { inputMode: 'decimal' })}
          </div>
          <div className="f2">
            {field('cf-sup', 'Supplier', i.lastPurchase?.supplier ?? '')}
            <label className="field">
              <span className="lbl">Bought on</span>
              <input type="date" id="cf-on" defaultValue={today()} max={today()} />
            </label>
          </div>
        </>
      ),
      rows: [
        ['Works out to', out('uc')],
        ['Unit cost now', unitCostText(i.unitCost, i.unit), 1],
      ],
      btn: 'Record it',
      steps: ['Recorded the purchase', i.stocked ? 'Added it to what’s on hand' : 'Set the unit cost', 'Worked out the recipes that use it'],
      done: ['Recorded.', 'Every recipe that uses it is costed at the new unit cost.'],
    };
    f.go = () =>
      submit(f, () => {
        const q = num(val('cf-qty')),
          t = num(val('cf-paid'));
        if (q == null || !isFinite(q) || q <= 0) fail('Type how many came');
        if (t == null || !isFinite(t)) fail('Type what was paid');
        const on = document.getElementById('cf-on')?.value || '';
        // today's goes in as now: dated midnight, it would count as older than one recorded earlier today
        return [['purchase', { input: i.id, quantity: q, total: t, supplier: val('cf-sup'), ...(on && on !== today() ? { on } : {}) }]];
      });
    return f;
  }
  if (k === 'archive' && i) {
    const f = {
      t: i.archived ? 'Restore' : 'Archive',
      lbl: i.name,
      h: i.archived ? `Restore ${i.name}?` : `Archive ${i.name}?`,
      p: i.archived ? 'It comes back into the library, to add to recipes and buy again.' : 'It leaves the library’s pickers. Recipes that use it keep costing it.',
      rows: [
        ['Used in', i.usedIn ? products(i.usedIn) : 'Nothing yet'],
        ['Undo', i.archived ? 'Archive it again any time' : 'Restore it any time', 1],
      ],
      btn: i.archived ? 'Restore it' : 'Archive it',
      steps: [i.archived ? 'Restored it' : 'Archived it', 'Logged it'],
      done: i.archived ? ['Restored.', 'It’s back in the library.'] : ['Archived.', 'Find it under Archived on the Costs tab.'],
    };
    f.go = () => submit(f, () => [['input-archive', { id: i.id, archived: !i.archived }]]);
    return f;
  }
  if (k === 'apply' && i) {
    const f = {
      t: 'Add to products',
      lbl: i.name,
      h: `Add ${i.name} to products`,
      p: 'Each one gets the same amount or cost a product. One that has it already gets the new one.',
      pre: (
        <>
          <span className="lbl">Products</span>
          {pickProducts(makeable())}
          {eitherWay(i, null, null)}
        </>
      ),
      rows: [
        ['Products', out('n')],
        ['Each', out('worked')],
        ['Unit cost', unitCostText(i.unitCost, i.unit), 1],
      ],
      btn: 'Add it',
      steps: ['Added it to each recipe', 'Worked out the costs and margins'],
      done: ['Added.', 'Each product’s pane shows it in its recipe.'],
    };
    f.go = () =>
      submit(f, () => {
        if (!CF.picked.size) fail('Pick at least one product');
        return [['input-apply', { input: i.id, products: [...CF.picked], ...either() }]];
      });
    return f;
  }
  if (k === 'count' && i?.stocked) {
    const f = {
      t: 'Count stock',
      lbl: i.name,
      h: `Count ${i.name}`,
      p: 'Type what’s on hand now. The difference from the books is recorded as an adjustment.',
      pre: (
        <>
          {field('cf-qty', `Counted, in ${i.unit}`, '', { inputMode: 'decimal' })}
          {field('cf-note', 'Note', '', { placeholder: 'Monthly count' })}
        </>
      ),
      rows: [
        ['On the books', amountOf(i.onHand ?? 0, i.unit)],
        ['Difference', out('diff')],
        ['On hand after', out('after'), 1],
      ],
      btn: 'Record the count',
      steps: ['Recorded the count', 'Set what’s on hand', 'Worked out what it covers'],
      done: ['Counted.', 'What’s on hand is what you counted.'],
    };
    f.go = () =>
      submit(f, () => {
        const v = num(val('cf-qty'));
        if (v == null || !isFinite(v) || v < 0) fail('Type what you counted');
        const d = round6(v - (i.onHand ?? 0));
        if (Math.abs(d) < 1e-9) fail('That’s what the books say: nothing to record');
        return [['stock-adjust', { input: i.id, quantity: d, reason: 'adjust', note: val('cf-note') }]];
      });
    return f;
  }
  if (k === 'waste' && i?.stocked) {
    const on = i.onHand ?? 0;
    const f = {
      t: 'Write off',
      lbl: i.name,
      h: `Write off ${i.name}`,
      p: 'Stock that was spoiled, damaged or lost. It comes off what’s on hand.',
      pre: (
        <>
          {field('cf-qty', `Amount written off, in ${i.unit}`, '', { inputMode: 'decimal' })}
          {field('cf-note', 'Why', '', { placeholder: 'Misprinted' })}
        </>
      ),
      rows: [
        ['On hand', amountOf(on, i.unit)],
        ['On hand after', out('after'), 1],
      ],
      btn: 'Write it off',
      steps: ['Recorded the write-off', 'Took it off what’s on hand'],
      done: ['Written off.', 'The ledger shows it, with why.'],
    };
    f.go = () =>
      submit(f, () => {
        const v = num(val('cf-qty'));
        if (v == null || !isFinite(v) || v <= 0) fail('Type the amount written off');
        if (v - on > 1e-9) fail(`Only ${amountOf(on, i.unit)} on hand`);
        if (!val('cf-note')) fail('Say why it’s written off');
        return [['stock-adjust', { input: i.id, quantity: -round6(v), reason: 'waste', note: val('cf-note') }]];
      });
    return f;
  }
  if (k === 'run') return runFlow();
  if (k === 'line' && p) return lineFlow(p, i);
  if (k === 'override' && p) return overrideFlow(p, i);
  if (k === 'copy' && p && RECIPES[p.id]) {
    const f = {
      t: 'Copy the recipe',
      lbl: pName(p),
      h: 'Copy to other products',
      p: `${lineCount((RECIPES[p.id].lines || []).length)}, with their colour and size overrides where the product has that colour or size.`,
      pre: (
        <>
          <span className="lbl">Onto</span>
          {pickProducts(makeable().filter((x) => x.id !== p.id))}
          <span className="lbl">How</span>
          {seg(
            [
              ['merge', 'Add what’s missing'],
              ['replace', 'Replace'],
            ],
            CF.copy,
            'copy',
            'How',
          )}
          <p className="quiet small" style={css('margin:0')}>
            {CF.copy === 'replace'
              ? 'Each product’s recipe becomes this one: its own lines are taken out first.'
              : 'Each product gets the lines it doesn’t have. A line it has already stays as it is.'}
          </p>
        </>
      ),
      rows: [
        ['Products', <span data-cout="n">{CF.picked.size ? products(CF.picked.size) : 'None picked yet'}</span>],
        ['From', pName(p), 1],
      ],
      btn: CF.copy === 'replace' ? 'Replace their recipes' : 'Add the lines',
      steps: ['Copied the lines', 'Copied the overrides', 'Worked out the costs and margins'],
      done: ['Copied.', 'Each product’s pane shows its recipe.'],
    };
    f.go = () =>
      submit(f, () => {
        if (!CF.picked.size) fail('Pick at least one product');
        return [['recipe-copy', { from: p.id, to: [...CF.picked], mode: CF.copy }]];
      });
    return f;
  }
  return null;
}

/** Recording a production run: a product with a recipe, its colour and size, and how many were made. */
function runFlow() {
  const list = runnable();
  const p = prOf(CF.pid);
  if (!p) {
    return {
      t: 'Record a run',
      lbl: 'Production',
      h: 'Nothing to record a run for yet',
      p: 'A run uses up the materials by a product’s recipe. Start a recipe from a product’s pane on Products.',
      rows: [['Products with a recipe', String(Object.keys(RECIPES).length)]],
    };
  }
  CF.size = sizeFor(p.id, CF.opt, CF.size);
  const opts = optsOf(p.id),
    sizes = sizesOf(p.id, CF.opt);
  const plan = runPlan(p.id, CF.opt, CF.size, 0);
  const name = (id) => inputOf(id)?.name ?? id;
  const f = {
    t: 'Record a run',
    lbl: 'Production',
    h: 'What was made',
    p: 'It uses up what the recipe takes of each material kept on hand, and adds the units to that colour and size’s stock.',
    pre: (
      <>
        <span className="lbl">Product</span>
        {ddHtml(
          'cf-prod',
          list.map((x) => [x.id, pName(x), '']),
          p.id,
          'Product',
        )}
        {opts.length > 1 ? (
          <>
            <span className="lbl">Colour</span>
            {seg(
              opts.map((o) => [o, o]),
              CF.opt,
              'opt',
              'Colour',
            )}
          </>
        ) : (
          ''
        )}
        {sizes.length > 1 ? (
          <>
            <span className="lbl">Size</span>
            {seg(
              sizes.map((z) => [z, z]),
              CF.size,
              'size',
              'Size',
            )}
          </>
        ) : (
          ''
        )}
        <div className="f2">
          {field('cf-units', 'Units made', '', { inputMode: 'numeric', placeholder: '12' })}
          {field('cf-note', 'Note', '', { placeholder: 'First batch' })}
        </div>
      </>
    ),
    rows: [
      ['Makes', out('makes')],
      ...plan.uses.map((u) => [name(u.input), out(`use-${u.input}`)]),
      ...plan.unknown.map((id) => [name(id), 'Can’t tell how much a unit uses']),
      ...(plan.toOrder.length ? [['Made to order', `${plan.toOrder.map(name).join(', ')} · costed when it sells`]] : []),
      ['On the shelf after', out('shelf'), 1],
    ],
    note: <span data-cout="note" />,
    btn: 'Record the run',
    steps: ['Recorded the run', 'Used up the materials', 'Added the units to stock'],
    done: ['Recorded.', 'Inventory shows what it used and the units it added.'],
  };
  f.go = () =>
    submit(f, () => {
      const n = num(val('cf-units'));
      if (n == null || !Number.isInteger(n) || n <= 0) fail('Type how many were made, a whole number');
      if (n > 10000) fail('At most 10,000 in one run');
      const pl = runPlan(p.id, CF.opt, CF.size, n);
      if (pl.unknown.length) fail(`Can’t tell how much ${pl.unknown.map(name).join(', ')} a unit uses: enter its line as an amount, or give it a unit cost`);
      // short: the flow said so, and the button says "Record it anyway"
      return [['run', { product: p.id, option: CF.opt, size: CF.size, units: n, note: val('cf-note'), ...(pl.uses.some((u) => u.short) ? { allowShort: true } : {}) }]];
    });
  return f;
}
/** The run flow's live sums: what it uses of each material, what's left, and whether any goes below nothing. */
function computeRun(set) {
  const p = prOf(CF.pid);
  if (!p) return;
  const n = num(val('cf-units'));
  const ok = n != null && Number.isInteger(n) && n > 0 && n <= 10000;
  const plan = runPlan(p.id, CF.opt, CF.size, ok ? n : 0);
  set('makes', ok ? `${n} × ${pName(p)} · ${runVariant(CF.opt, CF.size)}` : n == null ? 'Type how many were made' : 'A whole number, up to 10,000');
  for (const u of plan.uses) {
    const unit = inputOf(u.input)?.unit ?? '';
    set(`use-${u.input}`, ok ? `${amountOf(u.quantity, unit)} · ${amountOf(u.on, unit)} on hand → ${amountOf(u.after, unit)}` : `${amountOf(u.per, unit)} a unit · ${amountOf(u.on, unit)} on hand`);
    document.querySelectorAll(`#modalRoot [data-cout="use-${u.input}"]`).forEach((el) => (el.style.color = ok && u.short ? 'var(--underway)' : ''));
  }
  const shelf = shelfOf(p.id, CF.opt, CF.size);
  set('shelf', ok ? `${shelf + n} (${shelf} now)` : `${shelf} now`);
  const short = ok ? plan.uses.filter((u) => u.short) : [];
  const names = (xs) => xs.map((u) => inputOf(u.input)?.name ?? u.input).join(', ');
  const note = short.length
    ? `Not enough on hand: ${names(short)} would go below nothing. If the count was off, record it anyway, then count it to put it right.`
    : plan.unknown.length
      ? `Can’t tell how much ${plan.unknown.map((id) => inputOf(id)?.name ?? id).join(', ')} a unit uses: enter its line as an amount, or give it a unit cost.`
      : !plan.uses.length
        ? 'Nothing in its recipe is kept on hand: the run only adds the units.'
        : '';
  set('note', note);
  const box = document.querySelector('#modalRoot [data-cout="note"]')?.closest('.note');
  if (box) box.hidden = !note;
  const b = document.querySelector('#modalRoot [data-vgo]');
  if (b) b.textContent = short.length ? 'Record it anyway' : 'Record the run';
}

function inputFlow(i) {
  const labour = CF.ikind === 'labour',
    material = CF.ikind === 'material',
    stocked = material && CF.stocked;
  const unit = labour ? 'h' : i && i.unit !== 'h' ? i.unit : 'each';
  const back = CF.back;
  const f = {
    t: i ? 'Edit input' : 'Add an input',
    lbl: i ? i.name : 'The inputs library',
    h: i ? i.name : 'A new input',
    p: i ? `Used in ${products(i.usedIn)}. A change to its cost flows into each of them.` : 'A material, a service bought per piece, or labour by the hour.',
    pre: (
      <>
        {field('cf-name', 'Name', i?.name ?? '', { placeholder: labour ? 'Sewing' : material ? 'Blank tee' : 'Embroidery' })}
        <span className="lbl">Kind</span>
        {seg(
          [
            ['material', 'Material'],
            ['service', 'Service'],
            ['labour', 'Labour'],
          ],
          CF.ikind,
          'ikind',
          'Kind',
        )}
        {material ? (
          seg(
            [
              [true, 'Kept on hand'],
              [false, 'Made to order'],
            ],
            CF.stocked,
            'stocked',
            'Stock',
          )
        ) : (
          <p className="quiet small" style={css('margin:0')}>
            Made to order: only a material is kept on hand.
          </p>
        )}
        <div className="f2">
          {field('cf-unit', labour ? 'Unit · by the hour' : 'Unit · each, m, g, ml…', unit, labour ? { disabled: true } : {})}
          {stocked ? field('cf-low', <>Low mark, in {out('unit')}</>, i?.lowMark ?? '', { inputMode: 'decimal' }) : ''}
        </div>
        <span className="lbl">Cost</span>
        {seg(
          [
            ['unit', labour ? 'An hourly rate' : 'A unit cost'],
            ['paid', 'What was paid'],
          ],
          CF.cmode,
          'cmode',
          'Cost',
        )}
        {CF.cmode === 'unit' ? (
          field('cf-uc', <>Cost per {out('unit')}</>, ucEdit(i?.unitCost), { inputMode: 'decimal' })
        ) : (
          <div className="f2">
            {field('cf-paid', 'Total paid', '', { inputMode: 'decimal' })}
            {field('cf-qty', <>For how many, in {out('unit')}</>, '', { inputMode: 'decimal' })}
          </div>
        )}
        {field('cf-note', 'Note', i?.note ?? '')}
      </>
    ),
    rows: [
      ['Unit cost', out('uc')],
      ['Stock', stocked ? (i ? `${amountOf(i.onHand ?? 0, unit)} on hand` : 'Starts at nothing') : 'Made to order', 1],
    ],
    note:
      CF.cmode === 'paid' ? (
        <>
          <b>This records a purchase.</b>
          {stocked ? ' What came goes on hand.' : ' The unit cost is what it works out to.'}
        </>
      ) : null,
    noteIc: 'check',
    btn: i ? 'Save changes' : back ? 'Add it and go back' : 'Add the input',
    steps: [i ? 'Saved the input' : 'Added the input', ...(CF.cmode === 'paid' ? ['Recorded the purchase'] : []), 'Worked out the recipes that use it'],
    done: i ? ['Saved.', 'Every recipe that uses it is costed again.'] : ['Added.', 'Add it to products from its pane, or from a product’s recipe.'],
  };
  // from a recipe's line: back to it, with the new input picked
  if (back)
    f.then = (rs) => {
      const id = rs[0]?.result?.id;
      openCostFlow(back.kind, back.pid, id && inputOf(id) ? id : '', { copt: back.opt, csize: back.size });
      toast('Added the input · now say how much goes in');
    };
  f.go = () =>
    submit(f, () => {
      const name = val('cf-name'),
        u = labour ? 'h' : val('cf-unit').toLowerCase();
      if (!name) fail('Give it a name');
      if (!/^[a-z]{1,12}$/.test(u)) fail('A unit is a short word: each, m, g, ml…');
      const low = stocked ? num(val('cf-low')) : null;
      if (low != null && (!isFinite(low) || low < 0)) fail('A low mark is a number');
      const body = { ...(i ? { id: i.id } : {}), name, kind: CF.ikind, unit: u, stocked, lowMark: low, note: val('cf-note') };
      if (CF.cmode === 'unit') {
        const typedUc = val('cf-uc'),
          uc = num(typedUc);
        if (uc != null && !isFinite(uc)) fail('A unit cost is a number');
        // unchanged, it's left as it is (what's shown is rounded); cleared on an edit, the latest purchase's applies
        if (!(i && typedUc === ucEdit(i.unitCost))) {
          if (uc != null) body.unitCost = uc;
          else if (i) body.unitCost = null;
        }
        return [['input', body]];
      }
      const paid = num(val('cf-paid')),
        q = num(val('cf-qty'));
      if (paid == null || !isFinite(paid)) fail('Type what was paid');
      if (q == null || !isFinite(q) || q <= 0) fail('Type how many came');
      // the input first (its unit cost left as it is), then the purchase, which sets it
      return [
        ['input', body],
        ['purchase', (rs) => ({ input: rs[0]?.result?.id ?? i?.id, quantity: q, total: paid })],
      ];
    });
  return f;
}

/** The library's live inputs as a dropdown, with "New input…" last. */
function inputPicker(cur, only = null) {
  const opts = (only ?? INPUTS.filter((x) => !x.archived || x.id === cur)).map((x) => [x.id, x.name, KIND[x.kind] ?? x.kind]);
  const all = only ? opts : [...opts, ['__new', 'New input…', '']];
  return (
    <>
      <span className="lbl">Input</span>
      {all.length ? ddHtml('cf-input', all, cur || (only ? all[0][0] : '__new'), 'Input') : ''}
    </>
  );
}

function lineFlow(p, i) {
  const r = RECIPES[p.id];
  const l = r?.lines?.find((x) => x.input === CF.iid);
  const f = {
    t: l ? 'Edit a line' : r ? 'Add a line' : 'Start a recipe',
    lbl: pName(p),
    h: CF.fixed ? (i?.name ?? CF.iid) : 'What goes into it',
    p: 'Type the amount used or the cost per product: the other is worked out from the input’s unit cost.',
    pre: (
      <>
        {CF.fixed ? '' : inputPicker(CF.iid)}
        {eitherWay(i, l?.amount, l?.cost)}
        {i && i.unitCost == null ? (
          <p className="quiet small" style={css('margin:0')}>
            {i.name} has no unit cost yet. Record a purchase or set one on the Costs tab.
          </p>
        ) : (
          ''
        )}
      </>
    ),
    post: (
      <>
        {l ? (
          <button
            type="button"
            className="pn-link"
            style={css('align-self:flex-start')}
            onClick={() => removeIt('recipe-line', { product: p.id, input: CF.iid }, `Took ${i?.name ?? 'it'} out of the recipe`)}
          >
            Take it out of the recipe
          </button>
        ) : (
          ''
        )}
      </>
    ),
    rows: [
      ['Works out to', out('worked')],
      ['Unit cost', i ? unitCostText(i.unitCost, i.unit) : '—'],
      ['Cost now', r ? money(r.cost) : 'No recipe yet', 1],
    ],
    btn: l ? 'Save the line' : 'Add the line',
    steps: ['Set the line', 'Worked out the cost and margin'],
    done: [l ? 'Saved.' : 'Added.', 'The product’s cost and margin are worked out again.'],
  };
  if (!INPUTS.some((x) => !x.archived) && !l)
    f.note = (
      <>
        <b>The library is empty.</b>
        {' Pick New input… to add the first one.'}
      </>
    );
  f.go = () =>
    submit(f, () => {
      if (!CF.iid || !inputOf(CF.iid)) fail('Pick an input');
      return [['recipe-line', { product: p.id, input: CF.iid, ...either() }]];
    });
  return f;
}

function overrideFlow(p, i) {
  const r = RECIPES[p.id];
  if (!r?.lines?.length) return null;
  const cols = Object.keys(STK[p.id] ?? {}).length ? Object.keys(STK[p.id]) : p.cols || [];
  const sized = Object.values(STK[p.id] ?? {}).some((v) => v.length === SIZES.length);
  const o = r.overrides?.find((x) => x.input === CF.iid && x.option === CF.opt && x.size === CF.size);
  const l = r.lines.find((x) => x.input === CF.iid);
  const f = {
    t: 'For a colour or size',
    lbl: pName(p),
    h: CF.fixed && o ? `${i?.name ?? CF.iid} · ${ofVariant(o.option, o.size)}` : 'A different amount or cost',
    p: 'For one colour, one size, or both, in place of the recipe’s line.',
    pre: CF.fixed ? (
      eitherWay(i, o?.amount, o?.cost)
    ) : (
      <>
        {inputPicker(
          CF.iid,
          r.lines.map((x) => inputOf(x.input) ?? { id: x.input, name: x.input, kind: '' }),
        )}
        {cols.length > 1 || !sized ? (
          <>
            <span className="lbl">Colour</span>
            {seg([['', 'Any colour'], ...cols.map((c) => [c, c])], CF.opt, 'opt', 'Colour')}
          </>
        ) : (
          ''
        )}
        {sized ? (
          <>
            <span className="lbl">Size</span>
            {seg([['', 'Any size'], ...SIZES.map((s) => [s, s])], CF.size, 'size', 'Size')}
          </>
        ) : (
          ''
        )}
        {eitherWay(i, o?.amount, o?.cost)}
      </>
    ),
    post: (
      <>
        {o ? (
          <button
            type="button"
            className="pn-link"
            style={css('align-self:flex-start')}
            onClick={() => removeIt('recipe-override', { product: p.id, input: CF.iid, option: CF.opt, size: CF.size }, `Took out ${i?.name ?? 'the'} override for ${ofVariant(CF.opt, CF.size)}`)}
          >
            Take this override out
          </button>
        ) : (
          ''
        )}
      </>
    ),
    rows: [
      ['Works out to', out('worked')],
      ['The recipe’s line', l ? `${l.amount == null ? 'No amount' : amountOf(l.amount, i?.unit ?? '')} · ${money(l.cost)}` : '—'],
      ['For', ofVariant(CF.opt, CF.size), 1],
    ],
    btn: o ? 'Save the override' : 'Add the override',
    steps: ['Set the override', 'Worked out the cost and margin by size'],
    done: [o ? 'Saved.' : 'Added.', 'Where the sizes differ, the pane shows cost and margin by size.'],
  };
  f.go = () =>
    submit(f, () => {
      if (!CF.iid) fail('Pick an input');
      if (!CF.opt && !CF.size) fail('Say which colour or size it’s for');
      return [['recipe-override', { product: p.id, input: CF.iid, option: CF.opt, size: CF.size, ...either() }]];
    });
  return f;
}
