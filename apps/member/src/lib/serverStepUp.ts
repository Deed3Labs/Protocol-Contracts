import { useEffect, useSyncExternalStore } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import {
  getStepUpOptions,
  getStepUpRegisterOptions,
  getStepUpStatus,
  verifyStepUp,
  verifyStepUpRegistration,
} from '@/utils/apiClient';
import {
  onServerStepUpChange,
  serverStepUpEnrolled,
  setServerStepUpEnrolled,
  setServerStepUpToken,
} from './stepUp';

/*
 * Face ID the server checks, rather than takes on the app's word.
 *
 * Privy's passkeys sign members in, but Privy never gives our server their public keys, so the API
 * cannot verify a Face ID made with one. This is a second passkey, "Clear", registered with the API:
 * it keeps the public key, sends a fresh challenge for each check, verifies the signature, and hands
 * back a two-minute token (lib/stepUp) that the guarded requests need.
 *
 * On the phone it is one more saved passkey for this site and the same Face ID.
 */

type OptionsJSON = Parameters<typeof startAuthentication>[0]['optionsJSON'];
type RegisterJSON = Parameters<typeof startRegistration>[0]['optionsJSON'];

/** A Face ID check the server verifies. Throws if declined or refused. */
export async function proveWithServer(): Promise<void> {
  const start = await getStepUpOptions();
  if (!start.options) throw new Error(start.error || 'Face ID could not start.');
  const response = await startAuthentication({ optionsJSON: start.options as OptionsJSON });
  const grant = await verifyStepUp(response);
  if (!grant) throw new Error('Face ID was not confirmed.');
  setServerStepUpToken(grant);
}

/** Register this device's Face ID with the server. Also counts as a check. Throws if it did not happen. */
export async function enrollWithServer(): Promise<void> {
  const start = await getStepUpRegisterOptions();
  if (!start.options) throw new Error(start.error || 'Face ID could not start.');
  const response = await startRegistration({ optionsJSON: start.options as RegisterJSON });
  const grant = await verifyStepUpRegistration(response);
  if (!grant) throw new Error('Face ID was not set up.');
  setServerStepUpToken(grant);
  setServerStepUpEnrolled(true);
}

/** Whether the server holds a Face ID for this member: null until it has said. Read once per sign-in. */
let known = false;
export function useServerStepUp(signedIn: boolean): boolean | null {
  const enrolled = useSyncExternalStore(onServerStepUpChange, serverStepUpEnrolled);
  useEffect(() => {
    if (!signedIn || known) return;
    known = true;
    void getStepUpStatus().then((s) => {
      if (s) setServerStepUpEnrolled(s.enrolled);
      else known = false;
      bump();
    });
  }, [signedIn]);
  const loaded = useSyncExternalStore(onLoaded, () => loadedTick);
  return loaded > 0 ? enrolled : null;
}

let loadedTick = 0;
const loadedListeners = new Set<() => void>();
function bump(): void {
  loadedTick++;
  loadedListeners.forEach((l) => l());
}
function onLoaded(l: () => void): () => void {
  loadedListeners.add(l);
  return () => loadedListeners.delete(l);
}

/** Signing out: the next member's status is read afresh. */
export function forgetServerStepUp(): void {
  known = false;
  loadedTick = 0;
  loadedListeners.forEach((l) => l());
}
