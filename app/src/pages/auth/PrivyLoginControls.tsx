import { useState } from 'react';
import { ArrowRight, Loader2, Mail, Phone } from 'lucide-react';
import { useLoginWithEmail, useLoginWithOAuth, useLoginWithSms } from '@privy-io/react-auth';

/*
 * Custom Privy login — identity only (email / phone / social). No wallet login: external wallets are
 * LINKED in-app (Privy linked accounts), and the Privy smart wallet is the user's primary wallet.
 * Email & phone are 2-step OTPs (send code → verify); socials redirect via initOAuth. All our own UI.
 * On success Privy flips `authenticated` → LoginPage navigates onward. See [[clearpath-privy-migration]].
 */

type OAuthProvider = 'google' | 'apple' | 'twitter' | 'discord' | 'github';
type Method = 'email' | 'phone';

const SOCIALS: { id: OAuthProvider; label: string }[] = [
  { id: 'apple', label: 'Apple' },
  { id: 'twitter', label: 'X' },
  { id: 'discord', label: 'Discord' },
  { id: 'github', label: 'GitHub' },
];

// Privy wants E.164 (+15551234567). Strip spaces/dashes/parens; keep a single leading +.
const normalizePhone = (raw: string) => '+' + raw.replace(/[^\d]/g, '');
const isValidPhone = (raw: string) => /^\+[1-9]\d{6,14}$/.test(normalizePhone(raw));

export default function PrivyLoginControls() {
  const { sendCode: sendEmailCode, loginWithCode: loginWithEmailCode } = useLoginWithEmail();
  const { sendCode: sendSmsCode, loginWithCode: loginWithSmsCode } = useLoginWithSms();
  const { initOAuth } = useLoginWithOAuth();

  const [method, setMethod] = useState<Method>('email');
  const [step, setStep] = useState<'enter' | 'code'>('enter');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const destination = method === 'email' ? email : normalizePhone(phone);

  const send = async () => {
    if (method === 'email' && !/^\S+@\S+\.\S+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if (method === 'phone' && !isValidPhone(phone)) {
      setError('Enter a valid phone number (e.g. +1 555 123 4567).');
      return;
    }
    setBusy('send');
    setError(null);
    try {
      if (method === 'email') await sendEmailCode({ email });
      else await sendSmsCode({ phoneNumber: normalizePhone(phone) });
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
      if (method === 'email') await loginWithEmailCode({ code });
      else await loginWithSmsCode({ code });
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

  const inputCls =
    'w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:outline-none';
  const socialBtn =
    'flex-1 rounded-xl border border-border py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50';

  if (step === 'code') {
    return (
      <div className="mt-6 space-y-3">
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code we sent to <span className="font-medium text-foreground">{destination}</span>.
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
            setStep('enter');
            setCode('');
            setError(null);
          }}
          className="w-full text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Use a different {method === 'email' ? 'email' : 'phone number'}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      {/* Email / Phone toggle */}
      <div className="flex gap-1 rounded-xl bg-secondary/50 p-1">
        {([
          { id: 'email' as const, label: 'Email', icon: Mail },
          { id: 'phone' as const, label: 'Phone', icon: Phone },
        ]).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setMethod(m.id);
              setError(null);
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors ${
              method === m.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <m.icon className="h-3.5 w-3.5" /> {m.label}
          </button>
        ))}
      </div>

      {/* Email or phone input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          {method === 'email' ? (
            <>
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="you@email.com"
                className={`${inputCls} pl-9`}
              />
            </>
          ) : (
            <>
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="+1 555 123 4567"
                className={`${inputCls} pl-9`}
              />
            </>
          )}
        </div>
        <button
          type="button"
          disabled={busy === 'send'}
          onClick={send}
          aria-label={`Continue with ${method}`}
          className="flex w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-40"
        >
          {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
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
    </div>
  );
}
