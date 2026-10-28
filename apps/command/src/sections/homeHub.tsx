// @ts-nocheck: reads the sections' untyped data (src/sections/data.tsx), as the other section files do.
import { Fragment } from 'react';
import { REAL } from '../live/env';
import { feedList } from '../live/feeds';
import { css, html } from '../runtime/dom';
import { ic, int, money } from './core';
import { ALERTS0, DEADLINES, FUNNEL, MON, NEED, S, W_ICON, vars } from './data';
import { HOME_DEMO, HOME_QV } from './homeData';
import { finish, go, render, toast, vRO } from './shell';

/*
 * Home (design/command-center-ui, the HOME module): a brief and four vitals, what needs you beside the
 * heads-up, a pulse for each section, and a timeline of the week behind and the month ahead. Drawn in
 * light DOM, styled by command.css (the redesign's main sheet, h-*).
 *
 * Its figures come from a model: the reference's (homeData.tsx) in the prototype and the preview, and
 * live, what the API sends (liveModel). Where the API doesn't have a figure yet, live shows it as not
 * real yet (the hatch) rather than a demo number. Live, a waiting item opens the app's own approval flow
 * (data-open); the review panel here is the prototype's walkthrough.
 */

const HS = { qf: 'all', cur: null, busy: false, lastW: 0, ro: null, back: null };
const DAY = 864e5;
const ND = 37,
  TI = 7;
const MO = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WDS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LANES = ['Growth', 'Members', 'Merchants', 'Money', 'Contracts', 'Governance'];
const STL = { ok: 'Ready', un: 'Drafting', bad: 'Not started' };

/** How a waiting item reads on the queue: the sample's wording, or a live item's own. */
function qv(w) {
  const v = HOME_QV[w.id];
  if (v && !w.live) return v;
  const n = NEED[w.id] ?? {};
  return { t: w.title, m: n.meta ?? w.figSub ?? '', a: w.fig ?? '', btn: n.verb ?? 'Open', ct: ['plain', w.tag ?? 'Two-person'], by: 'Someone', s: 'Not now', go: 'home' };
}
const queue = () => S.waiting.slice().sort((a, b) => (NEED[a.id]?.order ?? 99) - (NEED[b.id]?.order ?? 99));
const shown = () => queue().filter((w) => HS.qf === 'all' || (HS.qf === 'approve' ? w.mode === 'approve' : w.mode !== 'approve'));

/* ── the model: the reference's figures, or live ones ─────────────────── */

const dateKey = (t) => new Date(t).toISOString().slice(0, 10);
/** "Wed 21 Oct · 16:04 · Testnet", now. */
const whenNow = () => {
  const d = new Date();
  return `${WDS[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · Testnet`;
};

function demoModel() {
  const D = HOME_DEMO;
  const has = (id) => S.waiting.some((w) => w.id === id);
  const notes = [];
  if (has('payout'))
    notes.push({
      w: 3,
      t: vRO() ? (
        'Rosa’s payout is due tomorrow'
      ) : (
        <>
          <button type="button" className="h-blu" data-hrev="payout">
            Rosa’s payout
          </button>
          {' is due tomorrow'}
        </>
      ),
    });
  notes.push({
    w: 3,
    t: (
      <button type="button" className="h-red" data-go="money">
        Plaid is 3 hours behind
      </button>
    ),
  });
  notes.push({
    w: 2,
    t: (
      <>
        {'the '}
        <button type="button" data-vpane="votes">
          member vote
        </button>
        {' closes in 8 days'}
      </>
    ),
    T: (
      <>
        {'The '}
        <button type="button" data-vpane="votes">
          member vote
        </button>
        {' closes in 8 days'}
      </>
    ),
  });
  notes.push({ w: 1, t: `${D.stuck} members are stuck before funding` });
  return {
    when: D.when,
    notes,
    feeds: D.feeds.map(([n, ok]) => ({ n, ok: !!ok, why: ok ? 'synced' : '3 hours behind' })),
    feedBad: D.feedBad,
    money: { free: D.freeToSpend, operating: D.operating, credit: D.credit, creditUsed: D.creditUsed, reserve: '1:1' },
    heads: D.heads,
    tiles: D,
    start: D.start,
    today: D.today,
    past: D.past,
    due: D.due,
    rails: D.rails,
    railTo: D.railTo,
    runs: D.runs,
  };
}

/**
 * Live, the same shape from what the API sends Home: the feeds' health, the stored alerts, the member
 * counts, the funnel and the compliance deadlines. Money's, Build's and Governance's figures aren't in
 * Home's payload yet (docs/ui-redesign-plan.md, gaps): they show as not real yet.
 */
function liveModel() {
  const now = new Date(),
    start = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - TI * DAY;
  const feeds = feedList().map((f) => ({ n: f.name, ok: f.health === 'synced', why: f.health === 'synced' ? 'synced' : f.health === 'behind' ? 'behind' : f.health === 'failing' ? 'not reached' : 'not synced yet' }));
  const bad = feeds.filter((f) => !f.ok);
  const notes = [];
  const first = queue()[0];
  if (first)
    notes.push({
      w: 3,
      t: (
        <>
          <button type="button" className="h-blu" data-open={first.id}>
            {first.title}
          </button>
          {' is waiting on you'}
        </>
      ),
    });
  if (bad.length)
    notes.push({
      w: 3,
      t: (
        <button type="button" className="h-red" data-go="money">
          {bad.length === 1 ? `${bad[0].n} is ${bad[0].why}` : `${bad.length} feeds aren’t synced`}
        </button>
      ),
    });
  const high = ALERTS0.filter((a) => a.sev === 'absent');
  if (high.length) notes.push({ w: 2, t: high.length === 1 ? high[0].t : `${high.length} alerts are high` });
  const m = vars.memberSummary;
  if (m?.opened) notes.push({ w: 1, t: `${int(m.opened)} member${m.opened === 1 ? ' is' : 's are'} stuck before funding` });
  if (!notes.length) notes.push({ w: 0, t: 'every feed is synced and nothing is late' });
  const dl = DEADLINES.map(([title, entity, , days, status]) => [
    dateKey(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) + days * DAY),
    title,
    title,
    entity,
    status === 'ready' ? 'ok' : status === 'draft' ? 'un' : 'bad',
    'Governance',
    '',
    ['vpane', 'calendar'],
  ]);
  return {
    when: whenNow(),
    notes,
    feeds,
    feedBad: bad.length ? (bad.length === 1 ? `${bad[0].n} is ${bad[0].why}` : `${bad.length} feeds aren’t synced`) : '',
    money: null,
    heads: ALERTS0.map((a) => ({ sv: a.sev, t: a.t, age: a.age, m: a.area, go: a.go, own: a.fix === 'resync' && a.progress ? ['resync', 'Re-syncing', Math.round((a.progress[0] / a.progress[1]) * 100), `${a.progress[0]}/${a.progress[1]}`] : null })),
    tiles: null,
    start,
    today: dateKey(now),
    past: [],
    due: dl,
    rails: [],
    railTo: '',
    runs: [],
  };
}

