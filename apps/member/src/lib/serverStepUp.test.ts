import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  StepUpDeclinedError,
  clearStepUp,
  confirmForServer,
  currentStepUpToken,
  markStepUpVerified,
  requireStepUp,
  setServerStepUpEnrolled,
  setServerStepUpToken,
  setStepUpVerifier,
} from './stepUp';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

describe('the app and the server agree on when to ask', () => {
  let asked = 0;
  beforeEach(() => {
    clearStepUp();
    asked = 0;
    setStepUpVerifier(async () => {
      asked++;
      setServerStepUpToken({ token: 'fresh', expiresAt: Date.now() + 120_000 });
    });
  });

  test('without a server credential, a recent check covers the next move', async () => {
    markStepUpVerified();
    await requireStepUp();
    expect(asked).toBe(0);
  });

  test('with one, a recent check without a live token does not count: the server would refuse', async () => {
    setServerStepUpEnrolled(true);
    markStepUpVerified();
    await requireStepUp();
    expect(asked).toBe(1);
    expect(currentStepUpToken()).toBe('fresh');
  });

  test('a token about to lapse is not sent', () => {
    setServerStepUpToken({ token: 'old', expiresAt: Date.now() + 5_000 });
    expect(currentStepUpToken()).toBeNull();
  });

  test('when the server refuses, the app asks at once, whatever its own window said', async () => {
    markStepUpVerified();
    await confirmForServer();
    expect(asked).toBe(1);
  });

  test('declining there is a decline', async () => {
    setStepUpVerifier(async () => {
      throw new Error('no');
    });
    await expect(confirmForServer()).rejects.toBeInstanceOf(StepUpDeclinedError);
  });

  test('signing out forgets the token and the enrolment', () => {
    setServerStepUpToken({ token: 't', expiresAt: Date.now() + 120_000 });
    clearStepUp();
    expect(currentStepUpToken()).toBeNull();
  });
});

describe('wired through', () => {
  test('every API request carries a live token, and a STEP_UP_REQUIRED refusal is asked for and retried once', () => {
    const api = read('utils/apiClient.ts');
    expect(api).toContain("...(stepUpToken ? { 'X-Step-Up': stepUpToken } : {}),");
    expect(api).toMatch(/const first = await apiRequestOnce<T>\(endpoint, options\);\s*if \(!first\.stepUpRequired\) return first;\s*try \{\s*await confirmForServer\(\);/);
    expect(api).toContain("(errorData as { code?: unknown } | null)?.code === 'STEP_UP_REQUIRED'");
  });

  test('the verifier and the lock screen use the server\'s Face ID where the member has it', () => {
    const lock = read('components/shell/AppLock.tsx');
    expect(lock).toContain('if (serverStepUpEnrolled()) return proveWithServer();');
    expect(lock).toContain('if (serverStepUpEnrolled()) await proveWithServer();');
  });

  test('turning Face ID off removes the server credential first, behind Face ID', () => {
    const faceId = read('hooks/useFaceId.ts');
    expect(faceId).toMatch(/if \(serverStepUpEnrolled\(\) && !\(await removeStepUp\(\)\)\) \{/);
    // On does not: payments are their own row, so one system sheet never chases another.
    expect(faceId).not.toContain('enrollWithServer');
  });

  test('"Use Face ID" in Settings covers the server credential too', () => {
    const p = read('hooks/usePaymentProtection.ts');
    expect(p).toContain('if (serverEnrolled === false) await enrollWithServer();');
    expect(p).toContain("|| serverEnrolled === false),");
  });

  test('signing out forgets the server status', () => {
    expect(read('hooks/useLogout.ts')).toMatch(/clearStepUp\(\);\s*forgetServerStepUp\(\);/);
  });
});
