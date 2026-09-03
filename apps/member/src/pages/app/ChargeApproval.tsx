import { ChevronLeft, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SplitChooser from '@/components/clear/SplitChooser';
import { splitQuote } from '@/lib/clearModel';
import { money } from '@clear/domain';

/**
 * A charge arrives — the member side.
 *
 * Every transaction after the first, and also how somebody who signed up in a waiting room
 * receives their charge. The counter onboarding covers a first-timer; this covers the rest.
 *
 * **The split is chosen here, on the member's phone, and nowhere else.** A service writer must not
 * be picking somebody's repayment terms, which is why the merchant's request carries an amount and
 * a member and nothing about repayment — the merchant device has no control that could set it.
 *
 * Limit and Clears-from sit on this screen because it is the moment a member most wants to check
 * them, and they use the same footer as the Term plans shelf so it is one pattern rather than two.
 *
 * Presentational, like the onboarding flows. `ChargeApprovalRoute` fetches, approves and declines.
 */

function FooterCell({
  label,
  value,
  onSelect,
  className = '',
}: {
  label: string;
  value: string;
  onSelect?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!onSelect}
      className={`text-left ${className}`}
    >
      <p className="mb-0.5 text-[10px] uppercase tracking-[0.4px] text-muted-foreground">{label}</p>
      <p className="text-[11.5px]">
        {value}
        {onSelect && <span className="text-muted-foreground"> &rsaquo;</span>}
      </p>
    </button>
  );
}

export interface ChargeApprovalProps {
  merchantName: string;
  /** Whole units, not cents — `money` and `SplitChooser` both work in units. */
  amount: number;
  splitInto: number;
  onSplitChange: (splitInto: number) => void;
  splitOptions?: number[];
  ratePerCycle?: number;
  rate?: string;
  /** Null while unread — the cell says so rather than inventing a figure. */
  perCycleLimit?: number | null;
  clearsFromLabel?: string;
  firstPaymentOn?: string;
  doneBy: (splitInto: number) => string;
  busy?: boolean;
  error?: string | null;
  onApprove: () => void;
  onDecline: () => void;
  onBack?: () => void;
  /** Set once approved — the screen becomes the confirmation rather than navigating away. */
  approved?: boolean;
}

export default function ChargeApproval({
  merchantName,
  amount,
  splitInto,
  onSplitChange,
  splitOptions = [1, 2, 4, 12],
  ratePerCycle = 0.02,
  rate = '2% / cycle',
  perCycleLimit = null,
  clearsFromLabel = 'Balance only',
  firstPaymentOn,
  doneBy,
  busy = false,
  error = null,
  onApprove,
  onDecline,
  onBack,
  approved = false,
}: ChargeApprovalProps) {
  if (approved) {
    return (
      <div className="mx-auto w-full max-w-[360px] px-5 py-8">
        <div className="px-0 pb-1 pt-3.5 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-positive/15">
            <Check className="h-[22px] w-[22px] text-positive" strokeWidth={2.4} />
          </div>
          <p className="text-2xl font-medium">{money(amount, { cents: true })}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {merchantName} · {splitInto === 1 ? 'in full' : `split in ${splitInto}`}
          </p>
        </div>

        <div className="my-4 rounded-xl border-[0.5px] border-border px-3.5 py-3">
          <div className="flex items-baseline justify-between text-[12.5px]">
            <span className="text-foreground-secondary">First payment</span>
            <span className="tabular-nums">
              {/* The same figure the split chooser quoted a moment ago, from the same function.
                  Dividing the amount by the split would drop the carry and tell a member their
                  first payment is smaller than the one that will actually be taken — the last
                  number they read before agreeing, and the one they will budget against. */}
              {money(splitQuote(amount, splitInto, ratePerCycle).perCycle, { cents: true })}
              {firstPaymentOn ? ` on ${firstPaymentOn}` : ''}
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between text-[12.5px]">
            <span className="text-foreground-secondary">Clears from</span>
            <span>{clearsFromLabel}</span>
          </div>
        </div>

        {/* The one moment a member is most receptive to the point of the whole co-op: they have
            just agreed to pay carry, and the way not to is one sentence long. */}
        <div className="rounded-xl border-[0.5px] border-tier-savings/40 bg-tier-savings/10 px-3.5 py-3">
          <p className="mb-1 text-[11px] tracking-[0.2px] text-tier-savings-fg">
            MAKE THE NEXT ONE FREE
          </p>
          <p className="text-xs leading-relaxed">
            Save anything at all and you borrow against your own money instead — at no cost.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[360px] px-5 py-8">
      <div className="mb-3.5 flex items-center gap-2.5">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back" className="text-foreground-secondary">
            <ChevronLeft className="h-[17px] w-[17px]" />
          </button>
        )}
        <span className="text-[15px] font-medium">Approve a charge</span>
      </div>

      <p className="mb-0.5 text-xs text-foreground-secondary">{merchantName} wants to charge</p>
      <p className="mb-4 font-display text-[34px] font-medium leading-none tracking-[-0.5px]">
        {money(amount, { cents: true })}
      </p>

      <div className="mb-3 rounded-xl border-[0.5px] border-border px-3.5 py-3">
        <SplitChooser
          amount={amount}
          options={splitOptions}
          ratePerCycle={ratePerCycle}
          rate={rate}
          splitInto={splitInto}
          onChange={onSplitChange}
          doneBy={doneBy}
        />
      </div>

      <div className="mb-3.5 grid grid-cols-2 border-t-[0.5px] border-border pt-2.5">
        <FooterCell
          label="Limit"
          value={
            perCycleLimit == null ? 'Not set' : `${money(perCycleLimit, { cents: true })}/cycle`
          }
          className="pr-3.5"
        />
        <FooterCell
          label="Clears from"
          value={clearsFromLabel}
          className="border-l-[0.5px] border-border pl-3.5"
        />
      </div>

      {error && <p className="mb-2.5 text-[11px] leading-relaxed text-negative">{error}</p>}

      <Button size="sm" className="mb-[7px] w-full" onClick={onApprove} disabled={busy}>
        {busy ? 'One moment…' : 'Approve'}
      </Button>
      <Button variant="clear" size="sm" className="w-full" onClick={onDecline} disabled={busy}>
        Not now
      </Button>

      <p className="mt-2.5 text-center text-[11px] leading-relaxed text-muted-foreground">
        Expires in 24 hours. Nothing is charged until you approve.
      </p>
    </div>
  );
}
