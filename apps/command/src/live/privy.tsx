import { PrivyProvider, getAccessToken, useConnectWallet, useLogin, useLoginWithEmail, useLoginWithPasskey, usePrivy, useWallets } from '@privy-io/react-auth';
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
  /** The wallets this person has here: their Clear wallet, and any they've connected. */
  wallets(): string[];
  /** Privy's window for connecting a wallet extension or app (a Safe signer's own wallet). */
  connectWallet(): Promise<string>;
  /** Signs with one of their wallets; the wallet shows its own prompt. Command never holds a key. */
  signMessage(address: string, message: string): Promise<string>;
  signTypedData(address: string, typedData: unknown): Promise<string>;
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
  wallets: () => [],
  connectWallet: () => Promise.reject(new Error('Wallets aren’t ready yet')),
  signMessage: () => Promise.reject(new Error('Wallets aren’t ready yet')),
  signTypedData: () => Promise.reject(new Error('Wallets aren’t ready yet')),
};

let connecting: { resolve: (a: string) => void; reject: (e: unknown) => void } | null = null;

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

  const { wallets } = useWallets();
  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet }) => {
      connecting?.resolve(wallet.address);
      connecting = null;
    },
    onError: (e) => {
      connecting?.reject(new Error(String(e)));
      connecting = null;
    },
  });
  const walletOf = (address: string) => {
    const w = wallets.find((x) => x.address.toLowerCase() === address.toLowerCase());
    if (!w) throw new Error('That wallet isn’t connected here');
    return w;
  };
  privy.wallets = () => wallets.map((w) => w.address);
  privy.connectWallet = () =>
    new Promise<string>((resolve, reject) => {
      connecting = { resolve, reject };
      connectWallet();
    });
  privy.signMessage = async (address, message) => {
    const provider = await walletOf(address).getEthereumProvider();
    return provider.request({ method: 'personal_sign', params: [message, address] });
  };
  privy.signTypedData = async (address, typedData) => {
    const provider = await walletOf(address).getEthereumProvider();
    return provider.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typedData)] });
  };

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
        // Members already have their wallet from the Clear app. A Safe signer signs with their own
        // wallet, so it shows its prompt: Command never holds a key and never signs silently.
        embeddedWallets: { ethereum: { createOnLogin: 'off' }, showWalletUIs: true },
        appearance: { theme: 'light' },
      }}
    >
      <Bridge />
    </PrivyProvider>
  );
}