const model = () => (REAL ? liveModel() : demoModel());

/* ── the header ───────────────────────────────────────────────────────── */

function brief(M) {
  const n = M.notes
    .slice()
    .sort((a, b) => b.w - a.w)
    .slice(0, 3);
  const cap = (x) => (x.T ? x.T : typeof x.t === 'string' ? x.t[0].toUpperCase() + x.t.slice(1) : x.t);
  return (
    <>
      {n.map((x, i) => (
        <Fragment key={i}>
          {i === 0 ? cap(x) : x.t}
          {i < n.length - 2 ? ', ' : i === n.length - 2 ? ', and ' : ''}
        </Fragment>
      ))}
      {'. '}
      <span className="q">{S.waiting.length ? 'Everything else is moving.' : 'Nothing else needs you.'}</span>
    </>
  );
}
const cents = (v) => {
  const [d, c] = money(v).split('.');
  return (
    <span>
      {d}
      <span className="ct">.{c}</span>
    </span>
  );
};
/** A vital the API doesn't send Home yet: no figure, and the bar hatched. */
const notYet = (
  <>
    <span className="h-sc-v">—</span>
    <span className="h-mb">
      <span className="hroom" style={css('left:0;right:0')} />
    </span>
  </>
);
function header(M) {
  const bad = M.feeds.filter((f) => !f.ok).length;
  return (
    <header className="h-hdr">
      <span className="h-when">
        <span className="h-dot" aria-hidden="true" />
        {M.when}
      </span>
      <p className="h-brief">{brief(M)}</p>
      <div className="h-strip">
        <button type="button" className="h-sc" data-go="money">
          <span className="h-lbl">Feeds</span>
          <span className="h-sc-v">
            {M.feeds.length - bad} <small>of {M.feeds.length}</small>
          </span>
          <span className="h-fd">
            {M.feeds.map((f) => (
              <i key={f.n} className={f.ok ? '' : 'bad'} title={`${f.n} · ${f.why}`} />
            ))}
          </span>
          <span className={`h-sc-s ${bad ? 'bad' : ''}`}>{bad ? M.feedBad : M.feeds.length ? 'All synced' : 'Not synced yet'}</span>
        </button>
        <button type="button" className="h-sc" data-npane="reserves">
          <span className="h-lbl">Reserve</span>
          {M.money ? (
            <>
              <span className="h-sc-v">{M.money.reserve}</span>
              <span className="h-mb">
                <i style={css('width:100%;background:var(--settled)')} />
              </span>
            </>
          ) : (
            notYet
          )}
          <span className="h-sc-s">{M.money ? 'Member savings fully backed' : 'Opens Money'}</span>
        </button>
        <button type="button" className="h-sc" data-npane="overview">
          <span className="h-lbl">Free to spend</span>
          {M.money ? (
            <>
              <span className="h-sc-v">{cents(M.money.free)}</span>
              <span className="h-mb">
                <i style={css(`width:${((M.money.free / M.money.operating) * 100).toFixed(1)}%`)} />
              </span>
            </>
          ) : (
            notYet
          )}
          <span className="h-sc-s">{M.money ? `Of ${money(M.money.operating)} operating cash` : 'Opens Money'}</span>
        </button>
        <button type="button" className="h-sc" data-npane="credit">
          <span className="h-lbl">Credit headroom</span>
          {M.money ? (
            <>
              <span className="h-sc-v">{cents(M.money.credit)}</span>
              <span className="h-mb">
                <i style={css(`width:${M.money.creditUsed}%`)} />
                <span className="hroom" style={css(`left:${M.money.creditUsed}%;right:0`)} />
              </span>
            </>
          ) : (
            notYet
          )}
          <span className="h-sc-s">{M.money ? 'Before the credit gate shuts' : 'Opens Money'}</span>
        </button>
      </div>
    </header>
  );
}

/* ── needs you and heads-up ───────────────────────────────────────────── */

