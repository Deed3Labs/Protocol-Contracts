import { money } from '@clear/domain';
import {
  COMMUNITY_FEE_LINES,
  COMMUNITY_FEE_TERMS,
  COMMUNITY_FEE_WITH_PAYMENT,
  communityFeeTotal,
  shortAddress,
  shortDay,
  type CommunityFeeStatement,
  type ElpaRedeemed,
  type ElpaState,
} from '@/lib/elpa';
import { NO_HOUSING, type Housing } from '@/lib/housing';
import ConnectedHousingAllowance from './ConnectedHousingAllowance';

const $ = (n: number) => money(n, { cents: true });

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
          {elpa.redeemedOn && (
            <div>
              <span>Redeemed</span>
              <span>{new Date(`${elpa.redeemedOn}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
            </div>
          )}
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
 * Your home — once a member has signed an ELPA. Nothing at all before.
 *
 * Its own slab on Savings, never on the credit view or the term-plan shelf: the ELPA is not credit,
 * a plan or a mortgage. Two blocks, side by side from tablet up: the Housing Allowance (or, once
 * redeemed, the Clear Deed) and the Community Fee bill.
 *
 * The Housing Allowance is read from the chain (`housing`); the Community Fee, the month's
 * contribution and the projection come from Clear's books (`elpa`) when it has them.
 */
export default function YourHome({ elpa, housing = NO_HOUSING, onChanged = () => {} }: { elpa: ElpaState; housing?: Housing; onChanged?: () => void }) {
  const home = housing.home;
  const chainRedeemed: ElpaRedeemed | null =
    home && home.status === 'redeemed' && elpa.status !== 'redeemed'
      ? { status: 'redeemed', home: home.name, redeemedOn: '', deed: { tokenId: home.homeId, smartAccount: housing.member }, communityFee: null }
      : null;
  const redeemed = elpa.status === 'redeemed' ? elpa : chainRedeemed;
  const live = !redeemed && home && home.status === 'signed' ? home : null;
  if (!live && !redeemed && elpa.status === 'none') return null;
  const fee = elpa.status === 'none' ? undefined : elpa.communityFee;
  const active = elpa.status === 'active' ? elpa : null;
  return (
    // minWidth 0: the page's grid would otherwise size its column to this slab's widest line.
    <div className="c-sv-slab" role="region" aria-label="Your home" style={{ minWidth: 0 }}>
      {redeemed ? (
        <RedeemedBlock elpa={redeemed} />
      ) : live ? (
        <ConnectedHousingAllowance home={live} housing={housing} elpa={active} onChanged={onChanged} />
      ) : null}
      {fee && <CommunityFeeBlock fee={fee} beforeRedemption={!redeemed} />}
    </div>
  );
}
