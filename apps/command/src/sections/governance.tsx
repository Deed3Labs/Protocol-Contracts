// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { Fragment } from 'react';
import { attrs, css } from '../runtime/dom';
import { D, agrOf, laneFrame, pctX } from './contracts';
import { compBar, head, ic, money, pct } from './core';
import {
  AGENDA,
  AK,
  MEETING,
  MEETINGS_HELD,
  AST,
  BODIES,
  DAY,
  ENT,
  ENTF,
  EST,
  FILINGS,
  FSHORT,
  FST,
  GBOARDS,
  MATTERS,
  MBODY,
  MEETS,
  MON,
  NOW,
  OWN,
  PARENT,
  PASTV,
  PEOPLE,
  RESOS,
  RP,
  RPA,
  RPN,
  RPX,
  SEATC,
  TODAY,
  VOTE,
  VS,
  vars,
} from './data';
import { G, chart, columns, figHtml, fmtD, gCell, px } from './growth';
import { mkey, vizTrack } from './home';
import { ddHtml } from './kit';
import { evRows, strip } from './money';
import { modalShell, onKey } from './shell';
export function entOf(id) {
  return ENT.find((e) => e[0] === id);
}
export function KIDS(id) {
  return Object.keys(PARENT).filter((k) => PARENT[k] === id);
}
export function filOf(id) {
  return FILINGS.find((f) => f[0] === id);
}
export function fshort(f) {
  return FSHORT[f[0]] || f[2];
}
/* ── drawing ──────────────────────────────────────────────────────────── */
export function entMap() {
  const n = (id) => entOf(id),
    H = 6.4; /* half a node, in % of the map */
  const L = (x1, y1, x2, y2, cls = '') => <line x1={x1 * 10} y1={y1} x2={x2 * 10} y2={y2} className={`em-l ${cls}`} />;
  const subs = ['fin', 'dt', 'hold', 'labs'],
    bus = 25,
    sy = 41,
    my = 63,
    bus2 = 78,
    ky = 92,
    fx = 91,
    edge = 70 + 8.5;
  const lines = (
    <>
      {L(40, 11 + H, 40, bus)}
      {L(10, bus, 70, bus)}
      {subs.map((s) => L(n(s)[5], bus, n(s)[5], sy - H))}
      {L(50, sy + H, 50, my - H)}
      {L(50, my + H, 50, bus2)}
      {L(34, bus2, 66, bus2)}
      {L(34, bus2, 34, ky - H)}
      {L(66, bus2, 66, ky - H)}
      {L(82, 0, 82, 100, 'div')}
      {L(fx, 11 + H, fx, sy, 'dash')}
      {L(fx, sy, edge, sy, 'dash')}
    </>
  );
  const tag = (x, y, t, cls = '') => (
    <span className={`em-o ${cls}`} style={css(`left:${x}%;top:${y}%`)}>
      {t}
    </span>
  );
  const tags = (
    <>
      {subs.map((s) => tag(n(s)[5], (bus + sy - H) / 2, OWN[s]))}
      {tag(50, (sy + H + my - H) / 2, '100%')}
      {tag(50, (my + H + bus2) / 2, 'manages')}
      {tag(34, (bus2 + ky - H) / 2, 'Holdings majority')}
      {tag(66, (bus2 + ky - H) / 2, 'Holdings 100%')}
      {tag(fx, (11 + H + sy) / 2, 'maintains for', 'dash')}
    </>
  );
  const pips = (id) => {
    const b = GBOARDS.find((x) => x[1] === id);
    return b ? (
      <span className="em-p" title={`${b[0]}: ${b[2].filter((x) => x[1]).length} of ${b[2].length} seats`}>
        {b[2].map((x, __k) => (
          <i key={__k} className={x[1] ? 'on' : ''} />
        ))}
      </span>
    ) : (
      ''
    );
  };
  const due = (id) => FILINGS.filter((f) => f[1] === id && f[3] - NOW < 30 * DAY && f[4] !== 'later');
  return (
    <>
      <div className="em" role="img" aria-label="Entity structure">
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          {lines}
        </svg>
        {tags}
        <span className="em-out" style={css('left:91%;top:0')}>
          Outside the tree
        </span>
        <span className="em-out" style={css('left:40%;top:0')}>
          Owned by the members
        </span>
        {ENT.map((e, __k) => {
          const d = due(e[0]);
          return (
            <button
              key={__k}
              type="button"
              className={`em-n ${e[3]}${d.length ? ' due' : ''}${VS.ent === e[0] ? ' sel' : ''}`}
              data-ent={e[0]}
              style={css(`left:${e[5]}%;top:${e[6]}%`)}
            >
              <span className="em-top">
                <b>{e[1]}</b>
              </span>
              <span className="em-mid">
                <span className="em-k">{e[2]}</span>
                {pips(e[0])}
              </span>
              <span className="em-s">
                <span className="em-st">
                  <i style={css(`background:${EST[e[3]][0]}`)} />
                  <span className="em-st-t">{EST[e[3]][1]}</span>
                </span>
                {d.length ? (
                  <span className="em-d">
                    <span className="em-dl">
                      {fshort(d[0])}
                      {' · '}
                    </span>
                    <span className="em-dt">{'Due '}</span>
                    {fmtD(d[0][3])}
                  </span>
                ) : (
                  ''
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mp-list">
        {[
          ['Parent', ['coop']],
          ['Owned by the co-op', ['fin', 'dt', 'hold', 'labs']],
          ['Under Holdings', ['mgr', 'prop', 'lend']],
          ['Outside the tree', ['fdn']],
        ].map(([l, ids], __k) => (
          <div key={__k} className="ph-c">
            <span className="lbl">{l}</span>
            {ids.map((id, __k) => {
              const e = entOf(id);
              return (
                <button key={__k} type="button" className="ph-r" data-ent={id}>
                  <i className={e[3] === 'formed' ? '' : e[3] === 'forming' ? 'build' : 'later'} />
                  <span>{e[1]}</span>
                  <span className="mono quiet">{OWN[id] || ''}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
export function entKey() {
  return (
    <div className="mkey">
      <span>
        <i className="sw" style={css('background:var(--fg)')} />
        Formed
      </span>
      <span>
        <i className="sw" style={css('background:transparent;box-shadow:inset 0 0 0 1.5px var(--underway)')} />
        Forming
      </span>
      <span>
        <i className="sw" style={css('background:transparent;box-shadow:inset 0 0 0 1.5px var(--line)')} />
        Planned
      </span>
      <span>
        <i className="sw" style={css('background:var(--underway)')} />
        Due within 30 days
      </span>
      <span>
        <i className="sw em-sw" />
        Board seats, filled and open
      </span>
    </div>
  );
}
export function filingLanes(list, from, to, labels) {
  const ids = ['coop', 'labs', 'fin', 'dt', 'hold', 'fdn'];
  const rows = ids.map((id, __k) => {
    const fs = list.filter((f) => f[1] === id && f[3] >= from && f[3] <= to);
    if (!fs.length) return '';
    const marks = fs.map((f, i) => (
      <Fragment key={i}>
        <i className={`fl-m ${f[4]}`} style={css(`left:${pctX(f[3], from, to)}%`)} title={`${f[2]} · ${fmtD(f[3])}`} />
        {labels ? (
          <i className={`fl-t ${f[4]} ${i % 2 ? 'dn' : 'up'}${pctX(f[3], from, to) > 72 ? ' lt' : ''}`} style={css(`left:${pctX(f[3], from, to)}%`)}>
            {fshort(f)}
            {' · '}
            {fmtD(f[3])}
          </i>
        ) : (
          ''
        )}
      </Fragment>
    ));
    const e = entOf(id);
    return (
      <button key={__k} type="button" className="ln-r" data-ent={id}>
        <span className="ln-k">
          <b>{e[1]}</b>
          <span>
            {fs.length}
            {' due · '}
            {fs.filter((f) => f[4] === 'ready').length}
            {' ready'}
          </span>
        </span>
        <span className="ln-l">{marks}</span>
      </button>
    );
  });
  return laneFrame(rows, from, to, labels ? 14 : 'month', 'gt fl' + (labels ? ' lab' : ''));
}
export function filKey() {
  return mkey(['ready', 'draft', 'none', 'later'].map((k) => [FST[k][2], FST[k][1]]));
}
export function seatRows() {
  return (
    <>
      <div className="bseats">
        {GBOARDS.map(([n, id, seats], __k) => {
          const f = seats.filter((s) => s[1]).length;
          return (
            <button key={__k} type="button" className="bs-r" data-ent={id}>
              <span className="bs-k">
                <b>{n}</b>
                <span className="small quiet">
                  {f}
                  {' of '}
                  {seats.length}
                  {' seats filled'}
                </span>
              </span>
              <span className="bs-q">
                {seats.map(([c, h], __k) => (
                  <i key={__k} className={h ? 'on' : ''} style={css(`--c:${SEATC[c][0]}`)} title={`${SEATC[c][1]}${h ? ' · ' + h : ' · open'}`}>
                    {h
                      ? h
                          .split(' ')
                          .map((x) => x[0])
                          .join('')
                          .slice(0, 2)
                      : ''}
                  </i>
                ))}
              </span>
              <b className="bs-f">
                {f}/{seats.length}
              </b>
            </button>
          );
        })}
      </div>
      {mkey([
        ['var(--live)', 'Chair'],
        ['var(--fg)', 'Member-elected'],
        ['var(--land)', 'Co-op reserved'],
        ['var(--fg-50)', 'Investor or team'],
        ['var(--underway)', 'Neutral'],
      ])}
    </>
  );
}
export function voteChart(h = 150) {
  const days = 15,
    max = 120,
    X = (i) => px(i, days) * 10,
    Y = (v) => (1 - v / max) * 100;
  const done = VOTE.days,
    last = done.length - 1,
    proj = [done[last], 70, 77, 83, 88, 92, 95, 97, 99];
  const q = VOTE.elig * VOTE.quorum,
    qi = done.findIndex((v) => v >= q);
  const paths = (
    <>
      <line x1="0" x2="1000" y1={Y(q)} y2={Y(q)} className="ch-floor" />
      <path d={`M${done.map((v, i) => `${X(i)},${Y(v)}`).join(' L')}`} className="ch-l1" style={css('stroke:var(--live)')} />
      <path d={`M${proj.map((v, i) => `${X(last + i)},${Y(v)}`).join(' L')}`} className="ch-l3" />
    </>
  );
  const xs = [0, 3, 6, 9, 14].map((i) => ({
    t: fmtD(VOTE.open + i * DAY),
    x: px(i, days),
  }));
  return (
    <>
      <div className="vc">
        {chart({
          h,
          max,
          yTicks: [0, 47, 94],
          yFmt: (v) => (v ? String(v) : '0'),
          x: xs,
          paths,
          marks: [
            {
              x: px(last, days),
              v: done[last],
              c: 'var(--live)',
            },
            {
              x: px(qi, days),
              v: done[qi],
              c: 'var(--fg)',
            },
          ],
          notes: [
            {
              x: px(qi, days),
              t: 'Quorum',
            },
          ],
        })}
      </div>
      {mkey([
        ['var(--live)', 'Votes cast'],
        ['var(--fg-50)', 'Expected by close'],
        ['var(--fg)', 'Quorum · 47'],
      ])}
    </>
  );
}
export function rpMatrix() {
  const cnt = (a, b) => RP.filter((r) => r[0] === a && r[1] === b),
    max = 4;
  return (
    <>
      <div className="rpm">
        <div className="rpm-r rpm-h">
          <span className="lbl">Payer ↓</span>
          {RPX.map((x, __k) => (
            <span key={__k} title={RPN[x]}>
              {RPA[x]}
            </span>
          ))}
        </div>
        {RPX.map((a, __k) => (
          <div key={__k} className="rpm-r">
            <span className="rpm-k">{RPN[a]}</span>
            {RPX.map((b, __k) => {
              if (a === b) return <i key={__k} className="rpm-c self" />;
              const r = cnt(a, b),
                n = r.reduce((s, x) => s + x[3].length, 0),
                open = r.some((x) => x[5]);
              return r.length ? (
                <button
                  key={__k}
                  type="button"
                  className={`rpm-c${open ? ' open' : ''}`}
                  data-vflow="rp"
                  data-vid={RP.indexOf(r[0])}
                  style={css(`--v:${n / max};${n / max >= 0.5 ? 'color:var(--ground)' : ''}`)}
                  title={`${RPN[a]} → ${RPN[b]}: ${n} logged${open ? ', 1 open' : ''}`}
                >
                  {n || (open ? '1' : '')}
                </button>
              ) : (
                <i key={__k} className="rpm-c" />
              );
            })}
          </div>
        ))}
      </div>
      {mkey([
        ['var(--fg)', 'Logged this year'],
        ['var(--underway)', 'Waiting on approval'],
      ])}
    </>
  );
}

/* ── counted from the rows ─────────────────────────────────────────────── */
const WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const word = (n) => (n === 0 ? 'none' : (WORD[n] ?? String(n)).toLowerCase());
const allSeats = () => GBOARDS.flatMap((b) => b[2].map((x) => [b, x]));
/** The co-op board seats on the ballot at the next election: open seats to elect, and terms ending then. */
export function ballot() {
  const coop = GBOARDS.find((b) => b[1] === 'coop')[2],
    at = coop.find((x) => !x[1] && /^Elect/.test(x[4] || ''))?.[2];
  return { at, seats: coop.filter((x) => (!x[1] && /^Elect/.test(x[4] || '')) || (x[1] && at && x[3] === at)) };
}
/** The next meeting of any body, after now. */
export function nextMeeting() {
  return MEETS.flatMap(([b, ev]) => ev.filter((e) => e[0] === 'next' && e[1] > NOW).map((e) => [b, e[1]])).sort((a, b) => a[1] - b[1])[0];
}
/** The day the member vote reached quorum, counting the votes cast each day it's been open. */
export function quorumDay(v = VOTE) {
  const i = v.days.findIndex((n) => n >= v.quorum * v.elig);
  return i < 0 ? null : v.open + i * DAY;
}
/** Who approves a related-party deal: the payee's board while it's open, else the payer's. */
export const rpBoard = (r) => (r[5] ? GBOARDS.find((b) => b[1] === r[1])?.[0] : r[0] === 'fdn' ? 'Foundation council' : 'Co-op board');
/** The co-op board's next meeting, and who sits on it now. */
export const nextBoard = () => MEETS.find((m) => m[0] === 'Co-op board')?.[1].find((e) => e[0] === 'next' && e[1] > NOW)?.[1];
export const seatedBoard = () => GBOARDS.find((b) => b[1] === 'coop')[2].filter((x) => x[1]);
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monYear = (t) => `${MON[new Date(t).getUTCMonth()]} ${new Date(t).getUTCFullYear()}`;
/* ── page ─────────────────────────────────────────────────────────────── */
export function governancePage() {
  const P = VS.pane,
    soon = FILINGS.filter((f) => f[3] - NOW < 30 * DAY && f[4] !== 'later' && f[4] !== 'done');
  const words = ['No filings', 'One filing', 'Two filings', 'Three filings', 'Four filings'];
  const title =
    P === 'overview'
      ? `${words[soon.length] || soon.length + ' filings'} due by ${fmtD(Math.max(...soon.map((f) => f[3])))}.`
      : P === 'entities'
        ? `${ENT.filter((e) => e[3] === 'formed').length} of ${ENT.length} entities formed.`
        : P === 'boards'
          ? `${WORD[ballot().seats.length]} co-op seats go to the members on ${fmtD(ballot().at)}.`
          : P === 'votes'
            ? quorumDay()
              ? 'The member vote has passed quorum.'
              : 'The member vote is short of quorum.'
            : `${FILINGS.filter((f) => f[4] !== 'later').length} filings and meetings to prepare.`;
  const tools = (
    <button className="btn btn-p" type="button" data-vflow="log">
      <span className="dot pulse" style={css('color:var(--btn-dot)')} aria-hidden="true" />
      Log a decision
    </button>
  );
  const tabs = [
    ['overview', 'Overview'],
    ['entities', 'Entities'],
    ['boards', 'Boards'],
    ['votes', 'Meetings and votes'],
    ['calendar', 'Calendar'],
  ];
  const body = {
    overview: vOverview,
    entities: vEntities,
    boards: vBoards,
    votes: vVotes,
    calendar: vCalendar,
  }[P]();
  return (
    <>
      {head(
        <>
          {'Governance · '}
          <b>Demo data</b>
        </>,
        title,
        tools,
      )}
      <nav className="ptabs" aria-label="Governance panes">
        {tabs.map(([v, t], __k) => (
          <button key={__k} type="button" data-vpane={v} aria-current={P === v ? 'page' : 'false'}>
            {t}
          </button>
        ))}
      </nav>
      {body}
      {governancePane()}
    </>
  );
}
export function entCell(tag) {
  const f = ENT.filter((e) => e[3] === 'formed').length,
    seats = GBOARDS.reduce((a, b) => a + b[2].length, 0),
    filled = GBOARDS.reduce((a, b) => a + b[2].filter((s) => s[1]).length, 0);
  return (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Entities</span>
        <span className="tag">{tag}</span>
      </header>
      <div className="c-fig">{figHtml(`${f} of ${ENT.length}`, 'formed · the co-op owns everything inside the tree; the Foundation answers to no one')}</div>
      <div className="c-body">
        {entMap()}
        {entKey()}
      </div>
      {strip([
        ['Formed', f],
        ['Forming', ENT.filter((e) => e[3] === 'forming').length],
        ['Planned', ENT.filter((e) => e[3] === 'planned').length],
        ['Board seats filled', `${filled} of ${seats}`],
        ['Due in 30 days', FILINGS.filter((x) => x[3] - NOW < 30 * DAY && x[4] !== 'later').length, '', 'warn'],
      ])}
    </section>
  );
}
export function voteCell(span, big) {
  const v = VOTE,
    cast = v.days[v.days.length - 1];
  return (
    <section className={`cell ${span}`}>
      <header className="c-hd">
        <span className="lbl">Member vote</span>
        <span className="tag">
          {'Closes '}
          {fmtD(v.close)}
        </span>
      </header>
      <div className="c-fig">{figHtml(pct(v.yes, v.yes + v.no + v.abs), `yes on “${v.t}” · ${cast} of ${v.elig} members have voted`)}</div>
      <div className="c-body roomy">
        <div className="ablock">
          <span className="lbl">Votes cast, by day</span>
          {voteChart(big ? 180 : 150)}
        </div>
        <div className="ablock">
          <div className="ab-h">
            <span className="lbl">How they voted</span>
            <button type="button" className="pn-link" data-vflow="ballot">
              See the ballot
            </button>
          </div>
          {compBar([
            ['Yes', v.yes, 'var(--fg)', String(v.yes)],
            ['No', v.no, 'var(--underway)', String(v.no)],
            ['Abstain', v.abs, 'var(--line)', String(v.abs)],
          ])}
        </div>
      </div>
      <div className="c-ft split">
        <button type="button" data-vflow="remind">
          <span className="t">
            {'Remind the '}
            {v.elig - cast}
            {' who haven’t voted'}
          </span>
          {ic('chev', 'sm')}
        </button>
        <span className="rule" aria-hidden="true" />
        <div className="row">
          <span className="t">{quorumDay() ? `Quorum reached ${fmtD(quorumDay())} · needs a majority` : `Needs ${Math.ceil(v.quorum * v.elig)} votes for quorum`}</span>
        </div>
      </div>
    </section>
  );
}
export function agendaCell(span) {
  const tot = AGENDA.reduce((a, x) => a + x[1], 0);
  const bar = (
    <>
      <div className="ag-bar">
        {AGENDA.map(([t, m, o, k], i) => (
          <i key={i} style={css(`width:${(m / tot) * 100}%;background:${AK[k][0]}`)} title={`${t} · ${m} min`}>
            {i + 1}
          </i>
        ))}
      </div>
      <div className="ag-ax">
        <span>18:00</span>
        <span>18:30</span>
        <span>19:00</span>
      </div>
    </>
  );
  const rows = AGENDA.map(([t, m, o, k], i) => (
    <button key={i} type="button" className="ag-r" data-vmeet="">
      <span className="ag-n">{i + 1}</span>
      <span className="ag-k">
        <b>{t}</b>
        <span className="small quiet">
          {o}
          {' · '}
          {m}
          {' min'}
        </span>
      </span>
      <span className="ag-t">
        <i style={css(`background:${AK[k][0]}`)} />
        {AK[k][1]}
      </span>
    </button>
  ));
  return (
    <section className={`cell ${span}`}>
      <header className="c-hd">
        <span className="lbl">Next board meeting</span>
        <span className="tag">Wed 4 Nov</span>
      </header>
      <div className="c-fig">
        {figHtml(`${AGENDA.filter((a) => a[3] === 'vote').length} votes`, `co-op board · ${tot} minutes · the packet is still a draft`)}
      </div>
      <div className="c-body roomy start">
        <div className="ablock">
          <span className="lbl">Agenda · 18:00 – 19:00</span>
          {bar}
        </div>
        <div className="ag">{rows}</div>
      </div>
      <div className="c-ft split">
        <button type="button" data-vmeet="">
          <span className="t">Open the meeting</span>
          {ic('chev', 'sm')}
        </button>
        <span className="rule" aria-hidden="true" />
        <button type="button" data-vflow="packet">
          <span className="t">Send the packet</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
}
export function resoRows(list) {
  return (
    <>
      <div className="rs">
        {list.map(([d, b, t, v], __k) => {
          const y = v.filter((x) => x === 'y').length,
            n = v.filter((x) => x === 'n').length,
            r = v.filter((x) => x === 'r').length;
          return (
            <button key={__k} type="button" className="rs-r" data-vflow="reso" data-vid={RESOS.findIndex((x) => x[2] === t)}>
              <span className="ev-d">{fmtD(d)}</span>
              <span className="rs-k">
                <b>{t}</b>
                <span className="small quiet">{b}</span>
              </span>
              <span className="rs-v">
                {v.map((x, __k) => (
                  <i
                    key={__k}
                    className={x}
                    title={
                      {
                        y: 'For',
                        n: 'Against',
                        r: 'Recused',
                        a: 'Absent',
                      }[x]
                    }
                  />
                ))}
              </span>
              <span className="rs-o">
                {'Passed '}
                {y}–{n}
                {r ? ` · ${r} recused` : ''}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mkey">
        <span>
          <i className="sw" style={css('background:var(--fg)')} />
          For
        </span>
        <span>
          <i className="sw" style={css('background:var(--underway)')} />
          Against
        </span>
        <span>
          <i className="sw rs-sw-r" />
          Recused
        </span>
        <span>
          <i className="sw" style={css('background:var(--ground);box-shadow:inset 0 0 0 1.5px var(--line)')} />
          Absent
        </span>
      </div>
    </>
  );
}
export function vBoards() {
  const from = D(6, 1),
    to = D(12, 31, 2028);
  const rows = GBOARDS.flatMap(([bn, id, seats], __k) =>
    [
      <div className="ln-r grp">
        <span className="ln-k">
          <b>{bn}</b>
        </span>
        <span className="ln-l" />
      </div>,
    ].concat(
      seats.map(([c, h, a, b, note], i) => {
        const l = a ? pctX(a, from, to) : pctX(NOW, from, to);
        const lane = h ? (
          <>
            <i className="gb" style={css(`left:${pctX(a, from, to)}%;width:${pctX(b, from, to) - pctX(a, from, to)}%;background:${SEATC[c][0]}`)} />
            <i className={`gb-end${b - NOW < 120 * DAY ? ' soon' : ''}`} style={css(`left:${pctX(b, from, to)}%`)} />
            {b - NOW < 120 * DAY ? (
              <i className="gb-tag" style={css(`left:${pctX(b, from, to)}%`)}>
                {'Up '}
                {fmtD(b)}
              </i>
            ) : (
              ''
            )}
          </>
        ) : (
          <>
            <i className="sl-seg block seat-open" style={css(`left:${l}%;width:${100 - l}%`)} />
            <i className="mt-t" style={css(`left:${l}%`)}>
              {note}
            </i>
          </>
        );
        return (
          <button key={i} type="button" className="ln-r" data-ent={id}>
            <span className="ln-k">
              <span>
                <b>{h || 'Open'}</b>
                {' · '}
                {SEATC[c][1]}
              </span>
            </span>
            <span className="ln-l">{lane}</span>
          </button>
        );
      }),
    ),
  );
  const seats = GBOARDS.reduce((a, b) => a + b[2].length, 0),
    filled = GBOARDS.reduce((a, b) => a + b[2].filter((x) => x[1]).length, 0);
  const terms = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Seats and terms</span>
        <span className="tag">2026 – 2028</span>
      </header>
      <div className="c-fig">{figHtml(`${filled} of ${seats}`, `seats filled · ${word(ballot().seats.length)} co-op seats go to the members on ${fmtD(ballot().at)}`)}</div>
      <div className="c-body">
        {laneFrame(rows, from, to, 'month', 'gt bt')}
        {mkey([
          ['var(--fg)', 'Member-elected'],
          ['var(--land)', 'Co-op reserved'],
          ['var(--underway)', 'Term ends within 4 months'],
          ['var(--line)', 'Open seat'],
        ])}
      </div>
      {strip([
        ['Filled', `${filled} of ${seats}`],
        ['On the ballot', `${ballot().seats.length} · ${fmtD(ballot().at)}`, '', 'warn'],
        ['Investor seats', allSeats().some(([, x]) => x[0] === 'i' && x[1]) ? 'Filled' : 'Empty'],
        ['Longest term', monYear(allSeats().reduce((a, [, x]) => (x[1] && x[3] - x[2] > (a ? a[3] - a[2] : 0) ? x : a), null)[3])],
      ])}
    </section>
  );
  const ppl = gCell(
    's-5',
    'Who sits where',
    'People and boards',
    figHtml(String(PEOPLE.find((x) => x[0] === 'Kai')?.[1].length ?? 0), 'boards with Kai on them · he steps out of votes between them'),
    <div className="pb">
      <div className="pb-r pb-h">
        <span />
        {GBOARDS.map((b, __k) => (
          <span key={__k}>{b[0].replace(' board', '')}</span>
        ))}
      </div>
      {PEOPLE.map(([n, bs, note], __k) => (
        <div key={__k} className="pb-r">
          <span className="pb-k">
            <b>{n}</b>
            {note ? <span className="small quiet">{note}</span> : ''}
          </span>
          {GBOARDS.map((b, __k) => (
            <span key={__k} className="pb-c">
              {bs.includes(b[1]) ? <i style={css(`background:${SEATC[b[2].find((x) => x[1] === n)?.[0] || 'm'][0]}`)} /> : <i className="no" />}
            </span>
          ))}
        </div>
      ))}
    </div>,
    strip([
      ['Recusals this year', String(RESOS.filter((r) => new Date(r[0]).getUTCFullYear() === new Date(NOW).getUTCFullYear()).reduce((a, r) => a + r[3].filter((v) => v === 'r').length, 0))],
      ['Conflicts disclosed', String(PEOPLE.filter((x) => x[2]).length)],
    ]),
  );
  const res = gCell(
    's-7',
    'Resolutions',
    'Every board',
    figHtml(
      String(RESOS.length),
      `passed since ${MON_LONG[new Date(Math.min(...RESOS.map((r) => r[0]))).getUTCMonth()]} · ${word(RESOS.filter((r) => r[3].filter((v) => v === 'n').length > r[3].filter((v) => v === 'y').length).length)} failed, ${word(RESOS.filter((r) => r[3].includes('r')).length)} with a recusal`,
    ),
    resoRows(RESOS),
    strip([...new Set(RESOS.map((r) => r[1]))].map((b) => [b, String(RESOS.filter((r) => r[1] === b).length)])),
  );
  return (
    <>
      {G('Seats', 'Select a seat for its entity', '', terms)}
      {G(
        'Conduct',
        '',
        '',
        <>
          {ppl}
          {res}
        </>,
      )}
    </>
  );
}
export function vOverview() {
  const boards = gCell(
    's-4 wt',
    'Boards',
    'Seats',
    figHtml(
      `${GBOARDS.reduce((a, b) => a + b[2].filter((x) => x[1]).length, 0)} of ${GBOARDS.reduce((a, b) => a + b[2].length, 0)}`,
      'seats filled · investor seats wait for the financial class',
    ),
    seatRows(),
    <div className="c-ft">
      <button type="button" data-vpane="entities">
        <span className="t">Who decides what</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  const from = NOW - 2 * DAY,
    to = NOW + 88 * DAY,
    notStarted = FILINGS.filter((f) => f[4] === 'none').sort((a, b) => a[3] - b[3])[0];
  const due = (
    <section className="cell s-8">
      <header className="c-hd">
        <span className="lbl">Due in 90 days</span>
        <span className="tag">Every entity</span>
      </header>
      <div className="c-fig">
        {figHtml(
          String(FILINGS.filter((f) => f[3] <= to && f[4] !== 'later').length),
          `filings and meetings · ${FILINGS.filter((f) => f[4] === 'ready').length} ready, ${FILINGS.filter((f) => f[4] === 'none' && f[3] <= to).length} not started`,
        )}
      </div>
      <div className="c-body">
        {filingLanes(FILINGS, from, to, true)}
        {filKey()}
      </div>
      <div className="c-ft split">
        <button type="button" data-vpane="calendar">
          <span className="t">Full calendar</span>
          {ic('chev', 'sm')}
        </button>
        <span className="rule" aria-hidden="true" />
        <button type="button" data-vflow="filing" data-vid={notStarted?.[0] ?? ''}>
          <span className="t">{notStarted ? `${notStarted[2]} isn’t started` : 'Everything is started'}</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
  const rp = gCell(
    's-4 wt',
    'Related parties',
    'This year',
    figHtml(
      String(RP.reduce((a, r) => a + r[3].length, 0)),
      `deals between our own entities, all logged${RP.some((r) => r[5]) ? ` · ${RP.filter((r) => r[5]).length} waits on the ${rpBoard(RP.find((r) => r[5]))}` : ''}`,
    ),
    rpMatrix(),
    <div className="c-ft">
      <button type="button" data-vpane="entities">
        <span className="t">The log</span>
        {ic('chev', 'sm')}
      </button>
    </div>,
  );
  return (
    <>
      {G('Structure', 'Select an entity', '', entCell(`${ENT.length} entities · Wyoming`))}
      {G(
        'Decisions',
        '',
        '',
        <>
          {voteCell('s-8')}
          {agendaCell('s-4 wt')}
        </>,
      )}
      {G(
        'Due',
        '',
        '',
        <>
          {due}
          {rp}
        </>,
      )}
    </>
  );
}
export function vEntities() {
  const mx = (
    <div className="rmx">
      <div className="rmx-r rmx-h">
        <span />
        {BODIES.map((b, __k) => (
          <span key={__k}>{b}</span>
        ))}
      </div>
      {MATTERS.map(([d, v, p], ix) => (
        <button key={ix} type="button" className={`rmx-r${p ? ' open' : ''}`} data-vflow="matter" data-vid={ix}>
          <span className="rmx-k">
            <b>{d}</b>
            {p ? <span className="small">{p}</span> : ''}
          </span>
          {v.map((x, __k) => (
            <span key={__k} className="rmx-c">
              {x === 2 ? <i className="d" /> : x === 1 ? <i className="a" /> : x === 0 ? <i className="t" /> : ''}
            </span>
          ))}
        </button>
      ))}
    </div>
  );
  const matters = (
    <section className="cell s-8">
      <header className="c-hd">
        <span className="lbl">Who decides what</span>
        <span className="tag">Reserved matters</span>
      </header>
      <div className="c-fig">{figHtml(String(MATTERS.length), `kinds of decision · the co-op’s reserved seats can stop ${word(MATTERS.filter((m) => m[1][2] >= 1).length)} of them at Holdings`)}</div>
      <div className="c-body">
        {mx}
        {mkey([
          ['var(--fg)', 'Decides'],
          ['var(--land)', 'Must approve'],
          ['var(--line)', 'Told'],
        ])}
      </div>
      {strip([
        ['Open', String(MATTERS.filter((m) => m[2]).length), MATTERS.filter((m) => m[2]).map((m) => m[2].split(' goes')[0]).join(', '), 'warn'],
        ['Next meeting', nextMeeting() ? `${nextMeeting()[0]} · ${fmtD(nextMeeting()[1])}` : 'None'],
        ['Veto holders', 'Co-op seats'],
      ])}
    </section>
  );
  const cls = [
    ['Board seats', 1, 1],
    ['Reserved matters', 1, 0],
    ['Elects the chair', 1, 1],
    ['Dividends', 0, 1],
    ['Votes on most items', 1, 0],
  ];
  const classes = gCell(
    's-4 wt',
    'Holdings share classes',
    'Two classes',
    figHtml('2', 'classes · the co-op governs, investors share the economics'),
    <div className="cls">
      <div className="cls-r cls-h">
        <span />
        <span>
          Governance
          <br />
          <em>the co-op</em>
        </span>
        <span>
          Financial
          <br />
          <em>investors</em>
        </span>
      </div>
      {cls.map(([k, a, b], __k) => (
        <div key={__k} className="cls-r">
          <span>{k}</span>
          <span>{a ? <i className="on" /> : <i className="no" />}</span>
          <span>{b ? <i className="on f" /> : <i className="no" />}</span>
        </div>
      ))}
    </div>,
    strip([
      ['Financial class sold', 'None'],
      ['Investor seats', `${allSeats().filter(([, x]) => x[0] === 'i').length}, ${allSeats().some(([, x]) => x[0] === 'i' && x[1]) ? 'some filled' : 'empty'}`],
    ]),
  );
  /* related-party log as lanes */
  const from = D(7, 1),
    to = D(12, 31);
  const rows = RP.map(([a, b, w, ds, amt, open], ix) => (
    <button key={ix} type="button" className="ln-r" data-vflow="rp" data-vid={ix}>
      <span className="ln-k">
        <b>
          {RPN[a]}
          {' → '}
          {RPN[b]}
        </b>
        <span>
          {w}
          {amt ? ` · ${money(amt)} each` : ''}
        </span>
      </span>
      <span className="ln-l">
        {ds.map((t, __k) => (
          <i key={__k} className="rp-m" style={css(`left:${pctX(t, from, to)}%`)} />
        ))}
        {open ? (
          <>
            <i className="sl-seg proj" style={css(`left:${pctX(NOW, from, to)}%;width:${pctX(open, from, to) - pctX(NOW, from, to)}%`)} />
            <i className="rp-m open" style={css(`left:${pctX(open, from, to)}%`)} />
            <i className="gb-tag" style={css(`left:${pctX(open, from, to)}%`)}>
              {'Board '}
              {fmtD(open)}
            </i>
          </>
        ) : (
          ''
        )}
      </span>
    </button>
  ));
  const log = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Related-party log</span>
        <span className="tag">Jul – Dec</span>
      </header>
      <div className="c-fig">
        {figHtml(money(RP.reduce((a, r) => a + r[3].length * r[4], 0)), 'moved between our own entities this year · priced at arm’s length, every one logged')}
      </div>
      <div className="c-body">
        {laneFrame(rows, from, to, 'month', 'gt')}
        {mkey([
          ['var(--fg)', 'Logged'],
          ['var(--underway)', 'Waiting on approval'],
        ])}
      </div>
      {strip([
        ['Logged', String(RP.reduce((a, r) => a + r[3].length, 0))],
        ['Open', String(RP.filter((r) => r[5]).length), '', 'warn'],
        ['Pricing policy', 'Draft'],
      ])}
    </section>
  );
  return (
    <>
      {G('Structure', '', '', entCell(`${ENT.length} entities · select one`))}
      {G(
        'Control',
        '',
        '',
        <>
          {matters}
          {classes}
        </>,
      )}
      {G('Related parties', '', '', log)}
    </>
  );
}
export function vVotes() {
  const lowest = PASTV.reduce((a, x) => (x[2] < a[2] ? x : a));
  const past = gCell(
    's-4 wt',
    'Turnout',
    'Every member vote',
    figHtml(`${PASTV.at(-1)[2].toFixed(1)}%`, `turnout so far${PASTV.every((x, i) => !i || x[2] < PASTV[i - 1][2]) ? ' · each vote has drawn fewer members than the last' : ''}`),
    columns(
      PASTV.map(([k, m, v]) => [`${m}`, v]),
      {
        hi: 3,
        h: 150,
        fmt: (v) => v.toFixed(1) + '%',
      },
    ),
    strip([
      ['Quorum', `${Math.round(VOTE.quorum * 100)}%`],
      ['Lowest', `${lowest[2].toFixed(1)}%`, lowest === PASTV.at(-1) ? 'this vote' : lowest[0]],
    ]),
  );
  const from = D(6, 1),
    to = D(1, 31, 2027);
  const rows = MEETS.map(([b, ev], __k) => {
    const lane = ev.map((e, __k) => {
      const [k, t] = e;
      if (k === 'span')
        return (
          <Fragment key={__k}>
            <i
              className="sl-seg wait"
              style={css(
                `left:${pctX(t, from, to)}%;width:${pctX(e[2], from, to) - pctX(t, from, to)}%;border-color:var(--live);background:repeating-linear-gradient(45deg,var(--live) 0 1.5px,transparent 1.5px 5px)`,
              )}
            />
            <i className="gb-tag live" style={css(`left:${pctX(e[2], from, to)}%`)}>
              {e[3]}
            </i>
          </Fragment>
        );
      if (k === 'later')
        return (
          <Fragment key={__k}>
            <i
              className="sl-seg block"
              style={css(
                `left:${pctX(t, from, to)}%;width:${pctX(e[2], from, to) - pctX(t, from, to)}%;border-color:var(--line);background:repeating-linear-gradient(45deg,var(--line) 0 1.5px,transparent 1.5px 5px)`,
              )}
            />
            <i className="mt-t" style={css(`left:${pctX(t, from, to)}%`)}>
              {e[3]}
            </i>
          </Fragment>
        );
      if (k === 'due') return <i key={__k} className="sl-due" style={css(`left:${pctX(t, from, to)}%`)} />;
      return (
        <Fragment key={__k}>
          <i className={`mt-m ${k}`} style={css(`left:${pctX(t, from, to)}%`)} title={e[2] || fmtD(t)} />
          {e[2] && k === 'next' ? (
            <i className={`mt-t${pctX(t, from, to) > 80 ? ' lt' : ''}`} style={css(`left:${pctX(t, from, to)}%`)}>
              {e[2]}
            </i>
          ) : (
            ''
          )}
        </Fragment>
      );
    });
    return (
      <div key={__k} className="ln-r">
        <span className="ln-k">
          <b>{b}</b>
          <span>
            {ev.filter((e) => e[0] === 'held').length}
            {' held'}
          </span>
        </span>
        <span className="ln-l">{lane}</span>
      </div>
    );
  });
  const meets = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Meetings</span>
        <span className="tag">Jun – Jan</span>
      </header>
      <div className="c-fig">{figHtml('4 Nov', 'next co-op board meeting · last meeting’s minutes are due the same day')}</div>
      <div className="c-body">
        {laneFrame(rows, from, to, 'month', 'gt')}
        <div className="mkey">
          <span>
            <i className="sw" style={css('background:var(--fg)')} />
            Held, minutes filed
          </span>
          <span>
            <i className="sw" style={css('background:var(--ground);box-shadow:inset 0 0 0 2px var(--fg)')} />
            Coming up
          </span>
          <span>
            <i className="sw" style={css('background:var(--live)')} />
            Member vote open
          </span>
          <span>
            <i className="sw" style={css('background:var(--underway)')} />
            Minutes due
          </span>
        </div>
      </div>
      {strip([
        ['Held', String(MEETINGS_HELD.held)],
        ['Minutes filed', `${MEETINGS_HELD.minutes} of ${MEETINGS_HELD.held}`],
        ['Next', nextMeeting() ? `${nextMeeting()[0]} · ${fmtD(nextMeeting()[1])}` : 'None'],
        ['Delegate assembly', MEETS.find((m) => m[0] === 'Delegate assembly')?.[1][0][3] ?? '—'],
      ])}
    </section>
  );
  return (
    <>
      {G(
        'Votes',
        'One member, one vote',
        '',
        <>
          {voteCell('s-8', true)}
          {past}
        </>,
      )}
      {G('Meetings', '', '', meets)}
      {G(
        'Next meeting',
        '',
        '',
        <>
          {agendaCell('s-6')}
          {gCell(
            's-6',
            'Recent resolutions',
            'Every board',
            figHtml(String(RESOS.length), 'passed since August'),
            resoRows(RESOS.slice(0, 4)),
            <div className="c-ft">
              <button type="button" data-vpane="boards">
                <span className="t">Boards</span>
                {ic('chev', 'sm')}
              </button>
            </div>,
          )}
        </>,
      )}
    </>
  );
}

/* a month at a glance: filings, meetings and votes on one ruled sheet */
export function monthEvents() {
  const out = [],
    keep = (id) => VS.cal === 'all' || VS.cal === id;
  FILINGS.forEach((f) => {
    if (keep(f[1]))
      out.push({
        t: f[3],
        kind: 'fil',
        st: f[4],
        n: f[2],
        s: RPN[f[1]] || entOf(f[1])[1],
        attr: `data-vflow="filing" data-vid="${f[0]}"`,
      });
  });
  MEETS.forEach(([b, evs]) => {
    const id = MBODY[b];
    if (!id || !keep(id)) return;
    evs.forEach((e) => {
      if (e[0] === 'held' || e[0] === 'next')
        out.push({
          t: e[1],
          kind: 'meet',
          held: e[0] === 'held',
          n: b === 'Members' ? e[2] || 'Member meeting' : b,
          s: b === 'Members' ? 'Members' : e[0] === 'held' ? 'Held' : 'Meeting',
          attr: b === 'Co-op board' && e[1] === D(11, 4) ? 'data-vmeet' : '',
        });
      if (e[0] === 'span') {
        out.push({
          t: e[1],
          kind: 'vote',
          n: 'Vote opens',
          s: e[3],
          attr: 'data-vflow="ballot"',
        });
        out.push({
          t: e[2],
          kind: 'vote',
          n: 'Vote closes',
          s: e[3],
          attr: 'data-vflow="ballot"',
        });
      }
    });
  });
  return out;
}
export function monthCell() {
  const base = new Date(Date.UTC(2026, 9 + VS.mo, 1)),
    y = base.getUTCFullYear(),
    m = base.getUTCMonth(),
    first = base.getTime();
  const next = Date.UTC(y, m + 1, 1),
    lead = (base.getUTCDay() + 6) % 7,
    start = first - lead * DAY,
    weeks = Math.ceil((lead + (next - first) / DAY) / 7);
  const evs = monthEvents(),
    inMonth = evs.filter((e) => e.t >= first && e.t < next).sort((a, b) => a.t - b.t);
  const mark = (e) =>
    e.kind === 'fil'
      ? `background:${FST[e.st][2]}`
      : e.kind === 'vote'
        ? 'background:var(--land)'
        : e.held
          ? 'background:var(--fg-50)'
          : 'background:var(--ground);box-shadow:inset 0 0 0 1.5px var(--fg)';
  const days = Array.from(
    {
      length: weeks * 7,
    },
    (_, i) => {
      const t = start + i * DAY,
        d = new Date(t),
        dn = d.getUTCDate(),
        wk = d.getUTCDay() % 6 === 0,
        out = t < first || t >= next;
      const es = evs.filter((e) => e.t >= t && e.t < t + DAY),
        more = es.length - 3;
      return (
        <div key={i} className={`cal-d${t === TODAY ? ' today' : ''}${wk ? ' wk' : ''}${t < TODAY ? ' past' : ''}${out ? ' out' : ''}`}>
          <span className="cal-n">{dn === 1 ? MON[d.getUTCMonth()] + ' 1' : dn}</span>
          {es.slice(0, 3).map((e, __k) =>
            e.attr ? (
              <button key={__k} type="button" className={`gev ${e.kind}`} {...attrs(e.attr)} title={`${e.n} · ${e.s}`}>
                <i style={css(mark(e))} />
                <span>
                  <b>{e.n}</b>
                  <em>{e.s}</em>
                </span>
              </button>
            ) : (
              <span key={__k} className={`gev ${e.kind}`} {...attrs(e.attr)} title={`${e.n} · ${e.s}`}>
                <i style={css(mark(e))} />
                <span>
                  <b>{e.n}</b>
                  <em>{e.s}</em>
                </span>
              </span>
            ),
          )}
          {more > 0 ? (
            <span className="gev-more">
              +{more}
              {' more'}
            </span>
          ) : (
            ''
          )}
        </div>
      );
    },
  );
  const label = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m]} ${y}`;
  const nav = (
    <span className="calnav">
      <button type="button" data-vmo="-1" aria-label="Previous month" {...attrs(VS.mo <= 0 ? 'disabled' : '')}>
        {ic('chev', 'sm')}
      </button>
      {VS.mo ? (
        <button type="button" className="calnav-t" data-vtoday="">
          Today
        </button>
      ) : (
        ''
      )}
      <button type="button" data-vmo="1" aria-label="Next month" {...attrs(VS.mo >= 9 ? 'disabled' : '')}>
        {ic('chev', 'sm')}
      </button>
    </span>
  );
  const nf = inMonth.filter((e) => e.kind === 'fil').length,
    nm = inMonth.filter((e) => e.kind === 'meet').length,
    nv = inMonth.filter((e) => e.kind === 'vote').length;
  const nxt = evs.filter((e) => e.t >= Math.max(TODAY, first) && e.t < next).sort((a, b) => a.t - b.t)[0];
  return (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">{label}</span>
        <span className="hd-tools">{nav}</span>
      </header>
      <div className="c-fig">
        {figHtml(
          String(inMonth.length),
          `${inMonth.length === 1 ? 'thing' : 'things'} on the calendar in ${label.split(' ')[0]}${nxt ? ` · next up, ${nxt.n.toLowerCase()} on ${fmtD(nxt.t)}` : ''}`,
        )}
      </div>
      <div className="c-body">
        <div className="cal gcal">
          <div className="cal-h">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, __k) => (
              <span key={__k}>{d}</span>
            ))}
          </div>
          <div className="cal-g">{days}</div>
        </div>
        <div className="phlist">
          {inMonth.length ? (
            evRows(inMonth.map((e) => [fmtD(e.t), e.n, e.s, e.kind === 'fil' ? FST[e.st][1] : e.kind === 'vote' ? 'Vote' : e.held ? 'Held' : 'Meeting']))
          ) : (
            <p className="quiet small" style={css('margin:0')}>
              Nothing this month.
            </p>
          )}
        </div>
        <div className="mkey">
          <span>
            <i className="sw" style={css('background:var(--fg)')} />
            Filing ready
          </span>
          <span>
            <i className="sw" style={css('background:var(--underway)')} />
            Drafting
          </span>
          <span>
            <i className="sw" style={css('background:var(--absent)')} />
            Not started
          </span>
          <span>
            <i className="sw" style={css('background:var(--line)')} />
            Later
          </span>
          <span>
            <i className="sw" style={css('background:var(--ground);box-shadow:inset 0 0 0 1.5px var(--fg)')} />
            Meeting
          </span>
          <span>
            <i className="sw" style={css('background:var(--fg-50)')} />
            Meeting held
          </span>
          <span>
            <i className="sw" style={css('background:var(--land)')} />
            Member vote
          </span>
        </div>
      </div>
      {strip([
        ['Filings', String(nf)],
        ['Meetings', String(nm)],
        ['Votes', String(nv)],
        ['Showing', VS.cal === 'all' ? 'All entities' : entOf(VS.cal)[1]],
      ])}
    </section>
  );
}
export function vCalendar() {
  const opts = [
    ['all', 'All entities', FILINGS.length],
    ...['coop', 'labs', 'fin', 'hold', 'dt', 'fdn'].map((id) => [id, entOf(id)[1], FILINGS.filter((f) => f[1] === id).length]),
  ];
  const list = FILINGS.filter((f) => VS.cal === 'all' || f[1] === VS.cal),
    next = list.filter((f) => f[3] > NOW).sort((a, b) => a[3] - b[3])[0];
  // the month with the most filings of one kind, like April's federal returns
  const cluster = Object.values(
    list.reduce((a, f) => {
      const m = new Date(f[3]).getUTCMonth(),
        k = m + '|' + f[2];
      a[k] = a[k] || { m, t: f[2], n: 0 };
      a[k].n++;
      return a;
    }, {}),
  ).reduce((a, c) => (!a || c.n > a.n ? c : a), null);
  const from = D(10, 15),
    to = D(7, 31, 2027);
  const cal = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">The year ahead</span>
        <span className="hd-tools">{ddHtml('vcal', opts, VS.cal, 'Show')}</span>
      </header>
      <div className="c-fig">
        {figHtml(
          String(list.length),
          `filings and meetings through July · ${list.filter((f) => f[4] === 'ready').length} ready, ${list.filter((f) => f[4] === 'draft').length} drafting, ${list.filter((f) => f[4] === 'none').length} not started`,
        )}
      </div>
      <div className="c-body">
        {filingLanes(list, from, to, false)}
        {filKey()}
      </div>
      {strip([
        ['Next', next ? `${next[2]} · ${fmtD(next[3])}` : 'None'],
        ['Ready', String(list.filter((f) => f[4] === 'ready').length)],
        ['Not started', String(list.filter((f) => f[4] === 'none').length), '', 'warn'],
        ...(cluster ? [[MON_LONG[cluster.m], `${cluster.n} ${cluster.t.toLowerCase()}s`]] : []),
      ])}
    </section>
  );
  /* by month, stacked by status */
  const months = Array.from(
    {
      length: 9,
    },
    (_, i) => {
      const d = new Date(D(11, 1));
      d.setUTCMonth(d.getUTCMonth() + i);
      return d.getTime();
    },
  );
  const ks = ['ready', 'draft', 'none', 'later'],
    bins = months.map((m) => {
      const e = new Date(m);
      e.setUTCMonth(e.getUTCMonth() + 1);
      return ks.map((k) => list.filter((f) => f[4] === k && f[3] >= m && f[3] < e.getTime()).length);
    });
  const mx = Math.max(1, ...bins.map((b) => b.reduce((a, c) => a + c, 0)));
  const cols = (
    <div className="scol" style={css('--colh:120px')}>
      {bins.map((b, i) => {
        const tot = b.reduce((a, c) => a + c, 0);
        return (
          <div key={i} className="mcol">
            <span className="cv2">{tot || ''}</span>
            <span className="mcol-s">
              {b.map((v, k) => (v ? <i key={k} style={css(`height:${((v / mx) * 120).toFixed(1)}px;background:${FST[ks[k]][2]}`)} /> : ''))}
            </span>
            <span className="ck">{MON[new Date(months[i]).getUTCMonth()]}</span>
          </div>
        );
      })}
    </div>
  );
  const busy = gCell(
    's-6',
    'By month',
    'Nov – Jul',
    cluster ? figHtml(MON_LONG[cluster.m], `the busiest month · ${word(cluster.n)} ${cluster.t.toLowerCase()}s`) : figHtml('—', 'nothing due'),
    <>
      {cols}
      {filKey()}
    </>,
    strip(
      bins
        .map((b, i) => [MON[new Date(months[i]).getUTCMonth()], b.reduce((a, c) => a + c, 0), i])
        .sort((a, b) => b[1] - a[1] || a[2] - b[2])
        .slice(0, 2)
        .map(([k, n]) => [k, String(n)]),
    ),
  );
  const owners = [...new Set(list.map((f) => f[5]).filter(Boolean))].map((k) => [k, list.filter((f) => f[5] === k).length]).sort((a, b) => b[1] - a[1]);
  const own = gCell(
    's-6',
    'Who files',
    'Owner of each filing',
    figHtml(String(owners[0][1]), 'filings with the outside accountant · most of them land in April'),
    <div className="hbars">
      {owners.map(([k, v], __k) => (
        <div key={__k} className="hb">
          <span className="hb-k">{k}</span>
          <span className="hb-bar">
            <i style={css(`width:${(v / owners[0][1]) * 100}%;background:var(--fg)`)} />
          </span>
          <b className="num">{v}</b>
        </div>
      ))}
    </div>,
    strip([
      ['Owners', String(owners.length)],
      ['Unassigned', String(list.filter((f) => !f[5]).length)],
    ]),
  );
  return (
    <>
      {G('This month', 'Select anything to open it', '', monthCell())}
      {G('The year ahead', '', '', cal)}
      {G(
        'Load',
        '',
        '',
        <>
          {busy}
          {own}
        </>,
      )}
    </>
  );
}

/* ── panels ───────────────────────────────────────────────────────────── */
export function sec(label, inner, aside = '') {
  return (
    <section className="pn-s">
      <div className="pn-h">
        <span className="lbl">{label}</span>
        {aside ? <span className="pn-a">{aside}</span> : ''}
      </div>
      {inner}
    </section>
  );
}
export function kv(rows) {
  return (
    <div className="rows ledger">
      {rows.map(([k, v, t], __k) => (
        <div key={__k} className={`r${t ? ' total' : ''}`}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  );
}
export function entChip(id) {
  const e = entOf(id);
  return (
    <button type="button" className={`ent-chip ${e[3]}`} data-ent={id}>
      <i style={css(`background:${EST[e[3]][0]}`)} />
      {e[1]}
    </button>
  );
}
export function stepsViz(steps) {
  const done = steps.filter((x) => x[1]).length;
  return (
    <>
      <div className="fz">
        <div className="fz-bar">
          {steps.map((x, __k) => (
            <i key={__k} className={x[1] ? 'on' : ''} />
          ))}
        </div>
        <span className="fz-n">
          {done}
          {' of '}
          {steps.length}
        </span>
      </div>
      <div className="fz-l">
        {steps.map(([t, d], i) => (
          <div key={i} className={`fz-r${d ? ' on' : ''}${!d && steps.findIndex((x) => !x[1]) === i ? ' next' : ''}`}>
            <span className="fz-m">{d ? ic('check', 'sm') : i + 1}</span>
            <span>{t}</span>
            {!d && steps.findIndex((x) => !x[1]) === i ? <span className="chip underway">Next</span> : ''}
          </div>
        ))}
      </div>
    </>
  );
}
export function fileStrip(fs) {
  /* the next nine months as one track: square per filing, months below, now at the left edge */
  const a = NOW,
    b = D(7, 31, 2027),
    x = (t) => ((t - a) / (b - a)) * 100,
    list = fs.filter((f) => f[3] >= a && f[3] <= b);
  if (!list.length) return '';
  const months = [];
  for (let m = new Date(a); m.getTime() <= b; m.setUTCMonth(m.getUTCMonth() + 1)) {
    m.setUTCDate(1);
    if (m.getTime() > a + 10 * DAY) months.push(m.getTime());
  }
  return (
    <div className="fs2">
      <div className="fs2-t">
        <span className="fs2-now">Now</span>
        {months.map((t, __k) => (
          <i key={__k} className="fs2-g" style={css(`left:${x(t)}%`)} />
        ))}
        {list.map((f, __k) => (
          <button
            key={__k}
            type="button"
            className={`fs2-m ${f[4]}`}
            data-vflow="filing"
            data-vid={f[0]}
            style={css(`left:${x(f[3])}%`)}
            title={`${f[2]} · ${fmtD(f[3])}`}
          />
        ))}
      </div>
      <div className="fs2-ax">
        {months.map((t, i) =>
          i % 2 ? (
            ''
          ) : (
            <span key={i} style={css(`left:${x(t)}%`)}>
              {MON[new Date(t).getUTCMonth()]}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
export function governancePane() {
  if (VS.meet) return meetingPane();
  if (!VS.ent) return '';
  const e = entOf(VS.ent);
  if (!e) return '';
  const id = e[0],
    F = ENTF[id] || {},
    fs = FILINGS.filter((f) => f[1] === id),
    b = GBOARDS.find((x) => x[1] === id),
    rp = RP.map((r, i) => [r, i]).filter(([r]) => r[0] === id || r[1] === id);
  const par = PARENT[id],
    kids = KIDS(id);
  const where = (
    <div className="ws">
      {par ? (
        <div className="ws-r">
          <span className="lbl">Owned by</span>
          <span className="ws-v">
            {entChip(par)}
            {OWN[id] ? <span className="mono quiet">{OWN[id]}</span> : ''}
          </span>
        </div>
      ) : (
        <div className="ws-r">
          <span className="lbl">Owned by</span>
          <span className="ws-v">
            <span>{id === 'coop' ? 'Its members, one vote each' : 'Nobody · ownerless'}</span>
          </span>
        </div>
      )}
      {kids.length ? (
        <div className="ws-r">
          <span className="lbl">{id === 'mgr' ? 'Manages' : 'Owns'}</span>
          <span className="ws-v">{kids.map(entChip)}</span>
        </div>
      ) : (
        ''
      )}
      {id === 'labs' ? (
        <div className="ws-r">
          <span className="lbl">Works for</span>
          <span className="ws-v">{entChip('fdn')}</span>
        </div>
      ) : id === 'fdn' ? (
        <div className="ws-r">
          <span className="lbl">Contracts</span>
          <span className="ws-v">{entChip('labs')}</span>
        </div>
      ) : (
        ''
      )}
    </div>
  );
  const facts = kv([
    ['Kind', e[2]],
    ['Formed', F.formed || 'Not yet'],
    ['Taxed as', F.tax || '—'],
    ['EIN', F.ein || 'Not yet'],
    ['Officers', F.officers || '—'],
    ['Registered agent', 'Wyoming registered agent', 1],
  ]);
  const board = b
    ? sec(
        b[0],
        <>
          <div className="bs-q pane-q">
            {b[2].map(([c, h, a, t, note], __k) => (
              <i key={__k} className={h ? 'on' : ''} style={css(`--c:${SEATC[c][0]}`)} title={`${h || 'Open'} · ${SEATC[c][1]}`}>
                {h
                  ? h
                      .split(' ')
                      .map((x) => x[0])
                      .join('')
                      .slice(0, 2)
                  : ''}
              </i>
            ))}
          </div>
          <div className="sl2">
            {b[2].map(([c, h, a, t, note], __k) => (
              <div key={__k} className="sl2-r">
                <i style={css(`background:${h ? SEATC[c][0] : 'transparent'};box-shadow:inset 0 0 0 1.5px ${SEATC[c][0]}`)} />
                <span>
                  <b>{h || 'Open'}</b>
                  {' · '}
                  {SEATC[c][1]}
                </span>
                <span className="quiet small">{h && t ? 'Term to ' + fmtD(t) + ' ' + new Date(t).getUTCFullYear() : note || ''}</span>
              </div>
            ))}
          </div>
        </>,
        <button type="button" className="pn-link" data-vpane="boards">
          Boards
        </button>,
      )
    : '';
  const form = F.steps
    ? sec(
        'Formation',
        stepsViz(F.steps),
        <button type="button" className="pn-link" data-vflow="form" data-vid={id}>
          Checklist
        </button>,
      )
    : '';
  const fil = fs.length
    ? sec(
        'Filings',
        <>
          {fileStrip(fs)}
          <div className="pn-list">
            {fs.map((f, __k) => (
              <button key={__k} type="button" className="pn-r" data-vflow="filing" data-vid={f[0]}>
                <span className="ev-d">{fmtD(f[3])}</span>
                <span className="pn-k">
                  <b>{f[2]}</b>
                  <span className="small quiet">{f[5]}</span>
                </span>
                <span className={`chip ${FST[f[4]][0]}`}>{FST[f[4]][1]}</span>
              </button>
            ))}
          </div>
        </>,
      )
    : '';
  const agr = (F.agr || []).length
    ? sec(
        'Agreements',
        <div className="pn-list">
          {F.agr.map((aid, __k) => {
            const a = agrOf(aid);
            return a ? (
              <button key={__k} type="button" className="pn-r two" data-go="contracts">
                <span className="pn-k">
                  <b>{a.name}</b>
                  <span className="small quiet">
                    {a.party}
                    {a.b ? ' · renews ' + fmtD(a.b) : ''}
                  </span>
                </span>
                <span className={`chip ${AST[a.st][0]}`}>{AST[a.st][1]}</span>
              </button>
            ) : (
              ''
            );
          })}
        </div>,
      )
    : '';
  const rps = rp.length
    ? sec(
        'Related parties',
        <div className="pn-list">
          {rp.map(([r, i], __k) => (
            <button key={__k} type="button" className="pn-r two" data-vflow="rp" data-vid={i}>
              <span className="pn-k">
                <b>
                  {RPN[r[0]]}
                  {' → '}
                  {RPN[r[1]]}
                </b>
                <span className="small quiet">
                  {r[2]}
                  {' · '}
                  {r[3].length}
                  {' logged'}
                </span>
              </span>
              {r[5] ? <span className="chip underway">Open</span> : <span className="mono quiet small">{r[4] ? money(r[4] * r[3].length) : '—'}</span>}
            </button>
          ))}
        </div>,
      )
    : '';
  const body = (
    <>
      <div>
        <p className="h2" style={css('font-size:28px')}>
          {e[1]}
        </p>
        <p className="quiet" style={css('margin:8px 0 0')}>
          {e[4]}
        </p>
      </div>
      {sec('Where it sits', where)}
      {form}
      {sec('Facts', facts)}
      {board}
      {fil}
      {agr}
      {rps}
    </>
  );
  const foot = (
    <>
      {F.steps ? (
        <button className="btn btn-p" type="button" data-vflow="form" data-vid={id}>
          Formation checklist
        </button>
      ) : (
        <button className="btn btn-p" type="button" data-vflow="log" data-vid={id}>
          Log a decision
        </button>
      )}
      <button className="btn btn-g" type="button" data-go="records">
        Documents
      </button>
    </>
  );
  return (
    <>
      <div className="pane-scrim" data-closevpane="" />
      <aside className="pane" role="dialog" aria-label="Entity">
        <header className="m-hd">
          <span className="sub">Entity</span>
          <span style={css('display:flex;align-items:center;gap:8px')}>
            <span className={`chip ${e[3] === 'forming' ? 'underway' : 'plain'}`}>{EST[e[3]][1]}</span>
            <button className="x" type="button" data-closevpane="" aria-label="Close">
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
export function meetingPane() {
  const tot = AGENDA.reduce((a, x) => a + x[1], 0);
  let t = 0;
  const seated = GBOARDS[0][2].filter((x) => x[1]);
  const body = (
    <>
      <div>
        <p className="h2" style={css('font-size:28px')}>
          Co-op board
        </p>
        <p className="quiet" style={css('margin:8px 0 0')}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(nextBoard()).getUTCDay()]} {fmtD(nextBoard())}
          {' · 18:00 – 19:00 · video call'}
        </p>
      </div>
      {sec(
        'Agenda',
        <>
          <div className="ag-bar">
            {AGENDA.map(([x, m, o, k], i) => (
              <i key={i} style={css(`width:${(m / tot) * 100}%;background:${AK[k][0]}`)}>
                {i + 1}
              </i>
            ))}
          </div>
          <div className="pn-list">
            {AGENDA.map(([x, m, o, k], i) => {
              const at = 18 * 60 + t;
              t += m;
              return (
                <div key={i} className="pn-r">
                  <span className="ev-d">
                    {Math.floor(at / 60)}:{String(at % 60).padStart(2, '0')}
                  </span>
                  <span className="pn-k">
                    <b>
                      {i + 1}
                      {'. '}
                      {x}
                    </b>
                    <span className="small quiet">
                      {o}
                      {' · '}
                      {m}
                      {' min'}
                    </span>
                  </span>
                  <span className="ag-t">
                    <i style={css(`background:${AK[k][0]}`)} />
                    {AK[k][1]}
                  </span>
                </div>
              );
            })}
          </div>
        </>,
        <button type="button" className="pn-link" data-vflow="item">
          Add an item
        </button>,
      )}
      {sec(
        'Who’s coming',
        <div className="pn-list">
          {seated.map(([c, h], i) => (
            <div key={i} className="pn-r">
              <span className={`sg-sq${h === 'Kai' ? ' me' : ''}`}>
                {h
                  .split(' ')
                  .map((x) => x[0])
                  .join('')
                  .slice(0, 2)}
              </span>
              <span className="pn-k">
                <b>{h}</b>
                <span className="small quiet">Member-elected seat</span>
              </span>
              <span className={`chip ${MEETING.rsvp[i] === 'Coming' ? 'plain' : 'underway'}`}>{MEETING.rsvp[i] ?? 'No reply'}</span>
            </div>
          ))}
        </div>,
        `${seated.length} of ${seated.length} needed`,
      )}
      {sec(
        'Packet',
        kv([
          ...MEETING.packet,
          ['Sent', 'Not yet', 1],
        ]),
      )}
    </>
  );
  return (
    <>
      <div className="pane-scrim" data-closevpane="" />
      <aside className="pane" role="dialog" aria-label="Meeting">
        <header className="m-hd">
          <span className="sub">Meeting</span>
          <span style={css('display:flex;align-items:center;gap:8px')}>
            <span className="chip plain">In 14 days</span>
            <button className="x" type="button" data-closevpane="" aria-label="Close">
              {ic('close')}
            </button>
          </span>
        </header>
        <div className="pane-mn">{body}</div>
        <footer className="pane-ft">
          <button className="btn btn-p" type="button" data-vflow="packet">
            Send the packet
          </button>
          <button className="btn btn-g" type="button" data-vflow="minutes">
            Start the minutes
          </button>
        </footer>
      </aside>
    </>
  );
}

/* ── modals ───────────────────────────────────────────────────────────── */
export function vModal(f, kind) {
  modalShell(
    f.t,
    <>
      <div>
        <span className="lbl">{f.lbl || f.t}</span>
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
      {f.pre || ''}
      {f.rows ? kv(f.rows) : ''}
      {f.post || ''}
      {f.note ? (
        <div className="note">
          {ic(f.noteIc || 'out', 'sm')}
          <span>{f.note}</span>
        </div>
      ) : (
        ''
      )}
      <div className="acts">
        {f.btn ? (
          <>
            <button className="btn btn-p" type="button" data-vgo={kind}>
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
    f.foot || 'Every change is logged',
  );
  document.addEventListener('keydown', onKey);
  openVFlow.f = f;
}
export function openVFlow(kind, id) {
  vars.lastFocus = document.activeElement;
  let f = null;
  if (kind === 'filing') {
    const f0 = filOf(id),
      e = entOf(f0[1]);
    const stages = [
      ['Draft', f0[4] !== 'none' && f0[4] !== 'later' ? 1 : 0],
      ['Ready', f0[4] === 'ready' || f0[4] === 'done' ? 1 : 0],
      ['Filed', f0[4] === 'done' ? 1 : 0],
      ['Receipt', 0],
    ];
    const cur = stages.findIndex((x) => !x[1]);
    const base = {
      lbl: `${e[1]} · due ${fmtD(f0[3])}`,
      h: f0[2],
      pre: <div>{vizTrack(stages.map(([t, d], i) => [t, d ? 1 : i === cur ? 2 : 0]))}</div>,
      rows: [
        ['Owner', f0[5]],
        ['Status', FST[f0[4]][1]],
        ['Days left', String(Math.max(0, Math.round((f0[3] - NOW) / DAY)))],
        [
          'Filed with',
          f0[2].includes('report') || f0[2].includes('Formation') || f0[2].includes('Statement')
            ? 'The state'
            : f0[2].includes('return')
              ? 'The IRS'
              : f0[2].includes('minutes') || f0[2].includes('meeting')
                ? 'Records'
                : 'Internal',
          1,
        ],
      ],
    };
    f = Object.assign(
      base,
      {
        ready: {
          t: 'File it',
          btn: 'Open the filing site',
          ext: 1,
          note: (
            <>
              <b>You file on the state’s site.</b>
              {' Mark it filed here once the receipt comes back.'}
            </>
          ),
          after: () => {
            f0[4] = 'done';
          },
          steps: ['Opened the state’s filing site', 'Attached the prepared report'],
          done: ['Over to the state’s site.', 'It shows as filed on the calendar.'],
        },
        draft: {
          t: 'Mark ready',
          btn: 'Mark ready',
          post: (
            <label className="field">
              <span className="lbl">Note for the owner</span>
              <input type="text" defaultValue="Checked against last year’s filing" autoComplete="off" />
            </label>
          ),
          after: () => {
            f0[4] = 'ready';
          },
          steps: ['Marked it ready', 'Told the owner'],
          done: ['Ready to file.', 'It shows as ready on the calendar.'],
        },
        none: {
          t: 'Start it',
          btn: 'Start it',
          post: (
            <>
              <span className="lbl">Owner</span>
              <div className="seg2" role="group" aria-label="Owner">
                {['Kai', 'Dana Ruiz', 'Accountant', 'Counsel'].map((o, __k) => (
                  <button key={__k} type="button" aria-pressed={o === f0[5]}>
                    {o}
                  </button>
                ))}
              </div>
            </>
          ),
          after: () => {
            f0[4] = 'draft';
          },
          steps: ['Started a draft', 'Asked the owner for a date', 'Set a reminder 14 days out'],
          done: ['Started.', 'It shows as drafting on the calendar.'],
        },
        later: {
          t: 'Filing',
          btn: null,
        },
        done: {
          t: 'Filed',
          btn: null,
        },
      }[f0[4]],
    );
  } else if (kind === 'ballot') {
    const v = VOTE,
      cast = v.days[v.days.length - 1];
    f = {
      t: 'Ballot',
      lbl: `Member vote · ${fmtD(v.open)} – ${fmtD(v.close)}`,
      h: v.t,
      p: 'Adds the term-plan terms to the member agreement. Members accept it in the app once it passes.',
      pre: (
        <>
          <div className="ablock">
            <span className="lbl">
              {'So far · '}
              {cast}
              {' of '}
              {v.elig}
            </span>
            {compBar([
              ['Yes', v.yes, 'var(--fg)', String(v.yes)],
              ['No', v.no, 'var(--underway)', String(v.no)],
              ['Abstain', v.abs, 'var(--line)', String(v.abs)],
            ])}
          </div>
          <div>
            {vizTrack([
              [`Opened ${fmtD(v.open)}`, 1],
              [quorumDay(v) ? `Quorum ${fmtD(quorumDay(v))}` : 'Quorum', quorumDay(v) ? 1 : 2],
              [`Closes ${fmtD(v.close)}`, quorumDay(v) ? 2 : 0],
              ['Certified', 0],
            ])}
          </div>
        </>
      ),
      rows: [
        ['Who votes', `Members with an account · ${v.elig}`],
        ['Quorum', `${Math.round(v.quorum * 100)}%${quorumDay(v) ? ` · reached ${fmtD(quorumDay(v))}` : ''}`],
        ['Passes with', 'A majority of votes cast'],
        ['Then', `Certified by the co-op board, ${fmtD(nextBoard())}`, 1],
      ],
      note: (
        <>
          <b>Results are certified after it closes.</b>
          {' Nobody can change a vote once it’s cast.'}
        </>
      ),
      noteIc: 'check',
      btn: null,
    };
  } else if (kind === 'reso') {
    const [d, b, t, v] = RESOS[+id],
      bd = GBOARDS.find((x) => x[0] === b),
      names = bd[2].filter((x) => x[1]).map((x) => x[1]);
    const why = {
      r: 'Recused, sits on both sides',
      a: 'Absent',
      y: 'For',
      n: 'Against',
    };
    f = {
      t: 'Resolution',
      lbl: `${b} · ${fmtD(d)}`,
      h: t,
      pre: (
        <div className="pn-list">
          {v.map((x, i) => (
            <div key={i} className="pn-r">
              <span className={`sg-sq${names[i] === 'Kai' ? ' me' : ''}`}>
                {(names[i] || '—')
                  .split(' ')
                  .map((y) => y[0])
                  .join('')
                  .slice(0, 2)}
              </span>
              <span className="pn-k">
                <b>{names[i] || 'Seat'}</b>
              </span>
              <span className="rs-v">
                <i className={x} />
              </span>
              <span className="small quiet" style={css('min-width:150px;text-align:right')}>
                {why[x]}
              </span>
            </div>
          ))}
        </div>
      ),
      rows: [
        ['Result', `Passed ${v.filter((x) => x === 'y').length}–${v.filter((x) => x === 'n').length}`],
        ['Recorded in', `The ${fmtD(d)} minutes`],
        ['Signed by', 'Kai, secretary', 1],
      ],
      btn: 'Open the minutes',
      ext: 1,
      steps: ['Opened the minutes in Records'],
      done: ['Opened in Records.', 'Nothing changes here.'],
    };
  } else if (kind === 'rp') {
    const [a, b, w, ds, amt, open] = RP[+id];
    f = {
      t: 'Related party',
      lbl: `${RPN[a]} → ${RPN[b]}`,
      h: w,
      pre: ds.length ? (
        <div className="pn-list">
          {ds.map((t, __k) => (
            <div key={__k} className="pn-r">
              <span className="ev-d">{fmtD(t)}</span>
              <span className="pn-k">
                <b>{w}</b>
                <span className="small quiet">Logged by Kai</span>
              </span>
              <b className="num">{amt ? money(amt) : '—'}</b>
            </div>
          ))}
        </div>
      ) : (
        ''
      ),
      rows: [
        ['Priced', open ? 'Pricing policy in draft' : amt ? 'Against two outside quotes' : 'At the last valuation'],
        ['Approved by', open ? `${rpBoard(RP[id])}, ${fmtD(open)}` : rpBoard(RP[id])],
        ['Total this year', amt ? money(amt * ds.length) : '—'],
        ['Conflict', a === 'coop' && b === 'labs' ? 'Kai recused' : 'None', 1],
      ],
      btn: open ? `Put it on the ${fmtD(open)} agenda` : 'Log a payment',
      steps: open ? ['Added it to the Holdings board agenda', 'Attached the draft pricing policy'] : ['Logged the payment', 'Attached the invoice'],
      done: open ? ['On the agenda.', `The ${rpBoard(RP[id])} takes it up on ${fmtD(open)}.`] : ['Logged.', 'It shows on the related-party log.'],
      after: open
        ? null
        : () => {
            ds.push(NOW);
          },
    };
  } else if (kind === 'matter') {
    const [d, v, p] = MATTERS[+id];
    f = {
      t: 'Who decides',
      lbl: 'Reserved matter',
      h: d,
      pre: (
        <div className="pn-list">
          {BODIES.map((b, i) =>
            v[i] < 0 ? (
              ''
            ) : (
              <div key={i} className="pn-r">
                <span className="rmx-c">{v[i] === 2 ? <i className="d" /> : v[i] === 1 ? <i className="a" /> : <i className="t" />}</span>
                <span className="pn-k">
                  <b>{b}</b>
                </span>
                <span className="small quiet">{['Is told', 'Must approve', 'Decides'][v[i]]}</span>
              </div>
            ),
          )}
        </div>
      ),
      rows: [
        ['Written in', v[0] === 2 ? 'The operating agreement' : v[2] > 0 ? 'Holdings bylaws' : v[4] === 2 ? 'The Foundation charter' : 'The two-person rule'],
        ['Last used', p ? 'Open now' : 'Not yet'],
        ['Open', p || 'Nothing', 1],
      ],
      btn: p ? 'Start the approval' : null,
      steps: ['Opened an approval', 'Sent it to the Co-op board and the co-op seats'],
      done: ['Approval started.', 'It shows on the 4 Nov agenda.'],
    };
  } else if (kind === 'form') {
    const e = entOf(id),
      F = ENTF[id];
    f = {
      t: 'Formation checklist',
      lbl: e[2],
      h: e[1],
      pre: stepsViz(F.steps),
      rows: [
        ['Owner', 'Accountant'],
        ['Filed in', 'Wyoming', 1],
      ],
      btn: F.steps.some((x) => !x[1]) ? `Mark “${F.steps.find((x) => !x[1])[0]}” done` : null,
      after: () => {
        const s = F.steps.find((x) => !x[1]);
        if (s) s[1] = 1;
        if (F.steps.every((x) => x[1])) e[3] = 'formed';
      },
      steps: ['Marked the step done', 'Filed the paperwork in Records'],
      done: ['Step done.', 'The checklist and the map show it.'],
    };
  } else if (kind === 'remind') {
    const n = VOTE.elig - VOTE.days[VOTE.days.length - 1];
    f = {
      t: 'Remind members',
      h: `${n} members`,
      rows: [
        ['Who', 'Haven’t voted on v2.2'],
        ['Where', 'In the Clear app'],
        ['Sent by', 'Clear, not a person'],
        ['Vote closes', fmtD(VOTE.close), 1],
      ],
      btn: 'Send the reminder',
      steps: ['Queued an in-app reminder', 'Logged who sent it'],
      done: ['Reminder sent.', 'Turnout updates here as votes come in.'],
    };
  } else if (kind === 'packet') {
    f = {
      t: 'Send the packet',
      h: `Co-op board · ${fmtD(nextBoard())}`,
      rows: [
        ['Agenda', `${AGENDA.length} items, ${AGENDA.reduce((a, x) => a + x[1], 0)} minutes`],
        ['Attached', MEETING.attached.join(', ')],
        ['To', `${seatedBoard().length} seated board members`],
        ['Sent by', 'You', 1],
      ],
      btn: 'Send it',
      steps: ['Built the packet from the agenda', `Attached the ${MEETING.attached[0]}`, `Sent it to ${seatedBoard().length} board members`],
      done: ['Packet sent.', 'It’s filed with the meeting in Records.'],
    };
  } else if (kind === 'minutes') {
    f = {
      t: 'Start the minutes',
      h: `Co-op board · ${fmtD(nextBoard())}`,
      p: 'A draft with the agenda as headings, ready to fill in during the meeting.',
      rows: [
        ['Secretary', 'Kai'],
        ['Template', 'Co-op board minutes'],
        ['Filed in', 'Records, once approved', 1],
      ],
      btn: 'Start the draft',
      steps: ['Made a draft from the agenda', 'Filed it with the meeting'],
      done: ['Draft started.', `It’s in Records, attached to ${fmtD(nextBoard())}.`],
    };
  } else if (kind === 'item') {
    f = {
      t: 'Add an item',
      h: `Co-op board · ${fmtD(nextBoard())}`,
      post: (
        <>
          <label className="field">
            <span className="lbl">Item</span>
            <input id="vi-what" type="text" defaultValue="Set the 2027 meeting dates" autoComplete="off" />
          </label>
          <span className="lbl">Kind</span>
          <div className="seg2" role="group" aria-label="Kind">
            {['Vote', 'Report', 'Discuss'].map((k, i) => (
              <button key={i} type="button" aria-pressed={i === 0}>
                {k}
              </button>
            ))}
          </div>
        </>
      ),
      rows: [
        ['Length', '5 min'],
        ['Agenda after', '65 min', 1],
      ],
      btn: 'Add it',
      after: () => {
        AGENDA.push([openVFlow.lastItem || 'New item', 5, 'Kai', 'vote']);
      },
      steps: ['Added it to the agenda'],
      done: ['Added.', 'It’s item ' + (AGENDA.length + 1) + ' on the agenda.'],
    };
  } else if (kind === 'log') {
    const k = VS.logKind || 'reso',
      ent = id && entOf(id) ? entOf(id)[1] : 'Clear Co-op';
    const kinds = [
      ['reso', 'Resolution'],
      ['rp', 'Related-party item'],
      ['matter', 'Reserved matter'],
    ];
    f = {
      t: 'Log a decision',
      h: kinds.find((x) => x[0] === k)[1],
      pre: (
        <div className="seg2" role="group" aria-label="Kind">
          {kinds.map(([v, t], __k) => (
            <button key={__k} type="button" data-vkind={v} data-vid={id || ''} aria-pressed={v === k}>
              {t}
            </button>
          ))}
        </div>
      ),
      post: (
        <label className="field">
          <span className="lbl">{k === 'rp' ? 'What moved, between whom' : 'What was decided'}</span>
          <input
            id="vl-what"
            type="text"
            defaultValue={
              k === 'rp' ? 'Program services, October' : k === 'matter' ? 'Approve the intercompany pricing policy' : 'Approve the 2027 meeting calendar'
            }
            autoComplete="off"
          />
        </label>
      ),
      rows:
        k === 'rp'
          ? [
              ['Between', `${ent} → Clear Financial Co.`],
              ['Amount', money(1200)],
              ['Filed in', 'Related-party log', 1],
            ]
          : [
              ['Body', k === 'matter' ? 'Co-op board and co-op seats' : 'Co-op board'],
              ['Entity', ent],
              ['Filed in', 'Records, with the minutes', 1],
            ],
      btn: 'Log it',
      steps: ['Saved the decision', k === 'rp' ? 'Added it to the related-party log' : 'Filed it with the 4 Nov minutes'],
      done: ['Logged.', k === 'rp' ? 'It shows on the related-party log.' : 'It’s in Records with the minutes.'],
    };
  }
  if (!f) return;
  vModal(f, kind);
}

/* ══ Records ════════════════════════════════════════════════════════════
   Documents, and a log of every action taken in this app. Ties: Contracts (agreements, Inland Cycle Works
   waiting, RevolvingIssuer v1.3, Rosa's cap raise, PayoutPool top-up), Governance (7 Oct minutes draft,
   Statement of Information, formation papers), Field (P-012 replaced 09:12), Merchants (Orange St. Point
   offline 08:40), Home (Plaid re-sync since 22:41). Nothing here can be edited after it's logged. */
