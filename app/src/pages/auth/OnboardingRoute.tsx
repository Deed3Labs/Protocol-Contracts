import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { track } from '@/lib/analytics';
import {
  acceptMemberTerms,
  bootstrapMemberAccount,
  submitMemberOnboarding,
  updateMemberOnboarding,
  updateMemberProfile,
} from '@/utils/apiClient';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import OnboardingFlow, {
  type OnboardingStep,
  type OnboardingValues,
} from './OnboardingFlow';

/**
 * The real onboarding: the rebuilt flow, with the submit chain behind it.
 *
 * Starts at `join`, not `enter`. A member reaching /onboarding has already signed in — the gate
 * sent them here — so the contact and code steps belong to LoginPage until that is rebuilt too.
 * Beginning at `enter` would put a second sign-in in front of somebody already signed in.
 *
 * The flow stays presentational. It reports step changes and field edits; every decision about
 * what a step *means* is made here, which is what lets the same component serve the preview
 * harness and the live app without knowing which it is in.
 */

/** ZIPs the co-op serves. Anything else goes to the waitlist rather than through. */
const SERVED_PREFIXES = ['923', '924', '925'];

function isServed(zip: string): boolean {
  const trimmed = zip.trim();
  return SERVED_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export default function OnboardingRoute() {
  const { isAuthenticated } = useAppKitAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<OnboardingStep>('join');
  const [values, setValues] = useState<OnboardingValues>({
    contact: '',
    code: '',
    zip: '',
    invite: '',
    email: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onValuesChange = useCallback((patch: Partial<OnboardingValues>) => {
    setValues((previous) => ({ ...previous, ...patch }));
  }, []);

  /**
   * Sends what the flow collected, and what it no longer asks.
   *
   * The reference dropped ten of these questions because the answers stopped varying — one region,
   * one membership plan, one account method, identity deferred to the first deposit. They are
   * filled from that rather than from the member, and each one that is a real default says so.
   */
  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (!isAuthenticated) {
        navigate('/login');
        return;
      }

      const bootstrapped = await bootstrapMemberAccount();
      if (!bootstrapped) throw new Error("We couldn't create your member record.");

      const onboarding = await updateMemberOnboarding({
        currentStep: 'discovery',
        // Privy embedded is the only path now, so these follow from it rather than from a choice.
        accessTrack: 'hybrid',
        accountMethod: 'appkit-account',
        // Verification is deferred to the first deposit, on both entries. Not "unverified" as a
        // state somebody chose — not asked yet.
        identityModeSelected: 'privacy',
        // The branch itself is the answer: arriving directly rather than through a shop's code.
        referralSource: 'direct',
        inviteCode: values.invite.trim() || null,
        incomeSource: '',
        // The old flow asked why somebody was joining and this one does not. Kept in the contract
        // and sent empty rather than dropped: the reference removed the question from the door,
        // which is not the same as the co-op not wanting the answer. Better asked after day one,
        // when they can describe what they did instead of what they intended.
        reasons: [],
        goalsNote: null,
        recoveryMethod: 'passkey',
        residencyCountry: 'US',
        settlementCurrency: 'USD',
        membershipPlan: 'YEARLY',
        // No card-waitlist step in the reference.
        cardWaitlist: false,
        localPools: false,
      });
      if (!onboarding) throw new Error("We couldn't save your onboarding preferences.");

      // No username is sent. Bootstrap assigns a handle nobody was asked for, and passing an empty
      // one here would overwrite it with nothing.
      const profile = await updateMemberProfile({
        displayName: null,
        legalName: null,
        email: values.email.trim() || null,
        phone: values.contact.trim() || null,
        cityRegion: '',
        residencyCountry: 'US',
        settlementCurrency: 'USD',
        // The flow's own copy says a code arrives by text; consenting to that is the flow.
        notificationsOptIn: true,
      });
      if (!profile) throw new Error("We couldn't save your profile details.");

      const terms = await acceptMemberTerms('membership_terms', '2026-03');
      if (!terms) throw new Error("We couldn't record your terms acceptance.");

      const account = await submitMemberOnboarding();
      if (!account) throw new Error("We couldn't complete onboarding.");

      track('onboarding_completed', { access: 'hybrid' }); // plan category only, no PII
      window.dispatchEvent(new Event('wallet-connected'));
      setTimeout(() => navigate('/', { replace: true }), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't finish onboarding.");
    } finally {
      setSubmitting(false);
    }
  }, [isAuthenticated, navigate, values]);

  /**
   * What a step change means.
   *
   * The flow says where somebody wants to go; this decides whether they get there. Leaving `join`
   * is the only transition that carries a decision — an unserved ZIP goes to the waitlist instead
   * of through, which is the one place the flow branches on something it collected.
   */
  const onStepChange = useCallback(
    (next: OnboardingStep) => {
      if (submitting) return;

      if (step === 'join' && next === 'identity' && values.zip && !isServed(values.zip)) {
        setStep('waitlist');
        return;
      }

      // Identity is the last step and it is skippable by design: verification waits for the first
      // deposit, so reaching it means the member is done here.
      if (next === 'identity') {
        setStep('identity');
        void submit();
        return;
      }

      setStep(next);
    },
    [step, submitting, values.zip, submit],
  );

  const flow = useMemo(
    () => (
      <OnboardingFlow
        step={step}
        onStepChange={onStepChange}
        values={values}
        onValuesChange={onValuesChange}
      />
    ),
    [step, onStepChange, values, onValuesChange],
  );

  return (
    <>
      {flow}
      {error && (
        <p className="fixed inset-x-0 bottom-4 mx-auto max-w-sm rounded-lg bg-negative/10 px-4 py-2 text-center text-[13px] text-negative">
          {error}
        </p>
      )}
    </>
  );
}