function qRow(w) {
  const v = qv(w),
    ext = w.mode !== 'approve';
  // live, the app's own approval flow; in the prototype, the reference's review panel
  const open = REAL || w.live ? { 'data-open': w.id } : { 'data-hrev': w.id };
  return (
    <div key={w.id} className={`h-qr${w.urgent ? ' urgent' : ''}${HS.cur === w.id ? ' sel' : ''}`} {...open}>
      <span className="h-qi">{ic(W_ICON[w.id])}</span>
      <span className="h-qt">
        <b>{v.t}</b>
        <span>{v.m}</span>
      </span>
      <span className="h-qa h-fig">
        {v.a}
        {v.u ? <small>{v.u}</small> : ''}
      </span>
      <button type="button" className={`h-btn${ext ? ' ext' : ''}`} {...open}>
        {v.btn}
        {ext ? ic('out') : ''}
      </button>
    </div>
  );
}
function needsCell() {
  const q = queue(),
    ap = q.filter((w) => w.mode === 'approve').length,
    sg = q.length - ap,
    list = shown();
  if (HS.qf !== 'all' && !list.length) HS.qf = 'all';
  const pills = q.length ? (
    <div className="h-qf" role="group" aria-label="Filter">
      {[
        ['all', 'All'],
        ['approve', `Approve · ${ap}`],
        ['sign', `Sign · ${sg}`],
      ]
        .filter(([k], i) => !i || (k === 'approve' ? ap : sg))
        .map(([k, t]) => (
          <button key={k} type="button" data-hqf={k} aria-pressed={String(HS.qf === k)}>
            {t}
          </button>
        ))}
    </div>
  ) : (
    ''
  );
  const body = q.length ? (
    shown().map(qRow)
  ) : (
    <div className="h-qempty">
      <b>Nothing needs you.</b>
      <span className="small quiet">Approvals and signatures land here first.</span>
    </div>
  );
  return (
    <section className="h-cell h-s8">
      <div className="h-hd">
        <h2>Needs you</h2>
        <span className="h-lbl h-num">{q.length}</span>
        <div className="h-r">{pills}</div>
      </div>
      <div className="h-q">{body}</div>
      <div className="h-rule">
        {ic('team')}
        Two-person rule: whoever proposes can’t approve.
      </div>
    </section>
  );
}
/** What's already being done about an alert. */
function own(o) {
  if (!o) return '';
  if (o[0] === 'resync')
    return (
      <div className="h-own">
        <span>{o[1]}</span>
        <span className="pg">
          <i>
            <b style={css(`width:${o[2]}%`)} />
          </i>
          {o[3]}
        </span>
      </div>
    );
  if (o[0] === 'cap')
    return S.waiting.some((w) => w.id === 'chain') ? (
      <div className="h-own">
        <span>Fix is waiting on you</span>
        <button type="button" className="lnk" data-hrev="chain">
          Review ↑
        </button>
      </div>
    ) : (
      <div className="h-own done">
        <span>Fix is with the multisig</span>
      </div>
    );
  return (
    <div className="h-own">
      <span>{o[1]}</span>
      <button type="button" className="lnk" data-go="field" data-fp="today">
        See the route →
      </button>
    </div>
  );
}
function headsCell(M) {
  const rows = M.heads;
  return (
    <section className="h-cell h-s4 h-heads">
      <div className="h-hd">
        <h2>Heads-up</h2>
        <span className="h-lbl h-num">{rows.length}</span>
        <div className="h-r">
          <span className="h-lbl">{rows.length ? (rows.every((r) => r.own) ? 'All have an owner' : 'Not all have an owner') : 'All clear'}</span>
        </div>
      </div>
      <div className="h-al">
        {rows.length ? (
          rows.map((r, i) => (
            <div key={i} className="h-alr">
              <div className="h-al-m">
                <button type="button" className="h-al-t" data-go={r.go}>
                  <i className="sv" style={css(`background:var(--${r.sev ?? r.sv})`)} />
                  <b>{r.t}</b>
                  <span className="age">{r.age}</span>
                </button>
                <span className="m">{r.m}</span>
              </div>
              {own(r.own)}
            </div>
          ))
        ) : (
          <div className="h-qempty">
            <b>Nothing is wrong.</b>
            <span className="small quiet">Every feed is synced.</span>
          </div>
        )}
      </div>
      <button type="button" className="h-foot" data-hgo="alerts">
        {'Alert history '}
        <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

/* ── the section pulse ────────────────────────────────────────────────── */

/** The funnel's ribbon: each step's height from its count, joined by curves. */
function funnelViz(F) {
  const w = 100,
    mid = 21,
    top0 = F[0][1] || 1,
    hh = (v) => 5 + 37 * Math.pow(v / top0, 0.25);
  let top = '',
    bot = '';
  F.forEach(([, v], i) => {
    const h = hh(v),
      x1 = i * w + (i < 5 ? 66 : w),
      t = mid - h / 2,
      b = mid + h / 2;
    top += `${i ? '' : 'M0 ' + t}L${x1} ${t}`;
    if (i < 5) {
      const h2 = hh(F[i + 1][1]);
      top += `C${x1 + 18} ${t} ${(i + 1) * w - 16} ${mid - h2 / 2} ${(i + 1) * w} ${mid - h2 / 2}`;
    }
    let seg = `L${x1} ${b}`;
    if (i < 5) {
      const h2 = hh(F[i + 1][1]);
      seg = `L${(i + 1) * w} ${mid + h2 / 2}C${(i + 1) * w - 16} ${mid + h2 / 2} ${x1 + 18} ${b} ${x1} ${b}`;
    }
    bot = seg + bot;
  });
  const hl = hh(F[5][1]);
  return (
    <div className="h-gf">
      <svg viewBox="0 0 600 42" preserveAspectRatio="none" aria-hidden="true">
        <path className="fa" d={`${top}L600 ${mid + hl / 2}${bot.replace(/^L600 [\d.]+/, '')}L0 ${mid + hh(top0) / 2}Z`} />
        <rect className="fb" x="500" y={mid - hl / 2} width="100" height={hl} />
      </svg>
      <div className="h-gf-l">
        {F.map(([n, v]) => (
          <span key={n}>
            <b>{int(v)}</b>
            <s>{n}</s>
          </span>
        ))}
      </div>
    </div>
  );
}
/** The co-op's entities as a small tree: the co-op, its subsidiaries, the manager, the holdings. */
function treeViz() {
  const W = 24,
    H = 11,
    L = [0, 20, 40, 60],
    cx = 170,
    xs = [98, 146, 194, 242];
  const node = (k, x, y, c, due) => (
    <Fragment key={k}>
      <rect className={c} x={x - W / 2 + 0.5} y={y + 0.5} width={W - 1} height={H - 1} />
      {due ? <rect className="h-due" x={x + W / 2 - 2} y={y - 3} width="5" height="5" /> : ''}
    </Fragment>
  );
  const ln = (k, d) => <path key={k} className="h-ln" d={d} />;
  return (
    <svg className="h-gt" width="100%" height="72" viewBox="0 0 342 72" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
      {['Co-op', 'Subs', 'Manager', 'Holdings'].map((t, i) => (
        <text key={t} x="0" y={L[i] + 9}>
          {t}
        </text>
      ))}
      {ln('l1', `M${cx} ${L[0] + H}V${L[1] - 4.5}M${xs[0]} ${L[1] - 4.5}H${xs[3]}` + xs.map((x) => `M${x} ${L[1] - 4.5}V${L[1]}`).join(''))}
      {ln('l2', `M${xs[2]} ${L[1] + H}V${L[2]}`)}
      {ln('l3', `M${xs[2]} ${L[2] + H}V${L[3] - 4.5}M${xs[2] - 24} ${L[3] - 4.5}H${xs[2] + 24}M${xs[2] - 24} ${L[3] - 4.5}V${L[3]}M${xs[2] + 24} ${L[3] - 4.5}V${L[3]}`)}
      {node('n0', cx, L[0], 'n', 1)}
      {node('n1', xs[0], L[1], 'n')}
      {node('n2', xs[1], L[1], 'f')}
      {node('n3', xs[2], L[1], 'n')}
      {node('n4', xs[3], L[1], 'n', 1)}
      {node('n5', xs[2], L[2], 'f')}
      {node('n6', xs[2] - 24, L[3], 'p')}
      {node('n7', xs[2] + 24, L[3], 'p')}
      <path className="dv" d="M282.5 0V71" />
      {node('n8', 316, L[0], 'f')}
      <text x="316" y={L[1] + 9} textAnchor="middle">
        Outside
      </text>
    </svg>
  );
}
const sw = (s) => <i style={css(s)} />;
/** A tile whose figures Home's payload doesn't carry yet: hatched, and it still opens the section. */
const hatched = (
  <div className="h-units" style={css('grid-template-columns:repeat(15,1fr);gap:3px')}>
    {Array.from({ length: 15 }, (_, i) => (
      <i key={i} className="h-hatch" />
    ))}
  </div>
);
function tiles(M) {
  const D = M.tiles;
  const F = FUNNEL.map(([n, v]) => [{ Activated: 'Active', 'First spend': 'Spent' }[n] || n, v]);
  const joined = F[1]?.[1] ?? 0,
    spent = F[5]?.[1] ?? 0;
  const m = vars.memberSummary ?? {};
  const units = [];
  if (D) for (let b = 0; b < 12; b++) for (let i = 0; i < 25; i++) units.push(i < D.members.active[b] ? 'h-u-a' : i < D.members.active[b] + D.members.opened[b] ? 'h-u-o' : 'h-u-n');
  else {
    const inv = m.invited ?? 0,
      act = m.active ?? 0,
      op = m.opened ?? 0;
    for (let i = 0; i < Math.max(inv, 1); i++) units.push(i < act ? 'h-u-a' : i < act + op ? 'h-u-o' : 'h-u-n');
  }
  const shops = D ? D.merchants : { live: (vars.shopNames ?? []).length, of: (vars.shopNames ?? []).length, signing: 0, s: 'partner shops transacting' };
  return [
    {
      go: 'growth',
      n: 'Growth',
      f: D ? D.growth.f : int(joined),
      s: D ? D.growth.s : `joined · ${int(spent)} made a first spend`,
      viz: F.length >= 6 ? funnelViz(F) : hatched,
      key: <span>{D ? D.growth.key : `${F.length >= 6 && F[0][1] ? `Visit → join, ${((joined / F[0][1]) * 100).toFixed(1)}%` : 'Nothing measured yet'}`}</span>,
    },
    {
      go: 'members',
      n: 'Members',
      chip: (D ? D.members.stuck : m.opened) ? ['under', `${D ? D.members.stuck : m.opened} stuck`] : null,
      f: D ? D.members.f : int(m.active ?? 0),
      fs: ' active',
      s: D ? D.members.s : `of ${int(m.invited ?? 0)} invited`,
      viz: (
        <div className="h-units" style={css(`grid-template-columns:repeat(${D ? 50 : Math.min(50, Math.max(10, units.length))},1fr)`)}>
          {units.map((c, i) => (
            <i key={i} className={c} />
          ))}
        </div>
      ),
      key: (
        <>
          <span>
            <i className="h-u-a" />
            Active
          </span>
          <span>
            <i className="h-u-o" />
            {'Opened, not funded '}
            <b>{D ? D.members.stuck : (m.opened ?? 0)}</b>
          </span>
          <span>
            <i className="h-u-n" />
            Not opened
          </span>
        </>
      ),
    },
    {
      go: 'merchants',
      n: 'Merchants',
      f: String(shops.live),
      fs: ` of ${shops.of}`,
      s: shops.s,
      viz: (
        <div className="h-units" style={css('grid-template-columns:repeat(15,1fr);gap:3px')}>
          {Array.from({ length: Math.max(shops.of, 1) }, (_, i) => (
            <i key={i} className={i < shops.live ? 'h-u-a' : i < shops.live + shops.signing ? 'h-hatch' : 'h-u-n'} />
          ))}
        </div>
      ),
      key: (
        <>
          <span>
            <i className="h-u-a" />
            Transacting
          </span>
          <span>
            <i className="h-hatch" />
            Signing
          </span>
          <span>
            <i className="h-u-n" />
            Signed, idle
          </span>
        </>
      ),
    },
    {
      go: 'money',
      n: 'Money',
      f: D ? money(D.money.held) : '—',
      s: D ? D.money.s : 'Opens Money',
      viz: D ? (
        <>
          <div className="h-mz">
            {D.money.groups.map(([n, v, flex, rt]) => (
              <div key={n} className={`h-mz-g${rt ? ' h-rt' : ''}`} style={css(`flex:${flex}`)}>
                <span>{n}</span>
                <b>{v}</b>
                <i />
              </div>
            ))}
          </div>
          <div className="h-comp" title="Savings · Yield pool · Operating · Co-op balance · Payout pool · AssurancePool">
            {D.money.parts.map(([flex, bg], i) => (
              <Fragment key={i}>{sw(`flex:${flex};background:${bg}`)}</Fragment>
            ))}
          </div>
        </>
      ) : (
        hatched
      ),
      key: <span>{D ? D.money.key : 'Not in Home’s figures yet'}</span>,
    },
    {
      go: 'build',
      n: 'Build',
      chip: !vRO() && S.waiting.some((w) => w.id === 'chain') ? ['live', '1 on you'] : null,
      f: D ? D.build.f : '—',
      fs: D ? ` of ${D.build.of}` : '',
      s: D ? D.build.s : 'Opens Build',
      viz: D ? (
        <div className="h-pc">
          {D.build.groups.map(([n, a], i) => (
            <div key={n} className={`h-pc-c ${i === 5 ? 'h-dd' : ''}`}>
              <div className="h-pc-s">
                {a.map((c, j) => (
                  <i key={j} className={c} />
                ))}
              </div>
              <s>{n}</s>
            </div>
          ))}
        </div>
      ) : (
        hatched
      ),
      key: (
        <>
          <span>
            {sw('box-shadow:inset 0 0 0 2px var(--live)')}
            On you
          </span>
          <span>
            {sw('box-shadow:inset 0 0 0 2px var(--underway)')}
            Pending
          </span>
          <span>
            <i className="h-hatch" />
            Not funded
          </span>
          <span>
            {sw('outline:1px dashed var(--fg-50);outline-offset:-1px')}
            Not deployed
          </span>
        </>
      ),
    },
    {
      go: 'governance',
      n: 'Governance',
      chip: D ? ['under', D.governance.due] : DEADLINES.length ? ['under', `${DEADLINES.length} due`] : null,
      f: D ? D.governance.f : '—',
      fs: D ? ` of ${D.governance.of}` : '',
      s: D ? D.governance.s : 'Opens Governance',
      viz: D ? treeViz() : hatched,
      key: (
        <>
          <span>
            {sw('background:var(--fg)')}
            Formed
          </span>
          <span>
            {sw('outline:1.5px dashed var(--underway);outline-offset:-1.5px')}
            Forming
          </span>
          <span>
            {sw('outline:1px dashed var(--fg-50);outline-offset:-1px')}
            Planned
          </span>
          <span>
            {sw('background:var(--underway);width:6px;height:6px')}
            Filing due
          </span>
        </>
      ),
    },
  ];
}
const pulse = (M) => (
  <div className="h-bento">
    {tiles(M).map((t) => (
      <button key={t.go} type="button" className="h-cell h-s4 h-pt" data-go={t.go} aria-label={`${t.n}: open the section`}>
        <span className="h-pt-in">
          <span className="h-pt-h">
            {ic(t.go)}
            <b>{t.n}</b>
            {t.chip ? <span className={`h-chip ${t.chip[0]}`}>{t.chip[1]}</span> : ''}
          </span>
          <span className="h-pt-f">
            <span className="h-fig">
              {t.f}
              {t.fs ? <small>{t.fs}</small> : ''}
            </span>
            <span>{t.s}</span>
          </span>
          <span className="h-viz">{t.viz}</span>
          <span className="h-vk">{t.key}</span>
        </span>
      </button>
    ))}
  </div>
);

/* ── the timeline: 7 days back, 30 ahead ──────────────────────────────── */

let TL = null;
const dayAt = (i) => new Date(TL.start + i * DAY);
const idxOf = (d) => {
  const [y, m, dd] = d.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, dd) - TL.start) / DAY);
};
const fmt3 = (d) => {
  const x = dayAt(idxOf(d));
  return [x.getUTCDate(), MON[x.getUTCMonth()].toUpperCase(), WDS[x.getUTCDay()]];
};
let _cv = null;
const tw = (t, mono) => {
  _cv ??= document.createElement('canvas').getContext('2d');
  _cv.font = mono ? "500 10px 'IBM Plex Mono', monospace" : "600 12px 'Instrument Sans', system-ui, sans-serif";
  return _cv.measureText(mono ? t.toUpperCase() : t).width + (mono ? t.length * 0.4 : 0);
};
/** The grid of days and a lane per section, laid out for the width it has: drawn after the page, and again when it resizes. */
function drawTimeline(force) {
  const host = document.getElementById('h-ax');
  if (!host || !TL) return;
  const LAB = 92,
    W = host.clientWidth - LAB;
  if (W <= 0 || (W === HS.lastW && !force && host.firstChild)) return;
  HS.lastW = W;
  const cw = W / ND,
    cx = (i) => (i + 0.5) * cw,
    ix = idxOf;
  const days = [],
    mo = [],
    cols = [<i key="cp" className="h-cp" style={css(`width:${TI * cw}px`)} />, <i key="ct" className="h-cto" style={css(`left:${TI * cw}px;width:${cw}px`)} />];
  for (let i = 0; i < ND; i++) {
    const d = dayAt(i),
      wd = d.getUTCDay();
    days.push(
      <span key={i} className={`h-tg-d ${i < TI ? 'past' : ''} ${i === TI ? 'today' : ''} ${wd === 0 || wd === 6 ? 'we' : ''}`}>
        {d.getUTCDate()}
      </span>,
    );
    if (d.getUTCDate() === 1 || i === 0) {
      mo.push(
        <span key={i} style={css(`left:${i * cw}px`)}>
          {MO[d.getUTCMonth()]}
        </span>,
      );
      if (i) cols.push(<i key={'m' + i} className="h-cm" style={css(`left:${i * cw}px`)} />);
    } else if (wd === 1) cols.push(<i key={'w' + i} className="h-cw" style={css(`left:${i * cw}px`)} />);
  }
  const { past: PAST, due: DUE, rails: RUN } = TL;
  const lane = (name) => {
    const items = [],
      byDay = {};
    const h = [];
    PAST.forEach((p, i) => {
      if (p[4] === name) (byDay[ix(p[0])] = byDay[ix(p[0])] || []).push(i);
    });
    Object.entries(byDay).forEach(([d, ids]) => {
      const x = cx(+d);
      items.push(x);
      h.push(
        <i key={'e' + d} className={`h-tg-sq ${ids.length > 1 ? 'n' : ''}`} data-hk={ids.map((i) => 'e' + i).join(',')} style={css(`left:${x}px`)} title={ids.map((i) => PAST[i][2]).join(' · ')}>
          {ids.length > 1 ? ids.length : ''}
        </i>,
      );
    });
    const dues = DUE.map((p, j) => [p, j]).filter(([p]) => p[5] === name);
    dues.forEach(([p, j]) => {
      const x = cx(ix(p[0]));
      items.push(x);
      h.push(<i key={'d' + j} className={`h-tg-due ${p[4]}`} data-hk={`d${j}`} style={css(`left:${x}px`)} title={p[2]} />);
    });
    const occ = items.map((x) => [x - 7, x + 7]);
    const free = (a, b) => a >= 0 && b <= W && !occ.some(([p, q]) => a < q + 3 && b > p - 3);
    const lbls = [];
    RUN.filter((r) => r[4] === name).forEach((r) => {
      const a = ix(r[0]),
        b = r[1] ? ix(r[1]) : ND - 1,
        x0 = a * cw + 3,
        x1 = r[1] ? (b + 1) * cw - 3 : W - 2;
      h.push(<i key={'r' + r[5]} className={`h-tg-rail ${r[6]} ${r[1] ? 'cap' : 'open'}`} data-hk={r[5]} style={css(`left:${x0}px;width:${x1 - x0}px`)} />);
      lbls.push({ x: Math.max(x0, (TI + 1) * cw + 2), rightOnly: 1, b: r[2], st: r[3] + (r[1] ? '' : TL.railTo), cls: r[6], k: r[5] });
    });
    dues.forEach(([p, j]) => {
      if (RUN.some((r) => r[5] === 'd' + j)) return;
      lbls.push({ x: cx(ix(p[0])), b: p[1], tiny: p[6], st: STL[p[4]], cls: p[4], k: 'd' + j });
    });
    lbls
      .sort((a, b) => a.x - b.x)
      .forEach((l) => {
        const wT = tw(l.b, 0) + 12,
          wF = wT + (l.st ? tw(l.st, 1) + 6 : 0),
          wS = l.tiny ? tw(l.tiny, 0) + 12 : 0;
        const tries = l.rightOnly
          ? [
              ['r', wF, 1],
              ['r', wT, 0],
            ]
          : [
              ['r', wF, 1],
              ['r', wT, 0],
              ['l', wF, 1],
              ['l', wT, 0],
            ].concat(
              l.tiny
                ? [
                    ['r', wS, 0, 1],
                    ['l', wS, 0, 1],
                  ]
                : [],
            );
        let pick = null;
        for (const [sd, w, st, sm] of tries) {
          const A = sd === 'r' ? l.x + (l.rightOnly ? 0 : 12) : l.x - 12 - w,
            B = A + w;
          if (free(A, B)) {
            pick = [A, B, st, sm];
            break;
          }
        }
        if (!pick) return;
        const [A, B, st, sm] = pick;
        occ.push([A, B]);
        h.push(
          <span key={'l' + l.k} className={`h-tg-lb ${l.cls || ''}`} data-hk={l.k} style={css(`left:${A}px;width:${B - A}px`)} title={l.b}>
            <b>{sm ? l.tiny : l.b}</b>
            {st && l.st ? <span>{l.st}</span> : ''}
          </span>,
        );
      });
    return (
      <div key={name} className="h-tg-row h-tg-lane">
        <span className="h-lbl">{name}</span>
        <div className="h-tg-tr">{h}</div>
      </div>
    );
  };
  html(
    host,
    <div className="h-tg">
      <div className="h-tg-cols">{cols}</div>
      <div className="h-tg-row h-tg-mo">
        <div />
        <div className="h-tg-tr">{mo}</div>
      </div>
      <div className="h-tg-row h-tg-days">
        <div />
        <div className="h-tg-tr" style={css(`grid-template-columns:repeat(${ND},1fr)`)}>
          {days}
        </div>
      </div>
      {LANES.map(lane)}
    </div>,
  );
}
const segs = (n, on, g = 0) => (
  <div className="h-segs" aria-hidden="true">
    {Array.from({ length: n }, (_, i) => (
      <i key={i} className={i < on ? 'on' : i < on + g ? 'on g' : ''} />
    ))}
  </div>
);
/** A link's data attribute from the model: ['vpane', 'votes'] is data-vpane="votes". */
const dattr = ([k, v]) => ({ [`data-${k}`]: v });
function timeline(M) {
  TL = { start: M.start, past: M.past, due: M.due, rails: M.rails, railTo: M.railTo };
  const evRow = (p) => (
    <button key={p[2]} type="button" className="h-ev" data-hk={`e${M.past.indexOf(p)}`} data-go={p[5]} {...(p[6] ? { 'data-fp': p[6] } : {})}>
      <span className="w">{p[1] || fmt3(p[0])[2]}</span>
      <span>
        <b>{p[2]}</b>
        <span className="s">{p[3]}</span>
      </span>
    </button>
  );
  const td = M.past.filter((p) => p[0] === M.today),
    more = M.past.length - td.length;
  const due = M.due.map((p, j) => {
    const [dd, mm] = fmt3(p[0]),
      n = idxOf(p[0]) - TI;
    return (
      <button key={j} type="button" className="h-dt" data-hk={`d${j}`} {...dattr(p[7])}>
        <span className={`d ${p[4] === 'ok' ? 'k' : ''}`}>
          {dd}
          <small>{mm}</small>
        </span>
        <span>
          <b>{p[2]}</b>
          <span className="s">
            {'In '}
            {n}
            {' days · '}
            {p[3]}
          </span>
        </span>
        {STL[p[4]] ? <span className={`h-chip ${p[4] === 'ok' ? 'ok' : p[4] === 'un' ? 'under' : 'bad'}`}>{STL[p[4]]}</span> : ''}
      </button>
    );
  });
  const empty = (t) => (
    <div className="h-qempty">
      <span className="small quiet">{t}</span>
    </div>
  );
  return (
    <div className="h-bento h-tl">
      <section className="h-cell h-s12">
        <div className="h-hd">
          <h2>Timeline</h2>
          <div className="h-r">
            <span className="h-tl-key">
              <span>
                <i style={css('background:var(--fg)')} />
                Happened
              </span>
              <span>
                <i style={css('height:2px;width:14px;background:var(--fg)')} />
                Running
              </span>
              <span>
                <i style={css('background:var(--settled)')} />
                <i style={css('box-shadow:inset 0 0 0 2px var(--underway)')} />
                <i style={css('box-shadow:inset 0 0 0 2px var(--absent)')} />
                Due · ready, drafting, not started
              </span>
            </span>
          </div>
        </div>
        <div className="h-tx">
          <div className="h-tx-in" id="h-ax" />
        </div>
        <div className="h-tl-cols">
          <div className="h-tl-col">
            <span className="h-lbl">Happened today</span>
            {td.length ? td.map(evRow) : empty('Nothing logged today yet.')}
            {more ? (
              <button type="button" className="h-ev-more" data-rpane="log">
                {more}
                {' more this week in the activity log '}
                <span aria-hidden="true">→</span>
              </button>
            ) : (
              ''
            )}
          </div>
          <div className="h-tl-col">
            <span className="h-lbl">
              {'Running · '}
              {M.runs.length}
            </span>
            {M.runs.length
              ? M.runs.map(([k, t, v, [n, on, g], s, a]) => (
                  <button key={k} type="button" className="h-run" data-hk={k} {...dattr(a)}>
                    <span className="h-run-t">
                      <b>{t}</b>
                      <span className="h-num">{v}</span>
                    </span>
                    {segs(n, on, g)}
                    <span className="s">{s}</span>
                  </button>
                ))
              : empty('Nothing running now.')}
          </div>
          <div className="h-tl-col">
            <span className="h-lbl">Coming up</span>
            {due.length ? due : empty('Nothing due in the next month.')}
          </div>
        </div>
        <div className="h-ft" style={css('grid-template-columns:repeat(3,1fr)')}>
          <button type="button" data-rpane="log">
            {'Activity log '}
            <span aria-hidden="true">→</span>
          </button>
          <button type="button" data-go="records">
            {'All running work '}
            <span aria-hidden="true">→</span>
          </button>
          <button type="button" data-vpane="calendar">
            {'Compliance calendar '}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
    </div>
  );
}

