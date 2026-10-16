import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OwnerSignIn } from '@/auth/OwnerSignIn';
import { useAuth } from '@/auth/authContext';
import { api, ApiError } from '@/data/apiClient';
import { useLayout } from '@/lib/useBreakpoint';
import { Button, PrimaryButton } from '@/shell/ui';
import { clearConnect, keepConnect, pendingConnect, readConnect, siteName, type ConnectRequest } from './connectFlow';

/**
 * /connect — signing a shop in to useclear.org, to reserve hardware (connect/connectFlow).
 *
 * Reached from the site's bag, on whatever computer the owner shops on, so it sits in front of the
 * tablet's enrollment and PIN screens rather than behind them: nothing here enrolls a device or
 * starts a shift. It needs the owner's own sign-in, as enrolling a tablet does, because the token it
 * hands back lets the site take a deposit in the shop's name.
 *
 * Once signed in it goes straight back. There is nothing to choose, and the site only accepts a
 * token for the sign-in it started, so a link to this page cannot sign anyone in to anything.
 */
export function ConnectPage() {
  const { session, refresh } = useAuth();
  const navigate = useNavigate();
  const phone = useLayout() === 'phone';
  const [req] = useState<ConnectRequest | null>(() => readConnect(window.location.search) ?? pendingConnect());
  const [error, setError] = useState('');
  const [going, setGoing] = useState(false);
  const asked = useRef(false);
  const site = siteName(req?.return ?? '');
  const isOwner = session?.staff.role === 'owner';

  useEffect(() => {
    if (!req) return;
    keepConnect(req);
    // Set up a shop: onboarding first. It ends with a way back here (see OnboardingPage).
    if (req.setup && !session) navigate('/onboarding', { replace: true });
  }, [req, session, navigate]);

  const goBack = async () => {
    if (!req) return;
    setError('');
    setGoing(true);
    try {
      const { redirect } = await api.connectToken({ return: req.return, state: req.state });
      clearConnect();
      window.location.assign(redirect);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
      setGoing(false);
    }
  };

  useEffect(() => {
    if (req && isOwner && !asked.current) {
      asked.current = true;
      void goBack();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req, isOwner]);

  const frame = (children: React.ReactNode) => (
    <div className="grid min-h-dvh place-items-center bg-[var(--clear-surface-2)] px-4">
      <div className="w-full max-w-[360px]">{children}</div>
    </div>
  );

  if (!req) {
    return frame(
      <>
        <p className="m-0 mb-1.5 text-[16px] font-medium">Nothing to sign in to</p>
        <p className="m-0 mb-4 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
          This page signs a shop in to useclear.org when you reserve hardware there. Start from your bag on useclear.org.
        </p>
        <Button onClick={() => navigate('/', { replace: true })} className="w-full">
          Go to the app
        </Button>
      </>,
    );
  }

  if (!isOwner) {
    return (
      <OwnerSignIn
        onDone={refresh}
        phone={phone}
        title={`Sign in to ${site}`}
        blurb={`To reserve hardware for your shop on ${site}, sign in as its owner. You come straight back to your bag.`}
        onSetUpShop={() => navigate('/onboarding')}
      />
    );
  }

  return frame(
    <>
      <p className="m-0 mb-1.5 text-[16px] font-medium">{error ? `Couldn’t sign in to ${site}` : `Back to ${site}…`}</p>
      <p className="m-0 mb-4 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]" role="status" aria-live="polite">
        {error || `Signing your shop in so you can reserve hardware. Your bag is waiting.`}
      </p>
      {error && (
        <div className="grid gap-2">
          <PrimaryButton onClick={goBack} disabled={going} className="w-full">
            Try again
          </PrimaryButton>
          <Button
            onClick={() => {
              clearConnect();
              navigate('/', { replace: true });
            }}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      )}
    </>,
  );
}
