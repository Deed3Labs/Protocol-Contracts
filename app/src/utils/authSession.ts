export const AUTH_EXPIRED_EVENT = 'appkit-auth-expired';

const configuredAuthKey = (import.meta.env.VITE_SIWX_AUTH_TOKEN_KEY || '').trim();
// Legacy SIWX token storage keys (superseded by Privy getAccessToken); kept only so clearSiwxAuthToken
// can purge any stale token left in localStorage by the old AppKit auth.
const AUTH_TOKEN_STORAGE_KEYS = [
  configuredAuthKey,
  '@appkit/siwx-auth-token',
].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);

let lastAuthExpiredDispatchAt = 0;

// The currently-connected wallet (lowercased). Set by the auth provider on every account change so we
// can reject a SIWX token that belongs to a DIFFERENT wallet — Reown's session can desync from the
// connected wallet on a switch, which otherwise serves the previous account's token-authorized data
// (e.g. profile / account center).
let activeWalletAddress: string | null = null;
export function setActiveWallet(address: string | null | undefined): void {
  activeWalletAddress = address ? address.toLowerCase() : null;
}

/** Best-effort: pull the wallet address out of a SIWX JWT payload (handles CAIP "eip155:1:0x.." too). */
function tokenWalletAddress(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(decodeURIComponent(escape(atob(part.replace(/-/g, '+').replace(/_/g, '/')))));
    const match = JSON.stringify(payload).toLowerCase().match(/0x[a-f0-9]{40}/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

export function getSiwxAuthToken(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    for (const key of AUTH_TOKEN_STORAGE_KEYS) {
      const token = window.localStorage.getItem(key);
      if (token && token.trim().length > 0) {
        // Drop a token that belongs to a different wallet than the one currently connected.
        if (activeWalletAddress) {
          const tokenAddr = tokenWalletAddress(token);
          if (tokenAddr && tokenAddr !== activeWalletAddress) {
            clearSiwxAuthToken();
            return null;
          }
        }
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
