import { useMemo, useState, type ReactNode } from 'react';
import { mockData, type Who } from '../data/mock';
import { DataContext } from '../data/context';
import { AuthContext, type RewardsAuth } from './auth';

/**
 * The preview (dev only, `?preview=1`): the seeded shops and people, and sign-in steps that behave as
 * Privy's do. `as=sofia|marco|new|out`. A number ending 0142 is Sofia's account; any other number
 * is on no account, so "Already have Clear?" is asked.
 */
export function PreviewApp({ as, children }: { as: Who | 'out'; children: ReactNode }) {
  const [who, setWho] = useState<Who | 'out'>(as);
  const [phone, setPhone] = useState<string | null>(null);
  const after = new URLSearchParams(window.location.search).get('after') === 'table6' ? ('table6' as const) : undefined;
  const data = useMemo(() => mockData(who === 'out' ? 'new' : who, { after }), [who, after]);
  const auth: RewardsAuth = {
    ready: true,
    signedIn: who !== 'out',
    phone,
    providers: ['email', 'google', 'apple'],
    async sendCode(p) {
      setPhone(p);
    },
    async submitCode() {
      if (phone?.replace(/\D/g, '').endsWith('0142')) {
        setWho('sofia');
        return 'signed_in';
      }
      return 'no_account';
    },
    async createFromCode() {
      setWho('new');
    },
    async signInWith() {
      setWho('sofia');
    },
    async signOut() {
      setWho('out');
    },
  };
  return (
    <AuthContext.Provider value={auth}>
      <DataContext.Provider value={data}>{children}</DataContext.Provider>
    </AuthContext.Provider>
  );
}
