import ActivityPage from './ActivityPage';
import { ACTIVITY_IN_USE } from '@/data/clearPlaceholder';
import { useClearTransactions } from '@/hooks/useClearTransactions';
import { toActivityRow } from '@/lib/activityMapping';

/**
 * Live Activity — the member's real transactions.
 *
 * The rows are real as soon as there are any. The side rail is not: cycle spend, category
 * breakdown and the inside-the-co-op figure are cycle-level views that need the credit route
 * before they mean anything, so they stay on placeholder.
 *
 * An empty list after loading is left empty rather than filled with placeholder rows. Activity is
 * the one page where nothing to show is a true and useful answer -- a new member has no history,
 * and inventing some would be the page lying about their account rather than merely decorating it.
 * That is the opposite of the call made on Savings, where a zero balance mid-fetch would have
 * been the lie.
 */
export default function ActivityRoute() {
  const { items, loading } = useClearTransactions();

  const data = loading
    ? ACTIVITY_IN_USE
    : { ...ACTIVITY_IN_USE, rows: items.map(toActivityRow) };

  return <ActivityPage data={data} />;
}
