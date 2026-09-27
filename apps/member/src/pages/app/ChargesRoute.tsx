import ChargesPage from './ChargesPage';
import { useAppKitAccount } from '@/lib/walletCompat';
import { useChargeHistoryState } from '@/hooks/useChargeHistory';

/** Shop charges, read for the signed-in member (ChargesPage draws them). */
export default function ChargesRoute() {
  const { address } = useAppKitAccount();
  const { charges, loaded } = useChargeHistoryState(address);
  return <ChargesPage charges={charges} loading={!loaded && charges.length === 0} />;
}
