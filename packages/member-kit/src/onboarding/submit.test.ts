import { describe, expect, test } from 'bun:test';
import { type OnboardingApi, submitClearOnboarding } from './submit';

function api(fail?: keyof OnboardingApi) {
  const calls: Array<[string, unknown?]> = [];
  const step = (name: keyof OnboardingApi) => async (arg?: unknown) => {
    calls.push([name, arg]);
    return name === fail ? null : { ok: true };
  };
  return {
    calls,
    api: {
      bootstrapMemberAccount: step('bootstrapMemberAccount'),
      updateMemberOnboarding: step('updateMemberOnboarding'),
      updateMemberProfile: step('updateMemberProfile'),
      acceptMemberTerms: async (kind: string, version: string) => (calls.push(['acceptMemberTerms', `${kind}@${version}`]), fail === 'acceptMemberTerms' ? null : {}),
      submitMemberOnboarding: step('submitMemberOnboarding'),
    } satisfies OnboardingApi,
  };
}

describe('the onboarding submit chain', () => {
  test('bootstrap, answers, profile, terms, submit, in that order', async () => {
    const a = api();
    await submitClearOnboarding(a.api, { invite: ' MICASA ', email: '', contact: '(909) 555-0188' }, { referralSource: 'rewards' });
    expect(a.calls.map((c) => c[0])).toEqual(['bootstrapMemberAccount', 'updateMemberOnboarding', 'updateMemberProfile', 'acceptMemberTerms', 'submitMemberOnboarding']);
    expect(a.calls[1]![1]).toMatchObject({ referralSource: 'rewards', inviteCode: 'MICASA', identityModeSelected: 'privacy', reasons: [] });
    expect(a.calls[2]![1]).toMatchObject({ email: null, phone: '(909) 555-0188', notificationsOptIn: true });
    expect(a.calls[3]![1]).toBe('membership_terms@2026-03');
  });

  test('stops at the step that fails, and says which', async () => {
    const a = api('updateMemberProfile');
    await expect(submitClearOnboarding(a.api, { invite: '', email: '', contact: '' })).rejects.toThrow("We couldn't save your profile details.");
    expect(a.calls.map((c) => c[0])).not.toContain('acceptMemberTerms');
  });
});
