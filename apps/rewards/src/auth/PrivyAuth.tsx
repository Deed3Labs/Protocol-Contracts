import { PrivyProvider, useLinkAccount, useLoginWithOAuth, useLoginWithSms, usePrivy, getAccessToken } from '@privy-io/react-auth';
import { SmartWalletsProvider, useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { base, baseSepolia } from 'viem/chains';
import { liveData } from '../data/real';
import { DataContext } from '../data/context';
import { AuthContext, type CodeResult, type Provider, type RewardsAuth } from './auth';
import { CLEAR_CHAIN, API_BASE } from '../lib/env';

/**
 * The live app: the same Privy app and sign-in methods as the Clear app (apps/member AppKitProvider),
 * phone first. The smart wallet is the member's, so paying from the balance here is paying from the
 * same account.
 */
export function PrivyApp({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID ?? ''}
      config={{
        loginMethods: ['sms', 'email', 'google', 'apple'],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, showWalletUIs: false },
        defaultChain: CLEAR_CHAIN.id === base.id ? base : baseSepolia,
        supportedChains: [base, baseSepolia],
        appearance: { theme: 'light' },
      }}
    >
      <SmartWalletsProvider>
        <Live>{children}</Live>
      </SmartWalletsProvider>
    </PrivyProvider>
  );
}

function Live({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const sms = useLoginWithSms();
  const oauth = useLoginWithOAuth();
  const { linkPhone } = useLinkAccount();
  const { client, getClientForChain } = useSmartWallets();
  const [phone, setPhone] = useState<string | null>(null);
  const lastCode = useRef<string>('');

  const smart = privy.user?.smartWallet?.address?.toLowerCase() ?? null;
  const data = useMemo(
    () =>
      liveData({
        apiBase: API_BASE,
        privyToken: () => getAccessToken(),
        wallet: () => smart,
        sendCalls: async (calls, chainId) => {
          if (!client) throw new Error('Your Clear wallet isn’t ready yet. Try again in a moment.');
          const c = await getClientForChain({ id: chainId });
          if (!c) throw new Error('Your Clear wallet isn’t ready yet. Try again in a moment.');
          return c.sendTransaction({ calls: calls.map((x) => ({ to: x.to, data: x.data, value: 0n })) });
        },
        chain: CLEAR_CHAIN,
      }),
    [smart, client, getClientForChain],
  );

  const auth: RewardsAuth = {
    ready: privy.ready,
    signedIn: privy.ready && privy.authenticated,
    phone,
    providers: import.meta.env.VITE_APPLE_SIGN_IN === 'on' ? ['email', 'google', 'apple'] : ['email', 'google'],
    async sendCode(p) {
      setPhone(p);
      // Signups off: an unknown number gets a code like any other, and nothing is made until it's confirmed.
      await sms.sendCode({ phoneNumber: p, disableSignup: true });
    },
    async submitCode(code): Promise<CodeResult> {
      lastCode.current = code;
      try {
        await sms.loginWithCode({ code });
        return 'signed_in';
      } catch (e) {
        // Privy checks the code before it says whether the number is anyone's (DECISIONS, the Privy spike).
        if (/user_does_not_exist|not.?exist/i.test(String((e as { privyErrorCode?: string })?.privyErrorCode ?? (e as Error)?.message))) return 'no_account';
        throw e;
      }
    },
    async createFromCode() {
      if (!phone) throw new Error('Your number first');
      try {
        await sms.sendCode({ phoneNumber: phone });
        await sms.loginWithCode({ code: lastCode.current });
      } catch {
        // The code was used up by the first check: they're sent one more (DECISIONS, the Privy spike).
        throw Object.assign(new Error('We’ve sent you a new code'), { code: 'new_code' });
      }
    },
    async signInWith(provider: Provider, opts) {
      if (provider === 'email') privy.login({ loginMethods: ['email'] });
      else await oauth.initOAuth({ provider });
      if (opts?.thenLinkPhone) sessionStorage.setItem('rewards:link-phone', '1');
    },
    async signOut() {
      await privy.logout();
    },
  };

  // After "Yes, sign in to my account": once they're in, the number they confirmed is added to it.
  if (auth.signedIn && sessionStorage.getItem('rewards:link-phone') === '1') {
    sessionStorage.removeItem('rewards:link-phone');
    linkPhone();
  }

  return (
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>{children}</DataContext.Provider>
    </AuthContext.Provider>
  );
}
