import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAppKitAccount } from '@reown/appkit/react';
import { getMemberAccountCenter, type MemberProfileViewResponse } from '@/utils/apiClient';

/**
 * The connected member's profile (real), shared once for the whole shell. Resolves a display name,
 * handle, avatar, initials + private fields (email/phone) from getMemberAccountCenter, falling back
 * to the connected wallet address when no profile is set. Replaces hardcoded identity in the UI.
 */
const short = (a?: string) => (a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '');

function initialsOf(name: string, address: string): string {
  const n = name.trim();
  if (n && !n.startsWith('0x')) {
    const parts = n.split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || n.slice(0, 2).toUpperCase();
  }
  return (address.slice(2, 4) || 'CL').toUpperCase();
}

export interface MemberProfile {
  name: string; // display name, or short address
  firstName: string; // for greetings ("there" when no name)
  handle: string; // email, @username, or short address
  email: string;
  phone: string;
  avatarUrl: string | null;
  username: string;
  address: string;
  initials: string;
  loading: boolean;
  refresh: () => void;
  raw: MemberProfileViewResponse | null;
}

const EMPTY: MemberProfile = {
  name: '', firstName: 'there', handle: '', email: '', phone: '', avatarUrl: null,
  username: '', address: '', initials: 'CL', loading: false, refresh: () => {}, raw: null,
};

const Ctx = createContext<MemberProfile | null>(null);

export function useMemberProfile(): MemberProfile {
  return useContext(Ctx) ?? EMPTY;
}

export function MemberProfileProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAppKitAccount();
  const [raw, setRaw] = useState<MemberProfileViewResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isConnected) {
      setRaw(null);
      return;
    }
    setLoading(true);
    try {
      const r = await getMemberAccountCenter();
      setRaw(r?.profile ?? null);
    } catch {
      setRaw(null);
    } finally {
      setLoading(false);
    }
  }, [isConnected, address]);

  useEffect(() => {
    void load();
  }, [load]);

  const addr = address || '';
  const pub = raw?.publicProfile;
  const priv = raw?.privateProfile;
  const name = pub?.displayName || pub?.username || short(addr) || 'Member';
  const email = priv?.email || '';
  const value: MemberProfile = {
    name,
    firstName: name.startsWith('0x') ? 'there' : name.split(/\s+/)[0] || 'there',
    handle: email || (pub?.username ? `@${pub.username}` : '') || short(addr),
    email,
    phone: priv?.phone || '',
    avatarUrl: pub?.avatarUrl ?? null,
    username: pub?.username || '',
    address: addr,
    initials: initialsOf(pub?.displayName || pub?.username || '', addr),
    loading,
    refresh: () => void load(),
    raw,
  };

  return createElement(Ctx.Provider, { value }, children);
}
