import { useEffect, useRef } from 'react';
import { refreshAllNow } from '@/lib/refreshAll';

/*
 * Re-read after the app comes back from the background.
 *
 * `chain:changed` is transient and fire-and-forget: the server emits it to whoever is connected at
 * that instant, and there is no replay. An installed PWA's socket does not survive backgrounding, so
 * a move made on desktop reached a phone that was asleep and was simply lost. Nothing on the phone
 * then re-read chain state -- the existing visibility handlers refresh notifications and balances,
 * neither of which is the credit limit -- so the figures stayed stale until a hard reload.
 *
 * The delay threshold is not caution for its own sake: `refreshAllNow` fans out to every chain-backed
 * read on the page, and firing that on each trivial app-switch is how a testing-only account runs up
 * a provider bill. Coming back after a glance at the notification shade does not need a re-read;
 * coming back after actually being away does.
 */
const MIN_HIDDEN_MS = 3_000;

export function useRefreshOnResume(): void {
  const hiddenSince = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenSince.current = Date.now();
        return;
      }
      const since = hiddenSince.current;
      hiddenSince.current = null;
      // No recorded hide means this fired without a matching hidden transition; treat it as a resume
      // rather than swallowing it, since the cost of one extra read beats staying stale.
      if (since === null || Date.now() - since >= MIN_HIDDEN_MS) refreshAllNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}
