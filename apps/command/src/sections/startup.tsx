// @ts-nocheck: generated from the prototype's templates (see docs/command-reference/DECISIONS.md). Typed when Phase 3 puts API rows behind it.
import { LIVE } from '../live/env';
import * as live from '../live/account';
import * as acts from '../live/actions';
import { css, hasHtml, html } from '../runtime/dom';
import { D, merchantAgreements, openCFlow } from './contracts';
import { $, closePf, money, openPf, pfAct, setRail, setTheme } from './core';
import {
  MON,
  AGR,
  CS,
  DAY,
  FS,
  GS,
  KST,
  LATER,
  MEMBERS,
  MS,
  NAMES,
  NS,
  PEOPLE_T,
  POSTERS,
  ROLES,
  RS,
  S,
  SG,
  SS,
  STOPS,
  TODAY,
  TS,
  VS,
  V_OK,
  XS,
  vars,
} from './data';
import { fSave, posterAt } from './field';
import { openVFlow } from './governance';
import { fmtD, openAdd, openMove, openReplace, pid, slug } from './growth';
import { syncPages } from './home';
import { ddClose, ddOpen, ddPick, stepFlow } from './kit';
import { openMemberFlow } from './members';
import { cmSelect, kcDraw, kcItem, kcLog, kcMove, kcNew, kcSaved, openKc, openXFlow } from './merchants';
import { openNFlow } from './money';
import { openRFlow } from './records';
import { closeModal, finish, go, openItem, render, runSteps, toast, vLevel, viewExit } from './shell';
import { openSFlow } from './shop';
import { openCostFlow } from './costing';
import { sgnIn, sgnStep, sgnTimer, showLogin } from './signin';
import { accOf, openTFlow } from './team';

