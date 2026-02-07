import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { exchangePlaidToken } from '@/utils/apiClient';

const PLAID_LINK_TOKEN_KEY = 'plaid_link_token';
const PLAID_WALLET_KEY = 'plaid_wallet_address';
const PLAID_RETURN_PATH_KEY = 'plaid_return_path';

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
  if (window.Plaid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-plaid-link]');
    if (existing) {
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
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.async = true;
    script.setAttribute('data-plaid-link', 'true');
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

/**
 * OAuth callback page for Plaid Link.
 * After the user authenticates at an OAuth institution (e.g. Chase), they are redirected here.
 * We reinitialize Link with receivedRedirectUri so the flow can complete and onSuccess fires.
 */
export function PlaidOAuthPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'error' | 'success'>('loading');
  const [message, setMessage] = useState<string>('Completing bank connection…');

  useEffect(() => {
    const oauthStateId = new URLSearchParams(window.location.search).get('oauth_state_id');
    const linkToken = sessionStorage.getItem(PLAID_LINK_TOKEN_KEY);
    const walletAddress = sessionStorage.getItem(PLAID_WALLET_KEY);
    const returnPath = sessionStorage.getItem(PLAID_RETURN_PATH_KEY) || '/';

    if (!oauthStateId || !linkToken || !walletAddress) {
      setStatus('error');
      setMessage('Invalid or expired OAuth return. Please try linking your bank again from the app.');
      sessionStorage.removeItem(PLAID_LINK_TOKEN_KEY);
      sessionStorage.removeItem(PLAID_WALLET_KEY);
      sessionStorage.removeItem(PLAID_RETURN_PATH_KEY);
      const t = setTimeout(() => navigate(returnPath, { replace: true }), 4000);
      return () => clearTimeout(t);
    }

    let mounted = true;

    loadPlaidScript()
      .then(() => {
        if (!mounted || !window.Plaid) return;
        const handler = window.Plaid.create({
          token: linkToken,
          receivedRedirectUri: window.location.href,
          onSuccess: async (public_token: string) => {
            if (!mounted) return;
            setMessage('Saving connection…');
            try {
              const result = await exchangePlaidToken(walletAddress, public_token);
              sessionStorage.removeItem(PLAID_LINK_TOKEN_KEY);
              sessionStorage.removeItem(PLAID_WALLET_KEY);
              sessionStorage.removeItem(PLAID_RETURN_PATH_KEY);
              if (result?.success) {
                setStatus('success');
                setMessage('Bank connected successfully.');
                setTimeout(() => navigate(returnPath, { replace: true }), 1500);
              } else {
                setStatus('error');
                setMessage('Failed to save connection. Please try again.');
                setTimeout(() => navigate(returnPath, { replace: true }), 3000);
              }
            } catch {
              setStatus('error');
              setMessage('Something went wrong. Please try again.');
              setTimeout(() => navigate(returnPath, { replace: true }), 3000);
            }
          },
          onExit: (err) => {
            if (!mounted) return;
            sessionStorage.removeItem(PLAID_LINK_TOKEN_KEY);
            sessionStorage.removeItem(PLAID_WALLET_KEY);
            sessionStorage.removeItem(PLAID_RETURN_PATH_KEY);
            if (err) {
              setStatus('error');
              setMessage(err instanceof Error ? err.message : 'Link was closed.');
            }
            setTimeout(() => navigate(returnPath, { replace: true }), 3000);
          },
        });
        handler.open();
      })
      .catch(() => {
        if (!mounted) return;
        setStatus('error');
        setMessage('Could not load Plaid. Please try again from the app.');
        setTimeout(() => navigate(returnPath, { replace: true }), 4000);
      });

    return () => {
      mounted = false;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-6">
      {status === 'loading' && (
        <>
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-muted-foreground">{message}</p>
        </>
      )}
      {status === 'success' && (
        <>
          <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-foreground font-medium">{message}</p>
          <p className="text-sm text-muted-foreground mt-1">Redirecting back to app…</p>
        </>
      )}
      {status === 'error' && (
        <>
          <p className="text-destructive font-medium">{message}</p>
          <p className="text-sm text-muted-foreground mt-2">Redirecting back to app…</p>
        </>
      )}
    </div>
  );
}

export const PLAID_OAUTH_KEYS = {
  linkToken: PLAID_LINK_TOKEN_KEY,
  wallet: PLAID_WALLET_KEY,
  returnPath: PLAID_RETURN_PATH_KEY,
} as const;
