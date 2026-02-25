import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  useAppKit,
  useAppKitAccount,
  useAppKitNetwork,
  useAppKitProvider,
  useDisconnect,
} from '@reown/appkit/react';
import { useAppKitSIWX } from '@reown/appkit-siwx/react';
import type { ReownAuthentication } from '@reown/appkit-siwx';
import { BrowserProvider, hexlify, toUtf8Bytes } from 'ethers';
import { AUTH_EXPIRED_EVENT } from '@/utils/authSession';

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const REAUTH_PROMPT_COOLDOWN_MS = 15_000;

export interface AuthState {
  isConnected: boolean;
  isAuthenticated: boolean;
  address?: string;
  chainId?: number;
  user?: {
    id: string;
    email?: string;
    social?: {
      provider: string;
      id: string;
    };
  };
}

interface AppKitAuthContextValue extends AuthState {
  openModal: (view?: 'Account' | 'Connect' | 'Networks') => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  getUser: () => Promise<AuthState['user'] | null>;
  checkAuthentication: () => Promise<boolean>;
  setSessionMetadata: (metadata: object) => Promise<void>;
  siwx?: ReownAuthentication;
}

const AppKitAuthContext = createContext<AppKitAuthContextValue | null>(null);

function mapSessionAccountToUser(sessionAccount: any): AuthState['user'] | undefined {
  if (!sessionAccount || typeof sessionAccount !== 'object') {
    return undefined;
  }

  const appKitAccount = (sessionAccount as any).appKitAccount;
  const metadata = appKitAccount?.metadata || {};
  const social = metadata?.social;

  const id =
    appKitAccount?.uuid ||
    (typeof sessionAccount.profileUuid === 'string' ? sessionAccount.profileUuid : undefined) ||
    (typeof sessionAccount.address === 'string' ? sessionAccount.address : undefined);

  if (!id) {
    return undefined;
  }

  return {
    id,
    email:
      (typeof metadata?.email === 'string' && metadata.email.length > 0
        ? metadata.email
        : undefined) ||
      (typeof sessionAccount.email === 'string' && sessionAccount.email.length > 0
        ? sessionAccount.email
        : undefined),
    social:
      social && typeof social.provider === 'string' && typeof social.id === 'string'
        ? {
            provider: social.provider,
            id: social.id,
          }
        : undefined,
  };
}

