import SavingsPage from './SavingsPage';
import PendingFigures from '@/components/clear/PendingFigures';
import { useSavingsData } from '@/hooks/useSavingsData';

/**
 * Live Savings — the balance and the equity credits behind it.
 *
 * The reading moved to `useSavingsData` when Assurance turned out to need the same figures: which
 * protections are on is decided by the member's credits, and a pane fetching its own copy is a
 * second place for them to disagree. The projection, the milestones and the vesting schedule are
 * still placeholder, and each falls back rather than blanking — a member with a real balance and an
 * empty page has been told something false about their savings.
 */
export default function SavingsRoute() {
  const { pending, ...data } = useSavingsData();
  return (
    <PendingFigures pending={pending}>
      <SavingsPage data={data} />
    </PendingFigures>
  );
}
