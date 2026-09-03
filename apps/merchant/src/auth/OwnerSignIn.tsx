import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PrivyProvider, useLoginWithEmail, usePrivy } from '@privy-io/react-auth';
import { api } from '@/data/apiClient';
import { Button, PrimaryButton } from '@/shell/ui';

/**
 * Signing in as the owner — reference section 19.
 *
 * **No password field.** Privy signs in by emailed code, passkey or an existing wallet, and a
 * password box would imply Clear holds a credential it does not — on the one screen that controls
 * the money. Nothing in this app stores an owner secret; the backend takes a Privy token and
 * checks which shop that user owns.
 *
 * The subline says what this is for and, more usefully, what it is *not* for. An owner who thinks
 * signing in is required to take a payment will sign in on a shared tablet and leave it signed in,
 * which is exactly the outcome the device/shift/owner split exists to prevent. Taking a payment is
 * a shift; it starts with a PIN on the roster and needs none of this.
 *
 * Passkey is offered second but is the better path on a device an owner uses often. The emailed
 * code is the fallback that always works.
 */
const PRIVY_APP_ID = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined) ?? '';

/**
 * Privy wraps THIS SCREEN, not the app.
 *
 * An earlier version put the provider at the root, which was wrong in a way worth recording: Privy
 * throws on a missing or invalid app id, so a misconfigured environment took down the counter —
 * the one part of this app that needs no Privy at all. A shop whose owner cannot sign in must
 * still be able to take a payment.
 *
 * Scoping it here also matches what is true: counter staff have no Privy account, and a shift is
 * Clear's own record. Only an owner ever loads any of this.
 */
export function OwnerSignIn(props: {
  onDone: () => void;
  onBack?: () => void;
  /**
   * Onboarding needs the raw Privy token, not a session.
   *
   * A shop being created has no staff row to sign in as — that row is what onboarding produces —
   * so `signInAsOwner` would refuse. When this is given, the screen hands back the verified token
   * and lets the caller decide what it means. Same UI either way, because it is the same act.
   */
  onToken?: (token: string) => Promise<void>;
  title?: string;
  blurb?: ReactNode;
  /**
   * Rendered inside another screen rather than as one.
   *
   * Standalone this owns the viewport and centres itself; inside onboarding's step frame that
   * `min-h-dvh` becomes a tall empty box with the form floating in the middle of it. Same markup
   * either way, just without the wrapper that assumes it is the whole page.
   */
  embedded?: boolean;
}) {
  if (!PRIVY_APP_ID) {
    return (
      <div
        className={
          props.embedded
            ? ''
            : 'grid min-h-dvh place-items-center bg-[var(--clear-surface-2)] px-4'
        }
      >
        <div className={props.embedded ? 'w-full' : 'w-full max-w-[340px]'}>
          <p className="m-0 mb-1.5 text-[16px] font-medium">Owner sign-in is not set up</p>
          <p className="m-0 mb-4 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
            This tablet has no Privy app configured, so there is no way to verify an owner. The
            counter still works — staff can start a shift and raise charges.
          </p>
          {props.onBack && (
            <Button onClick={props.onBack} className="w-full">
              Back to the counter
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'passkey', 'wallet'],
        // No personal embedded wallet. The money lives in the shop's ORGANIZATION wallet, which
        // the backend creates and the key quorum owns; creating one here would be a second wallet
        // nobody asked for. Privy 3.x nests this per chain.
        embeddedWallets: { ethereum: { createOnLogin: 'off' } },
      }}
    >
      <OwnerSignInForm {...props} />
    </PrivyProvider>
  );
}

