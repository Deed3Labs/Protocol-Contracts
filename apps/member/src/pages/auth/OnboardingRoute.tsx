import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { track } from '@/lib/analytics';
import {
  acceptMemberTerms,
  bootstrapMemberAccount,
  submitMemberOnboarding,
  updateMemberOnboarding,
  updateMemberProfile,
  getServedZipPrefixes,
} from '@/utils/apiClient';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { isServed } from '@/lib/servedRegion';
import OnboardingFlow, {
  type OnboardingStep,
  type OnboardingValues,
} from './OnboardingFlow';
import { submitClearOnboarding } from '@clear/member-kit/onboarding/submit';

/**
 * The real onboarding: the rebuilt flow, with the submit chain behind it.
 *
 * Starts at `join`, not `enter`. A member reaching /onboarding has already signed in — the gate
 * sent them here — so the contact and code steps belong to `LoginRoute`, which drives the same
 * two screens of this same component.
 * Beginning at `enter` would put a second sign-in in front of somebody already signed in.
 *
 * The flow stays presentational. It reports step changes and field edits; every decision about
 * what a step *means* is made here, which is what lets the same component serve the preview
 * harness and the live app without knowing which it is in.
 */

export default function OnboardingRoute() {
  const { isAuthenticated } = useAppKitAuth();
  const profile = useMemberProfile();
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
  const [servedPrefixes, setServedPrefixes] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getServedZipPrefixes().then((prefixes) => {
      if (!cancelled) setServedPrefixes(prefixes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onValuesChange = useCallback((patch: Partial<OnboardingValues>) => {
    setValues((previous) => ({ ...previous, ...patch }));
  }, []);

  /** Sends what the flow collected, and what it no longer asks (see submitClearOnboarding). */
  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (!isAuthenticated) {
        navigate('/login');
        return;
      }

      // The chain itself is shared with the rewards app's Set up Clear (packages/member-kit).
      await submitClearOnboarding(
        { bootstrapMemberAccount, updateMemberOnboarding, updateMemberProfile, acceptMemberTerms, submitMemberOnboarding },
        values,
        { referralSource: 'direct' },
      );

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

      // Only diverts on a definite no. An unreadable list means we do not know where the co-op
      // serves, and sending somebody who lives in the region to a waiting list for it is the worse
      // of the two mistakes -- they can always be told later that they are covered.
      if (step === 'join' && next === 'identity' && values.zip) {
        if (isServed(values.zip, servedPrefixes) === false) {
          setStep('waitlist');
          return;
        }
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
    [step, submitting, values.zip, servedPrefixes, submit],
  );

  const flow = useMemo(
    () => (
      <OnboardingFlow
        step={step}
        onStepChange={onStepChange}
        values={values}
        onValuesChange={onValuesChange}
        // The Verify step shows a legal name it did not ask for. It comes from the linked account
        // when there is one, and stays empty rather than guessing from a display handle.
        member={profile.legalName ? { name: profile.legalName, handle: profile.handle } : undefined}
      />
    ),
    [step, onStepChange, values, onValuesChange, profile.legalName, profile.handle],
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