/** Live, a confirmed flow with an API call runs it, then its steps; a failure shows and the button comes back. */
function liveGo(t, f, title) {
  if (!LIVE || !f?.api) return false;
  t.disabled = true;
  f.api().then(
    () => stepFlow(title, f.steps, f.done, () => render()),
    (e) => {
      t.disabled = false;
      toast(e.message);
    },
  );
  return true;
}
/** "21 Oct" as the date a poster went up, in the year it's for. */
function hungOn(v) {
  const m = /^(\d{1,2}) ([A-Z][a-z]{2})/.exec(String(v || '').trim()),
    i = m ? MON.indexOf(m[2]) : -1;
  return i < 0 ? {} : { hungOn: new Date(Date.UTC(new Date(TODAY).getUTCFullYear(), i, Number(m[1]))).toISOString().slice(0, 10) };
}
export function startup() {
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (vars.themePref === 'auto') setTheme('auto');
    });
  } catch (e) {}
  try {
    vars.saved = localStorage.getItem('cc-theme') || 'light';
  } catch (e) {}
  setTheme(vars.saved);
  try {
    vars.savedRail = localStorage.getItem('cc-rail') || 'full';
  } catch (e) {}
  setRail(vars.savedRail);

  /* ── Building blocks ─────────────────────────────────────── */

  document.addEventListener(
    'scroll',
    (e) => {
      if (e.target.id === 'strip') {
        cancelAnimationFrame(vars.pageRaf);
        vars.pageRaf = requestAnimationFrame(syncPages);
      }
    },
    true,
  );
  window.addEventListener('resize', () => requestAnimationFrame(syncPages));
  document.addEventListener(
    'click',
    (e) => {
      if (!e.target.closest('.dd')) ddClose();
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    const dd = e.target.closest && e.target.closest('.dd');
    if (!dd) return;
    const l = dd.querySelector('.dd-list'),
      items = [...l.querySelectorAll('[role="option"]')],
      i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (l.hidden) return ddOpen(dd);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (i >= 0) {
        e.preventDefault();
        ddPick(dd, items[i].dataset.ddv);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      ddClose();
      dd.querySelector('.dd-btn').focus();
    } else if (e.key === 'Tab') ddClose();
  });

  /* ── Actions as modals ────────────────────────────────────────────────── */

  /* drag: the card lifts into a ghost that follows the pointer; its slot moves through the columns and the cards around it slide out of the way */
  (() => {
    let D = null;
    const EASE = 'cubic-bezier(.2,.8,.2,1)';
    const cards = () => [...document.querySelectorAll('#kboard .kc')];
    const flip = (fn) => {
      const before = new Map(cards().map((el) => [el, el.getBoundingClientRect()]));
      fn();
      cards().forEach((el) => {
        if (el === D.el) return;
        const a = before.get(el);
        if (!a) return;
        const b = el.getBoundingClientRect(),
          dx = a.left - b.left,
          dy = a.top - b.top;
        if (dx || dy)
          el.animate(
            [
              {
                transform: `translate(${dx}px,${dy}px)`,
              },
              {
                transform: 'none',
              },
            ],
            {
              duration: 200,
              easing: EASE,
            },
          );
      });
    };
    function start() {
      const r = D.el.getBoundingClientRect();
      D.ox = D.x - r.left;
      D.oy = D.y - r.top;
      D.from = {
        col: D.el.closest('[data-kcol]').dataset.kcol,
        next: D.el.nextElementSibling,
      };
      const g = D.el.cloneNode(true);
      g.classList.add('kc-ghost');
      g.removeAttribute('data-kc');
      g.style.width = r.width + 'px';
      g.style.height = r.height + 'px';
      g.style.left = r.left + 'px';
      g.style.top = r.top + 'px';
      document.body.appendChild(g);
      D.g = g;
      D.el.classList.add('kc-ph');
      document.body.classList.add('kb-drag');
      D.on = true;
      g.animate(
        [
          {
            transform: 'none',
            boxShadow: '0 0 0 rgb(0 0 0 / 0)',
          },
          {
            transform: 'rotate(1.5deg) scale(1.03)',
          },
        ],
        {
          duration: 160,
          easing: EASE,
          fill: 'forwards',
        },
      );
      try {
        navigator.vibrate && navigator.vibrate(12);
      } catch (e) {}
      D.raf = requestAnimationFrame(tick);
    }
    function place() {
      D.g.style.translate = `${D.x - D.ox - parseFloat(D.g.style.left)}px ${D.y - D.oy - parseFloat(D.g.style.top)}px`;
      const hit = document.elementFromPoint(D.x, D.y),
        col = hit && hit.closest('[data-kcol]');
      document.querySelectorAll('.kcol.over').forEach((c) => {
        if (c !== col) c.classList.remove('over');
      });
      if (!col) return;
      col.classList.add('over');
      const body = col.querySelector('.kcol-b'),
        list = [...body.querySelectorAll('.kc')].filter((el) => el !== D.el);
      const before =
        list.find((el) => {
          const b = el.getBoundingClientRect();
          return D.y < b.top + b.height / 2;
        }) || body.querySelector('.kmore, .kempty');
      if (D.el.parentNode === body && (before ? D.el.nextElementSibling === before : !D.el.nextElementSibling)) return;
      flip(() => {
        before ? body.insertBefore(D.el, before) : body.appendChild(D.el);
      });
    }
    function tick() {
      if (!D || !D.on) return;
      const board = document.getElementById('kboard'),
        br = board.getBoundingClientRect(),
        edge = 48;
      if (D.x < br.left + edge) board.scrollLeft -= 12;
      else if (D.x > br.right - edge) board.scrollLeft += 12;
      const cap = document.querySelector('#main .ptabs') || document.querySelector('.top'),
        top = cap ? cap.getBoundingClientRect().bottom : 0,
        moved = Math.abs(D.y - D.sy) > 24;
      if (moved && D.y < top + 36) window.scrollBy(0, -10);
      else if (moved && D.y > innerHeight - 56) window.scrollBy(0, 10);
      place();
      D.raf = requestAnimationFrame(tick);
    }
    function end(cancel) {
      if (!D) return;
      clearTimeout(D.t);
      const d = D;
      D = null;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cc);
      document.removeEventListener('keydown', esc);
      if (!d.on) return;
      cancelAnimationFrame(d.raf);
      document.addEventListener('click', stop, true);
      setTimeout(() => document.removeEventListener('click', stop, true), 0);
      document.body.classList.remove('kb-drag');
      document.querySelectorAll('.kcol.over').forEach((c) => c.classList.remove('over'));
      if (cancel) {
        const body = document.querySelector(`[data-kcol="${d.from.col}"] .kcol-b`);
        flip(() => {
          d.from.next && d.from.next.parentNode === body ? body.insertBefore(d.el, d.from.next) : body.appendChild(d.el);
        });
      }
      const r = d.el.getBoundingClientRect(),
        gx = r.left - parseFloat(d.g.style.left),
        gy = r.top - parseFloat(d.g.style.top);
      const a = d.g.animate(
        [
          {
            translate: d.g.style.translate,
            transform: 'rotate(1.5deg) scale(1.03)',
          },
          {
            translate: `${gx}px ${gy}px`,
            transform: 'none',
          },
        ],
        {
          duration: 200,
          easing: EASE,
          fill: 'forwards',
        },
      );
      a.onfinish = () => {
        d.g.remove();
        d.el.classList.remove('kc-ph');
        const to = d.el.closest('[data-kcol]').dataset.kcol,
          c = XS.board.find((x) => x.id === d.el.dataset.kc);
        if (!c) return;
        const prev = {
          stage: c.stage,
          order: XS.board.slice(),
        };
        const ids = [...document.querySelectorAll('#kboard .kc[data-kc]')].map((el) => el.dataset.kc),
          rest = XS.board.filter((x) => !ids.includes(x.id));
        c.stage = to;
        XS.board = [...ids.map((id) => XS.board.find((x) => x.id === id)), ...rest];
        render();
        acts.saveOrder(c);
        if (prev.stage !== to) kcLog(c, `Moved to ${KST.find((s) => s[0] === to)[1]}`);
        if (prev.stage !== to)
          toast(`${c.name} moved to ${KST.find((s) => s[0] === to)[1]} · logged`, {
            label: 'Undo',
            fn: () => {
              c.stage = prev.stage;
              XS.board = prev.order;
              render();
              acts.saveOrder(c);
            },
          });
      };
    }
    const stop = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    function move(e) {
      if (!D) return;
      D.x = e.clientX;
      D.y = e.clientY;
      if (!D.on) {
        const far = Math.hypot(D.x - D.sx, D.y - D.sy) > (D.touch ? 8 : 5);
        if (far) {
          if (D.touch) return end(true);
          start();
        }
        return;
      }
      e.preventDefault();
    }
    const up = () => end(false),
      cc = () => end(true),
      esc = (e) => {
        if (e.key === 'Escape') end(true);
      };
    document.addEventListener(
      'touchmove',
      (e) => {
        if (D && D.on) e.preventDefault();
      },
      {
        passive: false,
      },
    );
    document.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('#kboard .kc[data-kc]');
      if (!el || e.button > 0 || (S.view && vLevel('merchants') < 3)) return;
      D = {
        el,
        sx: e.clientX,
        sy: e.clientY,
        x: e.clientX,
        y: e.clientY,
        touch: e.pointerType !== 'mouse',
        on: false,
      };
      if (D.touch)
        D.t = setTimeout(() => {
          if (D && !D.on) start();
        }, 320);
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', cc);
      document.addEventListener('keydown', esc);
    });
  })();

  /* ── Board card panel ─────────────────────────────────────────────────────
     Built around what people do with a shop in the pipeline: see where it stands, do the next step, log what happened,
     move it on. Edits save as you go (a new prospect saves when you add it). Owners come from Permissions, so the list
     grows with the team; due dates and activity make "who's on it and what's late" readable at a glance. */

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && e.target.matches && e.target.matches('#kboard .kc[data-kc]')) openKc(e.target.dataset.kc);
      if (e.key === 'Escape' && vars.KE && vars.KE.ownerOpen) {
        vars.KE.ownerOpen = false;
        e.stopPropagation();
        kcDraw();
      }
    },
    true,
  );
  document.addEventListener('input', (e) => {
    if (!vars.KE) return;
    const t = e.target;
    if (t.matches('[data-kownq]')) {
      vars.KE.ownerQ = t.value;
      return kcDraw();
    }
    if (t.id === 'kce-logtx') {
      vars.KE.logDraft = t.value;
      return;
    }
    if (t.dataset.kf === 'name' && vars.KE.err) {
      vars.KE.err = false;
      t.classList.remove('bad');
      const m = document.querySelector('.kce-err');
      if (m) m.remove();
    }
    if (!vars.KE.id) {
      const c = vars.KE.d,
        k = t.dataset.kf;
      if (!k) return;
      if (k.startsWith('c.')) c.contact[k.slice(2)] = t.value;
      else if (k === 'val') c.val = +t.value.replace(/[^0-9.]/g, '') || 0;
      else if (k === 'duedate') c.due = t.value ? Date.parse(t.value + 'T00:00:00Z') : null;
      else c[k] = t.value;
    }
  });
  /* existing shops save when a field is left */
  document.addEventListener('change', (e) => {
    if (!vars.KE || !vars.KE.id) return;
    const t = e.target,
      k = t.dataset && t.dataset.kf;
    if (!k) return;
    const c = kcItem();
    if (!c) return;
    if (k === 'name') {
      if (!t.value.trim()) {
        t.value = c.name;
        return;
      }
      c.name = t.value.trim();
      kcLog(c, 'Renamed');
    } else if (k === 'val') {
      const v = +t.value.replace(/[^0-9.]/g, '') || 0;
      if (v !== c.val) {
        c.val = v;
        kcLog(c, `Per month set to ${money(v)}`);
      }
      t.value = v ? money(v) : '';
    } else if (k === 'next') {
      c.next = t.value.trim();
      kcLog(c, c.next ? `Next step: ${c.next}` : 'Cleared the next step');
    } else if (k === 'duedate') {
      c.due = t.value ? Date.parse(t.value + 'T00:00:00Z') : null;
      kcLog(c, c.due ? `Due ${fmtD(c.due)}` : 'Cleared the due date');
      kcSaved();
      return kcDraw();
    } else if (k.startsWith('c.')) {
      c.contact[k.slice(2)] = t.value.trim();
      acts.saveCard(c);
      kcSaved('Saved');
      return kcDraw();
    } else if (k === 'note') {
      c.note = t.value;
      acts.saveCard(c);
    } else {
      c[k] = t.value.trim();
      acts.saveCard(c);
    }
    kcSaved();
  });
  document.addEventListener('click', (e) => {
    const card = e.target.closest('#kboard .kc[data-kc]');
    if (card && !e.target.closest('button')) return openKc(card.dataset.kc);
    if (!vars.KE || !e.target.closest('.pane.kce')) {
      if (vars.KE && vars.KE.ownerOpen && !e.target.closest('.kown')) {
        vars.KE.ownerOpen = false;
        kcDraw();
      }
      return;
    }
    const b = e.target.closest('button');
    if (!b || b.disabled) {
      if (vars.KE.ownerOpen && !e.target.closest('.kown')) {
        vars.KE.ownerOpen = false;
        kcDraw();
      }
      return;
    }
    const c = kcItem(),
      isNew = !vars.KE.id,
      D0 = b.dataset;
    if (vars.KE.ownerOpen && !b.closest('.kown')) vars.KE.ownerOpen = false;
    if (D0.kownopen !== undefined) {
      vars.KE.ownerOpen = !vars.KE.ownerOpen;
      vars.KE.ownerQ = '';
      kcDraw();
      const q = document.querySelector('[data-kownq]');
      if (q) q.focus();
      return;
    }
    if (D0.kown !== undefined) {
      const prev = c.owner;
      c.owner = D0.kown;
      vars.KE.ownerOpen = false;
      if (!isNew && prev !== c.owner) {
        kcLog(c, c.owner ? `Owner is now ${c.owner}` : 'Owner removed');
        kcSaved();
      }
      return kcDraw();
    }
    if (D0.kst) {
      if (isNew) {
        c.stage = D0.kst;
        return kcDraw();
      }
      const to = D0.kst;
      if (to === c.stage) return;
      const back = KST.findIndex((s) => s[0] === to) < KST.findIndex((s) => s[0] === c.stage);
      if (back || to === 'talking') {
        kcMove(c, to);
        kcSaved();
        return kcDraw();
      }
      vars.KE.stageTo = to;
      return kcDraw();
    }
    if (D0.kstno !== undefined) {
      vars.KE.stageTo = null;
      return kcDraw();
    }
    if (D0.kstgo !== undefined) {
      const to = vars.KE.stageTo;
      vars.KE.stageTo = null;
      kcMove(c, to, to === 'signing' ? 'Agreement sent · moved to Signing' : to === 'signed' ? 'Agreement back · marked signed' : null);
      kcSaved();
      toast(`${c.name} moved to ${KST.find((s) => s[0] === to)[1]} · logged`);
      return kcDraw();
    }
    if (D0.kdue !== undefined) {
      c.due = D0.kdue ? +D0.kdue : null;
      if (!isNew) {
        kcLog(c, c.due ? `Due ${fmtD(c.due)}` : 'Cleared the due date');
        kcSaved();
      }
      return kcDraw();
    }
    if (D0.kdone !== undefined) {
      const was = c.next;
      kcLog(c, `Done: ${was}`, 'note');
      c.next = '';
      c.due = null;
      kcSaved();
      kcDraw();
      const n = document.querySelector('.pane.kce [data-kf="next"]');
      if (n) n.focus();
      return toast(`Done: ${was} · set the next step`);
    }
    if (D0.ksrc) {
      c.source = D0.ksrc;
      if (!isNew) {
        kcLog(c, `Source: ${c.source}`);
        kcSaved();
      }
      return kcDraw();
    }
    if (D0.klt) {
      vars.KE.logType = D0.klt;
      return kcDraw();
    }
    if (D0.klog !== undefined) {
      const tx = (document.getElementById('kce-logtx') || {}).value || '';
      if (!tx.trim()) {
        const el = document.getElementById('kce-logtx');
        if (el) el.focus();
        return;
      }
      kcLog(c, tx.trim(), vars.KE.logType || 'note');
      vars.KE.logDraft = '';
      kcSaved();
      return kcDraw();
    }
    if (D0.kall !== undefined) {
      vars.KE.allLog = !vars.KE.allLog;
      return kcDraw();
    }
    if (D0.koff !== undefined) {
      vars.KE.offOpen = true;
      return kcDraw();
    }
    if (D0.koffr) {
      vars.KE.offReason = D0.koffr;
      return kcDraw();
    }
    if (D0.koffgo !== undefined) {
      const prev = XS.board.slice(),
        why = vars.KE.offReason;
      kcLog(c, `Taken off the board · ${why}`);
      XS.board = XS.board.filter((x) => x !== c);
      acts.removeCard(c, why || 'Taken off');
      vars.KE = null;
      closeModal();
      render();
      return toast(`${c.name} taken off the board · logged`, {
        label: 'Undo',
        fn: () => {
          XS.board = prev;
          acts.restoreCard(c);
          render();
        },
      });
    }
    if (D0.kcopen) {
      const m = D0.kcopen;
      vars.KE = null;
      closeModal();
      XS.merchant = m;
      return render();
    }
    if (D0.kadd !== undefined) {
      if (!String(c.name || '').trim()) {
        vars.KE.err = true;
        kcDraw();
        const t = document.querySelector('.pane.kce .kce-title');
        if (t) t.focus();
        return;
      }
      const n = Object.assign({}, c, {
        id: 'n' + Date.now().toString(36),
        name: c.name.trim(),
        kind: c.kind || 'Shop',
        city: c.city || 'Inland Empire',
        added: TODAY,
        log: [],
      });
      kcLog(n, 'Added to the board');
      if (c.note) kcLog(n, c.note, 'note');
      delete n.note;
      const rest = XS.board.slice(),
        same = rest.filter((x) => x.stage === n.stage);
      rest.splice(same.length ? rest.indexOf(same[0]) : rest.length, 0, n);
      XS.board = rest;
      acts.saveOrder(n);
      vars.KE = null;
      closeModal();
      XS.pane = 'pipeline';
      render();
      const el = document.querySelector(`[data-kc="${n.id}"]`);
      if (el) {
        el.scrollIntoView({
          block: 'center',
        });
        el.animate(
          [
            {
              background: 'color-mix(in srgb, var(--live) 18%, transparent)',
            },
            {
              background: 'transparent',
            },
          ],
          {
            duration: 1600,
            easing: 'ease-out',
          },
        );
      }
      return toast(`${n.name} added to ${KST.find((s) => s[0] === n.stage)[1]} · logged`, {
        label: 'Undo',
        fn: () => {
          XS.board = XS.board.filter((x) => x !== n);
          acts.removeCard(n, 'Added by mistake');
          render();
        },
      });
    }
  });

  /* ── Pipeline board ───────────────────────────────────────────────────── */

  STOPS.forEach((s) =>
    s.tasks.forEach((t) => {
      if (t.kind === 'poster') {
        const p = posterAt(t.shop, t.n);
        t.p = p;
        if (t.shop) t.t = `Check ${pid(p.n)}`;
      }
    }),
  );
  AGR.push(...merchantAgreements());
  document.addEventListener('input', (e) => {
    if (!TS.edit) return;
    if (e.target.id === 'tg-name') TS.edit.name = e.target.value;
    if (e.target.id === 'tg-desc') TS.edit.desc = e.target.value;
  });
  document.addEventListener(
    'click',
    (e) => {
      const x = e.target.closest('[data-viewexit]');
      if (x) {
        e.preventDefault();
        e.stopPropagation();
        return viewExit();
      }
      if (!S.view || vLevel(S.route) >= 3) return;
      const el = e.target.closest('button,[role="button"],[data-member]');
      if (!el || el.closest('#pfRoot,#loginRoot')) return;
      if (vLevel(S.route) === 1 && el.closest('[data-member]')) {
        e.preventDefault();
        e.stopPropagation();
        return toast('Names stay hidden in this view · co-op totals only');
      }
      const ok = [...el.attributes].some((a) => V_OK.test(a.name));
      if (!ok && el.matches('.btn,.c-ft button,.acts button,[data-move],[data-open],[data-mbatch]')) {
        e.preventDefault();
        e.stopPropagation();
        toast(`Read-only · the ${ROLES[S.view.g][0]} view can look, not change`);
      }
    },
    true,
  );
  /* Totals: co-op numbers only. Person-level tabs are hidden, member names and emails are blanked, member records don't open.
     The live API does this on the server; this is the same rule shown in the prototype. */

  /* switching tabs lands on the first item: if you'd scrolled past the title, the page stops with the tabs held under the top bar; otherwise it stays put */
  document.addEventListener(
    'click',
    (e) => {
      const b = e.target.closest('.ptabs button');
      if (!b) return;
      const y0 = window.scrollY;
      requestAnimationFrame(() => {
        const ph = document.querySelector('#main .ph'),
          bar = document.querySelector('.top');
        if (!ph || !bar) return;
        const stuck = Math.max(0, Math.round(ph.getBoundingClientRect().bottom + window.scrollY - bar.getBoundingClientRect().bottom));
        window.scrollTo({
          top: Math.min(y0, stuck),
          behavior: 'instant',
        });
      });
    },
    true,
  );
  /* ── Events ──────────────────────────────────────────────── */
  document.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-ddv]');
    if (opt) return ddPick(opt.closest('.dd'), opt.dataset.ddv);
    const ddb = e.target.closest('.dd-btn');
    if (ddb) {
      const dd = ddb.closest('.dd');
      return dd.querySelector('.dd-list').hidden ? ddOpen(dd) : ddClose();
    }
    const t = e.target.closest(
      'button,[data-closenpane],[data-pf-close],[data-scrim],[data-poster],[data-closepane],[data-member],[data-closempane],[data-merchant],[data-cmcity],[data-closexpane],[data-fclose],[data-agr],[data-ctr],[data-closecpane],[data-ent],[data-closevpane],[data-doc],[data-rentry],[data-closerpane],[data-person],[data-closetpane],[data-product],[data-order],[data-closespane],[data-sinput]',
    );
    if (!t) return;
    if (t.matches('[data-scrim]') && e.target === t) return closeModal();
    if (t.dataset.close !== undefined) return closeModal();
    if (t.matches('[data-fclose]') && (e.target === t || t.tagName === 'BUTTON')) {
      FS.scan = null;
      FS.outcome = null;
      return render();
    }
    if (t.dataset.fwho) {
      FS.who = t.dataset.fwho;
      return render();
    }
    if (t.dataset.fscan !== undefined) {
      FS.scan = t.dataset.fscan ? Number(t.dataset.fscan) : 'pick';
      FS.outcome = null;
      return render();
    }
    if (t.dataset.fpick) {
      FS.scan = Number(t.dataset.fpick);
      FS.outcome = null;
      return render();
    }
    if (t.dataset.fcode !== undefined) {
      const n = parseInt(((document.getElementById('f-code') || {}).value || '').replace(/\D/g, ''), 10);
      if (POSTERS.find((x) => x.n === n)) {
        FS.scan = n;
        FS.outcome = null;
        render();
      } else {
        const i = document.getElementById('f-code');
        if (i) {
          i.setCustomValidity('No poster with that code');
          i.reportValidity();
        }
      }
      return;
    }
    if (t.dataset.fout) {
      FS.outcome = t.dataset.fout;
      const keep = (document.getElementById('f-note') || {}).value;
      render();
      if (keep) document.getElementById('f-note').value = keep;
      return;
    }
    if (t.dataset.fback !== undefined) {
      FS.scan = 'pick';
      FS.outcome = null;
      return render();
    }
    if (t.dataset.fsave) return fSave(Number(t.dataset.fsave));
    if (t.dataset.fdev) {
      const [sid, i] = t.dataset.fdev.split(':');
      if (LIVE) return acts.run('field', 'task-done', { stop: sid, position: Number(i) }, () => render());
      const tk = STOPS.find((x) => x.id === sid).tasks[i];
      if (!tk.done) {
        tk.done = '10:3' + (4 + Math.floor(Math.random() * 5));
        tk.out = 'Fixed';
      }
      return render();
    }
    if (t.dataset.fskip) {
      if (LIVE) return acts.run('field', 'skip', { stop: t.dataset.fskip }, () => render());
      const i = STOPS.findIndex((x) => x.id === t.dataset.fskip);
      STOPS.push(STOPS.splice(i, 1)[0]);
      return render();
    }
    if (t.dataset.fadd || t.dataset.faddAll !== undefined) {
      const names = t.dataset.fadd ? [t.dataset.fadd] : LATER.map((l) => l[0]);
      if (LIVE) {
        // one after another, so the route keeps their order
        names.reduce((p, shop) => p.then(() => acts.act('field', 'add-later', { shop })), Promise.resolve()).then(
          () => render(),
          (e) => toast(e.message),
        );
        return;
      }
      names.forEach((nm) => {
        const i = LATER.findIndex((l) => l[0] === nm),
          l = LATER.splice(i, 1)[0];
        const n = l[0] === 'Calimesa Cleaners' ? 63 : 90;
        STOPS.push({
          id: 'x' + n,
          name: l[0],
          city: l[1],
          where: l[1],
          eta: '14:10',
          tasks: [
            {
              kind: 'poster',
              n,
              p: POSTERS.find((x) => x.n === n),
              t: (l[3] === 'missing' ? 'Replace ' : 'Swap ') + pid(n),
              note: l[3] === 'missing' ? 'Missing' : 'Faded',
            },
          ],
        });
      });
      return render();
    }
    if (t.dataset.spane) {
      SS.pane = t.dataset.spane;
      SS.prod = null;
      SS.order = null;
      SS.input = null;
      if (S.route !== 'shop') S.route = 'shop';
      render();
      window.scrollTo({
        top: 0,
      });
      return;
    }
    if (t.dataset.closespane !== undefined) {
      SS.prod = null;
      SS.order = null;
      SS.input = null;
      return render();
    }
    // live only (Phase 10b): an input's pane on Shop's Costs tab, and the costing flows
    if (t.dataset.sinput) {
      SS.input = t.dataset.sinput;
      SS.prod = null;
      SS.order = null;
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.cflow) return openCostFlow(t.dataset.cflow, t.dataset.sid, t.dataset.cid, t.dataset);
    if (t.dataset.product) {
      SS.prod = t.dataset.product;
      SS.order = null;
      SS.input = null;
      if (document.querySelector('.modal')) closeModal();
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.order) {
      SS.order = t.dataset.order;
      SS.prod = null;
      SS.input = null;
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.sof) {
      SS.of = t.dataset.sof;
      render();
      const tb = document.querySelector('[data-dd="sof"]');
      if (tb)
        tb.scrollIntoView({
          block: 'center',
        });
      return;
    }
    if (t.dataset.sline) {
      SS.line = t.dataset.sline;
      return openSFlow('add');
    }
    if (t.dataset.swhy) {
      SS.why = t.dataset.swhy;
      return openSFlow('shelf-off', SS.prod);
    }
    if (t.dataset.stog !== undefined) {
      t.setAttribute('aria-pressed', String(t.getAttribute('aria-pressed') !== 'true'));
      return;
    }
    if (t.dataset.sflow) {
      if (t.dataset.sflow === 'add') SS.line = 'logo';
      if (t.dataset.sflow === 'shelf-off') SS.why = 'stock';
      return openSFlow(t.dataset.sflow, t.dataset.sid);
    }
    if (t.dataset.tpane) {
      TS.pane = t.dataset.tpane;
      TS.person = null;
      if (S.route !== 'team') S.route = 'team';
      render();
      window.scrollTo({
        top: 0,
      });
      return;
    }
    if (t.dataset.closetpane !== undefined) {
      TS.person = null;
      return render();
    }
    if (t.dataset.person) {
      TS.person = t.dataset.person;
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.trole) {
      if (t.dataset.tk === 'invite') {
        TS.invRole = t.dataset.trole;
        return openTFlow('invite');
      }
      TS.roleTo = t.dataset.trole;
      return openTFlow('role-change', t.dataset.tid);
    }
    if (t.dataset.tlv) {
      const i = +t.dataset.tlv;
      if (TS.edit) {
        TS.edit.levels[i] = (TS.edit.levels[i] + 1) % 5;
        openTFlow(TS.edit.kind, TS.edit.id);
        const b = document.querySelector(`[data-tlv="${i}"]`);
        if (b) b.focus();
      }
      return;
    }
    if (t.dataset.tflow) {
      if (t.dataset.tflow === 'role-change') TS.roleTo = null;
      if (['custom', 'newgroup', 'editgroup'].includes(t.dataset.tflow)) TS.edit = null;
      return openTFlow(t.dataset.tflow, t.dataset.tid);
    }
    if (t.dataset.rpane) {
      RS.pane = t.dataset.rpane;
      RS.doc = null;
      if (S.route !== 'records') S.route = 'records';
      render();
      window.scrollTo({
        top: 0,
      });
      return;
    }
    if (t.dataset.closerpane !== undefined) {
      RS.doc = null;
      return render();
    }
    if (t.dataset.doc) {
      RS.doc = t.dataset.doc;
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.rdf) {
      RS.df = t.dataset.rdf;
      RS.pane = 'docs';
      render();
      const tb = document.querySelector('[data-dd="rdf"]');
      if (tb)
        tb.scrollIntoView({
          block: 'center',
        });
      return;
    }
    if (t.dataset.rentry) {
      return openRFlow('entry', t.dataset.rentry);
    }
    if (t.dataset.rflow) {
      return openRFlow(t.dataset.rflow, t.dataset.rid);
    }
    if (t.dataset.entGo) {
      VS.pane = 'entities';
      VS.ent = t.dataset.entGo;
      S.route = 'governance';
      render();
      window.scrollTo({
        top: 0,
      });
      return;
    }
    if (t.dataset.vpane) {
      VS.pane = t.dataset.vpane;
      VS.ent = null;
      if (S.route !== 'governance') S.route = 'governance';
      render();
      window.scrollTo({
        top: 0,
      });
      return;
    }
    if (t.dataset.closevpane !== undefined) {
      VS.ent = null;
      VS.meet = false;
      return render();
    }
    if (t.dataset.vmo) {
      VS.mo = Math.max(0, Math.min(9, VS.mo + Number(t.dataset.vmo)));
      return render();
    }
    if (t.dataset.vtoday !== undefined) {
      VS.mo = 0;
      return render();
    }
    if (t.dataset.vmeet !== undefined) {
      VS.meet = true;
      VS.ent = null;
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.vkind) {
      VS.logKind = t.dataset.vkind;
      return openVFlow('log', t.dataset.vid || null);
    }
    if (t.closest('.seg2') && !t.dataset.vkind) {
      t.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === t)));
      return;
    }
    if (t.dataset.ent) {
      VS.ent = t.dataset.ent;
      VS.meet = false;
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.vflow) {
      return openVFlow(t.dataset.vflow, t.dataset.vid);
    }
    if (t.dataset.vgo) {
      if (openVFlow.f && openVFlow.f.go) return openVFlow.f.go();
      const f = openVFlow.f,
        it = document.getElementById('vi-what');
      if (it) openVFlow.lastItem = it.value;
      if (LIVE && f.api) {
        t.disabled = true;
        return f.api().then(
          () => stepFlow(f.ext ? 'Handing off' : 'Working', f.steps, f.done, () => render()),
          (e) => {
            t.disabled = false;
            toast(e.message);
          },
        );
      }
      return stepFlow(f.ext ? 'Handing off' : 'Working', f.steps, f.done, f.after || null);
    }
    if (t.dataset.cpane) {
      CS.pane = t.dataset.cpane;
      CS.ag = null;
      CS.ct = null;
      if (S.route !== 'contracts') S.route = 'contracts';
      render();
      window.scrollTo({
        top: 0,
      });
      return;
    }
    if (t.dataset.closecpane !== undefined) {
      CS.ag = null;
      CS.ct = null;
      return render();
    }
    if (t.dataset.agr) {
      CS.ag = t.dataset.agr;
      CS.ct = null;
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.ctr) {
      CS.ct = t.dataset.ctr;
      CS.ag = null;
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.cflow) {
      return openCFlow(t.dataset.cflow, t.dataset.cid);
    }
    if ((t.dataset.safeprep || t.dataset.safesign) && LIVE) {
      t.disabled = true;
      const prep = t.dataset.safeprep;
      return import('../live/safe')
        .then((m) => (prep ? m.signAndSend(prep) : m.signQueued(t.dataset.safesign)))
        .then(
          (r) => {
            toast(prep ? 'In the Safe’s queue · 1 signature so far · logged' : `Signed · ${r.signatures} of ${r.required}${r.signatures >= r.required ? ' · ready to execute' : ''}`);
            render();
          },
          (e) => {
            t.disabled = false;
            toast(e.message);
          },
        );
    }
    if (t.dataset.linkwallet !== undefined && LIVE) {
      t.disabled = true;
      return import('../live/safe')
        .then((m) => m.linkWallet())
        .then(
          (w) => {
            toast(`Linked ${w.slice(0, 6)}…${w.slice(-4)} · logged`);
            render();
          },
          (e) => {
            t.disabled = false;
            toast(e.message);
          },
        );
    }
    if (t.dataset.cgo) {
      const f = openCFlow.f,
        v = (document.getElementById('cp-what') || {}).value;
      if (LIVE && f.api) {
        t.disabled = true;
        return f.api().then(
          () => stepFlow(f.ext ? 'Handing off' : 'Working', f.steps, f.done, () => render()),
          (e) => {
            t.disabled = false;
            toast(e.message);
          },
        );
      }
      return stepFlow(f.ext ? 'Handing off' : 'Working', f.steps, f.done, f.after ? () => f.after(v) : null);
    }
    if (t.dataset.npane) {
      NS.pane = t.dataset.npane;
      NS.acct = null;
      if (S.route !== 'money') S.route = 'money';
      render();
      window.scrollTo({
        top: 0,
      });
      return;
    }
    if (t.dataset.closenpane !== undefined) {
      NS.acct = null;
      return render();
    }
    if (t.dataset.nacct) {
      NS.acct = t.dataset.nacct;
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.nflow) {
      return openNFlow(t.dataset.nflow);
    }
    if (t.dataset.xpane) {
      XS.pane = t.dataset.xpane;
      XS.merchant = null;
      if (S.route !== 'merchants') S.route = 'merchants';
      render();
      window.scrollTo({
        top: 0,
      });
      return;
    }
    if (t.dataset.closexpane !== undefined) {
      XS.merchant = null;
      return render();
    }
    if (t.dataset.merchant) {
      XS.merchant = t.dataset.merchant;
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.xsigned !== undefined) {
      XS.allSigned = !XS.allSigned;
      return render();
    }
    if (t.dataset.xcap) return openXFlow('cap', t.dataset.xcap);
    if (t.dataset.xturnoff) return openXFlow('off', t.dataset.xturnoff);
    if (t.dataset.xon) return openXFlow('on', t.dataset.xon);
    if (t.dataset.xrun !== undefined) return openXFlow('run');
    if (t.dataset.xadd !== undefined) return kcNew();
    if (t.dataset.xgo) {
      const f = openXFlow.f;
      if (liveGo(t, f, t.dataset.xgo === 'cap' ? 'Handing off' : 'Working')) return;
      return stepFlow(t.dataset.xgo === 'cap' ? 'Handing off' : 'Working', f.steps, f.done);
    }
    if (t.dataset.mpane) {
      MS.pane = t.dataset.mpane;
      MS.member = null;
      if (S.route !== 'members') S.route = 'members';
      render();
      window.scrollTo({
        top: 0,
      });
      return;
    }
    if (t.dataset.msize) {
      MS.size = Number(t.dataset.msize);
      return render();
    }
    if (t.dataset.mpg !== undefined) {
      MS.pg = Math.max(0, Number(t.dataset.mpg));
      return render();
    }
    if (t.dataset.mreveal !== undefined) {
      MS.reveal = !MS.reveal;
      if (LIVE && MS.reveal && !vars.namesShown) return void live.loadSection('members', { reveal: true }).then(render, (e) => toast(e.message));
      return render();
    }
    if (t.dataset.closempane !== undefined) {
      MS.member = null;
      return render();
    }
    if (t.dataset.member) {
      MS.member = Number(t.dataset.member);
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.mbatch !== undefined) return openMemberFlow('batch', MEMBERS[0]?.id);
    if (t.dataset.mact) return openMemberFlow(t.dataset.mact, Number(t.dataset.mid));
    if (t.dataset.mturnoff) return openMemberFlow('off', Number(t.dataset.mturnoff));
    if (t.dataset.mgo) {
      const f = openMemberFlow.f;
      if (liveGo(t, f, 'Working')) return;
      return stepFlow('Working', f.steps, f.done);
    }
    if (t.dataset.gpane) {
      GS.pane = t.dataset.gpane;
      GS.poster = null;
      return render();
    }
    if (t.dataset.gsort) {
      GS.dir = GS.sort === t.dataset.gsort ? -GS.dir : -1;
      GS.sort = t.dataset.gsort;
      return render();
    }
    if (t.dataset.pf) {
      GS.pf = t.dataset.pf;
      GS.pg = 0;
      if (GS.pane !== 'posters') GS.pane = 'posters';
      return render();
    }
    if (t.dataset.pg !== undefined) {
      GS.pg = Math.max(0, Number(t.dataset.pg));
      return render();
    }
    if (t.dataset.ft) {
      GS.ft = t.dataset.ft;
      return render();
    }
    if (t.dataset.reveal !== undefined) {
      GS.reveal = !GS.reveal;
      return render();
    }
    if (t.dataset.closepane !== undefined) {
      GS.poster = null;
      return render();
    }
    if (t.dataset.poster) {
      GS.poster = Number(t.dataset.poster);
      render();
      const x = document.querySelector('.pane .x');
      if (x) x.focus();
      return;
    }
    if (t.dataset.replace) {
      return openReplace(Number(t.dataset.replace));
    }
    if (t.dataset.doreplace) {
      const n = Number(t.dataset.doreplace),
        p = POSTERS.find((x) => x.n === n);
      if (liveGo(t, { api: () => acts.act('growth', 'poster-replaced', { n }), steps: ['Retired the old poster', 'Set the next swap'], done: ['Poster replaced.', pid(n) + ' is back up at ' + p.shop + '.'] }, 'Replacing')) return;
      return stepFlow(
        'Replacing',
        ['Retired the old poster', 'Linked the new one to useclear.org/s/' + slug(p.shop), 'Set the next swap for ' + fmtD(TODAY + 60 * DAY)],
        ['Poster replaced.', pid(n) + ' is back up at ' + p.shop + '.'],
        () => {
          p.status = 'up';
          p.hung = TODAY;
          p.swap = TODAY + 60 * DAY;
          p.checked = TODAY;
        },
      );
    }
    if (t.dataset.addposter !== undefined) {
      openAdd.city = null;
      return openAdd();
    }
    if (t.dataset.move) {
      if (t.dataset.move === 'add') {
        openAdd.city = t.dataset.city;
        return openAdd('A shop in ' + t.dataset.city);
      }
      return openMove(t.dataset.move);
    }
    if (t.dataset.domove) {
      const f = openMove.f;
      if (liveGo(t, f, 'Working')) return;
      return stepFlow('Working', f.steps, f.done);
    }
    if (t.dataset.apd) {
      document.querySelectorAll('[data-apd]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
      return;
    }
    if (t.dataset.doadd !== undefined) {
      const shop = ($('#ap-shop').value || 'New shop').trim(),
        des = (document.querySelector('[data-apd][aria-pressed="true"]') || {}).dataset?.apd || 'A',
        n = POSTERS.length + 1;
      if (
        liveGo(
          t,
          { api: () => acts.act('growth', 'poster-add', { place: shop, city: openAdd.city || 'Inland Empire', design: des, ...hungOn(($('#ap-date') || {}).value) }), steps: ['Gave it the next number', 'Made its code', 'Set the first swap'], done: ['Poster added.', shop + ' is in the inventory.'] },
          'Adding',
        )
      )
        return;
      return stepFlow(
        'Adding',
        ['Gave it the number ' + pid(n), 'Made its code useclear.org/s/' + slug(shop), 'Set the first swap for ' + fmtD(TODAY + 60 * DAY)],
        ['Poster added.', pid(n) + ' at ' + shop + ' is in the inventory.'],
        () => {
          POSTERS.push({
            n,
            shop,
            shopId: 'new' + n,
            city: 'Inland Empire',
            scans: 0,
            design: des,
            hung: TODAY,
            swap: TODAY + 60 * DAY,
            checked: TODAY,
            status: 'up',
          });
        },
      );
    }
    if (t.dataset.gdone !== undefined) {
      FS.scan = null;
      FS.outcome = null;
      closeModal();
      return render();
    }
    if (t.dataset.copy) {
      const v = t.dataset.copy;
      try {
        navigator.clipboard.writeText(v).then(
          () => {
            t.textContent = 'Copied';
          },
          () => {},
        );
      } catch (err) {}
      return;
    }
    if (t.dataset.cmcity) {
      return cmSelect(t.dataset.cmcity);
    }
    if (t.dataset.cmzoom !== undefined) {
      if (vars.CMAP && vars.CMAP.map) {
        const z = +t.dataset.cmzoom;
        if (z)
          vars.CMAP.map.easeTo({
            zoom: vars.CMAP.map.getZoom() + z,
            duration: 300,
          });
        else {
          vars.CMAP.sel = null;
          cmSelect(null);
        }
      }
      return;
    }
    if (t.dataset.pfOpen !== undefined) return hasHtml($('#pfRoot')) ? closePf() : openPf();
    if (t.dataset.pfClose !== undefined) return closePf();
    if (t.dataset.pfa) return pfAct(t.dataset.pfa);
    if (t.dataset.themeSet) return setTheme(t.dataset.themeSet);
    if (t.dataset.railTog !== undefined) return setRail(document.documentElement.dataset.rail === 'min' ? 'full' : 'min');
    if (t.dataset.open) return openItem(t.dataset.open);
    if (t.dataset.goStep) return runSteps(t.dataset.goStep);
    if (t.dataset.finish) return finish(t.dataset.finish);
    if (t.dataset.preview) {
      S.preview = t.dataset.preview;
      return render();
    }
    if (t.dataset.retry !== undefined) {
      S.preview = 'loading';
      render();
      return setTimeout(() => {
        S.preview = 'live';
        render();
      }, 1400);
    }
    if (t.dataset.scroll) {
      const st = $('#strip');
      if (st)
        st.scrollBy({
          left: Number(t.dataset.scroll) * st.clientWidth,
          behavior: 'smooth',
        });
      return;
    }
    if (t.dataset.page) {
      const st = $('#strip');
      if (st)
        st.scrollTo({
          left: Number(t.dataset.page) * st.clientWidth,
          behavior: 'smooth',
        });
      return;
    }
    if (t.dataset.filter) {
      S.filter = t.dataset.filter;
      render();
      return;
    }
    if (t.dataset.go) return go(t.dataset.go);
    const seg = t.closest('[data-seg]');
    if (seg && t.dataset.v) {
      if (seg.dataset.seg === 'range') S.range = t.dataset.v;
      if (seg.dataset.seg === 'preview') S.preview = t.dataset.v;
      if (seg.dataset.seg === 'filter') S.filter = t.dataset.v;
      render();
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'f-photo' && e.target.files.length) {
      const l = document.getElementById('f-photo-l');
      if (l) l.textContent = 'Photo added';
      e.target.parentElement.querySelector('.fphoto').classList.add('on');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && hasHtml($('#pfRoot'))) {
      closePf();
      const b = document.querySelector('[data-pf-open]');
      if (b) b.focus();
      return;
    }
    if (e.key === 'Escape' && (SS.prod || SS.order || SS.input) && !document.querySelector('.modal')) {
      SS.prod = null;
      SS.order = null;
      SS.input = null;
      render();
      return;
    }
    if (e.key === 'Escape' && !document.querySelector('.modal') && (TS.person || VS.ent || VS.meet || RS.doc || CS.ag || CS.ct || NS.acct)) {
      NS.acct = null;
      TS.person = null;
      VS.ent = null;
      VS.meet = false;
      RS.doc = null;
      CS.ag = null;
      CS.ct = null;
      render();
      return;
    }
    if (e.key === 'Escape' && FS.scan != null) {
      FS.scan = null;
      FS.outcome = null;
      render();
      return;
    }
    if (e.key === 'Escape' && (GS.poster != null || MS.member != null || XS.merchant != null) && !document.querySelector('.modal')) {
      GS.poster = null;
      MS.member = null;
      XS.merchant = null;
      render();
      return;
    }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-merchant]')) {
      XS.merchant = e.target.dataset.merchant;
      render();
      return;
    }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-member]')) {
      MS.member = Number(e.target.dataset.member);
      render();
      return;
    }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-sinput]')) {
      SS.input = e.target.dataset.sinput;
      render();
      return;
    }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-poster]')) {
      GS.poster = Number(e.target.dataset.poster);
      render();
      return;
    }
    if (e.key === '[' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && !document.querySelector('.modal')) {
      e.preventDefault();
      return setRail(document.documentElement.dataset.rail === 'min' ? 'full' : 'min');
    }
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      $('#q').focus();
    }
  });

  /* ── Sign in: passkey first, a code by email as the fallback (Privy in the live app). Staff on the team list only. ── */

  (() => {
    const root = document.getElementById('loginRoot');
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sgn]');
      if (!b) return;
      const k = b.dataset.sgn;
      if (LIVE) {
        if (k === 'terms-ok') return live.liveTerms();
        if (k === 'passkey') return live.livePasskey();
        if (k === 'other') return live.liveOther();
        if (k === 'back') return sgnStep('start');
        if (k === 'resend') {
          sgnTimer(30);
          return live.liveResend();
        }
        return;
      }
      if (k === 'terms-ok') {
        const tp = PEOPLE_T.find((p) => p.id === SG.view.person);
        if (tp) tp.terms = 1;
        SG.view.terms = false;
        return sgnIn();
      }
      if (k === 'passkey') {
        SG.who = null;
        SG.view = null;
        sgnStep('passkey');
        setTimeout(() => {
          if (SG.step === 'passkey') sgnIn();
        }, 1800);
      }
      if (k === 'back') sgnStep('start');
      if (k === 'resend') {
        sgnTimer(30);
      }
    });
    root.addEventListener('change', (e) => {
      if (e.target.id === 'sgnKeep') SG.keep = e.target.checked;
    });
    root.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (document.getElementById('sgnEmail').value || '').trim().toLowerCase();
      SG.email = v;
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(v)) {
        const l = document.getElementById('sgnIn');
        l.classList.add('bad');
        l.querySelector('.sgn-err').textContent = v ? 'That doesn’t look like an email.' : 'Enter your email.';
        return;
      }
      if (LIVE) return live.liveSendCode(v);
      /* one login for everyone: a person on the team list gets their group (or custom) access, anyone else with a Clear account is a member */
      const tp = PEOPLE_T.find((p) => p.email === v && !p.off);
      SG.view = tp
        ? tp.role === 'admin'
          ? null
          : {
              g: tp.role,
              who: tp.n.split(' ')[0],
              levels: accOf(tp),
              person: tp.id,
              terms: tp.role === 'investors' && !tp.terms,
            }
        : {
            g: 'members',
            who:
              v
                .split('@')[0]
                .split(/[._-]/)[0]
                .replace(/^./, (c) => c.toUpperCase()) || 'Member',
          };
      SG.who = SG.view ? SG.view.who : null;
      sgnStep('code');
    });
    root.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'sgnEmail') {
        document.getElementById('sgnIn').classList.remove('bad');
        return;
      }
      if (!t.closest('#sgnCode')) return;
      const ins = [...root.querySelectorAll('#sgnCode input')],
        i = ins.indexOf(t);
      const d = t.value.replace(/\D/g, '');
      if (d.length > 1) {
        d.slice(0, 6 - i)
          .split('')
          .forEach((c, k) => {
            ins[i + k].value = c;
          });
      } else t.value = d;
      const next = ins.find((x) => !x.value);
      if (next) next.focus();
      else {
        sgnStep('verify');
        ins.forEach((x, k) => {
          const n = document.querySelectorAll('#sgnCode input')[k];
          if (n) n.value = x.value;
        });
        if (LIVE) return live.liveCode(ins.map((x) => x.value).join(''));
        setTimeout(sgnIn, 1100);
      }
    });
    root.addEventListener('keydown', (e) => {
      const t = e.target;
      if (!t.closest || !t.closest('#sgnCode') || e.key !== 'Backspace' || t.value) return;
      const ins = [...root.querySelectorAll('#sgnCode input')],
        i = ins.indexOf(t);
      if (i > 0) {
        ins[i - 1].value = '';
        ins[i - 1].focus();
        e.preventDefault();
      }
    });
  })();
  html(
    document.querySelector('.who-n'),
    <>
      <b style={css('font-weight:600')}>Kai</b> <span className="quiet">· Admin</span>
    </>,
  );
  const start = (location.hash || '').slice(1);
  // the live app opens on sign-in, or on the page asked for when this browser is still signed in
  if (LIVE) return void live.liveBoot(NAMES[start] || start.startsWith('invite=') ? start : '');
  go(NAMES[start] ? start : 'home');
  if (start === 'login') showLogin();
}
