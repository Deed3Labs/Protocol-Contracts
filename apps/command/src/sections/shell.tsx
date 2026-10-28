// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { LIVE } from '../live/env';
import { loadTeam, logView } from '../live/account';
import { loadSection, needsData } from '../live/sections';
import { Fragment } from 'react';
import { attrs, css, html } from '../runtime/dom';
import { contractsPage } from './contracts';
import { $, ic } from './core';
import { FEED_FROM, FIRST, LAST, NAMES, PEOPLE_T, ROLES, S, SECTIONS, UPD_FROM, VSEC, V_PERSONAL_TABS, vars } from './data';
import { fieldPage } from './field';
import { governancePage } from './governance';
import { growthPage } from './growth';
import { morePage, placeholder, stateError, stateLoading, syncPages, waitingPage } from './home';
import { ibxCount } from './inbox';
import { homeHub, homeMount } from './homeHub';
import { mountPages, pageSlot } from './pageHost';
import './growth2';
import './members2';
import './money2';
import './build2';
import './governance2';
import './shop2';
import { membersPage } from './members';
import { corridorMount, merchantsPage } from './merchants';
import { moneyPage } from './money';
import { recordsPage } from './records';
import { shopPage } from './shop';
import { teamPage } from './team';

/* ── Render ──────────────────────────────────────────────── */
export function renderNav() {
  html(
    $('#railNav'),
    SECTIONS.map((g) => ({
      ...g,
      items: g.items.filter(([id]) => vLevel(id) > 0),
    }))
      .filter((g) => g.items.length)
      .map((g, __k) => (
        <Fragment key={__k}>
          {g.group ? <div className="rail-g lbl">{g.group}</div> : ''}
          {g.items.map(([id, n], __k) => (
            <button key={__k} className="nav" type="button" data-go={id} title={n} {...attrs(S.route === id ? 'aria-current="page"' : '')}>
              {ic(id)}
              <span>{n}</span>
              {id === 'home' && ibxCount() ? (
                <span className="n" aria-label={`${ibxCount()} need you`}>
                  {ibxCount()}
                </span>
              ) : (
                ''
              )}
            </button>
          ))}
        </Fragment>
      )),
  );
  const tabs = [
    ['home', 'Home'],
    ['waiting', 'Inbox'],
    ['field', 'Field'],
    ['more', 'More'],
  ].filter(([id]) => vLevel(id) > 0);
  const inMore = !['home', 'waiting', 'field'].includes(S.route);
  html(
    $('#tabs'),
    tabs.map(([id, n], __k) => (
      <button key={__k} className="tab" type="button" data-go={id} {...attrs(S.route === id || (id === 'more' && inMore) ? 'aria-current="page"' : '')}>
        {ic(id)}
        <span>{n}</span>
        {id === 'waiting' && ibxCount() ? <span className="badge">{ibxCount()}</span> : ''}
      </button>
    )),
  ); // the top bar's inbox: what needs you and the high alerts
  const ib = $('#ibxBtn');
  if (ib) {
    const n = ibxCount();
    ib.setAttribute('aria-label', n ? `Inbox, ${n} need you` : 'Inbox');
    const c = ib.querySelector('.ibx-n');
    c.textContent = String(n);
    c.hidden = !n;
  }
}
/* ── views: what a group sees. S.view is set when a member signs in, or when an admin previews a group ── */
export function vLevel(r) {
  if (!S.view || typeof ROLES === 'undefined') return 4;
  const a = S.view.levels || ROLES[S.view.g][2];
  if (r === 'more') return 1;
  if (r === 'waiting') return Math.max(...a) >= 3 ? a[0] : 0;
  // the redesign's pages read an existing section's level: Build is Contracts', and until they get
  // their own, Community reads Governance's and Settings Team's
  const i = VSEC.indexOf(({ build: 'contracts', community: 'governance', settings: 'team' } as Record<string, string>)[r] ?? r);
  return i < 0 ? 1 : a[i];
}
export function vRO() {
  return !!S.view && Math.max(...(S.view.levels || ROLES[S.view.g][2])) < 3;
}
export function vBar() {
  if (!S.view) return '';
  const g = ROLES[S.view.g],
    lv = vLevel(S.route);
  if (!S.view.preview && !vRO()) return '';
  const what =
    lv === 1
      ? 'Co-op totals only · names and personal details stay hidden'
      : lv === 2
        ? 'Read-only on this page'
        : lv === 3
          ? 'You can propose here · someone else approves'
          : 'Full access here';
  return (
    <div className="vbar">
      <span className="vbar-k">
        <span className="dot" />
        <b>
          {S.view.preview ? 'Previewing' : 'You have'}
          {' the '}
          {g[0]}
          {' view'}
        </b>
        <span className="quiet">{what}</span>
      </span>
      {S.view.preview ? (
        <button type="button" className="vbar-x" data-viewexit="">
          Exit preview
        </button>
      ) : (
        ''
      )}
    </div>
  );
}
export function viewAs(g) {
  S.view = {
    g,
    preview: true,
  };
  const first = SECTIONS.flatMap((x) => x.items)
    .map(([id]) => id)
    .find((id) => vLevel(id) > 0);
  go(vLevel(S.route) > 0 && S.route !== 'team' ? S.route : first);
}
export function viewExit() {
  S.view = null;
  go('team');
}
export function setWho(n, role) {
  const w = document.querySelector('.who');
  if (!w) return;
  w.querySelector('.av').textContent = n
    .split(' ')
    .map((x) => x[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  html(
    w.querySelector('.who-n'),
    <>
      <b style={css('font-weight:600')}>{n}</b>{' '}
      <span className="quiet">
        {'· '}
        {role}
      </span>
    </>,
  );
}
export function toast(msg, act) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  html(
    t,
    <>
      <span>{msg}</span>
      {act ? <button type="button">{act.label}</button> : ''}
    </>,
  );
  t.classList.toggle('act', !!act);
  if (act)
    t.querySelector('button').onclick = () => {
      t.classList.remove('on');
      act.fn();
    };
  t.classList.add('on');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('on'), act ? 5000 : 2400);
}
/* in a read-only view, anything that would change something is stopped before it runs; opening and reading still work.
   Preview only: hides personal tabs and names in a Totals view, as the prototype did */
