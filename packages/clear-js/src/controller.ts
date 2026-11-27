import { pageProblem, type Config } from './config';
import { READY_TIMEOUT_MS } from './constants';
import type { Plan } from './options';
import { acceptMessage } from './protocol';
import { createSession, type FetchLike } from './session';
import type { ClearError } from './types';

/** The modal on screen. `modal.ts` draws it; the tests use a fake. */
export interface View {
  /** The scrim, the box and its loading state. `dismiss` is Esc on the page, or a click on the scrim. */
  show(dismiss: () => void): void;
  /** The frame, at the session's URL. */
  load(url: string): void;
  /** The frame's window, which is the only `event.source` the script listens to. */
  frame(): unknown;
  ready(): void;
  height(px: number): void;
  /** Takes it all away and gives the page back its scroll and focus. */
  close(): void;
}

export interface MessageLike {
  origin: string;
  source: unknown;
  data: unknown;
}

export interface Env {
  fetch: FetchLike;
  location: { protocol: string; hostname: string };
  /** Listens for `message` on the window; returns the unlisten. */
  listen(fn: (event: MessageLike) => void): () => void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  /** A callback threw: surface it without stopping the script. */
  report(error: unknown): void;
  error(message: string): void;
}

/** One modal at a time, across every instance and attachment on the page. */
let busy = false;
export const isBusy = (): boolean => busy;

/**
 * A click: checks the page, makes the session, opens the frame and answers its messages. Returns
 * false when a modal is already open (the click does nothing). Never throws; everything wrong goes
 * to `onError`.
 */
export function start(config: Config, plan: Plan, makeView: () => View, env: Env): boolean {
  if (busy) return false;
  const { callbacks } = plan;

  const call = <A extends unknown[]>(fn: ((...a: A) => void) | undefined, ...args: A) => {
    try {
      fn?.(...args);
    } catch (e) {
      env.report(e);
    }
  };
  const fail = (err: ClearError) => {
    env.error(`Pay with Clear: ${err.message} (${err.code})`);
    call(callbacks.onError, err);
  };

  const insecure = pageProblem(env.location, config.mode);
  if (insecure) return fail({ code: 'insecure_page', message: insecure }), true;
  if (plan.problem) return fail({ code: 'invalid_options', message: plan.problem }), true;

  busy = true;
  const view = makeView();
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  let done = false;
  let unlisten: (() => void) | null = null;
  let timer: unknown = null;

  const finish = () => {
    if (done) return;
    done = true;
    busy = false;
    env.clearTimeout(timer);
    unlisten?.();
    abort?.abort();
    view.close();
  };

  view.show(() => {
    finish();
    call(callbacks.onCancel);
  });

  timer = env.setTimeout(() => {
    finish();
    fail({ code: 'unavailable', message: "Pay with Clear didn't load. Try again, or choose another way to pay." });
  }, READY_TIMEOUT_MS);

  void createSession(env.fetch, config, plan.body, abort?.signal).then((url) => {
    if (done) return;
    if (typeof url !== 'string') return finish(), fail(url);

    unlisten = env.listen((event) => {
      if (done) return;
      const msg = acceptMessage(event, view.frame(), config.payOrigin);
      if (!msg) return;
      switch (msg.type) {
        case 'ready':
          env.clearTimeout(timer);
          view.ready();
          break;
        case 'resize':
          view.height(msg.height);
          break;
        case 'success': {
          const result = { id: msg.id, status: msg.status, reference: msg.reference === null ? null : msg.reference.trim() };
          call(callbacks.onSuccess, result);
          finish();
          break;
        }
        case 'cancel':
          finish();
          call(callbacks.onCancel);
          break;
        case 'error':
          call(callbacks.onError, { code: msg.code, message: msg.message });
          if (msg.code === 'session_expired' || msg.code === 'origin_not_allowed') finish();
          break;
      }
    });
    view.load(url);
  });
  return true;
}
