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

export interface FaceId {
  /** A passkey is actually linked to the account — read from Privy, not from a switch. */
  on: boolean;
  busy: boolean;
  error: string | null;
  turnOn: () => Promise<boolean>;
  turnOff: () => Promise<boolean>;
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

  const turnOff = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
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
      setError('We could not turn off Face ID. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [passkeys, unlink]);

  const credentialIds = useMemo(() => passkeys.map((p) => p.credentialId), [passkeys]);
  const confirm = useCallback(() => confirmWithPasskey(credentialIds), [credentialIds]);

  return { on: passkeys.length > 0, busy, error, turnOn, turnOff, confirm };
}
