import ActivityPage from './ActivityPage';
import { ACTIVITY_DAY_ONE } from '@/data/clearPlaceholder';
import { useClearTransactions } from '@/hooks/useClearTransactions';
import { toActivityRow } from '@/lib/activityMapping';

/*
 * Day-one, not in-use.
 *
 * The `*_IN_USE` datasets are the DESIGN PREVIEW's populated fixtures -- a fully furnished account
 * used to show what the page looks like with money in it. Falling back to them in the real app
 * meant a member with nothing, or one whose fetch had not landed, was shown somebody else's
 * balances rendered as their own. That is not a placeholder, it is a fabrication.
 *
 * `*_DAY_ONE` is the honest base: zeros, empty lists, and products in their locked or
 * not-yet-activated state. Real figures are spread over it as they arrive, so a member who does
 * have money still never watches it flash to zero -- each field only overrides once it has been
 * read.
 */

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
    ? ACTIVITY_DAY_ONE
    : { ...ACTIVITY_DAY_ONE, rows: items.map(toActivityRow) };

  return <ActivityPage data={data} />;
}
