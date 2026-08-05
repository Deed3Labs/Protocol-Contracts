import { useEffect, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { useKyc } from '@/context/KycContext';
import { cn } from '@/lib/utils';

const DISMISS_KEY = 'clear.verifyPopdown.dismissedAt';
/** How long a dismissal sticks before the prompt returns. */
const SNOOZE_MS = 24 * 60 * 60 * 1000;

/**
 * Verify-your-identity prompt — a floating pop-down rather than a banner in the page flow.
 *
 * It drops in over the content, can be dismissed, and stays gone for a day so it never becomes
 * a permanent shelf above the dashboard. Verified members never see it.
 */
export default function VerifyPopdown() {
  const { verified, openKyc } = useKyc();
  const [dismissed, setDismissed] = useState(true); // assume dismissed until storage is read
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    let snoozed = false;
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      snoozed = Number.isFinite(at) && Date.now() - at < SNOOZE_MS;
    } catch {
      snoozed = false; // private mode / storage disabled — just show it
    }
    setDismissed(snoozed);
    if (!snoozed) {
      const t = setTimeout(() => setEntered(true), 350);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    setEntered(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* nothing to persist to — the prompt simply returns next load */
    }
    setTimeout(() => setDismissed(true), 200);
  };

  if (verified || dismissed) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center px-4 lg:pl-[17rem]">
      <div
        role="status"
        className={cn(
          'pointer-events-auto flex w-full max-w-xl items-center gap-3 border border-border bg-popover px-4 py-3 shadow-lg',
          'transition-all duration-200 motion-reduce:transition-none',
          entered ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0',
        )}
      >
        <ShieldCheck className="h-[18px] w-[18px] shrink-0 text-info" strokeWidth={1.5} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-foreground">Verify your identity</span>
          <span className="block text-xs text-muted-foreground">
            Unlock bank deposits, withdrawals, transfers &amp; bill pay.
          </span>
        </span>
        <button
          type="button"
          onClick={() => openKyc()}
          className="shrink-0 bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Verify
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
