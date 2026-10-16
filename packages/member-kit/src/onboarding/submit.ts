/**
 * The Clear onboarding submit chain: bootstrap the member record, then the onboarding answers, the
 * profile, the terms, and submit. Shared by the Clear app's onboarding and the rewards app's Set up
 * Clear, so both send the same thing (rewards DECISIONS, Phase 1 › Shared code).
 *
 * The reference dropped ten of these questions because the answers stopped varying: one region,
 * one membership plan, one account method, identity deferred to the first deposit. They are filled
 * from that rather than from the member, and each one that is a real default says so.
 */

/** The member API calls the chain makes; each answers null when it couldn't. */
export interface OnboardingApi {
  bootstrapMemberAccount(): Promise<unknown | null>;
  updateMemberOnboarding(input: Record<string, unknown>): Promise<unknown | null>;
  updateMemberProfile(input: Record<string, unknown>): Promise<unknown | null>;
  acceptMemberTerms(kind: string, version: string): Promise<unknown | null>;
  submitMemberOnboarding(): Promise<unknown | null>;
}

export interface OnboardingAnswers {
  invite: string;
  email: string;
  contact: string;
}

/** Where they came in: directly, through a shop's counter code, or from a shop's rewards app. */
export type ReferralSource = 'direct' | 'counter' | 'rewards';

export async function submitClearOnboarding(api: OnboardingApi, values: OnboardingAnswers, opts: { referralSource?: ReferralSource } = {}): Promise<void> {
  const bootstrapped = await api.bootstrapMemberAccount();
  if (!bootstrapped) throw new Error("We couldn't create your member record.");

  const onboarding = await api.updateMemberOnboarding({
    currentStep: 'discovery',
    // Privy embedded is the only path now, so these follow from it rather than from a choice.
    accessTrack: 'hybrid',
    accountMethod: 'appkit-account',
    // Verification is deferred to the first deposit, on both entries. Not "unverified" as a
    // state somebody chose — not asked yet.
    identityModeSelected: 'privacy',
    // The branch itself is the answer: arriving directly rather than through a shop's code.
    referralSource: opts.referralSource ?? 'direct',
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
  const profile = await api.updateMemberProfile({
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

  const terms = await api.acceptMemberTerms('membership_terms', '2026-03');
  if (!terms) throw new Error("We couldn't record your terms acceptance.");

  const account = await api.submitMemberOnboarding();
  if (!account) throw new Error("We couldn't complete onboarding.");
}
