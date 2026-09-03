import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { canAuthoriseRefund, seesMoney } from '@clear/domain';
import { STUB_STAFF } from '@/data/stubs';
import { AuthContext, SESSION_KEY, type AuthValue, type Session } from '@/auth/authContext';

/**
 * The provider, alone in its file.
 *
 * Splitting it from the context and the `useAuth` hook is not tidiness: a module exporting both a
 * component and a plain function cannot Fast Refresh, so every edit to this file during Phase 4
 * would tear the whole app down to a blank screen and an "incompatible export" error.
 */

function readStoredSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    // Private windows and locked-down browsers throw on access rather than returning null.
    return null;
  }
}

function writeStoredSession(session: Session | null) {
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // A tablet that cannot persist a session still has to work for the length of a shift.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readStoredSession);

  // Stubbed against the domain types. No real API calls yet — Phase 3 is the shell.
  const signInWithPin = useCallback(async (pin: string) => {
    const staff = STUB_STAFF.find((s) => s.role === 'counter' && s.active && pin.length === 4);
    if (!staff) throw new Error('That PIN was not recognised.');
    const next: Session = { staff, method: 'pin' };
    setSession(next);
    writeStoredSession(next);
    return staff;
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const staff = STUB_STAFF.find((s) => s.role === 'owner' && s.active);
    if (!staff || !email || password.length < 8) throw new Error('That did not match.');
    const next: Session = { staff, method: 'password' };
    setSession(next);
    writeStoredSession(next);
    return staff;
  }, []);

  const authoriseWithOwnerCode = useCallback(async (code: string) => {
    const owner = STUB_STAFF.find((s) => s.role === 'owner' && s.active);
    if (!owner || code.length !== 4) throw new Error('That code was not recognised.');
    return owner; // Deliberately does not touch `session`.
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    writeStoredSession(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      role: session?.staff.role ?? null,
      canSeeMoney: session ? seesMoney(session.staff.role) : false,
      canAuthoriseRefunds: session ? canAuthoriseRefund(session.staff.role) : false,
      signInWithPin,
      signInWithPassword,
      authoriseWithOwnerCode,
      signOut,
    }),
    [session, signInWithPin, signInWithPassword, authoriseWithOwnerCode, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

