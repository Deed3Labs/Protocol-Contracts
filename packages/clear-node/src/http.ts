import { randomUUID } from 'node:crypto';
import { IDEMPOTENCY_HEADER, VERSION_HEADER, type ErrorType } from '@clear/public-api-contracts';
import { ClearError } from './errors';
import { SDK_VERSION } from './version';

export type RequestOptions = {
  /**
   * Makes a POST safe to send again: Clear answers a repeat with the first answer instead of doing it
   * twice. Use something of your own that names the thing ("catering-1042"). Without one, the SDK
   * makes one per call and reuses it across that call's retries.
   */
  idempotencyKey?: string;
};

export type HttpConfig = {
  secretKey: string;
  baseUrl: string;
  version: string;
  fetch: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
};

type Query = Record<string, string | number | boolean | null | undefined>;

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8_000;

/** Exponential backoff with jitter: half to all of 0.5s, 1s, 2s, … capped at 8s. */
const backoff = (retry: number) => {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** retry);
  return ceiling / 2 + Math.random() * (ceiling / 2);
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const retryable = (status: number) => status === 429 || status >= 500;

const ERROR_TYPES: readonly string[] = ['invalid_request', 'authentication', 'permission', 'not_found', 'conflict', 'rate_limit', 'api'];

export class Http {
  readonly #config: HttpConfig;

  constructor(config: HttpConfig) {
    this.#config = config;
  }

  async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, init: { query?: Query; body?: unknown; options?: RequestOptions } = {}): Promise<T> {
    const { secretKey, baseUrl, version, timeoutMs, maxRetries } = this.#config;
    const url = new URL(baseUrl.replace(/\/+$/, '') + path);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${secretKey}`,
      [VERSION_HEADER]: version,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': `useclear-node/${SDK_VERSION}`,
    };
    // One key per call, made before the first try, so every retry is the same request to Clear.
    if (method === 'POST') headers[IDEMPOTENCY_HEADER] = init.options?.idempotencyKey ?? randomUUID();
    const body = method === 'POST' ? JSON.stringify(init.body ?? {}) : undefined;

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < maxRetries;
      let res: Response;
      try {
        res = await this.#config.fetch(url.toString(), { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      } catch (cause) {
        if (canRetry) {
          await sleep(backoff(attempt));
          continue;
        }
        const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
        throw new ClearError({
          type: 'api',
          code: 'connection_error',
          message: timedOut
            ? `Clear didn't answer within ${timeoutMs}ms (${method} ${path}). It's safe to try again with the same idempotency key.`
            : `Couldn't reach Clear (${method} ${path}): ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        });
      }

      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }
      if (retryable(res.status) && canRetry) {
        await res.body?.cancel().catch(() => {});
        await sleep(backoff(attempt));
        continue;
      }
      throw await errorFrom(res);
    }
  }
}

async function errorFrom(res: Response): Promise<ClearError> {
  const requestId = res.headers.get('Request-Id') ?? res.headers.get('X-Request-Id');
  const text = await res.text().catch(() => '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const err = (parsed as { error?: Record<string, unknown> } | undefined)?.error;
  if (err && typeof err.type === 'string' && ERROR_TYPES.includes(err.type) && typeof err.code === 'string') {
    return new ClearError({
      type: err.type as ErrorType,
      code: err.code as ClearError['code'],
      message: typeof err.message === 'string' ? err.message : `Clear answered ${res.status}`,
      param: typeof err.param === 'string' ? err.param : undefined,
      status: res.status,
      requestId,
    });
  }
  return new ClearError({
    type: 'api',
    code: 'internal_error',
    message: `Clear answered ${res.status} without an error Clear sends${text ? `: ${text.slice(0, 200)}` : ''}`,
    status: res.status,
    requestId,
  });
}