/* ── the review panel: the prototype's walkthrough of a sample item ──── */

function root() {
  let r = document.getElementById('hRoot');
  if (!r) {
    r = document.createElement('div');
    r.id = 'hRoot';
    const scrim = document.createElement('div');
    scrim.className = 'h-scrim';
    scrim.dataset.hclose = '';
    const aside = document.createElement('aside');
    aside.className = 'h-panel';
    aside.setAttribute('role', 'dialog');
    aside.setAttribute('aria-modal', 'true');
    aside.setAttribute('aria-label', 'Review');
    aside.tabIndex = -1;
    r.append(scrim, aside);
    document.body.appendChild(r);
  }
  return r;
}
const panelEl = () => root().querySelector('.h-panel');
function openP(id) {
  const w = S.waiting.find((x) => x.id === id);
  if (!w || vRO()) return;
  if (!document.body.classList.contains('h-pn')) HS.back = document.activeElement;
  HS.cur = id;
  HS.busy = false;
  const v = qv(w),
    ext = w.mode !== 'approve',
    list = queue(),
    n = list.findIndex((x) => x.id === id);
  document.querySelectorAll('.h-qr').forEach((r) => r.classList.toggle('sel', r.dataset.hrev === id));
  html(
    panelEl(),
    <>
      <div className="h-pn-hd">
        <span className="h-lbl">{w.kind}</span>
        <span className={`h-chip ${v.ct[0]}`}>{v.ct[1]}</span>
        <button type="button" className="x" data-hclose="" aria-label="Close">
          {ic('close', 'sm')}
        </button>
      </div>
      <div className="h-pn-b">
        <div>
          <h3>{v.t}</h3>
        </div>
        <div className="h-fig" style={css('font-size:44px;line-height:1')}>
          {v.a}
          {v.u ? (
            <span className="quiet" style={css('font-size:19px;font-weight:400')}>
              {' '}
              {v.u}
            </span>
          ) : (
            ''
          )}
        </div>
        <div className="h-led">
          {(w.ledger ?? []).map(([k, val, t]) => (
            <div key={k} className={t ? 'h-tot' : ''}>
              <span>{k}</span>
              <b>{val}</b>
            </div>
          ))}
        </div>
        <div className="h-who2">
          <div>
            <span className="h-lbl">Proposed by</span>
            <b>{v.by}</b>
          </div>
          <div>
            <span className="h-lbl">Needs</span>
            <b>You</b>
          </div>
        </div>
        {ext ? (
          <p className="small quiet" style={css('margin:0')}>
            {'This opens in '}
            {v.tool}. It shows as done here once that tool reports back.
          </p>
        ) : (
          ''
        )}
      </div>
      <div className="h-pn-ft">
        <span className="nx">
          {n + 1}
          {' of '}
          {list.length}
          {' · '}
          <span className="h-kbd">J</span> <span className="h-kbd">K</span>
        </span>
        <button type="button" className="h-btn" data-hsec={id}>
          {v.s}
        </button>
        <button type="button" className="h-btn p" data-hgo-step={id}>
          {w.primary}
          {ext ? ic('out') : ''}
        </button>
      </div>
    </>,
  );
  document.body.classList.add('h-pn');
  requestAnimationFrame(() => (panelEl().querySelector('[data-hgo-step]') as HTMLElement | null)?.focus());
}
function closeP() {
  if (HS.busy) return;
  document.body.classList.remove('h-pn');
  HS.cur = null;
  document.querySelectorAll('.h-qr.sel').forEach((r) => r.classList.remove('sel'));
  if (HS.back && document.contains(HS.back)) HS.back.focus();
}
function runP(id) {
  const w = S.waiting.find((x) => x.id === id);
  if (!w) return;
  HS.busy = true;
  const v = qv(w),
    approve = w.mode === 'approve';
  let i = 0,
    done = false;
  const draw = () => {
    const left = S.waiting.length - 1;
    html(
      panelEl(),
      <>
        <div className="h-pn-hd">
          <span className="h-lbl">{done ? (approve ? 'Done' : 'Handed off') : approve ? 'Working' : 'Handing off'}</span>
          {done ? <span className="h-chip ok">{approve ? 'Approved' : 'Sent'}</span> : <span className={`h-chip ${v.ct[0]}`}>{v.ct[1]}</span>}
          <button type="button" className="x" data-hclose="" aria-label="Close" disabled={!done}>
            {ic('close', 'sm')}
          </button>
        </div>
        <div className="h-pn-b">
          <div>
            <h3>{v.t}</h3>
          </div>
          <div className="h-steps" aria-live="polite">
            {w.steps.map((s, k) => (
              <div key={k} className={`h-step ${k < i ? 'done' : k === i ? 'h-now' : ''}`}>
                <span className="h-mk">{k < i ? ic('check') : k === i ? <span className="h-dot" /> : <span className="h-sq" />}</span>
                <span>{s}</span>
              </div>
            ))}
          </div>
          {done ? (
            <div className="h-done">
              <h3>{w.done[0]}</h3>
              <p>{w.done[1]}</p>
            </div>
          ) : (
            ''
          )}
        </div>
        <div className="h-pn-ft">
          {done ? (
            <>
              <span className="nx">{left ? `${left} left` : 'Queue clear'}</span>
              <button type="button" className="h-btn p" data-hfinish={id}>
                {left ? 'Next' : 'Done'}
              </button>
            </>
          ) : (
            ''
          )}
        </div>
      </>,
    );
  };
  draw();
  const t = setInterval(() => {
    i++;
    if (i < w.steps.length) return draw();
    clearInterval(t);
    done = true;
    HS.busy = false;
    draw();
    (panelEl().querySelector('.h-pn-ft button') as HTMLElement | null)?.focus();
  }, 750);
}
function finishP(id) {
  const list = queue(),
    i = list.findIndex((x) => x.id === id),
    next = list.filter((x) => x.id !== id)[Math.min(i, list.length - 2)];
  // logs the update, drops it from what's waiting, draws again
  finish(id);
  if (next) openP(next.id);
  else {
    HS.busy = false;
    closeP();
  }
}
function sendBack(id) {
  const w = S.waiting.find((x) => x.id === id),
    v = qv(w);
  if (!w) return;
  // "Not now" for things signed elsewhere
  if (w.mode !== 'approve') return closeP();
  const at = S.waiting.indexOf(w);
  S.waiting = S.waiting.filter((x) => x.id !== id);
  const up = { what: `Sent ${v.back} back to ${v.by}`, by: 'You', when: 'Just now', go: v.go, fp: v.fp, mine: true };
  S.updates.unshift(up);
  closeP();
  render();
  toast(`Sent back to ${v.by}`, {
    label: 'Undo',
    fn: () => {
      S.waiting.splice(at, 0, w);
      S.updates = S.updates.filter((u) => u !== up);
      render();
    },
  });
}
function step(d) {
  const list = queue();
  if (!list.length) return;
  const i = list.findIndex((x) => x.id === HS.cur);
  openP(list[(i + d + list.length) % list.length].id);
}

