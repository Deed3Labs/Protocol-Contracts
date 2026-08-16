import { useEffect, useState } from 'react';
import HomePage from './HomePage';
import { HOME_IN_USE } from '@/data/clearPlaceholder';
import { getLithicAccount, type LithicAccountResponse } from '@/utils/apiClient';

/**
 * Live Home — for now, only the deposit numbers behind "Account details".
 *
 * Everything else on this page is still placeholder, which is the rebuild's standing merge blocker.
 * The routing and account numbers are the exception because they're real the moment a member is
 * provisioned with Lithic, and showing placeholder bank details next to a real one would be worse
 * than showing none.
 *
 * The numbers are fetched, never cached to disk: they're bank details, and the server reads them
 * from Lithic on demand for the same reason.
 */
export default function HomeRoute() {
  const [lithic, setLithic] = useState<LithicAccountResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLithicAccount().then((result) => {
      if (!cancelled) setLithic(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const deposit = lithic?.deposit ?? null;
  const data = deposit
    ? {
        ...HOME_IN_USE,
        cashAccount: {
          ...HOME_IN_USE.cashAccount,
          accountNumber: deposit.accountNumber,
          routingNumber: deposit.routingNumber,
        },
      }
    : HOME_IN_USE;

  return <HomePage data={data} />;
}
