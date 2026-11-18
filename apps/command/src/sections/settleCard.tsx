// @ts-nocheck: draws money.SETTLEMENT_FUNDING, which is untyped, as the sections are.
import { Fragment } from 'react';
import { css } from '../runtime/dom';

/*
 * Card settlement (decision 54, the redesign): will members' credit swipes settle at the next cut-off, and if not,
 * what do I press? One card, drawn where someone looks first:
 *   settleCard   Money → Overview, first band (#nsettle): the stat band, the bar and the timeline; where the money
 *                comes from, in its legal order (L-01 §8.4A), a button on each; the moves for this cut-off; Due,
 *                Covered by and Last 7 days.
 *   settleSlim   Money → Pools → Yield pool: the verdict, what's due, the bar and the lane left, and a jump to the card.
 *   settleTile   the 5th tile of Money's header strip and of Home's strip.
 *   settleNeed   one row in Home's Heads-up and Money's Needs you, only when it isn't Covered.
 *
 * Live, every figure is the funding desk's last check and the verdict is the API's (settlementFunding.ts, the desk's
 * own rule), so Home, Money and the desk agree. The demo is the reference's, in its four states.
 */

const MIN = 60_000,
  HOUR = 60 * MIN;
export const usd = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd0 = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
/* every time is in the cut-off's own zone (the card's timeZone; the browser's in the demo), as the API's verdict says them */
let TZ = undefined;
const zoned = (S) => {
  TZ = S?.timeZone || undefined;
};
const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
const wd = (t) => new Date(t).toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ });
const dm = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });
/** Minutes past midnight at `t`, in the cut-off's zone. */
const minuteOfDay = (t) => {
  const [h, m] = hm(t).split(':').map(Number);
  return h * 60 + m;
};
const TONE = { settled: 'var(--settled)', underway: 'var(--underway)', absent: 'var(--absent)' };
const tone = (t) => (t ? TONE[t] : '');

/* ── the demo: the reference's four states (its "now" is 20 h 56 min before a 13:00 cut-off) ── */

/** The reference's own calc, for the demo only: live, the API sends the verdict. */
function demoVerdict(S) {
  const target = S.due + S.buffer,
    have = S.csa + S.inFlight,
    need = Math.max(0, target - have);
  const laneLeft = Math.max(0, Math.min(S.lane.cap - S.lane.used, S.lane.poolRoom));
  const stopped = S.stopped;
  const book = stopped ? 0 : Math.min(S.netting.collection, need),
    lane = stopped ? 0 : Math.min(laneLeft, need - book);
  const after = have + book + lane,
    gapDue = Math.max(0, S.due - after),
    gapBuffer = Math.max(0, target - after);
  const state = need <= 0 ? 'covered' : gapBuffer <= 0 ? 'ontrack' : gapDue <= 0 ? 'thin' : 'short';
  const fundBy = S.cutoff.next - S.cutoff.latencyMinutes * MIN,
    by = hm(fundBy),
    forced = hm(S.cutoff.forcedAt),
    moved = book + lane;
  const label = state === 'covered' ? 'Covered' : state === 'ontrack' ? 'On track' : state === 'thin' ? 'Buffer short' : stopped ? 'Desk stopped' : 'Short';
  return {
    state,
    label,
    tone: state === 'covered' ? 'settled' : state === 'short' ? 'absent' : 'underway',
    willMove: { book, lane },
    gapDue,
    gapBuffer,
    after,
    target,
    fundBy,
    head: state === 'short' ? `${usd(gapDue)} short` : state === 'thin' ? `Buffer ${usd(gapBuffer)} short` : state === 'ontrack' ? 'On track' : 'Covered',
    when: state === 'ontrack' ? `Desk moves it at ${forced}` : `Fund by ${by}`,
    brief: state === 'covered' ? `Covered · ${usd(Math.max(0, after - target))} spare` : state === 'ontrack' ? `On track · desk moves ${usd(moved)} at ${forced}` : state === 'thin' ? `Buffer ${usd(gapBuffer)} short · fund by ${by}` : `${usd(gapDue)} short · fund by ${by}`,
    line: '',
    cells: [
      { label: `Due at ${hm(S.cutoff.next)}`, value: usd(S.due), sub: 'Members’ credit swipes', tone: null },
      { label: 'Will be there', value: usd(after), sub: moved ? 'Including what the desk moves' : 'In the account and arriving', tone: null },
      state === 'covered'
        ? { label: 'Short', value: usd(0), sub: `${usd(S.buffer)} buffer kept`, tone: 'settled' }
        : state === 'ontrack'
          ? { label: 'Short', value: usd(0), sub: `After the desk moves ${usd(moved)}`, tone: 'underway' }
          : state === 'thin'
            ? { label: 'Buffer short', value: usd(gapBuffer), sub: 'Swipes are covered', tone: 'underway' }
            : { label: 'Short', value: usd(gapDue), sub: `${usd(gapBuffer)} with the buffer`, tone: 'absent' },
      state === 'covered' ? { label: 'Act by', value: '—', sub: 'Nothing to do', tone: null } : state === 'ontrack' ? { label: 'Desk runs', value: forced, sub: 'On its own', tone: null } : { label: 'Fund by', value: by, sub: stopped ? 'Desk stopped' : 'Or swipes decline', tone: state === 'short' ? 'absent' : 'underway' },
    ],
  };
}

