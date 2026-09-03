import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/data/apiClient';

/**
 * One fetch, with the three states every screen in this app has to render.
 *
 * Not a cache. A counter tablet wants what is true now — a charge that cleared while the writer
 * was on another screen should be cleared when they come back — and re-reading on navigation is
 * both simpler and more correct than invalidating something. These lists are small.
 *
 * `error` is a sentence, never a status code. Every failure state in this product has to leave the
 * writer something to say to the person across the counter, so the message comes from the server's
 * own wording where there is one and falls back to something a person can actually act on.
 *
 * A 403 resolves to empty rather than an error: counter staff are legitimately refused payouts and
 * staff, and the pages that ask already hide those sections. Rendering "something went wrong" for
 * a rule working as designed would send a writer to find the owner over nothing.
 */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Held in a ref so a caller can pass an inline arrow without re-fetching every render. `deps` is
  // what actually decides when this runs, exactly as it would for useEffect.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fnRef
      .current()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 403) {
          setData(null);
          return;
        }
        // Only a server-worded message reaches a writer. A failed fetch throws
        // `TypeError: Failed to fetch`, which is true, useless at a counter, and not something
        // anybody can say to the person standing there — so an unreachable server gets a sentence
        // about what to do instead of the browser's word for what broke.
        setError(
          e instanceof ApiError
            ? e.message
            : 'Could not reach Clear. Take the ticket the usual way and try again.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}
