import { useEffect, useState } from 'react';
import { Snowflake, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ClearCardFace from '@/components/clear/ClearCardFace';
import CardControlsCard from '@/components/clear/CardControlsCard';
import CardDetailsDialog from '@/components/clear/CardDetailsDialog';
import TransactionRows from '@/components/clear/TransactionRows';
import TransactionDetailDialog from '@/components/clear/TransactionDetailDialog';
import { CARD_DAY_ONE } from '@/data/clearPlaceholder';
import { money } from '@/lib/money';
import type { ActivityRow, CardData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Card — design spec §9.
 *
 * The transactions here are card-only, which is what separates this page from
 * Activity: Activity shows everything that moved, this shows what the card did.
 *
 * Freeze holds UI state only. Nothing is issued yet, so there is no issuer call
 * to make — when card issuing goes live this is the seam that needs wiring, and
 * the control should go into a pending state until the issuer confirms.
 */
export default function CardPage({
  data = CARD_DAY_ONE,
  onActivate,
  onToggleFreeze,
  busy = false,
  notice = null,
}: {
  data?: CardData;
  /** Issues the card. Absent in the preview harness, where the page stands alone. */
  onActivate?: () => void;
  onToggleFreeze?: (frozen: boolean) => void;
  busy?: boolean;
  /** Why the last action did not do what it looked like it would. Absent when nothing went wrong. */
  notice?: string | null;
}) {
  const [frozen, setFrozen] = useState(data.frozen);
  const [variant, setVariant] = useState<CardData['variant']>(data.variant);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selected, setSelected] = useState<ActivityRow | null>(null);
  const card = { ...data, frozen, variant };

  // Follow the server once it answers. The toggle below moves immediately so the card reads as
  // responsive, but the server is what decides — and if the freeze failed, the card must not go on
  // claiming it is frozen when the network still says otherwise.
  useEffect(() => {
    setFrozen(data.frozen);
  }, [data.frozen]);

  // One account, two ways to present it: the plastic in a wallet and the number
  // you paste into a checkout. Same limits, same controls, same transactions.
  const variantToggle = card.activated && (
    <div className="grid grid-cols-2 gap-2">
      {(['physical', 'virtual'] as const).map((v) => (
        <Button
          key={v}
          variant="clear"
          size="xs"
          aria-pressed={variant === v}
          onClick={() => setVariant(v)}
          className={cn('capitalize', variant === v && 'border-tier-boost text-tier-boost-fg')}
        >
          {v}
        </Button>
      ))}
    </div>
  );

  const actions = card.activated ? (
    <div className="flex gap-2">
      <Button
        variant="clear"
        size="xs"
        className="flex-1"
        disabled={busy}
        onClick={() => {
          const next = !frozen;
          setFrozen(next);
          onToggleFreeze?.(next);
        }}
      >
        {frozen ? <Sun className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Snowflake className="h-3.5 w-3.5" strokeWidth={1.75} />}
        {frozen ? 'Unfreeze' : 'Freeze'}
      </Button>
      <Button variant="clear" size="xs" className="flex-1" onClick={() => setDetailsOpen(true)}>
        Details
      </Button>
    </div>
  ) : (
    <div className="space-y-2">
      <Button variant="clear" size="xs" className="w-full" disabled={busy} onClick={onActivate}>
        {busy ? 'Activating…' : 'Activate card'}
      </Button>
      {/* Sits under the button that failed, not in a toast — the member is looking here. */}
      {notice && (
        <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );

  const caption = (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      Spends your cash first, then your credit line. No transfers needed.
    </p>
  );

  const transactions = (
    <>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground-secondary">Card transactions</span>
        {card.period && (
          <span className="text-xs text-muted-foreground">
            {card.period}
            {card.periodTotal > 0 && ` · ${money(card.periodTotal)}`}
          </span>
        )}
      </div>
      <TransactionRows
        showDate
        onSelect={setSelected}
        rows={card.transactions}
        emptyMessage={
          card.activated
            ? 'No card spending yet.'
            : 'Activate your card and your spending will show up here.'
        }
      />
    </>
  );

  return (
    <>
      {/* Desktop: the card column takes ~31% of the content width — the spec's
          250px was against an 840px reference frame, so it has to scale with the
          container rather than stay fixed, or the card shrinks to a stamp on a
          wide screen. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)] lg:items-start lg:gap-8">
        <div className="flex flex-col gap-3">
          <ClearCardFace card={card} />
          {variantToggle}
          {actions}
          {/* Mobile reads the card, then what it spent, then how it's governed —
              so the controls come after the list rather than before it. */}
          <div className="mt-3 lg:hidden">{transactions}</div>
          {card.activated && <CardControlsCard card={card} />}
          {card.activated && (
            <Button variant="clear" size="sm" className="w-full text-xs">
              Add to Apple Wallet
            </Button>
          )}
          <div className="lg:hidden">{caption}</div>
        </div>
        <div className="hidden lg:block">
          {transactions}
          <div className="mt-3">{caption}</div>
        </div>
      </div>

      <CardDetailsDialog card={card} open={detailsOpen} onOpenChange={setDetailsOpen} />
      {selected && (
        <TransactionDetailDialog
          row={selected}
          open={selected !== null}
          onOpenChange={(o) => !o && setSelected(null)}
        />
      )}
    </>
  );
}
