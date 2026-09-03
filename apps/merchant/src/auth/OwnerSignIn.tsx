import { useState } from 'react';
import { PrivyProvider, useLoginWithEmail, usePrivy } from '@privy-io/react-auth';
import { api } from '@/data/apiClient';
import { merchantAddress } from '@/auth/AuthProvider';
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
export function OwnerSignIn(props: { onDone: () => void; onBack: () => void }) {
  if (!PRIVY_APP_ID) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[var(--clear-surface-2)] px-4">
        <div className="w-full max-w-[340px]">
          <p className="m-0 mb-1.5 text-[16px] font-medium">Owner sign-in is not set up</p>
          <p className="m-0 mb-4 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
            This tablet has no Privy app configured, so there is no way to verify an owner. The
            counter still works — staff can start a shift and raise charges.
          </p>
          <Button onClick={props.onBack} className="w-full">
            Back to the counter
          </Button>
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

function OwnerSignInForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const { ready, getAccessToken, login } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Exchange the Privy token for a merchant session. Privy says who; Clear says whose shop. */
  async function adoptSession() {
    const token = await getAccessToken();
    if (!token) throw new Error('That sign-in could not be verified.');
    await api.signInAsOwner(merchantAddress(), token);
    onDone();
  }

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
    <div className="grid min-h-dvh place-items-center bg-[var(--clear-surface-2)] px-4">
      <div className="w-full max-w-[340px]">
        <p className="m-0 mb-[3px] text-[11.5px] text-[var(--clear-text-muted)]">
          Clear for Merchants
        </p>
        <h1 className="m-0 mb-1.5 text-[16px] font-medium">Sign in as the owner</h1>
        <p className="m-0 mb-[18px] text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
          Needed to move money, change terms or manage staff.{' '}
          <strong className="font-medium text-[var(--clear-text-primary)]">
            Not needed to take a payment.
          </strong>
        </p>

        {!sent ? (
          <>
            <p className="m-0 mb-[3px] text-[11px] text-[var(--clear-text-muted)]">Email</p>
            <input
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mike@mikestire.com"
              className="mb-2.5 w-full rounded-[10px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-1)] px-3.5 py-3 text-[14.5px] outline-none placeholder:text-[var(--clear-text-muted)]"
            />
            <PrimaryButton
              disabled={!ready || busy || !email.includes('@')}
              onClick={() =>
                run(async () => {
                  await sendCode({ email });
                  setSent(true);
                })
              }
              className="!py-[13px] !text-[14px]"
            >
              {busy ? 'Sending…' : 'Email me a code'}
            </PrimaryButton>
          </>
        ) : (
          <>
            <p className="m-0 mb-[3px] text-[11px] text-[var(--clear-text-muted)]">
              The code we emailed {email}
            </p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="······"
              className="mb-2.5 w-full rounded-[10px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-1)] px-3.5 py-3 text-[19px] tracking-[4px] outline-none placeholder:text-[var(--clear-text-muted)]"
            />
            <PrimaryButton
              disabled={busy || code.length < 6}
              onClick={() =>
                run(async () => {
                  await loginWithCode({ code });
                  await adoptSession();
                })
              }
              className="!py-[13px] !text-[14px]"
            >
              {busy ? 'Checking…' : 'Sign in'}
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
          </>
        )}

        <div className="my-[18px] flex items-center gap-3">
          <span className="h-[0.5px] flex-1 bg-[var(--clear-border)]" />
          <span className="text-[11px] text-[var(--clear-text-muted)]">or</span>
          <span className="h-[0.5px] flex-1 bg-[var(--clear-border)]" />
        </div>

        {/* Offered second, better on a device the owner uses often. Privy's own flow covers
            passkeys and an existing wallet, so this hands off rather than rebuilding either. */}
        <Button
          disabled={!ready || busy}
          onClick={() =>
            run(async () => {
              await login();
              await adoptSession();
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

        <button
          type="button"
          onClick={onBack}
          className="mt-4 block w-full text-center text-[12.5px] text-[var(--clear-text-accent)]"
        >
          Back to the counter
        </button>
      </div>
    </div>
  );
}