/** The demo's card in one of the reference's states, the same figures the seeded API sends. */
export function demoSettle(now, state = 'covered') {
  const next = now + 20 * HOUR + 56 * MIN,
    forcedAt = next - 5 * HOUR;
  const short = state === 'short',
    ontrack = state === 'ontrack',
    stoppedState = state === 'stopped';
  const due = short ? 5850 : 2316.4,
    dueSettled = short ? 5120.4 : 1890.2,
    inFlight = ontrack || stoppedState ? 0 : 2196.25,
    used = short ? 3980 : 1783.65,
    collection = short ? 0 : 412.6,
    bookedToday = ontrack ? 1000 : 1412.6;
  const h = (n) => '0x' + n.toString(16).padStart(64, '0');
  const S = {
    enabled: true,
    dryRun: false,
    explorer: 'https://sepolia.basescan.org/tx/',
    lastCheck: now - 9 * MIN,
    offRamp: { name: 'Bridge', rail: 'same-day ACH', address: '0x0ff0000000000000000000000000000000000c5a' },
    cutoff: { next, through: next, rollover: false, forcedAt, latencyMinutes: 240, measuredMinutes: 212 },
    due,
    dueSettled,
    duePending: Math.round((due - dueSettled) * 100) / 100,
    buffer: 1000,
    target: due + 1000,
    csa: 1120.15,
    inFlight,
    pendingCredit: 684.9,
    netting: { collection, bookedToday, drawsDue: due },
    week: { days: 5, sent: 3850, booked: 6204.35, returnedPool: 640, returnedMargin: 0 },
    lane: { upgraded: true, stopped: false, cap: 5000, used, left: 5000 - used, periodSeconds: 604800, periodStart: now - 3 * 86_400_000, poolRoom: 3412.98 },
    margin: { held: 1840, advanced: 0 },
    inFlightEta: inFlight ? now + 92 * MIN : null,
    stopped: stoppedState ? { by: 'Dana Ruiz', at: now - 54 * MIN, why: 'A forward reverted: CL Operating’s allowance was spent' } : null,
    recent: stoppedState
      ? [
          { id: 4, at: now - 54 * MIN, kind: 'stop', status: 'failed', amount: 0, txs: [], error: 'Dana Ruiz · forward reverted' },
          { id: 2, at: now - 2 * HOUR - MIN, kind: 'book', status: 'booked', amount: bookedToday, txs: [] },
        ]
      : [
          ...(inFlight ? [{ id: 3, at: now - 2 * HOUR, kind: 'deploy', status: 'forwarded', amount: inFlight, txs: [['deploySettlement', h(0xb1)], ['forward', h(0xb2)]] }] : []),
          { id: 2, at: now - 2 * HOUR - MIN, kind: 'book', status: 'booked', amount: bookedToday, txs: [] },
          // the reference's last cut-off, settled (the demo's only: live, the desk records its own moves, not the bank's settlement)
          { id: 1, at: next - 24 * HOUR, kind: 'settled', status: 'done', amount: 1974.8, txs: [] },
        ],
  };
  S.verdict = demoVerdict(S);
  return S;
}

