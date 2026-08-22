import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { looksLikePhone } from './LoginRoute';

const SOURCE = readFileSync(join(import.meta.dir, 'LoginRoute.tsx'), 'utf8');
const FLOW = readFileSync(join(import.meta.dir, 'OnboardingFlow.tsx'), 'utf8');

/*
 * One field for both, so this function decides which channel a code goes to. Guessing wrong sends
 * it somewhere the member cannot read and then blames them for not having it.
 */
describe('telling a phone from an email', () => {
  test('reads real phone numbers', () => {
    for (const value of ['9095550148', '(909) 555-0148', '909-555-0148', '+1 909 555 0148']) {
      expect(looksLikePhone(value)).toBe(true);
    }
  });

  test('reads emails', () => {
    for (const value of ['kai@example.com', 'a.b+c@sub.example.co.uk']) {
      expect(looksLikePhone(value)).toBe(false);
    }
  });

  test('a short string of digits is a typo, not a phone', () => {
    // Guessing "phone" here would send an SMS code nowhere.
    for (const value of ['4921', '', '   ', '555']) expect(looksLikePhone(value)).toBe(false);
  });

  test('anything with an @ is an email even if it has digits', () => {
    expect(looksLikePhone('9095550148@example.com')).toBe(false);
  });
});

describe('signing in and signing up are the same', () => {
  test('there is no account-exists check to turn anybody away', () => {
    expect(SOURCE).not.toContain('disableSignup');
    expect(FLOW).toContain('Signing in and signing up are the same');
  });
});

/*
 * Phase E was left last because it is the step most likely to lock somebody out. These are the
 * specific shapes of that.
 */
describe('not locking anybody out', () => {
  test('a wrong code clears the boxes', () => {
    // Privy allows five tries per code. Leaving a wrong one in is how somebody spends the rest of
    // them re-submitting the same digits.
    expect(SOURCE).toContain("setValues((previous) => ({ ...previous, code: '' }))");
  });

  test('the channel is remembered rather than re-derived at verify time', () => {
    // Editing the field after the code was sent must not send the answer to the other channel.
    expect(SOURCE).toContain('channel.current');
    const submit = SOURCE.slice(SOURCE.indexOf('const submitCode ='), SOURCE.indexOf('const startOAuth ='));
    expect(submit).toContain("channel.current === 'sms'");
    expect(submit).not.toContain('looksLikePhone');
  });

  test('somebody sent here from elsewhere lands back there', () => {
    expect(SOURCE).toContain('const destination = useMemo');
    expect(SOURCE).toContain('navigate(destination, { replace: true })');
  });

  test('and one place owns that navigation', () => {
    // Code, OAuth and an already-live session all leave from the same effect, so no path can
    // authenticate and then sit on the login screen.
    expect(SOURCE.split('navigate(destination').length - 1).toBe(1);
    expect(SOURCE).toContain('if (!isAuthenticated || navigated.current) return;');
  });

  test('the resend is a real countdown, not a printed string', () => {
    expect(SOURCE).toContain('setResendIn((n) => n - 1)');
    expect(FLOW).toContain('Send a new code');
  });
});

describe('the code submits itself', () => {
  test('on the sixth digit rather than behind a button', () => {
    // Nothing else is decided on that screen, and a code waiting for a press is a step somebody
    // has to be told to take.
    expect(FLOW).toContain('next.length === 6');
  });
});

describe('the preview harness still renders these screens', () => {
  test('auth is optional, so the buttons fall back to advancing the step', () => {
    expect(FLOW).toContain('auth?: {');
    expect(FLOW).toContain("onClick={auth ? auth.onContinue : go('verify')}");
  });
});
