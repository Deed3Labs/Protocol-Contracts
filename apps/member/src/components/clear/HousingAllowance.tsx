import { useEffect, useState } from 'react';
import { count, money } from '@clear/domain';
import { Btn } from './brand/anatomy';
import Modal from './Modal';
import { cn } from '@/lib/utils';
import { CHECK_IN_NOTE, minimumContribution, monthName, MIN_CONTRIBUTION_RATE, showsCheckIn, type ElpaActive } from '@/lib/elpa';
import { creditRoom, priceShares, redeemableNow, type Housing, type HousingHome } from '@/lib/housing';

const $ = (n: number) => money(n, { cents: true });
const pct = `${(MIN_CONTRIBUTION_RATE * 100).toFixed(2)}%`;
const CREDITS_COLOR = 'var(--settled)';
const MONEY_COLOR = 'var(--ink)';

function Swatch({ color }: { color: string }) {
  return <i aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, background: color, marginRight: 8, flexShrink: 0 }} />;
}

/**
 * Your Housing Allowance — the equity toward the home, on chain. One total against the price, in two
 * parts always shown apart: from credits (never cash) and your money. Two actions: Redeem credits and
 * Add savings or USDC. Once the total reaches the price, the block says so and offers the Clear Deed.
 *
 * Equity, never a debt: no due date, no late state. The month's contribution and the minimum come
 * from Clear's books (the ELPA) when they are known.
 */
