import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { canAuthoriseRefund, seesMoney, type Staff } from '@clear/domain';
import { api, storeToken } from '@/data/apiClient';
import { AuthContext, type AuthValue, type DeviceState, type Session } from '@/auth/authContext';

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
 * Which shop this tablet belongs to — now answered by enrollment.
 *
 * A PIN only means anything against one merchant: sign-in is scoped, so two shops can both have a
 * 4821 and neither is wrong. This used to come from `VITE_MERCHANT_ADDRESS`, which was a build-time
 * value and therefore only ever correct for a single-shop build — every merchant would have needed
 * their own deployment of the same app.
 *
 * The tablet now learns it from the device token it was enrolled with. The server reads the shop
 * off that row, so it is not something the client asserts and not something a request body can
 * change. The cache below exists only for the charge signer, which needs the address synchronously
 * and outside React; it is filled from the server's answer on load, never from user input.
 */
let cachedMerchant = '';

export function merchantAddress(): string {
  return cachedMerchant || ((import.meta.env.VITE_MERCHANT_ADDRESS as string | undefined) ?? '');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [loading, setLoading] = useState(true);

  // Two questions on load, in order: what is this tablet, and who is on shift. The device answer
  // comes first because it decides which screen the app can even show — an unenrolled tablet has
  // no roster to sign in against.
  useEffect(() => {
    let cancelled = false;

    // Dev-only. Every screen behind the shell needs a session and an enrolled device, which means
    // none of them can be looked at without a database — so this stands one up in memory. The
    // pages still call the real client and still render their own empty states when it cannot
    // reach an API, which is the point: it fakes who is signed in, never the data.
    // `import.meta.env.DEV` is statically false in a production build, so this falls out entirely.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1') {
      cachedMerchant = '0x0000000000000000000000000000000000000000';
      setDevice({
        id: 'preview',
        label: 'Counter tablet',
        idleLockSeconds: 300,
        merchant: cachedMerchant,
      });
      setSession({
        staff: {
          id: 'preview-owner',
          name: 'Mike R.',
          role: 'owner',
          hasPin: true,
          active: true,
        } as Staff,
        method: 'pin',
      });
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const d = await api.currentDevice();
        if (cancelled) return;
        if (d) {
          cachedMerchant = d.merchant;
          setDevice({ ...d.device, merchant: d.merchant });
          const res = await api.currentSession();
          if (!cancelled && res) {
            setSession({
              staff: { ...res.staff, hasPin: true, active: true } as Staff,
              method: 'pin',
            });
          }
        }
      } catch {
        // A server that cannot be reached is a tablet that cannot take a charge. The sign-in
        // screen says so rather than this failing silently into a signed-out state that looks
        // like a forgotten PIN.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback((res: Awaited<ReturnType<typeof api.startShift>>): Staff => {
    const staff = { ...res.staff, hasPin: true, active: true } as Staff;
    setSession({ staff, method: 'pin' });
    return staff;
  }, []);

  const signInWithPin = useCallback(
    async (pin: string, staffId: string) =>
      adopt(await api.startShift({ staffId, pin })),
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
    // Deliberately does NOT clear the device token. Ending a shift must not un-enroll the tablet,
    // or every closing writer would need the owner back in the morning.
  }, []);

  /**
   * Enroll this tablet, from the owner's session.
   *
   * The device token is written by the client; what comes back here is the shop it is now bound
   * to. Setting the cached merchant from the server's answer rather than from anything typed is
   * the point — the tablet is told which shop it is, it does not decide.
   */
  const enrollDevice = useCallback(
    async (input: { label: string; idleLockSeconds?: number }) => {
      const d = await api.enrollDevice(input);
      const current = await api.currentDevice();
      if (!current) throw new Error('That tablet could not be set up.');
      cachedMerchant = current.merchant;
      setDevice({ ...d, merchant: current.merchant });
    },
    [],
  );

  const value = useMemo<AuthValue>(
    () => ({
      session,
      device,
      loading,
      role: session?.staff.role ?? null,
      canSeeMoney: session ? seesMoney(session.staff.role) : false,
      canAuthoriseRefunds: session ? canAuthoriseRefund(session.staff.role) : false,
      signInWithPin,
      authoriseWithOwnerCode,
      signOut,
      enrollDevice,
    }),
    [session, device, loading, signInWithPin, authoriseWithOwnerCode, signOut, enrollDevice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
