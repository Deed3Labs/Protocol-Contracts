import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { submitClearOnboarding } from '@clear/member-kit/onboarding/submit';
import { track } from '@/lib/analytics';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { claimInstallUi } from '@/lib/installPrompt';
import { runPlaidLink } from '@/lib/plaidLink';
import { toIdentityStatus } from '@/lib/identityStatus';
import { closeOrFallback, doneLine } from '@/lib/approvalPage';
import {
  doneLede,
  handoffFrom,
  identityAfterSubmit,
  identityInput,
  identityValuesFrom,
  isOnboarded,
  needsJoining,
  nextStep,
  type IdentityValues,
  type JoinFinished,
  type JoinProgress,
  type JoinWindowView,
} from '@/lib/joinPay';
import {
  acceptMemberTerms,
  bootstrapMemberAccount,
  finishJoinWindow,
  getBankBalances,
  getJoinWindow,
  getLithicAccount,
  submitIdentity,
  submitMemberOnboarding,
  updateMemberOnboarding,
  updateMemberProfile,
} from '@/utils/apiClient';
import JoinPay, { type JoinScreen } from './JoinPay';

/**
 * `/join/pay?h=<handoff>`: Pay with Clear's join window (pay DECISIONS, "Joining").
 *
 * The shop's modal opens it at step 2 of 3, after the customer confirmed their phone or email and
 * typed the basics. In order: sign in with Privy (prefilled with that contact), the onboarding submit
 * chain, Lithic's identity check (the SSN is asked only here), a photo if Lithic wants one, the bank
 * (skippable), then `POST …/done`. The modal is polling, so finishing is what moves it to step 3;
 * the window closes itself, or says where to go when the browser won't.
 *
 * A member who's already onboarded and verified skips straight to finishing. A rejected identity
 * still finishes: the modal falls back to card.
 */
