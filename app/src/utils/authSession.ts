import { SafeLocalStorageKeys } from '@reown/appkit-common';

export const AUTH_EXPIRED_EVENT = 'appkit-auth-expired';

const configuredAuthKey = (import.meta.env.VITE_SIWX_AUTH_TOKEN_KEY || '').trim();
const AUTH_TOKEN_STORAGE_KEYS = [
  configuredAuthKey,
  SafeLocalStorageKeys.SIWX_AUTH_TOKEN,
  '@appkit/siwx-auth-token',
].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);

let lastAuthExpiredDispatchAt = 0;

export function getSiwxAuthToken(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    for (const key of AUTH_TOKEN_STORAGE_KEYS) {
      const token = window.localStorage.getItem(key);
      if (token && token.trim().length > 0) {
        return token;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function clearSiwxAuthToken(): void {
  if (typeof window === 'undefined') return;

  try {
    AUTH_TOKEN_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Ignore storage errors.
  }
}

export function notifyAuthExpired(detail?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  // Prevent event storms when multiple requests fail at once.
  if (now - lastAuthExpiredDispatchAt < 1500) {
    return;
  }
  lastAuthExpiredDispatchAt = now;

  window.dispatchEvent(
    new CustomEvent(AUTH_EXPIRED_EVENT, {
      detail: detail ?? {},
    })
  );
}
