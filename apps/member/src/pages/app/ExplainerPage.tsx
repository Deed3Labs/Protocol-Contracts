import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import Card from '@/components/clear/Card';
import ReservePanel from '@/components/clear/ReservePanel';
import { ASSURANCE_RESERVE } from '@/data/clearPlaceholder';

const EXPLAINERS: Record<string, { title: string; body: ReactNode }> = {
  'assurance-reserve': {
    title: 'The assurance reserve',
    body: <ReservePanel reserve={ASSURANCE_RESERVE} />,
  },
};

/**
 * The explainers — design spec §10.
 *
 * Pages rather than modals, and one component rather than four: they're all the
 * same object — a mechanism this product needs a member to actually understand,
 * written out once and linked to from wherever it comes up.
 */
export default function ExplainerPage() {
  const { topic } = useParams();
  const explainer = topic ? EXPLAINERS[topic] : undefined;

  // Patronage moved into Settings. An old link lands on the page that replaced it, not on Home.
  if (topic === 'patronage') return <Navigate to="/settings/patronage-calculation" replace />;
  // So did disputes.
  if (topic === 'disputes') return <Navigate to="/settings/disputes" replace />;

  if (!explainer) return <Navigate to="/" replace />;

  return (
    <div className="lg:max-w-[560px]">
      <h1 className="mb-4 hidden text-xl font-medium lg:block">{explainer.title}</h1>
      <Card>{explainer.body}</Card>
    </div>
  );
}