/** Home's own clicks, keys and hovers: the queue filter, the review panel, and the timeline's highlights. */
export function homeListeners() {
  document.addEventListener('click', (e) => {
    const t = (e.target as Element).closest?.('[data-hrev],[data-hclose],[data-hqf],[data-hgo-step],[data-hfinish],[data-hsec],[data-hgo]') as HTMLElement | null;
    if (!t) return;
    if (t.dataset.hclose !== undefined) return closeP();
    if (t.dataset.hgoStep) return runP(t.dataset.hgoStep);
    if (t.dataset.hfinish) return finishP(t.dataset.hfinish);
    if (t.dataset.hsec) return sendBack(t.dataset.hsec);
    if (t.dataset.hqf) {
      HS.qf = t.dataset.hqf;
      return render();
    }
    if (t.dataset.hgo === 'alerts') {
      S.ibx.f = 'alerts';
      return go('waiting');
    }
    if (t.dataset.hrev) {
      e.stopPropagation();
      return openP(t.dataset.hrev);
    }
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (!document.body.classList.contains('h-pn') || document.querySelector('.modal')) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        return closeP();
      }
      if (HS.busy || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        step(1);
      }
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        step(-1);
      }
    },
    true,
  );
  document.addEventListener('mouseover', (e) => {
    if (S.route !== 'home') return;
    const tl = (e.target as Element).closest?.('.h-tl');
    const t = tl && (e.target as Element).closest('[data-hk]');
    const ks = t ? (t as HTMLElement).dataset.hk.split(',') : [];
    document.querySelectorAll('.h-tl [data-hk]').forEach((x) => x.classList.toggle('on', ks.length > 0 && (x as HTMLElement).dataset.hk.split(',').some((k) => ks.includes(k))));
  });
}

