import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { useXMTP } from '@/context/XMTPContext';

/**
 * Fully sign the user out: close the XMTP client, disconnect the Reown/AppKit wallet (smart
 * account) + clear the auth session, fire `wallet-disconnected` (App.tsx shows the splash), then
 * return to /login. Used by the Settings "Log out" and the account-menu "Sign out".
 */
export function useLogout() {
  const navigate = useNavigate();
  const { disconnect } = useAppKitAuth();
  const { disconnect: disconnectXmtp } = useXMTP();

  return useCallback(async () => {
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
    window.dispatchEvent(new Event('wallet-disconnected'));
    setTimeout(() => navigate('/login'), 300);
  }, [disconnect, disconnectXmtp, navigate]);
}
