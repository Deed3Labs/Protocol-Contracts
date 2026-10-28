// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { LIVE, REAL } from '../live/env';
import { liveSignOut } from '../live/account';
import { attrs, css, html } from '../runtime/dom';
import { P, S, SG, TH_IC, TS, vars } from './data';
import { stepFlow } from './kit';
import { pageModFor } from './pageHost';
import { modalShell, onKey, render } from './shell';
import { showLogin } from './signin';
export function ic(n, cls = '') {
  return (
    <svg className={`i ${cls}`} viewBox="0 0 20 20" aria-hidden="true">
      {P[n]}
    </svg>
  );
}
/* ── Demo data. Every total below adds up. ───────────────── */
export function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647), (s - 1) / 2147483646);
}
export function series(n, total, shape, seed) {
  const r = rng(seed);
  const w = [];
  for (let i = 0; i < n; i++) w.push(shape(i) * (0.85 + 0.3 * r()));
  const sw = w.reduce((a, b) => a + b, 0);
  const v = w.map((x) => Math.round((x / sw) * total));
  v[n - 1] += total - v.reduce((a, b) => a + b, 0);
  return v;
}
export function $(s) {
  return document.querySelector(s);
}
export function money(n) {
  return (
    '$' +
    n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
export function int(n) {
  return n.toLocaleString('en-US');
}
export function pct(a, b) {
  return ((a / b) * 100).toFixed(1) + '%';
}
export function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
      })[c],
  );
}
export function sysDark() {
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (e) {
    return false;
  }
}
export function setTheme(t) {
  vars.themePref = t;
  document.documentElement.setAttribute('data-theme', t === 'auto' ? (sysDark() ? 'dark' : 'light') : t);
  try {
    localStorage.setItem('cc-theme', t);
  } catch (e) {}
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeSet === t)));
}
export function themeSwitch() {
  return (
    <div className="tsw" role="radiogroup" aria-label="Theme">
      {[
        ['light', 'Paper'],
        ['dark', 'Ink'],
        ['auto', 'System'],
      ].map(([v, n], __k) => (
        <button key={__k} type="button" role="radio" data-theme-set={v} aria-checked={vars.themePref === v}>
          <svg className="i sm" viewBox="0 0 20 20" aria-hidden="true">
            {TH_IC[v]}
          </svg>
          <span>{n}</span>
        </button>
      ))}
    </div>
  );
}
export function setRail(v) {
  document.documentElement.dataset.rail = v;
  try {
    localStorage.setItem('cc-rail', v);
  } catch (e) {}
  document.querySelectorAll('.sw-tg[data-rail-tog]').forEach((x) => x.setAttribute('aria-checked', String(v === 'min')));
  const b = document.querySelector('.rail-tog');
  if (!b) return;
  b.setAttribute('aria-expanded', String(v !== 'min'));
  b.title = v === 'min' ? 'Expand the menu ( [ )' : 'Collapse the menu ( [ )';
  b.querySelector('span').textContent = v === 'min' ? 'Expand' : 'Collapse';
}
/* ── Profile panel: who you are, theme, menu, shortcuts ── */
export function openPf() {
  const btn = document.querySelector('[data-pf-open]');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  const rail = document.documentElement.dataset.rail === 'min',
    mem = S.view && !S.view.preview,
    nm = mem ? S.view.who : LIVE ? SG.name : 'Kai';
  html(
    $('#pfRoot'),
    <>
      <div className="pm-scrim" data-pf-close="" />
      <div className="pm" role="dialog" aria-label="Profile and settings">
        <div className="pm-hd">
          <span className="av pm-av" aria-hidden="true">
            {mem || LIVE ? nm.slice(0, 2).toUpperCase() : 'KK'}
          </span>
          <div className="pm-who">
            <b>{nm}</b>
            <span>{LIVE && vars.me ? `${vars.me.group?.name ?? 'Member'}${mem ? ' · read-only' : ''}${vars.me.title ? ` · ${vars.me.title}` : ''}` : mem ? 'Member · read-only' : 'Admin · Founder'}</span>
          </div>
          <span className="chip settled pm-pk">{mem ? 'Clear app login' : 'Passkey'}</span>
        </div>
        <div className="pm-s">
          <span className="lbl">Theme</span>
          {themeSwitch()}
        </div>
        <div className="pm-s pm-row pm-rail">
          <span>
            <b>Compact side menu</b>
            <span className="small quiet">Icons only · press [</span>
          </span>
          <button type="button" className="sw-tg" role="switch" data-rail-tog="" aria-checked={rail} aria-label="Compact side menu" />
        </div>
        <div className="pm-list">
          <button type="button" data-pfa="access">
            <svg className="i sm" viewBox="0 0 20 20" aria-hidden="true">
              <rect x="4" y="9" width="12" height="8" />
              <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
            </svg>
            <span>
              <b>Your access and devices</b>
              <span className="small quiet">{LIVE && vars.me ? `${vars.me.group?.name ?? 'Members'} · this device` : mem ? 'Members group · this device' : 'Admin everywhere · 2 devices'}</span>
            </span>
          </button>
          <button type="button" data-pfa="keys">
            <svg className="i sm" viewBox="0 0 20 20" aria-hidden="true">
              <rect x="2.5" y="5" width="15" height="10" />
              <path d="M5.5 8h1M9 8h2M13.5 8h1M6 12h8" />
            </svg>
            <span>
              <b>Keyboard shortcuts</b>
              <span className="small quiet">Search, menu, close</span>
            </span>
          </button>
          <button type="button" data-pfa="signout">
            <svg className="i sm" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M8 4H4v12h4M12 6.5 15.5 10 12 13.5M15.5 10H8" />
            </svg>
            <span>
              <b>Sign out</b>
              <span className="small quiet">On this device</span>
            </span>
          </button>
        </div>
        <div className="pm-ft">
          <span className="dot" aria-hidden="true" />
          {REAL ? 'Testnet · no keys in this app' : 'Testnet · demo data · no keys in this app'}
        </div>
      </div>
    </>,
  );
  const f = document.querySelector('.pm [aria-checked="true"]');
  if (f) f.focus();
}
export function closePf() {
  html($('#pfRoot'), '');
  const b = document.querySelector('[data-pf-open]');
  if (b) {
    b.setAttribute('aria-expanded', 'false');
  }
}
export function pfAct(k) {
  closePf();
  if (k === 'access') {
    // the redesigned Team opens on People with your own panel, as the reference's ADMIN2.open does
    const m = pageModFor('team');
    if (m) {
      m.open('team', 'people', 'p:K');
      window.scrollTo({
        top: 0,
      });
      return;
    }
    if (typeof TS !== 'undefined') {
      TS.pane = 'people';
      TS.person = LIVE ? vars.meId : 'K';
    }
    S.route = 'team';
    render();
    window.scrollTo({
      top: 0,
    });
    return;
  }
  vars.lastFocus = document.querySelector('[data-pf-open]');
  if (k === 'keys') {
    modalShell(
      'Keyboard shortcuts',
      <>
        <div className="rows ledger">
          {[
            ['Search', '/'],
            ['Compact side menu', '['],
            ['Close a panel or window', 'Esc'],
            ['Move in a dropdown', '↑ ↓'],
            ['Choose', 'Enter'],
          ].map(([a, b], __k) => (
            <div key={__k} className="r">
              <span className="k">{a}</span>
              <span className="v">
                <kbd className="kb">{b}</kbd>
              </span>
            </div>
          ))}
        </div>
        <div className="acts">
          <button className="btn btn-g" type="button" data-close="">
            Close
          </button>
        </div>
      </>,
      'Shortcuts work anywhere outside a text field',
    );
    document.addEventListener('keydown', onKey);
    return;
  }
  if (k === 'signout') {
    modalShell(
      'Sign out',
      <>
        <div>
          <span className="lbl">This device</span>
          <p className="h2" style={css('margin-top:8px')}>
            Sign out of the Command Center?
          </p>
          <p className="quiet" style={css('margin:8px 0 0')}>
            You sign back in with your passkey. Nothing you started is lost.
          </p>
        </div>
        <div className="acts">
          <button className="btn btn-p" type="button" data-pfa="signout-go">
            Sign out
          </button>
          <button className="btn btn-g" type="button" data-close="">
            Not now
          </button>
        </div>
      </>,
      'Every sign-in is logged',
    );
    document.addEventListener('keydown', onKey);
    return;
  }
  if (k === 'signout-go') {
    modalShell('Sign out', '', 'Every sign-in is logged');
    if (LIVE) return void liveSignOut().then(() => stepFlow('Signing out', ['Ended this session', 'Logged it'], ['Signed out.', ''], () => setTimeout(showLogin, 500)));
    return stepFlow('Signing out', ['Ended this session', 'Logged it'], ['Signed out.', ''], () => setTimeout(showLogin, 500));
  }
}
/* ── Building blocks ─────────────────────────────────────── */
export function cell({ span = 's-12', label, tag = '', fig = '', main = '', foot, state = '', cls = '' }) {
  let ft = '';
  if (foot && foot.length === 2) {
    ft = (
      <div className="c-ft split">
        {footItem(foot[0])}
        <span className="rule" aria-hidden="true" />
        {footItem(foot[1])}
      </div>
    );
  } else if (foot && foot.length === 1) {
    ft = <div className="c-ft">{footItem(foot[0])}</div>;
  }
  return (
    <section className={`cell ${span} ${cls}`} {...attrs(state ? `data-state="${state}"` : '')}>
      <header className="c-hd">
        <span className="lbl">{label}</span>
        {tag ? <span className="tag">{tag}</span> : ''}
      </header>
      <div className="c-fig">{fig}</div>
      <div className="c-body">{main}</div>
      {ft || <div />}
    </section>
  );
}
export function footItem(f) {
  if (f.go || f.open)
    return (
      <button type="button" {...attrs(f.go ? `data-go="${f.go}"` : '')} {...attrs(f.open ? `data-open="${f.open}"` : '')}>
        <span className="t">{f.t}</span>
        {ic('chev', 'sm')}
      </button>
    );
  return (
    <div className="row">
      <span className="t">{f.t}</span>
    </div>
  );
}
export function ringBig(p, label) {
  const r = 52,
    c = 2 * Math.PI * r;
  return (
    <div className="ringbig">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="tr" cx="60" cy="60" r={r} />
        <circle className="ar" cx="60" cy="60" r={r} strokeDasharray={`${(c * p).toFixed(2)} ${c.toFixed(2)}`} />
      </svg>
      <div>
        <span className="fig fig-l">{(p * 100).toFixed(1)}%</span>
        <span className="figsub">{label}</span>
      </div>
    </div>
  );
}
export function compBar(parts) {
  // parts: [name, value, colour]
  const tot = parts.reduce((a, p) => a + p[1], 0);
  return (
    <>
      <div className="comp" role="img" aria-label={parts.map((p) => p[0] + ' ' + p[1]).join(', ')}>
        {parts.map((p, __k) => (
          <span key={__k} style={css(`flex:${p[1]};background:${p[2]}`)} />
        ))}
      </div>
      <div className="legend">
        {parts.map((p, __k) => (
          <span key={__k}>
            <i className="sw" style={css(`background:${p[2]}`)} />
            <span className="k">{p[0]}</span>
            <b className="num">{p[3] || (p[1] ?? 0).toLocaleString('en-US')}</b>
          </span>
        ))}
      </div>
    </>
  );
}
export function ring(p) {
  const r = 20,
    c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 48 48" aria-hidden="true">
      <circle className="tr" cx="24" cy="24" r={r} />
      <circle className="ar" cx="24" cy="24" r={r} strokeDasharray={`${(c * p).toFixed(2)} ${c.toFixed(2)}`} />
    </svg>
  );
}

/* ── Page head ───────────────────────────────────────────── */
export function head(label, title, tools = '', line = '') {
  return (
    <header className="ph">
      <div className="ph-l">
        <span className="lbl">{label}</span>
        <h1 className="h1">{title}</h1>
        {line ? <p className="ph-line">{line}</p> : ''}
      </div>
      {tools}
    </header>
  );
}
export function segHtml(id, opts, cur, aria) {
  return (
    <div className="seg" role="group" aria-label={aria} data-seg={id}>
      {opts.map(([v, t], __k) => (
        <button key={__k} type="button" data-v={v} aria-pressed={v === cur}>
          {t}
        </button>
      ))}
    </div>
  );
}

/* ── Home ────────────────────────────────────────────────── */
