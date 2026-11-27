import { useEffect, useRef } from 'react';

/**
 * Keep a screen current without a refresh: read again every `everyMs` while the tablet is showing
 * it, and at once whenever it comes back to the front. A member answers a charge on their phone;
 * the counter should see it without anyone reloading the page.
 *
 * Paused while the page is hidden (no reads nobody sees). `everyMs` null only refreshes on return.
 */
export function useLive(refresh: () => Promise<void> | void, everyMs: number | null): void {
  const ref = useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible';
    const onReturn = () => {
      if (visible()) void ref.current();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    const id = everyMs ? window.setInterval(onReturn, everyMs) : null;
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
      if (id !== null) window.clearInterval(id);
    };
  }, [everyMs]);
}

/** How often: every few seconds while a customer has a charge to answer, otherwise now and then. */
export const liveEvery = (anyWaiting: boolean) => (anyWaiting ? 4_000 : 20_000);
