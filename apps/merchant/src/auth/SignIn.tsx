import { useState } from 'react';
import { useAuth } from '@/auth/authContext';
import { STUB_MERCHANT } from '@/data/stubs';

/**
 * Getting in, for the two people who do.
 *
 * Counter staff use a PIN because they sign in twenty times a shift on a shared tablet, and a
 * password typed that often on a device the public can see is a password everyone in the shop
 * knows by Friday. An owner gets a real password, because they reach money.
 *
 * The PIN pad is the default view: the person standing at the counter is overwhelmingly the one
 * signing in, so their path is the one already open.
 */
export function SignIn() {
  const { signInWithPin, signInWithPassword } = useAuth();
  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--clear-surface-2)] px-4">
      <div className="w-full max-w-[360px]">
        <p className="mb-1 text-[13px] text-[var(--clear-text-muted)]">Clear for Merchants</p>
        <h1 className="mb-5 text-[21px] font-semibold tracking-[-0.01em]">{STUB_MERCHANT.name}</h1>

        <div className="rounded-[var(--clear-radius)] border border-[var(--clear-border)] bg-[var(--clear-surface-2)] p-4">
          {mode === 'pin' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(() => signInWithPin(pin));
              }}
            >
              <label htmlFor="pin" className="mb-1.5 block text-[13px]">
                Your PIN
              </label>
              <input
                id="pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-[var(--clear-radius-sm)] border border-[var(--clear-border-strong)] bg-[var(--clear-surface-2)] px-3 py-2.5 text-[21px] tracking-[0.4em]"
                placeholder="••••"
              />
              <button
                type="submit"
                disabled={busy || pin.length !== 4}
                className="mt-3 w-full rounded-[var(--clear-radius-sm)] bg-[var(--clear-text-accent)] px-3 py-2.5 text-[15px] font-medium text-[var(--clear-surface-2)] disabled:opacity-40"
              >
                {busy ? 'Checking…' : 'Start shift'}
              </button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(() => signInWithPassword(email, password));
              }}
            >
              <label htmlFor="email" className="mb-1.5 block text-[13px]">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mb-3 w-full rounded-[var(--clear-radius-sm)] border border-[var(--clear-border-strong)] bg-[var(--clear-surface-2)] px-3 py-2 text-[15px]"
              />
              <label htmlFor="password" className="mb-1.5 block text-[13px]">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-[var(--clear-radius-sm)] border border-[var(--clear-border-strong)] bg-[var(--clear-surface-2)] px-3 py-2 text-[15px]"
              />
              <button
                type="submit"
                disabled={busy || !email || password.length < 8}
                className="mt-3 w-full rounded-[var(--clear-radius-sm)] bg-[var(--clear-text-accent)] px-3 py-2.5 text-[15px] font-medium text-[var(--clear-surface-2)] disabled:opacity-40"
              >
                {busy ? 'Checking…' : 'Sign in'}
              </button>
            </form>
          )}

          {error && (
            <p role="alert" className="mt-3 text-[13px] text-[var(--clear-text-primary)]">
              {error}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'pin' ? 'password' : 'pin');
            setError(null);
          }}
          className="mt-3 w-full text-[11.5px] text-[var(--clear-text-secondary)] underline underline-offset-2"
        >
          {mode === 'pin' ? 'Owner sign in' : 'Back to PIN'}
        </button>
      </div>
    </div>
  );
}
