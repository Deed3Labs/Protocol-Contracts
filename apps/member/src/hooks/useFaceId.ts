import { serverStepUpEnrolled, setServerStepUpEnrolled } from '@/lib/stepUp';
import { removeStepUp, resetFaceId } from '@/utils/apiClient';
import { useCallback, useMemo, useState } from 'react';
import { useLinkWithPasskey, usePrivy, useUnlinkPasskey } from '@privy-io/react-auth';

/*
 * Face ID is a passkey on the member's Privy account — and until now nothing could make one.
 *
 * The sign-in screen offered "Use Face ID" and Settings offered a Face ID switch, but no code
 * anywhere linked a passkey. The switch set local state and talked to nobody, so a member could
 * turn it on, see it on, and still have the button fail. Every Face ID sign-in failed for everyone.
 *
 * A passkey can only be ATTACHED to an account somebody is already signed into. The one Privy call
 * that makes a passkey while signed out, `signupWithPasskey`, creates a brand-new account — for a
 * member who already signs in with email, that is a second, empty account with no wallet and none
 * of their money in it. So setup always happens after sign-in, never instead of it.
 */

/** Set when a Face ID sign-in fails, so the next successful sign-in can offer to turn it on. */
export const WANTS_FACE_ID_KEY = 'clear:wants-face-id';

export function rememberWantsFaceId(): void {
  try {
    sessionStorage.setItem(WANTS_FACE_ID_KEY, '1');
  } catch {
    /* private mode — the offer is a convenience, and Settings still has the switch */
  }
}

export function forgetWantsFaceId(): void {
  try {
    sessionStorage.removeItem(WANTS_FACE_ID_KEY);
  } catch {
    /* nothing to forget */
  }
}

export function wantsFaceId(): boolean {
  try {
    return sessionStorage.getItem(WANTS_FACE_ID_KEY) === '1';
  } catch {
    return false;
  }
}

/** Privy's error, or ours, as a sentence a member can act on. */
function toMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : '';
  // A dismissed system sheet is the member changing their mind, not something that went wrong.
  if (/cancel|abort|not allowed|notallowed/i.test(raw)) return 'Face ID was not turned on.';
  return fallback;
}

/** Privy stores credential ids base64url-encoded; WebAuthn wants the raw bytes. */
function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Face ID against a passkey already on the account, without signing in again.
 *
 * Privy's passkey calls all sign in or link; there is no "just check it is them" for a member who
 * is already signed in, which is what the lock screen and a send both need. So this asks the device
 * directly. Privy registers passkeys to this page's own domain (checked against its passkey config
 * for demo.useclear.org), so the default relying party here finds the same credential.
 *
 * This proves presence on this device, and that is what it is for: the phone being in somebody
 * else's hand. It is not a server-side check, and the session it protects is already on the phone.
 */
export async function confirmWithPasskey(credentialIds: string[]): Promise<void> {
  if (!credentialIds.length) throw new Error('No Face ID on this account.');
  if (typeof navigator === 'undefined' || !navigator.credentials?.get) {
    throw new Error('Face ID is not available in this browser.');
  }
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: credentialIds.map((id) => ({ type: 'public-key' as const, id: fromBase64Url(id) })),
      userVerification: 'required',
      timeout: 60_000,
    },
  });
  if (!credential) throw new Error('Face ID was not confirmed.');
}

/**
 * This switch is Face ID for SIGNING IN, and only that.
 *
 * Face ID for payments is its own row in Settings, for two reasons. A member may well want the app
 * to open with a look and still be asked deliberately before money moves -- that is a real choice,
 * not an oversight. And doing both here meant two system sheets back to back, which browsers are
 * readiest to refuse: the second one failed quietly and left payments unguarded while the switch
 * said Face ID was on.
 *
 * Off still takes both: a passkey that has been unlinked cannot confirm a payment either.
 */

/**
 * Face ID off when the passkey is gone from the phone.
 *
 * Privy will not unlink an MFA-enrolled passkey without verifying it, which a deleted passkey can
 * never do -- so the server does it with the member's own token instead (api routes/stepUp). Only
 * for that case: the ordinary switch stays the member's own device answering for itself.
 */
export interface FaceId {
  /** A passkey is actually linked to the account — read from Privy, not from a switch. */
  on: boolean;
  busy: boolean;
  error: string | null;
  turnOn: () => Promise<boolean>;
  turnOff: () => Promise<boolean>;
  /** Off for the whole account, without asking the missing passkey. Needs a sign-in made minutes ago. */
  forceOff: () => Promise<boolean>;
  /** Face ID on this device against the account's passkeys. Throws if declined or unavailable. */
  confirm: () => Promise<void>;
}

export function useFaceId(): FaceId {
  const { user } = usePrivy();
  const { linkWithPasskey } = useLinkWithPasskey();
  const { unlink } = useUnlinkPasskey();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passkeys = useMemo(
    () =>
      (user?.linkedAccounts ?? []).filter(
        (account): account is Extract<typeof account, { type: 'passkey' }> => account.type === 'passkey',
      ),
    [user],
  );

  const turnOn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Named so a member looking at their devices can tell which one this was.
      await linkWithPasskey({ name: 'Clear' });
      forgetWantsFaceId();
      return true;
    } catch (e) {
      setError(toMessage(e, 'We could not turn on Face ID on this device. Please try again.'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [linkWithPasskey]);

  const forceOff = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await resetFaceId();
      if (!result.ok) {
        setError(result.message || 'We could not turn Face ID off. Sign out, sign in with a code, then try again.');
        return false;
      }
      setServerStepUpEnrolled(false);
      return true;
    } finally {
      setBusy(false);
    }
  }, []);

  const turnOff = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // The server stops asking first -- that takes Face ID itself, so a stolen session cannot do it.
      if (serverStepUpEnrolled() && !(await removeStepUp())) {
        // No Face ID to give, and no recent sign-in either: say which, since both are fixable.
        setError('Face ID stays on: it was not confirmed. Sign out, sign in with a code, then try again.');
        return false;
      }
      setServerStepUpEnrolled(false);
      /*
       * Every passkey on the account, not just this device's.
       *
       * The switch reads "Face ID" for the account, so off has to mean off — leaving a passkey from
       * another phone behind would let that phone keep signing in while the switch said it could not.
       */
      for (const passkey of passkeys) {
        await unlink({ credentialId: passkey.credentialId });
      }
      return true;
    } catch {
      /*
       * Privy refused, which for an MFA-enrolled passkey means it wants that passkey to confirm --
       * and the usual reason somebody is turning Face ID off is that they no longer have it. The
       * server can, with their own token, if they signed in minutes ago.
       */
      return forceOff();
    } finally {
      setBusy(false);
    }
  }, [passkeys, unlink, forceOff]);

  const credentialIds = useMemo(() => passkeys.map((p) => p.credentialId), [passkeys]);
  const confirm = useCallback(() => confirmWithPasskey(credentialIds), [credentialIds]);

  return { on: passkeys.length > 0, busy, error, turnOn, turnOff, forceOff, confirm };
}
