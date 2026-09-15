import { Bar, CFoot, CHead, CMain, Cell, HeadFig, Line, Panel, SecHead, Track } from './brand/anatomy';
import { money, count } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { savingsTotal, type Savings } from '@/lib/clearModel';

/**
 * Savings on Home — a cell on the slab, or a standalone panel on day one.
 *
 * Header: Savings and the total. Main: the bar in vest colours (cash ink, vested settled, vesting
 * underway) and its legend. Footer: the credits progress — the count, the date it implies, and the
 * track that produced both.
 *
 * Day one has no breakdown to give: an empty track, and the footer says what saving does instead.
 * Savings is an ESA and is never summed into available to spend.
 */
export default function SavingsSummaryCard({
  savings,
  emptyState,
}: {
  savings: Savings;
  /** Day one: empty track plus the pitch line, drawn as a panel. */
  emptyState?: boolean;
}) {
  const desktop = useIsDesktop();
  const total = savingsTotal(savings);
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  if (emptyState) {
    return (
      <Panel>
        <CHead>
          <SecHead label="Savings">
            <HeadFig value={money(0, { cents: true })} />
          </SecHead>
        </CHead>
        <CMain>
          <Track label="Nothing saved yet" />
        </CMain>
        <CFoot>
          <p className="c-det">Every $1 saved is matched $1 in credits and raises your limit by $1.</p>
        </CFoot>
      </Panel>
    );
  }

  return (
    <Cell>
      <CHead>
        <SecHead label="Savings">
          <HeadFig value={money(total, { cents: true })} />
        </SecHead>
      </CHead>
      <CMain>
        <Bar
          label="Savings by state: cash, vested, vesting"
          className="mb-s2"
          segments={[
            { label: 'Cash', pct: share(savings.cash), color: 'var(--vest-cash)' },
            { label: 'Vested', pct: share(savings.vested), color: 'var(--vest-vested)' },
            { label: 'Vesting', pct: share(savings.vesting), color: 'var(--vest-vesting)' },
          ]}
        />
        <div className="c-legend">
          <div>
            <span>Cash (CLRUSD)</span>
            <span>{money(savings.cash, { cents: true })}</span>
          </div>
          <div>
            <span className="c-t-sav">Vested</span>
            <span>{money(savings.vested)}</span>
          </div>
          <div>
            <span className="c-t-inc">Vesting</span>
            <span>{money(savings.vesting)}</span>
          </div>
        </div>
      </CMain>
      <CFoot>
        <Line className="mb-s1">
          <span className="c-sub">
            {count(savings.credits)} of {count(savings.creditsGoal)} credits
          </span>
          {savings.onTrackFor && (
            <span className="c-det">{desktop ? `On track for ${savings.onTrackFor}` : savings.onTrackFor}</span>
          )}
        </Line>
        <Track
          label={`${count(savings.credits)} of ${count(savings.creditsGoal)} credits`}
          pct={(savings.credits / Math.max(1, savings.creditsGoal)) * 100}
          color="var(--tier-savings)"
        />
      </CFoot>
    </Cell>
  );
}
