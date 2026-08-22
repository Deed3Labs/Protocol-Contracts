import { useState } from 'react';
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
import OnboardingView, { type OnboardingResult } from './OnboardingView';

/**
 * Onboarding wrapper. The flow UI lives in the presentational <OnboardingView>; this
 * wrapper handles AppKit auth and maps the collected result to the member-onboarding
 * submit contract (bootstrap → onboarding → profile → terms → submit). Fields the new
 * flow doesn't collect use the previous valid defaults.
 */
export default function UserOnboarding() {
  const { isAuthenticated } = useAppKitAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleComplete = async (r: OnboardingResult) => {
    setSubmitting(true);
    setError(null);
    try {
      // The user reaches onboarding already signed in (routed here by the onboarding gate) — no wallet
      // re-connect / re-sign needed. If they somehow got here unauthenticated (e.g. the pre-auth
      // "See how it works" preview), send them to sign in first.
      if (!isAuthenticated) {
        navigate('/login');
        return;
      }

      const bootstrapped = await bootstrapMemberAccount();
      if (!bootstrapped) throw new Error("We couldn't create your member record.");

      const onboardingResult = await updateMemberOnboarding({
        currentStep: 'discovery',
        accessTrack: r.accessTrack,
        accountMethod: r.accountMethod,
        identityModeSelected: r.identityMode,
        referralSource: r.referralSource,
        inviteCode: r.inviteCode || null,
        incomeSource: '',
        reasons: r.reasons,
        goalsNote: null,
        recoveryMethod: 'passkey',
        residencyCountry: r.country,
        settlementCurrency: r.settlementCurrency,
        // Backend tracks YEARLY/LIFETIME; Standard (free) and Accelerated ($250/yr) both map to the annual record.
        membershipPlan: 'YEARLY',
        cardWaitlist: r.cardWaitlist,
        localPools: false,
      });
      if (!onboardingResult) throw new Error("We couldn't save your onboarding preferences.");

      const profileResult = await updateMemberProfile({
        username: r.username,
        displayName: r.username,
        legalName: null,
        email: r.email || null,
        phone: null,
        cityRegion: '',
        residencyCountry: r.country,
        settlementCurrency: r.settlementCurrency,
        notificationsOptIn: r.notificationsOptIn,
      });
      if (!profileResult) throw new Error("We couldn't save your profile details.");

      const termsResult = await acceptMemberTerms('membership_terms', '2026-03');
      if (!termsResult) throw new Error("We couldn't record your terms acceptance.");

      const account = await submitMemberOnboarding();
      if (!account) throw new Error("We couldn't complete onboarding.");

      track('onboarding_completed', { access: r.accessTrack }); // plan category only, no PII
      window.dispatchEvent(new Event('wallet-connected'));
      setTimeout(() => navigate('/', { replace: true }), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't finish onboarding.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardingView
      onComplete={handleComplete}
      onExit={() => navigate('/login')}
      submitting={submitting}
      error={error}
    />
  );
}
