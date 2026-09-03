import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePendingTotal, shopDisplayName } from '@clear/domain';
import { isServed } from '@/lib/servedRegion';
import { installActionLabel } from '@/lib/installPrompt';

const SOURCE = readFileSync(join(import.meta.dir, 'CounterOnboardingRoute.tsx'), 'utf8');

/*
 * The pending total arrives in a URL, which means it arrives from whoever wrote the URL.
 *
 * These are the tests that matter most in this file. Everything else here is a signup detail; this
 * is the one input a stranger controls, and the rule it has to keep is that it can motivate a
 * signup and never authorize a debt.
 */
describe('the pending total from the code', () => {
  test('reads a plain amount', () => {
    expect(parsePendingTotal('940')).toBe(940);
    expect(parsePendingTotal('940.00')).toBe(940);
    expect(parsePendingTotal('12.34')).toBe(12.34);
  });

  test('absent is null, not zero', () => {
    // A printed shop sticker carries no sale. "No pending total" is a different screen from "a
    // pending total of nothing", and the flow renders them differently.
    expect(parsePendingTotal(null)).toBeNull();
    expect(parsePendingTotal('')).toBeNull();
  });

  test('rejects what is not a number', () => {
    expect(parsePendingTotal('nine hundred')).toBeNull();
    expect(parsePendingTotal('NaN')).toBeNull();
    expect(parsePendingTotal('Infinity')).toBeNull();
  });

  test('rejects nothing-or-less', () => {
    expect(parsePendingTotal('0')).toBeNull();
    expect(parsePendingTotal('-940')).toBeNull();
  });

  test('bounds what an arbitrary URL can put on screen', () => {
    expect(parsePendingTotal('100000')).toBe(100000);
    expect(parsePendingTotal('100001')).toBeNull();
    expect(parsePendingTotal('999999999')).toBeNull();
  });
});

/*
 * The amount is display-only, and this is the guard that keeps it that way. If a later change
 * reaches for the URL total when creating a plan, this is what should fail.
 */
describe('the total never becomes an obligation', () => {
  test('the only figure treated as approved is read back from the contracts', () => {
    expect(SOURCE).toContain('getCredit(address)');
    expect(SOURCE).toContain('setApprovedCents');
  });

  test('a failed credit read leaves approval unset rather than zero', () => {
    // getCredit returns null when the chain could not be read. A member whose RPC blipped has not
    // been declined, and writing a zero here would tell them they had been.
    expect(SOURCE).toContain('if (!credit) return;');
  });
});

describe('the shop from the code', () => {
  test('reads as a name', () => {
    expect(shopDisplayName('mikes-tire')).toBe('Mikes Tire');
    expect(shopDisplayName('corner_market')).toBe('Corner Market');
    expect(shopDisplayName('bodega')).toBe('Bodega');
  });

  test('survives a malformed slug', () => {
    expect(shopDisplayName('')).toBe('');
    expect(shopDisplayName('--')).toBe('');
  });
});

/*
 * §6.4, resolved: required for the plan, not for the membership. Both halves are load-bearing and
 * either one alone is the wrong answer, so both are pinned.
 */
describe('the bank link is required for the plan, not the membership', () => {
  test('skipping still joins them', () => {
    expect(SOURCE).toContain('onSkip: () => void finish(false)');
  });

  test('skipping cannot reach the split choice', () => {
    // finish(false) navigates away; only finish(true) sets the choose step. A skip that fell
    // through to the split would be a plan extended on no underwriting at all.
    const finish = SOURCE.slice(SOURCE.indexOf('const finish ='), SOURCE.indexOf('const connectBank ='));
    expect(finish).toContain("navigate('/', { replace: true })");
    expect(finish.indexOf("navigate('/'")).toBeLessThan(finish.indexOf("setStep('choose')"));
  });

  test('a failed submit does not advance either way', () => {
    expect(SOURCE).toContain('if (!ok) return;');
  });
});

