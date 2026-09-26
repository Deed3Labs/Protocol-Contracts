/**
 * Plaid Link, as the member app runs it (apps/member/src/lib/plaidLink.ts): Plaid's own script from
 * its CDN, then `window.Plaid.create`. Resolves with what the API needs to register the account, or
 * null if the owner closed it. In development against the mock, a `mock-` token stands in for Plaid
 * and picks its checking account, so the flow can be walked without a bank.
 */

type PlaidHandler = { open: () => void; destroy?: () => void };
type PlaidGlobal = {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: { accounts?: { id: string }[]; account_id?: string | null; institution?: { name?: string } | null }) => void;
    onExit: () => void;
  }) => PlaidHandler;
};

export interface LinkedChoice {
  publicToken: string;
  accountId: string;
  institution: string | null;
}

function loadPlaid(): Promise<PlaidGlobal> {
  const w = window as unknown as { Plaid?: PlaidGlobal };
  if (w.Plaid) return Promise.resolve(w.Plaid);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.async = true;
    script.onload = () => (w.Plaid ? resolve(w.Plaid) : reject(new Error('Plaid didn’t load. Check the connection and try again.')));
    script.onerror = () => reject(new Error('Plaid didn’t load. Check the connection and try again.'));
    document.head.appendChild(script);
  });
}

export async function runPlaidLink(linkToken: string): Promise<LinkedChoice | null> {
  if (linkToken.startsWith('mock-')) return { publicToken: 'mock-public', accountId: 'mock-checking', institution: 'First Platypus Bank' };
  const Plaid = await loadPlaid();
  return new Promise((resolve) => {
    let handler: PlaidHandler | null = null;
    const done = (v: LinkedChoice | null) => {
      setTimeout(() => handler?.destroy?.(), 0);
      resolve(v);
    };
    handler = Plaid.create({
      token: linkToken,
      onSuccess: (publicToken, metadata) => {
        const accountId = metadata.accounts?.[0]?.id ?? metadata.account_id ?? '';
        done(accountId ? { publicToken, accountId, institution: metadata.institution?.name ?? null } : null);
      },
      onExit: () => done(null),
    });
    handler.open();
  });
}