function OwnerSignInForm({
  onDone,
  onBack,
  onToken,
  title,
  blurb,
  embedded,
}: {
  onDone: () => void;
  onBack?: () => void;
  onToken?: (token: string) => Promise<void>;
  title?: string;
  blurb?: ReactNode;
  /**
   * Rendered inside another screen rather than as one.
   *
   * Standalone this owns the viewport and centres itself; inside onboarding's step frame that
   * `min-h-dvh` becomes a tall empty box with the form floating in the middle of it. Same markup
   * either way, just without the wrapper that assumes it is the whole page.
   */
  embedded?: boolean;
}) {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);

  /**
   * Exchange the Privy token for a merchant session — but only once Privy says it is signed in.
   *
   * `loginWithCode` resolving does NOT mean `getAccessToken()` will return a token: Privy's auth
   * state propagates through React a beat later. Calling it immediately returned null, threw
   * "That sign-in could not be verified", and left the screen exactly where it was — while the
   * emailed code had already been spent. Pressing the button again then sent Privy a code it had
   * consumed, which it correctly rejected as an invalid combination. The visible symptom was a
   * sign-in that silently refused to advance and then blamed the code.
   *
   * So this waits for `authenticated` rather than assuming login is synchronous.
   */
  /**
   * Callbacks held in refs, and adoption run exactly once.
   *
   * `onDone` and `onToken` arrive as inline arrows, so they are a new function on every render.
   * Putting them in the dependency array meant every re-render tore down the effect mid-flight —
   * the cleanup set `cancelled`, the completed adopt skipped `onDone()`, and a fresh adopt started
   * that the next render cancelled in turn. The session was being created server-side and then
   * thrown away, over and over, which is why the screen never advanced and the log looked quiet.
   *
   * The ref keeps the latest callback without making it a trigger, and `startedRef` means a
   * re-render cannot start a second adoption.
   */
  const cbRef = useRef({ onDone, onToken });
  cbRef.current = { onDone, onToken };
  const startedRef = useRef(false);

  useEffect(() => {
    if (!adopting || !authenticated || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('That sign-in could not be verified.');
        if (cbRef.current.onToken) await cbRef.current.onToken(token);
        else await api.signInAsOwner(token);
        cbRef.current.onDone();
      } catch (e) {
        // A failed adoption has to be retryable: the emailed code is spent, so the way back is a
        // new code, not another press. Clearing the flag lets that happen.
        startedRef.current = false;
        setError(e instanceof Error ? e.message : 'That did not work.');
      } finally {
        setAdopting(false);
        setBusy(false);
      }
    })();
  }, [adopting, authenticated, getAccessToken]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={
        embedded ? '' : 'grid min-h-dvh place-items-center bg-[var(--clear-surface-2)] px-4'
      }
    >
      <div className={embedded ? 'w-full' : 'w-full max-w-[340px]'}>
        {/* The product name belongs on a screen of its own, not on a step inside one. */}
        {!embedded && (
          <p className="m-0 mb-[3px] text-[11.5px] text-[var(--clear-text-muted)]">
            Clear for Merchants
          </p>
        )}
        {/* Embedded, the surrounding step already carries the heading — two of them reads as a
            rendering bug rather than emphasis. */}
        {(title || !embedded) && (
          <h1 className="m-0 mb-1.5 text-[16px] font-medium">{title ?? 'Sign in as the owner'}</h1>
        )}
        <div className="m-0 mb-[18px] text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
          {blurb ?? (
            <>
              Needed to move money, change terms or manage staff.{' '}
              <strong className="font-medium text-[var(--clear-text-primary)]">
                Not needed to take a payment.
              </strong>
            </>
          )}
        </div>

        {!sent ? (
          /*
           * A form, so Return submits.
           *
           * These were bare inputs beside a button, which meant typing a code and pressing Return —
           * the only thing a numeric keypad invites you to do — did nothing at all, silently. On a
           * counter tablet that reads as a broken app rather than a missing click.
           */
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!ready || busy || !email.includes('@')) return;
              void run(async () => {
                await sendCode({ email });
                setSent(true);
              });
            }}
          >
            <p className="m-0 mb-[3px] text-[11px] text-[var(--clear-text-muted)]">Email</p>
            <input
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (!ready || busy || !email.includes('@')) return;
                void run(async () => {
                  await sendCode({ email });
                  setSent(true);
                });
              }}
              placeholder="mike@mikestire.com"
              className="mb-2.5 w-full rounded-[10px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-1)] px-3.5 py-3 text-[14.5px] outline-none placeholder:text-[var(--clear-text-muted)]"
            />
            <PrimaryButton
              type="submit"
              disabled={!ready || busy || !email.includes('@')}
              className="!py-[13px] !text-[14px]"
            >
              {busy ? 'Sending…' : 'Email me a code'}
            </PrimaryButton>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (busy || code.length < 6) return;
              void run(async () => {
                await loginWithCode({ code });
                setAdopting(true);
              });
            }}
          >
            <p className="m-0 mb-[3px] text-[11px] text-[var(--clear-text-muted)]">
              The code we emailed {email}
            </p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (busy || code.length < 6) return;
                void run(async () => {
                  await loginWithCode({ code });
                  setAdopting(true);
                });
              }}
              autoFocus
              placeholder="······"
              className="mb-2.5 w-full rounded-[10px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-1)] px-3.5 py-3 text-[19px] tracking-[4px] outline-none placeholder:text-[var(--clear-text-muted)]"
            />
            <PrimaryButton
              type="submit"
              disabled={busy || adopting || code.length < 6}
              className="!py-[13px] !text-[14px]"
            >
              {busy || adopting ? 'Checking…' : 'Sign in'}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setCode('');
                setError(null);
              }}
              className="mt-2.5 w-full text-[11.5px] text-[var(--clear-text-secondary)] underline underline-offset-2"
            >
              Use a different email
            </button>
          </form>
        )}

        <div className="my-[18px] flex items-center gap-3">
          <span className="h-[0.5px] flex-1 bg-[var(--clear-border)]" />
          <span className="text-[11px] text-[var(--clear-text-muted)]">or</span>
          <span className="h-[0.5px] flex-1 bg-[var(--clear-border)]" />
        </div>

        {/* Offered second, better on a device the owner uses often. Privy's own flow covers
            passkeys and an existing wallet, so this hands off rather than rebuilding either. */}
        <Button
          disabled={!ready || busy || adopting}
          onClick={() =>
            run(async () => {
              await login();
              setAdopting(true);
            })
          }
          className="w-full !py-[13px] !text-[14px]"
        >
          Use a passkey
        </Button>

        {error && (
          <p role="alert" className="m-0 mt-3 text-center text-[13px]">
            {error}
          </p>
        )}

        {/* Only when there is a counter to go back to. A tablet that is not enrolled yet has no
            shift screen behind this, and offering one would dead-end. */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mt-4 block w-full text-center text-[12.5px] text-[var(--clear-text-accent)]"
          >
            Back to the counter
          </button>
        )}
      </div>
    </div>
  );
}