export function vScrub(root) {
  root.querySelectorAll('.ptabs button').forEach((b) => {
    if (V_PERSONAL_TABS.includes(b.textContent.trim())) b.hidden = true;
  });
  if (!vars.V_NAMES) {
    const staff = (typeof PEOPLE_T !== 'undefined' ? PEOPLE_T.map((p) => p.n) : []).join('|');
    vars.V_NAMES = {
      re: new RegExp(`\\b(${FIRST.join('|')}) (${LAST.join('|')}|[A-Z]\\.)`, 'g'),
      staff: new RegExp(`^(${staff})$`),
      mail: /[\w.+-]+@[\w-]+\.[\w.]+/g,
    };
  }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const v = n.nodeValue;
    if (!/[A-Z@]/.test(v)) continue;
    const out = v.replace(vars.V_NAMES.re, (m) => (vars.V_NAMES.staff.test(m) ? m : 'A member')).replace(vars.V_NAMES.mail, 'hidden');
    if (out !== v) n.nodeValue = out;
  }
}
/* switching tabs lands on the first item: if you'd scrolled past the title, the page stops with the tabs held under the top bar; otherwise it stays put */
export function render() {
  renderNav();
  const r = S.route;
  // the live app draws a section from the API: the prototype's loading state until it arrives
  if (needsData(r)) {
    html($('#main'), stateLoading());
    loadSection(r).then(
      () => S.route === r && render(),
      (e) => {
        html($('#main'), stateError(e));
        toast(e.message);
      },
    );
    return;
  }
  document.body.classList.toggle('ro', !!S.view && vLevel(r) < 3);
  document.body.classList.toggle('vw', vRO() && !S.view.preview);
  html(
    $('#main'),
    <>
      {vBar()}
      {pageSlot(r) ??
        (r === 'home'
          ? homeHub()
          : r === 'growth'
            ? growthPage()
            : r === 'members'
              ? membersPage()
              : r === 'merchants'
                ? merchantsPage()
                : r === 'field'
                  ? fieldPage()
                  : r === 'money'
                    ? moneyPage()
                    : r === 'build'
                      ? contractsPage()
                      : r === 'governance'
                        ? governancePage()
                        : r === 'records'
                          ? recordsPage()
                          : r === 'team'
                            ? teamPage()
                            : r === 'shop'
                              ? shopPage()
                              : r === 'waiting'
                                ? waitingPage()
                                : r === 'more'
                                  ? morePage()
                                  : placeholder(r))}
    </>,
  );
  // the preview's simulation of a Totals view, as the prototype drew it; live, the API sends Totals nothing personal
  if (!LIVE && S.view && vLevel(r) === 1) vScrub($('#main'));
  corridorMount();
  // Home's timeline is laid out for the width it gets, after it's drawn
  homeMount();
  // the redesign's page modules: this route's mounts into its slot, the others let go
  mountPages(r);
  requestAnimationFrame(syncPages);
  if (LIVE) logView();
}
export function go(r) {
  if (r === 'contracts') r = 'build';
  if (!NAMES[r]) r = 'home';
  if (vLevel(r) <= 0)
    r =
      SECTIONS.flatMap((x) => x.items)
        .map(([id]) => id)
        .find((id) => vLevel(id) > 0) || 'growth';
  S.route = r;
  // before drawing: a redesigned page adds its tab to the hash as it draws (#growth/traffic)
  try {
    history.replaceState(null, '', '#' + r);
  } catch (e) {}
  render();
  window.scrollTo({
    top: 0,
  });
}

