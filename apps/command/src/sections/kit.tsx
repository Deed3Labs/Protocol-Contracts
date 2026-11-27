// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { css, html } from '../runtime/dom';
import { $, ic } from './core';
import { costPick } from './costing';
import { CS, FS, GS, MS, NS, RS, SS, VS, XS } from './data';
import { render } from './shell';

/* ── Dropdown: a listbox, never the system menu. Arrows move, Enter chooses, Escape closes. ── */
export function ddHtml(id, opts, cur, aria) {
  const sel = opts.find((o) => o[0] === cur) || opts[0];
  return (
    <div className="dd" data-dd={id}>
      <button className="dd-btn" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label={`${aria}: ${sel[1]}`}>
        <span>{sel[1]}</span>
        <b>{sel[2]}</b>
        {ic('chevd', 'sm')}
      </button>
      <ul className="dd-list" role="listbox" aria-label={aria} hidden>
        {opts.map(([v, t, c], __k) => (
          <li key={__k} role="option" tabIndex="-1" data-ddv={v} aria-selected={v === cur}>
            <span className="dd-ck">{v === cur ? ic('check', 'sm') : ''}</span>
            <span>{t}</span>
            <b>{c}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function ddClose() {
  document.querySelectorAll('.dd-list:not([hidden])').forEach((l) => {
    l.hidden = true;
    l.previousElementSibling.setAttribute('aria-expanded', 'false');
  });
}
export function ddOpen(dd) {
  ddClose();
  const l = dd.querySelector('.dd-list');
  l.hidden = false;
  dd.querySelector('.dd-btn').setAttribute('aria-expanded', 'true');
  (l.querySelector('[aria-selected="true"]') || l.firstElementChild).focus();
}
export function ddPick(dd, v) {
  const id = dd.dataset.dd;
  // a dropdown inside a costing flow (Phase 10b) redraws its flow, not the page
  if (id.startsWith('cf-')) return costPick(id, v);
  if (id === 'pf') {
    GS.pf = v;
    GS.pg = 0;
  }
  if (id === 'ft') GS.ft = v;
  if (id === 'mf') {
    MS.mf = v;
    MS.pg = 0;
  }
  if (id === 'mord') MS.order = v;
  if (id === 'xpf') XS.pf = v;
  if (id === 'xsort') XS.txsort = v;
  if (id === 'fwho') FS.who = v;
  if (id === 'nsf') NS.sf = v;
  if (id === 'caf') CS.af = v;
  if (id === 'ccb') CS.cb = v;
  if (id === 'vcal') VS.cal = v;
  if (id === 'rdf') RS.df = v;
  if (id === 'rlf') RS.lf = v;
  if (id === 'spf') SS.pf = v;
  if (id === 'sof') SS.of = v;
  if (id === 'scf') SS.cf = v;
  if (id === 'crf') CS.rf = v;
  render();
  const b = document.querySelector(`[data-dd="${id}"] .dd-btn`);
  if (b) b.focus();
}
/* ── Actions as modals ────────────────────────────────────────────────── */
export function stepFlow(title, steps, done, onDone) {
  const box = $('.m-mn');
  html($('#mt'), title);
  let i = 0;
  const draw = () =>
    html(
      box,
      <div className="steps" aria-live="polite">
        {steps.map((s, k) => (
          <div key={k} className={`step ${k < i ? 'done' : k === i ? 'now' : ''}`}>
            <span className="mk">{k < i ? ic('check') : k === i ? <span className="dot pulse" /> : <span className="sq" />}</span>
            <span>{s}</span>
          </div>
        ))}
      </div>,
    );
  draw();
  const t = setInterval(() => {
    i++;
    if (i < steps.length) return draw();
    clearInterval(t);
    onDone && onDone();
    html(
      box,
      <>
        <div className="steps">
          {steps.map((s, __k) => (
            <div key={__k} className="step done">
              <span className="mk">{ic('check')}</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
        <div>
          <p className="h2">{done[0]}</p>
          <p className="quiet" style={css('margin:8px 0 0')}>
            {done[1]}
          </p>
        </div>
        <div className="acts">
          <button className="btn btn-p" type="button" data-gdone="">
            Done
          </button>
        </div>
      </>,
    );
    $('[data-gdone]').focus();
  }, 700);
}
