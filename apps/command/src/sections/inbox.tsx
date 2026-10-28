// @ts-nocheck: reads the sections' untyped data (src/sections/data.tsx), as the other section files do.
import { css, html } from '../runtime/dom';
import { $, ic } from './core';
import { ALERTS0, NEED, S, W_ICON, vars } from './data';
import { segs } from './home';
import { onKey, render } from './shell';

/*
 * The inbox (design/command-center-ui, ibx*): needs you, alerts and updates in one place.
 *   Needs you blocks work and only you can clear it; alerts are something wrong someone should look at;
 *   updates are FYI and go quiet once read.
 * The same list sits on Home, in the top bar's pane, and as the phone's Inbox tab.
 */

/** What's in the inbox now, in the order it shows. */
export function ibxData() {
  const clear = S.preview === 'clear';
  const needs = clear ? [] : S.waiting.slice().sort((a, b) => (NEED[a.id]?.order ?? 99) - (NEED[b.id]?.order ?? 99));
  const alerts = clear ? [] : ALERTS0.slice().sort((a, b) => (a.sev === 'absent' ? 0 : 1) - (b.sev === 'absent' ? 0 : 1));
  const ups = S.updates || [];
  const unread = S.ibx.read ? ups.filter((u) => u.mine && !u.seen).length : ups.filter((u) => !u.old).length;
  return { needs, alerts, ups, unread };
}
/** The top bar's count: what needs you, and the high alerts. */
export function ibxCount() {
  const d = ibxData();
  return d.needs.length + d.alerts.filter((a) => a.sev === 'absent').length;
}

/** An alert's fix, where it has one. */
function aFix(a) {
  if (a.fix === 'resync') {
    // bank links refreshed so far, of all of them
    const [done, of] = a.progress || [0, 0];
    return (
      <span className="afix">
        <span className="small quiet">{`Re-syncing ${done}/${of}`}</span>
        {segs([of, done, 0])}
      </span>
    );
  }
  if (a.fix === 'route')
    return (
      <button className="btn btn-g btn-s" type="button" data-go="field" data-fp="today">
        See the route
      </button>
    );
  return (
    <button className="btn btn-g btn-s" type="button" data-go="merchants" data-fp="overview">
      Open caps
    </button>
  );
}

export function ibxRow(kind, x, k) {
  if (kind === 'need') {
    const n = NEED[x.id] ?? { meta: '', fig: '', verb: 'Open' };
    return (
      <div key={k} className={`ib-r need${x.urgent ? ' urgent' : ''}`}>
        <i className="ib-m" aria-hidden="true" />
        <span className="ib-ic">{ic(W_ICON[x.id])}</span>
        <div className="ib-t">
          <b>{x.title}</b>
          <span>
            {n.meta}
            {x.urgent ? (
              <>
                {' · '}
                <em>{x.tag}</em>
              </>
            ) : (
              ''
            )}
          </span>
        </div>
        <span className="ib-fig fig">{n.fig}</span>
        <button className="btn btn-g btn-s ib-a" type="button" data-open={x.id}>
          {n.verb}
          {x.mode === 'approve' ? '' : ic('out')}
        </button>
      </div>
    );
  }
  if (kind === 'alert')
    return (
      <div key={k} className={`ib-r alert ${x.sev}`}>
        <i className="ib-m" aria-hidden="true" />
        <span className="ib-ic">{ic('alert')}</span>
        <button className="ib-t" type="button" data-go={x.go}>
          <b>{x.t}</b>
          <span>
            {x.sev === 'absent' ? (
              <>
                <em>High</em>
                {' · '}
              </>
            ) : (
              ''
            )}
            {x.area}
            {' · '}
            {x.age}
          </span>
        </button>
        <span className="ib-fig" />
        <span className="ib-a">{aFix(x)}</span>
      </div>
    );
  const isNew = S.ibx.read ? x.mine && !x.seen : !x.old;
  return (
    <button key={k} className={`ib-r up${isNew ? ' new' : ''}`} type="button" data-go={x.go}>
      <i className="ib-m" aria-hidden="true" />
      <span className="ib-ic">{ic(x.go)}</span>
      <span className="ib-t">
        <b>{x.what}</b>
        <span>
          {x.by}
          {' · '}
          {x.when}
        </span>
      </span>
      <span className="ib-fig" />
      <span className="ib-a ib-go">
        {isNew ? <span className="ib-dot" aria-label="New" /> : ''}
        {ic('chev', 'sm')}
      </span>
    </button>
  );
}

