import { PrivyProvider, getAccessToken, useLogin, useLoginWithEmail, useLoginWithPasskey, usePrivy } from '@privy-io/react-auth';
import { useEffect } from 'react';
import { PRIVY_APP_ID } from './env';

/**
 * Privy, behind the prototype's own sign-in screens. The same Privy app as the Clear app, so a
 * member's login works here unchanged. The screens are drawn by the sections (sections/signin.tsx);
 * they call these through `privy`, which the bridge below fills in once Privy is ready.
 */
export interface PrivyActions {
  ready: boolean;
  authenticated: boolean;
  passkey(): Promise<void>;
  sendCode(email: string): Promise<void>;
  loginWithCode(code: string): Promise<void>;
  /** Privy's own window, for members who joined by phone, Google or Apple. */
  other(): Promise<void>;
  token(): Promise<string | null>;
  logout(): Promise<void>;
}

const pending: Array<() => void> = [];
export const privy: PrivyActions = {
  ready: false,
  authenticated: false,
  passkey: () => Promise.reject(new Error('Sign-in isn’t ready yet')),
  sendCode: () => Promise.reject(new Error('Sign-in isn’t ready yet')),
  loginWithCode: () => Promise.reject(new Error('Sign-in isn’t ready yet')),
  other: () => Promise.reject(new Error('Sign-in isn’t ready yet')),
  token: () => getAccessToken(),
  logout: async () => undefined,
};

/** Resolves once Privy has loaded and knows whether someone is signed in. */
export function privyReady(): Promise<void> {
  return privy.ready ? Promise.resolve() : new Promise((r) => pending.push(r));
}

let otherLogin: { resolve: () => void; reject: (e: unknown) => void } | null = null;

function Bridge() {
  const p = usePrivy();
  const { loginWithPasskey } = useLoginWithPasskey();
  const email = useLoginWithEmail();
  const { login } = useLogin({
    onComplete: () => {
      otherLogin?.resolve();
      otherLogin = null;
    },
    onError: (e) => {
      otherLogin?.reject(new Error(String(e)));
      otherLogin = null;
    },
  });

  privy.authenticated = p.ready && p.authenticated;
  privy.passkey = () => loginWithPasskey();
  privy.sendCode = (address) => email.sendCode({ email: address });
  privy.loginWithCode = (code) => email.loginWithCode({ code });
  privy.other = () =>
    new Promise<void>((resolve, reject) => {
      otherLogin = { resolve, reject };
      login({ loginMethods: ['sms', 'google', 'apple'] });
    });
  privy.logout = () => p.logout();

  useEffect(() => {
    if (!p.ready) return;
    privy.ready = true;
    pending.splice(0).forEach((r) => r());
  }, [p.ready]);
  return null;
}

export function PrivyBridge() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['passkey', 'email', 'sms', 'google', 'apple'],
        // The Command Center reads; it never signs. Members already have their wallet from the Clear app.
        embeddedWallets: { ethereum: { createOnLogin: 'off' }, showWalletUIs: false },
        appearance: { theme: 'light' },
      }}
    >
      <Bridge />
    </PrivyProvider>
  );
}
