import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMfaEnrollment, usePrivy } from '@privy-io/react-auth';
import { setWalletMfa } from '@/lib/stepUp';
import { enrollWithServer, useServerStepUp } from '@/lib/serverStepUp';

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
 *
 * Face ID also guards what the server does without a wallet signature -- card numbers, disputes,
 * bills (lib/serverStepUp). That needs its own passkey registered with our API, so "Face ID for
 * payments" means both: Privy's MFA enrolment and the server's credential.
 *
 * Turned on here and nowhere else. The Face ID switch above it is for signing in, and a member who
 * wants the app to open with a look but to be asked before money moves should be able to have that
 * -- so this is its own row, its own tap, and its own system sheet rather than one chasing another.
 */

export type PaymentFactor = 'passkey' | 'totp';

export interface PaymentProtection {
  /** The factors Privy will ask for before signing. Empty: payments are not protected at the wallet. */
  factors: PaymentFactor[];
  /** Face ID is on (a passkey is linked) but not yet guarding payments. */
  faceIdNotEnrolled: boolean;
  busy: boolean;
  error: string | null;
  enrollFaceId: () => Promise<boolean>;
  /**
   * Register this device's Face ID for payments again -- for a passkey deleted from the phone, or a
   * phone replaced. Takes Face ID from a device still registered, or a sign-in made in the last ten
   * minutes, which is why the message says to sign in again when it cannot.
   */
  setUpThisDevice: () => Promise<boolean>;
  /** Starts authenticator setup: the otpauth URL for the QR, and the secret for typing in by hand. */
  startAuthenticator: () => Promise<{ secret: string; authUrl: string } | null>;
  confirmAuthenticator: (code: string) => Promise<boolean>;
  removeAuthenticator: () => Promise<boolean>;
}

export function usePaymentProtection(): PaymentProtection {
  const { user, authenticated } = usePrivy();
  const serverEnrolled = useServerStepUp(authenticated);
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

  const faceIdOn = (user?.linkedAccounts ?? []).some((a) => a.type === 'passkey');

  // The wallet now asks for itself, so the app does not ask a second time before a signature.
  useEffect(() => {
    setWalletMfa(factors.length > 0);
  }, [factors.length]);

  const enrollFaceId = useCallback(async () => {
    const privyMissing = unenrolledPasskeys.length > 0 && !factors.includes('passkey');
    if (!privyMissing && serverEnrolled !== false) return true;
    setBusy(true);
    setError(null);
    try {
      // The server's first, while the tap that started this still counts as one: a new passkey needs it.
      if (serverEnrolled === false) await enrollWithServer();
      if (privyMissing) {
        await initEnrollmentWithPasskey();
        await submitEnrollmentWithPasskey({ credentialIds: unenrolledPasskeys });
      }
      return true;
    } catch {
      setError('We could not use Face ID for payments. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [initEnrollmentWithPasskey, submitEnrollmentWithPasskey, unenrolledPasskeys, factors, serverEnrolled]);

  const setUpThisDevice = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await enrollWithServer();
      return true;
    } catch {
      setError('We could not set up Face ID on this device. Sign out and back in with a code, then try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

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
    faceIdNotEnrolled: faceIdOn && ((unenrolledPasskeys.length > 0 && !factors.includes('passkey')) || serverEnrolled === false),
    busy,
    error,
    enrollFaceId,
    setUpThisDevice,
    startAuthenticator,
    confirmAuthenticator,
    removeAuthenticator,
  };
}
