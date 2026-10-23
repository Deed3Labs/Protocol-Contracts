// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { SEED_ROUTE } from '@clear/command-types';
import { LIVE } from '../live/env';
import { Fragment } from 'react';
import { attrs, css } from '../runtime/dom';
import { head, ic, int } from './core';
import { DAY, DESIGNS, FS, LATER, OUT, POSTERS, SHOP_INFO, STOPS, TODAY, vars } from './data';
import { G, dayName, designThumb, figHtml, fmtD, gCell, pid, slug } from './growth';
import { mkey } from './home';
import { ddHtml, stepFlow } from './kit';
export function posterAt(shop, n) {
  return n ? POSTERS.find((p) => p.n === n) : POSTERS.find((p) => p.shop === shop);
}
export function stopDone(s) {
  return s.tasks.every((t) => t.done);
}
export function curStop() {
  return STOPS.find((s) => !stopDone(s));
}
export function fieldPage() {
  const done = STOPS.filter(stopDone).length,
    left = STOPS.length - done,
    cur = curStop();
  const W = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
  const title = cur ? `${W[left]} stop${left === 1 ? '' : 's'} left on today’s route.` : 'Route done for today.';
  const tools = (
    <button className="btn btn-p" type="button" data-fscan="">
      <span className="dot pulse" style={css('color:var(--btn-dot)')} aria-hidden="true" />
      Scan a poster
    </button>
  );
  return (
    <>
      {head(
        <>
          {`Field · ${dayName(route().day)} · `}
          <b>Demo data</b>
        </>,
        title,
        tools,
      )}
      {fRoute(cur, done)}
      {fToday()}
      {fLater()}
      {fieldSheet()}
      <div className="fbar">
        <button className="btn btn-p" type="button" data-fscan="">
          {ic('field', 'sm')}Scan a poster
        </button>
      </div>
    </>
  );
}
export function fRoute(cur, done) {
  if (FS.who === 'me')
    return G(
      'This stop',
      '',
      '',
      gCell(
        's-12',
        'My route',
        'Today',
        figHtml('No stops', 'you aren’t on a route today'),
        <div className="acts">
          <button className="btn btn-g" type="button" data-fwho="marcus">
            See {route().staff}’s route
          </button>
        </div>,
      ),
    );
  const leftMins = STOPS.filter((s) => !stopDone(s)).length * route().minutesPerStop;
  const groups = [];
  STOPS.forEach((s, i) => {
    const g = groups[groups.length - 1];
    if (g && g.city === s.city) g.stops.push([s, i]);
    else
      groups.push({
        city: s.city,
        stops: [[s, i]],
      });
  });
  const segs = groups.map((g, __k) => (
    <span key={__k} className="fseg-g" style={css(`flex:${g.stops.length}`)}>
      {g.stops.map(([s], __k) => (
        <i key={__k} className={stopDone(s) ? 'done' : s === cur ? 'now' : ''} />
      ))}
    </span>
  ));
  const nextStop = cur ? STOPS[STOPS.indexOf(cur) + 1] : null;
  const now = cur
    ? (() => {
        const info = SHOP_INFO[cur.id] || ['–', '–', '–'];
        return (
          <section className="cell s-7 fnow">
            <header className="c-hd">
              <span className="c-kind">
                {ic('merchants', 'sm')}
                <span className="lbl">
                  {'Now · stop '}
                  {STOPS.indexOf(cur) + 1}
                  {' of '}
                  {STOPS.length}
                </span>
              </span>
              <span className="tag">
                {'ETA '}
                {cur.eta}
              </span>
            </header>
            <div className="c-fig">
              <p className="h2 fnow-h">{cur.name}</p>
              <span className="figsub">
                {cur.where}
                {' · '}
                {cur.city}
              </span>
            </div>
            <div className="c-body flush txwrap">
              <div className="txstrip nfacts">
                <div className="txs">
                  <span className="lbl">Open until</span>
                  <b>{info[0]}</b>
                </div>
                <div className="txs">
                  <span className="lbl">Ask for</span>
                  <b>{info[1]}</b>
                </div>
                <div className="txs">
                  <span className="lbl">Last visit</span>
                  <b>{info[2]}</b>
                </div>
              </div>
              <div className="ftasks">
                {cur.tasks.map((t, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`ftask${t.done ? ' done' : ''}`}
                    {...attrs(t.kind === 'poster' ? `data-fscan="${t.p.n}"` : `data-fdev="${cur.id}:${i}"`)}
                  >
                    <span className="fchk">{t.done ? ic('check', 'sm') : ''}</span>
                    <span className="ftask-k">
                      <b>{t.t}</b>
                      <span className="small quiet">
                        {t.done ? `${t.out} at ${t.done}` : t.kind === 'poster' ? `Design ${t.p.design} · ${t.note || 'Scan the code to log it'}` : t.note}
                      </span>
                    </span>
                    <span className="ftask-a">{t.done ? '' : t.kind === 'poster' ? <>{ic('field', 'sm')}Scan</> : 'Mark done'}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="c-ft split">
              <button type="button" data-fskip={cur.id}>
                <span className="t">
                  Skip<span className="fnext">{nextStop ? ` · next is ${nextStop.name}` : ''}</span>
                </span>
                {ic('chev', 'sm')}
              </button>
              <span className="rule" aria-hidden="true" />
              <a href={`https://maps.google.com/?q=${encodeURIComponent(cur.name + ' ' + cur.city + ' CA')}`} target="_blank" rel="noopener">
                <span className="t">Directions</span>
                {ic('out', 'sm')}
              </a>
            </div>
          </section>
        );
      })()
    : gCell(
        's-7',
        'Route',
        'Done',
        figHtml('All done', 'every stop on today’s route is logged'),
        <span className="small quiet">Anything left over moves to tomorrow.</span>,
      );
  const need = {
    A: 0,
    B: 0,
    C: 0,
  };
  STOPS.forEach((s) =>
    s.tasks.forEach((t) => {
      if (t.kind === 'poster' && !t.done && /^(Swap|Replace)/.test(t.t)) need[t.p.design]++;
    }),
  );
  const van = {
      A: 4,
      B: 3,
      C: 2,
    },
    needN = Object.values(need).reduce((a, b) => a + b, 0);
  const vanCell = gCell(
    's-5',
    'In the van',
    `Loaded at ${route().loaded}`,
    figHtml(String(needN), `poster${needN === 1 ? '' : 's'} to put up today · ${Object.values(van).reduce((a, b) => a + b, 0)} loaded`),
    <div className="vanl">
      {Object.keys(van).map((k, __k) => (
        <div key={__k} className="van-r">
          {designThumb(k, 24)}
          <span className="van-k">
            <b>
              {'Design '}
              {k}
            </b>
            <span className="small quiet">
              {need[k]}
              {' to put up · '}
              {van[k]}
              {' loaded'}
            </span>
          </span>
          <span className="van-bar" aria-hidden="true">
            {Array.from(
              {
                length: van[k],
              },
              (_, i) => (
                <i key={i} className={i < need[k] ? 'need' : ''} />
              ),
            )}
          </span>
        </div>
      ))}
      <div className="van-r">
        <span className="van-ic">{ic('battery', 'sm')}</span>
        <span className="van-k">
          <b>Clear Point batteries</b>
          <span className="small quiet">1 for Citrus Bowl table 4 · 2 loaded</span>
        </span>
        <span className="van-bar" aria-hidden="true">
          <i className="need" />
          <i />
        </span>
      </div>
    </div>,
    <div className="c-ft">
      <div className="row van-ft">
        {mkey([
          ['var(--fg)', 'Needed today'],
          ['var(--line)', 'Spare'],
        ])}
      </div>
    </div>,
  );
  const list = (
    <div className="fstops">
      {groups.map((g, __k) => (
        <Fragment key={__k}>
          <div className="fcity">
            <span className="lbl">{g.city}</span>
            <span className="small quiet">
              {g.stops.filter(([s]) => stopDone(s)).length}
              {' of '}
              {g.stops.length}
              {' done'}
            </span>
          </div>
          {g.stops.map(([s, i], __k) => {
            const d = stopDone(s),
              isNow = s === cur;
            return (
              <div key={__k} className={`fstop${d ? ' done' : ''}${isNow ? ' now' : ''}`}>
                <span className="fno">{d ? ic('check', 'sm') : i + 1}</span>
                <span className="fstop-k">
                  <b>{s.name}</b>
                  <span className="small quiet">{s.where}</span>
                </span>
                <span className="fstop-t">
                  {s.tasks.map((t, __k) => (
                    <span key={__k} className={`ftag${t.done ? ' ok' : ''}`}>
                      {t.kind === 'poster' ? pid(t.p.n) : 'Device'}
                    </span>
                  ))}
                </span>
                <span className="fstop-e num">{d ? s.tasks[s.tasks.length - 1].done : isNow ? 'Now' : s.eta}</span>
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
  const prog = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Today’s route</span>
        <span className="hd-tools">
          {ddHtml(
            'fwho',
            [
              [route().staffKey, route().staff, ''],
              ['me', 'My route', ''],
            ],
            FS.who,
            'Route',
          )}
        </span>
      </header>
      <div className="c-fig">
        {figHtml(`${done} of ${STOPS.length}`, `stops done · about ${Math.floor(leftMins / 60)} h ${leftMins % 60} min and ${route().miles} mi left · back by ${route().backBy}`)}
      </div>
      <div className="c-body flush">
        <div className="fsegs2" role="img" aria-label={`${done} of ${STOPS.length} stops done`}>
          {segs}
        </div>
        {list}
      </div>
      <div />
    </section>
  );
  return (
    <>
      {G(
        'This stop',
        `${route().staff} is on route · started ${route().started}`,
        '',
        <>
          {now}
          {vanCell}
        </>,
      )}
      {G('Route', '', '', prog)}
    </>
  );
}
export function fToday() {
  const log = [];
  STOPS.forEach((s) =>
    s.tasks.forEach((t) => {
      if (t.done)
        log.push({
          s,
          t,
        });
    }),
  );
  log.sort((a, b) => b.t.done.localeCompare(a.t.done));
  const cnt = (k) => log.filter((l) => l.t.out === k).length;
  const photos = log.filter((l) => l.t.photo).length;
  const devN = log.filter((l) => l.t.kind === 'device').length,
    tot = Math.max(1, log.length);
  const stat = (cls, icon, k, n, sub) => (
    <div className={`txs ostat${n ? '' : ' zero'}`}>
      <span className="os-h">
        <span className="lbl">{k}</span>
      </span>
      <span className="os-v">
        <span className={`os-ic ${cls}`}>{ic(icon)}</span>
        <b className="os-n num">{n}</b>
      </span>
      <span className="os-s small quiet">{sub}</span>
      <span className={`os-bar ${cls}`}>
        <i style={css(`width:${(n / tot) * 100}%`)} />
      </span>
    </div>
  );
  const strip = (
    <>
      {Object.keys(OUT).map((k) => stat(OUT[k][0], OUT[k][1], k, cnt(k), OUT[k][3]))}
      {stat('plain', 'merchants', 'Devices', devN, 'Fixed')}
    </>
  );
  const row = (l) => {
    const o = l.t.kind === 'poster' ? OUT[l.t.out] : ['settled', 'check'];
    return (
      <li className="lg">
        <span className="lg-t num">{l.t.done}</span>
        <span className={`out-ic sm ${o[0]}`}>{ic(o[1], 'sm')}</span>
        <span className="lg-k">
          <b>
            {l.t.kind === 'poster' ? (
              <>
                {l.t.out} <span className="mono">{pid(l.t.p.n)}</span>
              </>
            ) : (
              'Fixed the device'
            )}
          </b>
          <span className="small quiet">
            {l.s.name}
            {l.t.noteIn ? ' · ' + l.t.noteIn : ''}
          </span>
        </span>
        <span className="lg-o">{l.t.kind === 'poster' ? OUT[l.t.out][3] : 'Back online'}</span>
        <span className="lg-d">
          {l.t.kind === 'poster' ? (
            <>
              {designThumb(l.t.p.design, 18)}
              <span>
                {'Design '}
                {l.t.p.design}
                <span className="small quiet">
                  {' · '}
                  {DESIGNS[l.t.p.design].name}
                </span>
              </span>
            </>
          ) : (
            <>
              {ic('merchants', 'sm')}
              <span>Counter device</span>
            </>
          )}
        </span>
        <span className="lg-ph">
          {l.t.photo ? (
            <span className="ph-th" title="Photo attached">
              {l.t.kind === 'poster' ? designThumb(l.t.p.design, 22) : ic('field', 'sm')}
            </span>
          ) : (
            <span className="ph-th none" title="No photo">
              —
            </span>
          )}
        </span>
      </li>
    );
  };
  const head = (
    <li className="lg lg-h">
      <span>Time</span>
      <span />
      <span>What</span>
      <span>Found</span>
      <span>Poster</span>
      <span>Photo</span>
    </li>
  );
  const cell = (
    <section className="cell s-12">
      <header className="c-hd">
        <span className="lbl">Logged today</span>
        <span className="tag">{route().staff} · since {route().started}</span>
      </header>
      <div className="c-fig">
        {figHtml(String(log.length), log.length ? `things logged · ${photos} with a photo · last at ${log[0].t.done}` : 'nothing logged yet')}
      </div>
      <div className="c-body flush txwrap">
        <div className="txstrip ostrip">{strip}</div>
        {log.length ? (
          <ol className="lglist">
            {head}
            {log.map(row)}
          </ol>
        ) : (
          <div className="z-empty">
            <span className="small quiet">Scans show up here as they happen.</span>
          </div>
        )}
      </div>
      <div className="c-ft">
        <button type="button" data-go="records">
          <span className="t">Audit log</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    </section>
  );
  return G('Today', '', '', cell);
}
export function fLater() {
  const rows = LATER.map(([n, c, , st, pn, what, todo, when, det, last], __k) => (
    <div key={__k} className="wv-r">
      <span className={`out-ic sm ${st === 'missing' ? 'absent' : 'underway'}`}>{ic(st === 'missing' ? 'close' : 'alert', 'sm')}</span>
      <span className="wv-k">
        <b>{n}</b>
        <span className="small quiet">
          {c}
          {' · last visit '}
          {last}
        </span>
      </span>
      <span className="wv-i">
        <b>
          <span className="mono">{pn}</span>
          {' · '}
          {what}
        </b>
        <span className="small quiet">{todo}</span>
      </span>
      <span className="wv-w">
        <span className="lbl">When</span>
        <b className={when === 'Overdue' ? 'late' : ''}>{when}</b>
      </span>
      <span className="wv-w">
        <span className="lbl">Detour</span>
        <b className="num">{det}</b>
      </span>
      <button className="btn btn-g btn-s" type="button" data-fadd={n}>
        Add to route
      </button>
    </div>
  ));
  const mins = LATER.reduce((a, l) => a + parseInt(l[8].replace(/\D/g, ''), 10), 0);
  const fig = LATER.length
    ? figHtml(
        String(LATER.length),
        `${LATER.length === 1 ? 'shop needs' : 'shops need'} a visit · ${LATER.filter((l) => l[3] === 'missing').length} poster missing, ${LATER.filter((l) => l[3] !== 'missing').length} faded`,
      )
    : figHtml('0', 'shops waiting · every shop that needs a visit is on the route');
  const foot =
    LATER.length > 1 ? (
      <div className="c-ft split">
        <div className="row">
          <span className="t">
            {'Both add about '}
            {mins}
            {' min to today’s route'}
          </span>
        </div>
        <span className="rule" aria-hidden="true" />
        <button type="button" data-fadd-all="">
          <span className="t">Add both to the route</span>
          {ic('chev', 'sm')}
        </button>
      </div>
    ) : (
      <div className="c-ft">
        <div className="row">
          <span className="t">{LATER.length ? 'Adds about ' + mins + ' min to today’s route' : 'Shops land here when a check finds a problem'}</span>
        </div>
      </div>
    );
  return G(
    'Not on today’s route',
    '',
    '',
    gCell('s-12', 'Waiting for a visit', 'Found on earlier checks', fig, LATER.length ? <div className="wv">{rows}</div> : '', foot),
  );
}

/* ── Scan sheet: viewfinder, then what you found, then save. Actions live in the sheet's footer. ── */
export function fieldSheet() {
  if (FS.scan == null) return '';
  const p = FS.scan === 'pick' ? null : POSTERS.find((x) => x.n === FS.scan);
  const task =
    p &&
    STOPS.flatMap((s) =>
      s.tasks.map((t) => ({
        s,
        t,
      })),
    ).find((x) => x.t.p && x.t.p.n === p.n);
  let body, foot;
  if (!p) {
    const cur = curStop(),
      sug = cur ? cur.tasks.filter((t) => t.kind === 'poster' && !t.done) : [];
    body = (
      <>
        <div className="vf" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <span>Point at the code on the poster</span>
        </div>
        <p className="small quiet" style={css('margin:0')}>
          The app uses the camera here. In this prototype, pick a code below.
        </p>
        <div>
          <span className="lbl">At this stop</span>
          <div className="codes">
            {(sug.length
              ? sug
              : [
                  {
                    p: POSTERS.find((x) => x.n === 44),
                  },
                ]
            ).map((t, __k) => (
              <button key={__k} type="button" className="code" data-fpick={t.p.n}>
                {designThumb(t.p.design, 20)}
                <span className="mono">{pid(t.p.n)}</span>
                <span className="small quiet">{t.p.shop}</span>
                {ic('chev', 'sm')}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="lbl">Or type the code</span>
          <div className="codein">
            <input id="f-code" type="text" inputMode="numeric" placeholder="P-027" autoComplete="off" aria-label="Poster code" />
            <button className="btn btn-g" type="button" data-fcode="">
              Look it up
            </button>
          </div>
        </div>
      </>
    );
    foot = <span className="small quiet">Every scan is logged with time and place</span>;
  } else {
    const sel = FS.outcome || (task && /^(Swap|Replace)/.test(task.t.t) ? 'Replaced' : 'Checked');
    FS.outcome = sel;
    body = (
      <>
        <div className="pp-top">
          {designThumb(p.design, 48)}
          <div>
            <span className="lbl">
              {pid(p.n)}
              {' · design '}
              {p.design}
            </span>
            <p className="h2" style={css('font-size:24px;margin-top:6px')}>
              {p.shop}
            </p>
            <p className="quiet small" style={css('margin:4px 0 0')}>
              {'Hung '}
              {fmtD(p.hung)}
              {' · '}
              {int(p.scans)}
              {' scans in 30 days'}
            </p>
          </div>
        </div>
        {task ? (
          <div className="note">
            {ic('field', 'sm')}
            <span>
              <b>On today’s route.</b> {task.t.t}
              {task.t.note ? ', ' + task.t.note.toLowerCase() : ''}.
            </span>
          </div>
        ) : (
          ''
        )}
        <div>
          <span className="lbl">What did you find?</span>
          <div className="ogrid">
            {Object.keys(OUT).map((k, __k) => (
              <button key={__k} type="button" className={`ob${sel === k ? ' on' : ''}`} data-fout={k} aria-pressed={sel === k}>
                <span className={`out-ic ${OUT[k][0]}`}>{ic(OUT[k][1], 'sm')}</span>
                <b>{k}</b>
                <span className="small quiet">{OUT[k][2]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="frow2">
          <div className="field">
            <span className="lbl">Photo</span>
            <label className="fphoto" htmlFor="f-photo">
              {ic('field', 'sm')}
              <span id="f-photo-l">Take a photo</span>
            </label>
            <input id="f-photo" type="file" accept="image/*" capture="environment" hidden />
          </div>
          <label className="field" style={css('flex:1')}>
            <span className="lbl">Note</span>
            <input id="f-note" type="text" placeholder="Optional" autoComplete="off" />
          </label>
        </div>
        {sel === 'Replaced' ? (
          <div className="rows ledger">
            <div className="r">
              <span className="k">New poster</span>
              <span className="v">
                {'Design '}
                {p.design}, same code
              </span>
            </div>
            <div className="r total">
              <span className="k">Next swap</span>
              <span className="v">{fmtD(TODAY + 60 * DAY)}</span>
            </div>
          </div>
        ) : sel === 'Missing' ? (
          <div className="rows ledger">
            <div className="r total">
              <span className="k">Next</span>
              <span className="v">A new poster goes on tomorrow’s route</span>
            </div>
          </div>
        ) : sel === 'Damaged' ? (
          <div className="rows ledger">
            <div className="r total">
              <span className="k">Next</span>
              <span className="v">A swap goes on tomorrow’s route</span>
            </div>
          </div>
        ) : (
          ''
        )}
      </>
    );
    foot = (
      <>
        <button className="btn btn-g" type="button" data-fback="">
          Scan another
        </button>
        <button className="btn btn-p" type="button" data-fsave={p.n}>
          {'Save '}
          {sel.toLowerCase()}
        </button>
      </>
    );
  }
  return (
    <div className="scrim" data-fclose="">
      <div className="modal fsheet" role="dialog" aria-modal="true" aria-labelledby="mt">
        <header className="m-hd">
          <span className="sub" id="mt">
            {p ? 'Log a poster' : 'Scan a poster'}
          </span>
          <button className="x" type="button" data-fclose="" aria-label="Close">
            {ic('close')}
          </button>
        </header>
        <div className="m-mn">{body}</div>
        <footer className="m-ft fs-ft">{foot}</footer>
      </div>
    </div>
  );
}
export function fSave(n) {
  const p = POSTERS.find((x) => x.n === n),
    out = FS.outcome,
    note = (document.getElementById('f-note') || {}).value || '';
  const photo = !!(document.getElementById('f-photo') || {}).files?.length;
  const task = STOPS.flatMap((s) => s.tasks).find((t) => t.p && t.p.n === n);
  const steps =
    out === 'Replaced'
      ? ['Retired the old poster', 'Kept the same code: useclear.org/s/' + slug(p.shop), 'Set the next swap for ' + fmtD(TODAY + 60 * DAY)]
      : out === 'Missing'
        ? ['Marked ' + pid(n) + ' missing', 'Took it off the scan counts', 'Added a new poster to tomorrow’s route']
        : out === 'Damaged'
          ? ['Marked ' + pid(n) + ' damaged', 'Added a swap to tomorrow’s route']
          : ['Logged a check on ' + pid(n)];
  stepFlow('Saving', steps, [`${out}.`, `${pid(n)} at ${p.shop} is logged.`], () => {
    if (task) {
      task.done = '10:3' + (4 + Math.floor(Math.random() * 5));
      task.out = out;
      task.photo = photo;
      task.noteIn = note;
    }
    if (out === 'Replaced') {
      p.status = 'up';
      p.hung = TODAY;
      p.swap = TODAY + 60 * DAY;
    } else if (out === 'Missing') p.status = 'missing';
    else if (out === 'Damaged') p.status = 'faded';
    p.checked = TODAY;
  });
}

/* ══ Money ══════════════════════════════════════════════════════════════
   Read-only. Each tab answers one question. Two checks stay apart on purpose: RTD is the gate
   (AssurancePool over unsecured credit); claims-in-order is a reporting view and is never summed.
   Ties: $12,839.25 owed to shops by 4 Nov, $1,482.36 due from members, payout pool $10,240.00,
   so the pool runs $1,116.89 short on 4 Nov. PayoutPool.drawForDueClaim then borrows the gap: the yield pool's free cash first,
   then AssurancePool excess (never its primary reserve). Repaid from member repayments, principal then carry. */

/** The day's route: the API's in the live app, the prototype's in the preview. */
export function route() {
  return LIVE && vars.ROUTE ? vars.ROUTE : SEED_ROUTE;
}
