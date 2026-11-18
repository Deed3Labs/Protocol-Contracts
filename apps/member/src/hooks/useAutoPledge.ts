import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { ACTIVE_CHAIN_ID } from '@/lib/clearNetwork';
import { hasCreditLine } from '@/lib/autoPledgeSchedule';
import { autoPledgeSetting, lastKnownAutoPledge, runAutoPledge, saveAutoPledgeSetting } from '@/lib/autoPledge';
import type { CreditState } from '@/utils/apiClient';

/**
 * Back the line with what the member already holds, in the background (Savings and Earn only).
 *
 * Runs when the credit read first shows a line, and again whenever the app comes back to the front.
 * The ten-minute window and the one-at-a-time rule live in the pledger, so calling this often is
 * cheap: most calls return without asking anybody anything. Nothing here is awaited by the page and
 * nothing it does can throw into it.
 */
export function useAutoPledge(member: string | undefined, credit: CreditState | null): void {
  // The wallet has to be connected to sign; before it is, an attempt would only fail and wait out
  // the window.
  const { isConnected } = useAccount();
  const hasLine = hasCreditLine(credit);
  const latest = useRef({ member, hasLine, ready: isConnected });
  latest.current = { member, hasLine, ready: isConnected };

  const attempt = useCallback(() => {
    const { member: who, hasLine: line, ready } = latest.current;
    if (!who || !line || !ready) return;
    void autoPledgeSetting(who)
      .then((enabled) => runAutoPledge({ member: who, chainId: ACTIVE_CHAIN_ID, hasLine: line, enabled }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    attempt();
  }, [attempt, member, hasLine, isConnected]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (!document.hidden) attempt();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [attempt]);
}

export interface AutoPledgeSetting {
  enabled: boolean;
  busy: boolean;
  error: string | null;
  onChange: (enabled: boolean) => void;
}

/** The Settings switch: on by default, saved on the server so it follows the member. */
export function useAutoPledgeSetting(member: string | undefined): AutoPledgeSetting {
  const [enabled, setEnabled] = useState<boolean>(() => (member ? lastKnownAutoPledge(member) ?? true : true));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    setEnabled(lastKnownAutoPledge(member) ?? true);
    void autoPledgeSetting(member).then((on) => {
      if (!cancelled && on !== null) setEnabled(on);
    });
    return () => {
      cancelled = true;
    };
  }, [member]);

  const onChange = useCallback(
    (next: boolean) => {
      if (!member) return;
      setBusy(true);
      setError(null);
      void saveAutoPledgeSetting(member, next).then((saved) => {
        setBusy(false);
        if (saved.ok) setEnabled(next);
        else setError(saved.error ?? 'That did not save. Nothing changed.');
      });
    },
    [member],
  );

  return { enabled, busy, error, onChange };
}