/* ── the bar: in the account, arriving, the desk will move, not covered; the tick is what's due ── */

export function settleBar(S, V, { sm = false } = {}) {
  zoned(S);
  const max = Math.max(V.target, V.after) || 1,
    p = (v) => ((v / max) * 100).toFixed(3) + '%';
  let x = 0;
  const seg = (v, cls) => {
    if (v <= 0.005) return null;
    const el = <i key={cls} className={`sfb-${cls}`} style={css(`left:${p(x)};width:${p(v)}`)} />;
    x += v;
    return el;
  };
  const csa = S.csa ?? 0;
  const bar = [seg(csa, 'in'), seg(S.inFlight, 'fl'), seg(V.willMove.book + V.willMove.lane, 'dk'), seg(V.gapBuffer, 'gap')];
  const dp = S.due / max,
    a = dp > 0.78 ? 'r' : dp < 0.22 ? 'l' : '';
  return (
    <div className={`sfb${sm ? ' sm' : ''}`}>
      {sm ? '' : <div className="sfb-ax"><span className={`due ${a}`} style={css(`left:${p(S.due)}`)}><b>Due</b> {usd(S.due)}</span></div>}
      <div className="sfb-t"><div className="sfb-i">{bar}<b className="sfb-due" style={css(`left:${p(S.due)}`)} /></div></div>
      {sm ? '' : <div className="sfb-ax lo"><span>$0</span><span className="end"><b>{max > V.target + 0.005 ? 'Coming in' : 'With the buffer'}</b> {usd(max)}</span></div>}
    </div>
  );
}

/* ── the timeline, now → cut-off: the night folded small so the morning's moves get room (not to scale) ── */

