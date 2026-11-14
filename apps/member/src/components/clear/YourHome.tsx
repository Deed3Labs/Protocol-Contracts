import { money } from '@clear/domain';
import {
  CHECK_IN_NOTE,
  COMMUNITY_FEE_LINES,
  COMMUNITY_FEE_TERMS,
  COMMUNITY_FEE_WITH_PAYMENT,
  MIN_CONTRIBUTION_RATE,
  communityFeeTotal,
  minimumContribution,
  monthName,
  redemptionProgress,
  shortAddress,
  shortDay,
  showsCheckIn,
  type CommunityFeeStatement,
  type ElpaActive,
  type ElpaRedeemed,
  type ElpaState,
} from '@/lib/elpa';

const $ = (n: number) => money(n, { cents: true });
const pct = `${(MIN_CONTRIBUTION_RATE * 100).toFixed(2)}%`;

/**
 * The Equity Contribution, as progress toward Redemption.
 *
 * Equity, never a debt (MB-13 §6.3): so this block has no due date, no late or past-due state and no
 * reminder. It shows what the member holds, what the home is priced at, and when Redemption lands at
 * their pace. The minimum is stated as a fact about the agreement, not as something owed.
 */
function EquityBlock({ elpa }: { elpa: ElpaActive }) {
  const progress = redemptionProgress(elpa);
  const minimum = minimumContribution(elpa.structurePrice);

  return (
    <section className="c-sv-blk" aria-label="Equity">
      <div className="c-sv-bh">
        <span className="c-label">Equity &middot; {elpa.home}</span>
        <span className="c-fig">{$(elpa.equityBalance)}</span>
      </div>
      <div className="c-sv-bm">
        <span
          className="c-sv-comp"
          role="img"
          aria-label={`${Math.round(progress * 100)}% of the way to Redemption`}
        >
          <i style={{ flexBasis: `${progress * 100}%`, background: 'var(--settled)' }} />
        </span>
        <div className="c-sv-rows">
          <div>
            <span className="c-fg">Equity Balance</span>
            <span className="c-fg">{$(elpa.equityBalance)}</span>
          </div>
          <div>
            <span>Structure Price</span>
            <span>{$(elpa.structurePrice)}</span>
          </div>
          <div>
            <span>Projected Redemption</span>
            <span>{elpa.projectedRedemption ? monthName(elpa.projectedRedemption) : 'No projection yet'}</span>
          </div>
          <div>
            <span>Your contribution this month</span>
            <span>{elpa.contributionThisMonth === null ? 'Not chosen yet' : $(elpa.contributionThisMonth)}</span>
          </div>
          <div>
            <span>Monthly minimum ({pct} of the Structure Price)</span>
            <span>{$(minimum)}</span>
          </div>
        </div>
        {showsCheckIn(elpa) && <p className="c-sv-note">{CHECK_IN_NOTE}</p>}
      </div>
      <div className="c-sv-bf">
        <span>Equity, never a debt. You choose the amount each month.</span>
      </div>
    </section>
  );
}

/** After Redemption: the Clear Deed, on chain in the member's Smart Account. */
function RedeemedBlock({ elpa }: { elpa: ElpaRedeemed }) {
  return (
    <section className="c-sv-blk" aria-label="Your Clear Deed">
      <div className="c-sv-bh">
        <span className="c-label">Your home &middot; {elpa.home}</span>
        <span className="c-sv-cap c-ok">Redeemed</span>
      </div>
      <div className="c-sv-bm">
        <div className="c-sv-rows">
          <div>
            <span className="c-fg">Clear Deed</span>
            <span className="c-fg">Deed #{elpa.deed.tokenId}</span>
          </div>
          <div>
            <span>Held in</span>
            <span>Your Smart Account &middot; {shortAddress(elpa.deed.smartAccount)}</span>
          </div>
          <div>
            <span>Redeemed</span>
            <span>{new Date(`${elpa.redeemedOn}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>
      </div>
      <div className="c-sv-bf">
        <span>The Clear Deed is yours, in your own Smart Account.</span>
      </div>
    </section>
  );
}

/**
 * The Community Fee: an ordinary housing bill (MB-14 Article 5), due on the 1st, broken into its
 * four parts. Separate from the equity beside it and from credit everywhere.
 */
function CommunityFeeBlock({ fee, beforeRedemption }: { fee: CommunityFeeStatement; beforeRedemption: boolean }) {
  return (
    <section className="c-sv-blk" aria-label="Community Fee">
      <div className="c-sv-bh">
        <span className="c-label">Community Fee &middot; {fee.period}</span>
        <span className="c-fig">{$(communityFeeTotal(fee))}</span>
      </div>
      <div className="c-sv-bm">
        <div className="c-sv-rows">
          {COMMUNITY_FEE_LINES.map(({ kind, label }) => {
            const line = fee.lines.find((l) => l.kind === kind);
            return line ? (
              <div key={kind}>
                <span>{label}</span>
                <span>{$(line.amount)}</span>
              </div>
            ) : null;
          })}
          {(fee.interest ?? 0) > 0 && (
            <div>
              <span>Interest after 60 days</span>
              <span>{$(fee.interest!)}</span>
            </div>
          )}
          <div>
            <span className="c-fg">Due</span>
            <span className={fee.paid ? 'c-ok' : 'c-fg'}>{fee.paid ? `${shortDay(fee.dueOn)} · Paid` : shortDay(fee.dueOn)}</span>
          </div>
        </div>
        <p className="c-sv-note">{COMMUNITY_FEE_TERMS}</p>
      </div>
      {beforeRedemption && (
        <div className="c-sv-bf">
          <span>{COMMUNITY_FEE_WITH_PAYMENT}</span>
        </div>
      )}
    </section>
  );
}

/**
 * Your home — the ELPA, when a member has one. Nothing at all when they do not.
 *
 * Its own slab on Savings, never on the credit view or the term-plan shelf: the ELPA is not credit,
 * a plan or a mortgage. Two blocks, side by side from tablet up: the equity (or, once redeemed, the
 * deed) and the Community Fee bill.
 */
export default function YourHome({ elpa }: { elpa: ElpaState }) {
  if (elpa.status === 'none') return null;
  return (
    <div className="c-sv-slab" role="region" aria-label="Your home">
      {elpa.status === 'active' ? <EquityBlock elpa={elpa} /> : <RedeemedBlock elpa={elpa} />}
      {elpa.communityFee && <CommunityFeeBlock fee={elpa.communityFee} beforeRedemption={elpa.status === 'active'} />}
    </div>
  );
}
