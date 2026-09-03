import { Link } from 'react-router-dom';
import { CHARGE_LABEL, dollars } from '@clear/domain';
import { Columns, Panel } from '@/shell/AppShell';
import { useAuth } from '@/auth/authContext';
import { STUB_CHARGES, waitingCharges } from '@/data/stubs';

/**
 * Counter home.
 *
 * Three states in the reference — nothing waiting, something waiting, and something just
 * confirmed. Scaffolded here with the waiting list wired to the stubs so the layout has real rows;
 * the three states proper are Phase 4, section 1.
 *
 * Raising a charge is the only primary action, because it is what somebody standing at a counter
 * came here to do.
 */
export default function HomePage() {
  const { canSeeMoney } = useAuth();
  const waiting = waitingCharges();
  const recent = STUB_CHARGES.filter((c) => c.state !== 'waiting').slice(0, 4);

  return (
    <Columns
      action={
        <>
          <Panel>
            <Link
              to="/new"
              className="block rounded-[var(--clear-radius)] bg-[var(--clear-text-accent)] px-4 py-5 text-center text-[21px] font-medium text-[var(--clear-surface-2)]"
            >
              New charge
            </Link>
          </Panel>

          <Panel
            title={waiting.length ? `Waiting · ${waiting.length}` : 'Waiting'}
            footnote={
              waiting.length
                ? 'They approve on their phone. Nothing to do here until they do.'
                : undefined
            }
          >
            {waiting.length === 0 ? (
              <p className="rounded-[var(--clear-radius)] border border-[var(--clear-border)] bg-[var(--clear-surface-1)] p-4 text-[13px] text-[var(--clear-text-muted)]">
                Nothing waiting.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--clear-border)] rounded-[var(--clear-radius)] border border-[var(--clear-border)] bg-[var(--clear-surface-2)]">
                {waiting.map((c) => (
                  <li key={c.id} className="flex items-baseline gap-3 px-4 py-3">
                    <span className="text-[15px] font-medium">
                      {c.member?.displayName ?? 'Not yet opened'}
                    </span>
                    <span className="ml-auto text-[15px] tabular-nums">{dollars(c.amount)}</span>
                    <span className="w-[92px] text-right text-[11.5px] text-[var(--clear-text-muted)]">
                      {CHARGE_LABEL[c.state]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      }
      context={
        <Panel title="Today">
          <ul className="divide-y divide-[var(--clear-border)] rounded-[var(--clear-radius)] border border-[var(--clear-border)] bg-[var(--clear-surface-2)]">
            {recent.map((c) => (
              <li key={c.id} className="flex items-baseline gap-3 px-4 py-2.5">
                <span className="text-[13px]">{c.member?.displayName ?? '—'}</span>
                <span className="ml-auto text-[13px] tabular-nums">{dollars(c.amount)}</span>
                <span className="w-[76px] text-right text-[11.5px] text-[var(--clear-text-muted)]">
                  {CHARGE_LABEL[c.state]}
                </span>
              </li>
            ))}
          </ul>
          {/*
            Counter staff never see payout figures, bank details, the rate or monthly totals. The
            role decides, and the role comes from the shared domain so both apps answer it alike.
          */}
          {canSeeMoney && (
            <p className="mt-2 text-[11.5px] text-[var(--clear-text-muted)]">
              Financed charges only. Card and balance payments settle on their own rails and never
              appear here.
            </p>
          )}
        </Panel>
      }
    />
  );
}
