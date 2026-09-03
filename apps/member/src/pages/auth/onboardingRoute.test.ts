import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The submit contract, checked against the source.
 *
 * The reference dropped ten questions because their answers stopped varying, and the container
 * fills them from that rather than from the member. A field quietly going missing is the failure
 * worth catching: `updateMemberOnboarding` would still succeed, and the member record would just
 * be wrong in a way nobody sees until somebody queries it.
 */
const SOURCE = readFileSync(join(import.meta.dir, 'OnboardingRoute.tsx'), 'utf8');

const REQUIRED = [
  'currentStep', 'accessTrack', 'accountMethod', 'identityModeSelected', 'referralSource',
  'inviteCode', 'incomeSource', 'reasons', 'goalsNote', 'recoveryMethod', 'residencyCountry',
  'settlementCurrency', 'membershipPlan', 'cardWaitlist', 'localPools',
];

describe('the submit contract', () => {
  for (const field of REQUIRED) {
    test(`sends ${field}`, () => {
      expect(SOURCE).toContain(`${field}:`);
    });
  }

  test('keeps reasons rather than dropping it', () => {
    // Sent empty on purpose. The reference removed the question from the door, which is not the
    // same as the co-op not wanting the answer — dropping the field would end the series instead
    // of moving the question.
    expect(SOURCE).toContain('reasons: []');
  });

  test('never sends a username, which bootstrap already assigned', () => {
    // Passing an empty one here would overwrite the handle nobody was asked for with nothing.
    expect(SOURCE).not.toMatch(/username:/);
  });

  test('defers identity rather than claiming the member declined it', () => {
    // Verification waits for the first deposit on both entries. "privacy" means not asked yet.
    expect(SOURCE).toContain("identityModeSelected: 'privacy'");
  });
});

describe('the flow it drives', () => {
  const FLOW = readFileSync(join(import.meta.dir, 'OnboardingFlow.tsx'), 'utf8');

  test('stays free of auth calls', () => {
    // The same component serves the live app and the preview harness. It can only do that by not
    // knowing which one it is in.
    expect(FLOW).not.toMatch(/apiClient|bootstrapMember|submitMemberOnboarding/);
  });
});