export function HousingAllowanceBlock({
  home,
  housing,
  elpa,
  onRedeemCredits,
  onAdd,
  onRedeemHome,
  busy,
  error,
}: {
  home: HousingHome;
  housing: Housing;
  elpa?: ElpaActive | null;
  onRedeemCredits: () => void;
  onAdd: () => void;
  onRedeemHome: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const shares = priceShares(home);
  const over = Math.max(0, home.total - home.structurePrice);
  const reached = home.redeemable || (home.live && home.total >= home.structurePrice);
  const room = creditRoom(housing);
  const canRedeemCredits = redeemableNow(housing) > 0;

  return (
    // One column that may shrink: the header's label and caption ellipsize rather than widen the block.
    <section className="c-sv-blk" aria-label="Your Housing Allowance" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <div className="c-sv-bh">
        <span className="c-label">Housing Allowance &middot; {home.name}</span>
        {/* On a phone the note below says it, and the home's name keeps the header. */}
        {reached && <span className="c-sv-cap c-ok hidden md:inline">Reached the price</span>}
      </div>
      <div className="c-sv-bm">
        <p className="c-sv-count">
          <span className="c-fig">{$(home.total)}</span>
          <span className="c-sv-cap">of {$(home.structurePrice)}</span>
        </p>
        <span
          className="c-sv-comp"
          role="img"
          aria-label={`${Math.round(shares.credits + shares.money)}% of the price: ${$(home.creditPortion)} from credits, ${$(home.memberPortion)} your money`}
          style={{ height: 8 }}
        >
          <i style={{ flexBasis: `${shares.credits}%`, background: CREDITS_COLOR }} />
          <i style={{ flexBasis: `${shares.money}%`, background: MONEY_COLOR }} />
        </span>
        <div className="c-sv-rows">
          <div>
            <span className="c-fg" style={{ display: 'flex', alignItems: 'center' }}>
              <Swatch color={CREDITS_COLOR} />
              From credits
            </span>
            <span className="c-fg">{$(home.creditPortion)}</span>
          </div>
          <div>
            <span className="c-fg" style={{ display: 'flex', alignItems: 'center' }}>
              <Swatch color={MONEY_COLOR} />
              Your money
            </span>
            <span className="c-fg">{$(home.memberPortion)}</span>
          </div>
          <div>
            <span>Price &middot; cost plus 15%</span>
            <span>{$(home.structurePrice)}</span>
          </div>
          {reached ? (
            over > 0 && (
              <div>
                <span>Over the price, back to you</span>
                <span>{$(over)}</span>
              </div>
            )
          ) : (
            <>
              <div>
                <span>To go</span>
                <span>{$(Math.max(0, home.structurePrice - home.total))}</span>
              </div>
              {elpa?.projectedRedemption && (
                <div>
                  <span>On track to redeem</span>
                  <span>{monthName(elpa.projectedRedemption)}</span>
                </div>
              )}
              {elpa && (
                <div>
                  <span>Your equity contribution this month</span>
                  <span>{elpa.contributionThisMonth === null ? 'Not chosen yet' : $(elpa.contributionThisMonth)}</span>
                </div>
              )}
              <div>
                <span>Monthly minimum, {pct} of the price</span>
                <span>{$(minimumContribution(home.structurePrice))}</span>
              </div>
            </>
          )}
          {home.refundDue > 0 && (
            <div>
              <span>Coming back to you</span>
              <span>{$(home.refundDue)}</span>
            </div>
          )}
        </div>
        {reached ? (
          <div className="c-sv-next c-ok">
            <span style={{ flex: '1 1 auto', minWidth: 0 }}>Your Housing Allowance covers the price. Redeem, and the Clear Deed moves to your own account.</span>
          </div>
        ) : (
          <div className="c-sv-next">
            <span>Credits limit</span>
            <span className="c-sv-cap">
              <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{money(room, { cents: false })}</b> left of {money(housing.creditPortionCap, { cents: false })}
            </span>
          </div>
        )}
        {!reached && elpa && showsCheckIn(elpa) && <p className="c-sv-note">{CHECK_IN_NOTE}</p>}
        {error && <p className="c-sv-note c-errline">{error}</p>}
      </div>
      {reached ? (
        <div className="c-sv-bf" style={{ display: 'grid', gap: 8 }}>
          <Btn primary lg style={{ width: '100%' }} disabled={busy || !home.redeemable} onClick={onRedeemHome}>
            {busy ? 'Waiting for your confirmation…' : 'Redeem your Clear Deed'}
          </Btn>
          <span style={{ textAlign: 'center' }}>
            {home.redeemable
              ? over > 0
                ? `The ${$(over)} over the price is refunded to you`
                : 'The deed moves to your own account'
              : 'Clear is putting the deed in place for you to redeem'}
          </span>
        </div>
      ) : (
        <div className="c-sv-bf">
          <div className="c-pair" style={{ width: '100%' }}>
            <Btn disabled={!canRedeemCredits} onClick={onRedeemCredits} title={canRedeemCredits ? undefined : 'No credits to redeem right now'}>
              Redeem credits
            </Btn>
            <Btn primary disabled={!home.payable} onClick={onAdd} title={home.payable ? undefined : 'Payments toward this home aren’t set up yet'}>
              Add savings or USDC
            </Btn>
          </div>
        </div>
      )}
      <div className="c-sv-bf">
        {/* The footer keeps its last child from shrinking; this one is the only child and must wrap. */}
        <span style={{ flex: '1 1 auto', minWidth: 0 }}>Equity, never a debt. Recorded on chain against your account. It stays in the home while you live there.</span>
      </div>
    </section>
  );
}

/** Redeem credits into the Housing Allowance, at $1 a credit, up to what's held and the limit left. */
export function RedeemCreditsDialog({
  open,
  onOpenChange,
  home,
  housing,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  home: HousingHome;
  housing: Housing;
  busy?: boolean;
  error?: string | null;
  onConfirm: (credits: number) => void;
}) {
  const max = redeemableNow(housing);
  const [credits, setCredits] = useState(0);
  useEffect(() => {
    if (open) setCredits(Math.min(500, max));
  }, [open, max]);
  const n = Math.max(0, Math.min(max, Math.floor(credits)));
  const footer = (
    <>
      <div className="c-conseq">
        <div className="c-earn">
          <span>Adds from credits</span>
          <span>+{$(n)}</span>
        </div>
        <div>
          <span>Credits to redeem now</span>
          <span>{count(housing.creditsToRedeem)}</span>
        </div>
        <div>
          <span>Credits after this</span>
          <span>{count(Math.max(0, housing.creditsToRedeem - n))}</span>
        </div>
        <div>
          <span>Credits limit left, after this</span>
          <span>{$(Math.max(0, creditRoom(housing) - n))}</span>
        </div>
        <div className="c-limit c-down">
          <span>Housing Allowance after this</span>
          <span>{$(home.total + n)}</span>
        </div>
      </div>
      <div className="c-footnote">
        <p>Redeemed credits can’t come back out, and they’re never paid in cash. They still count toward your 15,000.</p>
      </div>
      {error && <p className="c-det c-errline mt-s2">{error}</p>}
      <Btn primary lg className="mt-s2" disabled={busy || n <= 0} onClick={() => onConfirm(n)}>
        {busy ? 'Waiting for your confirmation…' : `Redeem ${count(n)} credits`}
      </Btn>
    </>
  );
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Redeem credits" description={`Into your Housing Allowance on ${home.name}, at $1 a credit.`} footer={footer}>
      <p className="c-label">Credits</p>
      <div className="c-qc" style={{ alignItems: 'center' }}>
        <input
          value={credits ? String(credits) : ''}
          onChange={(e) => setCredits(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
          inputMode="numeric"
          aria-label="Credits to redeem"
          placeholder="0"
          className="c-field"
        />
        <Btn className="c-chip-q" style={{ flex: '0 0 auto', padding: '0 12px' }} onClick={() => setCredits(max)} disabled={max <= 0}>
          All {count(max)}
        </Btn>
      </div>
      {credits > max && <p className="c-det mt-s1">You can redeem up to {count(max)} now.</p>}
    </Modal>
  );
}

export type HomeSource = 'savings' | 'cash';

/** Add savings (CLRUSD) or cash (USDC) to the Housing Allowance: straight to the home, as your money. */
export function AddToHomeDialog({
  open,
  onOpenChange,
  home,
  savings,
  cash,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  home: HousingHome;
  savings: number;
  cash: number;
  busy?: boolean;
  error?: string | null;
  onConfirm: (source: HomeSource, usd: number) => void;
}) {
  const [source, setSource] = useState<HomeSource>('savings');
  const [usd, setUsd] = useState(0);
  useEffect(() => {
    if (open) setUsd(0);
  }, [open]);
  const available = source === 'savings' ? savings : cash;
  const amount = Math.round(usd * 100) / 100;
  const tooMuch = amount > available + 0.005;
  const footer = (
    <>
      <div className="c-conseq">
        <div>
          <span>Goes to</span>
          <span>{home.name}</span>
        </div>
        <div>
          <span>{source === 'savings' ? 'Savings after this' : 'Cash after this'}</span>
          <span>{$(Math.max(0, available - amount))}</span>
        </div>
        <div className="c-limit c-down">
          <span>Housing Allowance after this</span>
          <span>{$(home.total + amount)}</span>
        </div>
      </div>
      <div className="c-footnote">
        <p>
          This stops being {source === 'savings' ? 'savings' : 'cash'}: it can’t be withdrawn, it earns nothing, and it stays in the home. If you leave
          before you redeem, your money comes back to you, less any itemized deductions.
        </p>
      </div>
      {error && <p className="c-det c-errline mt-s2">{error}</p>}
      <Btn primary lg className="mt-s2" disabled={busy || amount <= 0 || tooMuch} onClick={() => onConfirm(source, amount)}>
        {busy ? 'Waiting for your confirmation…' : `Add ${$(amount)} from ${source === 'savings' ? 'savings' : 'cash'}`}
      </Btn>
    </>
  );
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add to your Housing Allowance" description={`Your money toward ${home.name}.`} footer={footer}>
      <p className="c-label">From</p>
      <div className="c-qc c-split c-even" role="radiogroup" aria-label="From">
        {(
          [
            ['savings', 'Savings', savings],
            ['cash', 'Cash', cash],
          ] as const
        ).map(([id, label, bal]) => (
          <Btn key={id} role="radio" aria-checked={source === id} onClick={() => setSource(id)} className={cn('c-chip-q', source === id && 'c-on')}>
            {label} &middot; {$(bal)}
          </Btn>
        ))}
      </div>
      <p className="c-label mt-s3">Amount</p>
      <input
        value={usd ? String(usd) : ''}
        onChange={(e) => setUsd(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
        inputMode="decimal"
        aria-label="Amount in dollars"
        placeholder="$0.00"
        className="c-field mt-s1 w-full"
      />
      {tooMuch && <p className="c-det c-errline mt-s1">That’s more than your {source === 'savings' ? 'savings' : 'cash'}.</p>}
    </Modal>
  );
}
