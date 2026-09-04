import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./ChargeApprovalRoute.tsx', import.meta.url), 'utf8');
const HOOK = readFileSync(new URL('../../hooks/useMemberProfile.ts', import.meta.url), 'utf8');

/**
 * A charge is opened once and opening it claims it, so the decision of whose screen this is has to
 * be made before the read rather than corrected after it.
 */
describe('the profile settles before the charge is opened', () => {
  test('the read waits on the profile', () => {
    expect(SOURCE).toContain('if (!profileLoaded) return;');
  });

  test('a non-member never glimpses an approval they cannot give', () => {
    expect(SOURCE).toContain('if (loading || (isAuthenticated && !profileLoaded))');
  });

  test('a failed profile read still counts as settled, so nobody is parked on a spinner', () => {
    const block = HOOK.slice(HOOK.indexOf('} finally {'), HOOK.indexOf('}, [isConnected'));
    expect(block).toContain('setLoaded(true)');
  });
});

/**
 * Somebody who scanned the tablet without an account goes to signup carrying the charge, rather
 * than to an approval screen they have no membership to act on — merchant reference section 03.
 */
describe('a scanner who is not a member yet is sent to signup', () => {
  test('onboarding routes to the counter flow with the code', () => {
    expect(SOURCE).toContain("memberStatus === 'ONBOARDING'");
    expect(SOURCE).toContain("navigate(`/s/${shopSlug(");
    expect(SOURCE).toContain("new URLSearchParams({ c: code })");
  });

  test('the redirect replaces, so back does not land on a screen they were moved off', () => {
    const branch = SOURCE.slice(SOURCE.indexOf("memberStatus === 'ONBOARDING'"));
    expect(branch.slice(0, 400)).toContain('{ replace: true }');
  });
});

/**
 * iOS will not open an installed home screen app for a scanned link, and its storage is a separate
 * jar from Safari's — so a member with the app lands here signed out. The code is the way across.
 */
describe('the handoff into the installed app', () => {
  test('is offered on iOS outside the app, and nowhere else', () => {
    expect(SOURCE).toContain("appHandoffCode={installMode === 'ios' ? charge.code : null}");
  });

  test('the line names the code and the screen that takes it', () => {
    const view = readFileSync(new URL('./ChargeApproval.tsx', import.meta.url), 'utf8');
    expect(view).toContain('Have the Clear app?');
    expect(view).toContain('{appHandoffCode}');
    expect(view).toContain('Scan screen');
  });
});
