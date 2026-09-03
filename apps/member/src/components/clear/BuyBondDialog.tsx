import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import DetailRows from './DetailRows';
import InfoBlock from './InfoBlock';
import { money } from '@/lib/money';
import { bondAddsToLimit, type BondTerm, type EarnData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** Maturity is the term from today, formatted the way the rest of the app writes dates. */
function maturityDate(months: number): { label: string; date: Date } {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return {
    label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    date,
  };
}

/**
 * Buy a bond — design spec §6.
 *
 * A bond locks money away, so the surface leads with what you pay and then
 * answers the two things that makes people hesitate: it still backs your credit
 * line at the bond LTV, so the money isn't really gone; and it matures before
 * you'd need it for a home.
 *
 * Everything below the term picker is derived from the chosen term — nothing
 * here is written down twice.
 */
export default function BuyBondDialog({
  data,
  open,
  onOpenChange,
  onBuy,
  busy = false,
  error = null,
}: {
  data: EarnData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * A purchase needs more than the term. The face value is chosen on this screen and the price is
   * derived from both, so passing the term alone would make the caller re-derive figures the
   * screen already has — and re-derived money is money that can disagree.
   */
  onBuy?: (purchase: { term: BondTerm; face: number; price: number; maturity: { label: string; date: Date } }) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [months, setMonths] = useState(24);
  const [face, setFace] = useState(5000);
  const term = data.terms.find((t) => t.months === months) ?? data.terms[0];

  // The ladder quotes per $1,000 of face value; a purchase is some multiple of it.
  // Without this the flow could only ever buy one unit, and the reference's own
  // figures ($4,325 → $5,000) are five of them.
  const units = face / term.face;
  const price = Math.round(term.price * units);
  const maturity = maturityDate(term.months);
  const addsToLimit = bondAddsToLimit(price, data.bondLtv);

  // Does it come free before the member would need the money for a home?
  const reserve = new Date(`${data.reserveDate} 1`);
  const maturesFirst = !Number.isNaN(reserve.getTime()) && maturity.date < reserve;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Buy a bond"
      description="Choose a term and review what the bond pays and what it locks up."
    >
      <p className="mb-2 text-xs text-foreground-secondary">Term</p>
      <div className="mb-4 flex gap-1.5">
        {data.terms.map((t) => (
          <Button
            key={t.months}
            variant="clear"
            size="xs"
            aria-pressed={t.months === months}
            onClick={() => setMonths(t.months)}
            className={cn('flex-1', t.months === months && 'border-tier-boost text-tier-boost-fg')}
          >
            {t.months} mo
          </Button>
        ))}
      </div>

      <p className="mb-2 text-xs text-foreground-secondary">Face value</p>
      <div className="mb-4 flex gap-1.5">
        {[1000, 2500, 5000].map((option) => (
          <Button
            key={option}
            variant="clear"
            size="xs"
            aria-pressed={option === face}
            onClick={() => setFace(option)}
            className={cn('flex-1', option === face && 'border-tier-boost text-tier-boost-fg')}
          >
            {money(option)}
          </Button>
        ))}
      </div>

      <p className="mb-1 text-xs text-foreground-secondary">You pay today</p>
      <p className="font-display mb-3.5 text-[36px] font-medium leading-none tracking-[-0.8px]">
        {money(price)}
      </p>

      <DetailRows
        className="mb-3"
        rows={[
          { label: 'You receive at maturity', value: money(face), strong: true },
          { label: 'Matures', value: maturity.label },
          { label: 'Yield', value: `${term.rate.toFixed(1)}% · fixed` },
          {
            label: 'Pay from',
            value: `${data.payFrom.label} · ${money(data.payFrom.balance)}`,
          },
        ]}
        footer={{ label: 'Adds to your credit limit', value: `+${money(addsToLimit)}` }}
      />

      <InfoBlock className="mb-3.5">
        Locked until maturity — but it backs your credit line at{' '}
        {Math.round(data.bondLtv * 100)}%, so you can borrow against it any time for 0.65% per
        cycle.
      </InfoBlock>

      {data.reserveDate && (
        <InfoBlock tone="neutral" className="mb-3.5 text-[11px]">
          Your estimated reserve date is <strong>{data.reserveDate}</strong>. This bond matures{' '}
          {maturesFirst ? 'before' : 'after'} then.
        </InfoBlock>
      )}

      {error && <p className="mb-2 text-[11px] leading-relaxed text-negative">{error}</p>}

      <Button
        size="xs"
        className="w-full"
        disabled={busy}
        onClick={() => onBuy?.({ term, face, price, maturity })}
      >
        {busy ? 'One moment…' : 'Buy this bond'}
      </Button>
    </Modal>
  );
}