function settleTimeline(S, V, now) {
  const cut = S.cutoff.next;
  // tonight's 20:00 and tomorrow's 06:00, local: when both fall between now and the cut-off, 20:00–06:00 takes 24–32%
  // the next 20:00 after now, and the 06:00 after it, in the cut-off's zone
  const n0 = now + ((((20 * 60 - minuteOfDay(now)) % 1440) + 1440) % 1440 || 1440) * MIN - (new Date(now).getSeconds() * 1000 + new Date(now).getMilliseconds());
  const n1 = n0 + 10 * HOUR;
  const fold = now < n0 && n1 < cut;
  const x = (t) => {
    const c = Math.max(now, Math.min(cut, t));
    if (!fold) return (((c - now) / (cut - now || 1)) * 100).toFixed(2) + '%';
    const v = c <= n0 ? ((c - now) / (n0 - now)) * 24 : c <= n1 ? 24 + ((c - n0) / (n1 - n0)) * 8 : 32 + ((c - n1) / (cut - n1)) * 68;
    return v.toFixed(2) + '%';
  };
  const pts = [[now, 'Now'], ...(S.inFlight && S.inFlightEta && S.inFlightEta < cut ? [[S.inFlightEta, 'Arrives']] : []), [S.cutoff.forcedAt, 'Last run'], [V.fundBy, 'Pool money by'], [cut, 'Cut-off']].filter(([t]) => t >= now);
  return (
    <div className="sft">
      <div className="sft-tr">
        {fold ? <i className="sft-night" style={css(`left:${x(n0)};width:8%`)}><em>Overnight</em></i> : ''}
        {pts.map(([t, k], i) => (
          <span key={i} className={`sft-p${i === 0 ? ' first' : ''}${i === pts.length - 1 ? ' end' : ''}${k === 'Pool money by' ? ' key' : ''}`} style={css(`left:${x(t)}`)}>
            <b>{hm(t)}</b>
            <i />
            <em>{k}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── where the money comes from, in order: a tile each, its one action at the bottom ── */

function settleSources(S, V, can) {
  const urgent = V.state === 'short' || V.state === 'thin';
  const btn = (k, t, primary) => (can ? <button className={`btn sm-b sfs-go${primary ? ' p' : ''}`} data-nsf={k}>{t}</button> : '');
  const col = S.netting.collection ?? 0,
    booked = S.netting.bookedToday ?? 0;
  const laneLeft = Math.max(0, S.lane.cap - S.lane.used);
  const resets = S.lane.periodStart && S.lane.periodSeconds ? wd(S.lane.periodStart + S.lane.periodSeconds * 1000) : null;
  const held = S.margin?.held,
    adv = S.margin?.advanced ?? 0;
  const latency = S.cutoff.measuredMinutes ?? S.cutoff.latencyMinutes;
  const stopped = !!S.stopped;
  const rows = [
    ['Repayments at the bank', `Same bank · instant until ${hm(S.cutoff.next - 15 * MIN)}`, usd(col), 'ready', col + booked ? booked / (col + booked) : 0, `${usd(booked)} booked today`, col > 0 ? btn('book', 'Book…', urgent) : <span className="sfs-none">Nothing ready</span>],
    // a lane not set up yet (the SL upgrade, its funder, the forwarder) moves nothing on its own: it says so, and only two people can deploy
    S.setup?.length
      ? ['Pool settlement lane', 'Not set up yet · two people can still deploy', usd(0), 'left this week', 0, S.setup[0], V.gapBuffer > 0 ? btn('deploy', 'Deploy…', true) : <span className="sfs-none">Not set up</span>]
      : ['Pool settlement lane', `Automatic · ${latency} min to arrive${resets ? ` · resets ${resets}` : ''}`, usd(laneLeft), 'left this week', S.lane.cap ? S.lane.used / S.lane.cap : 0, `${usd0(S.lane.used)} of ${usd0(S.lane.cap)} used`, stopped ? btn('restart', 'Restart…') : V.gapBuffer > 0 ? btn('deploy', 'Deploy over the limit…', true) : btn('run', 'Run now')],
    ['Savings-Backed Margin', 'Last resort · restored in 2 business days', held == null ? '—' : usd(held), held == null ? 'not read yet' : 'held', adv / ((held ?? 0) + adv || 1), adv ? `${usd(adv)} advanced` : 'Nothing advanced', btn('margin', 'Advance…', V.state === 'short')],
  ];
  return rows.map(([k, sub, v, vu, f, meta, b], i) => (
    <div key={i} className="sf-c sfs-t">
      <div className="sfs-h"><span className="sfs-n">{i + 1}</span><b>{k}</b></div>
      <span className="sfs-d">{sub}</span>
      <div className="sfs-v"><b>{v}</b><span>{vu}</span></div>
      <div className="sfs-u"><span className="sfs-mt"><i style={css(`width:${Math.min(1, Math.max(0, f)) * 100}%`)} /></span><span className="sfs-m">{meta}</span></div>
      <div className="sfs-a">{b}</div>
    </div>
  ));
}

/* ── the moves for this cut-off ── */

const MOVE = {
  deploy: ['Pool → off-ramp', (m, S) => `Settlement lane${S.inFlightEta && m.status === 'forwarded' ? ` · arrives ~${hm(S.inFlightEta)}` : ''}`],
  book: ['Repayments → settlement account', () => 'Book transfer · same bank'],
  'margin-advance': ['Savings-Backed Margin → settlement account', () => 'Advanced against this cut-off'],
  'return-margin': ['Settlement account → Margin', () => 'Margin restored'],
  'return-pool': ['Returned to the pool', () => 'Idle surplus back to the Yield Pool'],
  stop: ['Desk stopped', (m) => m.error || 'Stopped by a person'],
  settled: ['Settled with Visa', (m) => `${wd(m.at)}’s cut-off · fully covered`],
};
const MSTATUS = (m) => (m.kind === 'stop' ? ['Stopped', 'absent'] : m.status === 'failed' ? ['Failed', 'absent'] : m.status === 'done' ? ['Settled', 'settled'] : m.status === 'booked' ? ['Booked', 'settled'] : ['forwarded', 'sent'].includes(m.status) ? ['In flight', 'underway'] : ['Moving', 'underway']);

function settleMoves(S, now) {
  const rows = (S.recent ?? []).slice(0, 6);
  if (!rows.length) return <div className="sfm"><div className="sfm-r"><span /><span className="sfm-k"><b>Nothing has moved for this cut-off</b><span>The desk checks every 15 minutes and at its last run</span></span><span /><span /></div></div>;
  return (
    <div className="sfm">
      {rows.map((m) => {
        const [k, sub] = MOVE[m.kind] ?? [m.kind, () => ''];
        const [st, tn] = MSTATUS(m);
        const today = dm(m.at) === dm(now);
        return (
          <div key={m.id} className="sfm-r">
            <span className="sfm-t"><b>{hm(m.at)}</b><span>{today ? 'Today' : wd(m.at)}</span></span>
            <span className="sfm-k"><b>{k}</b><span>{sub(m, S)}{(m.txs ?? []).map(([n, hsh], j) => <Fragment key={j}>{' · '}{S.explorer && hsh ? <a className="sfm-tx" href={S.explorer + hsh} target="_blank" rel="noopener">{n}</a> : <span className="sfm-tx">{n}</span>}</Fragment>)}</span></span>
            <span className="sfm-s"><span className="fst" style={css(`color:${TONE[tn]};box-shadow:inset 0 0 0 1px ${TONE[tn]}`)}>{st}</span></span>
            <b className="sfm-v">{m.amount ? usd(m.amount) : '—'}</b>
          </div>
        );
      })}
    </div>
  );
}

const ago = (t, now) => {
  const m = Math.max(0, Math.round((now - t) / MIN));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const left = (S, now) => {
  const m = Math.max(0, Math.round((S.cutoff.next - now) / MIN));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
const pill = (V) => <span className="fst" style={css(`color:${TONE[V.tone]};box-shadow:inset 0 0 0 1px ${TONE[V.tone]}`)}>{V.label}</span>;
const cutLabel = (S) => `${wd(S.cutoff.next)} ${dm(S.cutoff.next)} · ${hm(S.cutoff.next)}`;

/** Money → Overview's card, #nsettle. h: Money's own helpers (cell, lbl) and whether this person can move money. */
export function settleCard(S, h, now = Date.now()) {
  zoned(S);
  const V = S.verdict;
  if (!V) return h.cell('s12 sf', 'Next card settlement', <span className="sf-cut">{cutLabel(S)}</span>, <div className="bk-empty">The settlement account’s balance isn’t read yet, so the desk can’t say whether the next cut-off is covered.</div>, <span />, 'nsettle');
  const list = (title, rows) => (
    <div className="sf-c">
      {h.lbl(title)}
      <div className="sfl">{rows.map(([k, v, c], i) => <div key={i} className={c || ''}><span>{k}</span><b>{v}</b></div>)}</div>
    </div>
  );
  const moved = V.willMove.book + V.willMove.lane;
  const due = [['Cleared by Visa', usd(S.dueSettled)], ['Still clearing', usd(S.duePending)], ['Buffer', usd(S.buffer)], ['Needed by the cut-off', usd(V.target), 't']];
  const cov = [
    ['In the account', usd(S.csa ?? 0)],
    ['Arriving', S.inFlight ? <>{S.inFlightEta ? <span className="sf-q">{hm(S.inFlightEta)}</span> : ''}{usd(S.inFlight)}</> : '—'],
    ['Desk will move', moved ? <><span className="sf-q">by {hm(V.fundBy)}</span>{usd(moved)}</> : '—'],
    [V.gapBuffer ? 'Short of the target' : 'Over the target', <span style={css(`color:${V.gapBuffer ? 'var(--absent)' : 'var(--settled)'}`)}>{usd(V.gapBuffer ? V.gapBuffer : V.after - V.target)}</span>, 't'],
  ];
  const wk = [['From the pool', usd(S.week.sent)], ['Booked repayments', usd(S.week.booked)], ['Returned to the pool', usd(S.week.returnedPool)], ['Next cut-off so far', usd(S.pendingCredit), 't']];
  const foot = (
    <>
      <span className="sf-ft">{S.stopped ? <><i className="sf-dot off" /><span><b>Desk stopped</b>{S.stopped.by ? ` by ${S.stopped.by}` : ''}{S.stopped.at ? ` at ${hm(S.stopped.at)}` : ''}</span></> : <><i className="sf-dot" /><span><b>{S.dryRun ? 'Desk in a dry run' : 'Desk on'}</b>{S.lastCheck ? ` · checked ${ago(S.lastCheck, now)}` : ''}</span></>}</span>
      {h.can ? (S.stopped ? <button className="btn sm-b" data-nsf="restart">Restart…</button> : <button className="btn sm-b dz" data-nsf="stop">Stop the desk</button>) : ''}
      <button data-ngo="build/security">Guide →</button>
    </>
  );
  return h.cell(
    's12 sf',
    'Next card settlement',
    <><span className="sf-cut">{`${cutLabel(S)} · in ${left(S, now)}`}</span>{pill(V)}</>,
    <div className="sf-gr">
      <div className="sf-c sf-kpi">{V.cells.map((c, i) => <div key={i}><span className="lbl">{c.label}</span><b style={css(c.tone ? `color:${tone(c.tone)}` : '')}>{c.value}</b><span>{c.sub}</span></div>)}</div>
      <div className="sf-c sf-main">
        {settleBar(S, V)}
        <span className="sf-key"><span><i className="k-in" />In the account</span><span><i className="k-fl" />Arriving</span><span><i className="k-dk" />Desk will move</span><span><i className="k-gap" />Not covered</span></span>
        {settleTimeline(S, V, now)}
      </div>
      <div className="sf-c sf-sh">{h.lbl('Where the money comes from, in order')}<span className="sf-note"><b>Two people</b> to book, deploy over the limit or advance the Margin · one to run or stop the desk</span></div>
      {settleSources(S, V, h.can)}
      <div className="sf-c sf-mvs">{h.lbl('Moves for this cut-off')}{settleMoves(S, now)}</div>
      {list('Due', due)}
      {list('Covered by', cov)}
      {list('Last 7 days', wk)}
    </div>,
    foot,
    'nsettle',
  );
}

/** Money → Pools → Yield pool: the slim card, which jumps to the full one. */
export function settleSlim(S, h) {
  zoned(S);
  const V = S.verdict;
  if (!V) return '';
  return h.cell(
    's12 sf sm',
    'Card settlement',
    <><span className="sf-cut">{`${cutLabel(S)} cut-off`}</span>{pill(V)}</>,
    <div className="sf-slim"><div className="m-big">{usd(S.due)} <small>due</small></div>{settleBar(S, V)}<div className="sf-sl-n"><b>{usd(Math.max(0, S.lane.cap - S.lane.used))}</b><span>left in the pool’s settlement lane this week</span></div></div>,
    <><span>{V.brief}</span><button data-ntab="overview" data-njump="nsettle">Fund or review →</button></>,
  );
}

/** A strip's 5th tile, Money's header and Home's: the verdict word, the small bar, the cut-off and what's due. */
export function settleTile(S, { cls = 'sc sc-sf', lblCls = 'lbl', valCls = 'sc-v', subCls = 'sc-s', attrs = {} } = {}) {
  zoned(S);
  const V = S?.verdict;
  return (
    <button type="button" className={cls} {...attrs}>
      <span className={lblCls}>Card settlement</span>
      {V ? <span className={valCls} style={css(`color:${TONE[V.tone]}`)}>{V.label}</span> : <span className={valCls}>—</span>}
      {V ? settleBar(S, V, { sm: true }) : <span className="sfb sm"><span className="sfb-t" /></span>}
      <span className={`${subCls}${V?.state === 'short' ? ' bad' : ''}`}>{V ? `${wd(S.cutoff.next)} ${hm(S.cutoff.next)} · ${usd(S.due)} due` : 'Not read yet'}</span>
    </button>
  );
}

/**
 * The one notification, the same on Home's Heads-up and Money's Needs you; null when it's Covered. When the desk will
 * handle it alone, it says so and has no button to fund.
 */
export function settleNeed(S, now = Date.now()) {
  zoned(S);
  const V = S?.verdict;
  if (!V || V.state === 'covered') return null;
  const desk = V.state === 'ontrack';
  return {
    sev: V.state === 'short' ? 'absent' : 'underway',
    title: `Card settlement · ${V.head}`,
    meta: `${V.when} · cut-off ${wd(S.cutoff.next)} ${hm(S.cutoff.next)}`,
    when: V.when,
    age: `${Math.max(1, Math.round((S.cutoff.next - now) / HOUR))} h`,
    owner: desk ? 'The desk has it' : 'Two people',
    action: desk ? 'Review →' : 'Fund →',
    desk,
  };
}
