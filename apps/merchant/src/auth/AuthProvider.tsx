import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { canAuthoriseRefund, seesMoney, type Staff } from '@clear/domain';
import { api, ApiError, storeToken } from '@/data/apiClient';
import { AuthContext, type AuthValue, type Session } from '@/auth/authContext';

/**
 * The provider, alone in its file.
 *
 * Splitting it from the context and the `useAuth` hook is not tidiness: a module exporting both a
 * component and a plain function cannot Fast Refresh, so every edit here would tear the app down
 * to a blank screen and an "incompatible export" error.
 *
 * **The server decides what this device is, not localStorage.** On load the token is exchanged for
 * a session; a token that has expired, or belongs to a staff member since deactivated, resolves to
 * nothing and the tablet returns to the PIN pad. Storing the role locally and trusting it would
 * mean a writer who left the shop still has a counter session until their token happens to expire.
 */

/**
 * Which shop this tablet belongs to.
 *
 * A PIN only means anything against one merchant — sign-in is scoped, so two shops can both have a
 * 4821 and neither is wrong. Provisioning a device with its merchant address is part of the same
 * unresolved question as the signing key (see `data/chargeSigner.ts`); until that is settled the
 * address comes from the environment, with a localStorage override for a device set up by hand.
 */
const MERCHANT_KEY = 'clear.merchant.address';

export function merchantAddress(): string {
  try {
    const stored = window.localStorage.getItem(MERCHANT_KEY);
    if (stored) return stored;
  } catch {
    // Private windows throw rather than returning null.
  }
  return (import.meta.env.VITE_MERCHANT_ADDRESS as string | undefined) ?? '';
}

export function setMerchantAddress(address: string): void {
  try {
    window.localStorage.setItem(MERCHANT_KEY, address.trim().toLowerCase());
  } catch {
    // A tablet that cannot persist still works for the length of a shift.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve whatever token this device holds, once, on load.
  useEffect(() => {
    let cancelled = false;
    api
      .currentSession()
      .then((res) => {
        if (cancelled || !res) return;
        setSession({
          staff: { ...res.staff, hasPin: true, active: true } as Staff,
          method: res.staff.role === 'owner' ? 'password' : 'pin',
        });
      })
      .catch(() => {
        // A server that cannot be reached is a tablet that cannot take a charge. The sign-in
        // screen says so rather than this failing silently into a signed-out state that looks
        // like a forgotten PIN.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback((res: Awaited<ReturnType<typeof api.signIn>>): Staff => {
    const staff = { ...res.staff, hasPin: true, active: true } as Staff;
    setSession({ staff, method: res.staff.role === 'owner' ? 'password' : 'pin' });
    return staff;
  }, []);

  const signInWithPin = useCallback(
    async (pin: string) => adopt(await api.signIn({ merchant: merchantAddress(), pin })),
    [adopt],
  );

  const signInWithPassword = useCallback(
    async (email: string, password: string) =>
      adopt(await api.signIn({ merchant: merchantAddress(), email, password })),
    [adopt],
  );

  /**
   * An owner authorising one act without taking over the session.
   *
   * Step three of a refund. This does NOT go through sign-in and deliberately returns without
   * touching `session`: the writer stays signed in, because the owner is approving something
   * rather than starting a shift. The code is verified server-side as part of the refund call,
   * so nothing here holds it.
   */
  const authoriseWithOwnerCode = useCallback(async (code: string): Promise<Staff> => {
    const owner = await api.checkOwnerCode(code);
    // Deliberately does NOT call setSession: the writer stays signed in. The code is carried by
    // the caller into the decision itself, which re-verifies it server-side, so this confirms who
    // is standing there without granting them anything.
    return { ...owner, hasPin: true, active: true } as Staff;
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut().catch(() => storeToken(null));
    setSession(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      loading,
      role: session?.staff.role ?? null,
      canSeeMoney: session ? seesMoney(session.staff.role) : false,
      canAuthoriseRefunds: session ? canAuthoriseRefund(session.staff.role) : false,
      signInWithPin,
      signInWithPassword,
      authoriseWithOwnerCode,
      signOut,
    }),
    [session, loading, signInWithPin, signInWithPassword, authoriseWithOwnerCode, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