/** The filter bar and the list. Without updates (Home has its own column for them), it's needs you and alerts only. */
export function ibxList(withUps = true) {
  const { needs, alerts, ups, unread } = ibxData();
  const f = !withUps && S.ibx.f === 'updates' ? 'all' : S.ibx.f,
    all = f === 'all',
    CAP = withUps ? 3 : 99;
  const tabs = [
    ['all', 'All', needs.length + alerts.length + (withUps ? unread : 0)],
    ['needs', 'Needs you', needs.length],
    ['alerts', 'Alerts', alerts.length],
    ...(withUps ? [['updates', 'Updates', unread]] : []),
  ];
  const bar = (
    <div className="ib-f" role="tablist" aria-label="Inbox filter">
      {tabs.map(([k, t, n]) => (
        <button key={k} type="button" role="tab" data-ibxf={k} aria-selected={String(f === k)}>
          {t}
          {n ? <span className={`ib-n${k === 'needs' || (k === 'all' && needs.length) ? ' hot' : ''}`}>{n}</span> : ''}
        </button>
      ))}
    </div>
  );
  const sec = (k, label, aside, rows, total) => (
    <div className="ib-sec">
      <div className="ib-sh">
        <span className="lbl">{label}</span>
        {aside}
      </div>
      {rows}
      {all && total > CAP && k !== 'needs' ? (
        <button className="ib-more" type="button" data-ibxf={k}>
          {`Show all ${total} ${label.toLowerCase()}`}
          {ic('chev', 'sm')}
        </button>
      ) : (
        ''
      )}
    </div>
  );
  const empty = (t) => (
    <div className="ib-empty">
      <span className="dot" style={css('color:var(--settled)')} />
      {t}
    </div>
  );
  const nS = needs.length
    ? sec(
        'needs',
        'Needs you',
        <span className="small quiet">
          {needs.filter((w) => w.mode === 'approve').length} to approve · {needs.filter((w) => w.mode !== 'approve').length} to sign
        </span>,
        needs.map((w, i) => ibxRow('need', w, i)),
        needs.length,
      )
    : f === 'needs'
      ? empty('Nothing needs you. Approvals and signatures land here first.')
      : '';
  const aS = alerts.length
    ? sec(
        'alerts',
        'Alerts',
        <span className="small quiet">{alerts.filter((a) => a.sev === 'absent').length} high</span>,
        (all ? alerts.slice(0, CAP) : alerts).map((a, i) => ibxRow('alert', a, i)),
        alerts.length,
      )
    : f === 'alerts'
      ? empty('No alerts. Every feed is synced.')
      : '';
  const uS = ups.length
    ? sec(
        'updates',
        'Updates',
        unread ? (
          <button className="ib-read" type="button" data-ibx-read="">
            Mark {unread} read
          </button>
        ) : (
          <span className="small quiet">All read</span>
        ),
        (all ? ups.slice(0, CAP) : ups).map((u, i) => ibxRow('up', u, i)),
        ups.length,
      )
    : '';
  const body =
    f === 'needs' ? (
      nS
    ) : f === 'alerts' ? (
      aS
    ) : f === 'updates' ? (
      uS
    ) : (
      <>
        {needs.length || alerts.length ? '' : empty('All clear. Nothing needs you and nothing is wrong.')}
        {nS}
        {aS}
        {withUps ? uS : ''}
      </>
    );
  return (
    <>
      {bar}
      <div className="ib-list">{body}</div>
    </>
  );
}

/** The top bar's pane: the inbox, with a way to the full one. */
export function ibxPaneDraw() {
  const inner = (
    <>
      <header className="m-hd">
        <span className="sub">Inbox</span>
        <button className="x" type="button" data-close="" aria-label="Close">
          {ic('close')}
        </button>
      </header>
      <div className="pane-mn ib-pane">{ibxList()}</div>
      <footer className="pane-ft">
        <button className="btn btn-g" type="button" data-go="waiting">
          Open full inbox
        </button>
      </footer>
    </>
  );
  const pane = document.querySelector('.pane.ibx');
  if (pane) return html(pane, inner);
  vars.lastFocus = document.activeElement;
  html(
    $('#modalRoot'),
    <>
      <div className="pane-scrim" data-close="" />
      <aside className="pane ibx" role="dialog" aria-label="Inbox">
        {inner}
      </aside>
    </>,
  );
  document.addEventListener('keydown', onKey);
  setTimeout(() => (document.querySelector('.pane.ibx .x') as HTMLElement | null)?.focus(), 0);
}
/** Draws the page again, and the pane if it's open. */
export function ibxRefresh() {
  render();
  if (document.querySelector('.pane.ibx')) ibxPaneDraw();
}
