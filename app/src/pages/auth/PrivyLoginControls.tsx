import { useState } from 'react';
import { ArrowRight, Loader2, Mail, Wallet } from 'lucide-react';
import { useLoginWithEmail, useLoginWithOAuth, usePrivy } from '@privy-io/react-auth';

/*
 * Custom Privy login. Email is a 2-step OTP (send code → verify) and socials redirect via initOAuth —
 * both fully our UI. External wallets use Privy's own wallet login `login({ loginMethods: ['wallet'] })`,
 * which handles connect + SIWE message + signature + session INTERNALLY (a manual generateSiweMessage +
 * personal_sign produced signatures Privy's /siwe/authenticate rejected as invalid). It opens a small
 * wallet-only Privy sheet; external wallets need their own extension popup anyway. On success Privy flips
 * `authenticated` → LoginPage navigates on. See [[clearpath-privy-migration]].
 */

type OAuthProvider = 'google' | 'apple' | 'twitter' | 'discord' | 'github';

const SOCIALS: { id: OAuthProvider; label: string }[] = [
  { id: 'apple', label: 'Apple' },
  { id: 'twitter', label: 'X' },
  { id: 'discord', label: 'Discord' },
  { id: 'github', label: 'GitHub' },
];

export default function PrivyLoginControls() {
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { initOAuth } = useLoginWithOAuth();
  const { login } = usePrivy();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendEmail = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy('email');
    setError(null);
    try {
      await sendCode({ email });
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the code.');
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    setBusy('code');
    setError(null);
    try {
      await loginWithCode({ code });
      // On success Privy authenticates; LoginPage's effect navigates onward.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid or expired code.');
    } finally {
      setBusy(null);
    }
  };

  const oauth = async (provider: OAuthProvider) => {
    setBusy(provider);
    setError(null);
    try {
      await initOAuth({ provider }); // redirects to the provider, returns authenticated
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
      setBusy(null);
    }
  };

  const loginWithWallet = () => {
    setError(null);
    // Privy handles connect + SIWE + signature + session; on success `authenticated` flips → navigate.
    login({ loginMethods: ['wallet'] });
  };

  const inputCls =
    'w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:outline-none';
  const socialBtn =
    'flex-1 rounded-xl border border-border py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50';

  if (step === 'code') {
    return (
      <div className="mt-6 space-y-3">
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code we sent to <span className="font-medium text-foreground">{email}</span>.
        </p>
        <input
          autoFocus
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verify()}
          placeholder="123456"
          className={`${inputCls} text-center tracking-[0.5em]`}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button
          type="button"
          disabled={code.length !== 6 || busy === 'code'}
          onClick={verify}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
        >
          {busy === 'code' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify & continue'}
        </button>
        <button
          type="button"
          onClick={() => {
            setStep('email');
            setCode('');
            setError(null);
          }}
          className="w-full text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      {/* Email */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendEmail()}
            placeholder="you@email.com"
            className={`${inputCls} pl-9`}
          />
        </div>
        <button
          type="button"
          disabled={busy === 'email'}
          onClick={sendEmail}
          aria-label="Continue with email"
          className="flex w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-40"
        >
          {busy === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>

      {/* Google (prominent) */}
      <button
        type="button"
        disabled={busy === 'google'}
        onClick={() => oauth('google')}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
      >
        {busy === 'google' ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="font-display text-base">G</span>}
        Continue with Google
      </button>

      {/* Other socials */}
      <div className="flex gap-2">
        {SOCIALS.map((s) => (
          <button key={s.id} type="button" disabled={busy === s.id} onClick={() => oauth(s.id)} className={socialBtn}>
            {busy === s.id ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : s.label}
          </button>
        ))}
      </div>

      {/* Wallet */}
      <button
        type="button"
        onClick={loginWithWallet}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
      >
        <Wallet className="h-4 w-4" /> Connect a wallet
      </button>
    </div>
  );
}
