import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { usePrivy, useSignMessage, useCreateWallet } from '@privy-io/react-auth';
import { useChainId } from 'wagmi';
import { useAppKitAccount } from '@/lib/walletCompat';
import { setActiveWallet } from '@/utils/authSession';

/*
 * Privy-backed auth context, keeping the AppKitAuthContextValue shape the ~21 consumers expect
 * (isAuthenticated, authenticate, openModal, disconnect, signMessage, getUser, ...). Authentication is
 * Privy's login (issues the JWT the apiClient sends). SIWX/Reown is gone. `siwx` + `setSessionMetadata`
 * are no-ops here — only the soon-to-be-deleted legacy SWIX pages referenced them. See
 * [[clearpath-privy-migration]].
 */

export interface AuthState {
  isConnected: boolean;
  isAuthenticated: boolean;
  address?: string;
  chainId?: number;
  user?: {
    id: string;
    email?: string;
    social?: { provider: string; id: string };
  };
}

interface AppKitAuthContextValue extends AuthState {
  openModal: (view?: 'Account' | 'Connect' | 'Networks') => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  authenticate: () => Promise<boolean>;
  getUser: () => Promise<AuthState['user'] | null>;
  checkAuthentication: () => Promise<boolean>;
  setSessionMetadata: (metadata: object) => Promise<void>;
  // Reown SIWX is gone; kept loosely-typed only so the soon-to-be-deleted legacy SWIX pages compile.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  siwx?: any;
}

const AppKitAuthContext = createContext<AppKitAuthContextValue | null>(null);

type PrivyUserLike = {
  id?: string;
  email?: { address?: string } | string;
  linkedAccounts?: Array<{ type?: string; subject?: string; email?: string }>;
} | null | undefined;

function mapPrivyUser(user: PrivyUserLike): AuthState['user'] | undefined {
  if (!user?.id) return undefined;
  const email = typeof user.email === 'string' ? user.email : user.email?.address;
  const oauth = user.linkedAccounts?.find((a) => typeof a.type === 'string' && a.type.endsWith('_oauth'));
  const social = oauth
    ? { provider: (oauth.type as string).replace('_oauth', ''), id: oauth.subject ?? '' }
    : undefined;
  return { id: user.id, email, social };
}

export function AppKitAuthProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { signMessage: privySignMessage } = useSignMessage();
  const { createWallet } = useCreateWallet();
  const { address } = useAppKitAccount();
  const chainId = useChainId();

  // Keep per-wallet caches keyed to the active address.
  useEffect(() => {
    if (address) setActiveWallet(address);
  }, [address]);

  // Email/social users need an embedded EOA — the signer behind their smart wallet. `createOnLogin`
  // doesn't always fire (existing wallet-less users, or a prior failed smart-wallet mint), so ensure
  // one exists. Once the embedded wallet is there, SmartWalletsProvider mints the smart wallet on top.
  const hasEmbeddedWallet = !!user?.wallet?.address;
  const ensureWalletTriedRef = useRef(false);
  useEffect(() => {
    if (!authenticated) {
      ensureWalletTriedRef.current = false;
      return;
    }
    if (ready && !hasEmbeddedWallet && !ensureWalletTriedRef.current) {
      ensureWalletTriedRef.current = true;
      createWallet().catch((e) => console.warn('[privy] ensure embedded wallet failed:', e));
    }
  }, [ready, authenticated, hasEmbeddedWallet, createWallet]);

  const mappedUser = useMemo(() => mapPrivyUser(user as PrivyUserLike), [user]);

  const openModal = useCallback(async () => {
    if (!authenticated) login();
  }, [authenticated, login]);

  const disconnect = useCallback(async () => {
    await logout();
  }, [logout]);

  const signMessage = useCallback(
    async (message: string) => {
      const res = await privySignMessage({ message });
      return typeof res === 'string' ? res : (res?.signature ?? '');
    },
    [privySignMessage],
  );

  const authenticate = useCallback(async () => {
    if (!authenticated) login();
    return authenticated;
  }, [authenticated, login]);

  const getUser = useCallback(async () => mappedUser ?? null, [mappedUser]);
  const checkAuthentication = useCallback(async () => authenticated, [authenticated]);
  const setSessionMetadata = useCallback(async () => {
    /* no-op: Privy manages the session/JWT itself */
  }, []);

  const value = useMemo<AppKitAuthContextValue>(
    () => ({
      isConnected: !!authenticated && !!address,
      isAuthenticated: !!ready && !!authenticated,
      address,
      chainId,
      user: mappedUser,
      openModal,
      disconnect,
      signMessage,
      authenticate,
      getUser,
      checkAuthentication,
      setSessionMetadata,
      siwx: undefined,
    }),
    [
      ready,
      authenticated,
      address,
      chainId,
      mappedUser,
      openModal,
      disconnect,
      signMessage,
      authenticate,
      getUser,
      checkAuthentication,
      setSessionMetadata,
    ],
  );

  return <AppKitAuthContext.Provider value={value}>{children}</AppKitAuthContext.Provider>;
}

export function useAppKitAuth() {
  const ctx = useContext(AppKitAuthContext);
  if (!ctx) {
    throw new Error('useAppKitAuth must be used within an AppKitAuthProvider');
  }
  return ctx;
}
