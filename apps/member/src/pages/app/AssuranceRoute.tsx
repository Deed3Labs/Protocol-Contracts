import AssurancePage from './AssurancePage';
import { useSavingsData } from '@/hooks/useSavingsData';

/**
 * Live Assurance — the same credits the Savings cell counts, seen from the other side.
 *
 * The route rendered `<AssurancePage />` with no data, so the pane fell back to the day-one fixture
 * and judged every protection against zero credits. A member with 1,500 of them read "2 of 4
 * active" on Savings, opened See all, and was told the second protection was still 1,000 credits
 * away. One flow, two answers, because the pane never asked who was looking at it.
 */
export default function AssuranceRoute() {
  return <AssurancePage data={useSavingsData()} />;
}
