import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMfaEnrollment, usePrivy } from '@privy-io/react-auth';
import { setWalletMfa } from '@/lib/stepUp';

/*
 * What protects a member's payments at the wallet itself.
 *
 * The app's own Face ID prompt (lib/stepUp) runs in the browser, so anyone with the device and its
 * developer tools could step round it. Privy's wallet MFA does not: once a member has a factor
 * enrolled, Privy's wallet service will not sign a transaction until that factor is verified, and
 * nothing in this page can change that. Privy shows its own prompt when a signature needs it.
 *
 * Two factors, in the order we offer them:
 *   passkey  Face ID -- the passkey the member already signs in with, enrolled for MFA too
 *   totp     an authenticator app, for a device without Face ID
 */

export type PaymentFactor = 'passkey' | 'totp';

/** Set when Face ID was just turned on, so its new passkey is enrolled for payments as it appears. */
const ENROLL_AFTER_LINK = 'clear:enroll-faceid-mfa';

export function enrollFaceIdWhenLinked(): void {
  try {
    sessionStorage.setItem(ENROLL_AFTER_LINK, '1');
  } catch {
    /* Settings still offers the button */
  }
}

export interface PaymentProtection {
  /** The factors Privy will ask for before signing. Empty: payments are not protected at the wallet. */
  factors: PaymentFactor[];
  /** Face ID is on (a passkey is linked) but not yet guarding payments. */
  faceIdNotEnrolled: boolean;
  busy: boolean;
  error: string | null;
  enrollFaceId: () => Promise<boolean>;
  /** Starts authenticator setup: the otpauth URL for the QR, and the secret for typing in by hand. */
  startAuthenticator: () => Promise<{ secret: string; authUrl: string } | null>;
  confirmAuthenticator: (code: string) => Promise<boolean>;
  removeAuthenticator: () => Promise<boolean>;
}

export function usePaymentProtection(): PaymentProtection {
  const { user } = usePrivy();
  const {
    initEnrollmentWithPasskey,
    submitEnrollmentWithPasskey,
    initEnrollmentWithTotp,
    submitEnrollmentWithTotp,
    unenrollWithTotp,
  } = useMfaEnrollment();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const factors = useMemo(
    () => (user?.mfaMethods ?? []).filter((m): m is PaymentFactor => m === 'passkey' || m === 'totp'),
    [user],
  );
  const unenrolledPasskeys = useMemo(
    () =>
      (user?.linkedAccounts ?? [])
        .filter((a): a is Extract<typeof a, { type: 'passkey' }> => a.type === 'passkey')
        .filter((p) => !p.enrolledInMfa)
        .map((p) => p.credentialId),
    [user],
  );

  // The wallet now asks for itself, so the app does not ask a second time before a signature.
  useEffect(() => {
    setWalletMfa(factors.length > 0);
  }, [factors.length]);

  const enrollFaceId = useCallback(async () => {
    if (!unenrolledPasskeys.length) return true;
    setBusy(true);
    setError(null);
    try {
      await initEnrollmentWithPasskey();
      await submitEnrollmentWithPasskey({ credentialIds: unenrolledPasskeys });
      return true;
    } catch {
      setError('We could not use Face ID for payments. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [initEnrollmentWithPasskey, submitEnrollmentWithPasskey, unenrolledPasskeys]);

  // Face ID was just turned on: enrol its passkey for payments as soon as Privy reports it.
  useEffect(() => {
    let pending = false;
    try {
      pending = sessionStorage.getItem(ENROLL_AFTER_LINK) === '1';
    } catch {
      /* no storage */
    }
    if (!pending || !unenrolledPasskeys.length) return;
    try {
      sessionStorage.removeItem(ENROLL_AFTER_LINK);
    } catch {
      /* no storage */
    }
    void enrollFaceId();
  }, [unenrolledPasskeys, enrollFaceId]);

  const startAuthenticator = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      return await initEnrollmentWithTotp();
    } catch {
      setError('We could not start authenticator setup. Please try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [initEnrollmentWithTotp]);

  const confirmAuthenticator = useCallback(
    async (code: string) => {
      setBusy(true);
      setError(null);
      try {
        await submitEnrollmentWithTotp({ mfaCode: code.replace(/\s+/g, '') });
        return true;
      } catch {
        setError('That code did not match. Check the app and try the newest one.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [submitEnrollmentWithTotp],
  );

  const removeAuthenticator = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await unenrollWithTotp();
      return true;
    } catch {
      setError('We could not remove the authenticator app. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [unenrollWithTotp]);

  return {
    factors,
    faceIdNotEnrolled: unenrolledPasskeys.length > 0 && !factors.includes('passkey'),
    busy,
    error,
    enrollFaceId,
    startAuthenticator,
    confirmAuthenticator,
    removeAuthenticator,
  };
}
