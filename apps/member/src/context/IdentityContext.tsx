import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getLithicAccount, type LithicAccountResponse } from '@/utils/apiClient';
import { toIdentityStatus, type IdentityStatus } from '@/lib/identityStatus';
import VerifyIdentityModal from '@/components/app-ui/VerifyIdentityModal';

/*
 * The app's single answer to "is this member verified".
 *
 * One provider, one read, one status — the shape the notifications bug taught. Every surface that
 * asks (the Settings row, the card, a term plan) reads this rather than fetching its own copy that
 * can disagree.
 */
interface IdentityValue {
  status: IdentityStatus;
  account: LithicAccountResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Whether the verification flow is on screen. */
  open: boolean;
  openVerification: () => void;
  closeVerification: () => void;
}

const Ctx = createContext<IdentityValue | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { address } = useAppKitAccount();
  const [account, setAccount] = useState<LithicAccountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) {
      setAccount(null);
      setLoading(false);
      return;
    }
    const result = await getLithicAccount();
    setAccount(result);
    setLoading(false);
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * Re-read when the tab comes back.
   *
   * Three of the five statuses resolve on Lithic's side, minutes or a day later, and the screen
   * promises "you can close this — we'll tell you either way". A member who takes that at its word
   * and returns should not find the old state waiting for them.
   */
  useEffect(() => {
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const value: IdentityValue = {
    status: toIdentityStatus(account),
    account,
    loading,
    refresh,
    open,
    openVerification: () => setOpen(true),
    closeVerification: () => setOpen(false),
  };

  /*
   * The modal is hosted by the provider, not by each caller.
   *
   * Settings, card activation and (later) onboarding all open the same one, and hosting it beside
   * the state is what keeps "same modal each time" true rather than aspirational — three copies
   * would drift the way three copies of the notification state did.
   */
  return (
    <Ctx.Provider value={value}>
      {children}
      <VerifyIdentityModal />
    </Ctx.Provider>
  );
}

/** The member's identity state. Throws outside the provider rather than answering "unverified". */
export function useIdentity(): IdentityValue {
  const value = useContext(Ctx);
  if (!value) {
    // A silent default here would be a second, wrong answer to the question this context exists to
    // make singular — and "unverified" is the worst possible default to invent.
    throw new Error('useIdentity must be used within an IdentityProvider (mounted in AppShell)');
  }
  return value;
}
