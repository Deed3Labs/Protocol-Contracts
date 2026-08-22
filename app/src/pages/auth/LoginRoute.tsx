import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLoginWithEmail, useLoginWithOAuth, useLoginWithSms } from '@privy-io/react-auth';
import { track } from '@/lib/analytics';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import OnboardingFlow, { type OnboardingStep, type OnboardingValues } from './OnboardingFlow';

/**
 * Signing in, on the reference's own entry screen.
 *
 * The screens already existed — `enter` and `verify` were built to the reference during the
 * rebuild and wired to nothing, exactly as the onboarding flows were. This is the container that
 * makes them do something, and it is built headlessly rather than on Privy's modal because the
 * reference is specific about what this screen says and a modal cannot say it.
 *
 * **One field for both.** The reference's footnote is the product decision: *"Signing in and
 * signing up are the same. We'll figure out which."* So there is no account-exists check and no
 * separate sign-up path — a phone gets an SMS code, an email gets an emailed one, and Privy
 * creates the account if there is not one.
 *
 * Phase E was deliberately left last because it is the step most likely to lock somebody out. The
 * shape of that risk here is specific: an unrecognised contact must not be turned away, a wrong
 * code must not consume the whole attempt budget silently, and a member who was sent here from
 * somewhere else must land back there rather than on the home screen.
 */

/** A contact is a phone if it is mostly digits. Anything else is treated as an email. */
export function looksLikePhone(contact: string): boolean {
  const trimmed = contact.trim();
  if (!trimmed || trimmed.includes('@')) return false;
  const digits = trimmed.replace(/\D/g, '');
  // Ten for a US number, eleven with the country code. Fewer is a typo, not a phone — and
  // guessing "phone" on four digits would send an SMS code nowhere and blame the member.
  return digits.length >= 10 && /^[+\d\s().-]+$/.test(trimmed);
}

const RESEND_SECONDS = 24;

export default function LoginRoute() {
  const { isAuthenticated } = useAppKitAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const email = useLoginWithEmail();
  const sms = useLoginWithSms();
  const oauth = useLoginWithOAuth();

  const [step, setStep] = useState<OnboardingStep>('enter');
  const [values, setValues] = useState<OnboardingValues>({
    contact: '',
    code: '',
    zip: '',
    invite: '',
    email: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  // Which channel the code went to. Read at verify time rather than re-derived, so editing the
  // field after the code was sent cannot send the answer to the other one.
  const channel = useRef<'sms' | 'email' | null>(null);
  const navigated = useRef(false);

  /** Where they were going before the gate sent them here. */
  const destination = useMemo(() => {
    const from = (location.state as { from?: { pathname?: string; search?: string; hash?: string } } | undefined)?.from;
    if (!from?.pathname) return '/';
    return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
  }, [location.state]);

  useEffect(() => {
    if (!isAuthenticated || navigated.current) return;
    navigated.current = true;
    window.dispatchEvent(new Event('wallet-connected'));
    navigate(destination, { replace: true });
  }, [isAuthenticated, destination, navigate]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const onValuesChange = useCallback((patch: Partial<OnboardingValues>) => {
    setValues((previous) => ({ ...previous, ...patch }));
  }, []);

  const send = useCallback(
    async (contact: string) => {
      const trimmed = contact.trim();
      if (!trimmed) {
        setError('Enter a phone number or an email address.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        if (looksLikePhone(trimmed)) {
          channel.current = 'sms';
          await sms.sendCode({ phoneNumber: trimmed });
        } else {
          channel.current = 'email';
          await email.sendCode({ email: trimmed });
        }
        setResendIn(RESEND_SECONDS);
        setStep('verify');
        track('login_code_sent', { channel: channel.current }); // channel only, never the contact
      } catch (e) {
        setError(e instanceof Error ? e.message : "We couldn't send a code to that.");
      } finally {
        setBusy(false);
      }
    },
    [email, sms],
  );

  const submitCode = useCallback(
    async (code: string) => {
      setBusy(true);
      setError(null);
      try {
        if (channel.current === 'sms') await sms.loginWithCode({ code });
        else await email.loginWithCode({ code });
        // No navigation here. The effect above owns it, so signing in through any route — this
        // code, OAuth, or a session that was already live — leaves from the same place.
      } catch (e) {
        // Cleared so the next attempt starts empty. Privy allows five tries per code, and leaving
        // a wrong one in the boxes is how somebody spends the rest of them re-submitting it.
        setValues((previous) => ({ ...previous, code: '' }));
        setError(e instanceof Error ? e.message : 'That code did not work. Try again.');
      } finally {
        setBusy(false);
      }
    },
    [email, sms],
  );

  const startOAuth = useCallback(
    async (provider: 'google' | 'apple') => {
      setBusy(true);
      setError(null);
      try {
        await oauth.initOAuth({ provider });
      } catch (e) {
        setError(e instanceof Error ? e.message : "We couldn't reach that sign-in.");
        setBusy(false);
      }
      // Not cleared on success: OAuth navigates away, and re-enabling the buttons underneath a
      // redirect that is already happening only invites a second press.
    },
    [oauth],
  );

  const auth = useMemo(
    () => ({
      busy,
      error,
      resendIn,
      onContinue: () => void send(values.contact),
      onOAuth: (provider: 'google' | 'apple') => void startOAuth(provider),
      onSubmitCode: (code: string) => void submitCode(code),
      onResend: () => void send(values.contact),
    }),
    [busy, error, resendIn, send, startOAuth, submitCode, values.contact],
  );

  return (
    <OnboardingFlow
      step={step}
      onStepChange={(next) => {
        // Back to `enter` is the only move this screen offers. Anything further belongs to
        // onboarding, which runs after there is an account.
        if (next === 'enter') setStep('enter');
      }}
      values={values}
      onValuesChange={onValuesChange}
      sentTo={values.contact || 'your phone'}
      auth={auth}
    />
  );
}
