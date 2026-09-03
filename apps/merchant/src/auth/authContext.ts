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
 * **A PIN is attribution, not authentication.** Four digits on a shared counter tablet will be
 * watched and shared — it is not a security boundary. What it buys is knowing who raised a charge,
 * which is what makes the staff name on every charge row real. The boundary is the enrolled
 * device, granted by an owner and removable in one tap from anywhere.
 *
 * An owner's authority does not live here at all. It comes from signing in with Privy — an emailed
 * code, a passkey, an existing wallet — and Clear stores no owner credential of any kind.
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
  /**
   * How the shift started. Always a PIN — there is no password anywhere in this app. An owner's
   * AUTHORITY comes from signing in with Privy, which is a separate act from being on shift.
   */
  method: 'pin';
}

/** What this tablet is. Null when it has not been enrolled, or has been removed. */
export interface DeviceState {
  id: string;
  label: string;
  idleLockSeconds: number;
  merchant: string;
}

export interface AuthValue {
  session: Session | null;
  /**
   * The enrolled tablet — reference section 19.
   *
   * Null means not set up, which the app must tell apart from signed out: one shows the enrollment
   * screen, the other the PIN pad. It also goes null when an owner removes this tablet from
   * anywhere, on its very next request, which is what makes a lost tablet survivable.
   */
  device: DeviceState | null;
  /** True until the stored token has been exchanged for a session (or found to be dead). */
  loading: boolean;
  role: StaffRole | null;
  /** Payout figures, bank details, the rate, monthly totals. Counter staff see none of it. */
  canSeeMoney: boolean;
  canAuthoriseRefunds: boolean;
  /** A name was picked on the roster, then a PIN. Starts a SHIFT, not a login. */
  signInWithPin: (pin: string, staffId: string) => Promise<Staff>;
  /**
   * An owner authorising something on a counter device without taking over the session.
   *
   * Step 3 of a refund: the owner walks over and types their code on the tablet. The writer stays
   * signed in, because the owner is authorising one act rather than starting a shift.
   */
  authoriseWithOwnerCode: (code: string) => Promise<Staff>;
  signOut: () => void | Promise<void>;
  /** Enroll this tablet. Requires an owner session — a counter writer cannot reach it. */
  enrollDevice: (input: { label: string; idleLockSeconds?: number }) => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
