import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

describe('the server keeps its own lock, and the app follows it', () => {
  const api = read('utils/apiClient.ts');
  const lock = read('components/shell/AppLock.tsx');

  test('423 APP_LOCKED shows the lock and is not treated as signed out', () => {
    expect(api).toMatch(/response\.status === 423 && \(errorData as \{ code\?: unknown \} \| null\)\?\.code === 'APP_LOCKED'\) \{\s*notifyServerLocked\(\);/);
    // Checked before the generic error handling, and 401 stays the only sign-out.
    expect(api.indexOf("=== 'APP_LOCKED'")).toBeLessThan(api.indexOf("=== 'STEP_UP_REQUIRED'"));
    expect(lock).toContain('const offServer = onServerLocked(() => setLocked(true));');
  });

  test('the server hears about real use only, at most once a minute', () => {
    expect(lock).toContain('const REPORT_EVERY_MS = 60 * 1000;');
    expect(lock).toMatch(/markActive\(now\);\s*report\(now\);/);
    expect(api).toContain("apiRequest('/api/session/active', { method: 'POST', keepalive: true })");
  });

  test('opening or returning to the app asks the server, whatever this device\'s clock says', () => {
    expect(lock).toMatch(/Opening the app[^\n]*\n\s*if \(!lockedRef\.current\) \{\s*void getSessionLock\(\)\.then\(\(serverLocked\) => \{\s*if \(serverLocked\) setLocked\(true\);/);
    expect(lock).toMatch(/Back within the app's five minutes[^\n]*\n\s*void getSessionLock\(\)/);
  });

  test('only Face ID the server checks opens it; the device-only check sends them to sign in again', () => {
    expect(lock).toContain('if (serverStepUpEnrolled()) await proveWithServer();');
    expect(lock).toMatch(/await faceIdRef\.current\.confirm\(\);[\s\S]{0,400}if \(\(await getSessionLock\(\)\) === true\) \{\s*setError\('Clear locked this session\. Send yourself a code to sign in again\.'\);\s*return;/);
  });
});

describe('the returning screen while locked', () => {
  const lock = read('components/shell/AppLock.tsx');

  test('it says the remembered name, never the wallet address the profile falls back to', () => {
    expect(lock).toContain('const name = member.displayName || remembered?.name || ');
    expect(lock).toContain('const handle = member.contactHandle || remembered?.handle || ');
    const profile = read('hooks/useMemberProfile.ts');
    // displayName is the member's own name or nothing; `name` is the one that falls back.
    expect(profile).toContain('displayName: display,');
    expect(profile).toContain("const display = pub?.displayName || pub?.username || '';");
    expect(profile).toContain("name = pub?.displayName || pub?.username || short(addr) || 'Member'");
  });

  test('unlocking reads the profile again, since the lock refused it', () => {
    expect(lock).toMatch(/setLocked\(false\);[\s\S]{0,300}refreshProfile\.current\(\);/);
  });
});

describe('getting Face ID back when the passkey is gone', () => {
  test('Settings offers this device once payments are protected, so a deleted passkey is recoverable', () => {
    const page = read('pages/app/SettingsPage.tsx');
    expect(page).toContain('onClick={payments.onSetUpThisDevice}');
    expect(page).toContain('This device');
    expect(read('pages/app/SettingsRoute.tsx')).toContain('onSetUpThisDevice: () => void protection.setUpThisDevice(),');
  });

  test('it says how to get past a refusal: sign in again with a code, and why where the server said', () => {
    const hook = read('hooks/usePaymentProtection.ts');
    expect(hook).toContain("'We could not set up Face ID on this device. Sign out and back in with a code, then try again.',");
    expect(hook).toContain('`${said} Or sign out, sign in with a code, and try again within ten minutes.`');
  });
});

describe('turning Face ID off when the passkey is gone', () => {
  test('the app falls back to the server, which Privy will let through with the member\'s own token', () => {
    const faceId = read('hooks/useFaceId.ts');
    // Privy refuses to unenrol an MFA passkey without that passkey, so the client path cannot win.
    expect(faceId).toMatch(/\} catch \{[\s\S]{0,420}return forceOff\(\);/);
    expect(faceId).toContain('const result = await resetFaceId();');
    expect(read('utils/apiClient.ts')).toContain("apiRequest<{ removed: number }>('/api/step-up/face-id/reset', { method: 'POST' })");
  });

  test('a refusal says what to do about it', () => {
    expect(read('hooks/useFaceId.ts')).toContain('Sign out, sign in with a code, then try again.');
  });
});

describe('signing in and paying are separate switches', () => {
  const faceId = read('hooks/useFaceId.ts');

  test('turning Face ID on links the sign-in passkey and stops there', () => {
    expect(faceId).toMatch(/await linkWithPasskey\(\{ name: 'Clear' \}\);\s*forgetWantsFaceId\(\);\s*return true;/);
    expect(faceId).not.toContain('prepareServerEnrollment');
  });

  test('payments are turned on from their own row, which asks for both halves on one tap', () => {
    const p = read('hooks/usePaymentProtection.ts');
    expect(p).toContain('if (serverEnrolled === false) await enrollWithServer();');
    expect(p).toContain('await initEnrollmentWithPasskey();');
    // And nothing enrols behind the member's back when a passkey appears.
    expect(p).not.toContain('clear:enroll-faceid-mfa');
  });

  test('turning Face ID off still takes payments with it: an unlinked passkey cannot confirm one', () => {
    expect(faceId).toMatch(/if \(serverStepUpEnrolled\(\) && !\(await removeStepUp\(\)\)\) \{/);
  });
});