/** Home, drawn into #main. */
export function homeHub() {
  const ro = vRO();
  if (!ro && HS.cur && !S.waiting.some((w) => w.id === HS.cur) && !HS.busy) {
    HS.cur = null;
    document.body.classList.remove('h-pn');
  }
  const M = model();
  return (
    <div className="h-home">
      {header(M)}
      {ro ? (
        ''
      ) : (
        <section className="h-band">
          <div className="h-bento">
            {needsCell()}
            {headsCell(M)}
          </div>
        </section>
      )}
      <section className="h-band">{pulse(M)}</section>
      <section className="h-band">{timeline(M)}</section>
    </div>
  );
}
/** After Home is drawn (or another page is): the timeline, and a watch on its width. */
export function homeMount() {
  if (S.route !== 'home') {
    if (HS.ro) {
      HS.ro.disconnect();
      HS.ro = null;
    }
    if (!HS.busy) {
      document.body.classList.remove('h-pn');
      HS.cur = null;
    }
    return;
  }
  HS.lastW = 0;
  drawTimeline(true);
  // its labels are measured on a canvas: measured again once the faces they use have loaded
  if (document.fonts?.load)
    void Promise.all([document.fonts.load("500 10px 'IBM Plex Mono'"), document.fonts.load("600 12px 'Instrument Sans'")])
      .then(() => {
        HS.lastW = 0;
        drawTimeline(true);
      })
      .catch(() => undefined);
  if (HS.ro) HS.ro.disconnect();
  const host = document.getElementById('h-ax');
  if (host && typeof ResizeObserver !== 'undefined') {
    HS.ro = new ResizeObserver(() => requestAnimationFrame(() => drawTimeline()));
    HS.ro.observe(host);
  }
}
