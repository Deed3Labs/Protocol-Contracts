import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireStepUp, setStepUpVerifier, setWalletMfa, walletEnforcesMfa, clearStepUp } from '@/lib/stepUp';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

describe('payments are guarded at the wallet (Privy MFA)', () => {
  test('Privy prompts for MFA itself, and Face ID off also takes it off payments', () => {
    const cfg = read('AppKitProvider.tsx');
    expect(cfg).toContain('mfa: { noPromptOnMfaRequired: false },');
    expect(cfg).toContain('passkeys: { shouldUnenrollMfaOnUnlink: true, shouldUnlinkOnUnenrollMfa: false },');
  });

  test('turning Face ID on enrols its passkey for payments, wherever the member is', () => {
    expect(read('hooks/useFaceId.ts')).toMatch(/enrollFaceIdWhenLinked\(\);[\s\S]{0,160}await linkWithPasskey/);
    expect(read('components/shell/AppLock.tsx')).toContain('usePaymentProtection();');
    expect(read('hooks/usePaymentProtection.ts')).toContain('await submitEnrollmentWithPasskey({ credentialIds: unenrolledPasskeys });');
  });

  test('an authenticator app is the fallback, set up by scanning and confirming a code', () => {
    const hook = read('hooks/usePaymentProtection.ts');
    expect(hook).toContain('return await initEnrollmentWithTotp();');
    expect(hook).toContain("await submitEnrollmentWithTotp({ mfaCode: code.replace(/\\s+/g, '') });");
    expect(read('components/settings/AuthenticatorDialog.tsx')).toContain('<QRCodeSVG value={setup.authUrl}');
  });

  test('the placeholder "Require Face ID for payments over $X" switch is gone', () => {
    expect(read('pages/app/SettingsPage.tsx')).not.toContain('faceid-payments');
  });
});

describe('one prompt per payment, not two', () => {
  test('where the wallet enforces MFA, the app does not ask first', async () => {
    let asked = 0;
    setStepUpVerifier(async () => {
      asked += 1;
    });
    clearStepUp();
    setWalletMfa(true);
    expect(walletEnforcesMfa()).toBe(true);
    // runBatch checks this before calling requireStepUp; the gate itself is unchanged.
    if (!walletEnforcesMfa()) await requireStepUp();
    expect(asked).toBe(0);
    setWalletMfa(false);
    if (!walletEnforcesMfa()) await requireStepUp();
    expect(asked).toBe(1);
    setStepUpVerifier(null);
  });
});
