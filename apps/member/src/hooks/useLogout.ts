import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { useXMTP } from '@/context/XMTPContext';
import { forgetActive } from '@/lib/appLock';
import { clearStepUp } from '@/lib/stepUp';
import { forgetRemembered } from '@/lib/rememberedState';

/**
 * Fully sign the user out: close the XMTP client, disconnect the Reown/AppKit wallet (smart
 * account) + clear the auth session, fire `wallet-disconnected` (App.tsx shows the splash), then
 * return to /login. Used by the Settings "Log out" and the account-menu "Sign out".
 */
export function useLogout() {
  const navigate = useNavigate();
  const { disconnect } = useAppKitAuth();
  const { disconnect: disconnectXmtp } = useXMTP();

  /**
   * `sendCode` is the lock screen's fallback: the login screen sends a code to the member it
   * remembers as soon as it opens, so "Send me a code" is one tap and not two.
   */
  return useCallback(async (options?: { sendCode?: boolean }) => {
    try {
      await disconnectXmtp();
    } catch (err) {
      console.error('XMTP disconnect failed:', err);
    }
    try {
      await disconnect();
    } catch (err) {
      console.error('Wallet disconnect failed:', err);
    }
    // The session is over, so the lock's clock and any Face ID confirmation go with it.
    forgetActive();
    clearStepUp();
    // What pages remembered belongs to this member; the next one starts clean.
    forgetRemembered();
    window.dispatchEvent(new Event('wallet-disconnected'));
    setTimeout(() => navigate('/login', options?.sendCode ? { state: { sendCode: true } } : undefined), 300);
  }, [disconnect, disconnectXmtp, navigate]);
}
