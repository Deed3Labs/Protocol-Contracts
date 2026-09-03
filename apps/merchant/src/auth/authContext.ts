import { createContext, useContext } from 'react';
import type { Staff, StaffRole } from '@clear/domain';

/**
 * Two roles, not a permission matrix.
 *
 * A shop has people who take money at a counter and people whose money it is. Anything finer is a
 * configuration screen nobody fills in and a writer who cannot tell what they are allowed to do.
 * `counter` and `owner` are the whole model, and the two questions worth asking about a role —
 * can they see money, can they authorise a refund — live in the domain so both apps answer them
 * the same way.
 *
 * Counter staff sign in with a PIN because they do it twenty times a shift on a shared tablet.
 * An owner gets a real password, because they reach money.
 *
 * **Session storage is host-only and unshared.** The merchant app and the member app have
 * different auth models and must never see each other's session: no cookie is scoped to
 * `.useclear.org`, and this key is namespaced to this app. On `merchants.useclear.org` a cookie
 * without a Domain attribute is host-only by definition, which is what we want and why none is set
 * here.
 */

export const SESSION_KEY = 'clear.merchant.session';

export interface Session {
  staff: Staff;
  /** How they got in. An owner who typed a PIN to authorise one refund is still not signed in. */
  method: 'pin' | 'password';
}

export interface AuthValue {
  session: Session | null;
  /** True until the stored token has been exchanged for a session (or found to be dead). */
  loading: boolean;
  role: StaffRole | null;
  /** Payout figures, bank details, the rate, monthly totals. Counter staff see none of it. */
  canSeeMoney: boolean;
  canAuthoriseRefunds: boolean;
  signInWithPin: (pin: string) => Promise<Staff>;
  signInWithPassword: (email: string, password: string) => Promise<Staff>;
  /**
   * An owner authorising something on a counter device without taking over the session.
   *
   * Step 3 of a refund: the owner walks over and types their code on the tablet. The writer stays
   * signed in, because the owner is authorising one act rather than starting a shift.
   */
  authoriseWithOwnerCode: (code: string) => Promise<Staff>;
  signOut: () => void | Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
