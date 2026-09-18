import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');
const hook = read('hooks/useFaceId.ts');
const login = read('pages/auth/LoginRoute.tsx');
const offer = read('components/shell/FaceIdOffer.tsx');
const shell = read('components/shell/AppShell.tsx');
const settings = read('pages/app/SettingsRoute.tsx');
const page = read('pages/app/SettingsPage.tsx');

/*
 * "Use Face ID" failed for everyone, because nothing in the app ever put a passkey on an account.
 * The Settings switch was local state that talked to nobody. These pin the path that replaced it:
 * a failed Face ID sign-in leads to a code, and the code leads to Face ID being turned on.
 */
describe('Face ID can actually be set up', () => {
  test('a passkey is linked to the signed-in account, never signed up as a new one', () => {
    expect(hook).toContain('linkWithPasskey(');
    // signupWithPasskey makes a second, empty account for somebody who already has one.
    expect(hook).not.toMatch(/signupWithPasskey\s*\(/);
    expect(login).not.toMatch(/signupWithPasskey\s*\(/);
  });

  test('whether it is on is read from the account, not a switch', () => {
    expect(hook).toContain("account.type === 'passkey'");
    expect(hook).toContain('on: passkeys.length > 0');
  });

  test('turning it off removes every passkey on the account', () => {
    expect(hook).toContain('for (const passkey of passkeys)');
    expect(hook).toContain('unlink({ credentialId: passkey.credentialId })');
  });

  test('a failed Face ID sign-in remembers the request and points at the code', () => {
    expect(login).toContain('rememberWantsFaceId()');
    expect(login).toContain('Send yourself a code');
    // Browsers will not say whether a passkey exists, so the copy must not claim to know.
    expect(login).toContain('may not be set up');
  });

  test('the offer lives in the signed-in shell, and is asked once', () => {
    expect(shell).toContain('<FaceIdOffer />');
    expect(offer).toContain('wantsFaceId()');
    expect(offer).toContain('faceId.turnOn()');
    expect(offer).toContain('forgetWantsFaceId()');
    expect(hook).toMatch(/await linkWithPasskey\([^)]*\);\s*forgetWantsFaceId\(\)/);
  });

  test('the Settings switch moves a real passkey', () => {
    expect(settings).toContain('useFaceId()');
    expect(settings).toContain('faceId.turnOn()');
    expect(settings).toContain('faceId.turnOff()');
    expect(page).toContain('checked={faceId.on}');
  });
});
