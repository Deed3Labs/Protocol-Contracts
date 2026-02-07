/**
 * Plaid OAuth redirect page.
 * After the user completes bank OAuth (e.g. Chase), Plaid redirects here with ?oauth_state_id=...
 * We reinitialize Link with receivedRedirectUri so the flow can complete and onSuccess fires.
 * See: https://plaid.com/docs/link/oauth/
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { exchangePlaidToken } from '@/utils/apiClient';

const PLAID_LINK_TOKEN_KEY = 'plaid_link_token';
const PLAID_WALLET_KEY = 'plaid_wallet_address';

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        receivedRedirectUri?: string;
        onSuccess: (public_token: string) => void;
        onExit?: (err: unknown, metadata: unknown) => void;
      }) => { open: () => void };
    };
  }
}

function loadPlaidScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Plaid) {
      resolve();
      return;
    }
    if (document.querySelector('script[src*="plaid.com/link"]')) {
      const check = setInterval(() => {
        if (window.Plaid) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        if (!window.Plaid) reject(new Error('Plaid script failed to load'));
      }, 10000);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.async = true;
    script.onload = () => {
      const check = setInterval(() => {
        if (window.Plaid) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        if (!window.Plaid) reject(new Error('Plaid not available'));
      }, 5000);
    };
    script.onerror = () => reject(new Error('Failed to load Plaid script'));
    document.head.appendChild(script);
  });
}

export function PlaidOAuthPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'expired'>('loading');
  const [message, setMessage] = useState<string>('Completing connection…');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthStateId = params.get('oauth_state_id');

    if (!oauthStateId) {
      setStatus('expired');
      setMessage('No OAuth state. Start the bank connection from the app.');
      return;
    }

    const linkToken = localStorage.getItem(PLAID_LINK_TOKEN_KEY);
    const walletAddress = localStorage.getItem(PLAID_WALLET_KEY);

    if (!linkToken || !walletAddress) {
      setStatus('expired');
      setMessage('Session expired. Please open the app and try linking your bank again.');
      return;
    }

    let cancelled = false;

    loadPlaidScript()
      .then(() => {
        if (cancelled || !window.Plaid) return;
        const handler = window.Plaid.create({
          token: linkToken,
          receivedRedirectUri: window.location.href,
          onSuccess: async (public_token: string) => {
            if (cancelled) return;
            setStatus('loading');
            setMessage('Saving connection…');
            localStorage.removeItem(PLAID_LINK_TOKEN_KEY);
            localStorage.removeItem(PLAID_WALLET_KEY);
            try {
              const result = await exchangePlaidToken(walletAddress, public_token);
              if (cancelled) return;
              if (result?.success) {
                setStatus('success');
                setMessage('Account linked successfully.');
                setTimeout(() => navigate('/', { replace: true }), 1500);
              } else {
                setStatus('error');
                setMessage('Failed to save connection. You can try again from the app.');
              }
            } catch {
              if (cancelled) return;
              setStatus('error');
              setMessage('Something went wrong. You can try again from the app.');
            }
          },
          onExit: (err) => {
            if (cancelled) return;
            localStorage.removeItem(PLAID_LINK_TOKEN_KEY);
            localStorage.removeItem(PLAID_WALLET_KEY);
            setStatus('error');
            setMessage(err ? (err instanceof Error ? err.message : 'Connection was not completed.') : 'Connection cancelled.');
          },
        });
        handler.open();
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Failed to load Plaid.');
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="max-w-sm w-full text-center space-y-4">
        {status === 'loading' && (
          <>
            <div className="w-12 h-12 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-white rounded-full animate-spin mx-auto" />
            <p className="text-zinc-600 dark:text-zinc-400">{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto text-2xl">✓</div>
            <p className="font-medium text-zinc-900 dark:text-white">{message}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Taking you back to the app…</p>
          </>
        )}
        {(status === 'error' || status === 'expired') && (
          <>
            <p className="font-medium text-zinc-900 dark:text-white">{message}</p>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="mt-4 px-4 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-medium hover:opacity-90"
            >
              Back to app
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export { PLAID_LINK_TOKEN_KEY, PLAID_WALLET_KEY };