describe('the submit contract', () => {
  const REQUIRED = [
    'currentStep', 'accessTrack', 'accountMethod', 'identityModeSelected', 'referralSource',
    'inviteCode', 'incomeSource', 'reasons', 'goalsNote', 'recoveryMethod', 'residencyCountry',
    'settlementCurrency', 'membershipPlan', 'cardWaitlist', 'localPools',
  ];

  for (const field of REQUIRED) {
    test(`sends ${field}`, () => {
      expect(SOURCE).toContain(`${field}:`);
    });
  }

  test('records the counter as where they came from', () => {
    // The branch table in the reference is exactly this field. A counter signup recorded as
    // 'direct' loses the only evidence of which entry works.
    expect(SOURCE).toContain("referralSource: 'counter'");
  });

  test('sends no email, because a counter never asks for one', () => {
    // Not '' -- an empty string would overwrite whatever signing in supplied.
    expect(SOURCE).toContain('email: null');
  });
});

/*
 * One rule, two entries. A ZIP that is served at a counter and unserved on the website is a member
 * getting a different answer depending on how they arrived.
 */
describe('the served-region rule is shared', () => {
  test('both containers import it rather than carrying a copy', () => {
    const direct = readFileSync(join(import.meta.dir, 'OnboardingRoute.tsx'), 'utf8');
    expect(direct).toContain("from '@/lib/servedRegion'");
    expect(SOURCE).toContain("from '@/lib/servedRegion'");
  });

  test('an unknown list is not a no', () => {
    expect(isServed('92501', null)).toBeNull();
    expect(isServed('92501', ['925'])).toBe(true);
    expect(isServed('10001', ['925'])).toBe(false);
  });

  test('only a definite no diverts', () => {
    expect(SOURCE).toContain('=== false');
  });

  test('an unserved ZIP reaches the same waitlist as the direct path', () => {
    expect(SOURCE).toContain('step="waitlist"');
  });
});

/*
 * The install ask has one owner at a time. Two prompts stacked on somebody standing at a counter
 * is the failure this prevents, and the single-use event is the reason it cannot be two listeners.
 */
describe('the install ask', () => {
  test('the counter flow claims it while mounted', () => {
    expect(SOURCE).toContain('claimInstallUi()');
  });

  test('the takeover stands down rather than dismissing', () => {
    const takeover = readFileSync(
      join(import.meta.dir, '../../components/PwaInstallTakeover.tsx'),
      'utf8',
    );
    expect(takeover).toContain('installUiClaimed');
    expect(takeover).toContain('if (!show || claimed) return null;');
  });

  test('only one module captures beforeinstallprompt', () => {
    const takeover = readFileSync(
      join(import.meta.dir, '../../components/PwaInstallTakeover.tsx'),
      'utf8',
    );
    // The event fires once and is single-use: two components each holding a reference means
    // whichever calls prompt() second throws on a stale event.
    expect(takeover).not.toContain("addEventListener('beforeinstallprompt'");
  });

  test('the button never claims to install where it cannot', () => {
    expect(installActionLabel('prompt')).toBe('Add to Home Screen');
    expect(installActionLabel('installed')).toBe('Continue');
    expect(installActionLabel('ios')).not.toBe('Add to Home Screen');
    expect(installActionLabel('unsupported')).not.toBe('Add to Home Screen');
  });
});

/*
 * The link step's button advances once an account is connected. A submit that failed leaves a
 * member connected and not a member, and the advance would put them on the split screen with no
 * record behind it — the kind of gap that only shows up when something upstream is already down.
 */
describe('nobody reaches the split without a member record', () => {
  test('the advance retries the chain rather than walking on', () => {
    expect(SOURCE).toContain("if (step === 'link' && next === 'choose' && !submitted.current)");
  });

  test('submitted is set from the chain returning, not from the step', () => {
    expect(SOURCE).toContain('submitted.current = true;');
    const submit = SOURCE.slice(SOURCE.indexOf('const submit ='), SOURCE.indexOf('const readApproved ='));
    // After the last call in the chain, so a failure anywhere in it leaves the flag false.
    expect(submit.indexOf('submitMemberOnboarding()')).toBeLessThan(submit.indexOf('submitted.current = true;'));
  });

  test('a retry does not re-run a chain that already succeeded', () => {
    expect(SOURCE).toContain('submitted.current || (await submit())');
  });
});
