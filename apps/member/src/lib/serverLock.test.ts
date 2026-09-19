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
