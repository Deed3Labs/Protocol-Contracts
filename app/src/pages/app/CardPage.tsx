import { useEffect, useState } from 'react';
import { Snowflake, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ClearCardFace from '@/components/clear/ClearCardFace';
import { CompositionBar, LegendRow } from '@/components/clear/CompositionBar';
import { totalsByCategory, CATEGORY_LABEL, type MerchantCategory } from '@/lib/mccCategory';
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


  /*
   * Spending from — what a tap will draw on.
   *
   * This was rows of text; it is one figure, one bar and a short legend. The bar runs cheapest to
   * dearest left to right and cash owns the deepest colour, so the order the waterfall spends in is
   * the order it reads in.
   *
   * Each line carries its price rather than its mechanics — "free", "0.65%", "1.5%" — which is four
   * words where there were two sentences. A tier the member has not added shows hollow and says
   * Off: it stays on the list because it is something they can turn on, not because it is
   * spendable.
   */
  const cardCash = data.cardCash;
  const spendingFrom = data.tiers && data.tiers.length > 0 && (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[.5px] text-muted-foreground">Spending from</span>

      </div>
      <p className="mb-0.5 text-[11px] text-muted-foreground">{cardCash != null ? 'Spendable' : 'Credit available'}</p>
      <p className="m-0 text-[30px] font-medium tracking-[-.9px]">
        {money(cardCash != null ? cardCash : (data.creditAfterCash ?? 0))}
      </p>
      {cardCash != null && (data.creditAfterCash ?? 0) > 0 && (
        <p className="mb-3 mt-1.5 text-xs text-muted-foreground">then {money(data.creditAfterCash ?? 0)} of credit</p>
      )}
      <CompositionBar
        className="mb-1"
        segments={[
          // No cash segment when there is no readable card balance: an absent bar beats a wrong one.
          ...(cardCash != null ? [{ value: cardCash, color: 'rgb(var(--tier-cash))', label: 'Cash' }] : []),
          ...data.tiers.filter((t) => t.added).map((t) => ({
            value: Math.max(0, t.limit - t.used),
            color: `rgb(var(--tier-${t.key}))`,
            label: t.shortLabel ?? t.label,
          })),
        ]}
      />
      <div>
        {cardCash != null && <LegendRow color="rgb(var(--tier-cash))" label="Cash" value={money(cardCash)} />}
        {data.tiers.map((tier) => (
          <LegendRow
            key={tier.key}
            color={`rgb(var(--tier-${tier.key}))`}
            label={`${tier.shortLabel ?? tier.label} · ${tier.rate}`}
            value={tier.added ? money(Math.max(0, tier.limit - tier.used)) : 'Off'}
            off={!tier.added}
          />
        ))}
      </div>
    </div>
  );

  const caption = (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      Spends your cash first, then your credit line. No transfers needed.
    </p>
  );


  /*
   * The same bar as Spending from, doing a different job.
   *
   * Above it splits what a member CAN spend; here what they DID. One visual idea reused rather than
   * two invented, and the second reads instantly because they learned it on the first.
   *
   * Only rendered when the rows carry a category. A card transaction gets one from the merchant
   * category code the network sent; nothing else does, and a bar assembled from rows without one
   * would be a picture of our ignorance.
   */
  const categorised = card.transactions.filter((row): row is typeof row & { category: MerchantCategory } =>
    row.category != null,
  );
  const categoryTotals = totalsByCategory(categorised);
  const categoryBar = categoryTotals.length > 1 && (
    <>
      <CompositionBar
        className="mb-2"
        segments={categoryTotals.map(({ category, total }) => ({
          value: total,
          color: `rgb(var(--cat-${category}))`,
          label: CATEGORY_LABEL[category],
        }))}
      />
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-foreground-secondary">
        {categoryTotals.map(({ category, total }) => (
          <span key={category} className="flex items-center gap-1.5">
            <i
              className="inline-block h-[7px] w-[7px] rounded-full"
              style={{ background: `rgb(var(--cat-${category}))` }}
            />
            {CATEGORY_LABEL[category]} {money(total)}
          </span>
        ))}
      </div>
    </>
  );

  const transactions = (
    <>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <div>
          <p className="mb-0.5 text-[11px] text-muted-foreground">{card.period || 'This month'}</p>
          <p className="m-0 text-[25px] font-medium tracking-[-.6px]">{money(card.periodTotal)}</p>
        </div>
        {/*
          * The count is the context that makes the figure mean something, and there is no room for
          * it on a phone — so it appears at width rather than being abbreviated onto one.
          */}
        {card.transactions.length > 0 && (
          <p className="hidden text-xs text-muted-foreground lg:block">
            {card.transactions.length} {card.transactions.length === 1 ? 'purchase' : 'purchases'}
          </p>
        )}
      </div>
      {categoryBar}
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
          <div className="mt-3 lg:hidden">{spendingFrom}</div>
          <div className="mt-3 lg:hidden">{transactions}</div>
          {card.activated && <CardControlsCard card={card} />}
          {card.activated && (
            <Button variant="clear" size="sm" className="w-full text-xs">
              Add to Apple Wallet
            </Button>
          )}
          <div className="lg:hidden">{caption}</div>
        </div>
        <div className="hidden lg:flex lg:flex-col lg:gap-4">
          {spendingFrom}
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
