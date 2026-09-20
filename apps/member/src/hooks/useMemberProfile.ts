import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getMemberAccountCenter, bootstrapMemberAccount, type MemberProfileViewResponse, type MemberStatus } from '@/utils/apiClient';
import { getStoredAvatar, setStoredAvatar } from '@/lib/avatarStore';
import { rememberMember } from '@/lib/rememberedMember';

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

/** Where post goes. Empty strings rather than nulls, so a form can hold it without translating. */
export interface MailingAddress {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
}

export const EMPTY_ADDRESS: MailingAddress = { line1: '', line2: '', city: '', state: '', postalCode: '' };

/** One line for a row that shows it; empty when there is nothing on file. */
export function formatAddress(a: MailingAddress): string {
  const tail = [a.city, a.state].filter(Boolean).join(', ');
  return [a.line1, a.line2, [tail, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

export interface MemberProfile {
  name: string; // display name, or short address
  /** The member's own name and contact -- empty when the read has not answered. Never the address. */
  displayName: string;
  contactHandle: string;
  /** The name on legal documents. Empty until identity verification supplies one. */
  legalName: string;
  firstName: string; // for greetings ("there" when no name)
  handle: string; // email, @username, or short address
  email: string;
  phone: string;
  /** The member's own mailing address, which is where a physical card is posted. */
  mailingAddress: MailingAddress;
  avatarUrl: string | null;
  username: string;
  address: string;
  initials: string;
  loading: boolean;
  /** The read has come back at least once — including when it came back empty or failed. */
  loaded: boolean;
  /** Member lifecycle status; 'ONBOARDING' = brand-new, hasn't completed onboarding. null until loaded. */
  memberStatus: MemberStatus | null;
  /** On the Accelerated track (membershipPlan LIFETIME) — earns the full 1.5× equity-credit multiplier. */
  accelerated: boolean;
  refresh: () => void;
  /** Set/clear the local avatar (data URL); persists per-wallet in localStorage. */
  setAvatar: (dataUrl: string | null) => void;
  raw: MemberProfileViewResponse | null;
}

const EMPTY: MemberProfile = {
  name: '', displayName: '', contactHandle: '', legalName: '', firstName: 'there', handle: '', email: '', phone: '',
  mailingAddress: EMPTY_ADDRESS, avatarUrl: null,
  username: '', address: '', initials: 'CL', loading: false, loaded: false, memberStatus: null, accelerated: false, refresh: () => {}, setAvatar: () => {}, raw: null,
};

const Ctx = createContext<MemberProfile | null>(null);

export function useMemberProfile(): MemberProfile {
  const ctx = useContext(Ctx);
  /**
   * The fallback is deliberate — a component can read a name it does not have yet — but it is a
   * bad answer for anything that WAITS on this. `loaded` and `loading` are both frozen false in
   * EMPTY, so "no provider" is indistinguishable from "still reading", and a screen that holds
   * for the member's status holds forever. That is a silent hang, so say it out loud in dev.
   */
  if (!ctx && import.meta.env.DEV) {
    console.error(
      'useMemberProfile: no MemberProfileProvider above this component. Falling back to empty ' +
        'values — memberStatus stays null and loaded stays false, so anything waiting on either ' +
        'will wait forever. Wrap the route.',
    );
  }
  return ctx ?? EMPTY;
}

export function MemberProfileProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAppKitAccount();
  const [raw, setRaw] = useState<MemberProfileViewResponse | null>(null);
  const [memberStatus, setMemberStatus] = useState<MemberStatus | null>(null);
  const [accelerated, setAccelerated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [localAvatar, setLocalAvatar] = useState<string | null>(null);

  useEffect(() => {
    setLocalAvatar(address ? getStoredAvatar(address) : null);
  }, [address]);

  const setAvatar = useCallback(
    (dataUrl: string | null) => {
      setLocalAvatar(dataUrl);
      if (address) setStoredAvatar(address, dataUrl);
    },
    [address],
  );

  const load = useCallback(async () => {
    if (!isConnected) {
      setRaw(null);
      setMemberStatus(null);
      setAccelerated(false);
      setLoaded(true);
      return;
    }
    setLoading(true);
    try {
      // Ensure a member record exists for this Privy DID (idempotent upsert) BEFORE reading it, so
      // capability-gated features (Plaid, Bridge) work for users who came straight in without the
      // onboarding flow. Without this, the capability check finds no member and 403s.
      await bootstrapMemberAccount().catch(() => {});
      const r = await getMemberAccountCenter();
      setRaw(r?.profile ?? null);
      setMemberStatus(r?.member?.status ?? null);
      setAccelerated(r?.member?.membershipPlan === 'LIFETIME');
    } catch {
      setRaw(null);
      setMemberStatus(null);
      setAccelerated(false);
    } finally {
      // Set on the way out of every path, the failures included. A caller waiting on this is
      // waiting for an answer, and "we could not tell" is one -- leaving it false would park them
      // on a spinner for as long as the API is unhappy.
      setLoaded(true);
      setLoading(false);
    }
  }, [isConnected, address]);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming back is a different screen from arriving, and it needs a name to say. Written here
  // because this is the only place that knows one — see lib/rememberedMember.
  useEffect(() => {
    const pub = raw?.publicProfile;
    const priv = raw?.privateProfile;
    const display = pub?.displayName || pub?.username || '';
    if (!loaded || !display) return;
    rememberMember({
      name: display,
      handle: priv?.email || (pub?.username ? `@${pub.username}` : ''),
      contact: priv?.phone || priv?.email || '',
    });
  }, [loaded, raw]);

  const addr = address || '';
  const pub = raw?.publicProfile;
  const priv = raw?.privateProfile;
  const name = pub?.displayName || pub?.username || short(addr) || 'Member';
  const email = priv?.email || '';
  const display = pub?.displayName || pub?.username || '';
  const value: MemberProfile = {
    name,
    /*
     * Their own name, or nothing. `name` falls back to the wallet address so a screen always has
     * something to draw; a screen that would rather say nothing than "0x7ec1...86cF" -- the lock,
     * which cannot read the profile while it is locked -- needs to be able to tell the difference.
     */
    displayName: display,
    contactHandle: email || (pub?.username ? `@${pub.username}` : ''),
    /*
     * The name on legal documents, which is not the name on the profile.
     *
     * `name` is the public display name — "Kai M" — chosen to be shown to other members next to a
     * payment. Settings was rendering a hardcoded 'Kai Moore' in the Legal name row instead, which
     * happened to look plausible and was somebody else's fixture.
     *
     * Empty until identity verification supplies it: a legal name is what a member's bank and the
     * card issuer agree on, and inventing one from a display handle would put a guess in the row
     * that exists to hold the real thing.
     */
    legalName: priv?.legalName || '',
    firstName: name.startsWith('0x') ? 'there' : name.split(/\s+/)[0] || 'there',
    handle: email || (pub?.username ? `@${pub.username}` : '') || short(addr),
    email,
    phone: priv?.phone || '',
    mailingAddress: {
      line1: priv?.addressLine1 || '',
      line2: priv?.addressLine2 || '',
      city: priv?.addressCity || '',
      state: priv?.addressState || '',
      postalCode: priv?.addressPostalCode || '',
    },
    // Prefer the backend (cross-device) avatar URL; local cache is the optimistic/offline fallback.
    avatarUrl: (pub?.avatarUrl?.startsWith('http') ? pub.avatarUrl : null) || localAvatar,
    username: pub?.username || '',
    address: addr,
    initials: initialsOf(pub?.displayName || pub?.username || '', addr),
    loading,
    loaded,
    memberStatus,
    accelerated,
    refresh: () => void load(),
    setAvatar,
    raw,
  };

  return createElement(Ctx.Provider, { value }, children);
}
