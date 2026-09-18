import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import OnboardingFlow from '@/pages/auth/OnboardingFlow';
import { useFaceId } from '@/hooks/useFaceId';
import { useLogout } from '@/hooks/useLogout';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { forgetMember, rememberedMember } from '@/lib/rememberedMember';
import { isStale, lastActive, markActive } from '@/lib/appLock';
import { markStepUpVerified, setStepUpVerifier } from '@/lib/stepUp';

/** Activity is written at most this often; the lock only needs to know roughly when. */
const WRITE_EVERY_MS = 15 * 1000;
const CHECK_EVERY_MS = 30 * 1000;
const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * The lock — what a banking app shows when you come back to it.
 *
 * Five minutes idle, or five minutes away, and the app opens on the welcome screen instead of the
 * account. It is a lock and not a sign-out: the session stays, so Face ID opens it again in a glance
 * and nothing has to reload. A member without Face ID sends themselves a code, which does sign them
 * out and back in, because a code is a sign-in.
 *
 * The account is not drawn underneath. While locked, the children are not rendered at all — the
 * balances are not in the page for a screenshot, a screen reader or an inspector to find. The
 * providers above this stay mounted, so unlocking does not refetch everything.
 *
 * It also registers the step-up gate (lib/stepUp), since both need the same Face ID and the same
 * signed-in shell. The lock hides the app; step-up is what protects the money.
 */
export default function AppLock({ children }: { children: ReactNode }) {
  const faceId = useFaceId();
  const member = useMemberProfile();
  const logout = useLogout();
  const [locked, setLocked] = useState(() => isStale(lastActive()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const faceIdRef = useRef(faceId);
  faceIdRef.current = faceId;

  useEffect(() => {
    // A session this device has not timed yet starts its clock now.
    if (lastActive() === null) markActive();
    let lastWrite = 0;

    const onActivity = () => {
      if (lockedRef.current) return;
      const now = Date.now();
      if (now - lastWrite < WRITE_EVERY_MS) return;
      lastWrite = now;
      markActive(now);
    };
    const check = () => {
      if (!lockedRef.current && isStale(lastActive())) setLocked(true);
    };
    // Leaving stamps the time, so "away for five minutes" is measured from when they left.
    const onVisibility = () => {
      if (document.hidden) {
        if (!lockedRef.current) markActive();
      } else {
        check();
      }
    };

    ACTIVITY.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    const id = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    // Members without Face ID pass: their protection is the code that got them past the lock.
    setStepUpVerifier(async () => {
      if (!faceIdRef.current.on) return;
      await faceIdRef.current.confirm();
    });
    return () => setStepUpVerifier(null);
  }, []);

  const unlock = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await faceIdRef.current.confirm();
      markActive();
      // Unlocking was a Face ID check, so a send straight afterwards does not ask again.
      markStepUpVerified();
      setLocked(false);
    } catch {
      setError('Face ID did not open Clear. Try again, or send yourself a code.');
    } finally {
      setBusy(false);
    }
  }, []);

  if (!locked) return <>{children}</>;

  const remembered = rememberedMember();
  const name = member.name || remembered?.name || '';
  const handle = member.handle || remembered?.handle || '';

  return (
    <OnboardingFlow
      step="welcome"
      member={name ? { name, handle } : undefined}
      onStepChange={(next) => {
        // "Not you?" — somebody else is holding this phone, so the device stops remembering who.
        if (next === 'enter') {
          forgetMember();
          void logout();
        }
      }}
      auth={{
        busy,
        error,
        resendIn: 0,
        // A code is a sign-in, so it goes through the real one: sign out, and the login screen
        // sends the code straight away rather than making them ask twice.
        onContinue: () => void logout({ sendCode: true }),
        onOAuth: () => {},
        onSubmitCode: () => {},
        onResend: () => {},
        onPasskey: faceId.on ? () => void unlock() : undefined,
      }}
    />
  );
}
