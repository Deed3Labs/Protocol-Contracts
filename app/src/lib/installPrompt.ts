/**
 * The install prompt, captured before anything asks for it.
 *
 * `beforeinstallprompt` fires once, early, and browsers do not replay it — a component that starts
 * listening when it mounts has already missed it. So the listener is registered at import time and
 * the event is held here, which is the whole reason this is a module and not a hook.
 *
 * Add to Home Screen is the counter path's first step, and it is the one step with no fallback: a
 * member who leaves without the app on their home screen has no way back to the flow they were
 * halfway through. Worth the module-level listener.
 */

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Chrome's own mini-infobar is fine on a marketing page and wrong in the middle of a five-step
    // flow somebody is running through while a service writer waits. We ask at our own step.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    announce();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    announce();
  });
}

export function subscribeInstallPrompt(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

/**
 * Show the browser's install prompt. True if accepted, false if dismissed or unavailable.
 *
 * The event is consumed whether or not they accept — it is single-use, and a second `prompt()` on
 * the same event throws. A member who dismisses gets the manual instructions, not a dead button.
 */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  announce();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === 'accepted';
}

/** Already launched from the home screen, so the step is done before it is shown. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iOS has no install API at all — Safari only offers Share → Add to Home Screen, by hand. */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  // iPadOS 13+ reports itself as a Mac; the touch points are what give it away.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'unsupported';

export function readInstallMode(): InstallMode {
  if (isStandalone()) return 'installed';
  if (canPromptInstall()) return 'prompt';
  if (isIos()) return 'ios';
  return 'unsupported';
}

/**
 * Who owns the install ask right now.
 *
 * There are two places that want to ask: the first-visit takeover, and the counter flow's own
 * first step. They must not both ask, and on a counter arrival the flow wins — a member who
 * scanned a shop's code is already being walked through it, and a full-screen takeover landing on
 * top of step one of five is the worst moment in the product to interrupt.
 *
 * A claim rather than a route check, so the takeover never has to know which routes exist.
 */
let claims = 0;

export function claimInstallUi(): () => void {
  claims += 1;
  announce();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims -= 1;
    announce();
  };
}

export function installUiClaimed(): boolean {
  return claims > 0;
}

/** What the install step's own button should say, given what the browser will let it do. */
export function installActionLabel(mode: InstallMode): string {
  if (mode === 'installed') return 'Continue';
  if (mode === 'prompt') return 'Add to Home Screen';
  // Nothing to press on iOS or on a desktop browser, so the button moves the member on rather
  // than pretending to install. A button that cannot do what it says is worse than no button.
  return 'I’ve done that — continue';
}
