// @ts-nocheck: reads and writes the sections' untyped data (src/sections/data.tsx).
import { BOARD, XS } from '../sections/data';
import { toast } from '../sections/shell';
import { api, apiFile } from './api';
import { LIVE } from './env';
import { reloadSection } from './sections';

/*
 * The sections' own actions, saved through the API (POST /actions/:section/:kind). Each one either
 * runs (and the section is loaded again, so the page shows what the server now holds), records an
 * outside act in the outbox, or waits for a second person in Needs you.
 */

/** Runs an action and reloads its section. Resolves to the API's answer. */
export async function act(section: string, kind: string, body: Record<string, unknown> = {}) {
  const r = await api('POST', `/actions/${section}/${kind}`, body);
  await reloadSection(section);
  // anything waiting for a second person shows in Needs you
  if (r.proposal) await import('./account').then((m) => m.loadWaiting()).catch(() => undefined);
  return r;
}

/** Closing words for an action that went for a second person, or was recorded for an outside system. */
const WAITING = ['Sent for a second person.', 'It runs once someone else approves it in Needs you.'];
const QUEUED = (done) => [done?.[0] ?? 'Recorded.', 'Recorded for the outside system. Nothing is sent yet: that’s connected in a later phase.'];

/**
 * Makes a flow save through the API when it's confirmed (the vModal and Contracts confirm handlers
 * run `f.api` live). `body` is read at confirm time, so it sees what was typed.
 */
export function live(f, section: string, kind: string, body: () => Record<string, unknown> = () => ({})) {
  if (!LIVE || !f) return f;
  f.api = async () => {
    const r = await act(section, kind, body());
    if (r.proposal) f.done = WAITING;
    else if (r.queued) f.done = QUEUED(f.done);
    return r;
  };
  return f;
}

/** Runs an action from a listener: saves, shows the error if it fails, then redraws. */
export function run(section: string, kind: string, body: Record<string, unknown>, then?: (r) => void) {
  if (!LIVE) return;
  act(section, kind, body).then(
    (r) => {
      if (r.proposal) toast('Sent for a second person · it runs once someone else approves it');
      then?.(r);
      window.dispatchEvent(new Event('command:changed'));
    },
    (e) => toast(e.message),
  );
}

/** Adds a file for a section (records, field) and resolves to its id. */
export async function addFile(section: string, file: File) {
  const r = await apiFile(`/files?section=${section}&name=${encodeURIComponent(file.name)}`, file);
  return r.file.id as string;
}

// ── the pipeline board: cards are edited on the page, then saved whole ─────

const timers = new Map();
/** The card as the API saves it, with the log lines added since it was last saved, oldest first. */
function cardBody(c) {
  const saved = c._saved ?? 0,
    fresh = (c.log || []).slice(0, Math.max(0, (c.log || []).length - saved)).reverse();
  return {
    id: c.id,
    name: c.name || 'Untitled',
    kind: c.kind || '',
    city: c.city || '',
    stage: c.stage,
    owner: c.owner ?? null,
    val: c.val ?? null,
    next: c.next || null,
    due: c.due ?? null,
    contact: { name: '', role: '', phone: '', email: '', ...(c.contact || {}) },
    source: c.source || '',
    addr: c.addr || '',
    ...(c.sells ? { sells: c.sells } : {}),
    note: c.note || '',
    flag: !!c.flag,
    log: fresh.map(([, text, , type]) => ({ text, type: type || 'edit' })),
  };
}
/** Saves a card shortly after it changes (typing in its fields saves once, not per key). */
export function saveCard(c) {
  if (!LIVE || !c) return;
  clearTimeout(timers.get(c.id));
  timers.set(
    c.id,
    setTimeout(() => {
      const n = (c.log || []).length;
      api('POST', '/actions/merchants/card-save', cardBody(c)).then(
        () => (c._saved = n),
        (e) => toast(e.message),
      );
    }, 400),
  );
}
/** Saves the board's order after a drag, and the moved card. */
let orderTimer;
export function saveOrder(c) {
  if (!LIVE || !XS.board) return;
  saveCard(c);
  // after the card's own save, so a new card is there to be placed
  clearTimeout(orderTimer);
  orderTimer = setTimeout(() => api('POST', '/actions/merchants/board-order', { ids: XS.board.map((x) => x.id) }).catch((e) => toast(e.message)), 900);
}
/** Takes a card off the board, or puts it back (the Undo). */
export const removeCard = (c, reason) => LIVE && api('POST', '/actions/merchants/card-remove', { id: c.id, reason }).catch((e) => toast(e.message));
export const restoreCard = (c) => LIVE && api('POST', '/actions/merchants/card-restore', { id: c.id }).catch((e) => toast(e.message));
/** The board's cards as the API sent them, with how much of each log is already saved. */
export const boardFromApi = () => BOARD.map((c) => ({ ...c, contact: { ...c.contact }, _saved: (c.log || []).length }));

// ── what's typed in the open flow ──────────────────────────────────────────

/** The open flow's text fields, in order. */
export const typed = () => [...document.querySelectorAll('#modalRoot input[type="text"], #modalRoot input:not([type]), #modalRoot textarea')].map((i) => i.value.trim());
/** The open flow's choices: the pressed buttons of each segmented group, in order. */
export const picked = () => [...document.querySelectorAll('#modalRoot .seg2')].map((g) => [...g.querySelectorAll('[aria-pressed="true"]')].map((b) => b.textContent.trim()));
/** A typed amount: "$44.00" is 44. */
export const dollars = (s) => Number(String(s ?? '').replace(/[^0-9.]/g, '')) || 0;
