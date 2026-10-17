import { CLEAR_VERSION } from './constants';
import type { Config } from './config';
import type { SessionBody } from './options';
import type { ClearError } from './types';

export type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface SessionRequest {
  url: string;
  init: RequestInit;
}

/** `POST /v1/modal_sessions` with the publishable key. No cookies: the key and the page's Origin are the credentials. */
export function sessionRequest(config: Config, body: SessionBody): SessionRequest {
  return {
    url: `${config.apiBase}/v1/modal_sessions`,
    init: {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${config.key}`,
        'Clear-Version': CLEAR_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The frame's URL from the API's answer, if it's on `payOrigin` and in the key's mode. */
export function sessionUrl(answer: unknown, config: Config): string | ClearError {
  const bad = (message: string): ClearError => ({ code: 'invalid_response', message });
  if (!isObject(answer) || answer.object !== 'modal_session' || typeof answer.url !== 'string') {
    return bad("Clear's answer wasn't a modal session.");
  }
  let url: URL;
  try {
    url = new URL(answer.url);
  } catch {
    return bad("The modal session's url isn't a URL.");
  }
  if (url.origin !== config.payOrigin) return bad(`The modal session's url isn't on ${config.payOrigin}.`);
  if (typeof answer.livemode === 'boolean' && answer.livemode !== (config.mode === 'live')) {
    return bad("The modal session isn't in the key's mode.");
  }
  return url.href;
}

/** The API's `{ error: { code, message } }`, or a generic one for the status. */
export function apiError(answer: unknown, status: number): ClearError {
  const e = isObject(answer) && isObject(answer.error) ? answer.error : null;
  if (e && typeof e.code === 'string' && typeof e.message === 'string') return { code: e.code, message: e.message };
  return { code: status >= 500 ? 'api_error' : 'invalid_response', message: `Clear answered ${status}.` };
}

/** Makes the session: the frame's URL, or the error for `onError`. Never throws. */
export async function createSession(fetchFn: FetchLike, config: Config, body: SessionBody, signal?: AbortSignal): Promise<string | ClearError> {
  const { url, init } = sessionRequest(config, body);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchFn(url, { ...init, signal });
  } catch {
    return { code: 'network_error', message: "Couldn't reach Clear. Check the connection and try again." };
  }
  let answer: unknown = null;
  try {
    answer = await res.json();
  } catch {
    /* not JSON */
  }
  return res.ok ? sessionUrl(answer, config) : apiError(answer, res.status);
}