/* ── Modal flows ─────────────────────────────────────────── */
export function closeModal() {
  html($('#modalRoot'), '');
  document.removeEventListener('keydown', onKey);
  if (vars.lastFocus) vars.lastFocus.focus();
}
export function onKey(e) {
  if (e.key === 'Escape') closeModal();
}
export function modalShell(title, body, foot) {
  html(
    $('#modalRoot'),
    <div className="scrim" data-scrim="">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mt">
        <header className="m-hd">
          <span className="sub" id="mt" />
          <button className="x" type="button" data-close="" aria-label="Close">
            {ic('close')}
          </button>
        </header>
        <div className="m-mn" />
        <footer className="m-ft" />
      </div>
    </div>,
  );
  html($('#mt'), title);
  html($('.m-mn'), body);
  html($('.m-ft'), foot);
}
export function openItem(id) {
  const w = S.waiting.find((x) => x.id === id);
  if (!w) return;
  vars.lastFocus = document.activeElement;
  const rule = w.rule ? (
    <div className="note">
      {ic('team', 'sm')}
      <span>
        <b>Two-person rule.</b> {w.rule[0]}
        {' proposed this. You approve.'}
      </span>
    </div>
  ) : (
    ''
  );
  const hand =
    w.mode === 'multisig' ? (
      <div className="note">
        {ic('out', 'sm')}
        <span>
          <b>You sign in the multisig.</b>
          {' No keys live in this app.'}
        </span>
      </div>
    ) : w.mode === 'esign' ? (
      <div className="note">
        {ic('out', 'sm')}
        <span>
          <b>You sign in your e-signature tool.</b>
          {' It comes back here marked signed.'}
        </span>
      </div>
    ) : (
      ''
    );
  const body = (
    <>
      <div>
        <span className="lbl">{w.kind}</span>
        <p className="h2" style={css('margin-top:8px')}>
          {w.title}
        </p>
      </div>
      <div className="rows ledger">
        {w.ledger.map(([k, v, t], __k) => (
          <div key={__k} className={`r${t ? ' total' : ''}`}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
      {rule}
      {hand}
      <div className="acts">
        <button className="btn btn-p" type="button" data-go-step={w.id}>
          {w.primary}
          {w.mode === 'approve' ? '' : ic('out')}
        </button>
        <button className="btn btn-g" type="button" data-close="">
          Not now
        </button>
      </div>
    </>
  );
  const foot = w.rule ? `Proposed by ${w.rule[0]}, ${w.rule[1]} · 21 Oct · Every action is logged` : 'Every action is logged';
  modalShell(
    w.kind === 'Payout'
      ? 'Approve payout'
      : w.kind === 'Invite batch'
        ? 'Send invite batch'
        : w.kind === 'Agreement'
          ? 'Sign agreement'
          : 'Sign on-chain change',
    body,
    foot,
  );
  document.addEventListener('keydown', onKey);
  $('.modal [data-go-step]').focus();
}
export function runSteps(id, checked) {
  const w = S.waiting.find((x) => x.id === id);
  if (!w) return;
  // a live item (an access change waiting on a second admin) is approved on the server first
  if (w.api && !checked) {
    const b = document.querySelector('.modal [data-go-step]');
    if (b) b.disabled = true;
    return w.api().then(
      () => runSteps(id, true),
      (e) => {
        if (b) b.disabled = false;
        toast(e.message);
      },
    );
  }
  const box = $('.m-mn');
  const t = $('#mt');
  html(t, w.mode === 'approve' ? 'Working' : 'Handing off');
  let i = 0;
  const draw = () => {
    html(
      box,
      <div className="steps" aria-live="polite">
        {w.steps.map((s, k) => (
          <div key={k} className={`step ${k < i ? 'done' : k === i ? 'now' : ''}`}>
            <span className="mk">{k < i ? ic('check') : k === i ? <span className="dot pulse" /> : <span className="sq" />}</span>
            <span>{s}</span>
          </div>
        ))}
      </div>,
    );
  };
  draw();
  const tick = setInterval(() => {
    i++;
    if (i < w.steps.length) {
      draw();
      return;
    }
    clearInterval(tick);
    html(t, w.mode === 'approve' ? 'Done' : 'Handed off');
    html(
      box,
      <>
        <div className="steps">
          {w.steps.map((s, __k) => (
            <div key={__k} className="step done">
              <span className="mk">{ic('check')}</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
        <div>
          <p className="h2">{w.done[0]}</p>
          <p className="quiet" style={css('margin:8px 0 0')}>
            {w.done[1]}
          </p>
        </div>
        <div className="acts">
          <button className="btn btn-p" type="button" data-finish={w.id}>
            Done
          </button>
        </div>
      </>,
    );
    $('[data-finish]').focus();
  }, 750);
}
export function finish(id) {
  if (id === 'payout') S.payoutDone = true;
  const w = S.waiting.find((x) => x.id === id);
  if (w)
    S.updates.unshift({
      what: FEED_FROM[id],
      by: 'You',
      when: 'Just now',
      go: UPD_FROM[id][1],
      mine: true,
    });
  S.waiting = S.waiting.filter((x) => x.id !== id);
  closeModal();
  render();
  if (LIVE && w?.live) loadTeam().then(render, () => undefined);
}

/* ── Events ──────────────────────────────────────────────── */
