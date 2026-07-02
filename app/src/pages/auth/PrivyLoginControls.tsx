import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Loader2, Mail, Phone, X } from 'lucide-react';
import { useLoginWithEmail, useLoginWithOAuth, useLoginWithSms } from '@privy-io/react-auth';

/*
 * Custom Privy login — identity only (email / phone / social). No wallet login: external wallets are
 * LINKED in-app (Privy linked accounts), and the Privy smart wallet is the user's primary wallet.
 * Email & phone are the guaranteed methods (2-step OTP: send code → verify), shown up front. Socials
 * (OAuth redirect) live behind a "More ways to sign in" slide-up sheet. On success Privy flips
 * `authenticated` → LoginPage routes onward. See [[clearpath-privy-migration]].
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

const inputCls =
  'w-full rounded-2xl border border-border bg-background px-4 py-4 text-base text-foreground placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:outline-none';

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
  const [showMore, setShowMore] = useState(false);

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
      // On success Privy authenticates; LoginPage's effect routes onward.
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

  // ---- Code step ----
  if (step === 'code') {
    return (
      <div className="space-y-3">
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
          className={`${inputCls} text-center text-xl tracking-[0.5em]`}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button
          type="button"
          disabled={code.length !== 6 || busy === 'code'}
          onClick={verify}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
        >
          {busy === 'code' ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Verify & continue'}
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

  // ---- Enter step ----
  return (
    <div className="space-y-3">
      {/* Email / Phone toggle */}
      <div className="flex gap-1 rounded-2xl bg-secondary/60 p-1">
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
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-colors ${
              method === m.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <m.icon className="h-4 w-4" /> {m.label}
          </button>
        ))}
      </div>

      {/* Email or phone input */}
      <div className="relative">
        {method === 'email' ? (
          <>
            <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="you@email.com"
              className={`${inputCls} pl-11`}
            />
          </>
        ) : (
          <>
            <Phone className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="+1 555 123 4567"
              className={`${inputCls} pl-11`}
            />
          </>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <button
        type="button"
        disabled={busy === 'send'}
        onClick={send}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
      >
        {busy === 'send' ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Continue <ArrowRight className="h-4 w-4" /></>}
      </button>

      <button
        type="button"
        onClick={() => setShowMore(true)}
        className="w-full pt-1 text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        More ways to sign in
      </button>

      {/* Socials — slide-up sheet */}
      <AnimatePresence>
        {showMore && (
          <>
            <motion.div
              className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMore(false)}
            />
            <motion.div
              className="fixed inset-x-0 bottom-0 z-[110] mx-auto max-w-[440px] rounded-t-3xl border-t border-border bg-card px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground">More ways to sign in</h3>
                <button type="button" onClick={() => setShowMore(false)} aria-label="Close" className="rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <button
                type="button"
                disabled={busy === 'google'}
                onClick={() => oauth('google')}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-background py-3.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
              >
                {busy === 'google' ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="font-display text-base">G</span>}
                Continue with Google
              </button>

              <div className="grid grid-cols-2 gap-2">
                {SOCIALS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={busy === s.id}
                    onClick={() => oauth(s.id)}
                    className="rounded-2xl border border-border py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                  >
                    {busy === s.id ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : s.label}
                  </button>
                ))}
              </div>

              {error && <p className="mt-3 text-center text-xs text-destructive">{error}</p>}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
