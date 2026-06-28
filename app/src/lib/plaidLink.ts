import { getPlaidLinkToken, exchangePlaidToken } from '@/utils/apiClient';

/*
 * Plaid Link via the CDN script + window.Plaid (the pattern already used by
 * components/portfolio/DepositModal.tsx — no npm dep). Backend routes already exist
 * (/api/plaid/link-token, /api/plaid/exchange-token).
 */

function loadPlaidScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Plaid) return resolve();
    const waitForGlobal = () => {
      const start = Date.now();
      const check = setInterval(() => {
        if (window.Plaid) {
          clearInterval(check);
          resolve();
        } else if (Date.now() - start > 10000) {
          clearInterval(check);
          reject(new Error('Plaid script failed to load'));
        }
      }, 100);
    };
    if (document.querySelector('script[src*="plaid.com/link"]')) return waitForGlobal();
    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.async = true;
    script.onload = waitForGlobal;
    script.onerror = () => reject(new Error('Failed to load Plaid script'));
    document.head.appendChild(script);
  });
}

/** Run Plaid Link for a wallet. Resolves true once the public token is exchanged, false if the user exits. */
export async function runPlaidLink(walletAddress: string): Promise<boolean> {
  const res = await getPlaidLinkToken(walletAddress);
  if (!res?.link_token) throw new Error('Plaid is not configured');
  await loadPlaidScript();
  if (!window.Plaid) throw new Error('Plaid Link is unavailable');
  return new Promise<boolean>((resolve, reject) => {
    let fired = false;
    const handler = window.Plaid!.create({
      token: res.link_token,
      onSuccess: async (public_token: string) => {
        fired = true;
        try {
          const exchanged = await exchangePlaidToken(walletAddress, public_token);
          resolve(Boolean(exchanged?.success));
        } catch (e) {
          reject(e instanceof Error ? e : new Error('Failed to link bank'));
        }
      },
      onExit: () => {
        if (!fired) resolve(false);
      },
    });
    handler.open();
  });
}
