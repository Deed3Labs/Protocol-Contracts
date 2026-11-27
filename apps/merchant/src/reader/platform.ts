import { Capacitor } from '@capacitor/core';
import type { Platform, ReaderKind } from './types';

/**
 * Which readers this device can drive.
 *
 * In a browser: smart readers only, through Stripe's web SDK. In the installed app: also the M2
 * over Bluetooth, and Tap to Pay. Settings › Payments and the card screen's "Use another reader"
 * list only these.
 */

export function currentPlatform(): Platform {
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android' ? p : 'web';
}

export function kindsFor(platform: Platform): ReaderKind[] {
  return platform === 'web' ? ['smart'] : ['smart', 'bluetooth', 'tapToPay'];
}

/**
 * Store-and-forward. Stripe allows it on the M2 only, and Tap to Pay is online only. The community
 * plugin this app uses has no offline API yet, so no reader offers it until a thin native plugin
 * adds it (DECISIONS.md, Phase 5). Flip this, per kind, when it does.
 */
export const OFFLINE_BUILT = false;

export function offlineFor(kind: ReaderKind): boolean {
  return OFFLINE_BUILT && kind === 'bluetooth';
}

/** "this iPhone", "this tablet", "this phone": what Tap to Pay runs on here. */
export function thisDevice(platform: Platform): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (platform === 'ios') return /iPad/.test(ua) ? 'this iPad' : 'this iPhone';
  if (platform === 'android') return /Mobile/.test(ua) ? 'this phone' : 'this tablet';
  return 'this device';
}

/**
 * The preview can pretend to be the installed app, so every reader can be seen from a browser:
 * `&platform=ios|android`. A production build ignores it.
 */
export function previewPlatform(params: URLSearchParams): Platform | null {
  if (!import.meta.env.DEV) return null;
  const p = params.get('platform');
  return p === 'ios' || p === 'android' || p === 'web' ? p : null;
}
