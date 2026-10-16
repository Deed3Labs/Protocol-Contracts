import { createContext, useContext } from 'react';

/**
 * Signing in (rewards spec, section 7; rewards DECISIONS, Phase 1 › No duplicate accounts).
 *
 * A phone and its code first. The code is checked with signups off, so a number that's on an account
 * signs straight in and one that isn't creates nothing: only then is "Already have Clear?" asked.
 * Yes signs in their usual way and adds the number to that account; No makes the account from the
 * same number.
 */
export type CodeResult = 'signed_in' | 'no_account';
export type Provider = 'email' | 'google' | 'apple';

export interface RewardsAuth {
  ready: boolean;
  signedIn: boolean;
  /** The number they're signing in with, as typed. */
  phone: string | null;
  sendCode(phone: string): Promise<void>;
  submitCode(code: string): Promise<CodeResult>;
  /** "No, I'm new": the account, from the number just confirmed. */
  createFromCode(): Promise<void>;
  /** Email, Google or Apple, the way they sign in to Clear. After "Yes", the number is added to that account. */
  signInWith(provider: Provider, opts?: { thenLinkPhone?: boolean }): Promise<void>;
  signOut(): Promise<void>;
  /** The sign-in methods the Clear app offers: Apple only once Clear does. */
  providers: Provider[];
}

export const AuthContext = createContext<RewardsAuth | null>(null);

export function useAuth(): RewardsAuth {
  const a = useContext(AuthContext);
  if (!a) throw new Error('useAuth needs an AuthProvider');
  return a;
}