export default function JoinPayRoute() {
  const location = useLocation();
  const handoff = useMemo(() => handoffFrom(location.search), [location.search]);
  const { ready, login } = usePrivy();
  const { isAuthenticated, address, user } = useAppKitAuth();
  const profile = useMemberProfile();

  const [view, setView] = useState<JoinWindowView | null>(null);
  const [read, setRead] = useState<'loading' | 'ok' | 'signin' | 'ended' | 'error'>(handoff ? 'loading' : 'ended');
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState<JoinProgress | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<IdentityValues | null>(null);
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [finished, setFinished] = useState<JoinFinished | null>(null);
  const [ended, setEnded] = useState(false);
  const [stillOpen, setStillOpen] = useState(false);
  /** The automatic steps (the submit chain, finishing) run once each; Try again runs them again. */
  const ran = useRef<{ onboard: boolean; finish: boolean }>({ onboard: false, finish: false });

  // A window over the shop's page is no place for the install takeover.
  useEffect(() => claimInstallUi(), []);

  /*
   * Read the hand-off. Signed out, it asks without a session: if the API answers, the screen names
   * the shop and prefills sign-in with the confirmed contact; if it wants a session first (401), it
   * asks to sign in plainly. Signed in, it waits for the wallet, so the API sees the member's own.
   */
  useEffect(() => {
    if (!handoff || !ready) return;
    if (isAuthenticated && !address) return;
    let cancelled = false;
    void getJoinWindow(handoff).then((r) => {
      if (cancelled) return;
      if (r.kind === 'ok') {
        setView(r.data);
        setRead('ok');
      } else if (r.kind === 'ended') setRead('ended');
      else if (r.kind === 'signin' && !isAuthenticated) setRead('signin');
      else setRead('error');
    });
    return () => {
      cancelled = true;
    };
  }, [handoff, ready, isAuthenticated, address, attempt]);

  /*
   * Where this member stands, once: onboarded or not, Lithic's answer, a bank or not. A profile that
   * didn't load is an error to retry, not "new": running the submit chain on an existing member's
   * account would be the wrong guess.
   */
  useEffect(() => {
    // `basics` comes with the signed-in read; the signed-out one only names the shop.
    if (!isAuthenticated || !address || read !== 'ok' || !view?.basics || progress || !profile.loaded) return;
    if (profile.memberStatus == null) {
      setRead('error');
      return;
    }
    let cancelled = false;
    void (async () => {
      const onboarded = isOnboarded(profile.memberStatus);
      const account = onboarded ? await getLithicAccount() : null;
      // New, or a read that failed: not verified yet. Not configured at all: nothing to ask.
      const identity = account ? toIdentityStatus(account).state : 'unverified';
      const bankLinked = onboarded ? await getBankBalances(address).then((b) => Boolean(b?.linked)).catch(() => false) : false;
      if (cancelled) return;
      setProgress({
        onboarded,
        identity,
        identityTried: false,
        identityLater: false,
        joining: needsJoining(onboarded, identity),
        bankLinked,
        bankSkipped: false,
      });
      setValues(identityValuesFrom(view, user?.email));
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, address, read, view, progress, profile.loaded, profile.memberStatus, user?.email]);

  const step = progress ? nextStep(progress) : null;

  /** The submit chain, as the app's own onboarding sends it, from a shop's online checkout. */
  const onboard = useCallback(async () => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      await submitClearOnboarding(
        { bootstrapMemberAccount, updateMemberOnboarding, updateMemberProfile, acceptMemberTerms, submitMemberOnboarding },
        {
          invite: '',
          email: view.contact.channel === 'email' ? view.contact.value : '',
          contact: view.contact.channel === 'phone' ? view.contact.value : '',
        },
        { referralSource: 'online' },
      );
      track('onboarding_completed', { access: 'hybrid', entry: 'online' }); // no shop, no amount
      // Lithic hasn't seen them yet: verifying is next.
      setProgress((p) => (p ? { ...p, onboarded: true, identity: p.identity === 'unavailable' ? p.identity : 'unverified' } : p));
      profile.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't finish joining.");
    } finally {
      setBusy(false);
    }
  }, [view, profile]);

  useEffect(() => {
    if (step !== 'onboard' || ran.current.onboard) return;
    ran.current.onboard = true;
    void onboard();
  }, [step, onboard]);

  const submitIdentityForm = useCallback(async () => {
    if (!values) return;
    setError(null);
    const checked = identityInput(values);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setChecking(true);
    const result = await submitIdentity(checked.input);
    // The SSN doesn't outlive the request, whatever the answer.
    setValues((v) => (v ? { ...v, ssn: '' } : v));
    setChecking(false);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That didn't go through. Please try again.");
      return;
    }
    // The legal name, and only that, is kept on the profile (as the Verify identity form does).
    void updateMemberProfile({ legalName: `${checked.input.firstName} ${checked.input.lastName}` }).catch(() => {});
    setProgress((p) => (p ? { ...p, identity: identityAfterSubmit(result.kycStatus), identityTried: true } : p));
  }, [values]);

  const connectBank = useCallback(async () => {
    if (!address) return;
    setLinking(true);
    setLinkError(null);
    try {
      // False is closing Plaid, not failing: the step stays as it was.
      if (await runPlaidLink(address)) setProgress((p) => (p ? { ...p, bankLinked: true } : p));
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "We couldn't connect your bank.");
    } finally {
      setLinking(false);
    }
  }, [address]);

  const finish = useCallback(async () => {
    if (!handoff) return;
    setBusy(true);
    setError(null);
    const r = await finishJoinWindow(handoff);
    setBusy(false);
    if (r.kind === 'ok') {
      setFinished(r.data);
      track('join_window_finished', { limit: r.data.termLimitCents != null }); // whether, never how much
    } else if (r.kind === 'ended') setEnded(true);
    else setError('We couldn’t hand you back to the shop. Try again.');
  }, [handoff]);

  useEffect(() => {
    if (step !== 'finish' || ran.current.finish) return;
    ran.current.finish = true;
    void finish();
  }, [step, finish]);

  // Done: close, back to the shop's tab. A window the browser won't close says where to go.
  useEffect(() => {
    if (finished) closeOrFallback(window, () => setStillOpen(true));
  }, [finished]);

  const signIn = useCallback(() => {
    setError(null);
    // Privy sends its own code to the contact the modal confirmed.
    if (view) login({ prefill: { type: view.contact.channel, value: view.contact.value } });
    else login();
  }, [view, login]);

  const retry = useCallback(() => {
    setError(null);
    if (step === 'onboard') {
      void onboard();
      return;
    }
    if (step === 'finish') {
      void finish();
      return;
    }
    if (read === 'error' && profile.loaded && profile.memberStatus == null) profile.refresh();
    setRead('loading');
    setAttempt((n) => n + 1);
  }, [step, onboard, finish, read, profile]);

  const screen: JoinScreen = (() => {
    if (ended || read === 'ended') return 'ended';
    if (read === 'error') return 'unreadable';
    if (!ready || read === 'loading') return 'loading';
    if (!isAuthenticated) return read === 'signin' || read === 'ok' ? 'signin' : 'loading';
    if (finished) return 'done';
    if (checking) return 'checking';
    return step ?? 'loading';
  })();

  const host = view?.shopHost ?? null;

  return (
    <JoinPay
      screen={screen}
      view={view}
      busy={busy}
      error={error}
      onSignIn={signIn}
      onRetry={retry}
      identity={
        values
          ? {
              values,
              onChange: (patch) => setValues((v) => (v ? { ...v, ...patch } : v)),
              editing,
              onEdit: () => setEditing(true),
              onSubmit: () => void submitIdentityForm(),
              onLater: () => setProgress((p) => (p ? { ...p, identityLater: true } : p)),
            }
          : undefined
      }
      onDocumentDone={() => setProgress((p) => (p ? { ...p, identityLater: true } : p))}
      bank={{
        linked: progress?.bankLinked ?? false,
        busy: linking,
        error: linkError,
        onConnect: () => void connectBank(),
        onSkip: () => setProgress((p) => (p ? { ...p, bankSkipped: true } : p)),
      }}
      done={{
        lede: doneLede(finished, host, view?.shop.name ?? 'the shop', progress?.identity ?? 'unverified', progress?.identityLater ?? false),
        doneLine: stillOpen ? doneLine(host) : null,
        onClose: () => closeOrFallback(window, () => setStillOpen(true)),
      }}
    />
  );
}
