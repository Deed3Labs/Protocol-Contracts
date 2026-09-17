import ClaimPage from './ClaimPage';
import { useSavingsData } from '@/hooks/useSavingsData';
import { useAppKitAccount } from '@/lib/walletCompat';
import { fileAssuranceClaim } from '@/utils/apiClient';

/**
 * Live claim guide — the member's own credits decide what they can claim on, so this reads them the
 * same way Savings and Assurance do rather than keeping a third copy.
 *
 * Filing lives here rather than in the page: the page draws, the route knows who is signed in. A
 * claim with no wallet says so in words instead of failing at the end of the form.
 */
export default function ClaimRoute() {
  const { address } = useAppKitAccount();

  return (
    <ClaimPage
      data={useSavingsData()}
      onFile={async (input) => {
        if (!address) return 'Sign in first — nothing was sent.';
        const { error } = await fileAssuranceClaim(address, input);
        return error ?? null;
      }}
    />
  );
}
