import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import Card from '@/components/clear/Card';
import SettingRows from '@/components/clear/SettingRows';
import ReservePanel from '@/components/clear/ReservePanel';
import { ASSURANCE_RESERVE } from '@/data/clearPlaceholder';

/**
 * Numbered steps — the shape every explainer on this app uses.
 *
 * A mechanism people have to trust is easier to trust as a sequence than as a
 * paragraph: it makes the order visible, and it makes an omission obvious.
 */
function Steps({ steps }: { steps: string[] }) {
  return (
    <div className="text-xs leading-relaxed">
      {steps.map((step, i) => (
        <p key={step} className="mb-2 text-foreground-secondary last:mb-0">
          <span className="mr-1.5 text-foreground">{i + 1}.</span>
          {step}
        </p>
      ))}
    </div>
  );
}

/** Dispute resolution — reached from Help. */
function DisputesExplainer() {
  return (
    <>
      <p className="mb-3.5 text-xs leading-relaxed text-foreground-secondary">
        Disputes between members are handled by an independent third party, administered by The Deed
        &amp; Title Co.
      </p>

      <Steps
        steps={[
          'Raise it directly with the other member first, in the app.',
          "If that doesn't resolve it, open a case. Both sides submit their account.",
          "A neutral third party reviews and decides. The co-op administers but doesn't judge.",
          'The decision is recorded and binding under the membership agreement.',
        ]}
      />

      <SettingRows
        className="mt-4 border-t-[0.5px] border-border pt-1"
        rows={[
          { label: 'Open a case' },
          { label: 'Your cases', value: 'None' },
          { label: 'Read the dispute policy' },
        ]}
      />
    </>
  );
}

const EXPLAINERS: Record<string, { title: string; body: ReactNode }> = {
  'assurance-reserve': {
    title: 'The assurance reserve',
    body: <ReservePanel reserve={ASSURANCE_RESERVE} />,
  },
  disputes: { title: 'Dispute resolution', body: <DisputesExplainer /> },
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

  if (!explainer) return <Navigate to="/" replace />;

  return (
    <div className="lg:max-w-[560px]">
      <h1 className="mb-4 hidden text-xl font-medium lg:block">{explainer.title}</h1>
      <Card>{explainer.body}</Card>
    </div>
  );
}