export function AppKitAuthProvider({ children }: { children: React.ReactNode }) {
  const {
    address,
    isConnected: isAppKitConnected,
    embeddedWalletInfo,
    status,
  } = useAppKitAccount();
  const { caipNetworkId } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>('eip155');
  const { open } = useAppKit();
  const { disconnect: disconnectWallet } = useDisconnect();
  const siwx = useAppKitSIWX<ReownAuthentication>();

  const chainId = useMemo(() => {
    if (!caipNetworkId) return undefined;
    const [, id] = caipNetworkId.split(':');
    const parsed = Number(id);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [caipNetworkId]);

  const isEmbeddedWalletConnected = Boolean(embeddedWalletInfo && status === 'connected');
  const isRegularWalletConnected = Boolean(isAppKitConnected && address && status === 'connected');
  const isConnected = isEmbeddedWalletConnected || isRegularWalletConnected;

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthState['user']>();
  const authCheckInFlightRef = useRef<Promise<boolean> | null>(null);
  const lastReauthPromptAtRef = useRef(0);

  const getUser = useCallback(async () => {
    if (!siwx || !isConnected) {
      return null;
    }

    try {
      const sessionAccount = await siwx.getSessionAccount();
      return mapSessionAccountToUser(sessionAccount) || null;
    } catch {
      return null;
    }
  }, [siwx, isConnected]);

  const checkAuthentication = useCallback(async () => {
    if (!siwx || !isConnected) {
      setIsAuthenticated(false);
      setUser(undefined);
      return false;
    }

    if (authCheckInFlightRef.current) {
      return authCheckInFlightRef.current;
    }

    const checkPromise = (async () => {
      try {
        const sessionAccount = await siwx.getSessionAccount();
        const hasSession = Boolean(sessionAccount && typeof sessionAccount === 'object');

        if (!hasSession) {
          setIsAuthenticated(false);
          setUser(undefined);
          return false;
        }

        setIsAuthenticated(true);
        setUser(mapSessionAccountToUser(sessionAccount));
        return true;
      } catch {
        setIsAuthenticated(false);
        setUser(undefined);
        return false;
      } finally {
        authCheckInFlightRef.current = null;
      }
    })();

    authCheckInFlightRef.current = checkPromise;
    return checkPromise;
  }, [siwx, isConnected]);

  const openModal = useCallback(
    async (view?: 'Account' | 'Connect' | 'Networks') => {
      await open(view ? { view } : undefined);
    },
    [open]
  );

  const disconnect = useCallback(async () => {
    await disconnectWallet();
    setIsAuthenticated(false);
    setUser(undefined);
  }, [disconnectWallet]);

  const signMessage = useCallback(
    async (message: string) => {
      if (!address || !isConnected) {
        throw new Error('Wallet is not connected');
      }

      if (walletProvider?.request) {
        const signature = await walletProvider.request({
          method: 'personal_sign',
          params: [hexlify(toUtf8Bytes(message)), address.toLowerCase()],
        });
        if (typeof signature === 'string' && signature.length > 0) {
          return signature;
        }
      }

      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const provider = new BrowserProvider((window as any).ethereum as Eip1193Provider);
        const signer = await provider.getSigner();
        return signer.signMessage(message);
      }

      throw new Error('No signing provider available');
    },
    [address, isConnected, walletProvider]
  );

  const setSessionMetadata = useCallback(
    async (metadata: object) => {
      if (!siwx) {
        throw new Error('SIWX not available');
      }
      await siwx.setSessionAccountMetadata(metadata);
      await checkAuthentication();
    },
    [siwx, checkAuthentication]
  );

  useEffect(() => {
    if (!isConnected) {
      setIsAuthenticated(false);
      setUser(undefined);
      return;
    }

    void checkAuthentication();
  }, [isConnected, address, chainId, checkAuthentication]);

  useEffect(() => {
    if (!siwx || typeof siwx.on !== 'function') {
      return;
    }

    const unsubscribe = siwx.on('sessionChanged', () => {
      void checkAuthentication();
    });

    return () => {
      unsubscribe?.();
    };
  }, [siwx, checkAuthentication]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onAuthExpired = () => {
      setIsAuthenticated(false);
      setUser(undefined);

      if (!isConnected) {
        return;
      }

      void (async () => {
        const restored = await checkAuthentication();
        if (restored) {
          return;
        }

        const now = Date.now();
        if (now - lastReauthPromptAtRef.current < REAUTH_PROMPT_COOLDOWN_MS) {
          return;
        }
        lastReauthPromptAtRef.current = now;

        try {
          await open({ view: 'Connect' });
        } catch (error) {
          console.error('Failed to reopen AppKit modal after auth expiration:', error);
        }
      })();
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    };
  }, [checkAuthentication, isConnected, open]);

  const value = useMemo<AppKitAuthContextValue>(
    () => ({
      isConnected,
      isAuthenticated,
      address: address || undefined,
      chainId,
      user,
      openModal,
      disconnect,
      signMessage,
      getUser,
      checkAuthentication,
      setSessionMetadata,
      siwx,
    }),
    [
      address,
      chainId,
      checkAuthentication,
      disconnect,
      getUser,
      isAuthenticated,
      isConnected,
      openModal,
      setSessionMetadata,
      signMessage,
      siwx,
      user,
    ]
  );

  return <AppKitAuthContext.Provider value={value}>{children}</AppKitAuthContext.Provider>;
}

export function useAppKitAuth() {
  const context = useContext(AppKitAuthContext);
  if (!context) {
    throw new Error('useAppKitAuth must be used within an AppKitAuthProvider');
  }
  return context;
}
