import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCK_AFTER_MS, isStale } from './appLock';
import {
  STEP_UP_DECLINED,
  StepUpDeclinedError,
  clearStepUp,
  markStepUpVerified,
  requireStepUp,
  setStepUpVerifier,
  stepUpDenied,
} from './stepUp';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

describe('the lock clock', () => {
  const now = 1_000_000_000;
  test('a session never timed on this device is fresh, not stale', () => {
    expect(isStale(null, now)).toBe(false);
  });
  test('five minutes away locks; less does not', () => {
    expect(isStale(now - LOCK_AFTER_MS, now)).toBe(true);
    expect(isStale(now - LOCK_AFTER_MS + 1000, now)).toBe(false);
  });
});

describe('step-up', () => {
  afterEach(() => {
    setStepUpVerifier(null);
    clearStepUp();
  });

  test('with no verifier registered (preview, signed out) the gate is open', async () => {
    await requireStepUp();
  });

  test('asks once, then one confirmation covers the next moves', async () => {
    let asked = 0;
    setStepUpVerifier(async () => {
      asked += 1;
    });
    await requireStepUp();
    await requireStepUp();
    expect(asked).toBe(1);
  });

  test('two moves at once share one prompt', async () => {
    let asked = 0;
    setStepUpVerifier(async () => {
      asked += 1;
      await new Promise((r) => setTimeout(r, 5));
    });
    await Promise.all([requireStepUp(), requireStepUp()]);
    expect(asked).toBe(1);
  });

  test('a decline throws, and holds so a fallback route does not ask again at once', async () => {
    let asked = 0;
    setStepUpVerifier(async () => {
      asked += 1;
      throw new Error('NotAllowedError');
    });
    await expect(requireStepUp()).rejects.toBeInstanceOf(StepUpDeclinedError);
    await expect(requireStepUp()).rejects.toBeInstanceOf(StepUpDeclinedError);
    expect(asked).toBe(1);
    expect(await stepUpDenied()).toBe(STEP_UP_DECLINED);
  });

  test('unlocking with Face ID counts as a confirmation', async () => {
    let asked = 0;
    setStepUpVerifier(async () => {
      asked += 1;
    });
    markStepUpVerified();
    await requireStepUp();
    expect(asked).toBe(0);
  });
});

describe('every way money leaves passes the gate', () => {
  const api = read('utils/apiClient.ts');
  const body = (name: string) => {
    const start = api.indexOf(`export async function ${name}(`);
    return api.slice(start, api.indexOf('\nexport ', start + 1));
  };

  test('on-chain: the sponsored batch, the gasless signature, autopay', () => {
    expect(read('lib/sendCalls.ts')).toMatch(/async function runBatch[\s\S]{0,200}await requireStepUp\(\)/);
    expect(read('lib/gaslessMoney.ts')).toMatch(/async function signTypedData[\s\S]{0,200}await requireStepUp\(\)/);
    expect(read('lib/gaslessMoney.ts')).toMatch(/export async function gaslessRedeem[\s\S]{0,200}await requireStepUp\(\)/);
    expect(read('lib/autopay.ts')).toMatch(/installAutopaySession[\s\S]{0,700}await requireStepUp\(\)/);
  });

  test.each([
    'withdrawToBank',
    'payBiller',
    'approveCharge',
    'createRampSellSession',
    'createOnramperSellCheckout',
    'runAutopayRule',
    'setCardSpendLimit',
    'createCardEphemeralKey',
    'setCardFrozen',
    'freezeClearCard',
  ])('%s asks first', (name) => {
    expect(body(name)).toContain('await stepUpDenied()');
  });

  test('freezing is never gated — only turning the card back on', () => {
    expect(body('setCardFrozen')).toContain('if (!frozen)');
    expect(body('freezeClearCard')).toContain('if (active)');
  });

  test('card numbers and PIN ask first', () => {
    const route = read('pages/app/CardRoute.tsx');
    expect(route).toContain('if (await stepUpDenied()) return undefined;');
    expect(route).toMatch(/stepUpDenied\(\)\.then\(\(denied\) => \{\s*if \(denied\) return;\s*void getCardEmbedSession\(cardId, 'pin'\)/);
  });
});

describe('the lock screen', () => {
  const lock = read('components/shell/AppLock.tsx');
  test('wraps the signed-in app and does not render it while locked', () => {
    expect(read('components/shell/AppShell.tsx')).toMatch(/<AppLock>[\s\S]*<Outlet \/>[\s\S]*<\/AppLock>/);
    expect(lock).toContain('if (!locked) return <>{children}</>;');
  });
  test('members without Face ID are not blocked from moving money', () => {
    expect(lock).toContain('if (!faceIdRef.current.on) return;');
  });
  test('the code fallback is a real sign-in, and signing in starts the clock', () => {
    expect(lock).toContain('logout({ sendCode: true })');
    expect(read('pages/auth/LoginRoute.tsx')).toContain('markActive();');
    expect(read('hooks/useLogout.ts')).toContain('forgetActive();');
  });
});

describe('signing out', () => {
  test('the profile menu signs out, the same way Settings does', () => {
    const shell = read('components/shell/AppShell.tsx');
    expect(shell).toContain('onSignOut={() => void logout()}');
    expect(read('pages/app/SettingsRoute.tsx')).toContain('onSignOut={() => void logout()}');
  });

  test('and its Acceleration Explore opens the Acceleration page in Settings', () => {
    expect(read('components/shell/AppShell.tsx')).toContain("navigate('/settings/acceleration')");
    expect(read('pages/app/settingsPages.ts')).toContain("acceleration: { title: 'Acceleration'");
  });
});
