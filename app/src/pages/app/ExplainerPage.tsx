import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import Card, { CardRule } from '@/components/clear/Card';
import InfoBlock from '@/components/clear/InfoBlock';
import SettingRows from '@/components/clear/SettingRows';
import ReservePanel from '@/components/clear/ReservePanel';
import { ASSURANCE_RESERVE, SETTINGS } from '@/data/clearPlaceholder';
import { money } from '@/lib/money';
import { patronageBasis } from '@/lib/clearModel';

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

/** How patronage works — the explainer behind the Patronage settings page. */
function PatronageExplainer() {
  const rows = SETTINGS.patronage.basisRows;

  return (
    <>
      <p className="mb-3.5 text-xs leading-relaxed text-foreground-secondary">
        Patronage is your share of the co-op&rsquo;s surplus, based on how much you used it — not
        how much you saved.
      </p>

      <Card className="mb-4">
        <p className="mb-1 text-xs text-foreground-secondary">What counts as activity</p>
        <div className="text-xs leading-[2]">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3">
              <span className="text-foreground-secondary">{row.label}</span>
              <span className="tabular-nums">{money(row.amount, { cents: true })}</span>
            </div>
          ))}
        </div>
        <CardRule className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-foreground-secondary">Your patronage basis</span>
          <span className="font-medium tabular-nums">
            {money(patronageBasis(rows), { cents: true })}
          </span>
        </CardRule>
      </Card>

      <Steps
        steps={[
          'At year end the co-op totals its surplus after costs and reserves.',
          'Members vote on how much is distributed versus reinvested.',
          "The distributed portion is split in proportion to each member's patronage basis.",
          'Your share lands in your cash account.',
        ]}
      />

      <InfoBlock tone="neutral" className="mt-4 text-[11px]">
        Saving more doesn&rsquo;t increase your patronage — it increases your credit limit and your
        progress toward a home. Different mechanisms.
      </InfoBlock>
    </>
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
  patronage: { title: 'How patronage works', body: <PatronageExplainer /> },
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

  if (!explainer) return <Navigate to="/" replace />;

  return (
    <div className="lg:max-w-[560px]">
      <h1 className="mb-4 hidden text-xl font-medium lg:block">{explainer.title}</h1>
      <Card>{explainer.body}</Card>
    </div>
  );
}
